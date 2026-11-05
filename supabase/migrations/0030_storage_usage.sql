-- 0030: storage usage for the dashboard (database size + uploaded files), read by workspace admins.
-- One read-only function. It runs with the definer's rights because storage.objects and pg_database_size are not
-- readable by app users; it checks the caller is an owner/admin of the workspace before returning anything.
-- Files are attributed to a workspace through their first folder, which is always a project id in both buckets.

create or replace function storage_usage(p_workspace uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, storage as $$
declare
  result jsonb;
begin
  if not has_workspace_role(p_workspace, array['owner', 'admin']::workspace_role[]) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'files_bytes', coalesce((select sum((o.metadata->>'size')::bigint) from storage.objects o), 0),
    'files_count', (select count(*) from storage.objects o),
    'workspace_files_bytes', coalesce((
      select sum((o.metadata->>'size')::bigint) from storage.objects o
      join projects p on p.id::text = (storage.foldername(o.name))[1]
      where p.workspace_id = p_workspace), 0),
    'workspace_files_count', (
      select count(*) from storage.objects o
      join projects p on p.id::text = (storage.foldername(o.name))[1]
      where p.workspace_id = p_workspace),
    'buckets', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.bucket_id, 'bytes', b.bytes, 'count', b.n) order by b.bytes desc)
      from (select o.bucket_id, sum((o.metadata->>'size')::bigint) as bytes, count(*) as n from storage.objects o group by o.bucket_id) b), '[]'::jsonb),
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object('name', t.relname, 'bytes', t.bytes) order by t.bytes desc)
      from (select c.relname, pg_total_relation_size(c.oid) as bytes from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' order by 2 desc limit 6) t), '[]'::jsonb)
  ) into result;
  return result;
end $$;

revoke all on function storage_usage(uuid) from public, anon;
grant execute on function storage_usage(uuid) to authenticated;
