import { z } from "zod";

/** Optional free text: trims, empty string => null. */
export const optionalText = (max = 5000) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const requiredText = (max = 200) => z.string().trim().min(1, "Required").max(max);

export const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.enum(values), z.literal("")])
    .nullish()
    .transform((v) => (v ? (v as T[number]) : null));

export const optionalNumber = (min: number, max: number) =>
  z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v, ctx) => {
      if (v === "" || v === null || v === undefined) return null;
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isNaN(n) || n < min || n > max) {
        ctx.addIssue({ code: "custom", message: `Must be between ${min} and ${max}` });
        return z.NEVER;
      }
      return n;
    });

export const optionalDate = z
  .union([z.iso.date(), z.literal("")])
  .nullish()
  .transform((v) => (v ? v : null));

export const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .optional()
  .nullable()
  .transform((v) => (v ? (/^https?:\/\//i.test(v) ? v : `https://${v}`) : null))
  .pipe(z.url("Invalid URL").nullable());

/** Converts FormData to a plain object. Keys ending with [] are collected as arrays. */
export function formToObject(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(formData.keys())) {
    if (key.startsWith("$ACTION")) continue;
    if (key.endsWith("[]")) out[key.slice(0, -2)] = formData.getAll(key).map(String);
    else out[key] = formData.get(key)?.toString() ?? null;
  }
  return out;
}

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export function zodErrorToResult(error: z.ZodError): ActionResult<never> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
}
