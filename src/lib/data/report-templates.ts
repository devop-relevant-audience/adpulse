import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { reportTemplates } from "@/lib/db/schema";
import type {
  DashboardLayouts,
  ReportTemplateSummary,
  WidgetInstance,
} from "@/lib/dashboard/types";
import { DASHBOARD_CONFIG_VERSION } from "@/lib/dashboard/types";
import { stripLinkedConfigs } from "@/lib/data/saved-widgets";

// Agency-wide report templates: a named snapshot of one report layout's blocks,
// not tied to any client. Mirrors `src/lib/data/templates.ts` exactly.
//
// A template is a snapshot, not a live mirror: editing the source layout later
// does not change the template, and this phase has no content editing (only
// name/description). Deleting a saved widget detaches report templates the same
// way it detaches dashboard views (see `deleteSavedWidget`), so a template never
// points at a missing library row.

/** Thrown when a template name collides (case-insensitive unique index). */
export class ReportTemplateNameConflictError extends Error {
  constructor(name: string) {
    super(`A report template named "${name}" already exists`);
    this.name = "ReportTemplateNameConflictError";
  }
}

const PG_UNIQUE_VIOLATION = "23505";

function isNameConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === PG_UNIQUE_VIOLATION &&
    String((error as { constraint_name?: string }).constraint_name ?? "").includes(
      "report_templates_name_idx"
    )
  );
}

/** The snapshot itself — what `createReportLayout` needs to stamp a new layout. */
export interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  layouts: DashboardLayouts;
  widgets: WidgetInstance[];
  version: number;
}

const templateColumns = {
  id: reportTemplates.id,
  name: reportTemplates.name,
  description: reportTemplates.description,
  layouts: reportTemplates.layouts,
  widgets: reportTemplates.widgets,
  version: reportTemplates.version,
};

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
      updated_at: reportTemplates.updatedAt,
    })
    .from(reportTemplates)
    .orderBy(asc(sql`lower(${reportTemplates.name})`));
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

/** Deleting a template never touches the layouts stamped from it — it is a copy. */
export async function deleteReportTemplate(id: string): Promise<void> {
  await db.delete(reportTemplates).where(eq(reportTemplates.id, id));
}
