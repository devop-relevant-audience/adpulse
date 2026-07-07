import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { dashboards } from "@/lib/db/schema";
import type { DashboardConfig, DashboardLayouts, WidgetInstance } from "@/lib/dashboard/types";
import { DASHBOARD_CONFIG_VERSION } from "@/lib/dashboard/types";
import { buildDefaultDashboard } from "@/lib/dashboard/default-preset";

// Fetch a client's saved dashboard, or the default preset if none exists yet.
export async function getDashboard(clientId: string, name = "Default"): Promise<DashboardConfig> {
  const rows = await db
    .select({
      name: dashboards.name,
      layouts: dashboards.layouts,
      widgets: dashboards.widgets,
      version: dashboards.version,
    })
    .from(dashboards)
    .where(and(eq(dashboards.clientId, clientId), eq(dashboards.name, name)))
    .limit(1);

  if (rows.length === 0) return buildDefaultDashboard(name);

  const row = rows[0];
  return {
    name: row.name,
    version: row.version,
    layouts: row.layouts as DashboardLayouts,
    widgets: row.widgets as WidgetInstance[],
  };
}

// Insert-or-update the client's dashboard (unique on client_id + name).
export async function upsertDashboard(
  clientId: string,
  config: DashboardConfig
): Promise<DashboardConfig> {
  await db
    .insert(dashboards)
    .values({
      clientId,
      name: config.name,
      layouts: config.layouts,
      widgets: config.widgets,
      version: config.version ?? DASHBOARD_CONFIG_VERSION,
    })
    .onConflictDoUpdate({
      target: [dashboards.clientId, dashboards.name],
      set: {
        layouts: config.layouts,
        widgets: config.widgets,
        version: config.version ?? DASHBOARD_CONFIG_VERSION,
        updatedAt: sql`now()`,
      },
    });

  return config;
}
