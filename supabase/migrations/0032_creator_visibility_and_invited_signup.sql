-- 0032: Content Creators see all content, and invited people join the team when they sign up.
--  * The built-in "Content Creator" role gets content.view_all, so creators see the whole Backlog, Production board
--    and Calendar of their workspace. Editing is unchanged: production_can_edit still only lets them edit cards they
--    are assigned to (or created unassigned), because the role does not get content.edit_any.
--    Applies to new workspaces (seed_workspace_roles) and to the existing system Content Creator role everywhere.
--  * Sign-up: when a pending invitation exists for the new account's email, the account joins the invited workspace
--    with the invited role (and the invitation is marked accepted) instead of getting an empty personal workspace.
--    Invitations are only claimed once the email is confirmed (at sign-up when confirmation is off, otherwise when
--    the confirmation link is used). If nothing could be claimed by then, the personal workspace is created as before.

begin;

-- ---------------------------------------------------------------------------
-- 1. Content Creator can see all content
-- ---------------------------------------------------------------------------
create or replace function seed_workspace_roles(ws uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  -- System roles are created by the platform, not by a member, so role_guard skips its member checks here.
  perform set_config('app.seeding_roles', 'on', true);
  insert into workspace_roles (workspace_id, key, name, description, base_role, permissions, is_system) values
    (ws, 'admin', 'Admin', 'Full access to the workspace, settings, team, permissions and all content.', 'admin', team_all_permissions(), true),
    (ws, 'marketing_manager', 'Marketing Manager', 'Manages ideas, briefs, assignments, the editorial calendar and approvals.', 'editor',
      array['projects.manage','ai_usage.view','strategy.view','strategy.edit','intelligence.view','intelligence.edit','seo.view','seo.edit',
        'opportunities.view','opportunities.edit','calendar.view','calendar.edit','content.view_all','content.create','content.edit_any',
        'content.assign','content.review','content.approve','content.delete','content.export'], true),
    (ws, 'content_creator', 'Content Creator', 'Sees the backlog, production board and calendar; writes captions and scripts on assigned ideas and briefs, then submits them for review.', 'editor',
      array['strategy.view','opportunities.view','calendar.view','content.view_all'], true),
    (ws, 'designer', 'Designer', 'Works on assigned briefs, uploads designs and submits deliverables.', 'editor',
      array['strategy.view'], true),
    (ws, 'video_editor', 'Video Editor', 'Works on assigned video briefs, scripts and assets, then uploads finished videos.', 'editor',
      array['strategy.view'], true),
    (ws, 'seo_specialist', 'SEO Specialist', 'Works on assigned SEO tasks with keyword and SERP research.', 'editor',
      array['strategy.view','seo.view','seo.edit','opportunities.view'], true),
    (ws, 'editor', 'Editor', 'Previous "editor" role: edits content and modules, cannot manage the team or give final approval.', 'editor',
      legacy_role_permissions('editor'), true),
    (ws, 'viewer', 'Viewer', 'Read-only access to every module.', 'viewer', legacy_role_permissions('viewer'), true)
  on conflict (workspace_id, key) do nothing;
  perform set_config('app.seeding_roles', 'off', true);
end $$;

update workspace_roles
   set permissions = permissions || array['content.view_all']::text[],
       description = 'Sees the backlog, production board and calendar; writes captions and scripts on assigned ideas and briefs, then submits them for review.'
 where key = 'content_creator' and is_system and not ('content.view_all' = any(permissions));

-- ---------------------------------------------------------------------------
-- 2. Sign-up claims pending invitations
-- ---------------------------------------------------------------------------
-- Joins every pending invitation sent to this user's email. Called only from the auth.users triggers below.
create or replace function claim_pending_invitations(p_user uuid, p_email text) returns integer
language plpgsql security definer set search_path = public as $$
declare i workspace_invitations; n integer := 0; mail text := lower(trim(p_email));
begin
  if p_user is null or mail is null or mail = '' then return 0; end if;
  for i in
    select * from workspace_invitations
     where email = mail and accepted_at is null and revoked_at is null and expires_at > now()
     order by created_at
     for update
  loop
    insert into workspace_members (workspace_id, user_id, role, role_id)
      values (i.workspace_id, p_user, (select base_role from workspace_roles where id = i.role_id), i.role_id)
      on conflict (workspace_id, user_id) do nothing;
    update workspace_invitations set accepted_at = now(), accepted_by = p_user where id = i.id;
    insert into workspace_audit_log (workspace_id, actor_id, action, target_user, details)
      values (i.workspace_id, p_user, 'invitation.accepted', p_user, jsonb_build_object('email', i.email, 'via', 'signup'));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function claim_pending_invitations(uuid, text) from public, anon, authenticated;

create or replace function has_pending_invitation(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from workspace_invitations
                  where email = lower(trim(p_email)) and accepted_at is null and revoked_at is null and expires_at > now());
$$;
revoke all on function has_pending_invitation(text) from public, anon, authenticated;

create or replace function create_personal_workspace(u auth.users) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into workspaces (name, created_by)
    values (coalesce(nullif(u.raw_user_meta_data->>'workspace_name', ''), 'My workspace'), u.id);  -- owner membership via on_workspace_created
end $$;
revoke all on function create_personal_workspace(auth.users) from public, anon, authenticated;

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''));
  if has_pending_invitation(new.email) then
    -- Invited: join the team instead of getting an empty workspace. Wait for a confirmed email before joining.
    if new.email_confirmed_at is not null then
      perform claim_pending_invitations(new.id, new.email);
      if not exists (select 1 from workspace_members where user_id = new.id) then perform create_personal_workspace(new); end if;
    end if;
  else
    perform create_personal_workspace(new);
  end if;
  return new;
end $$;

-- Email confirmed later (confirmation link): claim the invitation, or fall back to a personal workspace.
create or replace function handle_user_email_confirmed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    perform claim_pending_invitations(new.id, new.email);
    if not exists (select 1 from workspace_members where user_id = new.id) then perform create_personal_workspace(new); end if;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_email_confirmed on auth.users;
create trigger on_auth_user_email_confirmed after update of email_confirmed_at on auth.users
  for each row execute function handle_user_email_confirmed();

commit;
