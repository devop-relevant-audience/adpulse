import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/lib/db";
import { reportLayouts } from "@/lib/db/schema";
import type {
  DashboardLayouts,
  ReportLayoutConfig,
  ReportLayoutSummary,
  WidgetInstance,
} from "@/lib/dashboard/types";
import { DASHBOARD_CONFIG_VERSION } from "@/lib/dashboard/types";
import { hydrateWidgets, stripLinkedConfigs } from "@/lib/data/saved-widgets";

// A client owns many named report layouts — the editable block structure a
// report is generated from. This mirrors `src/lib/data/dashboards.ts` one for
// one, minus the sharing knobs: a layout has no `visibility` and no
// `isDefault`, because layouts are agency-internal by definition. What a client
// sees is the generated report (reports.view_snapshot), never the layout.
//
// A blank layout is genuinely empty (no default preset): reports are authored
// block by block, so there is nothing sensible to pre-fill.

/** Thrown when a layout name collides with an existing one for the same client. */
export class ReportLayoutNameConflictError extends Error {
  constructor(name: string) {
    super(`A report layout named "${name}" already exists for this client`);
    this.name = "ReportLayoutNameConflictError";
  }
}

const PG_UNIQUE_VIOLATION = "23505";

function isNameConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === PG_UNIQUE_VIOLATION &&
    String((error as { constraint_name?: string }).constraint_name ?? "").includes(
      "report_layouts_client_name_idx"
    )
  );
}

const configColumns = {
  id: reportLayouts.id,
  clientId: reportLayouts.clientId,
  name: reportLayouts.name,
  layouts: reportLayouts.layouts,
  widgets: reportLayouts.widgets,
  version: reportLayouts.version,
};

type ConfigRow = {
  id: string;
  clientId: string;
  name: string;
  layouts: unknown;
  widgets: unknown;
  version: number;
};

/** A saved layout plus the client it belongs to (routes verify the scope). */
export type SavedReportLayout = ReportLayoutConfig & { id: string; clientId: string };

/**
 * Row → served config. Widgets linked to the saved-widget library are stored as
 * bare pointers, so every read hydrates their config back in (see
 * `hydrateWidgets`). Inside a transaction it must run on that transaction, or
 * the hydration reads library rows as they were before the transaction's own
 * writes.
 */
async function toConfig(row: ConfigRow, conn: DbOrTx = db): Promise<SavedReportLayout> {
  return {
    id: row.id,
    clientId: row.clientId,
    name: row.name,
    version: row.version,
    layouts: row.layouts as DashboardLayouts,
    widgets: await hydrateWidgets((row.widgets ?? []) as WidgetInstance[], conn),
  };
}

/** The layouts of a client, most recently edited first. */
export async function listReportLayouts(clientId: string): Promise<ReportLayoutSummary[]> {
  return db
    .select({
      id: reportLayouts.id,
      name: reportLayouts.name,
      updatedAt: reportLayouts.updatedAt,
    })
    .from(reportLayouts)
    .where(eq(reportLayouts.clientId, clientId))
    .orderBy(desc(reportLayouts.updatedAt), asc(reportLayouts.name));
}

export async function getReportLayoutById(id: string): Promise<SavedReportLayout | null> {
  const [row] = await db
    .select(configColumns)
    .from(reportLayouts)
    .where(eq(reportLayouts.id, id))
    .limit(1);
  return row ? toConfig(row) : null;
}

/**
 * What a new layout can be stamped from: another layout of the same client, or
 * an agency report template. Only the content matters — the name is decided
 * here, never copied from the source.
 */
export type ReportLayoutSource = {
  layouts: DashboardLayouts;
  widgets: WidgetInstance[];
  version?: number;
};

/** Create a layout, optionally copying an existing layout's or template's content. */
export async function createReportLayout(
  clientId: string,
  { name, from }: { name: string; from?: ReportLayoutSource }
): Promise<SavedReportLayout> {
  // Widget instance ids only need to be unique inside one layout, so a
  // duplicate copies widgets/layouts verbatim — minus the hydrated config of
  // any linked widget, which stays owned by the library row.
  const source: ReportLayoutSource = from ?? {
    layouts: { lg: [], md: [], sm: [] },
    widgets: [],
  };

  try {
    const [row] = await db
      .insert(reportLayouts)
      .values({
        clientId,
        name,
        layouts: source.layouts,
        widgets: stripLinkedConfigs(source.widgets),
        version: source.version ?? DASHBOARD_CONFIG_VERSION,
      })
      .returning(configColumns);
    return toConfig(row);
  } catch (error) {
    if (isNameConflict(error)) throw new ReportLayoutNameConflictError(name);
    throw error;
  }
}

export async function renameReportLayout(
  id: string,
  name: string
): Promise<SavedReportLayout | null> {
  try {
    const [row] = await db
      .update(reportLayouts)
      .set({ name, updatedAt: sql`now()` })
      .where(eq(reportLayouts.id, id))
      .returning(configColumns);
    return row ? toConfig(row) : null;
  } catch (error) {
    if (isNameConflict(error)) throw new ReportLayoutNameConflictError(name);
    throw error;
  }
}

/**
 * Delete a layout. Reports already generated from it are untouched — they hold
 * their own frozen snapshot and never read the layout again.
 */
export async function deleteReportLayout(id: string): Promise<void> {
  await db.delete(reportLayouts).where(eq(reportLayouts.id, id));
}

/**
 * Save a layout's blocks. With an id this updates that layout; without one (or
 * when the row was deleted in another tab) it creates the row. Linked widgets
 * are stored as bare pointers — the route resolves any `syncToLibrary` write to
 * the library before calling this, inside the same transaction (`conn`), so a
 * failed layout save cannot leave a library write standing on its own.
 */
export async function upsertReportLayout(
  clientId: string,
  config: ReportLayoutConfig,
  conn: DbOrTx = db
): Promise<SavedReportLayout> {
  const version = config.version ?? DASHBOARD_CONFIG_VERSION;

  try {
    if (config.id) {
      const [row] = await conn
        .update(reportLayouts)
        .set({
          name: config.name,
          layouts: config.layouts,
          widgets: stripLinkedConfigs(config.widgets),
          version,
          updatedAt: sql`now()`,
        })
        .where(and(eq(reportLayouts.id, config.id), eq(reportLayouts.clientId, clientId)))
        .returning(configColumns);
      if (row) return toConfig(row, conn);
      // The layout was deleted in another tab — fall through and re-create it.
    }

    const [row] = await conn
      .insert(reportLayouts)
      .values({
        clientId,
        name: config.name,
        layouts: config.layouts,
        widgets: stripLinkedConfigs(config.widgets),
        version,
      })
      .returning(configColumns);
    return toConfig(row, conn);
  } catch (error) {
    if (isNameConflict(error)) throw new ReportLayoutNameConflictError(config.name);
    throw error;
  }
}
