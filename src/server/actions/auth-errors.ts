import type { TFor } from "@/i18n/messages";

/** Supabase Auth reports errors in English; show the known ones in the user's language and pass anything else through. */
export function authErrorText(message: string, t: TFor<"auth">, name?: string): string {
  if (/fetch failed|network|ECONN|ETIMEDOUT|ENOTFOUND/i.test(message) || name === "AuthRetryableFetchError") return t("errors.unreachable");
  if (/invalid login credentials/i.test(message)) return t("errors.invalidCredentials");
  if (/email not confirmed/i.test(message)) return t("errors.emailNotConfirmed");
  if (/already (been )?registered|already exists/i.test(message)) return t("errors.alreadyRegistered");
  if (/rate limit|too many/i.test(message)) return t("errors.rateLimited");
  if (/weak|password should/i.test(message)) return t("errors.weakPassword");
  if (/^missing[_ +]confirmation[_ +]code$|^missing_code$/i.test(message)) return t("errors.missingCode");
  if (/expired|invalid.*(code|token|link)|code verifier/i.test(message)) return t("errors.linkExpired");
  return message;
}
