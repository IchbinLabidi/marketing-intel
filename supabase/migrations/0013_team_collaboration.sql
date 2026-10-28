-- Team collaboration & role-based access control. Additive: no table, column or row is dropped.
-- Existing members keep exactly the access they have today: owners/admins map to "Admin", editors to "Editor",
-- viewers to "Viewer" (system roles that reproduce the previous fixed roles). New roles narrow access further.
begin;

-- ---------------------------------------------------------------------------
-- 1. Permission catalogue and roles
-- ---------------------------------------------------------------------------
create or replace function team_all_permissions() returns text[] language sql immutable as $$
  select array[
    'team.manage','roles.manage','settings.manage','projects.manage','ai_usage.view',
    'strategy.view','strategy.edit','intelligence.view','intelligence.edit','seo.view','seo.edit',
    'opportunities.view','opportunities.edit','calendar.view','calendar.edit',
    'content.view_all','content.create','content.edit_any','content.assign','content.review',
    'content.approve','content.approve_own','content.delete','content.export'
  ]::text[];
$$;

-- What the previous fixed roles could do, expressed as permissions (used for members without a role row).
create or replace function legacy_role_permissions(r workspace_role) returns text[] language sql immutable as $$
  select case r
    when 'owner' then team_all_permissions()
    when 'admin' then team_all_permissions()
    when 'editor' then array[
      'projects.manage','ai_usage.view','strategy.view','strategy.edit','intelligence.view','intelligence.edit',
      'seo.view','seo.edit','opportunities.view','opportunities.edit','calendar.view','calendar.edit',
      'content.view_all','content.create','content.assign','content.review','content.approve_own','content.delete','content.export']::text[]
    else array['ai_usage.view','strategy.view','intelligence.view','seo.view','opportunities.view','calendar.view','content.view_all']::text[]
  end;
$$;

create table workspace_roles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]{2,40}$'),
  name text not null check (char_length(name) between 1 and 60),
  description text not null default '' check (char_length(description) <= 300),
  -- Coarse role kept in sync on workspace_members.role, so every existing policy keeps working.
  base_role workspace_role not null default 'editor' check (base_role <> 'owner'),
  permissions text[] not null default '{}',
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, key),
  check (permissions <@ team_all_permissions())
);
create trigger workspace_roles_updated before update on workspace_roles for each row execute function set_updated_at();

alter table workspace_members add column role_id uuid references workspace_roles(id) on delete set null;
create index on workspace_members (role_id);

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
    (ws, 'content_creator', 'Content Creator', 'Writes captions and scripts on assigned ideas and briefs, then submits them for review.', 'editor',
      array['strategy.view','opportunities.view','calendar.view'], true),
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

-- Existing workspaces get the system roles; existing members are mapped to the role matching their access.
select seed_workspace_roles(id) from workspaces;
update workspace_members m set role_id = r.id from workspace_roles r
where r.workspace_id = m.workspace_id and m.role_id is null
  and r.key = case m.role when 'owner' then 'admin' when 'admin' then 'admin' when 'editor' then 'editor' else 'viewer' end;

-- New workspaces: roles are seeded before the owner membership trigger (triggers fire in name order).
create or replace function seed_roles_on_workspace() returns trigger language plpgsql security definer set search_path = public as $$
begin perform seed_workspace_roles(new.id); return new; end $$;
create trigger a_seed_workspace_roles after insert on workspaces for each row execute function seed_roles_on_workspace();

create or replace function my_permissions(ws uuid) returns text[] language sql stable security definer set search_path = public as $$
  select coalesce((
    select case when m.role = 'owner' then team_all_permissions()
                when r.id is not null then r.permissions
                else legacy_role_permissions(m.role) end
    from workspace_members m left join workspace_roles r on r.id = m.role_id and r.workspace_id = m.workspace_id
    where m.workspace_id = ws and m.user_id = auth.uid()), '{}'::text[]);
$$;

create or replace function has_permission(ws uuid, perm text) returns boolean language sql stable security definer set search_path = public as $$
  select perm = any(my_permissions(ws));
$$;

-- ---------------------------------------------------------------------------
-- 2. Audit trail for team administration
-- ---------------------------------------------------------------------------
create table workspace_audit_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_user uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on workspace_audit_log (workspace_id, created_at desc);
alter table workspace_audit_log enable row level security;
create policy "audit: team managers read" on workspace_audit_log for select using (has_permission(workspace_id, 'team.manage'));

create or replace function team_audit(ws uuid, p_action text, p_target uuid, p_details jsonb) returns void
language sql security definer set search_path = public as $$
  insert into workspace_audit_log (workspace_id, actor_id, action, target_user, details) values (ws, auth.uid(), p_action, p_target, coalesce(p_details, '{}'));
$$;

-- ---------------------------------------------------------------------------
-- 3. Membership guard: role_id drives the coarse role; owners and escalation are protected
-- ---------------------------------------------------------------------------
create or replace function member_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare r workspace_roles;
begin
  if new.role_id is null then
    select * into r from workspace_roles where workspace_id = new.workspace_id
      and key = case new.role when 'owner' then 'admin' when 'admin' then 'admin' when 'editor' then 'editor' else 'viewer' end;
    new.role_id := r.id;
  else
    select * into r from workspace_roles where id = new.role_id;
    if r.id is null or r.workspace_id <> new.workspace_id then raise exception 'Role belongs to another workspace'; end if;
  end if;
  if tg_op = 'UPDATE' and old.role = 'owner' and auth.uid() is not null and old.user_id <> auth.uid()
     and not has_workspace_role(new.workspace_id, array['owner']::workspace_role[]) then
    raise exception 'The workspace owner cannot be changed' using errcode = '42501';
  end if;
  if new.role = 'owner' and (tg_op = 'INSERT' or old.role <> 'owner') and auth.uid() is not null
     and not has_workspace_role(new.workspace_id, array['owner']::workspace_role[])
     and not exists (select 1 from workspaces w where w.id = new.workspace_id and w.created_by = new.user_id and new.user_id = auth.uid()) then
    raise exception 'Only the owner can transfer ownership' using errcode = '42501';
  end if;
  -- The owner keeps "owner"; everyone else follows their role's coarse level.
  if new.role <> 'owner' and r.id is not null then new.role := r.base_role; end if;
  return new;
end $$;
create trigger member_guard before insert or update on workspace_members for each row execute function member_guard();

create or replace function role_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.seeding_roles', true), 'off') = 'on' then return new; end if;
  if tg_op = 'DELETE' then
    -- Workspace deletion cascades to its roles.
    if not exists (select 1 from workspaces where id = old.workspace_id) then return old; end if;
    if old.is_system then raise exception 'System roles cannot be deleted' using errcode = '42501'; end if;
    if exists (select 1 from workspace_members where role_id = old.id) then raise exception 'Reassign the members of this role before deleting it'; end if;
    perform team_audit(old.workspace_id, 'role.deleted', null, jsonb_build_object('role', old.name));
    return old;
  end if;
  if auth.uid() is not null then
    if not has_permission(new.workspace_id, 'roles.manage') then raise exception 'Not allowed to manage roles' using errcode = '42501'; end if;
    -- Nobody can grant permissions they don't hold themselves (owners hold all).
    if not (new.permissions <@ my_permissions(new.workspace_id)) then raise exception 'You cannot grant permissions you do not have' using errcode = '42501'; end if;
    if tg_op = 'UPDATE' and old.key = 'admin' and old.is_system then raise exception 'The Admin role cannot be edited' using errcode = '42501'; end if;
  end if;
  if tg_op = 'UPDATE' then
    if new.workspace_id <> old.workspace_id or new.key <> old.key or new.is_system <> old.is_system then raise exception 'Role identity cannot change'; end if;
  else
    if auth.uid() is not null then new.is_system := false; end if;
  end if;
  if new.base_role = 'admin' and not ('team.manage' = any(new.permissions)) then new.base_role := 'editor'; end if;
  if new.base_role = 'viewer' and new.permissions && array['strategy.edit','intelligence.edit','seo.edit','opportunities.edit','calendar.edit','content.create','content.edit_any','content.assign','content.review','content.approve','content.delete','projects.manage']::text[] then
    new.base_role := 'editor';
  end if;
  perform team_audit(new.workspace_id, case when tg_op = 'INSERT' then 'role.created' else 'role.updated' end, null,
    jsonb_build_object('role', new.name, 'permissions', new.permissions));
  return new;
end $$;
create trigger role_guard before insert or update or delete on workspace_roles for each row execute function role_guard();

-- Changing a role's coarse level re-syncs its members.
create or replace function role_sync_members() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.base_role is distinct from old.base_role then
    update workspace_members set role = new.base_role where role_id = new.id and role <> 'owner';
  end if;
  return new;
end $$;
create trigger role_sync_members after update on workspace_roles for each row execute function role_sync_members();

alter table workspace_roles enable row level security;
create policy "roles: members read" on workspace_roles for select using (is_workspace_member(workspace_id));
create policy "roles: managers insert" on workspace_roles for insert with check (has_permission(workspace_id, 'roles.manage'));
create policy "roles: managers update" on workspace_roles for update using (has_permission(workspace_id, 'roles.manage'));
create policy "roles: managers delete" on workspace_roles for delete using (has_permission(workspace_id, 'roles.manage'));

-- Member administration goes through these checked functions (direct writes stay limited to owners/admins).
create or replace function set_member_role(p_workspace uuid, p_user uuid, p_role uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m workspace_members; r workspace_roles; current_perms text[];
begin
  if not has_permission(p_workspace, 'team.manage') then raise exception 'Not allowed to manage the team' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'You cannot change your own role' using errcode = '42501'; end if;
  select * into m from workspace_members where workspace_id = p_workspace and user_id = p_user for update;
  if m.user_id is null then raise exception 'Member not found'; end if;
  if m.role = 'owner' then raise exception 'The owner''s role cannot be changed' using errcode = '42501'; end if;
  select * into r from workspace_roles where id = p_role and workspace_id = p_workspace;
  if r.id is null then raise exception 'Role not found'; end if;
  current_perms := coalesce((select permissions from workspace_roles where id = m.role_id), legacy_role_permissions(m.role));
  if not (r.permissions <@ my_permissions(p_workspace)) or not (current_perms <@ my_permissions(p_workspace)) then
    raise exception 'You cannot manage a member or grant a role with more access than your own' using errcode = '42501';
  end if;
  update workspace_members set role_id = r.id where workspace_id = p_workspace and user_id = p_user;
  perform team_audit(p_workspace, 'member.role_changed', p_user, jsonb_build_object('role', r.name));
end $$;

create or replace function remove_member(p_workspace uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m workspace_members;
begin
  select * into m from workspace_members where workspace_id = p_workspace and user_id = p_user for update;
  if m.user_id is null then raise exception 'Member not found'; end if;
  if m.role = 'owner' then raise exception 'The owner cannot be removed' using errcode = '42501'; end if;
  if p_user <> auth.uid() then
    if not has_permission(p_workspace, 'team.manage') then raise exception 'Not allowed to manage the team' using errcode = '42501'; end if;
    if not (coalesce((select permissions from workspace_roles where id = m.role_id), legacy_role_permissions(m.role)) <@ my_permissions(p_workspace)) then
      raise exception 'You cannot remove a member with more access than your own' using errcode = '42501';
    end if;
  end if;
  -- Open tasks return to the backlog; history keeps the person's name through actor ids.
  update content_assignments set status = 'backlog' where user_id = p_user and status not in ('approved','completed')
    and project_id in (select id from projects where workspace_id = p_workspace);
  update content_items set assignee_id = null where assignee_id = p_user and project_id in (select id from projects where workspace_id = p_workspace);
  delete from workspace_members where workspace_id = p_workspace and user_id = p_user;
  perform team_audit(p_workspace, case when p_user = auth.uid() then 'member.left' else 'member.removed' end, p_user, '{}');
end $$;

-- Directory with emails, readable by members (emails only for team managers).
create or replace function workspace_directory(p_workspace uuid)
returns table (user_id uuid, full_name text, email text, role workspace_role, role_id uuid, joined_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.user_id, coalesce(p.full_name, ''),
    case when has_permission(p_workspace, 'team.manage') or m.user_id = auth.uid() then u.email::text else null end,
    m.role, m.role_id, m.created_at
  from workspace_members m
  left join profiles p on p.id = m.user_id
  left join auth.users u on u.id = m.user_id
  where m.workspace_id = p_workspace and is_workspace_member(p_workspace)
  order by m.created_at;
$$;

-- ---------------------------------------------------------------------------
-- 4. Invitations (single-use links; only a SHA-256 hash of the token is stored)
-- ---------------------------------------------------------------------------
create table workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role_id uuid not null references workspace_roles(id) on delete cascade,
  token_hash text not null unique,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz
);
create index on workspace_invitations (workspace_id, created_at desc);
alter table workspace_invitations enable row level security;
create policy "invitations: team managers read" on workspace_invitations for select using (has_permission(workspace_id, 'team.manage'));

create or replace function create_invitation(p_workspace uuid, p_email text, p_role uuid) returns text
language plpgsql security definer set search_path = public as $$
declare token text; r workspace_roles; mail text := lower(trim(p_email));
begin
  if not has_permission(p_workspace, 'team.manage') then raise exception 'Not allowed to invite members' using errcode = '42501'; end if;
  select * into r from workspace_roles where id = p_role and workspace_id = p_workspace;
  if r.id is null then raise exception 'Role not found'; end if;
  if not (r.permissions <@ my_permissions(p_workspace)) then raise exception 'You cannot invite someone with more access than your own' using errcode = '42501'; end if;
  if exists (select 1 from workspace_members m join auth.users u on u.id = m.user_id where m.workspace_id = p_workspace and lower(u.email) = mail) then
    raise exception 'This person is already a member';
  end if;
  update workspace_invitations set revoked_at = now() where workspace_id = p_workspace and email = mail and accepted_at is null and revoked_at is null;
  token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into workspace_invitations (workspace_id, email, role_id, token_hash, invited_by)
    values (p_workspace, mail, r.id, encode(sha256(convert_to(token, 'UTF8')), 'hex'), auth.uid());
  perform team_audit(p_workspace, 'invitation.created', null, jsonb_build_object('email', mail, 'role', r.name));
  return token;
end $$;

create or replace function revoke_invitation(p_invitation uuid) returns void
language plpgsql security definer set search_path = public as $$
declare i workspace_invitations;
begin
  select * into i from workspace_invitations where id = p_invitation;
  if i.id is null or not has_permission(i.workspace_id, 'team.manage') then raise exception 'Invitation not found' using errcode = '42501'; end if;
  update workspace_invitations set revoked_at = now() where id = p_invitation and accepted_at is null;
  perform team_audit(i.workspace_id, 'invitation.revoked', null, jsonb_build_object('email', i.email));
end $$;

create or replace function invitation_preview(p_token text)
returns table (workspace_name text, role_name text, email text, status text)
language sql stable security definer set search_path = public as $$
  select w.name, r.name, i.email,
    case when i.revoked_at is not null then 'revoked' when i.accepted_at is not null then 'accepted'
         when i.expires_at < now() then 'expired' else 'pending' end
  from workspace_invitations i join workspaces w on w.id = i.workspace_id join workspace_roles r on r.id = i.role_id
  where i.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

create or replace function accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare i workspace_invitations; mail text;
begin
  if auth.uid() is null then raise exception 'Sign in to accept the invitation' using errcode = '42501'; end if;
  select * into i from workspace_invitations where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') for update;
  if i.id is null or i.revoked_at is not null then raise exception 'This invitation is no longer valid'; end if;
  if i.accepted_at is not null then raise exception 'This invitation has already been used'; end if;
  if i.expires_at < now() then raise exception 'This invitation has expired. Ask for a new one.'; end if;
  select lower(email) into mail from auth.users where id = auth.uid();
  if mail is distinct from i.email then raise exception 'This invitation was sent to another email address' using errcode = '42501'; end if;
  insert into workspace_members (workspace_id, user_id, role, role_id)
    values (i.workspace_id, auth.uid(), (select base_role from workspace_roles where id = i.role_id), i.role_id)
    on conflict (workspace_id, user_id) do nothing;
  update workspace_invitations set accepted_at = now(), accepted_by = auth.uid() where id = i.id;
  insert into workspace_audit_log (workspace_id, actor_id, action, target_user, details)
    values (i.workspace_id, auth.uid(), 'invitation.accepted', auth.uid(), jsonb_build_object('email', i.email));
  return i.workspace_id;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Tasks: assignee + collaborators on ideas and briefs
-- ---------------------------------------------------------------------------
alter table content_items add column priority text not null default 'medium' check (priority in ('low','medium','high','urgent'));

create table content_assignments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  content_item_id uuid not null references content_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  task_type text not null check (task_type in ('copywriting','design','video','seo','approval','other')),
  status text not null default 'assigned' check (status in ('backlog','assigned','in_progress','in_review','changes_requested','approved','completed')),
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  due_date date,
  note text not null default '' check (char_length(note) <= 2000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_item_id, user_id, task_type)
);
create index on content_assignments (user_id, status);
create index on content_assignments (project_id, due_date);
create trigger content_assignments_updated before update on content_assignments for each row execute function set_updated_at();

-- Participant = lead assignee, creator, or anyone with a task on the item.
create or replace function is_content_participant(item uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from content_items c where c.id = item and (c.assignee_id = auth.uid() or c.created_by = auth.uid()))
      or exists (select 1 from content_assignments a where a.content_item_id = item and a.user_id = auth.uid());
$$;

create or replace function can_view_content(p uuid, item uuid) returns boolean language sql stable security definer set search_path = public as $$
  select is_workspace_member(project_workspace(p)) and (has_permission(project_workspace(p), 'content.view_all') or is_content_participant(item));
$$;

alter table content_assignments enable row level security;
create policy "assignments: visible with content" on content_assignments for select using (can_view_content(project_id, content_item_id));

-- Edit rights now include collaborators with an open task, and the "edit any content" permission.
create or replace function production_can_edit(p uuid, item uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from content_items c where c.id = item and c.project_id = p and (
    has_workspace_role(project_workspace(p), array['owner','admin']::workspace_role[])
    or (has_workspace_role(project_workspace(p), array['editor']::workspace_role[]) and (
      has_permission(project_workspace(p), 'content.edit_any')
      or c.assignee_id = auth.uid()
      or (c.assignee_id is null and c.created_by = auth.uid())
      or exists (select 1 from content_assignments a where a.content_item_id = c.id and a.user_id = auth.uid()
                 and a.status not in ('approved','completed'))))));
$$;

create or replace function assign_task(p_project uuid, p_item uuid, p_user uuid, p_task_type text, p_priority text default 'medium',
  p_due date default null, p_note text default '') returns content_assignments
language plpgsql security definer set search_path = public as $$
declare ws uuid := project_workspace(p_project); a content_assignments;
begin
  if not has_permission(ws, 'content.assign') then raise exception 'Not allowed to assign tasks' using errcode = '42501'; end if;
  if not exists (select 1 from content_items where id = p_item and project_id = p_project) then raise exception 'Content not found'; end if;
  if not exists (select 1 from workspace_members where workspace_id = ws and user_id = p_user and role <> 'viewer') then
    raise exception 'Assign tasks to workspace members who can edit (not viewers)';
  end if;
  insert into content_assignments (project_id, content_item_id, user_id, task_type, priority, due_date, note, created_by)
    values (p_project, p_item, p_user, p_task_type, coalesce(p_priority, 'medium'), p_due, coalesce(p_note, ''), auth.uid())
    on conflict (content_item_id, user_id, task_type) do update
      set priority = excluded.priority, due_date = excluded.due_date, note = excluded.note,
          status = case when content_assignments.status in ('approved','completed') then 'assigned' else content_assignments.status end
    returning * into a;
  insert into content_activity (project_id, content_item_id, actor_id, kind, body, revision)
    select p_project, p_item, auth.uid(), 'assigned',
      'Assigned ' || p_task_type || ' to ' || coalesce(nullif((select full_name from profiles where id = p_user), ''), 'a team member'), revision
    from content_items where id = p_item;
  return a;
end $$;

create or replace function remove_task(p_assignment uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a content_assignments;
begin
  select * into a from content_assignments where id = p_assignment;
  if a.id is null or not has_permission(project_workspace(a.project_id), 'content.assign') then raise exception 'Task not found' using errcode = '42501'; end if;
  delete from content_assignments where id = p_assignment;
  insert into content_activity (project_id, content_item_id, actor_id, kind, body, revision)
    select a.project_id, a.content_item_id, auth.uid(), 'assigned',
      'Removed ' || a.task_type || ' task from ' || coalesce(nullif((select full_name from profiles where id = a.user_id), ''), 'a team member'), revision
    from content_items where id = a.content_item_id;
end $$;

-- Task status: the task owner moves their own work forward; reviewers decide.
create or replace function update_task_status(p_assignment uuid, p_status text, p_comment text default '') returns content_assignments
language plpgsql security definer set search_path = public as $$
declare a content_assignments; ws uuid; mine boolean; reviewer boolean;
begin
  select * into a from content_assignments where id = p_assignment for update;
  if a.id is null or not can_view_content(a.project_id, a.content_item_id) then raise exception 'Task not found' using errcode = '42501'; end if;
  ws := project_workspace(a.project_id);
  mine := a.user_id = auth.uid();
  reviewer := has_permission(ws, 'content.approve') or has_permission(ws, 'content.review');
  if p_status not in ('backlog','assigned','in_progress','in_review','changes_requested','approved','completed') then raise exception 'Invalid status'; end if;
  if p_status in ('approved','changes_requested') then
    if not reviewer then raise exception 'Only reviewers can approve or request changes' using errcode = '42501'; end if;
    if mine and p_status = 'approved' and not has_permission(ws, 'content.approve_own') then
      raise exception 'You cannot approve your own work' using errcode = '42501';
    end if;
    if a.status <> 'in_review' then raise exception 'This task is not awaiting review'; end if;
    if p_status = 'changes_requested' and length(trim(coalesce(p_comment, ''))) = 0 then raise exception 'Explain the changes you need'; end if;
  elsif p_status = 'completed' then
    if not (has_permission(ws, 'content.assign') or (mine and a.task_type <> 'approval' and a.status = 'approved')) then
      raise exception 'Not allowed to complete this task' using errcode = '42501';
    end if;
  else
    if not (mine or has_permission(ws, 'content.assign')) then raise exception 'Only the task owner or a manager can change this task' using errcode = '42501'; end if;
    if a.status in ('approved','completed') and not has_permission(ws, 'content.assign') then raise exception 'This task is closed'; end if;
  end if;
  update content_assignments set status = p_status where id = a.id returning * into a;
  insert into content_activity (project_id, content_item_id, actor_id, kind, body, revision)
    select a.project_id, a.content_item_id, auth.uid(),
      case p_status when 'approved' then 'approved' when 'changes_requested' then 'changes_requested' else 'stage' end,
      initcap(replace(a.task_type, '_', ' ')) || ' task: ' || replace(p_status, '_', ' ')
        || case when length(trim(coalesce(p_comment, ''))) > 0 then E'\n' || trim(p_comment) else '' end, revision
    from content_items where id = a.content_item_id;
  return a;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Notifications
-- ---------------------------------------------------------------------------
create table notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('assigned','mention','review_requested','changes_requested','approved','invited')),
  project_id uuid references projects(id) on delete cascade,
  content_item_id uuid references content_items(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  body text not null default '' check (char_length(body) <= 500),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on notifications (user_id, read_at, created_at desc);
alter table notifications enable row level security;
create policy "notifications: own read" on notifications for select using (user_id = auth.uid());
create policy "notifications: own mark read" on notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function notify(p_user uuid, p_kind text, p_project uuid, p_item uuid, p_body text) returns void
language sql security definer set search_path = public as $$
  insert into notifications (workspace_id, user_id, kind, project_id, content_item_id, actor_id, body)
  select project_workspace(p_project), p_user, p_kind, p_project, p_item, auth.uid(), left(p_body, 500)
  where p_user is not null and p_user is distinct from auth.uid();
$$;

create or replace function notify_on_assignment() returns trigger language plpgsql security definer set search_path = public as $$
declare title text;
begin
  select c.title into title from content_items c where c.id = new.content_item_id;
  if tg_op = 'INSERT' or new.user_id <> old.user_id then
    perform notify(new.user_id, 'assigned', new.project_id, new.content_item_id, initcap(new.task_type) || ' task: ' || title);
  elsif new.status <> old.status then
    if new.status = 'in_review' then
      perform notify(coalesce(new.created_by, (select created_by from content_items where id = new.content_item_id)), 'review_requested',
        new.project_id, new.content_item_id, initcap(new.task_type) || ' ready for review: ' || title);
    elsif new.status = 'changes_requested' then
      perform notify(new.user_id, 'changes_requested', new.project_id, new.content_item_id, 'Changes requested on ' || new.task_type || ': ' || title);
    elsif new.status = 'approved' then
      perform notify(new.user_id, 'approved', new.project_id, new.content_item_id, initcap(new.task_type) || ' approved: ' || title);
    end if;
  end if;
  return new;
end $$;
create trigger notify_on_assignment after insert or update on content_assignments for each row execute function notify_on_assignment();

create or replace function notify_on_content() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.assignee_id is not null and new.assignee_id is distinct from old.assignee_id then
    perform notify(new.assignee_id, 'assigned', new.project_id, new.id, 'You lead: ' || new.title);
  end if;
  if new.production_stage in ('internal_review','approval') and new.production_stage is distinct from old.production_stage then
    perform notify(new.created_by, 'review_requested', new.project_id, new.id, 'Ready for review: ' || new.title);
  end if;
  return new;
end $$;
create trigger notify_on_content after update on content_items for each row execute function notify_on_content();

create or replace function notify_on_activity() returns trigger language plpgsql security definer set search_path = public as $$
declare m uuid; title text;
begin
  select c.title into title from content_items c where c.id = new.content_item_id;
  if new.kind = 'comment' then
    foreach m in array new.mentions loop
      perform notify(m, 'mention', new.project_id, new.content_item_id, 'Mentioned you on ' || title || ': ' || left(new.body, 200));
    end loop;
  elsif new.kind = 'changes_requested' then
    perform notify((select assignee_id from content_items where id = new.content_item_id), 'changes_requested', new.project_id, new.content_item_id, 'Changes requested: ' || title);
  end if;
  return new;
end $$;
create trigger notify_on_activity after insert on content_activity for each row execute function notify_on_activity();

-- ---------------------------------------------------------------------------
-- 7. Production rules updated for the new permissions (behaviour for existing roles is unchanged)
-- ---------------------------------------------------------------------------
create or replace function production_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare ws uuid; admin boolean; copy_changed boolean := false; review_event boolean := false; opp uuid;
begin
  ws := project_workspace(new.project_id);
  admin := has_workspace_role(ws, array['owner','admin']::workspace_role[]) or has_permission(ws, 'content.approve');
  if auth.uid() is not null and not has_workspace_role(ws, array['owner','admin','editor']::workspace_role[]) then
    raise exception 'This workspace is read-only' using errcode='42501';
  end if;
  if new.assignee_id is not null and not exists(select 1 from workspace_members where workspace_id=ws and user_id=new.assignee_id and role <> 'viewer') then
    raise exception 'Assignee must be an editor or administrator in this workspace';
  end if;
  if new.calendar_id is not null and not exists(select 1 from editorial_calendars where id=new.calendar_id and project_id=new.project_id) then
    raise exception 'Calendar belongs to another project';
  end if;
  if new.historical_source_id is not null and not exists(select 1 from historical_content_items where id=new.historical_source_id and project_id=new.project_id) then
    raise exception 'Historical source belongs to another project';
  end if;
  if tg_op='UPDATE' then
    if new.project_id <> old.project_id
      or (new.created_by is not null and new.created_by is distinct from old.created_by)
      or (new.opportunity_id is not null and new.opportunity_id is distinct from old.opportunity_id) then
      raise exception 'Content ownership and source cannot be changed';
    end if;
    if auth.uid() is not null and new.assignee_id is distinct from old.assignee_id and not has_permission(ws, 'content.assign') then
      raise exception 'Not allowed to change the assignee' using errcode='42501';
    end if;
    copy_changed := production_copy(new) is distinct from production_copy(old);
    select exists(select 1 from content_activity where content_item_id=old.id and revision=old.revision and actor_id=auth.uid()
      and kind in ('internal_approved','approved','rejected','changes_requested') and created_at >= transaction_timestamp()) into review_event;
    if auth.uid() is not null and not production_can_edit(old.project_id,old.id) then
      if not (review_event and not copy_changed and new.assignee_id is not distinct from old.assignee_id
        and new.due_date is not distinct from old.due_date and new.scheduled_at is not distinct from old.scheduled_at
        and new.scheduled_date is not distinct from old.scheduled_date and new.scheduled_time is not distinct from old.scheduled_time) then
        raise exception 'Only the assignee, a collaborator, or a manager can edit this content' using errcode = '42501';
      end if;
    end if;
    if old.status='published' and (copy_changed or new.status<>old.status or new.production_stage<>old.production_stage or new.scheduled_at is distinct from old.scheduled_at or new.scheduled_date is distinct from old.scheduled_date) then
      raise exception 'Published content is locked. Duplicate it to create a new draft.';
    end if;
    if new.status is distinct from old.status and new.production_stage=old.production_stage then
      new.production_stage := case new.status when 'brief_ready' then 'brief' when 'in_production' then 'in_production'
        when 'in_review' then 'internal_review' when 'approved' then 'ready' when 'scheduled' then 'ready'
        when 'published' then 'published' else 'idea' end;
    end if;
    if copy_changed and old.production_stage in ('internal_review','approval','ready') then
      new.production_stage := 'in_production'; new.status := 'in_production';
      new.approved_by := null; new.approved_at := null;
    else
      new.approved_by := case when new.approved_by is null and old.approved_by is not null and not exists(select 1 from auth.users where id=old.approved_by) then null else old.approved_by end;
      new.approved_at := old.approved_at;
    end if;
    if new.production_stage='approval' and old.production_stage<>'approval' then
      if (select coalesce((production_workflow->>'require_internal_review')::boolean,true) from projects where id=new.project_id)
        and not exists(select 1 from content_activity where content_item_id=old.id and revision=old.revision and kind='internal_approved' and created_at>=transaction_timestamp()) then
        raise exception 'Complete internal review before requesting manager approval';
      end if;
    end if;
    if new.production_stage='ready' and old.production_stage<>'ready' then
      if not admin or not exists(select 1 from content_activity where content_item_id=old.id and revision=old.revision and actor_id=auth.uid() and kind='approved' and created_at>=transaction_timestamp()) then
        raise exception 'Manager approval is required. Use Review & Approval.' using errcode='42501';
      end if;
      new.approved_by := auth.uid(); new.approved_at := now();
    end if;
    if new.production_stage not in ('ready','published') then new.approved_by:=null; new.approved_at:=null; end if;
    new.revision := old.revision + 1;
  else
    if auth.uid() is not null then
      if not has_permission(ws, 'content.create') then raise exception 'Not allowed to create content' using errcode='42501'; end if;
      if new.assignee_id is not null and new.assignee_id <> auth.uid() and not has_permission(ws, 'content.assign') then
        raise exception 'Not allowed to assign content' using errcode='42501';
      end if;
      new.created_by:=auth.uid();
    end if;
    new.revision:=1; new.approved_by:=null; new.approved_at:=null;
    if new.status in ('approved','scheduled','published') or new.production_stage in ('approval','ready','published') then
      raise exception 'New content starts as a draft and must go through review';
    end if;
    new.production_stage:=case new.status when 'brief_ready' then 'brief' when 'in_production' then 'in_production' when 'in_review' then 'internal_review' else new.production_stage end;
  end if;
  if new.status='published' and (tg_op='INSERT' or old.status<>'published') then
    if not exists(select 1 from historical_content_items h where h.id=new.historical_source_id and h.project_id=new.project_id
      and h.source='meta_api' and h.platform=new.platform and h.published_at is not null
      and h.permalink=new.published_url and h.published_at=new.published_at) then
      raise exception 'Publication must be verified against a synced post from the connected platform';
    end if;
  end if;
  if new.production_stage='published' and new.status<>'published' then raise exception 'Verify publication from the calendar first'; end if;
  new.status:=case new.production_stage when 'idea' then case when new.status='planned' then 'planned'::content_status else 'idea'::content_status end
    when 'brief' then 'brief_ready'::content_status when 'in_production' then 'in_production'::content_status
    when 'internal_review' then 'in_review'::content_status when 'approval' then 'in_review'::content_status
    when 'ready' then case when new.status='scheduled' then 'scheduled'::content_status else 'approved'::content_status end
    else 'published'::content_status end;
  if new.status='scheduled' and (tg_op='INSERT' or old.status<>'scheduled' or new.scheduled_at is distinct from old.scheduled_at) and (new.scheduled_at is null or new.scheduled_at <= now()) then raise exception 'Scheduling requires a future date and time'; end if;
  if new.opportunity_id is not null and (tg_op='INSERT' or old.opportunity_id is null) then
    select id into opp from opportunities where id=new.opportunity_id and project_id=new.project_id for update;
    if opp is null then raise exception 'Opportunity not found'; end if;
    if exists(select 1 from content_items where opportunity_id=opp and id<>new.id) then raise exception 'This opportunity already has a content item'; end if;
  end if;
  return new;
end $$;

create or replace function production_transition(p_project uuid,p_id uuid,p_revision integer,p_stage text,p_decision text default null,p_comment text default '') returns content_items
language plpgsql security definer set search_path=public as $$
declare c content_items; ws uuid := project_workspace(p_project); approver boolean; review_kind text;
begin
  if not has_workspace_role(ws,array['owner','admin','editor']::workspace_role[]) then raise exception 'Not authorized' using errcode='42501'; end if;
  approver:=has_workspace_role(ws,array['owner','admin']::workspace_role[]) or has_permission(ws,'content.approve');
  select * into c from content_items where id=p_id and project_id=p_project for update;
  if c.id is null or not can_view_content(p_project,p_id) then raise exception 'Content not found'; end if;
  if c.revision<>p_revision then raise exception 'This content changed. Reload before continuing.' using errcode='40001'; end if;
  if c.status='published' or p_stage='published' then raise exception 'Publication must be confirmed by a connected platform'; end if;
  if p_decision is not null then
    if c.production_stage not in ('internal_review','approval') then raise exception 'Content is not awaiting review'; end if;
    if c.production_stage='approval' and not approver then raise exception 'Only members who can approve content can give final approval' using errcode='42501'; end if;
    if c.production_stage='internal_review' and not (approver or has_permission(ws,'content.review')) then raise exception 'Only reviewers can review content' using errcode='42501'; end if;
    if p_decision not in ('approve','reject','changes') then raise exception 'Invalid decision'; end if;
    if p_decision='approve' and c.assignee_id=auth.uid() and not has_permission(ws,'content.approve_own') then
      raise exception 'You cannot approve your own work' using errcode='42501';
    end if;
    if p_decision in ('reject','changes') and length(trim(p_comment))=0 then raise exception 'Explain the requested changes or rejection'; end if;
    review_kind:=case when p_decision='approve' then case c.production_stage when 'internal_review' then 'internal_approved' else 'approved' end when p_decision='reject' then 'rejected' else 'changes_requested' end;
    p_stage:=case when p_decision='approve' then case c.production_stage when 'internal_review' then 'approval' else 'ready' end else 'in_production' end;
    insert into content_activity(project_id,content_item_id,actor_id,kind,body,revision) values(p_project,p_id,auth.uid(),review_kind,p_comment,c.revision);
  elsif not production_can_edit(p_project,p_id) then raise exception 'This content is not assigned to you' using errcode='42501';
  end if;
  update content_items set production_stage=p_stage where id=p_id returning * into c;
  return c;
end $$;

create or replace function production_comment(p_project uuid,p_id uuid,p_body text,p_mentions uuid[] default '{}') returns void
language plpgsql security definer set search_path=public as $$
declare c content_items;
begin
  if not has_workspace_role(project_workspace(p_project),array['owner','admin','editor']::workspace_role[]) then raise exception 'Read-only workspace' using errcode='42501'; end if;
  select * into c from content_items where id=p_id and project_id=p_project;
  if c.id is null or not can_view_content(p_project,p_id) or length(trim(p_body)) not between 1 and 5000 then raise exception 'Content and comment are required'; end if;
  if exists(select 1 from unnest(p_mentions) m where not exists(select 1 from workspace_members where workspace_id=project_workspace(p_project) and user_id=m)) then raise exception 'Mentioned user is not a workspace member'; end if;
  insert into content_activity(project_id,content_item_id,actor_id,kind,body,mentions,revision) values(p_project,p_id,auth.uid(),'comment',p_body,p_mentions,c.revision);
end $$;

-- save_production (security definer) creates rows past RLS; creation rights are checked in production_guard above.

-- ---------------------------------------------------------------------------
-- 8. Least-privilege row security (restrictive policies AND-ed with the existing ones)
-- ---------------------------------------------------------------------------
create policy "content: visibility" on content_items as restrictive for select using (can_view_content(project_id, id));
create policy "content: delete permission" on content_items as restrictive for delete
  using (has_permission(project_workspace(project_id), 'content.delete'));
create policy "activity: visibility" on content_activity as restrictive for select using (can_view_content(project_id, content_item_id));
create policy "versions: visibility" on content_versions as restrictive for select using (can_view_content(project_id, content_item_id));
create policy "assets: visibility" on content_assets as restrictive for select using (can_view_content(project_id, content_item_id));

create policy "projects: manage permission" on projects as restrictive for insert with check (has_permission(workspace_id, 'projects.manage'));
create policy "projects: update permission" on projects as restrictive for update
  using (has_permission(workspace_id, 'projects.manage') or has_permission(workspace_id, 'settings.manage'));

-- Module tables: reading needs <module>.view, writing needs <module>.edit.
do $$
declare t text; m text;
begin
  foreach t in array array[
    'brand_profiles:strategy','project_channels:strategy','strategies:strategy','personas:strategy','content_pillars:strategy','campaigns:strategy','kpis:strategy',
    'import_jobs:intelligence','historical_content_items:intelligence','analysis_reports:intelligence','competitors:intelligence',
    'competitor_content_items:intelligence','competitor_metric_snapshots:intelligence','competitor_sync_runs:intelligence',
    'meta_connections:intelligence','meta_sync_runs:intelligence',
    'serp_analyses:seo','serp_items:seo','seo_briefs:seo',
    'opportunities:opportunities','opportunity_feedback:opportunities',
    'editorial_calendars:calendar'
  ] loop
    m := split_part(t, ':', 2); t := split_part(t, ':', 1);
    continue when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'project_id');
    execute format($p$create policy "%1$s: %2$s view" on %1$I as restrictive for select using (has_permission(project_workspace(project_id), '%2$s.view'))$p$, t, m);
    execute format($p$create policy "%1$s: %2$s insert" on %1$I as restrictive for insert with check (has_permission(project_workspace(project_id), '%2$s.edit'))$p$, t, m);
    execute format($p$create policy "%1$s: %2$s update" on %1$I as restrictive for update using (has_permission(project_workspace(project_id), '%2$s.edit'))$p$, t, m);
    execute format($p$create policy "%1$s: %2$s delete" on %1$I as restrictive for delete using (has_permission(project_workspace(project_id), '%2$s.edit'))$p$, t, m);
  end loop;
end $$;

-- competitor_channels has no project_id: authorize through its competitor.
create policy "competitor_channels: intelligence view" on competitor_channels as restrictive for select
  using (exists (select 1 from competitors c where c.id = competitor_id and has_permission(project_workspace(c.project_id), 'intelligence.view')));
create policy "competitor_channels: intelligence write" on competitor_channels as restrictive for all
  using (exists (select 1 from competitors c where c.id = competitor_id and has_permission(project_workspace(c.project_id), 'intelligence.edit')))
  with check (exists (select 1 from competitors c where c.id = competitor_id and has_permission(project_workspace(c.project_id), 'intelligence.edit')));

-- ---------------------------------------------------------------------------
-- 9. Grants
-- ---------------------------------------------------------------------------
revoke all on function set_member_role(uuid,uuid,uuid), remove_member(uuid,uuid), create_invitation(uuid,text,uuid),
  revoke_invitation(uuid), accept_invitation(text), assign_task(uuid,uuid,uuid,text,text,date,text), remove_task(uuid),
  update_task_status(uuid,text,text), workspace_directory(uuid), my_permissions(uuid), notify(uuid,text,uuid,uuid,text),
  team_audit(uuid,text,uuid,jsonb), seed_workspace_roles(uuid) from public;
grant execute on function set_member_role(uuid,uuid,uuid), remove_member(uuid,uuid), create_invitation(uuid,text,uuid),
  revoke_invitation(uuid), accept_invitation(text), assign_task(uuid,uuid,uuid,text,text,date,text), remove_task(uuid),
  update_task_status(uuid,text,text), workspace_directory(uuid), my_permissions(uuid) to authenticated;
grant execute on function invitation_preview(text) to anon, authenticated;

commit;
