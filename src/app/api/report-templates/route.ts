import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  ReportTemplateNameConflictError,
  createReportTemplate,
  deleteReportTemplate,
  getReportTemplate,
  listReportTemplates,
  updateReportTemplate,
} from "@/lib/data/report-templates";
import { getReportLayoutById } from "@/lib/data/report-layouts";
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

// GET -> every report template, name-sorted, without the layouts/widgets payload.
export const GET = withRoute("report-templates.GET", async () => {
  const gate = await gateAgency();
  if (!gate.ok) return gate.response;

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

// PATCH -> rename / re-describe. Template CONTENT is immutable in this phase:
// re-snapshot a layout into a new template instead.
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

// DELETE ?id= -> drop a template. Layouts already stamped from it are untouched;
// a template is a copy, not a live link.
export const DELETE = withRoute("report-templates.DELETE", async (request: NextRequest) => {
  const gate = await gateAgency();
  if (!gate.ok) return gate.response;

  const parsedId = uuidSchema.safeParse(request.nextUrl.searchParams.get("id"));
  if (!parsedId.success) return badRequest("Valid id is required");

  const existing = await getReportTemplate(parsedId.data);
  if (!existing) return notFound();

  await deleteReportTemplate(parsedId.data);
  return NextResponse.json({ success: true });
});
