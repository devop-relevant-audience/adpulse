import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  MasterTemplateError,
  TemplateNameConflictError,
  createTemplate,
  deleteTemplate,
  getMasterTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
  updateTemplateContent,
} from "@/lib/data/templates";
import { getDashboardById } from "@/lib/data/dashboards";
import { resolveWidgets, updateSavedWidget } from "@/lib/data/saved-widgets";
import { DASHBOARD_CONFIG_VERSION } from "@/lib/dashboard/types";
import {
  MAX_WIDGETS,
  gridLayoutsSchema,
  widgetInstanceSchema,
} from "@/lib/dashboard/widget-schemas";
import { db } from "@/lib/db";
import { requireAgencyRole, requireClientAccess, requireUser } from "@/lib/auth/guard";
import { withRoute } from "@/lib/http/with-route";

// Dashboard templates are agency-wide, not client-scoped: a template made from
// one client's view exists to be stamped onto any other client. Client users
// never call this route, so every method is agency-gated — and POST
// additionally checks access to the source view's client, so the gate does not
// rely on "agency roles happen to see every client".

const uuidSchema = z.string().uuid();
const nameSchema = z.string().trim().min(1).max(120);
const descriptionSchema = z.string().trim().max(500);

const postSchema = z.object({
  name: nameSchema,
  description: descriptionSchema.optional(),
  fromDashboardId: uuidSchema,
});

const patchSchema = z.object({
  id: uuidSchema,
  name: nameSchema.optional(),
  description: descriptionSchema.optional(),
});

// Content save. Same payload the dashboards PUT takes, minus the per-client
// fields a template has none of.
const putSchema = z.object({
  id: uuidSchema,
  version: z.number().optional(),
  widgets: z.array(widgetInstanceSchema).max(MAX_WIDGETS),
  layouts: gridLayoutsSchema,
});

function badRequest(message: string, details?: unknown) {
  return NextResponse.json({ error: message, ...(details ? { details } : {}) }, { status: 400 });
}

function notFound() {
  return NextResponse.json({ error: "Template not found" }, { status: 404 });
}

function conflict(error: TemplateNameConflictError) {
  return NextResponse.json({ error: error.message }, { status: 409 });
}

async function gateAgency() {
  const gate = await requireUser();
  if (!gate.ok) return gate;
  return requireAgencyRole(gate.ctx);
}

// GET ?action=master -> the master template's full content (created from the
//                       built-in preset the first time it is asked for)
// GET                 -> every template, master first, without the payload.
export const GET = withRoute("templates.GET", async (request: NextRequest) => {
  const gate = await gateAgency();
  if (!gate.ok) return gate.response;

  if (request.nextUrl.searchParams.get("action") === "master") {
    return NextResponse.json(await getMasterTemplate());
  }

  return NextResponse.json(await listTemplates());
});

// POST -> snapshot a saved view into a new template. The snapshot is of the
// view AS SAVED: unsaved draft edits in the browser are not included.
export const POST = withRoute("templates.POST", async (request: NextRequest) => {
  const gate = await gateAgency();
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid payload", parsed.error.flatten());

  const source = await getDashboardById(parsed.data.fromDashboardId);
  if (!source) return NextResponse.json({ error: "Dashboard view not found" }, { status: 404 });

  const access = await requireClientAccess(gate.ctx, source.clientId);
  if (!access.ok) return access.response;

  try {
    const created = await createTemplate({
      name: parsed.data.name,
      description: parsed.data.description ?? "",
      layouts: source.layouts,
      widgets: source.widgets,
      version: source.version,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof TemplateNameConflictError) return conflict(error);
    throw error;
  }
});

// PATCH -> rename / re-describe. Content is saved by the PUT below.
export const PATCH = withRoute("templates.PATCH", async (request: NextRequest) => {
  const gate = await gateAgency();
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid payload", parsed.error.flatten());

  try {
    const updated = await updateTemplate(parsed.data.id, {
      name: parsed.data.name,
      description: parsed.data.description,
    });
    return updated ? NextResponse.json(updated) : notFound();
  } catch (error) {
    if (error instanceof TemplateNameConflictError) return conflict(error);
    throw error;
  }
});

// PUT -> rewrite a template's blocks. The UI only offers this for the master,
// but the endpoint is by id: a template is a grid like any other, so it goes
// through the same widget resolution and the same one-transaction library sync
// as the dashboards PUT.
export const PUT = withRoute("templates.PUT", async (request: NextRequest) => {
  const gate = await gateAgency();
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid template payload", parsed.error.flatten());

  const existing = await getTemplate(parsed.data.id);
  if (!existing) return notFound();

  const resolved = await resolveWidgets(parsed.data.widgets, "dashboard");
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
    return updateTemplateContent(
      parsed.data.id,
      {
        layouts: parsed.data.layouts,
        // Cast is safe: zod validated the structural shape above.
        widgets: resolved.widgets as Parameters<typeof updateTemplateContent>[1]["widgets"],
        version: parsed.data.version ?? DASHBOARD_CONFIG_VERSION,
      },
      tx
    );
  });

  return saved ? NextResponse.json(saved) : notFound();
});

// DELETE ?id= -> drop a template. Views already stamped from it are untouched;
// a template is a copy, not a live link. The master cannot be deleted.
export const DELETE = withRoute("templates.DELETE", async (request: NextRequest) => {
  const gate = await gateAgency();
  if (!gate.ok) return gate.response;

  const parsedId = uuidSchema.safeParse(request.nextUrl.searchParams.get("id"));
  if (!parsedId.success) return badRequest("Valid id is required");

  const existing = await getTemplate(parsedId.data);
  if (!existing) return notFound();

  try {
    await deleteTemplate(parsedId.data);
  } catch (error) {
    if (error instanceof MasterTemplateError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
  return NextResponse.json({ success: true });
});
