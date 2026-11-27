-- import_flats: all-or-nothing import of wings, flats and owner invites, with a
-- per-row error report and a dry-run mode. Runs with the caller's permissions.
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

create function pg_temp.as_user(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = p_email), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

select set_config('t.a', (select id::text from public.society where name = 'Green Park CHS'), true);
select set_config('t.b', (select id::text from public.society where name = 'Blue Ridge CHS'), true);
select set_config('t.flats_before', (select count(*)::text from public.flat where society_id = current_setting('t.a')::uuid and deleted_at is null), true);

-- A file with five problems and one good row.
select set_config('t.bad', $$[
  {"row": 2, "wing": "D", "flat_number": "1", "area_sqft": 600},
  {"row": 3, "wing": "", "flat_number": "2", "area_sqft": 600},
  {"row": 4, "wing": "D", "flat_number": "3", "area_sqft": -5},
  {"row": 5, "wing": "D", "flat_number": "1", "area_sqft": 600},
  {"row": 6, "wing": "A", "flat_number": "101", "area_sqft": 650},
  {"row": 7, "wing": "D", "flat_number": "4", "area_sqft": 600, "owner_email": "not-an-email"}
]$$, true);

select pg_temp.as_user('secretary.a@society.test');
select set_config('t.r', public.import_flats(current_setting('t.a')::uuid, current_setting('t.bad')::jsonb)::text, true);

select is((current_setting('t.r')::jsonb ->> 'ok')::boolean, false, 'a file with problems is not imported');
select is(
  (select array_agg((e ->> 'row')::int order by (e ->> 'row')::int) from jsonb_array_elements(current_setting('t.r')::jsonb -> 'errors') e),
  array[3, 4, 5, 6, 7], 'every bad row is reported by its spreadsheet row number');
select ok((current_setting('t.r')::jsonb -> 'errors') @> '[{"row": 3, "field": "wing"}]', 'a missing wing is reported on its field');
select ok((current_setting('t.r')::jsonb -> 'errors') @> '[{"row": 5, "field": "flat_number"}]', 'a flat repeated in the file is reported');
select ok((current_setting('t.r')::jsonb -> 'errors') @> '[{"row": 6, "field": "flat_number"}]', 'a flat that already exists is reported');
select ok((current_setting('t.r')::jsonb -> 'errors') @> '[{"row": 7, "field": "owner_email"}]', 'a bad owner email is reported');
select is((select count(*)::text from public.flat where society_id = current_setting('t.a')::uuid and deleted_at is null),
  current_setting('t.flats_before'), 'nothing is written when any row is bad');

-- A good file: dry run first, then the real import.
select set_config('t.good', $$[
  {"row": 2, "wing": "D", "flat_number": "1", "floor": 0, "area_sqft": 600, "flat_type": "2BHK", "owner_email": "owner.d1@society.test", "owner_name": "D One"},
  {"row": 3, "wing": "D", "flat_number": "2", "floor": 0, "area_sqft": 610.5},
  {"row": 4, "wing": "A", "flat_number": "301", "floor": 3, "area_sqft": 900}
]$$, true);
select set_config('t.dry', public.import_flats(current_setting('t.a')::uuid, current_setting('t.good')::jsonb, true)::text, true);
select is((current_setting('t.dry')::jsonb ->> 'ok')::boolean, true, 'a dry run of a good file passes');
select is((select count(*)::text from public.flat where society_id = current_setting('t.a')::uuid and deleted_at is null),
  current_setting('t.flats_before'), 'a dry run writes nothing');

select set_config('t.real', public.import_flats(current_setting('t.a')::uuid, current_setting('t.good')::jsonb)::text, true);
select is(current_setting('t.real')::jsonb - 'errors',
  '{"ok": true, "wings_created": 1, "flats_created": 3, "invites_created": 1}'::jsonb,
  'the import creates the new wing, the flats and the owner invite');
select is((select area_sqft from public.flat f join public.wing w on w.id = f.wing_id
            where w.society_id = current_setting('t.a')::uuid and w.name = 'D' and f.number = '2'), 610.50::numeric,
  'flat details are stored');
select is((select i.occupant_type || ':' || f.number from public.invite i join public.flat f on f.id = i.flat_id
            where i.email = 'owner.d1@society.test'), 'owner:1', 'the owner invite names the flat');

-- Limits and permissions.
reset role;
update public.society set quotas = quotas || '{"max_flats": 1}' where id = current_setting('t.a')::uuid;
select pg_temp.as_user('secretary.a@society.test');
select ok(not (public.import_flats(current_setting('t.a')::uuid,
  '[{"row": 2, "wing": "D", "flat_number": "9", "area_sqft": 500}]')::jsonb ->> 'ok')::boolean,
  'an import past the max_flats quota is refused');
reset role;
update public.society set quotas = quotas || '{"max_flats": 300}' where id = current_setting('t.a')::uuid;

select pg_temp.as_user('member.a@society.test');
select throws_ok(format('select public.import_flats(%L, %L)', current_setting('t.a'), current_setting('t.good')),
  '42501', null, 'a member cannot import flats');
reset role;
select pg_temp.as_user('secretary.a@society.test');
select throws_ok(format('select public.import_flats(%L, %L)', current_setting('t.b'), current_setting('t.good')),
  '42501', null, 'the secretary of A cannot import into Society B');
select throws_ok(format('select public.import_flats(%L, %L)', current_setting('t.a'),
  (select jsonb_agg(jsonb_build_object('row', g + 1, 'wing', 'E', 'flat_number', g::text, 'area_sqft', 500)) from generate_series(1, 2001) g)),
  '22023', null, 'files over 2000 rows are refused');

select * from finish();
rollback;
