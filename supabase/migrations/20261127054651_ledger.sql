-- Ledger core: chart of accounts, bank and cash accounts, and double-entry
-- journal. Every entry balances (checked by the posting function and again by a
-- deferred constraint trigger), never changes once written, and respects
-- society.locked_until. Only security definer functions write journal entries.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.ledger_account (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.society (id),
  code text not null check (code ~ '^[0-9A-Za-z.-]{1,12}$'),
  name text not null check (length(trim(name)) between 1 and 80),
  type text not null check (type in ('asset', 'liability', 'income', 'expense', 'fund')),
  parent_id uuid,
  is_system boolean not null default false,
  -- Stable name the functions use to find an account (member_receivables, cash, ...).
  system_key text check (system_key is null or system_key ~ '^[a-z_]{1,40}$'),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (society_id, id),
  foreign key (society_id, parent_id) references public.ledger_account (society_id, id)
);
create unique index ledger_account_code_key on public.ledger_account (society_id, code) where deleted_at is null;
create unique index ledger_account_system_key on public.ledger_account (society_id, system_key)
  where system_key is not null and deleted_at is null;
alter table public.ledger_account enable row level security;

create table public.bank_account (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null,
  ledger_account_id uuid not null,
  kind text not null check (kind in ('bank', 'cash')),
  name text not null check (length(trim(name)) between 1 and 80),
  bank text,
  account_last4 text check (account_last4 is null or account_last4 ~ '^[0-9]{4}$'),
  ifsc text check (ifsc is null or ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  upi_id text check (upi_id is null or upi_id ~ '^[A-Za-z0-9._-]{2,256}@[A-Za-z]{2,64}$'),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (society_id, id),
  foreign key (society_id, ledger_account_id) references public.ledger_account (society_id, id)
);
create unique index bank_account_one_cash on public.bank_account (society_id) where kind = 'cash' and deleted_at is null;
create unique index bank_account_one_default on public.bank_account (society_id) where is_default and deleted_at is null;
alter table public.bank_account enable row level security;

create table public.journal_entry (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.society (id),
  entry_date date not null,
  narration text not null check (length(trim(narration)) between 1 and 500),
  source_type text not null check (source_type in (
    'bill', 'payment', 'credit_note', 'expense', 'reversal', 'interest', 'opening', 'year_close', 'manual')),
  source_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (society_id, id)
);
create index journal_entry_society_date_idx on public.journal_entry (society_id, entry_date);
create index journal_entry_source_idx on public.journal_entry (society_id, source_type, source_id);
alter table public.journal_entry enable row level security;

create table public.journal_line (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null,
  journal_entry_id uuid not null,
  ledger_account_id uuid not null,
  -- Set on Member Receivables / Advance from Members lines: the flat's sub-ledger.
  flat_id uuid,
  debit bigint not null default 0,
  credit bigint not null default 0,
  narration text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (society_id, id),
  foreign key (society_id, journal_entry_id) references public.journal_entry (society_id, id),
  foreign key (society_id, ledger_account_id) references public.ledger_account (society_id, id),
  foreign key (society_id, flat_id) references public.flat (society_id, id),
  check (debit >= 0 and credit >= 0 and (debit = 0) <> (credit = 0))
);
create index journal_line_entry_idx on public.journal_line (journal_entry_id);
create index journal_line_account_idx on public.journal_line (society_id, ledger_account_id);
create index journal_line_flat_idx on public.journal_line (society_id, flat_id) where flat_id is not null;
alter table public.journal_line enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['ledger_account', 'bank_account'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.set_updated_at()',
                   t || '_set_updated_at', t);
  end loop;
  foreach t in array array['ledger_account', 'bank_account', 'journal_entry', 'journal_line'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row()',
                   t || '_audit', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Journal integrity
-- ---------------------------------------------------------------------------

-- Journal entries and lines never change. Corrections are reversing entries.
create or replace function private.forbid_ledger_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'immutable: journal entries never change; post a reversing entry instead' using errcode = 'P0001';
end;
$$;

create trigger journal_entry_immutable before update or delete on public.journal_entry
  for each row execute function private.forbid_ledger_change();
create trigger journal_line_immutable before update or delete on public.journal_line
  for each row execute function private.forbid_ledger_change();

-- Member Receivables and Advance from Members lines carry the flat; no other line does.
create or replace function private.check_journal_line_flat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  select a.system_key into v_key from public.ledger_account a where a.id = new.ledger_account_id;
  if v_key in ('member_receivables', 'member_advances') and new.flat_id is null then
    raise exception 'invalid_entry: lines on member receivables or advances must name the flat' using errcode = '23514';
  end if;
  if new.flat_id is not null and v_key is distinct from 'member_receivables' and v_key is distinct from 'member_advances' then
    raise exception 'invalid_entry: only member receivable and advance lines name a flat' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger journal_line_flat before insert on public.journal_line
  for each row execute function private.check_journal_line_flat();

-- Checked at commit: every entry has at least two lines and balances.
create or replace function private.check_entry_balanced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry uuid;
  v_lines integer;
  v_debit bigint;
  v_credit bigint;
begin
  if tg_table_name = 'journal_entry' then
    v_entry := new.id;
  else
    v_entry := new.journal_entry_id;
  end if;
  select count(*), coalesce(sum(l.debit), 0), coalesce(sum(l.credit), 0)
    into v_lines, v_debit, v_credit
    from public.journal_line l where l.journal_entry_id = v_entry;
  if v_lines < 2 or v_debit <> v_credit then
    raise exception 'unbalanced_entry: entry % has % lines, debits % and credits %', v_entry, v_lines, v_debit, v_credit
      using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger journal_entry_balanced after insert on public.journal_entry
  deferrable initially deferred for each row execute function private.check_entry_balanced();
create constraint trigger journal_line_balanced after insert on public.journal_line
  deferrable initially deferred for each row execute function private.check_entry_balanced();

-- ---------------------------------------------------------------------------
-- Posting (the only way entries are written; called by financial RPCs)
-- ---------------------------------------------------------------------------

-- p_lines: [{account_id, flat_id?, debit?, credit?, narration?}], amounts in paise.
-- Refuses dates on or before society.locked_until. Returns the entry id.
create or replace function private.post_journal_impl(
  p_society_id uuid,
  p_date date,
  p_narration text,
  p_source_type text,
  p_source_id uuid,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_locked date;
  v_debit bigint := 0;
  v_credit bigint := 0;
  v_line jsonb;
  v_id uuid;
begin
  if p_society_id is null or p_date is null then
    raise exception 'invalid_entry: society and date are required' using errcode = '22023';
  end if;
  select s.locked_until into v_locked from public.society s where s.id = p_society_id for share;
  if not found then
    raise exception 'invalid_entry: unknown society' using errcode = '22023';
  end if;
  if v_locked is not null and p_date <= v_locked then
    raise exception 'period_locked: the books are closed up to %', v_locked using errcode = 'P0001';
  end if;

  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'invalid_entry: an entry needs at least two lines' using errcode = '22023';
  end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    if (coalesce((v_line ->> 'debit')::bigint, 0) > 0) = (coalesce((v_line ->> 'credit')::bigint, 0) > 0)
       or coalesce((v_line ->> 'debit')::bigint, 0) < 0 or coalesce((v_line ->> 'credit')::bigint, 0) < 0 then
      raise exception 'invalid_entry: each line needs either a positive debit or a positive credit' using errcode = '22023';
    end if;
    v_debit := v_debit + coalesce((v_line ->> 'debit')::bigint, 0);
    v_credit := v_credit + coalesce((v_line ->> 'credit')::bigint, 0);
  end loop;
  if v_debit <> v_credit then
    raise exception 'unbalanced_entry: debits % and credits % differ', v_debit, v_credit using errcode = '23514';
  end if;

  -- Entry and lines in one statement, so the balance check holds even with
  -- constraints set immediate.
  with e as (
    insert into public.journal_entry (society_id, entry_date, narration, source_type, source_id)
    values (p_society_id, p_date, p_narration, p_source_type, p_source_id)
    returning id
  ), l as (
    insert into public.journal_line (society_id, journal_entry_id, ledger_account_id, flat_id, debit, credit, narration)
    select p_society_id, e.id, (x ->> 'account_id')::uuid, (x ->> 'flat_id')::uuid,
           coalesce((x ->> 'debit')::bigint, 0), coalesce((x ->> 'credit')::bigint, 0), x ->> 'narration'
    from e, jsonb_array_elements(p_lines) x
  )
  select e.id into v_id from e;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Chart-of-accounts preset (every new society, and existing ones below)
-- ---------------------------------------------------------------------------

create or replace function private.create_chart_of_accounts(p_society_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.ledger_account (society_id, code, name, type, is_system, system_key)
  select p_society_id, a.code, a.name, a.type, a.key is not null, a.key
  from (values
    ('1010', 'Cash', 'asset', 'cash'),
    ('1020', 'Bank', 'asset', 'bank'),
    ('1100', 'Member Receivables', 'asset', 'member_receivables'),
    ('2100', 'Advance from Members', 'liability', 'member_advances'),
    ('2200', 'GST Output', 'liability', 'gst_output'),
    ('2300', 'TDS Payable', 'liability', 'tds_payable'),
    ('3100', 'Sinking Fund', 'fund', 'sinking_fund'),
    ('3200', 'Repair Fund', 'fund', 'repair_fund'),
    ('3900', 'Surplus / Deficit', 'fund', 'surplus'),
    ('4100', 'Maintenance Income', 'income', 'maintenance_income'),
    ('4200', 'Interest Income', 'income', 'interest_income'),
    ('4900', 'Rounding Off', 'income', 'rounding_off'),
    ('5100', 'Repairs and Maintenance', 'expense', null),
    ('5200', 'Electricity', 'expense', null),
    ('5300', 'Water', 'expense', null),
    ('5400', 'Security', 'expense', null),
    ('5500', 'Housekeeping', 'expense', null),
    ('5600', 'Bank Charges', 'expense', 'bank_charges'),
    ('5900', 'Miscellaneous Expenses', 'expense', null)
  ) as a(code, name, type, key)
  where not exists (select 1 from public.ledger_account x
                    where x.society_id = p_society_id and x.code = a.code and x.deleted_at is null);

  insert into public.bank_account (society_id, ledger_account_id, kind, name)
  select p_society_id, l.id, 'cash', 'Cash'
  from public.ledger_account l
  where l.society_id = p_society_id and l.system_key = 'cash' and l.deleted_at is null
    and not exists (select 1 from public.bank_account b
                    where b.society_id = p_society_id and b.kind = 'cash' and b.deleted_at is null);
end;
$$;

-- The account a function posts to, by its system key.
create or replace function private.ledger_account_id(p_society_id uuid, p_key text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id from public.ledger_account a
  where a.society_id = p_society_id and a.system_key = p_key and a.deleted_at is null;
$$;

-- create_society_impl now also adds the chart of accounts and the cash account.
create or replace function private.create_society_impl(p_society jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_name text := nullif(trim(p_society ->> 'name'), '');
  v_slug text := private.normalize_society_code(p_society ->> 'slug');
begin
  if v_name is null then
    raise exception 'invalid_society: name is required' using errcode = '22023';
  end if;
  if v_slug is null then
    raise exception 'invalid_society: slug must be 3 to 30 letters, digits or single hyphens, and not a reserved word'
      using errcode = '22023';
  end if;
  if exists (select 1 from public.society s where s.slug = v_slug and s.deleted_at is null) then
    raise exception 'duplicate_slug: the society code % is taken', v_slug using errcode = 'P0001';
  end if;
  if nullif(trim(p_society ->> 'registration_no'), '') is not null and exists (
    select 1 from public.society s
    where s.registration_no = trim(p_society ->> 'registration_no') and s.deleted_at is null
  ) then
    raise exception 'duplicate_registration: a society with registration number % already exists',
      trim(p_society ->> 'registration_no') using errcode = 'P0001';
  end if;

  insert into public.society (name, slug, registration_no, address, gstin, plan, financial_year_start_month)
  values (
    v_name,
    v_slug,
    nullif(trim(p_society ->> 'registration_no'), ''),
    nullif(trim(p_society ->> 'address'), ''),
    nullif(upper(trim(p_society ->> 'gstin')), ''),
    coalesce(nullif(trim(p_society ->> 'plan'), ''), 'pilot'),
    coalesce((p_society ->> 'financial_year_start_month')::smallint, 4)
  )
  returning id into v_id;

  update public.society
     set quotas = quotas || coalesce(p_society -> 'quotas', '{}'::jsonb)
   where id = v_id;

  perform private.create_society_roles(v_id);
  perform private.create_chart_of_accounts(v_id);
  return v_id;
end;
$$;

do $$
declare
  sid uuid;
begin
  perform set_config('app.actor', 'migration:ledger', true);
  for sid in select s.id from public.society s where s.deleted_at is null loop
    perform private.create_chart_of_accounts(sid);
  end loop;
end;
$$;

revoke all on function
  private.forbid_ledger_change(),
  private.check_journal_line_flat(),
  private.check_entry_balanced(),
  private.post_journal_impl(uuid, date, text, text, uuid, jsonb),
  private.create_chart_of_accounts(uuid),
  private.ledger_account_id(uuid, text),
  private.create_society_impl(jsonb)
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Privileges and policies
-- ---------------------------------------------------------------------------

revoke all on public.ledger_account, public.bank_account, public.journal_entry, public.journal_line from anon, authenticated;
grant select on public.ledger_account, public.bank_account, public.journal_entry, public.journal_line to authenticated;
-- Committee-added accounts only; system accounts come from the preset.
grant insert (society_id, code, name, type, parent_id) on public.ledger_account to authenticated;
grant update (code, name, parent_id, deleted_at) on public.ledger_account to authenticated;

-- The chart of accounts and the society's bank/UPI details are visible to members.
create policy ledger_account_select on public.ledger_account for select to authenticated using (
  private.is_member(society_id) or private.is_platform_admin()
);
create policy ledger_account_insert on public.ledger_account for insert to authenticated with check (
  private.has_permission(society_id, 'accounts.manage') and private.society_is_active(society_id)
  and not is_system and system_key is null
);
create policy ledger_account_update on public.ledger_account for update to authenticated
  using (not is_system and private.has_permission(society_id, 'accounts.manage') and private.society_is_active(society_id))
  with check (not is_system and private.has_permission(society_id, 'accounts.manage') and private.society_is_active(society_id));

create policy bank_account_select on public.bank_account for select to authenticated using (
  private.is_member(society_id) or private.is_platform_admin()
);

-- Lines: accounts.view sees everything; bills.view.all sees every flat's sub-ledger;
-- owners (and tenants the owner allowed) see their own flat's lines.
create policy journal_line_select on public.journal_line for select to authenticated using (
  private.has_permission(society_id, 'accounts.view')
  or (flat_id is not null and (
        private.has_permission(society_id, 'bills.view.all')
        or flat_id in (select private.my_billable_flat_ids(society_id))))
  or private.is_platform_admin()
);
-- An entry is visible when any of its lines is.
create policy journal_entry_select on public.journal_entry for select to authenticated using (
  private.has_permission(society_id, 'accounts.view')
  or exists (select 1 from public.journal_line l where l.journal_entry_id = journal_entry.id)
  or private.is_platform_admin()
);
