-- Permission checks for migration 0013, run against a real database inside a transaction that is rolled back.
-- Simulates three people with the same JWT claims Supabase would set:
--   owner    = owner of the workspace that holds the project below
--   creator  = an existing user added for the test as "Content Creator"
--   designer = another existing user added for the test as "Designer"
-- Each check records PASS/FAIL in a temp table, shown at the end. Nothing is kept.
begin;

create temp table t_results (n serial, check_name text, result text, detail text);
grant all on t_results to authenticated;
grant usage on sequence t_results_n_seq to authenticated;

create temp table t_ctx as
with p as (select id as project_id, workspace_id from projects where id = 'c0dc7a06-b2f8-45c4-86a4-eb60af802c72'),
     o as (select m.user_id as owner_id from workspace_members m, p where m.workspace_id = p.workspace_id and m.role = 'owner' limit 1),
     others as (select id, row_number() over (order by created_at) as rn from auth.users
                where id not in (select user_id from workspace_members m, p where m.workspace_id = p.workspace_id))
select p.project_id, p.workspace_id, o.owner_id,
  (select id from others where rn = 1) as creator_id,
  (select id from others where rn = 2) as designer_id,
  (select id from content_items c where c.project_id = p.project_id and c.status <> 'published' order by created_at desc, id limit 1) as item_id,
  (select id from content_items c where c.project_id = p.project_id and c.status <> 'published' order by created_at desc, id offset 1 limit 1) as other_item_id
from p, o;
grant select on t_ctx to authenticated;

insert into workspace_members (workspace_id, user_id, role, role_id)
select workspace_id, creator_id, 'editor', (select id from workspace_roles r where r.workspace_id = t_ctx.workspace_id and key = 'content_creator') from t_ctx;
insert into workspace_members (workspace_id, user_id, role, role_id)
select workspace_id, designer_id, 'editor', (select id from workspace_roles r where r.workspace_id = t_ctx.workspace_id and key = 'designer') from t_ctx;

-- ---- as the owner: assign the copy task to the creator --------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true) from t_ctx;
do $$ declare c t_ctx; a content_assignments; begin
  select * into c from t_ctx;
  a := assign_task(c.project_id, c.item_id, c.creator_id, 'copywriting', 'high', current_date + 3, 'Write the caption');
  insert into t_results (check_name, result, detail) values ('owner assigns copywriting to creator', case when a.id is not null then 'PASS' else 'FAIL' end, a.status);
exception when others then insert into t_results (check_name, result, detail) values ('owner assigns copywriting to creator', 'FAIL', sqlerrm); end $$;

-- ---- as the content creator ----------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', creator_id, 'role', 'authenticated')::text, true) from t_ctx;
insert into t_results (check_name, result, detail)
select 'creator sees only assigned content', case when count(*) = 1 then 'PASS' else 'FAIL' end, count(*)::text || ' visible'
from content_items where project_id = (select project_id from t_ctx);
insert into t_results (check_name, result, detail)
select 'creator can read strategy', case when count(*) >= 1 then 'PASS' else 'FAIL' end, count(*)::text || ' rows'
from strategies where project_id = (select project_id from t_ctx);
insert into t_results (check_name, result, detail)
select 'creator cannot read SERP research', case when count(*) = 0 then 'PASS' else 'FAIL' end, count(*)::text || ' rows'
from serp_analyses where project_id = (select project_id from t_ctx);
insert into t_results (check_name, result, detail)
select 'creator cannot read content history', case when count(*) = 0 then 'PASS' else 'FAIL' end, count(*)::text || ' rows'
from historical_content_items where project_id = (select project_id from t_ctx);
insert into t_results (check_name, result, detail)
select 'creator cannot open unassigned content by id', case when count(*) = 0 then 'PASS' else 'FAIL' end, count(*)::text || ' rows'
from content_items where id = (select other_item_id from t_ctx);

do $$ declare c t_ctx; a content_assignments; begin
  select * into c from t_ctx;
  select * into a from content_assignments where content_item_id = c.item_id and user_id = c.creator_id;
  a := update_task_status(a.id, 'in_review', '');
  insert into t_results (check_name, result, detail) values ('creator submits own task for review', case when a.status = 'in_review' then 'PASS' else 'FAIL' end, a.status);
exception when others then insert into t_results (check_name, result, detail) values ('creator submits own task for review', 'FAIL', sqlerrm); end $$;

do $$ declare c t_ctx; a content_assignments; begin
  select * into c from t_ctx;
  select * into a from content_assignments where content_item_id = c.item_id and user_id = c.creator_id;
  perform update_task_status(a.id, 'approved', '');
  insert into t_results (check_name, result, detail) values ('creator cannot approve own task', 'FAIL', 'was allowed');
exception when others then insert into t_results (check_name, result, detail) values ('creator cannot approve own task', 'PASS', sqlerrm); end $$;

do $$ declare c t_ctx; begin
  select * into c from t_ctx;
  perform assign_task(c.project_id, c.item_id, c.designer_id, 'design');
  insert into t_results (check_name, result, detail) values ('creator cannot assign tasks', 'FAIL', 'was allowed');
exception when others then insert into t_results (check_name, result, detail) values ('creator cannot assign tasks', 'PASS', sqlerrm); end $$;

do $$ declare c t_ctx; begin
  select * into c from t_ctx;
  perform set_member_role(c.workspace_id, c.designer_id, (select id from workspace_roles where workspace_id = c.workspace_id and key = 'admin'));
  insert into t_results (check_name, result, detail) values ('creator cannot change roles', 'FAIL', 'was allowed');
exception when others then insert into t_results (check_name, result, detail) values ('creator cannot change roles', 'PASS', sqlerrm); end $$;

do $$ declare c t_ctx; begin
  select * into c from t_ctx;
  perform create_invitation(c.workspace_id, 'someone@example.com', (select id from workspace_roles where workspace_id = c.workspace_id and key = 'admin'));
  insert into t_results (check_name, result, detail) values ('creator cannot invite members', 'FAIL', 'was allowed');
exception when others then insert into t_results (check_name, result, detail) values ('creator cannot invite members', 'PASS', sqlerrm); end $$;

do $$ declare c t_ctx; n int; begin
  select * into c from t_ctx;
  update workspace_roles set permissions = team_all_permissions() where workspace_id = c.workspace_id and key = 'content_creator';
  get diagnostics n = row_count;
  insert into t_results (check_name, result, detail) values ('creator cannot escalate own role', case when n = 0 then 'PASS' else 'FAIL' end, n::text || ' rows updated');
exception when others then insert into t_results (check_name, result, detail) values ('creator cannot escalate own role', 'PASS', sqlerrm); end $$;

do $$ declare c t_ctx; n int; begin
  select * into c from t_ctx;
  update content_items set caption = 'tampered' where id = c.other_item_id;
  get diagnostics n = row_count;
  insert into t_results (check_name, result, detail) values ('creator cannot edit unassigned content', case when n = 0 then 'PASS' else 'FAIL' end, n::text || ' rows updated');
exception when others then insert into t_results (check_name, result, detail) values ('creator cannot edit unassigned content', 'PASS', sqlerrm); end $$;

-- ---- as the designer (no task yet) ---------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', designer_id, 'role', 'authenticated')::text, true) from t_ctx;
insert into t_results (check_name, result, detail)
select 'designer sees no content before assignment', case when count(*) = 0 then 'PASS' else 'FAIL' end, count(*)::text || ' visible'
from content_items where project_id = (select project_id from t_ctx);
do $$ declare c t_ctx; ci content_items; begin
  select * into c from t_ctx;
  select * into ci from content_items where id = c.item_id;  -- invisible: null
  perform production_transition(c.project_id, c.item_id, 1, 'in_production');
  insert into t_results (check_name, result, detail) values ('designer cannot move unassigned content', 'FAIL', 'was allowed');
exception when others then insert into t_results (check_name, result, detail) values ('designer cannot move unassigned content', 'PASS', sqlerrm); end $$;
insert into t_results (check_name, result, detail)
select 'designer cannot read workspace audit log', case when count(*) = 0 then 'PASS' else 'FAIL' end, count(*)::text || ' rows'
from workspace_audit_log where workspace_id = (select workspace_id from t_ctx);

-- ---- owner approves the creator's work, then assigns design ---------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true) from t_ctx;
do $$ declare c t_ctx; a content_assignments; begin
  select * into c from t_ctx;
  select * into a from content_assignments where content_item_id = c.item_id and user_id = c.creator_id;
  a := update_task_status(a.id, 'approved', '');
  insert into t_results (check_name, result, detail) values ('owner approves submitted copy', case when a.status = 'approved' then 'PASS' else 'FAIL' end, a.status);
  a := assign_task(c.project_id, c.item_id, c.designer_id, 'design', 'medium', null, 'Carousel, 5 slides');
  insert into t_results (check_name, result, detail) values ('owner assigns design after approval', case when a.id is not null then 'PASS' else 'FAIL' end, a.status);
exception when others then insert into t_results (check_name, result, detail) values ('owner approval / design assignment', 'FAIL', sqlerrm); end $$;

-- ---- designer now sees and works on the brief -------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', designer_id, 'role', 'authenticated')::text, true) from t_ctx;
insert into t_results (check_name, result, detail)
select 'designer sees the assigned brief', case when count(*) = 1 then 'PASS' else 'FAIL' end, count(*)::text || ' visible'
from content_items where project_id = (select project_id from t_ctx);
insert into t_results (check_name, result, detail)
select 'designer was notified of the assignment', case when count(*) >= 1 then 'PASS' else 'FAIL' end, count(*)::text || ' notifications'
from notifications where user_id = (select designer_id from t_ctx);
do $$ declare c t_ctx; ok boolean; begin
  select * into c from t_ctx;
  ok := production_can_edit(c.project_id, c.item_id);
  insert into t_results (check_name, result, detail) values ('designer can edit the brief they are assigned to', case when ok then 'PASS' else 'FAIL' end, ok::text);
end $$;

reset role;
select count(*) filter (where result = 'PASS') as passed, count(*) filter (where result = 'FAIL') as failed,
  string_agg(case when result = 'FAIL' then check_name || ': ' || detail end, ' | ') as failures from t_results;
select n, result, check_name, detail from t_results order by n;
rollback;
