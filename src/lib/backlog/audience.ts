// Audience segments for two-sided brands (SOSProf: students & parents on one side, teachers on the other). Pure.

export const SEGMENTS = ["students", "parents", "teachers", "both"] as const;
export type Segment = (typeof SEGMENTS)[number];
export const SEGMENT_LABELS: Record<Segment, string> = { students: "Students", parents: "Parents", teachers: "Teachers", both: "Both / General" };

/** The marketplace side an idea or pillar belongs to (students and parents are the same, demand side). */
export const SIDES = ["students_parents", "teachers", "both"] as const;
export type Side = (typeof SIDES)[number];
export const SIDE_LABELS: Record<Side, string> = { students_parents: "Students & Parents", teachers: "Teachers", both: "Both audiences" };
export const sideOf = (s: string | null | undefined): Side | null => (s === "students" || s === "parents" ? "students_parents" : s === "teachers" ? "teachers" : s === "both" ? "both" : null);

/** Conversion goals per side: teacher recruitment and student bookings are never evaluated together. */
export const CONVERSIONS: Record<Exclude<Side, "both">, { key: string; label: string }[]> = {
  students_parents: [
    { key: "forum_participation", label: "Forum participation" },
    { key: "teacher_profile_visits", label: "Teacher profile visits" },
    { key: "lesson_requests", label: "Lesson requests" },
    { key: "completed_bookings", label: "Completed bookings" },
  ],
  teachers: [
    { key: "teacher_registration", label: "Teacher registration" },
    { key: "profile_completion", label: "Profile completion" },
    { key: "teacher_activation", label: "Teacher activation" },
    { key: "lesson_requests_received", label: "Lesson requests received" },
    { key: "completed_sessions", label: "Completed teaching sessions" },
  ],
};
export const ALL_CONVERSIONS = [...CONVERSIONS.students_parents, ...CONVERSIONS.teachers];
export const conversionLabel = (k: string | null | undefined) => ALL_CONVERSIONS.find((c) => c.key === k)?.label ?? null;
/** Goals allowed for a segment ("both" may use either side's goals). */
export const goalsFor = (s: string | null | undefined) => {
  const side = sideOf(s);
  return side === "students_parents" ? CONVERSIONS.students_parents : side === "teachers" ? CONVERSIONS.teachers : ALL_CONVERSIONS;
};
export const goalFits = (segment: string | null | undefined, goal: string | null | undefined) => !goal || goalsFor(segment).some((g) => g.key === goal);

export type AudienceMix = Record<Side, number>;
export const DEFAULT_MIX: AudienceMix = { students_parents: 60, teachers: 35, both: 5 };

/** The brand's mix, completed and rescaled to 100; null when the brand has none (single-audience brands). */
export function normalizeMix(m: unknown): AudienceMix | null {
  if (!m || typeof m !== "object") return null;
  const raw = Object.fromEntries(SIDES.map((s) => { const v = Number((m as Record<string, unknown>)[s]); return [s, Number.isFinite(v) && v >= 0 ? v : 0]; })) as AudienceMix;
  const sum = SIDES.reduce((a, s) => a + raw[s], 0);
  if (!sum) return null;
  return Object.fromEntries(SIDES.map((s) => [s, Math.round((raw[s] / sum) * 1000) / 10])) as AudienceMix;
}

/** Actual distribution of planned posts per side, in % (posts without a segment are counted apart). */
export function distribution(segments: (string | null | undefined)[]) {
  const counts: Record<Side | "unset", number> = { students_parents: 0, teachers: 0, both: 0, unset: 0 };
  for (const s of segments) counts[sideOf(s) ?? "unset"]++;
  const total = segments.length;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  return { total, counts, pct: { students_parents: pct(counts.students_parents), teachers: pct(counts.teachers), both: pct(counts.both), unset: pct(counts.unset) } };
}

// --- Audience tag: who one idea speaks to (exactly one of three). Separate from the segment above, which also allows
// "both" and drives the marketplace-side mix; setting the tag keeps a single-side segment in step with it.

export const AUDIENCES = ["student", "parent", "teacher"] as const;
export type Audience = (typeof AUDIENCES)[number];
export const AUDIENCE_LABELS: Record<Audience, string> = { student: "Student", parent: "Parent", teacher: "Teacher" };
/** What each tag means, for AI prompts. */
export const AUDIENCE_GUIDE = "student = aimed at learners (pupils, high-school/bac students, university students); parent = aimed at parents or families choosing or following a child's learning; teacher = aimed at teachers, tutors or educators (recruiting, helping or speaking to them)";
export const isAudience = (v: unknown): v is Audience => typeof v === "string" && (AUDIENCES as readonly string[]).includes(v);

/** Reads a tag from loose AI or user text ("Students", "parents", "Enseignant"…); null when it isn't one of the three. */
export function parseAudience(v: unknown): Audience | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (isAudience(s)) return s;
  return s ? guessAudience(s) : null;
}

/** Keyword match on free text (same patterns as migration 0022); null when nothing is clear. */
export function guessAudience(text: string | null | undefined): Audience | null {
  if (!text) return null;
  if (/(enseignant|professeur|teacher|tutor|educator|formateur|أستاذ|اساتذة|أساتذة|\bprofs?\b)/i.test(text)) return "teacher";
  if (/(parent|أولياء|الولي|famille|family)/i.test(text)) return "parent";
  if (/(élève|eleve|lycée|lyceen|lycéen|\bbac\b|student|étudiant|etudiant|learner|pupil|تلميذ|تلامذة|طالب|collég)/i.test(text)) return "student";
  return null;
}

export const audienceOfSegment = (s: string | null | undefined): Audience | null => (s === "students" ? "student" : s === "parents" ? "parent" : s === "teachers" ? "teacher" : null);

/** The segment to store with a tag: "both" is kept (it is broader than one tag), otherwise the matching single side. */
export const segmentForAudience = (a: Audience, current: string | null | undefined): Segment => (current === "both" ? "both" : (`${a}s` as Segment));

/**
 * Last-resort tag when the AI gave none: the idea's segment, then keywords in its texts, then its pillar's side,
 * then "student" (most educational content speaks to learners).
 */
export function fallbackAudience(i: { segment?: string | null; texts?: (string | null | undefined)[]; pillarSegment?: string | null }): Audience {
  return audienceOfSegment(i.segment) ?? (i.texts ?? []).map(guessAudience).find(Boolean) ?? (i.pillarSegment === "teachers" ? "teacher" : "student");
}
