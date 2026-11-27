-- Charge heads (what each flat is billed for) and sequential document numbers.
--
-- calc_type:
--   per_sqft      rate_per_sqft paise per sq ft (numeric, up to 4 decimals) x flat area
--   flat          rate_paise per flat
--   by_flat_type  rates_by_type {"2BHK": paise, ...}; flats of other types are not charged
--   one_time      rate_paise per flat, billed by the next billing run only
-- flat_ids limits a head to some flats (null = every flat), e.g. a transfer fee.

create or replace function private.valid_type_rates(p_rates jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_rates) = 'object'
     and exists (select 1 from jsonb_each(p_rates))
     and not exists (
       select 1 from jsonb_each(p_rates) e
       where jsonb_typeof(e.value) <> 'number' or (e.value #>> '{}') !~ '^[0-9]{1,13}$' or (e.value #>> '{}')::bigint <= 0
          or length(trim(e.key)) not between 1 and 30);
$$;

create table public.charge_head (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.society (id),
  name text not null check (length(trim(name)) between 1 and 60),
  calc_type text not null check (calc_type in ('per_sqft', 'flat', 'by_flat_type', 'one_time')),
  rate_paise bigint check (rate_paise is null or rate_paise >= 0),
  rate_per_sqft numeric(12, 4) check (rate_per_sqft is null or rate_per_sqft >= 0),
  rates_by_type jsonb,
  gst_applicable boolean not null default false,
  ledger_account_id uuid not null,
  flat_ids uuid[],
  is_active boolean not null default true,
  sort_order smallint not null default 0,
  -- For one_time heads: the run that billed it.
  billed_run_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (society_id, id),
  foreign key (society_id, ledger_account_id) references public.ledger_account (society_id, id),
  check (case calc_type
    when 'per_sqft' then rate_per_sqft is not null and rate_paise is null and rates_by_type is null
    when 'by_flat_type' then rates_by_type is not null and private.valid_type_rates(rates_by_type)
                             and rate_paise is null and rate_per_sqft is null
    else rate_paise is not null and rate_per_sqft is null and rates_by_type is null
  end)
);
create unique index charge_head_name_key on public.charge_head (society_id, name) where deleted_at is null;
alter table public.charge_head enable row level security;

create trigger charge_head_set_updated_at before update on public.charge_head
  for each row execute function private.set_updated_at();
create trigger charge_head_audit after insert or update or delete on public.charge_head
  for each row execute function private.audit_row();

-- A head credits an income or fund account, and names only this society's flats.
create or replace function private.check_charge_head()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.ledger_account a
                 where a.id = new.ledger_account_id and a.society_id = new.society_id
                   and a.type in ('income', 'fund') and a.deleted_at is null) then
    if exists (select 1 from public.ledger_account a where a.id = new.ledger_account_id and a.society_id = new.society_id) then
      raise exception 'invalid_charge_head: a charge head credits an income or fund account' using errcode = '23514';
    end if;
  end if;
  if new.flat_ids is not null and exists (
    select 1 from unnest(new.flat_ids) x(id)
    where not exists (select 1 from public.flat f where f.id = x.id and f.society_id = new.society_id and f.deleted_at is null)
  ) then
    raise exception 'invalid_charge_head: a charge head can name only this society''s flats' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger charge_head_check before insert or update on public.charge_head
  for each row execute function private.check_charge_head();

revoke all on public.charge_head from anon, authenticated;
grant select on public.charge_head to authenticated;
grant insert (society_id, name, calc_type, rate_paise, rate_per_sqft, rates_by_type, gst_applicable, ledger_account_id,
              flat_ids, is_active, sort_order) on public.charge_head to authenticated;
grant update (name, calc_type, rate_paise, rate_per_sqft, rates_by_type, gst_applicable, ledger_account_id,
              flat_ids, is_active, sort_order, deleted_at) on public.charge_head to authenticated;

create policy charge_head_select on public.charge_head for select to authenticated using (
  private.is_member(society_id) or private.is_platform_admin()
);
create policy charge_head_insert on public.charge_head for insert to authenticated with check (
  private.has_permission(society_id, 'charge_heads.manage') and private.society_is_active(society_id)
);
create policy charge_head_update on public.charge_head for update to authenticated
  using (private.has_permission(society_id, 'charge_heads.manage') and private.society_is_active(society_id))
  with check (private.has_permission(society_id, 'charge_heads.manage') and private.society_is_active(society_id));

-- ---------------------------------------------------------------------------
-- Document numbers: '2026-27/000123', per society, type and financial year.
-- Taken inside financial RPCs; the counter row is locked until they commit.
-- ---------------------------------------------------------------------------

create table public.doc_counter (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.society (id),
  doc_type text not null check (doc_type in ('bill', 'receipt', 'credit_note', 'voucher')),
  financial_year text not null check (financial_year ~ '^[0-9]{4}(-[0-9]{2})?$'),
  last_no integer not null default 0 check (last_no >= 0),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (society_id, id),
  unique (society_id, doc_type, financial_year)
);
alter table public.doc_counter enable row level security;
create trigger doc_counter_set_updated_at before update on public.doc_counter
  for each row execute function private.set_updated_at();
create trigger doc_counter_audit after insert or update or delete on public.doc_counter
  for each row execute function private.audit_row();
revoke all on public.doc_counter from anon, authenticated;
grant select on public.doc_counter to authenticated;
create policy doc_counter_select on public.doc_counter for select to authenticated using (
  private.has_permission(society_id, 'accounts.view') or private.is_platform_admin()
);

-- '2026-27' for an April-March year, '2026' for a calendar year.
create or replace function private.financial_year(p_society_id uuid, p_date date)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start smallint;
  v_year integer;
begin
  select s.financial_year_start_month into v_start from public.society s where s.id = p_society_id;
  if v_start is null then
    raise exception 'invalid_society: unknown society' using errcode = '22023';
  end if;
  v_year := extract(year from p_date)::integer - case when extract(month from p_date) < v_start then 1 else 0 end;
  if v_start = 1 then
    return v_year::text;
  end if;
  return v_year || '-' || lpad(((v_year + 1) % 100)::text, 2, '0');
end;
$$;

create or replace function private.next_doc_no(p_society_id uuid, p_doc_type text, p_date date)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fy text;
  v_no integer;
begin
  if p_society_id is null or p_date is null then
    raise exception 'invalid_document: society and date are required' using errcode = '22023';
  end if;
  v_fy := private.financial_year(p_society_id, p_date);
  insert into public.doc_counter (society_id, doc_type, financial_year, last_no)
  values (p_society_id, p_doc_type, v_fy, 1)
  on conflict (society_id, doc_type, financial_year) do update set last_no = public.doc_counter.last_no + 1
  returning last_no into v_no;
  return v_fy || '/' || lpad(v_no::text, 6, '0');
end;
$$;

revoke all on function
  private.valid_type_rates(jsonb),
  private.check_charge_head(),
  private.financial_year(uuid, date),
  private.next_doc_no(uuid, text, date)
from public, anon, authenticated;
-- The check constraint on charge_head evaluates this as the inserting user.
grant execute on function private.valid_type_rates(jsonb) to authenticated, service_role;
