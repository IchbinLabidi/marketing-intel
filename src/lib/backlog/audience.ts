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
