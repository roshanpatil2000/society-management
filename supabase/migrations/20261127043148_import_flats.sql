-- import_flats: all-or-nothing import of wings, flats and owner invites from a
-- parsed spreadsheet (the import-flats Edge Function parses the file and calls
-- this with the user's own session, so permissions and quotas are the caller's).
--
-- p_rows: JSON array of {row, wing, flat_number, floor?, area_sqft?, flat_type?,
--   parking_slot?, owner_email?, owner_name?}. "row" is the spreadsheet row number,
--   used in the error report. Returns
--   {ok, wings_created, flats_created, invites_created, errors: [{row, field, message}]}.
-- If any row is bad, nothing is written. p_dry_run checks without writing.

create or replace function public.import_flats(p_society_id uuid, p_rows jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  idx integer := 0;
  row_no integer;
  v_wing text;
  v_number text;
  v_floor smallint;
  v_area numeric;
  v_type text;
  v_email text;
  v_key text;
  v_errors jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_wings text[] := '{}';
  v_new_flats integer := 0;
  v_new_invites integer := 0;
  v_quotas jsonb;
  v_wing_id uuid;
  v_flat_id uuid;
  v_member_role uuid;
  v_wings_created integer := 0;
begin
  if not private.has_permission(p_society_id, 'flats.manage') then
    raise exception 'permission_denied: flats.manage' using errcode = '42501';
  end if;
  if not private.society_is_active(p_society_id) then
    raise exception 'society_inactive' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'invalid_import: expected a list of rows' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'invalid_import: at most 2000 rows per file' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) e where nullif(trim(e ->> 'owner_email'), '') is not null)
     and not private.has_permission(p_society_id, 'members.invite') then
    raise exception 'permission_denied: members.invite (needed for owner emails)' using errcode = '42501';
  end if;

  -- 1. Check every row.
  for r in select * from jsonb_array_elements(p_rows) loop
    idx := idx + 1;
    row_no := coalesce((r ->> 'row')::integer, idx);
    v_wing := nullif(trim(r ->> 'wing'), '');
    v_number := nullif(trim(r ->> 'flat_number'), '');
    v_email := private.normalize_email(r ->> 'owner_email');

    if v_wing is null then
      v_errors := v_errors || jsonb_build_object('row', row_no, 'field', 'wing', 'message', 'Wing is required');
    elsif length(v_wing) > 40 then
      v_errors := v_errors || jsonb_build_object('row', row_no, 'field', 'wing', 'message', 'Wing is longer than 40 characters');
    end if;

    if v_number is null then
      v_errors := v_errors || jsonb_build_object('row', row_no, 'field', 'flat_number', 'message', 'Flat number is required');
    elsif length(v_number) > 20 then
      v_errors := v_errors || jsonb_build_object('row', row_no, 'field', 'flat_number', 'message', 'Flat number is longer than 20 characters');
    end if;

    if nullif(trim(r ->> 'floor'), '') is not null and (r ->> 'floor') !~ '^\s*-?\d{1,3}\s*$' then
      v_errors := v_errors || jsonb_build_object('row', row_no, 'field', 'floor', 'message', 'Floor must be a whole number');
    end if;

    if nullif(trim(r ->> 'area_sqft'), '') is not null then
      if (r ->> 'area_sqft') !~ '^\s*\d+(\.\d{1,2})?\s*$' or (r ->> 'area_sqft')::numeric <= 0 then
        v_errors := v_errors || jsonb_build_object('row', row_no, 'field', 'area_sqft', 'message', 'Area must be a positive number with at most 2 decimals');
      end if;
    end if;

    if length(coalesce(r ->> 'flat_type', '')) > 30 then
      v_errors := v_errors || jsonb_build_object('row', row_no, 'field', 'flat_type', 'message', 'Flat type is longer than 30 characters');
    end if;

    if v_email is not null then
      if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
        v_errors := v_errors || jsonb_build_object('row', row_no, 'field', 'owner_email', 'message', 'Owner email is not valid');
      elsif exists (select 1 from public.membership m join public.profiles pr on pr.id = m.user_id
                    where m.society_id = p_society_id and m.status = 'active' and m.deleted_at is null and pr.email = v_email) then
        v_errors := v_errors || jsonb_build_object('row', row_no, 'field', 'owner_email', 'message', 'Already a member; add them to the flat instead');
      elsif exists (select 1 from public.invite i where i.society_id = p_society_id and i.email = v_email
                    and i.status = 'pending' and i.expires_at > now()) then
        v_errors := v_errors || jsonb_build_object('row', row_no, 'field', 'owner_email', 'message', 'Already invited');
      else
        v_new_invites := v_new_invites + 1;
      end if;
    end if;

    if v_wing is not null and v_number is not null then
      v_key := lower(v_wing) || '|' || lower(v_number);
      if v_key = any (v_seen) then
        v_errors := v_errors || jsonb_build_object('row', row_no, 'field', 'flat_number', 'message', 'This flat appears twice in the file');
      elsif exists (select 1 from public.flat f join public.wing w on w.id = f.wing_id
                    where f.society_id = p_society_id and f.deleted_at is null and w.deleted_at is null
                      and lower(w.name) = lower(v_wing) and lower(f.number) = lower(v_number)) then
        v_errors := v_errors || jsonb_build_object('row', row_no, 'field', 'flat_number', 'message', 'This flat already exists');
      else
        v_seen := v_seen || v_key;
        v_new_flats := v_new_flats + 1;
        if not lower(v_wing) = any (v_wings) then
          v_wings := v_wings || lower(v_wing);
        end if;
      end if;
    end if;
  end loop;

  -- 2. Quotas for the whole file.
  select s.quotas into v_quotas from public.society s where s.id = p_society_id for update;
  if (select count(*) from public.flat f where f.society_id = p_society_id and f.deleted_at is null) + v_new_flats
     > coalesce((v_quotas ->> 'max_flats')::integer, 0) then
    v_errors := v_errors || jsonb_build_object('row', 0, 'field', 'file',
      'message', format('quota_exceeded: max_flats (%s allowed)', v_quotas ->> 'max_flats'));
  end if;
  if v_new_invites > 0 and (select count(*) from public.invite i where i.society_id = p_society_id
        and (i.last_sent_at at time zone 'Asia/Kolkata')::date = private.today_ist()) + v_new_invites
     > coalesce((v_quotas ->> 'invites_per_day')::integer, 0) then
    v_errors := v_errors || jsonb_build_object('row', 0, 'field', 'file',
      'message', format('quota_exceeded: invites_per_day (%s allowed)', v_quotas ->> 'invites_per_day'));
  end if;

  if jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object('ok', false, 'wings_created', 0, 'flats_created', 0, 'invites_created', 0, 'errors', v_errors);
  end if;

  if p_dry_run then
    return jsonb_build_object('ok', true,
      'wings_created', (select count(*) from unnest(v_wings) n
                        where not exists (select 1 from public.wing w where w.society_id = p_society_id
                                          and w.deleted_at is null and lower(w.name) = n)),
      'flats_created', v_new_flats, 'invites_created', v_new_invites, 'errors', '[]'::jsonb);
  end if;

  -- 3. Write everything (one transaction: any failure undoes the whole import).
  select r2.id into v_member_role from public.role r2
   where r2.society_id = p_society_id and r2.name = 'Member' and r2.is_system and r2.deleted_at is null;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_wing := trim(r ->> 'wing');
    v_number := trim(r ->> 'flat_number');

    select w.id into v_wing_id from public.wing w
     where w.society_id = p_society_id and w.deleted_at is null and lower(w.name) = lower(v_wing);
    if v_wing_id is null then
      insert into public.wing (society_id, name) values (p_society_id, v_wing) returning id into v_wing_id;
      v_wings_created := v_wings_created + 1;
    end if;

    v_floor := nullif(trim(r ->> 'floor'), '')::smallint;
    v_area := nullif(trim(r ->> 'area_sqft'), '')::numeric;
    v_type := nullif(trim(r ->> 'flat_type'), '');
    insert into public.flat (society_id, wing_id, number, floor, area_sqft, flat_type, parking_slot)
    values (p_society_id, v_wing_id, v_number, v_floor, v_area, v_type, nullif(trim(r ->> 'parking_slot'), ''))
    returning id into v_flat_id;

    v_email := private.normalize_email(r ->> 'owner_email');
    if v_email is not null then
      if v_member_role is null then
        raise exception 'invalid_import: this society has no Member role to invite owners with' using errcode = 'P0001';
      end if;
      perform public.create_invite(p_society_id, v_email, array[v_member_role],
                                   nullif(trim(r ->> 'owner_name'), ''), v_flat_id, 'owner');
    end if;
    v_wing_id := null;
  end loop;

  return jsonb_build_object('ok', true, 'wings_created', v_wings_created, 'flats_created', v_new_flats,
                            'invites_created', v_new_invites, 'errors', '[]'::jsonb);
end;
$$;

revoke all on function public.import_flats(uuid, jsonb, boolean) from public, anon;
grant execute on function public.import_flats(uuid, jsonb, boolean) to authenticated;
