import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  ReportLayoutNameConflictError,
  createReportLayout,
  deleteReportLayout,
  getReportLayoutById,
  listReportLayouts,
  renameReportLayout,
  upsertReportLayout,
  type ReportLayoutSource,
} from "@/lib/data/report-layouts";
import { getReportTemplate } from "@/lib/data/report-templates";
import { DASHBOARD_CONFIG_VERSION } from "@/lib/dashboard/types";
import {
  MAX_WIDGETS,
  gridLayoutsSchema,
  widgetInstanceSchema,
} from "@/lib/dashboard/widget-schemas";
import { resolveWidgets, updateSavedWidget } from "@/lib/data/saved-widgets";
import { buildReportLayoutSnapshot, ViewNotFoundError } from "@/lib/reports/build-view-snapshot";
import { db } from "@/lib/db";
import { requireAgencyRole, requireClientAccess, requireUser } from "@/lib/auth/guard";
import { withRoute } from "@/lib/http/with-route";

// Report layouts are the editable block structure a report is generated from.
// Unlike dashboards they are agency-INTERNAL on every verb, GET included: a
// client_user never sees a layout, only the generated report in their reports
// list. Layouts are still client-scoped, so membership is checked too rather
// than relying on "agency roles happen to see every client".

const configSchema = z.object({
  // Null/absent = a layout being saved for the first time.
  id: z.string().uuid().nullish(),
  name: z.string().min(1).max(120),
  version: z.number().optional(),
  widgets: z.array(widgetInstanceSchema).max(MAX_WIDGETS),
  layouts: gridLayoutsSchema,
});

const putSchema = z.object({
  clientId: z.string().uuid(),
  config: configSchema,
});

// A new layout starts blank, from another layout of the same client, or from an
// agency report template — never two of those at once.
const postSchema = z
  .object({
    clientId: z.string().uuid(),
    name: z.string().min(1).max(120),
    duplicateFromId: z.string().uuid().optional(),
    fromTemplateId: z.string().uuid().optional(),
  })
  .refine((v) => !(v.duplicateFromId && v.fromTemplateId), {
    message: "Pass duplicateFromId or fromTemplateId, not both",
    path: ["fromTemplateId"],
  });

const patchSchema = z.object({
  clientId: z.string().uuid(),
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
});

const uuidSchema = z.string().uuid();

// Preview range. Same YYYY-MM-DD contract the reports POST uses.
const previewRangeSchema = z
  .object({
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine((v) => v.start <= v.end, { message: "start must be on or before end" });

function badRequest(message: string, details?: unknown) {
  return NextResponse.json({ error: message, ...(details ? { details } : {}) }, { status: 400 });
}

function notFound() {
  return NextResponse.json({ error: "Report layout not found" }, { status: 404 });
}

function conflict(error: ReportLayoutNameConflictError) {
  return NextResponse.json({ error: error.message }, { status: 409 });
}

// The caller supplies `clientId`, so membership is checked here before any DB
// work; the agency check is on top because layouts are internal.
async function gateAgencyClient(clientId: string | null) {
  const gate = await requireUser();
  if (!gate.ok) return { ok: false as const, response: gate.response };

  const role = requireAgencyRole(gate.ctx);
  if (!role.ok) return { ok: false as const, response: role.response };

  const parsed = uuidSchema.safeParse(clientId);
  if (!parsed.success) {
    return { ok: false as const, response: badRequest("Valid clientId is required") };
  }

  const access = await requireClientAccess(gate.ctx, parsed.data);
  if (!access.ok) return { ok: false as const, response: access.response };

  return { ok: true as const, ctx: gate.ctx, clientId: parsed.data };
}

// GET ?clientId=&action=list             -> the client's layouts (no widgets payload)
// GET ?clientId=&action=preview&id=&start=&end=
//                                        -> a throwaway snapshot of the SAVED layout
// GET ?clientId=&id=                      -> one layout's full config
export const GET = withRoute("report-layouts.GET", async (request: NextRequest) => {
  const { searchParams } = request.nextUrl;
  const gate = await gateAgencyClient(searchParams.get("clientId"));
  if (!gate.ok) return gate.response;

  const action = searchParams.get("action");

  if (action === "list") {
    return NextResponse.json(await listReportLayouts(gate.clientId));
  }

  // Preview: the same capture a generated report runs, computed and returned
  // without writing a report row. Read-only, and the AI summary is skipped.
  if (action === "preview") {
    const parsedId = uuidSchema.safeParse(searchParams.get("id"));
    if (!parsedId.success) return badRequest("Valid id is required");

    const parsedRange = previewRangeSchema.safeParse({
      start: searchParams.get("start"),
      end: searchParams.get("end"),
    });
    if (!parsedRange.success) {
      return badRequest("Valid start and end dates are required", parsedRange.error.flatten());
    }

    try {
      const snapshot = await buildReportLayoutSnapshot({
        clientId: gate.clientId,
        layoutId: parsedId.data,
        dateRange: parsedRange.data,
        skipAiSummaries: true,
      });
      return NextResponse.json(snapshot);
    } catch (error) {
      if (error instanceof ViewNotFoundError) {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
      throw error;
    }
  }

  const parsedId = uuidSchema.safeParse(searchParams.get("id"));
  if (!parsedId.success) return badRequest("Valid id is required");

  const layout = await getReportLayoutById(parsedId.data);
  // A layout of another client is indistinguishable from a missing one.
  if (!layout || layout.clientId !== gate.clientId) return notFound();
  return NextResponse.json(layout);
});

// POST -> create a layout: blank, duplicated from another layout of this
// client, or stamped from an agency report template.
export const POST = withRoute("report-layouts.POST", async (request: NextRequest) => {
  const body = await request.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid payload", parsed.error.flatten());

  const gate = await gateAgencyClient(parsed.data.clientId);
  if (!gate.ok) return gate.response;

  let from: ReportLayoutSource | undefined;
  if (parsed.data.duplicateFromId) {
    const source = await getReportLayoutById(parsed.data.duplicateFromId);
    if (!source || source.clientId !== gate.clientId) return notFound();
    from = source;
  } else if (parsed.data.fromTemplateId) {
    // Report templates are agency-wide, so there is no client scope to check —
    // the agency gate above is the whole authorization.
    const template = await getReportTemplate(parsed.data.fromTemplateId);
    if (!template) return NextResponse.json({ error: "Report template not found" }, { status: 404 });
    from = template;
  }

  try {
    const created = await createReportLayout(gate.clientId, { name: parsed.data.name, from });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof ReportLayoutNameConflictError) return conflict(error);
    throw error;
  }
});

// PATCH -> rename. A layout has no visibility and no default to set.
export const PATCH = withRoute("report-layouts.PATCH", async (request: NextRequest) => {
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid payload", parsed.error.flatten());

  const gate = await gateAgencyClient(parsed.data.clientId);
  if (!gate.ok) return gate.response;

  const existing = await getReportLayoutById(parsed.data.id);
  if (!existing || existing.clientId !== gate.clientId) return notFound();

  try {
    const updated = await renameReportLayout(parsed.data.id, parsed.data.name);
    return updated ? NextResponse.json(updated) : notFound();
  } catch (error) {
    if (error instanceof ReportLayoutNameConflictError) return conflict(error);
    throw error;
  }
});

// DELETE ?clientId=&id= -> remove a layout. Reports generated from it keep
// their frozen snapshot and are untouched.
export const DELETE = withRoute("report-layouts.DELETE", async (request: NextRequest) => {
  const { searchParams } = request.nextUrl;
  const gate = await gateAgencyClient(searchParams.get("clientId"));
  if (!gate.ok) return gate.response;

  const parsedId = uuidSchema.safeParse(searchParams.get("id"));
  if (!parsedId.success) return badRequest("Valid id is required");

  const existing = await getReportLayoutById(parsedId.data);
  if (!existing || existing.clientId !== gate.clientId) return notFound();

  await deleteReportLayout(parsedId.data);
  return NextResponse.json({ success: true });
});

// PUT -> save a layout's blocks (same linkage rules as the dashboards PUT:
// linked widgets store only their pointer, `syncToLibrary` writes back).
export const PUT = withRoute("report-layouts.PUT", async (request: NextRequest) => {
  const body = await request.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid report layout payload", parsed.error.flatten());

  const gate = await gateAgencyClient(parsed.data.clientId);
  if (!gate.ok) return gate.response;

  if (parsed.data.config.id) {
    const existing = await getReportLayoutById(parsed.data.config.id);
    // Saving into another client's layout would move it; refuse rather than
    // silently creating a copy.
    if (existing && existing.clientId !== gate.clientId) return notFound();
  }

  const resolved = await resolveWidgets(parsed.data.config.widgets, "report");
  if (!resolved.ok) {
    return NextResponse.json(
      { error: "Invalid widget config", details: resolved.issues },
      { status: 400 }
    );
  }

  const config = {
    ...parsed.data.config,
    widgets: resolved.widgets,
    version: parsed.data.config.version ?? DASHBOARD_CONFIG_VERSION,
  };

  try {
    // One transaction: an "update everywhere" library write and the layout save
    // stand or fall together.
    const saved = await db.transaction(async (tx) => {
      for (const sync of resolved.syncs) {
        await updateSavedWidget(sync.id, { config: sync.config }, tx);
      }
      // Cast is safe: zod validated the structural shape above.
      return upsertReportLayout(gate.clientId, config as Parameters<typeof upsertReportLayout>[1], tx);
    });
    return NextResponse.json(saved);
  } catch (error) {
    if (error instanceof ReportLayoutNameConflictError) return conflict(error);
    throw error;
  }
});
