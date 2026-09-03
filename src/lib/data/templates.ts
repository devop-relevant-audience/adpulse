import { asc, desc, eq, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/lib/db";
import { dashboardTemplates } from "@/lib/db/schema";
import type {
  DashboardLayouts,
  DashboardTemplateSummary,
  WidgetInstance,
} from "@/lib/dashboard/types";
import { DASHBOARD_CONFIG_VERSION } from "@/lib/dashboard/types";
import { buildDefaultDashboard } from "@/lib/dashboard/default-preset";
import { hydrateWidgets, stripLinkedConfigs } from "@/lib/data/saved-widgets";

// Agency-wide dashboard templates: a named snapshot of one view's layouts +
// widgets, not tied to any client. Creating a view from a template copies the
// snapshot verbatim — widget instance ids only need to be unique inside one
// view, so no re-keying is needed, and linked saved widgets stay linked.
//
// A template is a snapshot, not a live mirror: editing the source view later
// does not change the template. Deleting a saved widget detaches templates the
// same way it detaches views (see `deleteSavedWidget`), so a template never
// points at a missing library row.
//
// Exactly one row may carry `isMaster` (partial unique index): the master is
// what a client with no saved view renders and what a new view starts from. It
// is created lazily, from the built-in preset, the first time it is asked for,
// and it cannot be deleted — only edited.

/** Thrown when an operation is refused because the row is the master template. */
export class MasterTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MasterTemplateError";
  }
}

/** Thrown when a template name collides (case-insensitive unique index). */
export class TemplateNameConflictError extends Error {
  constructor(name: string) {
    super(`A template named "${name}" already exists`);
    this.name = "TemplateNameConflictError";
  }
}

const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown, index: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === PG_UNIQUE_VIOLATION &&
    String((error as { constraint_name?: string }).constraint_name ?? "").includes(index)
  );
}

function isNameConflict(error: unknown): boolean {
  return isUniqueViolation(error, "dashboard_templates_name_idx");
}

/** The snapshot itself — what `createDashboard` needs to stamp a new view. */
export interface DashboardTemplate {
  id: string;
  name: string;
  description: string;
  layouts: DashboardLayouts;
  widgets: WidgetInstance[];
  version: number;
  isMaster: boolean;
}

const templateColumns = {
  id: dashboardTemplates.id,
  name: dashboardTemplates.name,
  description: dashboardTemplates.description,
  layouts: dashboardTemplates.layouts,
  widgets: dashboardTemplates.widgets,
  version: dashboardTemplates.version,
  isMaster: dashboardTemplates.isMaster,
};

/** Name + description the master row is created with on first read. */
const MASTER_NAME = "Master dashboard";
const MASTER_DESCRIPTION = "The layout every new client and every new view starts from.";

/** Widgets hydrated from the library — what an editor or a renderer needs. */
async function withHydratedWidgets(
  template: DashboardTemplate,
  conn: DbOrTx = db
): Promise<DashboardTemplate> {
  return { ...template, widgets: await hydrateWidgets(template.widgets ?? [], conn) };
}

/**
 * The template list. `widgetCount` comes from jsonb_array_length so the
 * (potentially large) widgets blob never leaves the database for a list read.
 */
export async function listTemplates(): Promise<DashboardTemplateSummary[]> {
  return db
    .select({
      id: dashboardTemplates.id,
      name: dashboardTemplates.name,
      description: dashboardTemplates.description,
      widgetCount: sql<number>`jsonb_array_length(${dashboardTemplates.widgets})`.mapWith(Number),
      isMaster: dashboardTemplates.isMaster,
      updated_at: dashboardTemplates.updatedAt,
    })
    .from(dashboardTemplates)
    // The master is the one every other template is a variation of, so it heads
    // the list regardless of name.
    .orderBy(desc(dashboardTemplates.isMaster), asc(sql`lower(${dashboardTemplates.name})`));
}

export async function getTemplate(id: string): Promise<DashboardTemplate | null> {
  const [row] = await db
    .select(templateColumns)
    .from(dashboardTemplates)
    .where(eq(dashboardTemplates.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * The master template, created from the built-in preset the first time it is
 * asked for. Widgets come back HYDRATED: this feeds both the master editor and
 * the default dashboard a client with no saved view renders.
 */
export async function getMasterTemplate(conn: DbOrTx = db): Promise<DashboardTemplate> {
  const existing = await readMaster(conn);
  if (existing) return withHydratedWidgets(existing, conn);

  const preset = buildDefaultDashboard(MASTER_NAME);
  // A pre-existing template may already hold the master's name (the name index
  // is case-insensitive), so fall back to a suffixed one rather than 500ing.
  const name = (await nameTaken(conn, MASTER_NAME)) ? `${MASTER_NAME} (house)` : MASTER_NAME;
  try {
    const [row] = await conn
      .insert(dashboardTemplates)
      .values({
        name,
        description: MASTER_DESCRIPTION,
        layouts: preset.layouts,
        widgets: stripLinkedConfigs(preset.widgets),
        version: preset.version,
        isMaster: true,
      })
      .returning(templateColumns);
    return withHydratedWidgets(row, conn);
  } catch (error) {
    // Two first requests raced: whichever insert lost reads the winner's row.
    // A name collision counts too — a template already holds the master's name.
    if (
      isUniqueViolation(error, "dashboard_templates_master_idx") ||
      isUniqueViolation(error, "dashboard_templates_name_idx")
    ) {
      const raced = await readMaster(conn);
      if (raced) return withHydratedWidgets(raced, conn);
    }
    throw error;
  }
}

async function nameTaken(conn: DbOrTx, name: string): Promise<boolean> {
  const [row] = await conn
    .select({ id: dashboardTemplates.id })
    .from(dashboardTemplates)
    .where(eq(sql`lower(${dashboardTemplates.name})`, name.toLowerCase()))
    .limit(1);
  return !!row;
}

async function readMaster(conn: DbOrTx): Promise<DashboardTemplate | null> {
  const [row] = await conn
    .select(templateColumns)
    .from(dashboardTemplates)
    .where(eq(dashboardTemplates.isMaster, true))
    .limit(1);
  return row ?? null;
}

/**
 * Snapshot a view into a new template. `stripLinkedConfigs` puts the widgets
 * into stored form: a linked instance keeps only its pointer, so the template
 * cannot fork an "agreed metric" widget's config.
 */
export async function createTemplate(input: {
  name: string;
  description: string;
  layouts: DashboardLayouts;
  widgets: WidgetInstance[];
  version?: number;
}): Promise<DashboardTemplate> {
  try {
    const [row] = await db
      .insert(dashboardTemplates)
      .values({
        name: input.name,
        description: input.description,
        layouts: input.layouts,
        widgets: stripLinkedConfigs(input.widgets),
        version: input.version ?? DASHBOARD_CONFIG_VERSION,
      })
      .returning(templateColumns);
    return row;
  } catch (error) {
    if (isNameConflict(error)) throw new TemplateNameConflictError(input.name);
    throw error;
  }
}

/** Rename / re-describe. Content editing is out of scope for this phase. */
export async function updateTemplate(
  id: string,
  input: { name?: string; description?: string }
): Promise<DashboardTemplate | null> {
  if (input.name === undefined && input.description === undefined) return getTemplate(id);

  try {
    const [row] = await db
      .update(dashboardTemplates)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(dashboardTemplates.id, id))
      .returning(templateColumns);
    return row ?? null;
  } catch (error) {
    if (isNameConflict(error) && input.name !== undefined) {
      throw new TemplateNameConflictError(input.name);
    }
    throw error;
  }
}

/**
 * Rewrite a template's blocks. This is the "edit the house layout" path: the
 * UI only offers it for the master, but the API is by id. Widgets are stored in
 * the same pointer form as everywhere else and come back hydrated.
 */
export async function updateTemplateContent(
  id: string,
  input: { layouts: DashboardLayouts; widgets: WidgetInstance[]; version?: number },
  conn: DbOrTx = db
): Promise<DashboardTemplate | null> {
  const [row] = await conn
    .update(dashboardTemplates)
    .set({
      layouts: input.layouts,
      widgets: stripLinkedConfigs(input.widgets),
      version: input.version ?? DASHBOARD_CONFIG_VERSION,
      updatedAt: sql`now()`,
    })
    .where(eq(dashboardTemplates.id, id))
    .returning(templateColumns);
  return row ? withHydratedWidgets(row, conn) : null;
}

/**
 * Deleting a template never touches the views stamped from it — it is a copy.
 * The master is the exception: it is the fallback a client with no saved view
 * renders, so it is edited, never removed.
 */
export async function deleteTemplate(id: string): Promise<void> {
  const existing = await getTemplate(id);
  if (existing?.isMaster) {
    throw new MasterTemplateError("The master template cannot be deleted");
  }
  await db.delete(dashboardTemplates).where(eq(dashboardTemplates.id, id));
}
