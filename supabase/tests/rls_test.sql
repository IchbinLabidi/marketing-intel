-- Run: psql -v ON_ERROR_STOP=1 -f local_stub.sql -f ../migrations/0001_init.sql -f rls_test.sql
grant usage on schema public, auth, storage to authenticated;
grant all on all tables in schema public to authenticated;
grant execute on all functions in schema public, auth to authenticated;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test', '{"full_name":"Alice","workspace_name":"Agency A"}'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test', '{"full_name":"Bob"}');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ declare ws uuid; p uuid; n int;
begin
  select id into ws from workspaces where name = 'Agency A';
  if ws is null then raise exception 'Alice cannot see her workspace'; end if;
  insert into projects (workspace_id, name) values (ws, 'Brand X') returning id into p;
  insert into strategies (project_id, value_proposition) values (p, 'VP');
  insert into content_pillars (project_id, name) values (p, 'Education');
  select count(*) into n from workspaces; if n <> 1 then raise exception 'Alice sees % workspaces', n; end if;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ declare n int; ws uuid;
begin
  select count(*) into n from projects; if n <> 0 then raise exception 'Bob leaks projects'; end if;
  select count(*) into n from strategies; if n <> 0 then raise exception 'Bob leaks strategies'; end if;
  select id into ws from workspaces where name = 'Agency A';
  if ws is not null then raise exception 'Bob sees Alice workspace'; end if;
  begin
    insert into projects (workspace_id, name) select id, 'hack' from workspaces limit 0;
    insert into projects (workspace_id, name)
      values ((select workspace_id from workspace_members where user_id='00000000-0000-0000-0000-00000000000b'), 'Own');
  end;
  begin
    insert into content_pillars (project_id, name) values (gen_random_uuid(), 'x');
    raise exception 'Bob inserted into foreign project';
  exception when insufficient_privilege then null; end;
end $$;

-- Add Bob as viewer to Alice's workspace: can read, cannot write
reset role;
insert into workspace_members (workspace_id, user_id, role)
  select id, '00000000-0000-0000-0000-00000000000b', 'viewer' from workspaces where name = 'Agency A';
set role authenticated;
do $$ declare n int; p uuid;
begin
  select id into p from projects where name = 'Brand X';
  if p is null then raise exception 'viewer cannot read'; end if;
  begin
    insert into content_pillars (project_id, name) values (p, 'x');
    raise exception 'viewer could write';
  exception when insufficient_privilege then null; end;
  update projects set name = 'renamed' where id = p;
  select count(*) into n from projects where name = 'renamed'; if n <> 0 then raise exception 'viewer updated'; end if;
end $$;
select 'RLS TESTS PASSED' as result;
