-- Smoke test: proves the pgTAP pipeline runs. Real RLS and RPC tests start in M1.
begin;
create extension if not exists pgtap with schema extensions;

select plan(2);

select has_schema('public', 'public schema exists');

-- Guard that will matter from M1 on: every table in public has RLS enabled.
select is(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relrowsecurity),
  0,
  'every table in public has row level security enabled'
);

select * from finish();
rollback;
