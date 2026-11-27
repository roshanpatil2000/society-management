-- Opening balances and the per-flat ledger.
--
-- post_opening_balances: a society starting mid-life posts one opening entry
-- (per-flat arrears and advances, plus fund, bank and cash balances) before any
-- other entry. All or nothing, with a per-row error report and a dry run, like
-- import_flats. Amounts are paise (whole numbers); the import-opening-balances
-- Edge Function converts rupees from the spreadsheet.
--
-- p_flats:    [{row, wing, flat_number, arrears?, advance?}]
-- p_accounts: [{row, code, debit?, credit?}]
-- Returns {ok, entry_id, flats, total_debit, total_credit,
--          errors: [{sheet: flats|accounts|file, row, field, message}]}.

create or replace function private.parse_paise(p_value text)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case
    when nullif(trim(p_value), '') is null then 0
    when trim(p_value) ~ '^[0-9]{1,15}$' then trim(p_value)::bigint
  end;
$$;

create or replace function private.format_rupees(p_paise bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select '₹' || to_char(p_paise / 100.0, 'FM999999999999990.00');
$$;

create or replace function public.post_opening_balances(
  p_society_id uuid,
  p_as_of date,
  p_flats jsonb,
  p_accounts jsonb,
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  idx integer;
  row_no integer;
  v_locked date;
  v_errors jsonb := '[]'::jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_seen uuid[] := '{}';
  v_seen_codes text[] := '{}';
  v_flat uuid;
  v_account public.ledger_account;
  v_arrears bigint;
  v_advance bigint;
  v_debit bigint;
  v_credit bigint;
  v_total_debit bigint := 0;
  v_total_credit bigint := 0;
  v_flats integer := 0;
  v_receivables uuid;
  v_advances uuid;
  v_entry uuid;
begin
  if not private.has_permission(p_society_id, 'accounts.opening_balance') then
    raise exception 'permission_denied: accounts.opening_balance' using errcode = '42501';
  end if;
  if not private.society_is_active(p_society_id) then
    raise exception 'society_inactive' using errcode = 'P0001';
  end if;
  if p_as_of is null then
    raise exception 'invalid_opening: the as-of date is required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_flats) is distinct from 'array' or jsonb_typeof(p_accounts) is distinct from 'array' then
    raise exception 'invalid_opening: expected lists of flat and account rows' using errcode = '22023';
  end if;
  if jsonb_array_length(p_flats) > 5000 or jsonb_array_length(p_accounts) > 500 then
    raise exception 'invalid_opening: at most 5000 flat rows and 500 account rows' using errcode = '22023';
  end if;

  -- One at a time per society, and only into an empty, open book.
  select s.locked_until into v_locked from public.society s where s.id = p_society_id for update;
  if exists (select 1 from public.journal_entry e where e.society_id = p_society_id and e.source_type = 'opening') then
    raise exception 'opening_already_posted: opening balances were already posted' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.journal_entry e where e.society_id = p_society_id) then
    raise exception 'books_not_empty: opening balances must be the first entry in the books' using errcode = 'P0001';
  end if;
  if v_locked is not null and p_as_of <= v_locked then
    raise exception 'period_locked: the books are closed up to %', v_locked using errcode = 'P0001';
  end if;

  v_receivables := private.ledger_account_id(p_society_id, 'member_receivables');
  v_advances := private.ledger_account_id(p_society_id, 'member_advances');
  if v_receivables is null or v_advances is null then
    raise exception 'invalid_opening: this society has no member receivable or advance account' using errcode = 'P0001';
  end if;

  -- 1. Flats: arrears (the flat owes) or advance (paid ahead).
  idx := 0;
  for r in select * from jsonb_array_elements(p_flats) loop
    idx := idx + 1;
    row_no := coalesce((r ->> 'row')::integer, idx);
    select f.id into v_flat
      from public.flat f join public.wing w on w.id = f.wing_id
     where f.society_id = p_society_id and f.deleted_at is null and w.deleted_at is null
       and lower(w.name) = lower(trim(r ->> 'wing')) and lower(f.number) = lower(trim(r ->> 'flat_number'));
    v_arrears := private.parse_paise(r ->> 'arrears');
    v_advance := private.parse_paise(r ->> 'advance');

    if v_flat is null then
      v_errors := v_errors || jsonb_build_object('sheet', 'flats', 'row', row_no, 'field', 'flat_number',
        'message', format('No flat %s-%s in this society', coalesce(trim(r ->> 'wing'), ''), coalesce(trim(r ->> 'flat_number'), '')));
    elsif v_flat = any (v_seen) then
      v_errors := v_errors || jsonb_build_object('sheet', 'flats', 'row', row_no, 'field', 'flat_number',
        'message', 'This flat appears twice in the file');
    else
      v_seen := v_seen || v_flat;
    end if;
    if v_arrears is null then
      v_errors := v_errors || jsonb_build_object('sheet', 'flats', 'row', row_no, 'field', 'arrears',
        'message', 'Arrears must be zero or more, in whole paise');
    end if;
    if v_advance is null then
      v_errors := v_errors || jsonb_build_object('sheet', 'flats', 'row', row_no, 'field', 'advance',
        'message', 'Advance must be zero or more, in whole paise');
    end if;
    if v_arrears > 0 and v_advance > 0 then
      v_errors := v_errors || jsonb_build_object('sheet', 'flats', 'row', row_no, 'field', 'advance',
        'message', 'Enter either arrears or an advance for a flat, not both');
    end if;

    if v_flat is not null and coalesce(v_arrears, 0) > 0 and coalesce(v_advance, 0) = 0 then
      v_lines := v_lines || jsonb_build_object('account_id', v_receivables, 'flat_id', v_flat, 'debit', v_arrears);
      v_total_debit := v_total_debit + v_arrears;
      v_flats := v_flats + 1;
    elsif v_flat is not null and coalesce(v_advance, 0) > 0 and coalesce(v_arrears, 0) = 0 then
      v_lines := v_lines || jsonb_build_object('account_id', v_advances, 'flat_id', v_flat, 'credit', v_advance);
      v_total_credit := v_total_credit + v_advance;
      v_flats := v_flats + 1;
    end if;
  end loop;

  -- 2. Accounts: bank, cash, funds, surplus and other balances.
  idx := 0;
  for r in select * from jsonb_array_elements(p_accounts) loop
    idx := idx + 1;
    row_no := coalesce((r ->> 'row')::integer, idx);
    v_account := null;
    select a.* into v_account from public.ledger_account a
     where a.society_id = p_society_id and a.deleted_at is null and a.code = trim(r ->> 'code');
    v_debit := private.parse_paise(r ->> 'debit');
    v_credit := private.parse_paise(r ->> 'credit');

    if v_account.id is null then
      v_errors := v_errors || jsonb_build_object('sheet', 'accounts', 'row', row_no, 'field', 'code',
        'message', format('Unknown account code %s', coalesce(trim(r ->> 'code'), '')));
    elsif v_account.system_key in ('member_receivables', 'member_advances') then
      v_errors := v_errors || jsonb_build_object('sheet', 'accounts', 'row', row_no, 'field', 'code',
        'message', 'Enter member arrears and advances per flat on the Flats sheet');
    elsif v_account.code = any (v_seen_codes) then
      v_errors := v_errors || jsonb_build_object('sheet', 'accounts', 'row', row_no, 'field', 'code',
        'message', 'This account appears twice in the file');
    else
      v_seen_codes := v_seen_codes || v_account.code;
    end if;
    if v_debit is null then
      v_errors := v_errors || jsonb_build_object('sheet', 'accounts', 'row', row_no, 'field', 'debit',
        'message', 'Debit must be zero or more, in whole paise');
    end if;
    if v_credit is null then
      v_errors := v_errors || jsonb_build_object('sheet', 'accounts', 'row', row_no, 'field', 'credit',
        'message', 'Credit must be zero or more, in whole paise');
    end if;
    if v_debit > 0 and v_credit > 0 then
      v_errors := v_errors || jsonb_build_object('sheet', 'accounts', 'row', row_no, 'field', 'debit',
        'message', 'Enter either a debit or a credit for an account, not both');
    end if;

    if v_account.id is not null and coalesce(v_debit, 0) > 0 and coalesce(v_credit, 0) = 0 then
      v_lines := v_lines || jsonb_build_object('account_id', v_account.id, 'debit', v_debit);
      v_total_debit := v_total_debit + v_debit;
    elsif v_account.id is not null and coalesce(v_credit, 0) > 0 and coalesce(v_debit, 0) = 0 then
      v_lines := v_lines || jsonb_build_object('account_id', v_account.id, 'credit', v_credit);
      v_total_credit := v_total_credit + v_credit;
    end if;
  end loop;

  -- 3. The whole file must balance.
  if jsonb_array_length(v_errors) = 0 then
    if v_total_debit = 0 then
      v_errors := v_errors || jsonb_build_object('sheet', 'file', 'row', 0, 'field', 'total',
        'message', 'There is nothing to post');
    elsif v_total_debit <> v_total_credit then
      v_errors := v_errors || jsonb_build_object('sheet', 'file', 'row', 0, 'field', 'total',
        'message', format('Debits %s and credits %s differ by %s; put the difference in Surplus / Deficit (3900)',
          private.format_rupees(v_total_debit), private.format_rupees(v_total_credit),
          private.format_rupees(abs(v_total_debit - v_total_credit))));
    end if;
  end if;

  if jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object('ok', false, 'entry_id', null, 'flats', 0,
      'total_debit', v_total_debit, 'total_credit', v_total_credit, 'errors', v_errors);
  end if;

  if not p_dry_run then
    v_entry := private.post_journal_impl(p_society_id, p_as_of,
      'Opening balances as on ' || to_char(p_as_of, 'DD Mon YYYY'), 'opening', null, v_lines);
  end if;

  return jsonb_build_object('ok', true, 'entry_id', v_entry, 'flats', v_flats,
    'total_debit', v_total_debit, 'total_credit', v_total_credit, 'errors', '[]'::jsonb);
end;
$$;

revoke all on function private.parse_paise(text), private.format_rupees(bigint) from public, anon, authenticated;
revoke all on function public.post_opening_balances(uuid, date, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.post_opening_balances(uuid, date, jsonb, jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- flat_ledger: each flat's statement (member receivable and advance lines) with
-- a running balance; positive means the flat owes. RLS on journal_line decides
-- which flats a person sees.
-- ---------------------------------------------------------------------------

create view public.flat_ledger with (security_invoker = true) as
select
  l.society_id,
  l.flat_id,
  e.id as journal_entry_id,
  e.entry_date,
  e.source_type,
  e.source_id,
  e.narration,
  l.debit,
  l.credit,
  (sum(l.debit - l.credit) over (
     partition by l.flat_id
     order by e.entry_date, e.created_at, l.id
     rows between unbounded preceding and current row))::bigint as balance
from public.journal_line l
join public.journal_entry e on e.id = l.journal_entry_id
join public.ledger_account a on a.id = l.ledger_account_id
where a.system_key in ('member_receivables', 'member_advances');

revoke all on public.flat_ledger from anon, authenticated;
grant select on public.flat_ledger to authenticated;
