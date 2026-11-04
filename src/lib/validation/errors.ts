import "server-only";
import type { z } from "zod";
import { getT } from "@/i18n/server";
import type { ActionResult } from "./common";

/**
 * Turns a failed parse into a form result in the request's language. Schema messages written as "v:<key>"
 * (optionally "v:<key>?name=value") are keys of the `validation` namespace; built-in checks get a translated
 * message in French and keep the validator's own wording in English.
 */
export async function zodErrorToResult(error: z.ZodError): Promise<ActionResult<never>> {
  const t = await getT("validation");
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (key && !fieldErrors[key]) fieldErrors[key] = issueMessage(issue, t);
  }
  return { ok: false, error: t("fixFields"), fieldErrors };
}

type ValidationT = Awaited<ReturnType<typeof getT<"validation">>>;

function issueMessage(issue: z.core.$ZodIssue, t: ValidationT): string {
  if (issue.message.startsWith("v:")) {
    const [key, query] = issue.message.slice(2).split("?");
    const values = Object.fromEntries(new URLSearchParams(query ?? ""));
    return t(key as Parameters<ValidationT>[0], values);
  }
  if (t.locale === "en") return issue.message;
  switch (issue.code) {
    case "too_big":
      if (issue.origin === "string") return t("tooLong", { count: Number(issue.maximum) });
      if (issue.origin === "array" || issue.origin === "set") return t("tooManyItems", { count: Number(issue.maximum) });
      return t("tooBig", { max: Number(issue.maximum) });
    case "too_small":
      if (issue.origin === "string") return Number(issue.minimum) <= 1 ? t("required") : t("tooShort", { count: Number(issue.minimum) });
      if (issue.origin === "array" || issue.origin === "set") return t("tooFewItems", { count: Number(issue.minimum) });
      return t("tooSmall", { min: Number(issue.minimum) });
    case "invalid_format":
      if (issue.format === "email") return t("invalidEmail");
      if (issue.format === "url") return t("invalidUrl");
      if (issue.format === "date" || issue.format === "datetime") return t("invalidDate");
      return t("invalidValue");
    case "invalid_value":
      return t("invalidOption");
    case "invalid_type":
      return issue.input === undefined || issue.input === null || issue.input === "" ? t("required") : t("invalidValue");
    default:
      return t("invalidValue");
  }
}
