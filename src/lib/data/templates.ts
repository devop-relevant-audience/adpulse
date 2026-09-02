import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { dashboardTemplates } from "@/lib/db/schema";
import type {
  DashboardLayouts,
  DashboardTemplateSummary,
  WidgetInstance,
} from "@/lib/dashboard/types";
import { DASHBOARD_CONFIG_VERSION } from "@/lib/dashboard/types";
import { stripLinkedConfigs } from "@/lib/data/saved-widgets";

// Agency-wide dashboard templates: a named snapshot of one view's layouts +
// widgets, not tied to any client. Creating a view from a template copies the
// snapshot verbatim — widget instance ids only need to be unique inside one
// view, so no re-keying is needed, and linked saved widgets stay linked.
//
// A template is a snapshot, not a live mirror: editing the source view later
// does not change the template, and this phase has no content editing (only
// name/description). Deleting a saved widget detaches templates the same way it
// detaches views (see `deleteSavedWidget`), so a template never points at a
// missing library row.

/** Thrown when a template name collides (case-insensitive unique index). */
export class TemplateNameConflictError extends Error {
  constructor(name: string) {
    super(`A template named "${name}" already exists`);
    this.name = "TemplateNameConflictError";
  }
}

const PG_UNIQUE_VIOLATION = "23505";

function isNameConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === PG_UNIQUE_VIOLATION &&
    String((error as { constraint_name?: string }).constraint_name ?? "").includes(
      "dashboard_templates_name_idx"
    )
  );
}

/** The snapshot itself — what `createDashboard` needs to stamp a new view. */
export interface DashboardTemplate {
  id: string;
  name: string;
  description: string;
  layouts: DashboardLayouts;
  widgets: WidgetInstance[];
  version: number;
}

const templateColumns = {
  id: dashboardTemplates.id,
  name: dashboardTemplates.name,
  description: dashboardTemplates.description,
  layouts: dashboardTemplates.layouts,
  widgets: dashboardTemplates.widgets,
  version: dashboardTemplates.version,
};

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
      updated_at: dashboardTemplates.updatedAt,
    })
    .from(dashboardTemplates)
    .orderBy(asc(sql`lower(${dashboardTemplates.name})`));
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

/** Deleting a template never touches the views stamped from it — it is a copy. */
export async function deleteTemplate(id: string): Promise<void> {
  await db.delete(dashboardTemplates).where(eq(dashboardTemplates.id, id));
}
