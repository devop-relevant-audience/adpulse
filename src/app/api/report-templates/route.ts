import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  MasterReportTemplateError,
  ReportTemplateNameConflictError,
  createReportTemplate,
  deleteReportTemplate,
  getMasterReportTemplate,
  getReportTemplate,
  listReportTemplates,
  updateReportTemplate,
  updateReportTemplateContent,
} from "@/lib/data/report-templates";
import { getReportLayoutById } from "@/lib/data/report-layouts";
import { resolveWidgets, updateSavedWidget } from "@/lib/data/saved-widgets";
import { DASHBOARD_CONFIG_VERSION } from "@/lib/dashboard/types";
import {
  MAX_WIDGETS,
  gridLayoutsSchema,
  widgetInstanceSchema,
} from "@/lib/dashboard/widget-schemas";
import { buildReportTemplateSnapshot, ViewNotFoundError } from "@/lib/reports/build-view-snapshot";
import { db } from "@/lib/db";
import { requireAgencyRole, requireClientAccess, requireUser } from "@/lib/auth/guard";
import { withRoute } from "@/lib/http/with-route";

// Report templates are agency-wide, not client-scoped: a template made from one
// client's report layout exists to be stamped onto any other client. Client
// users never call this route, so every method is agency-gated — and POST
// additionally checks access to the source layout's client, so the gate does not
// rely on "agency roles happen to see every client".

const uuidSchema = z.string().uuid();
const nameSchema = z.string().trim().min(1).max(120);
const descriptionSchema = z.string().trim().max(500);

const postSchema = z.object({
  name: nameSchema,
  description: descriptionSchema.optional(),
  fromReportLayoutId: uuidSchema,
});

const patchSchema = z.object({
  id: uuidSchema,
  name: nameSchema.optional(),
  description: descriptionSchema.optional(),
});

// Content save. Same payload the report-layouts PUT takes, minus the client
// scope a template has none of.
const putSchema = z.object({
  id: uuidSchema,
  version: z.number().optional(),
  widgets: z.array(widgetInstanceSchema).max(MAX_WIDGETS),
  layouts: gridLayoutsSchema,
});

// Preview range. Same YYYY-MM-DD contract the report-layouts route uses.
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
  return NextResponse.json({ error: "Report template not found" }, { status: 404 });
}

function conflict(error: ReportTemplateNameConflictError) {
  return NextResponse.json({ error: error.message }, { status: 409 });
}

async function gateAgency() {
  const gate = await requireUser();
  if (!gate.ok) return gate;
  return requireAgencyRole(gate.ctx);
}

// GET ?action=master  -> the master report template's full content (created
//                        from the built-in report preset on first read)
// GET ?action=preview&id=&clientId=&start=&end=
//                      -> a throwaway render of the template against one
//                         client's data, minus the AI summary
// GET                  -> every report template, master first, without the payload.
export const GET = withRoute("report-templates.GET", async (request: NextRequest) => {
  const gate = await gateAgency();
  if (!gate.ok) return gate.response;

  const { searchParams } = request.nextUrl;
  const action = searchParams.get("action");

  if (action === "master") {
    return NextResponse.json(await getMasterReportTemplate());
  }

  // A template belongs to no client, so the client whose data it is previewed
  // against is checked here on top of the agency gate.
  if (action === "preview") {
    const parsedId = uuidSchema.safeParse(searchParams.get("id"));
    if (!parsedId.success) return badRequest("Valid id is required");

    const parsedClientId = uuidSchema.safeParse(searchParams.get("clientId"));
    if (!parsedClientId.success) return badRequest("Valid clientId is required");

    const access = await requireClientAccess(gate.ctx, parsedClientId.data);
    if (!access.ok) return access.response;

    const parsedRange = previewRangeSchema.safeParse({
      start: searchParams.get("start"),
      end: searchParams.get("end"),
    });
    if (!parsedRange.success) {
      return badRequest("Valid start and end dates are required", parsedRange.error.flatten());
    }

    try {
      const snapshot = await buildReportTemplateSnapshot({
        clientId: parsedClientId.data,
        templateId: parsedId.data,
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

  return NextResponse.json(await listReportTemplates());
});

// POST -> snapshot a saved report layout into a new template. The snapshot is
// of the layout AS SAVED: unsaved draft edits in the browser are not included.
export const POST = withRoute("report-templates.POST", async (request: NextRequest) => {
  const gate = await gateAgency();
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid payload", parsed.error.flatten());

  const source = await getReportLayoutById(parsed.data.fromReportLayoutId);
  if (!source) return NextResponse.json({ error: "Report layout not found" }, { status: 404 });

  const access = await requireClientAccess(gate.ctx, source.clientId);
  if (!access.ok) return access.response;

  try {
    const created = await createReportTemplate({
      name: parsed.data.name,
      description: parsed.data.description ?? "",
      layouts: source.layouts,
      widgets: source.widgets,
      version: source.version,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof ReportTemplateNameConflictError) return conflict(error);
    throw error;
  }
});

// PATCH -> rename / re-describe. Content is saved by the PUT below.
export const PATCH = withRoute("report-templates.PATCH", async (request: NextRequest) => {
  const gate = await gateAgency();
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid payload", parsed.error.flatten());

  try {
    const updated = await updateReportTemplate(parsed.data.id, {
      name: parsed.data.name,
      description: parsed.data.description,
    });
    return updated ? NextResponse.json(updated) : notFound();
  } catch (error) {
    if (error instanceof ReportTemplateNameConflictError) return conflict(error);
    throw error;
  }
});

// PUT -> rewrite a template's blocks. The UI only offers this for the master,
// but the endpoint is by id: a template is a grid like any other, so it goes
// through the same widget resolution and one-transaction library sync as the
// report-layouts PUT (surface "report", so cover/AI-summary blocks are allowed).
export const PUT = withRoute("report-templates.PUT", async (request: NextRequest) => {
  const gate = await gateAgency();
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid report template payload", parsed.error.flatten());

  const existing = await getReportTemplate(parsed.data.id);
  if (!existing) return notFound();

  const resolved = await resolveWidgets(parsed.data.widgets, "report");
  if (!resolved.ok) {
    return NextResponse.json(
      { error: "Invalid widget config", details: resolved.issues },
      { status: 400 }
    );
  }

  // One transaction: an "update everywhere" library write and the template save
  // stand or fall together.
  const saved = await db.transaction(async (tx) => {
    for (const sync of resolved.syncs) {
      await updateSavedWidget(sync.id, { config: sync.config }, tx);
    }
    return updateReportTemplateContent(
      parsed.data.id,
      {
        layouts: parsed.data.layouts,
        // Cast is safe: zod validated the structural shape above.
        widgets: resolved.widgets as Parameters<typeof updateReportTemplateContent>[1]["widgets"],
        version: parsed.data.version ?? DASHBOARD_CONFIG_VERSION,
      },
      tx
    );
  });

  return saved ? NextResponse.json(saved) : notFound();
});

// DELETE ?id= -> drop a template. Layouts already stamped from it are untouched;
// a template is a copy, not a live link. The master cannot be deleted.
export const DELETE = withRoute("report-templates.DELETE", async (request: NextRequest) => {
  const gate = await gateAgency();
  if (!gate.ok) return gate.response;

  const parsedId = uuidSchema.safeParse(request.nextUrl.searchParams.get("id"));
  if (!parsedId.success) return badRequest("Valid id is required");

  const existing = await getReportTemplate(parsedId.data);
  if (!existing) return notFound();

  try {
    await deleteReportTemplate(parsedId.data);
  } catch (error) {
    if (error instanceof MasterReportTemplateError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
  return NextResponse.json({ success: true });
});
