-- Committee presets (Secretary, Treasurer) no longer carry flat-owner (.own) keys.
-- A committee member who owns a flat also holds the Member role, which brings them;
-- on the committee role they only produced an empty "My Bills" tab.
-- Same change as packages/shared/src/role-presets.ts (checked by the sync test).

select set_config('app.actor', 'migration:m3_committee_presets', true);

update public.role_preset
   set permissions = array(select k from unnest(permissions) k where k not like '%.own' order by k),
       updated_at = now()
 where name in ('Secretary', 'Treasurer');

-- Existing societies: take the .own keys off their system Secretary and Treasurer
-- roles, keeping any other edits the committee made.
update public.role
   set permissions = array(select k from unnest(permissions) k where k not like '%.own' order by k)
 where is_system and name in ('Secretary', 'Treasurer') and deleted_at is null
   and exists (select 1 from unnest(permissions) k where k like '%.own');
