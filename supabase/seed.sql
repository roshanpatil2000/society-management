-- Demo data for local development, loaded by `supabase db reset`. Never run on hosted projects.
--
-- Accounts (log in with email OTP; Mailpit at http://127.0.0.1:54324 shows the code):
--   admin@society.test     super-admin
--   chair.a@society.test   Chairman, Green Park CHS
--   member.a@society.test  Member,   Green Park CHS
--   chair.b@society.test   Chairman, Blue Ridge CHS
--   member.b@society.test  Member,   Blue Ridge CHS
-- Pending invite: invitee.a@society.test (Member, Green Park CHS), so its first login creates the account.

insert into private.platform_admin_email (email) values ('admin@society.test');

do $$
declare
  people constant text[][] := array[
    ['00000000-0000-4000-8000-000000000001', 'admin@society.test', 'Super Admin'],
    ['00000000-0000-4000-8000-0000000000a1', 'chair.a@society.test', 'Asha Kulkarni'],
    ['00000000-0000-4000-8000-0000000000a2', 'member.a@society.test', 'Ravi Deshmukh'],
    ['00000000-0000-4000-8000-0000000000b1', 'chair.b@society.test', 'Meera Iyer'],
    ['00000000-0000-4000-8000-0000000000b2', 'member.b@society.test', 'Karan Shah']
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

  insert into public.membership (society_id, user_id) values
    (society_a, '00000000-0000-4000-8000-0000000000a1'),
    (society_a, '00000000-0000-4000-8000-0000000000a2'),
    (society_b, '00000000-0000-4000-8000-0000000000b1'),
    (society_b, '00000000-0000-4000-8000-0000000000b2');

  insert into public.membership_role (society_id, membership_id, role_id)
  select m.society_id, m.id, r.id
  from public.membership m
  join public.profiles p on p.id = m.user_id
  join public.role r on r.society_id = m.society_id
   and r.name = case when p.email like 'chair.%' then 'Chairman' else 'Member' end;

  insert into public.invite (society_id, email, full_name, role_ids, created_by)
  select society_a, 'invitee.a@society.test', 'Neha Patil', array[r.id], '00000000-0000-4000-8000-0000000000a1'
  from public.role r where r.society_id = society_a and r.name = 'Member';
end;
$$;
