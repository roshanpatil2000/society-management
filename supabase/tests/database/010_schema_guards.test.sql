-- Structural guards that every future migration must keep passing.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and not coalesce('security_invoker=true' = any (c.reloptions), false)
      and not coalesce('security_invoker=on' = any (c.reloptions), false)),
  '',
  'every view in public is security_invoker'
);

-- Tenant tables: every public table with a society_id column.
select is(
  (select coalesce(string_agg(t.table_name, ', ' order by t.table_name), '')
     from information_schema.columns t
    where t.table_schema = 'public' and t.column_name = 'society_id'
      and t.table_name not in ('audit_log', 'job_run')
      and t.table_name in (select table_name from information_schema.tables
                            where table_schema = 'public' and table_type = 'BASE TABLE')
      and not exists (
        select 1
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_namespace ns on ns.oid = rel.relnamespace
        where ns.nspname = 'public' and rel.relname = t.table_name and con.contype in ('u', 'p')
          and (select array_agg(a.attname::text order by a.attname)
                 from unnest(con.conkey) k join pg_attribute a on a.attrelid = rel.oid and a.attnum = k)
              = array['id', 'society_id'])),
  '',
  'every tenant table has unique (society_id, id) for composite foreign keys'
);

select is(
  (select coalesce(string_agg(tbl.relname, ', ' order by tbl.relname), '')
     from pg_class tbl join pg_namespace n on n.oid = tbl.relnamespace
    where n.nspname = 'public' and tbl.relkind = 'r'
      and tbl.relname not in ('audit_log', 'job_run', 'permission')
      and not exists (
        select 1 from pg_trigger tg join pg_proc p on p.oid = tg.tgfoid
        where tg.tgrelid = tbl.oid and p.proname = 'audit_row' and not tg.tgisinternal)),
  '',
  'every table in public (except log tables) has the audit trigger'
);

select is(
  (select coalesce(string_agg(t.table_name, ', ' order by t.table_name), '')
     from information_schema.tables t
    where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
      and t.table_name not in ('audit_log', 'job_run', 'permission', 'role_preset', 'platform_admin', 'platform_config')
      and not exists (select 1 from information_schema.columns c
                      where c.table_schema = 'public' and c.table_name = t.table_name
                        and c.column_name = 'deleted_at')),
  '',
  'every business table has deleted_at for soft delete'
);

select is(
  (select coalesce(string_agg(n.nspname || '.' || p.proname, ', ' order by 1), '')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef
      and not coalesce('search_path=""' = any (p.proconfig), false)),
  '',
  'every security definer function sets search_path = '''''
);

select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and has_function_privilege('anon', p.oid, 'execute')),
  'discover_society',
  'anon can execute only discover_society in public (tenant discovery before login)'
);

select * from finish();
rollback;
