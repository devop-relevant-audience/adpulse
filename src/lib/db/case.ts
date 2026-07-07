// Shallow camelCase <-> snake_case key converters for crossing the Drizzle
// boundary. Drizzle models columns in camelCase, while the rest of the app (Zod
// schemas, mock data, the hand-written `*Row` types, and the frontend) speaks
// snake_case. Only TOP-LEVEL keys are converted, so nested JSON column values
// (raw_payload, metrics_summary, reference_context) are passed through untouched.

export function keysToSnake(obj: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    out[key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = value;
  }
  return out;
}

export function keysToCamel(obj: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    out[key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
  }
  return out;
}
