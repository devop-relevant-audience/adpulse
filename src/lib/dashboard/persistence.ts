import type { DashboardConfig } from "./types";

// Offline/optimistic cache for the server-persisted dashboard views
// (/api/dashboards). Keyed per client AND per view id, since a client now has
// many views; the default view (no explicit id) uses the "default" slot.
const keyFor = (clientId: string, viewId?: string | null) =>
  `adpulse:dashboard:${clientId}:${viewId ?? "default"}`;

export function loadLocalDashboard(clientId: string, viewId?: string | null): DashboardConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(keyFor(clientId, viewId));
    return raw ? (JSON.parse(raw) as DashboardConfig) : null;
  } catch {
    return null;
  }
}

export function saveLocalDashboard(
  clientId: string,
  config: DashboardConfig,
  viewId?: string | null
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyFor(clientId, viewId), JSON.stringify(config));
  } catch {
    /* quota / disabled storage — non-fatal */
  }
}

export function clearLocalDashboard(clientId: string, viewId?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(keyFor(clientId, viewId));
  } catch {
    /* non-fatal */
  }
}
