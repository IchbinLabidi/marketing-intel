// Zod schema → JSON Schema accepted by Gemini's `responseJsonSchema` (a documented subset of JSON Schema).
// Keywords outside the subset are dropped; the response is still validated with the full Zod schema afterwards,
// so dropped constraints (lengths, patterns) are enforced on our side.
import { z } from "zod";

const KEEP = new Set([
  "$id", "$defs", "$ref", "$anchor", "type", "format", "title", "description", "enum", "items", "prefixItems", "minItems",
  "maxItems", "minimum", "maximum", "anyOf", "oneOf", "properties", "additionalProperties", "required", "propertyOrdering",
]);
// formats Gemini documents for strings; others (uuid, email…) are left to Zod
const FORMATS = new Set(["date-time", "date", "time"]);

function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (!node || typeof node !== "object") return node;
  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (k === "const") out.enum = [v];
    else if (k === "format") { if (typeof v === "string" && FORMATS.has(v)) out.format = v; }
    else if (k === "properties" || k === "$defs") out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([p, s]) => [p, clean(s)]));
    else if (KEEP.has(k)) out[k] = clean(v);
  }
  if (out.enum && !out.type) {
    const types = [...new Set((out.enum as unknown[]).map((e) => (e === null ? "null" : typeof e)))];
    if (types.length === 1 && ["string", "number", "boolean"].includes(types[0])) out.type = types[0];
  }
  return out;
}

export function geminiJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return clean(z.toJSONSchema(schema, { target: "draft-2020-12", unrepresentable: "any" })) as Record<string, unknown>;
}
