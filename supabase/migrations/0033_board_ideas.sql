-- 0033: cards moved back to Idea stay on the Production board.
-- Before, the board and the Backlog were told apart only by "Idea stage + no date", so a board card moved back to
-- Idea disappeared from the board into the Backlog. content_items.on_board remembers that a card has been on the
-- board: it is set automatically as soon as the card is in any stage other than Idea, and only "Back to Backlog"
-- (unplanIdeasAction) clears it. Ideas that never left the Backlog keep on_board = false and stay in the Backlog.

begin;

alter table content_items add column if not exists on_board boolean not null default false;

-- Backfill: everything the board shows today. User triggers are off for this one statement so the backfill doesn't
-- write a version, an activity entry, a Journal line or a notification for every card, or bump revisions.
alter table content_items disable trigger user;
update content_items set on_board = true
where not on_board and (production_stage is distinct from 'idea' or scheduled_date is not null);
alter table content_items enable trigger user;

create or replace function mark_on_board() returns trigger language plpgsql set search_path = public as $$
begin
  if new.production_stage is distinct from 'idea' then new.on_board := true; end if;
  return new;
end $$;
drop trigger if exists mark_on_board on content_items;
create trigger mark_on_board before insert or update on content_items for each row execute function mark_on_board();

-- on_board is bookkeeping, not an edit anyone made: keep it out of the Journal (same in-place rewrite as 0029).
do $$
declare d text;
begin
  select replace(pg_get_functiondef(p.oid), '''conversions''];', '''conversions'', ''on_board''];') into d
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'log_project_change'
    and p.prosrc not like '%on_board%';
  if d is not null then execute d; end if;
end $$;

commit;
