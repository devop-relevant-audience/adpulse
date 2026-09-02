import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/lib/db";
import { dashboards } from "@/lib/db/schema";
import type {
  DashboardConfig,
  DashboardLayouts,
  DashboardSummary,
  DashboardVisibility,
  WidgetInstance,
} from "@/lib/dashboard/types";
import { DASHBOARD_CONFIG_VERSION } from "@/lib/dashboard/types";
import { buildDefaultDashboard } from "@/lib/dashboard/default-preset";
import { hydrateWidgets, stripLinkedConfigs } from "@/lib/data/saved-widgets";

// A client owns many named dashboard views. Each is either `internal` (agency
// staff only) or `client` (published, so a client_user sees it), and at most
// one is the default — enforced by the `dashboards_client_default_idx` partial
// unique index, so every write that sets a default clears the others first.

/** Thrown when a view name collides with an existing one for the same client. */
export class DashboardNameConflictError extends Error {
  constructor(name: string) {
    super(`A view named "${name}" already exists for this client`);
    this.name = "DashboardNameConflictError";
  }
}

const PG_UNIQUE_VIOLATION = "23505";

function isNameConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === PG_UNIQUE_VIOLATION &&
    String((error as { constraint_name?: string }).constraint_name ?? "").includes(
      "dashboards_client_name_idx"
    )
  );
}

const configColumns = {
  id: dashboards.id,
  clientId: dashboards.clientId,
  name: dashboards.name,
  visibility: dashboards.visibility,
  isDefault: dashboards.isDefault,
  layouts: dashboards.layouts,
  widgets: dashboards.widgets,
  version: dashboards.version,
};

type ConfigRow = {
  id: string;
  clientId: string;
  name: string;
  visibility: DashboardVisibility;
  isDefault: boolean;
  layouts: unknown;
  widgets: unknown;
  version: number;
};

/** A saved view plus the client it belongs to (routes verify the scope). */
export type SavedDashboard = DashboardConfig & { id: string; clientId: string };

/**
 * Row → served config. Widgets linked to the saved-widget library are stored as
 * bare pointers, so every read hydrates their config back in (see
 * `hydrateWidgets`) — the client always sees complete widgets. Inside a
 * transaction it must run on that transaction, or the hydration reads library
 * rows as they were before the transaction's own writes.
 */
async function toConfig(row: ConfigRow, conn: DbOrTx = db): Promise<SavedDashboard> {
  return {
    id: row.id,
    clientId: row.clientId,
    name: row.name,
    visibility: row.visibility,
    isDefault: row.isDefault,
    version: row.version,
    layouts: row.layouts as DashboardLayouts,
    widgets: await hydrateWidgets((row.widgets ?? []) as WidgetInstance[], conn),
  };
}

/** The views of a client, default first then newest-updated. */
export async function listDashboards(
  clientId: string,
  opts: { clientVisibleOnly?: boolean } = {}
): Promise<DashboardSummary[]> {
  const where = opts.clientVisibleOnly
    ? and(eq(dashboards.clientId, clientId), eq(dashboards.visibility, "client"))
    : eq(dashboards.clientId, clientId);

  const rows = await db
    .select({
      id: dashboards.id,
      name: dashboards.name,
      visibility: dashboards.visibility,
      isDefault: dashboards.isDefault,
      updatedAt: dashboards.updatedAt,
    })
    .from(dashboards)
    .where(where)
    .orderBy(desc(dashboards.isDefault), asc(dashboards.createdAt));

  return rows;
}

export async function getDashboardById(id: string): Promise<SavedDashboard | null> {
  const [row] = await db.select(configColumns).from(dashboards).where(eq(dashboards.id, id)).limit(1);
  return row ? toConfig(row) : null;
}

/**
 * The view a client opens on: its default, else its oldest view, else the
 * built-in preset (a pseudo-view with no id — saving it creates the row).
 */
export async function getDefaultDashboard(
  clientId: string,
  opts: { clientVisibleOnly?: boolean } = {}
): Promise<DashboardConfig> {
  const where = opts.clientVisibleOnly
    ? and(eq(dashboards.clientId, clientId), eq(dashboards.visibility, "client"))
    : eq(dashboards.clientId, clientId);

  const [row] = await db
    .select(configColumns)
    .from(dashboards)
    .where(where)
    .orderBy(desc(dashboards.isDefault), asc(dashboards.createdAt))
    .limit(1);

  return row ? toConfig(row) : buildDefaultDashboard();
}

/**
 * What a new view can be stamped from: another view of the same client, or an
 * agency dashboard template. Only the content matters — name/visibility/default
 * are decided here, never copied from the source.
 */
export type DashboardSource = {
  layouts: DashboardLayouts;
  widgets: WidgetInstance[];
  version?: number;
};

/** Create a view, optionally copying an existing view's or template's content. */
export async function createDashboard(
  clientId: string,
  { name, from }: { name: string; from?: DashboardSource }
): Promise<SavedDashboard> {
  // Widget instance ids only need to be unique inside one view, so a duplicate
  // copies widgets/layouts verbatim — minus the hydrated config of any linked
  // widget, which stays owned by the library row. No source = a truly blank
  // view (the dashboard's empty state offers the ways to fill it).
  const source: DashboardSource = from ?? {
    layouts: { lg: [], md: [], sm: [] },
    widgets: [],
  };
  const isFirst = await isFirstDashboard(clientId);

  try {
    const [row] = await db
      .insert(dashboards)
      .values({
        clientId,
        name,
        visibility: "internal",
        isDefault: isFirst,
        layouts: source.layouts,
        widgets: stripLinkedConfigs(source.widgets),
        version: source.version ?? DASHBOARD_CONFIG_VERSION,
      })
      .returning(configColumns);
    return toConfig(row);
  } catch (error) {
    if (isNameConflict(error)) throw new DashboardNameConflictError(name);
    throw error;
  }
}

export async function renameDashboard(id: string, name: string): Promise<SavedDashboard | null> {
  try {
    const [row] = await db
      .update(dashboards)
      .set({ name, updatedAt: sql`now()` })
      .where(eq(dashboards.id, id))
      .returning(configColumns);
    return row ? toConfig(row) : null;
  } catch (error) {
    if (isNameConflict(error)) throw new DashboardNameConflictError(name);
    throw error;
  }
}

export async function setDashboardVisibility(
  id: string,
  visibility: DashboardVisibility
): Promise<SavedDashboard | null> {
  const [row] = await db
    .update(dashboards)
    .set({ visibility, updatedAt: sql`now()` })
    .where(eq(dashboards.id, id))
    .returning(configColumns);
  return row ? toConfig(row) : null;
}

/** Promote one view to default, demoting the client's current default first. */
export async function setDefaultDashboard(
  clientId: string,
  id: string
): Promise<SavedDashboard | null> {
  return db.transaction(async (tx) => {
    await tx
      .update(dashboards)
      .set({ isDefault: false })
      .where(and(eq(dashboards.clientId, clientId), eq(dashboards.isDefault, true), ne(dashboards.id, id)));

    const [row] = await tx
      .update(dashboards)
      .set({ isDefault: true, updatedAt: sql`now()` })
      .where(and(eq(dashboards.id, id), eq(dashboards.clientId, clientId)))
      .returning(configColumns);

    return row ? toConfig(row, tx) : null;
  });
}

/** Delete a view; if it was the default, promote the oldest remaining one. */
export async function deleteDashboard(id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(dashboards)
      .where(eq(dashboards.id, id))
      .returning({ clientId: dashboards.clientId, isDefault: dashboards.isDefault });
    if (!deleted || !deleted.isDefault) return;

    const [next] = await tx
      .select({ id: dashboards.id })
      .from(dashboards)
      .where(eq(dashboards.clientId, deleted.clientId))
      .orderBy(asc(dashboards.createdAt))
      .limit(1);
    if (next) {
      await tx.update(dashboards).set({ isDefault: true }).where(eq(dashboards.id, next.id));
    }
  });
}

/**
 * Save a view's layout. With an id this updates that view; without one (the
 * built-in preset being saved for the first time) it creates the row.
 * `visibility`/`isDefault` are owned by the PATCH endpoint, not by saves.
 * Linked widgets are stored as bare pointers — the route resolves any
 * `syncToLibrary` write to the library before calling this, inside the same
 * transaction (`conn`), so a failed layout save cannot leave a library write
 * standing on its own.
 */
export async function upsertDashboard(
  clientId: string,
  config: DashboardConfig,
  conn: DbOrTx = db
): Promise<SavedDashboard> {
  const version = config.version ?? DASHBOARD_CONFIG_VERSION;

  if (config.id) {
    const [row] = await conn
      .update(dashboards)
      .set({
        name: config.name,
        layouts: config.layouts,
        widgets: stripLinkedConfigs(config.widgets),
        version,
        updatedAt: sql`now()`,
      })
      .where(and(eq(dashboards.id, config.id), eq(dashboards.clientId, clientId)))
      .returning(configColumns);
    if (row) return toConfig(row, conn);
    // The view was deleted in another tab — fall through and re-create it.
  }

  const isFirst = await isFirstDashboard(clientId, conn);
  try {
    const [row] = await conn
      .insert(dashboards)
      .values({
        clientId,
        name: config.name,
        visibility: config.visibility ?? "internal",
        isDefault: isFirst,
        layouts: config.layouts,
        widgets: stripLinkedConfigs(config.widgets),
        version,
      })
      .returning(configColumns);
    return toConfig(row, conn);
  } catch (error) {
    if (isNameConflict(error)) throw new DashboardNameConflictError(config.name);
    throw error;
  }
}

// The first view a client gets becomes its default; later ones do not.
async function isFirstDashboard(clientId: string, conn: DbOrTx = db): Promise<boolean> {
  const [existing] = await conn
    .select({ id: dashboards.id })
    .from(dashboards)
    .where(eq(dashboards.clientId, clientId))
    .limit(1);
  return !existing;
}
