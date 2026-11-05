-- One-off data fix (run AFTER migration 0032), for the two Content Creators who saw nothing on 2026-11-05:
-- narjess.ghanmi44@gmail.com and medalijouini125@gmail.com.
--  1. Claim any pending invitation sent to their email (joins the inviting workspace with the invited role,
--     marks the invitation accepted).
--  2. Remove the personal workspace sign-up created for them, only when it is empty (no projects), they created
--     it, they are its only member, and they now belong to another workspace.
-- Safe to run more than once. Prints what it did.
begin;
do $$
declare u record; n int; w record;
begin
  for u in select id, email from auth.users where lower(email) in ('narjess.ghanmi44@gmail.com','medalijouini125@gmail.com') loop
    n := claim_pending_invitations(u.id, u.email);
    raise notice '% : % pending invitation(s) claimed', u.email, n;
    for w in
      select ws.id, ws.name from workspaces ws
       where ws.created_by = u.id
         and not exists (select 1 from projects p where p.workspace_id = ws.id)
         and (select count(*) from workspace_members m where m.workspace_id = ws.id) = 1
         and exists (select 1 from workspace_members m where m.user_id = u.id and m.workspace_id <> ws.id)
    loop
      delete from workspaces where id = w.id;
      raise notice '% : removed empty personal workspace "%" (%)', u.email, w.name, w.id;
    end loop;
  end loop;
end $$;
commit;

-- Verify: every workspace they belong to, with role and project count.
select u.email, w.name, r.name as role, 'content.view_all' = any(r.permissions) as sees_all_content,
       (select count(*) from projects p where p.workspace_id = w.id) as projects
  from workspace_members m join auth.users u on u.id = m.user_id join workspaces w on w.id = m.workspace_id
  left join workspace_roles r on r.id = m.role_id
 where lower(u.email) in ('narjess.ghanmi44@gmail.com','medalijouini125@gmail.com')
 order by u.email, w.name;
