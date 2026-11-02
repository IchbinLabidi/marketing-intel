-- Audience tag: every idea / content item targets exactly one of student, parent or teacher. Assigned by the AI when
-- ideas are generated (fallback classification otherwise), editable in the app. Nullable so older items show as
-- "untagged" until tagged. Only additions: no data is deleted.

begin;

alter table content_items
  add column if not exists audience text check (audience in ('student', 'parent', 'teacher'));
create index if not exists content_items_audience_idx on content_items (project_id, audience);

-- Existing items whose segment already names a single side get the matching tag ("both" and unset stay untagged)
update content_items set audience = case audience_segment when 'students' then 'student' when 'parents' then 'parent' when 'teachers' then 'teacher' end
where audience is null and audience_segment in ('students', 'parents', 'teachers');

commit;
