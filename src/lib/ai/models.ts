// AI routing and pricing. Pure (no SDK, no env access at import) so it can be unit-tested and shown in the UI.
// Every AI feature has a tier; each tier maps to a provider + model, overridable per tier or per feature by env vars.

export const AI_PROVIDERS = ["gemini", "anthropic"] as const;
export type AIProvider = (typeof AI_PROVIDERS)[number];
export const PROVIDER_LABELS: Record<AIProvider, string> = { gemini: "Google Gemini", anthropic: "Anthropic Claude" };

export const AI_TIERS = ["light", "standard", "premium"] as const;
export type AITier = (typeof AI_TIERS)[number];
export const TIER_LABELS: Record<AITier, string> = {
  light: "Light (classification, short edits)",
  standard: "Standard (analysis, briefs, content)",
  premium: "Premium (long-form, highest quality)",
};

/**
 * Feature → tier. Features not listed are "standard". Keys match the `feature` names logged in ai_runs.
 * Light: classification, extraction-like and short edits. Premium: long-form output where quality matters most.
 */
const FEATURE_TIERS: Record<string, AITier> = {
  "history.pillar_classification": "light",
  "calendar.generate_post": "light",
  "calendar.regenerate_post": "light",
  "production.improve_hook": "light",
  "production.alternative_hooks": "light",
  "production.tone": "light",
  "production.shorten": "light",
  "production.improve_cta": "light",
  "production.hashtags": "light",
  "serp.draft": "premium",
  "backlog.score": "light",
  // Editorial engine: cheap model for repetition judgments; standard for opportunities and the weekly content
  "editorial.repetition": "light",
};
export const tierOf = (feature: string): AITier => FEATURE_TIERS[feature] ?? "standard";
/** Features that use a non-standard tier (for the routing overview). */
export const TIERED_FEATURES = Object.entries(FEATURE_TIERS) as [string, AITier][];

/** Module part of a feature name, for grouping ("production.hashtags" → "Content production"). */
export const MODULE_LABELS: Record<string, string> = {
  strategy: "Marketing strategy", history: "Content history", competitors: "Competitors", serp: "Google search",
  opportunities: "Content opportunities", calendar: "Editorial calendar", production: "Content production", editorial: "Editorial engine", backlog: "Ideas Backlog",
};

export type AIRoute = { provider: AIProvider; model: string };

/** Default models per provider and tier (chosen 2026-10-26: Gemini by default, Claude Sonnet for premium). */
export const PROVIDER_MODELS: Record<AIProvider, Record<AITier, string>> = {
  gemini: { light: "gemini-3.1-flash-lite", standard: "gemini-3.8-flash", premium: "gemini-4-argon" },
  anthropic: { light: "claude-haiku-5-5", standard: "claude-sonnet-5-5", premium: "claude-sonnet-5-5" },
};
const DEFAULT_TIER_ROUTES: Record<AITier, AIRoute> = {
  light: { provider: "gemini", model: PROVIDER_MODELS.gemini.light },
  standard: { provider: "gemini", model: PROVIDER_MODELS.gemini.standard },
  premium: { provider: "anthropic", model: PROVIDER_MODELS.anthropic.premium },
};

export type AIEnv = Partial<Record<string, string | undefined>>;
export type ResolvedRoute = AIRoute & { tier: AITier; source: "feature" | "tier" | "env_default" | "builtin"; fallback: AIRoute | null };

/** "anthropic:claude-sonnet-5-5" | "gemini" (provider's model for the tier) | "gemini-3.8-flash" (provider inferred). */
export function parseRoute(value: string | undefined, tier: AITier): AIRoute | null {
  const v = value?.trim();
  if (!v) return null;
  const [a, b] = v.includes(":") ? v.split(":", 2).map((s) => s.trim()) : [v, ""];
  if ((AI_PROVIDERS as readonly string[]).includes(a)) return { provider: a as AIProvider, model: b || PROVIDER_MODELS[a as AIProvider][tier] };
  const provider = providerOfModel(a);
  return provider ? { provider, model: a } : null;
}
export const providerOfModel = (model: string): AIProvider | null => (model.startsWith("gemini") ? "gemini" : model.startsWith("claude") ? "anthropic" : null);

/** AI_ROUTE_SERP_DRAFT for feature "serp.draft"; production.* features can share AI_ROUTE_PRODUCTION. */
export const featureEnvName = (feature: string) => `AI_ROUTE_${feature.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;

/**
 * Which provider and model a feature uses. Precedence: AI_ROUTE_<FEATURE> → AI_ROUTE_<MODULE> → AI_TIER_<TIER>
 * → AI_DEFAULT_PROVIDER / AI_DEFAULT_MODEL → built-in table. If the chosen provider has no API key, the other
 * provider's model for the same tier is used. `fallback` is the other provider, tried once if the call fails because
 * the first provider is unavailable (no key, key rejected, no credit).
 */
export function resolveRoute(feature: string, env: AIEnv, configured: Record<AIProvider, boolean>): ResolvedRoute {
  const tier = tierOf(feature);
  const moduleName = feature.split(".")[0];
  const defaultProvider = (AI_PROVIDERS as readonly string[]).includes(env.AI_DEFAULT_PROVIDER ?? "") ? (env.AI_DEFAULT_PROVIDER as AIProvider) : null;
  const byFeature = parseRoute(env[featureEnvName(feature)], tier) ?? parseRoute(env[`AI_ROUTE_${moduleName.toUpperCase()}`], tier);
  const byTier = parseRoute(env[`AI_TIER_${tier.toUpperCase()}`], tier);
  const byDefault = env.AI_DEFAULT_MODEL ? parseRoute(env.AI_DEFAULT_MODEL, tier) : defaultProvider ? { provider: defaultProvider, model: PROVIDER_MODELS[defaultProvider][tier] } : null;
  let route: AIRoute = byFeature ?? byTier ?? byDefault ?? DEFAULT_TIER_ROUTES[tier];
  const source = byFeature ? "feature" : byTier ? "tier" : byDefault ? "env_default" : "builtin";
  const other = (p: AIProvider): AIProvider => (p === "gemini" ? "anthropic" : "gemini");
  if (!configured[route.provider] && configured[other(route.provider)]) route = { provider: other(route.provider), model: PROVIDER_MODELS[other(route.provider)][tier] };
  const alt = other(route.provider);
  return { ...route, tier, source, fallback: configured[alt] ? { provider: alt, model: PROVIDER_MODELS[alt][tier] } : null };
}

// ---- Pricing (USD per 1M tokens, paid tier, checked 2026-10-26) ----------------------------------------------------
// Gemini: ai.google.dev/gemini-api/docs/pricing. Claude: Anthropic API pricing. `from` = price change date (UTC).
type Price = { input: number; output: number; cacheRead: number; cacheWrite?: number; from?: string };
export const MODEL_PRICES: Record<string, Price[]> = {
  "gemini-3.1-flash-lite": [{ input: 0.25, output: 1.5, cacheRead: 0.025 }],
  "gemini-3.5-flash-lite": [{ input: 0.3, output: 2.5, cacheRead: 0.03 }],
  "gemini-3.8-flash": [{ input: 0.75, output: 3.75, cacheRead: 0.075 }, { from: "2027-01-01", input: 1.5, output: 7.5, cacheRead: 0.15 }],
  "gemini-3.6-flash": [{ input: 0.75, output: 3.75, cacheRead: 0.075 }, { from: "2027-01-01", input: 1.5, output: 7.5, cacheRead: 0.15 }],
  "gemini-4-argon": [{ input: 2, output: 10, cacheRead: 0.1 }, { from: "2026-12-01", input: 4, output: 20, cacheRead: 0.2 }],
  "gemini-2.5-flash-lite": [{ input: 0.1, output: 0.4, cacheRead: 0.01 }],
  "gemini-2.5-flash": [{ input: 0.3, output: 2.5, cacheRead: 0.03 }],
  "gemini-2.5-pro": [{ input: 1.25, output: 10, cacheRead: 0.125 }],
  "claude-haiku-5-5": [{ input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 }],
  "claude-sonnet-5-5": [{ input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }],
  "claude-opus-5-5": [{ input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }],
  "claude-fable-5-1": [{ input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 }],
};

export function priceFor(model: string, at: Date = new Date()): Price | null {
  const list = MODEL_PRICES[model];
  if (!list) return null;
  const day = at.toISOString().slice(0, 10);
  return [...list].reverse().find((p) => !p.from || p.from <= day) ?? list[0];
}

/** Billed token counts: `input` excludes cached reads and cache writes; `output` includes thinking tokens. */
export type AIUsage = { input: number; output: number; cacheRead: number; cacheWrite: number };

/** Estimated cost in USD, or null when the model's price is unknown (never guessed). */
export function estimateCost(model: string, u: AIUsage, at?: Date): number | null {
  const p = priceFor(model, at);
  if (!p) return null;
  const usd = (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * (p.cacheWrite ?? p.input)) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}
