-- Two-sided audiences (SOSProf: students & parents on one side, teachers on the other). Ideas get an audience segment
-- and a conversion goal; pillars belong to a side; each brand has an editable monthly audience mix. Existing pillars are
-- kept as the students & parents strategy. Only additions: no data is deleted.

begin;

alter table content_items
  add column if not exists audience_segment text check (audience_segment in ('students', 'parents', 'teachers', 'both')),
  add column if not exists conversion_goal text check (conversion_goal in (
    'forum_participation', 'teacher_profile_visits', 'lesson_requests', 'completed_bookings',
    'teacher_registration', 'profile_completion', 'teacher_activation', 'lesson_requests_received', 'completed_sessions'));
create index if not exists content_items_segment_idx on content_items (project_id, audience_segment);

-- Pillars belong to one side of the marketplace (their target_share is a share within that side)
alter table content_pillars add column if not exists audience_segment text not null default 'students_parents'
  check (audience_segment in ('students_parents', 'teachers', 'both'));

-- Monthly audience distribution per brand, in % (editable): {"students_parents": 60, "teachers": 35, "both": 5}
alter table projects add column if not exists audience_mix jsonb;

-- Infer the segment of existing ideas from their free-text target audience (only where it is clear; editable later)
update content_items set audience_segment = case
    when target_audience ~* '(enseignant|professeur|teacher|tutor|أستاذ|اساتذة|أساتذة|\mprofs?\M)' then 'teachers'
    when target_audience ~* '(parent|أولياء|الولي|famille|family)' then 'parents'
    when target_audience ~* '(élève|eleve|lycée|lyceen|lycéen|bac|student|étudiant|تلميذ|تلامذة|طالب|collég)' then 'students'
  end
where audience_segment is null and target_audience is not null;

-- SOSProf: the teacher strategy (5 pillars, shares within teacher content) and the starting 60 / 35 / 5 mix
do $$
declare p uuid;
begin
  for p in select id from projects where name ilike 'sosprof%' loop
    update projects set audience_mix = coalesce(audience_mix, '{"students_parents": 60, "teachers": 35, "both": 5}'::jsonb) where id = p;
    insert into content_pillars (project_id, name, description, target_share, audience_segment, position)
    select p, v.name, v.description, v.share, 'teachers', 100 + v.pos
    from (values
      ('Teacher Growth & Opportunities', 'Grow an independent teaching activity: more students, reputation, income opportunities.', 30, 1),
      ('Freedom & Flexibility', 'Teach on your own schedule, online or in person, with your own prices.', 25, 2),
      ('Teacher Platform Tutorials', 'How to use SOSProf as a teacher: profile, requests, lessons, payments.', 20, 3),
      ('Monetization & Services', 'Lessons, packs, exam preparation and other paid services teachers can offer.', 15, 4),
      ('Teacher Community & Success', 'Teacher stories, community, recognition and success on SOSProf.', 10, 5)
    ) as v(name, description, share, pos)
    where not exists (select 1 from content_pillars c where c.project_id = p and c.name = v.name);
  end loop;
end $$;

commit;
