-- Ledger core: every society gets a chart of accounts and a cash account; journal
-- entries balance, never change, respect the period lock, and are written only by
-- functions. Members see only their own flat's ledger lines.
begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

create function pg_temp.as_user(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = p_email), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

select set_config('t.a', (select id::text from public.society where name = 'Green Park CHS'), true);
select set_config('t.b', (select id::text from public.society where name = 'Blue Ridge CHS'), true);
create function pg_temp.acct(p_society text, p_key text) returns uuid language sql as $$
  select id from public.ledger_account where society_id = current_setting(p_society)::uuid and system_key = p_key;
$$;
create function pg_temp.flat(p_wing text, p_number text) returns uuid language sql as $$
  select f.id from public.flat f join public.wing w on w.id = f.wing_id
  where w.name = p_wing and f.number = p_number and f.deleted_at is null;
$$;

-- ---- chart of accounts --------------------------------------------------------------
select is(
  (select array_agg(system_key order by system_key) from public.ledger_account
    where society_id = current_setting('t.a')::uuid and system_key is not null),
  array['bank', 'bank_charges', 'cash', 'gst_output', 'interest_income', 'maintenance_income',
        'member_advances', 'member_receivables', 'repair_fund', 'rounding_off', 'sinking_fund',
        'surplus', 'tds_payable'],
  'existing societies get the chart-of-accounts preset');

select set_config('t.new', private.create_society_impl('{"name": "Ledger CHS", "slug": "ledger-chs"}')::text, true);
select is((select count(*)::int from public.ledger_account where society_id = current_setting('t.new')::uuid and system_key is not null),
  13, 'a new society gets the chart-of-accounts preset');
select is((select count(*)::int from public.bank_account b join public.ledger_account l on l.id = b.ledger_account_id
            where b.society_id = current_setting('t.new')::uuid and b.kind = 'cash' and l.system_key = 'cash'),
  1, 'a new society gets one cash account on the Cash ledger');
select throws_ok(format('insert into public.bank_account (society_id, ledger_account_id, kind, name) values (%L, %L, %L, %L)',
  current_setting('t.new'), pg_temp.acct('t.new', 'cash'), 'cash', 'Second till'),
  '23505', null, 'a society has only one cash account');

-- ---- writing journal entries ---------------------------------------------------------
select set_config('t.lines', jsonb_build_array(
  jsonb_build_object('account_id', pg_temp.acct('t.a', 'member_receivables'), 'flat_id', pg_temp.flat('A', '101'), 'debit', 150000),
  jsonb_build_object('account_id', pg_temp.acct('t.a', 'maintenance_income'), 'credit', 150000))::text, true);

select set_config('t.je', private.post_journal_impl(current_setting('t.a')::uuid, date '2026-04-01', 'Test entry',
  'manual', null, current_setting('t.lines')::jsonb)::text, true);
select is((select sum(debit)::bigint || '/' || sum(credit)::bigint from public.journal_line
            where journal_entry_id = current_setting('t.je')::uuid), '150000/150000',
  'a balanced entry is posted with its lines');

select throws_like(format('select private.post_journal_impl(%L, %L, %L, %L, null, %L)',
  current_setting('t.a'), '2026-04-01', 'Lopsided', 'manual', jsonb_build_array(
    jsonb_build_object('account_id', pg_temp.acct('t.a', 'cash'), 'debit', 100),
    jsonb_build_object('account_id', pg_temp.acct('t.a', 'maintenance_income'), 'credit', 90))),
  'unbalanced_entry%', 'an entry whose debits and credits differ is refused');
select throws_like(format('select private.post_journal_impl(%L, %L, %L, %L, null, %L)',
  current_setting('t.a'), '2026-04-01', 'One line', 'manual', jsonb_build_array(
    jsonb_build_object('account_id', pg_temp.acct('t.a', 'cash'), 'debit', 0))),
  'invalid_entry%', 'an entry needs at least two lines with amounts');
select throws_like(format('select private.post_journal_impl(%L, %L, %L, %L, null, %L)',
  current_setting('t.a'), '2026-04-01', 'No flat', 'manual', jsonb_build_array(
    jsonb_build_object('account_id', pg_temp.acct('t.a', 'member_receivables'), 'debit', 100),
    jsonb_build_object('account_id', pg_temp.acct('t.a', 'maintenance_income'), 'credit', 100))),
  'invalid_entry%flat%', 'a member receivable line must name the flat');
select throws_ok(format('select private.post_journal_impl(%L, %L, %L, %L, null, %L)',
  current_setting('t.a'), '2026-04-01', 'Cross society', 'manual', jsonb_build_array(
    jsonb_build_object('account_id', pg_temp.acct('t.b', 'cash'), 'debit', 100),
    jsonb_build_object('account_id', pg_temp.acct('t.a', 'maintenance_income'), 'credit', 100))),
  '23503', null, 'an entry cannot use another society''s account');

-- The balance check also holds for direct inserts (a deferred constraint trigger).
set constraints all immediate;
select throws_like(format($q$
  with e as (insert into public.journal_entry (society_id, entry_date, narration, source_type)
             values (%L, '2026-04-02', 'Raw', 'manual') returning id)
  insert into public.journal_line (society_id, journal_entry_id, ledger_account_id, debit, credit)
  select %L, e.id, %L, 500, 0 from e$q$,
  current_setting('t.a'), current_setting('t.a'), pg_temp.acct('t.a', 'cash')),
  'unbalanced_entry%', 'the database refuses an unbalanced entry even without the function');
set constraints all deferred;

select throws_ok(format('insert into public.journal_line (society_id, journal_entry_id, ledger_account_id, debit, credit) values (%L, %L, %L, 5, 5)',
  current_setting('t.a'), current_setting('t.je'), pg_temp.acct('t.a', 'cash')),
  '23514', null, 'a line is either a debit or a credit');

-- ---- immutability and the period lock --------------------------------------------------
select throws_like(format('update public.journal_line set debit = 1 where journal_entry_id = %L', current_setting('t.je')),
  'immutable%', 'journal lines never change');
select throws_like(format('delete from public.journal_entry where id = %L', current_setting('t.je')),
  'immutable%', 'journal entries are never deleted');
update public.society set locked_until = date '2026-06-30' where id = current_setting('t.a')::uuid;
select throws_like(format('select private.post_journal_impl(%L, %L, %L, %L, null, %L)',
  current_setting('t.a'), '2026-06-30', 'Locked', 'manual', current_setting('t.lines')),
  'period_locked%', 'nothing is posted on or before locked_until');
update public.society set locked_until = null where id = current_setting('t.a')::uuid;

-- ---- who can write and who sees what -----------------------------------------------------
select pg_temp.as_user('treasurer.a@society.test');
select throws_ok(format('insert into public.journal_entry (society_id, entry_date, narration, source_type) values (%L, %L, %L, %L)',
  current_setting('t.a'), '2026-04-03', 'Sneaky', 'manual'),
  '42501', null, 'nobody writes journal entries directly, not even the treasurer');
select throws_ok('select private.post_journal_impl(null, null, null, null, null, null)',
  '42501', null, 'signed-in users cannot call the internal posting function');
select lives_ok(format('insert into public.ledger_account (society_id, code, name, type) values (%L, %L, %L, %L)',
  current_setting('t.a'), '5150', 'Lift maintenance', 'expense'), 'the treasurer (accounts.manage) can add an account');
select is((select count(*)::int from public.journal_line where society_id = current_setting('t.a')::uuid), 2,
  'the treasurer (accounts.view) sees every journal line');
update public.ledger_account set name = 'Renamed' where system_key = 'cash' and society_id = current_setting('t.a')::uuid;
select is((select name from public.ledger_account where system_key = 'cash' and society_id = current_setting('t.a')::uuid), 'Cash',
  'system accounts cannot be renamed');

reset role;
select pg_temp.as_user('member.a@society.test');
select is((select count(*)::int from public.journal_line), 1, 'an owner sees only their own flat''s ledger lines');
select throws_ok(format('insert into public.ledger_account (society_id, code, name, type) values (%L, %L, %L, %L)',
  current_setting('t.a'), '5160', 'Rogue', 'expense'), '42501', null, 'a member cannot add an account');

reset role;
select pg_temp.as_user('tenant.a@society.test');
select is((select count(*)::int from public.journal_line) + (select count(*)::int from public.journal_entry), 0,
  'a tenant without can_view_bills sees no ledger data');

reset role;
select pg_temp.as_user('chair.b@society.test');
select is((select count(*)::int from public.journal_line where society_id = current_setting('t.a')::uuid)
        + (select count(*)::int from public.journal_entry where society_id = current_setting('t.a')::uuid), 0,
  'Society B sees no Society A journal data');
select throws_ok(format('insert into public.ledger_account (society_id, code, name, type) values (%L, %L, %L, %L)',
  current_setting('t.a'), '5170', 'Spy', 'expense'), '42501', null, 'Society B cannot add accounts to Society A');

select * from finish();
rollback;
