import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  DashboardNameConflictError,
  createDashboard,
  deleteDashboard,
  getDashboardById,
  getDefaultDashboard,
  listDashboards,
  renameDashboard,
  setDashboardVisibility,
  setDefaultDashboard,
  upsertDashboard,
  type DashboardSource,
} from "@/lib/data/dashboards";
import { getTemplate } from "@/lib/data/templates";
import { DASHBOARD_CONFIG_VERSION } from "@/lib/dashboard/types";
import {
  MAX_WIDGETS,
  gridLayoutsSchema,
  widgetInstanceSchema,
} from "@/lib/dashboard/widget-schemas";
import { resolveWidgets, updateSavedWidget } from "@/lib/data/saved-widgets";
import { db } from "@/lib/db";
import { isAgency, requireAgencyRole, requireClientAccess, requireUser } from "@/lib/auth/guard";
import { withRoute } from "@/lib/http/with-route";

const visibilitySchema = z.enum(["internal", "client"]);

const configSchema = z.object({
  // Null/absent = the built-in preset being saved for the first time.
  id: z.string().uuid().nullish(),
  name: z.string().min(1).max(120),
  version: z.number().optional(),
  visibility: visibilitySchema.optional(),
  isDefault: z.boolean().optional(),
  widgets: z.array(widgetInstanceSchema).max(MAX_WIDGETS),
  layouts: gridLayoutsSchema,
});

const putSchema = z.object({
  clientId: z.string().uuid(),
  config: configSchema,
});

// A new view starts blank, from another view of the same client, or from an
// agency template — never two of those at once.
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
  name: z.string().min(1).max(120).optional(),
  visibility: visibilitySchema.optional(),
  isDefault: z.literal(true).optional(),
});

const uuidSchema = z.string().uuid();

function badRequest(message: string, details?: unknown) {
  return NextResponse.json({ error: message, ...(details ? { details } : {}) }, { status: 400 });
}

function notFound() {
  return NextResponse.json({ error: "Dashboard view not found" }, { status: 404 });
}

// Every handler is client-scoped: the caller supplies `clientId`, so membership
// is checked here before any DB work. Writes are additionally agency-only (a
// client_user reads published views only).
async function gateClient(clientId: string | null) {
  const gate = await requireUser();
  if (!gate.ok) return { ok: false as const, response: gate.response };

  const parsed = uuidSchema.safeParse(clientId);
  if (!parsed.success) {
    return { ok: false as const, response: badRequest("Valid clientId is required") };
  }

  const access = await requireClientAccess(gate.ctx, parsed.data);
  if (!access.ok) return { ok: false as const, response: access.response };

  return { ok: true as const, ctx: gate.ctx, clientId: parsed.data };
}

async function gateAgencyClient(clientId: string | null) {
  const gate = await gateClient(clientId);
  if (!gate.ok) return gate;

  const role = requireAgencyRole(gate.ctx);
  if (!role.ok) return { ok: false as const, response: role.response };

  return gate;
}

// GET ?clientId=&action=list  -> the client's views (client users: published only)
// GET ?clientId=[&id=]        -> one view's full config, or the default view
export const GET = withRoute("dashboards.GET", async (request: NextRequest) => {
  const { searchParams } = request.nextUrl;
  const gate = await gateClient(searchParams.get("clientId"));
  if (!gate.ok) return gate.response;

  const clientVisibleOnly = !isAgency(gate.ctx);

  if (searchParams.get("action") === "list") {
    const views = await listDashboards(gate.clientId, { clientVisibleOnly });
    return NextResponse.json(views);
  }

  const id = searchParams.get("id");
  if (id) {
    const parsedId = uuidSchema.safeParse(id);
    if (!parsedId.success) return badRequest("Valid id is required");

    const view = await getDashboardById(parsedId.data);
    // A view of another client, or an internal one requested by a client user,
    // is indistinguishable from a missing one.
    if (!view || view.clientId !== gate.clientId) return notFound();
    if (clientVisibleOnly && view.visibility !== "client") return notFound();
    return NextResponse.json(view);
  }

  const dashboard = await getDefaultDashboard(gate.clientId, { clientVisibleOnly });
  return NextResponse.json(dashboard);
});

// POST -> create a view: blank, duplicated from another view of this client, or
// stamped from an agency template.
export const POST = withRoute("dashboards.POST", async (request: NextRequest) => {
  const body = await request.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid payload", parsed.error.flatten());

  const gate = await gateAgencyClient(parsed.data.clientId);
  if (!gate.ok) return gate.response;

  let from: DashboardSource | undefined;
  if (parsed.data.duplicateFromId) {
    const source = await getDashboardById(parsed.data.duplicateFromId);
    if (!source || source.clientId !== gate.clientId) return notFound();
    from = source;
  } else if (parsed.data.fromTemplateId) {
    // Templates are agency-wide, so there is no client scope to check — the
    // agency gate above is the whole authorization.
    const template = await getTemplate(parsed.data.fromTemplateId);
    if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });
    from = template;
  }

  try {
    const created = await createDashboard(gate.clientId, { name: parsed.data.name, from });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof DashboardNameConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
});

// PATCH -> rename / publish / set default.
export const PATCH = withRoute("dashboards.PATCH", async (request: NextRequest) => {
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid payload", parsed.error.flatten());

  const gate = await gateAgencyClient(parsed.data.clientId);
  if (!gate.ok) return gate.response;

  const { id, name, visibility, isDefault } = parsed.data;
  const existing = await getDashboardById(id);
  if (!existing || existing.clientId !== gate.clientId) return notFound();

  try {
    let updated = existing;
    if (name !== undefined && name !== existing.name) {
      updated = (await renameDashboard(id, name)) ?? updated;
    }
    if (visibility !== undefined && visibility !== existing.visibility) {
      updated = (await setDashboardVisibility(id, visibility)) ?? updated;
    }
    if (isDefault) {
      updated = (await setDefaultDashboard(gate.clientId, id)) ?? updated;
    }
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof DashboardNameConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
});

// DELETE ?clientId=&id= -> remove a view (the default is promoted elsewhere).
export const DELETE = withRoute("dashboards.DELETE", async (request: NextRequest) => {
  const { searchParams } = request.nextUrl;
  const gate = await gateAgencyClient(searchParams.get("clientId"));
  if (!gate.ok) return gate.response;

  const parsedId = uuidSchema.safeParse(searchParams.get("id"));
  if (!parsedId.success) return badRequest("Valid id is required");

  const existing = await getDashboardById(parsedId.data);
  if (!existing || existing.clientId !== gate.clientId) return notFound();

  await deleteDashboard(parsedId.data);
  return NextResponse.json({ success: true });
});

// PUT -> save a view's layout/widgets (creates the row on a preset's first save).
export const PUT = withRoute("dashboards.PUT", async (request: NextRequest) => {
  const body = await request.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid dashboard payload", parsed.error.flatten());

  // Dashboard layouts are per-client shared assets: client users view, agencies edit.
  const gate = await gateAgencyClient(parsed.data.clientId);
  if (!gate.ok) return gate.response;

  const resolved = await resolveWidgets(parsed.data.config.widgets, "dashboard");
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
    // stand or fall together, so a failed save can never leave the library
    // rewritten for every other view.
    const saved = await db.transaction(async (tx) => {
      for (const sync of resolved.syncs) {
        await updateSavedWidget(sync.id, { config: sync.config }, tx);
      }
      // Cast is safe: zod validated the structural shape above.
      return upsertDashboard(gate.clientId, config as Parameters<typeof upsertDashboard>[1], tx);
    });
    return NextResponse.json(saved);
  } catch (error) {
    if (error instanceof DashboardNameConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
});
