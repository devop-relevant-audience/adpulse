// Thin fetch wrapper for the Windsor.ai connector API.
// https://windsor.ai/api-documentation/ — GET https://connectors.windsor.ai/{connector}
// Auth is a single agency-level API key (WINDSOR_API_KEY); one key exposes every
// ad account connected in the Windsor workspace.

const WINDSOR_BASE = "https://connectors.windsor.ai";

export type WindsorConnector = "facebook" | "google_ads" | "tiktok" | "all";

export type WindsorRow = Record<string, unknown>;

export class WindsorError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "WindsorError";
  }
}

export async function fetchWindsorRows(params: {
  connector: WindsorConnector;
  fields: readonly string[];
  /** Inclusive, YYYY-MM-DD (account-native dates as reported by the platform). */
  dateFrom: string;
  dateTo: string;
}): Promise<WindsorRow[]> {
  const apiKey = process.env.WINDSOR_API_KEY;
  if (!apiKey) {
    throw new WindsorError("WINDSOR_API_KEY is not configured");
  }

  const url = new URL(`${WINDSOR_BASE}/${params.connector}`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("fields", params.fields.join(","));
  url.searchParams.set("date_from", params.dateFrom);
  url.searchParams.set("date_to", params.dateTo);

  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new WindsorError(`Windsor ${params.connector} request failed`, res.status);
  }

  const body = (await res.json()) as { data?: WindsorRow[]; error?: unknown };
  if (body.error) {
    throw new WindsorError(
      `Windsor ${params.connector} returned an error: ${JSON.stringify(body.error).slice(0, 300)}`,
      res.status
    );
  }
  return body.data ?? [];
}
