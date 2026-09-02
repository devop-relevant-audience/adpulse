import { asc, eq, inArray, sql, type AnyColumn } from "drizzle-orm";
import { db, type DbOrTx } from "@/lib/db";
import {
  clients,
  dashboardTemplates,
  dashboards,
  reportLayouts,
  reportTemplates,
  savedWidgets,
} from "@/lib/db/schema";
import type {
  GridSurface,
  SavedWidget,
  SavedWidgetUsage,
  WidgetInstance,
  WidgetType,
} from "@/lib/dashboard/types";
import { surfaceAllows } from "@/lib/dashboard/types";
import { validateWidgetConfig, type WidgetInstancePayload } from "@/lib/dashboard/widget-schemas";

// The agency-wide saved widget library. A saved widget is ONE piece of data:
// dashboard views store `{ i, type, savedWidgetId }` with no inline config, so
// editing a library row changes every view that uses it. Reads hydrate the
// config back into the view (see `hydrateWidgets`), deletes detach first.

/** Thrown when a library name collides (case-insensitive unique index). */
export class SavedWidgetNameConflictError extends Error {
  constructor(name: string) {
    super(`A saved widget named "${name}" already exists`);
    this.name = "SavedWidgetNameConflictError";
  }
}

const PG_UNIQUE_VIOLATION = "23505";

function isNameConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === PG_UNIQUE_VIOLATION &&
    String((error as { constraint_name?: string }).constraint_name ?? "").includes(
      "saved_widgets_name_idx"
    )
  );
}

const listColumns = {
  id: savedWidgets.id,
  name: savedWidgets.name,
  widget_type: savedWidgets.widgetType,
  config: savedWidgets.config,
  updated_at: savedWidgets.updatedAt,
};

export async function listSavedWidgets(): Promise<SavedWidget[]> {
  return db.select(listColumns).from(savedWidgets).orderBy(asc(sql`lower(${savedWidgets.name})`));
}

export async function getSavedWidget(id: string): Promise<SavedWidget | null> {
  const [row] = await db.select(listColumns).from(savedWidgets).where(eq(savedWidgets.id, id)).limit(1);
  return row ?? null;
}

/** Library rows for a set of ids, keyed by id (used to hydrate + type-check). */
export async function getSavedWidgetsByIds(
  ids: string[],
  conn: DbOrTx = db
): Promise<Map<string, SavedWidget>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();

  const rows = await conn.select(listColumns).from(savedWidgets).where(inArray(savedWidgets.id, unique));

  return new Map(rows.map((row) => [row.id, row]));
}

export async function createSavedWidget(input: {
  name: string;
  widgetType: WidgetType;
  config: Record<string, unknown>;
}): Promise<SavedWidget> {
  try {
    const [row] = await db
      .insert(savedWidgets)
      .values({ name: input.name, widgetType: input.widgetType, config: input.config })
      .returning(listColumns);
    return row;
  } catch (error) {
    if (isNameConflict(error)) throw new SavedWidgetNameConflictError(input.name);
    throw error;
  }
}

/** Rename and/or rewrite the config. A config write is the "update everywhere". */
export async function updateSavedWidget(
  id: string,
  input: { name?: string; config?: Record<string, unknown> },
  conn: DbOrTx = db
): Promise<SavedWidget | null> {
  if (input.name === undefined && input.config === undefined) return getSavedWidget(id);

  try {
    const [row] = await conn
      .update(savedWidgets)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.config !== undefined ? { config: input.config } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(savedWidgets.id, id))
      .returning(listColumns);
    return row ?? null;
  } catch (error) {
    if (isNameConflict(error) && input.name !== undefined) {
      throw new SavedWidgetNameConflictError(input.name);
    }
    throw error;
  }
}

/**
 * Detach-then-delete: every dashboard instance pointing at this row first gets
 * the library config written inline (and loses `savedWidgetId`), then the row
 * goes. Dashboard TEMPLATES, REPORT LAYOUTS and REPORT TEMPLATES store the same
 * pointer, so all four are materialized in the same transaction — nothing is
 * ever left referencing a missing entry.
 */
export async function deleteSavedWidget(id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [entry] = await tx
      .select({ config: savedWidgets.config })
      .from(savedWidgets)
      .where(eq(savedWidgets.id, id))
      .limit(1);
    if (!entry) return;

    const detach = (widgets: WidgetInstance[]) =>
      widgets.map((widget) =>
        widget.savedWidgetId === id
          ? { i: widget.i, type: widget.type, config: { ...(entry.config ?? {}) } }
          : widget
      );

    const referencing = await tx
      .select({ id: dashboards.id, widgets: dashboards.widgets })
      .from(dashboards)
      .where(usesSavedWidget(dashboards.widgets, id));

    for (const view of referencing) {
      await tx
        .update(dashboards)
        .set({ widgets: detach(view.widgets ?? []), updatedAt: sql`now()` })
        .where(eq(dashboards.id, view.id));
    }

    const templates = await tx
      .select({ id: dashboardTemplates.id, widgets: dashboardTemplates.widgets })
      .from(dashboardTemplates)
      .where(usesSavedWidget(dashboardTemplates.widgets, id));

    for (const template of templates) {
      await tx
        .update(dashboardTemplates)
        .set({ widgets: detach(template.widgets ?? []), updatedAt: sql`now()` })
        .where(eq(dashboardTemplates.id, template.id));
    }

    const layouts = await tx
      .select({ id: reportLayouts.id, widgets: reportLayouts.widgets })
      .from(reportLayouts)
      .where(usesSavedWidget(reportLayouts.widgets, id));

    for (const layout of layouts) {
      await tx
        .update(reportLayouts)
        .set({ widgets: detach(layout.widgets ?? []), updatedAt: sql`now()` })
        .where(eq(reportLayouts.id, layout.id));
    }

    const reportBlueprints = await tx
      .select({ id: reportTemplates.id, widgets: reportTemplates.widgets })
      .from(reportTemplates)
      .where(usesSavedWidget(reportTemplates.widgets, id));

    for (const template of reportBlueprints) {
      await tx
        .update(reportTemplates)
        .set({ widgets: detach(template.widgets ?? []), updatedAt: sql`now()` })
        .where(eq(reportTemplates.id, template.id));
    }

    await tx.delete(savedWidgets).where(eq(savedWidgets.id, id));
  });
}

/** jsonb containment against a `widgets` column — hits its GIN index. */
function usesSavedWidget(column: AnyColumn, id: string) {
  return sql`${column} @> ${JSON.stringify([{ savedWidgetId: id }])}::jsonb`;
}

/**
 * Everywhere a library entry is used, named for the confirm dialog: client
 * dashboard views, agency dashboard templates, client report layouts and agency
 * report templates. `count` covers all four — an "update everywhere" changes
 * what a template will stamp out just as much as a live view.
 */
export async function getSavedWidgetUsage(id: string): Promise<SavedWidgetUsage> {
  const [views, templates, layouts, reportBlueprints] = await Promise.all([
    db
      .select({
        dashboardId: dashboards.id,
        dashboardName: dashboards.name,
        clientId: dashboards.clientId,
        clientName: clients.name,
      })
      .from(dashboards)
      .innerJoin(clients, eq(clients.id, dashboards.clientId))
      .where(usesSavedWidget(dashboards.widgets, id))
      .orderBy(asc(clients.name), asc(dashboards.name)),
    db
      .select({
        templateId: dashboardTemplates.id,
        templateName: dashboardTemplates.name,
      })
      .from(dashboardTemplates)
      .where(usesSavedWidget(dashboardTemplates.widgets, id))
      .orderBy(asc(dashboardTemplates.name)),
    db
      .select({
        layoutId: reportLayouts.id,
        layoutName: reportLayouts.name,
        clientId: reportLayouts.clientId,
        clientName: clients.name,
      })
      .from(reportLayouts)
      .innerJoin(clients, eq(clients.id, reportLayouts.clientId))
      .where(usesSavedWidget(reportLayouts.widgets, id))
      .orderBy(asc(clients.name), asc(reportLayouts.name)),
    db
      .select({
        templateId: reportTemplates.id,
        templateName: reportTemplates.name,
      })
      .from(reportTemplates)
      .where(usesSavedWidget(reportTemplates.widgets, id))
      .orderBy(asc(reportTemplates.name)),
  ]);

  return {
    count: views.length + templates.length + layouts.length + reportBlueprints.length,
    views,
    templates,
    reportLayouts: layouts,
    reportTemplates: reportBlueprints,
  };
}

/**
 * Fill each linked instance's `config`/`type` from its library row so the
 * client always sees a complete widget. A link whose row is gone (which
 * detach-then-delete should prevent) degrades to an empty standalone widget.
 */
export async function hydrateWidgets(
  widgets: WidgetInstance[],
  conn: DbOrTx = db
): Promise<WidgetInstance[]> {
  const linkedIds = widgets.flatMap((w) => (w.savedWidgetId ? [w.savedWidgetId] : []));
  if (linkedIds.length === 0) return widgets;

  const library = await getSavedWidgetsByIds(linkedIds, conn);

  return widgets.map((widget) => {
    if (!widget.savedWidgetId) return widget;
    const entry = library.get(widget.savedWidgetId);
    if (!entry) return { i: widget.i, type: widget.type, config: {} };
    return {
      i: widget.i,
      type: entry.widget_type,
      config: { ...entry.config },
      savedWidgetId: entry.id,
    };
  });
}

/**
 * The inverse: what actually gets stored. A linked instance keeps only its
 * pointer (the library owns the config); `syncToLibrary` is transient and never
 * persisted. Applied on every dashboard write, so a duplicate/copy of a view
 * cannot silently fork a linked widget's config.
 */
export function stripLinkedConfigs(widgets: WidgetInstance[]): WidgetInstance[] {
  return widgets.map((widget) =>
    widget.savedWidgetId
      ? { i: widget.i, type: widget.type, config: {}, savedWidgetId: widget.savedWidgetId }
      : { i: widget.i, type: widget.type, config: widget.config }
  );
}

export type ResolvedWidget = {
  i: string;
  type: string;
  config: Record<string, unknown>;
  savedWidgetId?: string;
};

export type ResolvedWidgets =
  | { ok: true; widgets: ResolvedWidget[]; syncs: { id: string; config: Record<string, unknown> }[] }
  | { ok: false; issues: Record<string, string[]> };

/**
 * Per-widget config validation (strict for "custom", shared `filters` shape for
 * every other known type), plus the saved-widget linkage rules. Shared by every
 * grid PUT — dashboard views and report layouts store the same widget form, so
 * they must resolve links identically:
 *
 * - A linked instance stores only its pointer — the library row owns the
 *   config, so whatever config the client sent is ignored...
 * - ...unless it carries the transient `syncToLibrary` flag ("update
 *   everywhere"), in which case the config is validated and returned as a
 *   `sync` for the caller to write back to the library row inside its own
 *   transaction (never stored inline either way).
 * - The instance's type must match the library row's type.
 * - A link whose library row is gone (raced with a delete) degrades to a
 *   standalone widget with the config the client sent, rather than failing.
 *
 * Issues are keyed by widget instance id.
 */
export async function resolveWidgets(
  widgets: WidgetInstancePayload[],
  /** The grid being saved — report-only block types are refused on "dashboard". */
  surface: GridSurface
): Promise<ResolvedWidgets> {
  const library = await getSavedWidgetsByIds(
    widgets.flatMap((w) => (w.savedWidgetId ? [w.savedWidgetId] : []))
  );

  const issues: Record<string, string[]> = {};
  const resolved: ResolvedWidget[] = [];
  const syncs: { id: string; config: Record<string, unknown> }[] = [];

  for (const widget of widgets) {
    // Checked before the link is resolved: a linked instance never reaches
    // validateWidgetConfig, so this is the only place a library entry of a
    // report-only type can be stopped from landing on a dashboard view.
    if (!surfaceAllows(widget.type, surface)) {
      issues[widget.i] = [`widget type "${widget.type}" is not available on a ${surface}`];
      continue;
    }

    const entry = widget.savedWidgetId ? library.get(widget.savedWidgetId) : undefined;

    if (entry && entry.widget_type !== widget.type) {
      issues[widget.i] = [
        `type "${widget.type}" does not match saved widget type "${entry.widget_type}"`,
      ];
      continue;
    }

    if (entry && !widget.syncToLibrary) {
      resolved.push({ i: widget.i, type: entry.widget_type, config: {}, savedWidgetId: entry.id });
      continue;
    }

    const result = validateWidgetConfig(widget.type, widget.config, surface);
    if (!result.ok) {
      issues[widget.i] = result.issues;
      continue;
    }

    if (entry) {
      syncs.push({ id: entry.id, config: result.config });
      resolved.push({ i: widget.i, type: entry.widget_type, config: {}, savedWidgetId: entry.id });
    } else {
      resolved.push({ i: widget.i, type: widget.type, config: result.config });
    }
  }

  if (Object.keys(issues).length > 0) return { ok: false, issues };
  return { ok: true, widgets: resolved, syncs };
}
