import { asc, desc, eq, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/lib/db";
import { reportTemplates } from "@/lib/db/schema";
import type {
  DashboardLayouts,
  ReportTemplateSummary,
  WidgetInstance,
} from "@/lib/dashboard/types";
import { DASHBOARD_CONFIG_VERSION } from "@/lib/dashboard/types";
import { buildDefaultReportLayout } from "@/lib/dashboard/default-report-preset";
import { hydrateWidgets, stripLinkedConfigs } from "@/lib/data/saved-widgets";

// Agency-wide report templates: a named snapshot of one report layout's blocks,
// not tied to any client. Mirrors `src/lib/data/templates.ts` exactly.
//
// A template is a snapshot, not a live mirror: editing the source layout later
// does not change the template. Deleting a saved widget detaches report
// templates the same way it detaches dashboard views (see `deleteSavedWidget`),
// so a template never points at a missing library row.
//
// Exactly one row may carry `isMaster` (partial unique index): the master is
// what every new report layout starts from. It is created lazily, from the
// built-in report preset, the first time it is asked for, and it cannot be
// deleted — only edited.

/** Thrown when an operation is refused because the row is the master template. */
export class MasterReportTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MasterReportTemplateError";
  }
}

/** Thrown when a template name collides (case-insensitive unique index). */
export class ReportTemplateNameConflictError extends Error {
  constructor(name: string) {
    super(`A report template named "${name}" already exists`);
    this.name = "ReportTemplateNameConflictError";
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
  return isUniqueViolation(error, "report_templates_name_idx");
}

/** The snapshot itself — what `createReportLayout` needs to stamp a new layout. */
export interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  layouts: DashboardLayouts;
  widgets: WidgetInstance[];
  version: number;
  isMaster: boolean;
}

const templateColumns = {
  id: reportTemplates.id,
  name: reportTemplates.name,
  description: reportTemplates.description,
  layouts: reportTemplates.layouts,
  widgets: reportTemplates.widgets,
  version: reportTemplates.version,
  isMaster: reportTemplates.isMaster,
};

/** Name + description the master row is created with on first read. */
const MASTER_NAME = "Master report";
const MASTER_DESCRIPTION = "The layout every new report layout starts from.";

/** Widgets hydrated from the library — what an editor or a renderer needs. */
async function withHydratedWidgets(
  template: ReportTemplate,
  conn: DbOrTx = db
): Promise<ReportTemplate> {
  return { ...template, widgets: await hydrateWidgets(template.widgets ?? [], conn) };
}

/**
 * The template list. `widgetCount` comes from jsonb_array_length so the
 * (potentially large) widgets blob never leaves the database for a list read.
 */
export async function listReportTemplates(): Promise<ReportTemplateSummary[]> {
  return db
    .select({
      id: reportTemplates.id,
      name: reportTemplates.name,
      description: reportTemplates.description,
      widgetCount: sql<number>`jsonb_array_length(${reportTemplates.widgets})`.mapWith(Number),
      isMaster: reportTemplates.isMaster,
      updated_at: reportTemplates.updatedAt,
    })
    .from(reportTemplates)
    // The master is the one every other template is a variation of, so it heads
    // the list regardless of name.
    .orderBy(desc(reportTemplates.isMaster), asc(sql`lower(${reportTemplates.name})`));
}

export async function getReportTemplate(id: string): Promise<ReportTemplate | null> {
  const [row] = await db
    .select(templateColumns)
    .from(reportTemplates)
    .where(eq(reportTemplates.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * One template's content with its widgets HYDRATED from the library — what a
 * renderer needs. `getReportTemplate` deliberately stays in stored form: a
 * stamp copies pointers verbatim, so only the paths that draw a template (the
 * preview) pay for the hydration.
 */
export async function getReportTemplateContent(
  id: string,
  conn: DbOrTx = db
): Promise<ReportTemplate | null> {
  const [row] = await conn
    .select(templateColumns)
    .from(reportTemplates)
    .where(eq(reportTemplates.id, id))
    .limit(1);
  return row ? withHydratedWidgets(row, conn) : null;
}

/**
 * The master report template, created from the built-in report preset the first
 * time it is asked for. Widgets come back HYDRATED, so this feeds the master
 * editor and the preview directly.
 */
export async function getMasterReportTemplate(conn: DbOrTx = db): Promise<ReportTemplate> {
  const existing = await readMaster(conn);
  if (existing) return withHydratedWidgets(existing, conn);

  const preset = buildDefaultReportLayout();
  // A pre-existing template may already hold the master's name (the name index
  // is case-insensitive), so fall back to a suffixed one rather than 500ing.
  const name = (await nameTaken(conn, MASTER_NAME)) ? `${MASTER_NAME} (house)` : MASTER_NAME;
  try {
    const [row] = await conn
      .insert(reportTemplates)
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
      isUniqueViolation(error, "report_templates_master_idx") ||
      isUniqueViolation(error, "report_templates_name_idx")
    ) {
      const raced = await readMaster(conn);
      if (raced) return withHydratedWidgets(raced, conn);
    }
    throw error;
  }
}

async function nameTaken(conn: DbOrTx, name: string): Promise<boolean> {
  const [row] = await conn
    .select({ id: reportTemplates.id })
    .from(reportTemplates)
    .where(eq(sql`lower(${reportTemplates.name})`, name.toLowerCase()))
    .limit(1);
  return !!row;
}

async function readMaster(conn: DbOrTx): Promise<ReportTemplate | null> {
  const [row] = await conn
    .select(templateColumns)
    .from(reportTemplates)
    .where(eq(reportTemplates.isMaster, true))
    .limit(1);
  return row ?? null;
}

/**
 * Snapshot a layout into a new template. `stripLinkedConfigs` puts the widgets
 * into stored form: a linked instance keeps only its pointer, so the template
 * cannot fork an "agreed metric" widget's config.
 */
export async function createReportTemplate(input: {
  name: string;
  description: string;
  layouts: DashboardLayouts;
  widgets: WidgetInstance[];
  version?: number;
}): Promise<ReportTemplate> {
  try {
    const [row] = await db
      .insert(reportTemplates)
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
    if (isNameConflict(error)) throw new ReportTemplateNameConflictError(input.name);
    throw error;
  }
}

/** Rename / re-describe. Content editing is out of scope for this phase. */
export async function updateReportTemplate(
  id: string,
  input: { name?: string; description?: string }
): Promise<ReportTemplate | null> {
  if (input.name === undefined && input.description === undefined) return getReportTemplate(id);

  try {
    const [row] = await db
      .update(reportTemplates)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(reportTemplates.id, id))
      .returning(templateColumns);
    return row ?? null;
  } catch (error) {
    if (isNameConflict(error) && input.name !== undefined) {
      throw new ReportTemplateNameConflictError(input.name);
    }
    throw error;
  }
}

/**
 * Rewrite a template's blocks. This is the "edit the house report" path: the UI
 * only offers it for the master, but the API is by id. Widgets are stored in the
 * same pointer form as everywhere else and come back hydrated.
 */
export async function updateReportTemplateContent(
  id: string,
  input: { layouts: DashboardLayouts; widgets: WidgetInstance[]; version?: number },
  conn: DbOrTx = db
): Promise<ReportTemplate | null> {
  const [row] = await conn
    .update(reportTemplates)
    .set({
      layouts: input.layouts,
      widgets: stripLinkedConfigs(input.widgets),
      version: input.version ?? DASHBOARD_CONFIG_VERSION,
      updatedAt: sql`now()`,
    })
    .where(eq(reportTemplates.id, id))
    .returning(templateColumns);
  return row ? withHydratedWidgets(row, conn) : null;
}

/**
 * Deleting a template never touches the layouts stamped from it — it is a copy.
 * The master is the exception: it is what a new layout starts from, so it is
 * edited, never removed.
 */
export async function deleteReportTemplate(id: string): Promise<void> {
  const existing = await getReportTemplate(id);
  if (existing?.isMaster) {
    throw new MasterReportTemplateError("The master template cannot be deleted");
  }
  await db.delete(reportTemplates).where(eq(reportTemplates.id, id));
}
