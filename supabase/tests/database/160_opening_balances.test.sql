-- post_opening_balances: a one-time, all-or-nothing opening entry of per-flat
-- arrears and advances plus account balances, with a per-row error report and a
-- dry run. The result shows on each flat's ledger (flat_ledger).
begin;
create extension if not exists pgtap with schema extensions;

select plan(21);

create function pg_temp.as_user(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = p_email), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

select set_config('t.a', (select id::text from public.society where name = 'Green Park CHS'), true);
select set_config('t.b', (select id::text from public.society where name = 'Blue Ridge CHS'), true);

create function pg_temp.post(p_flats text, p_accounts text, p_dry boolean default false, p_date date default date '2026-03-31')
returns jsonb language sql as $$
  select public.post_opening_balances(current_setting('t.a')::uuid, p_date, p_flats::jsonb, p_accounts::jsonb, p_dry);
$$;

-- ---- a file with problems ---------------------------------------------------------------
select pg_temp.as_user('treasurer.a@society.test');
select set_config('t.r', pg_temp.post(
  $$[{"row": 2, "wing": "A", "flat_number": "101", "arrears": 1200000},
     {"row": 3, "wing": "A", "flat_number": "999", "arrears": 100},
     {"row": 4, "wing": "A", "flat_number": "102", "arrears": -5},
     {"row": 5, "wing": "A", "flat_number": "201", "arrears": 100, "advance": 100},
     {"row": 6, "wing": "A", "flat_number": "101", "advance": 500},
     {"row": 7, "wing": "A", "flat_number": "202", "arrears": 12.5}]$$,
  $$[{"row": 2, "code": "1020", "debit": 5000000},
     {"row": 3, "code": "9999", "credit": 100},
     {"row": 4, "code": "1100", "credit": 100},
     {"row": 5, "code": "3100", "debit": 10, "credit": 10}]$$)::text, true);

select is((current_setting('t.r')::jsonb ->> 'ok')::boolean, false, 'a file with problems is not posted');
select ok((current_setting('t.r')::jsonb -> 'errors') @> '[{"sheet": "flats", "row": 3, "field": "flat_number"}]', 'an unknown flat is reported');
select ok((current_setting('t.r')::jsonb -> 'errors') @> '[{"sheet": "flats", "row": 4, "field": "arrears"}]', 'a negative amount is reported');
select ok((current_setting('t.r')::jsonb -> 'errors') @> '[{"sheet": "flats", "row": 5, "field": "advance"}]', 'arrears and advance on one flat are reported');
select ok((current_setting('t.r')::jsonb -> 'errors') @> '[{"sheet": "flats", "row": 6, "field": "flat_number"}]', 'a flat listed twice is reported');
select ok((current_setting('t.r')::jsonb -> 'errors') @> '[{"sheet": "flats", "row": 7, "field": "arrears"}]', 'fractional paise are reported');
select ok((current_setting('t.r')::jsonb -> 'errors') @> '[{"sheet": "accounts", "row": 3, "field": "code"}]', 'an unknown account code is reported');
select ok((current_setting('t.r')::jsonb -> 'errors') @> '[{"sheet": "accounts", "row": 4, "field": "code"}]',
  'member receivables cannot be entered as an account balance');
select ok((current_setting('t.r')::jsonb -> 'errors') @> '[{"sheet": "accounts", "row": 5, "field": "debit"}]', 'a debit and credit on one row are reported');
select is((select count(*)::int from public.journal_entry where society_id = current_setting('t.a')::uuid), 0, 'nothing is written');

-- ---- an unbalanced file ------------------------------------------------------------------
select set_config('t.u', pg_temp.post($$[{"row": 2, "wing": "A", "flat_number": "101", "arrears": 1000}]$$,
  $$[{"row": 2, "code": "3900", "credit": 900}]$$)::text, true);
select ok((current_setting('t.u')::jsonb -> 'errors') @> '[{"sheet": "file", "row": 0, "field": "total"}]',
  'totals that do not balance are reported with the difference');

-- ---- a good file: dry run, then post ------------------------------------------------------
select set_config('t.flats', $$[
  {"row": 2, "wing": "A", "flat_number": "101", "arrears": 1250000},
  {"row": 3, "wing": "A", "flat_number": "102", "advance": 300000},
  {"row": 4, "wing": "B", "flat_number": "201", "arrears": "50000"}]$$, true);
select set_config('t.accts', $$[
  {"row": 2, "code": "1020", "debit": 8000000},
  {"row": 3, "code": "1010", "debit": 25000},
  {"row": 4, "code": "3100", "credit": 4000000},
  {"row": 5, "code": "3900", "credit": 5025000}]$$, true);

select set_config('t.dry', pg_temp.post(current_setting('t.flats'), current_setting('t.accts'), true)::text, true);
select is(current_setting('t.dry')::jsonb - 'errors' - 'entry_id',
  '{"ok": true, "flats": 3, "total_debit": 9325000, "total_credit": 9325000}'::jsonb, 'a dry run reports the totals');
select is((select count(*)::int from public.journal_entry where society_id = current_setting('t.a')::uuid), 0, 'a dry run writes nothing');

select set_config('t.real', pg_temp.post(current_setting('t.flats'), current_setting('t.accts'))::text, true);
select is((select source_type || ' ' || entry_date || ' ' || count(l.*)
             from public.journal_entry e join public.journal_line l on l.journal_entry_id = e.id
            where e.id = (current_setting('t.real')::jsonb ->> 'entry_id')::uuid group by e.id),
  'opening 2026-03-31 7', 'one opening entry with a line per flat and account');

select throws_like(format('select public.post_opening_balances(%L, %L, %L, %L)',
  current_setting('t.a'), '2026-03-31', current_setting('t.flats'), current_setting('t.accts')),
  'opening_already_posted%', 'opening balances are posted only once');

-- ---- flat_ledger ------------------------------------------------------------------------
reset role;
select pg_temp.as_user('member.a@society.test');
select is((select array_agg(balance) from public.flat_ledger), array[1250000::bigint],
  'the owner sees only their own flat''s ledger, with the arrears as the balance');
reset role;
select pg_temp.as_user('committee.a@society.test');
select is((select sum(balance)::bigint from public.flat_ledger where society_id = current_setting('t.a')::uuid), 1000000::bigint,
  'the committee sees every flat ledger (arrears minus advances)');

select is((select array_agg(c.column_name::text order by c.column_name) from information_schema.columns c
            where c.table_schema = 'public' and c.table_name = 'flat_ledger' and c.column_name in ('journal_line_id', 'created_at')),
  array['created_at', 'journal_line_id'], 'flat_ledger exposes the line id and time for a stable order');

-- ---- permissions --------------------------------------------------------------------------
reset role;
select pg_temp.as_user('member.a@society.test');
select throws_ok(format('select public.post_opening_balances(%L, %L, %L, %L)', current_setting('t.a'), '2026-03-31', '[]', '[]'),
  '42501', null, 'a member cannot post opening balances');
reset role;
select pg_temp.as_user('treasurer.a@society.test');
select throws_ok(format('select public.post_opening_balances(%L, %L, %L, %L)', current_setting('t.b'), '2026-03-31', '[]', '[]'),
  '42501', null, 'the treasurer of A cannot post opening balances for Society B');
reset role;
update public.society set locked_until = date '2026-03-31' where id = current_setting('t.b')::uuid;
select pg_temp.as_user('chair.b@society.test');
select throws_like(format('select public.post_opening_balances(%L, %L, %L, %L)', current_setting('t.b'), '2026-03-31',
  '[]', '[{"row": 2, "code": "1010", "debit": 100}, {"row": 3, "code": "3900", "credit": 100}]'),
  'period_locked%', 'opening balances cannot be dated inside a locked period');

select * from finish();
rollback;
