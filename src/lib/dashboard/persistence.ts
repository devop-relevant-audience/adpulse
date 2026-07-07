import type { DashboardConfig } from "./types";

// Stage 1 persistence: browser localStorage, keyed per client. Stage 3 swaps
// the hook (src/hooks/use-dashboard.ts) to the /api/dashboards endpoint while
// keeping these as an offline/optimistic cache.
const keyFor = (clientId: string) => `adpulse:dashboard:${clientId}`;

export function loadLocalDashboard(clientId: string): DashboardConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(keyFor(clientId));
    return raw ? (JSON.parse(raw) as DashboardConfig) : null;
  } catch {
    return null;
  }
}

export function saveLocalDashboard(clientId: string, config: DashboardConfig): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyFor(clientId), JSON.stringify(config));
  } catch {
    /* quota / disabled storage — non-fatal */
  }
}

export function clearLocalDashboard(clientId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(keyFor(clientId));
  } catch {
    /* non-fatal */
  }
}
