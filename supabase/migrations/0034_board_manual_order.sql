-- 0034: manual card order on the Production board.
-- Positions live in their own table instead of a content_items column on purpose: every content_items update runs
-- production_guard (bumps revision), production_audit (new version), change_log and card notifications. A reorder is
-- not a content change, so it must not create versions, journal entries, notifications or "content changed" conflicts.
--
-- One row per card: the board column it was ordered in and a float position inside that column. A row whose column no
-- longer matches the card's column (the card moved stage elsewhere, e.g. from the editor) counts as "no position".
-- Cards without a position sort after positioned ones, oldest first (created_at, id); the app uses the same rule.

create table content_board_positions (
  content_item_id uuid primary key references content_items(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  board_column text not null check (board_column in ('idea','brief','in_production','internal_review','ready')),
  position double precision not null,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
create index content_board_positions_column on content_board_positions(project_id, board_column, position);

alter table content_board_positions enable row level security;
-- Visible exactly when the card is visible (the subquery runs under content_items' own RLS). No write policies:
-- positions only change through production_reorder().
create policy "board positions: visible with content" on content_board_positions for select
  using (exists (select 1 from content_items c where c.id = content_item_id));

-- The board column of a production stage (mirrors columnOf() in src/lib/production/model.ts).
create or replace function production_board_column(stage text) returns text language sql immutable as $$
  select case stage when 'approval' then 'internal_review' when 'published' then 'ready' else stage end;
$$;

-- Deterministic initial order: what the board showed before ("Deadline first": due date, then most recently updated).
insert into content_board_positions(content_item_id, project_id, board_column, position, updated_by)
select id, project_id, production_board_column(production_stage::text),
  1024 * row_number() over (partition by project_id, production_board_column(production_stage::text)
                            order by due_date nulls last, updated_at desc, id),
  null
from content_items
where archived_at is null and (production_stage <> 'idea' or scheduled_date is not null or on_board);

/**
 * Places card p_id between p_after (the card above it, null = top) and p_before (the card below it, null = bottom)
 * in the card's current board column. Only the moved card's row is written, except when the gap between the two
 * neighbours becomes too small, then that one column is renumbered. A per-project advisory lock serialises reorders;
 * neighbours that are no longer in the column (or no longer in that order) raise a PT409 conflict (HTTP 409, never
 * retried by PostgREST, see 0029) so the app reloads instead of guessing.
 */
create or replace function production_reorder(p_project uuid, p_id uuid, p_after uuid, p_before uuid)
returns double precision language plpgsql security definer set search_path = public as $$
declare col text; pa double precision; pb double precision; pos double precision;
begin
  if not production_can_edit(p_project, p_id) then
    raise exception 'You cannot move this content.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('production_board:' || p_project::text, 0));

  select production_board_column(production_stage::text) into col from content_items
  where id = p_id and project_id = p_project and archived_at is null and (production_stage <> 'idea' or scheduled_date is not null or on_board);
  if col is null then raise exception 'This content is no longer on the board. Reload the page.' using errcode = 'PT409'; end if;

  -- Give every card of the column a position (cards without one go last, oldest first, like the app shows them).
  insert into content_board_positions as b(content_item_id, project_id, board_column, position)
  select c.id, p_project, col,
    coalesce((select max(x.position) from content_board_positions x join content_items y on y.id = x.content_item_id
              where x.project_id = p_project and x.board_column = col
                and production_board_column(y.production_stage::text) = col), 0)
    + 1024 * row_number() over (order by c.created_at, c.id)
  from content_items c
  left join content_board_positions b2 on b2.content_item_id = c.id and b2.board_column = col
  where c.project_id = p_project and c.archived_at is null and (c.production_stage <> 'idea' or c.scheduled_date is not null or c.on_board)
    and production_board_column(c.production_stage::text) = col and b2.content_item_id is null
  on conflict (content_item_id) do update set board_column = excluded.board_column, position = excluded.position, updated_at = now();

  if p_after is not null then
    select b.position into pa from content_board_positions b join content_items c on c.id = b.content_item_id
    where b.content_item_id = p_after and b.project_id = p_project and b.board_column = col and c.archived_at is null
      and production_board_column(c.production_stage::text) = col and p_after <> p_id;
    if pa is null then raise exception 'The board changed in another session. Reload the page.' using errcode = 'PT409'; end if;
  end if;
  if p_before is not null then
    select b.position into pb from content_board_positions b join content_items c on c.id = b.content_item_id
    where b.content_item_id = p_before and b.project_id = p_project and b.board_column = col and c.archived_at is null
      and production_board_column(c.production_stage::text) = col and p_before <> p_id;
    if pb is null then raise exception 'The board changed in another session. Reload the page.' using errcode = 'PT409'; end if;
  end if;
  if pa is not null and pb is not null and pa >= pb then
    raise exception 'The board changed in another session. Reload the page.' using errcode = 'PT409';
  end if;

  if pa is not null and pb is not null and pb - pa < 1e-6 then
    -- Out of room between the neighbours: renumber this column (keeping its order), then read them again.
    update content_board_positions b set position = r.n * 1024, updated_at = now()
    from (select content_item_id, row_number() over (order by position, content_item_id) as n
          from content_board_positions where project_id = p_project and board_column = col) r
    where b.content_item_id = r.content_item_id;
    select position into pa from content_board_positions where content_item_id = p_after;
    select position into pb from content_board_positions where content_item_id = p_before;
  end if;

  pos := case
    when pa is not null and pb is not null then (pa + pb) / 2
    when pa is not null then pa + 1024
    when pb is not null then pb - 1024
    else 1024 end;

  insert into content_board_positions(content_item_id, project_id, board_column, position, updated_by, updated_at)
  values (p_id, p_project, col, pos, auth.uid(), now())
  on conflict (content_item_id) do update set board_column = excluded.board_column, position = excluded.position,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return pos;
end $$;

revoke execute on function production_reorder(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function production_reorder(uuid, uuid, uuid, uuid) to authenticated;
