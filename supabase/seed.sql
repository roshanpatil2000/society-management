-- Demo data for local development, loaded by `supabase db reset`. Never run on hosted projects.
--
-- Accounts (log in with email OTP; Mailpit at http://127.0.0.1:54324 shows the code).
-- Green Park CHS has one user per role preset:
--   admin@society.test       super-admin
--   chair.a@society.test     Chairman          secretary.a@society.test  Secretary
--   treasurer.a@society.test Treasurer         committee.a@society.test  Committee member
--   member.a@society.test    Member            tenant.a@society.test     Tenant
--   staff.a@society.test     Staff             auditor.a@society.test    Auditor
-- Blue Ridge CHS: chair.b@society.test (Chairman), member.b@society.test (Member)
-- Pending invite: invitee.a@society.test (Member, Green Park CHS), so its first login creates the account.

insert into private.platform_admin_email (email) values ('admin@society.test');

do $$
declare
  people constant text[][] := array[
    -- id, email, full name, society, role
    ['00000000-0000-4000-8000-000000000001', 'admin@society.test', 'Super Admin', '', ''],
    ['00000000-0000-4000-8000-0000000000a1', 'chair.a@society.test', 'Asha Kulkarni', 'A', 'Chairman'],
    ['00000000-0000-4000-8000-0000000000a2', 'member.a@society.test', 'Ravi Deshmukh', 'A', 'Member'],
    ['00000000-0000-4000-8000-0000000000a3', 'secretary.a@society.test', 'Sunil Pawar', 'A', 'Secretary'],
    ['00000000-0000-4000-8000-0000000000a4', 'treasurer.a@society.test', 'Priya Nair', 'A', 'Treasurer'],
    ['00000000-0000-4000-8000-0000000000a5', 'committee.a@society.test', 'Imran Shaikh', 'A', 'Committee member'],
    ['00000000-0000-4000-8000-0000000000a6', 'tenant.a@society.test', 'Divya Rao', 'A', 'Tenant'],
    ['00000000-0000-4000-8000-0000000000a7', 'staff.a@society.test', 'Ganesh More', 'A', 'Staff'],
    ['00000000-0000-4000-8000-0000000000a8', 'auditor.a@society.test', 'CA Mehta', 'A', 'Auditor'],
    ['00000000-0000-4000-8000-0000000000b1', 'chair.b@society.test', 'Meera Iyer', 'B', 'Chairman'],
    ['00000000-0000-4000-8000-0000000000b2', 'member.b@society.test', 'Karan Shah', 'B', 'Member']
  ];
  i int;
  uid uuid;
  society_a uuid;
  society_b uuid;
begin
  for i in 1 .. array_length(people, 1) loop
    uid := people[i][1]::uuid;
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', people[i][2], '', now(),
      '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', people[i][3]), now(), now(),
      '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid, uid::text, 'email',
            jsonb_build_object('sub', uid::text, 'email', people[i][2], 'email_verified', true), now(), now(), now());
  end loop;

  perform set_config('app.actor', 'seed', true);

  society_a := private.create_society_impl('{"name": "Green Park CHS", "registration_no": "MUM/W-K/HSG/TC/1001", "address": "Andheri West, Mumbai"}');
  society_b := private.create_society_impl('{"name": "Blue Ridge CHS", "registration_no": "PUN/HSG/2002", "address": "Hinjewadi, Pune"}');
  update public.society set status = 'active' where id in (society_a, society_b);

  for i in 1 .. array_length(people, 1) loop
    continue when people[i][4] = '';
    insert into public.membership (society_id, user_id)
    values (case people[i][4] when 'A' then society_a else society_b end, people[i][1]::uuid);
    insert into public.membership_role (society_id, membership_id, role_id)
    select m.society_id, m.id, r.id
    from public.membership m
    join public.role r on r.society_id = m.society_id and r.name = people[i][5]
    where m.user_id = people[i][1]::uuid
      and m.society_id = case people[i][4] when 'A' then society_a else society_b end;
  end loop;

  insert into public.invite (society_id, email, full_name, role_ids, created_by)
  select society_a, 'invitee.a@society.test', 'Neha Patil', array[r.id], '00000000-0000-4000-8000-0000000000a1'
  from public.role r where r.society_id = society_a and r.name = 'Member';
end;
$$;
