-- SOSProf.net six permanent content pillars. Pillars can now be retired (kept, hidden from pickers, the planner and
-- targets) instead of deleted; SOSProf's ten earlier pillars are retired and each of their ideas moves to the matching
-- new pillar, with the old pillar name kept as a tag ("pillar-v1: …") so the move can be undone. Also: a priority rank
-- (urgent → low) for sorting, and a per-brand default Backlog sort. Other brands (Elios Academy…) are not touched.

begin;

alter table content_pillars add column if not exists retired_at timestamptz;

-- urgent 0, high 1, medium (or unset) 2, low 3: "highest priority first" sorts on this
alter table content_items add column if not exists priority_rank smallint generated always as (
  case priority when 'urgent' then 0 when 'high' then 1 when 'low' then 3 else 2 end) stored;
create index if not exists content_items_priority_idx on content_items (project_id, priority_rank, scheduled_date);

alter table projects add column if not exists backlog_sort text check (backlog_sort in ('score', 'priority', 'newest', 'oldest', 'suggested', 'title', 'audience'));

do $$
declare p uuid;
begin
  for p in select id from projects where name ilike 'sosprof%' loop
    -- target_share is a share within the pillar's side; with the 70 / 20 / 10 audience mix below the overall shares are
    -- 25 / 20 / 20 / 15 / 10 / 10 (e.g. Student Problems 35.7% of 70% = 25%)
    insert into content_pillars (project_id, name, description, target_share, audience_segment, position, color)
    select p, v.name, v.description, v.share, v.side, v.pos, v.color
    from (values
      ('01 · Student Problems & Relatable Content', 'Students & parents · Awareness, engagement, organic reach. Relatable daily problems of Tunisian students (tutoring frustrations, finding the right teacher, schedules, transport, unanswered homework, crowded sessions). Never mock teachers, parents or schools. KPIs: non-follower reach, shares. 25% of all content.', 35.7, 'students_parents', 1, 'amber'),
      ('02 · Platform Features & Solutions', 'Students & parents · Conversion and adoption. One launched feature per post (teacher choice, flexible scheduling, Q&A community, recordings, resources, online sessions). Never present a planned feature as available. KPIs: website visits, registrations. 20% of all content.', 28.6, 'students_parents', 2, 'indigo'),
      ('03 · Teacher Recruitment & Empowerment', 'Teachers · Teacher acquisition and retention. Independence, flexible schedule, visibility, teacher profiles, reaching new students, community, eligible monetisation. Never promise earnings or students. KPI: qualified teacher applications. 20% of all content.', 100, 'teachers', 3, 'emerald'),
      ('04 · Educational Value & Free Knowledge', 'Students · Organic growth, saves, shares, credibility. Real learning value aligned with the Tunisian curriculum: Bac tips, common mistakes, mini-lessons, maths, algorithmics/Python, physics, languages, methods. KPIs: saves, shares. 15% of all content.', 21.4, 'students_parents', 4, 'violet'),
      ('05 · Trust, Social Proof & Community', 'Students, parents & teachers · Credibility and community. Real teacher introductions, authentic demos, community Q&A, behind the scenes. Real testimonials only, with permission. KPIs: enquiries, engagement. 10% of all content.', 100, 'both', 5, 'sky'),
      ('06 · Parents, Guidance & Educational Decisions', 'Parents · Trust, consideration, conversion. Choosing support, organising revision, spotting difficulties, motivation, balancing school and tutoring, online learning. No fear-based claims, no guaranteed results. KPIs: parent enquiries, conversions. 10% of all content.', 14.3, 'students_parents', 6, 'rose')
    ) as v(name, description, share, side, pos, color)
    where not exists (select 1 from content_pillars c where c.project_id = p and c.name = v.name);

    -- move each idea of an earlier pillar to its new pillar (old name kept as a tag), then retire the earlier pillars
    update content_items i set
      tags = case when exists (select 1 from unnest(i.tags) t where t like 'pillar-v1:%') then i.tags else array_append(i.tags, 'pillar-v1: ' || old.name) end,
      pillar_id = (select n.id from content_pillars n where n.project_id = p and n.name = case
        when old.audience_segment = 'teachers' then '03 · Teacher Recruitment & Empowerment'
        when old.name ilike 'Conseils Parents%' then '06 · Parents, Guidance & Educational Decisions'
        when old.name ilike 'Vitrine des Tuteurs%' or old.name ilike 'Communauté%' then '05 · Trust, Social Proof & Community'
        else '04 · Educational Value & Free Knowledge' end)
    from content_pillars old
    where i.project_id = p and old.id = i.pillar_id and old.project_id = p and old.retired_at is null and old.name !~ '^0[1-6] · ';

    update content_pillars set retired_at = now() where project_id = p and retired_at is null and name !~ '^0[1-6] · ';

    update projects set audience_mix = '{"students_parents": 70, "teachers": 20, "both": 10}'::jsonb,
      -- business impact 30, audience 25, hook 15, originality 10, engagement 10, feasibility 10
      idea_score_weights = '{"marketing": 30, "audience": 25, "hook": 15, "originality": 10, "engagement": 10, "feasibility": 10, "educational": 0}'::jsonb,
      backlog_sort = 'priority'
    where id = p;
  end loop;
end $$;

commit;
