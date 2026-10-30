// Best time to post (pure, tested). Real timing from the brand's synced posts comes first; without enough data a
// clearly labelled heuristic is used. All times are local to the project's timezone (Africa/Tunis by default).
import { WEEKDAY_LABELS, type PlatformTiming } from "@/lib/calendar/insights";

export type Confidence = "low" | "medium" | "high";
export type SuggestedSlot = {
  date: string; time: string; platform: string;
  alternatives: { date: string; time: string }[];
  confidence: Confidence; reason: string; source: "analytics" | "heuristic";
  sample: number | null; computed_at: string;
};

export type SlotInput = {
  platform: string | null;
  targetPlatforms?: string[];
  format?: string | null;
  audience?: string | null;
  /** students | parents | teachers | both: takes precedence over the free-text audience */
  segment?: string | null;
  pillar?: string | null;
  today: string;                    // YYYY-MM-DD in the project's timezone
  timing: PlatformTiming[];         // from bestPublicationTimes (may be empty)
  busy?: Record<string, number>;    // posts already placed per date
  horizonDays?: number;
  maxPerDay?: number;
  now?: Date;
};

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekdayOf = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const hhmm = (h: number, m = 0) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

/** Parents are reached in the evening and at weekends; students on weekday evenings after school. */
export function audienceOf(text: string | null | undefined, segment?: string | null): "parents" | "students" | "teachers" | "general" {
  if (segment === "teachers" || segment === "parents" || segment === "students") return segment;
  const t = (text ?? "").toLowerCase();
  if (/enseignant|professeur|teacher|tutor|أستاذ|أساتذة|اساتذة/.test(t)) return "teachers";
  if (/parent|أولياء|الأولياء|wali|famil/.test(t)) return "parents";
  if (/élève|eleve|student|lyc|bac|تلميذ|تلامذة|طالب|étudiant/.test(t)) return "students";
  return "general";
}

/** Tunisian school calendar periods when revision content is most timely (approximate, every year). */
export function examPeriod(date: string): string | null {
  const md = date.slice(5);
  if (md >= "11-20" && md <= "12-15") return "first-term exams";
  if (md >= "02-25" && md <= "03-15") return "second-term exams";
  if (md >= "05-10" && md <= "06-20") return "end-of-year exams and the Bac";
  return null;
}

type Pattern = { weekdays: number[]; time: string; why: string };
/** Heuristic slots by platform and audience. Labelled as heuristic everywhere they are shown. */
function heuristicPatterns(platform: string, audience: ReturnType<typeof audienceOf>, format: string): Pattern[] {
  const video = /reel|video|vidéo|tiktok|short/i.test(format) || platform === "tiktok";
  if (platform === "linkedin") return [{ weekdays: [2, 3, 4], time: "12:30", why: "professional audiences are more available around lunch on weekdays" }];
  if (audience === "teachers") return [
    { weekdays: [1, 2, 3, 4], time: "21:00", why: "teachers are more available in the evening, after their lessons" },
    { weekdays: [0], time: "10:30", why: "teachers often plan their week on Sunday mornings" },
  ];
  if (audience === "parents") return [
    { weekdays: [0, 6], time: "10:00", why: "parents are more available on weekend mornings" },
    { weekdays: [1, 2, 3, 4], time: "20:30", why: "parents are more available after dinner on weekdays" },
  ];
  if (video) return [
    { weekdays: [2, 3, 4, 0], time: "20:00", why: "students scroll short videos in the evening after school" },
    { weekdays: [6], time: "15:00", why: "students are free on Saturday afternoons" },
  ];
  return [
    { weekdays: [2, 3, 0], time: "19:30", why: "students may be more available in the evening, after school and homework" },
    { weekdays: [1, 4], time: "18:00", why: "students may be more available in the early evening" },
  ];
}

/** Next dates (from tomorrow) matching the weekday, skipping days that are already full. */
function nextDates(today: string, weekday: number, busy: Record<string, number>, maxPerDay: number, horizon: number) {
  const out: string[] = [];
  for (let i = 1; i <= horizon; i++) {
    const d = addDays(today, i);
    if (weekdayOf(d) === weekday && (busy[d] ?? 0) < maxPerDay) out.push(d);
  }
  return out;
}

export function suggestSlot(input: SlotInput): SuggestedSlot | null {
  const platform = input.platform ?? input.targetPlatforms?.[0] ?? "facebook";
  const busy = input.busy ?? {};
  const horizon = input.horizonDays ?? 21;
  const maxPerDay = input.maxPerDay ?? 2;
  const computed_at = (input.now ?? new Date()).toISOString();
  const exam = (d: string) => (examPeriod(d) && audienceOf(input.audience, input.segment) !== "teachers" && /educ|révis|revis|bac|exam|cours|astuce|méthod|tip/i.test(`${input.pillar ?? ""} ${input.format ?? ""}`) ? ` It falls during ${examPeriod(d)}, when revision content is timely.` : "");

  const timing = input.timing.find((t) => t.platform === platform);
  if (timing?.suggestions.length) {
    const candidates = timing.suggestions.flatMap((s) => nextDates(input.today, s.weekday, busy, maxPerDay, horizon).slice(0, 2).map((date) => ({ date, time: hhmm(s.window), s })))
      .sort((a, b) => (b.s.lift ?? 0) - (a.s.lift ?? 0) || a.date.localeCompare(b.date));
    if (candidates.length) {
      const best = candidates[0];
      const n = best.s.n;
      const confidence: Confidence = n >= 15 && (best.s.lift ?? 0) >= 1.2 ? "high" : n >= 8 ? "medium" : "low";
      const alternatives = candidates.filter((c) => c.date !== best.date).slice(0, 2).map(({ date, time }) => ({ date, time }));
      return {
        date: best.date, time: best.time, platform, alternatives, confidence, source: "analytics", sample: timing.posts, computed_at,
        reason: `On ${timing.label}, your posts on ${best.s.label} received ×${best.s.lift} the interactions of your median post (${n} posts in that slot, ${timing.posts} analysed). Correlation, not a guarantee.${exam(best.date)}`,
      };
    }
  }

  const patterns = heuristicPatterns(platform, audienceOf(input.audience, input.segment), input.format ?? "");
  const candidates = patterns.flatMap((p) => p.weekdays.flatMap((wd) => nextDates(input.today, wd, busy, maxPerDay, horizon).slice(0, 1).map((date) => ({ date, time: p.time, why: p.why }))))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!candidates.length) return null;
  const best = candidates[0];
  const why = timing ? `not enough of your ${timing.label} posts per time slot yet (${timing.posts} analysed)` : "no synced post history for this platform yet";
  return {
    date: best.date, time: best.time, platform, source: "heuristic", confidence: "low", sample: timing?.posts ?? null, computed_at,
    alternatives: candidates.slice(1, 3).map(({ date, time }) => ({ date, time })),
    reason: `Heuristic: ${best.why} (${WEEKDAY_LABELS[weekdayOf(best.date)]} ${best.time}). Pending account analytics: ${why}.${exam(best.date)}`,
  };
}
