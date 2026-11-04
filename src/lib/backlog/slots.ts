// Best time to post (pure, tested). Real timing from the brand's synced posts comes first; without enough data a
// clearly labelled heuristic is used. All times are local to the project's timezone (Africa/Tunis by default).
import { windowLabel, type PlatformTiming } from "@/lib/calendar/insights";
import { createFormatter } from "@/i18n/format";
import type { TFor } from "@/i18n/messages";

export type Confidence = "low" | "medium" | "high";
export type ExamKey = "firstTerm" | "secondTerm" | "endOfYear";
export type WhyKey = "linkedin" | "teachersEvening" | "teachersSunday" | "parentsWeekend" | "parentsEvening" | "studentsVideo" | "studentsSaturday" | "studentsEvening" | "studentsEarly";
/** What the reason is made of, so it can be shown in the viewer's language (the stored `reason` is in the language it was computed in). */
export type SlotExplain =
  | { kind: "analytics"; platform: string; weekday: number; window: number; lift: number | null; n: number; posts: number; exam: ExamKey | null }
  | { kind: "heuristic"; why: WhyKey; weekday: number; time: string; platform: string | null; posts: number | null; exam: ExamKey | null };
export type SuggestedSlot = {
  date: string; time: string; platform: string;
  alternatives: { date: string; time: string }[];
  confidence: Confidence; reason: string; source: "analytics" | "heuristic";
  sample: number | null; computed_at: string;
  explain?: SlotExplain;
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

/** Weekday name (0 = Sunday) in the translator's language: "Tuesday" / "mardi". */
export const weekdayName = (t: { locale: TFor<"backlog">["locale"] }, wd: number) => createFormatter(t.locale).day(addDays("2026-11-01", wd), { weekday: "long" });

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
export function examKey(date: string): ExamKey | null {
  const md = date.slice(5);
  if (md >= "11-20" && md <= "12-15") return "firstTerm";
  if (md >= "02-25" && md <= "03-15") return "secondTerm";
  if (md >= "05-10" && md <= "06-20") return "endOfYear";
  return null;
}
export function examPeriod(date: string, t: TFor<"backlog">): string | null {
  const k = examKey(date);
  return k ? t(`slot.exam.${k}`) : null;
}

type Pattern = { weekdays: number[]; time: string; why: WhyKey };
/** Heuristic slots by platform and audience. Labelled as heuristic everywhere they are shown. */
function heuristicPatterns(platform: string, audience: ReturnType<typeof audienceOf>, format: string): Pattern[] {
  const video = /reel|video|vidéo|tiktok|short/i.test(format) || platform === "tiktok";
  if (platform === "linkedin") return [{ weekdays: [2, 3, 4], time: "12:30", why: "linkedin" }];
  if (audience === "teachers") return [
    { weekdays: [1, 2, 3, 4], time: "21:00", why: "teachersEvening" },
    { weekdays: [0], time: "10:30", why: "teachersSunday" },
  ];
  if (audience === "parents") return [
    { weekdays: [0, 6], time: "10:00", why: "parentsWeekend" },
    { weekdays: [1, 2, 3, 4], time: "20:30", why: "parentsEvening" },
  ];
  if (video) return [
    { weekdays: [2, 3, 4, 0], time: "20:00", why: "studentsVideo" },
    { weekdays: [6], time: "15:00", why: "studentsSaturday" },
  ];
  return [
    { weekdays: [2, 3, 0], time: "19:30", why: "studentsEvening" },
    { weekdays: [1, 4], time: "18:00", why: "studentsEarly" },
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

/** The slot's reason in the translator's language (from its parts when stored, else the text saved with it). */
export function describeSlot(slot: Pick<SuggestedSlot, "reason" | "explain">, t: TFor<"backlog">): string {
  const x = slot.explain;
  if (!x) return slot.reason;
  const exam = x.exam ? t("slot.examSuffix", { period: t(`slot.exam.${x.exam}`) }) : "";
  if (x.kind === "analytics") {
    return t("slot.analytics", { platform: x.platform, slot: `${weekdayName(t, x.weekday)} ${windowLabel(x.window)}`, lift: x.lift, n: x.n, posts: x.posts }) + exam;
  }
  const missing = x.platform != null ? t("slot.notEnoughData", { platform: x.platform, posts: x.posts ?? 0 }) : t("slot.noHistory");
  return t("slot.heuristic", { why: t(`slot.why.${x.why}`), weekday: weekdayName(t, x.weekday), time: x.time, missing }) + exam;
}

export function suggestSlot(input: SlotInput, t: TFor<"backlog">): SuggestedSlot | null {
  const platform = input.platform ?? input.targetPlatforms?.[0] ?? "facebook";
  const busy = input.busy ?? {};
  const horizon = input.horizonDays ?? 21;
  const maxPerDay = input.maxPerDay ?? 2;
  const computed_at = (input.now ?? new Date()).toISOString();
  const exam = (d: string) => (examKey(d) && audienceOf(input.audience, input.segment) !== "teachers" && /educ|révis|revis|bac|exam|cours|astuce|méthod|tip/i.test(`${input.pillar ?? ""} ${input.format ?? ""}`) ? examKey(d) : null);

  const timing = input.timing.find((t) => t.platform === platform);
  if (timing?.suggestions.length) {
    const candidates = timing.suggestions.flatMap((s) => nextDates(input.today, s.weekday, busy, maxPerDay, horizon).slice(0, 2).map((date) => ({ date, time: hhmm(s.window), s })))
      .sort((a, b) => (b.s.lift ?? 0) - (a.s.lift ?? 0) || a.date.localeCompare(b.date));
    if (candidates.length) {
      const best = candidates[0];
      const n = best.s.n;
      const confidence: Confidence = n >= 15 && (best.s.lift ?? 0) >= 1.2 ? "high" : n >= 8 ? "medium" : "low";
      const alternatives = candidates.filter((c) => c.date !== best.date).slice(0, 2).map(({ date, time }) => ({ date, time }));
      const explain: SlotExplain = { kind: "analytics", platform: timing.label, weekday: best.s.weekday, window: best.s.window, lift: best.s.lift, n, posts: timing.posts, exam: exam(best.date) };
      return {
        date: best.date, time: best.time, platform, alternatives, confidence, source: "analytics", sample: timing.posts, computed_at,
        reason: describeSlot({ reason: "", explain }, t), explain,
      };
    }
  }

  const patterns = heuristicPatterns(platform, audienceOf(input.audience, input.segment), input.format ?? "");
  const candidates = patterns.flatMap((p) => p.weekdays.flatMap((wd) => nextDates(input.today, wd, busy, maxPerDay, horizon).slice(0, 1).map((date) => ({ date, time: p.time, why: p.why }))))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!candidates.length) return null;
  const best = candidates[0];
  const explain: SlotExplain = { kind: "heuristic", why: best.why, weekday: weekdayOf(best.date), time: best.time, platform: timing ? timing.label : null, posts: timing ? timing.posts : null, exam: exam(best.date) };
  return {
    date: best.date, time: best.time, platform, source: "heuristic", confidence: "low", sample: timing?.posts ?? null, computed_at,
    alternatives: candidates.slice(1, 3).map(({ date, time }) => ({ date, time })),
    reason: describeSlot({ reason: "", explain }, t), explain,
  };
}
