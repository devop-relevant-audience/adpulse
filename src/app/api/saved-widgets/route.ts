import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  SavedWidgetNameConflictError,
  createSavedWidget,
  deleteSavedWidget,
  getSavedWidget,
  getSavedWidgetUsage,
  listSavedWidgets,
  updateSavedWidget,
} from "@/lib/data/saved-widgets";
import { validateWidgetConfig } from "@/lib/dashboard/widget-schemas";
import { WIDGET_TYPES, type WidgetType } from "@/lib/dashboard/types";
import { requireAgencyRole, requireUser } from "@/lib/auth/guard";
import { withRoute } from "@/lib/http/with-route";

// The saved widget library is agency-wide, not client-scoped: one entry can be
// used by views of any client. Client users never call this route — their
// dashboards arrive already hydrated — so every method is agency-gated.

const uuidSchema = z.string().uuid();
const nameSchema = z.string().trim().min(1).max(120);
const configSchema = z.record(z.string(), z.unknown());

const postSchema = z.object({
  name: nameSchema,
  widgetType: z.enum(WIDGET_TYPES),
  config: configSchema,
});

const patchSchema = z.object({
  id: uuidSchema,
  name: nameSchema.optional(),
  config: configSchema.optional(),
});

function badRequest(message: string, details?: unknown) {
  return NextResponse.json({ error: message, ...(details ? { details } : {}) }, { status: 400 });
}

function notFound() {
  return NextResponse.json({ error: "Saved widget not found" }, { status: 404 });
}

function conflict(error: SavedWidgetNameConflictError) {
  return NextResponse.json({ error: error.message }, { status: 409 });
}

async function gateAgency() {
  const gate = await requireUser();
  if (!gate.ok) return gate;
  return requireAgencyRole(gate.ctx);
}

// Same validation the dashboards PUT applies, so a library entry can never hold
// a config a dashboard would reject.
function validateConfig(type: WidgetType, config: Record<string, unknown>) {
  const result = validateWidgetConfig(type, config);
  return result.ok ? { ok: true as const, config: result.config } : { ok: false as const, issues: result.issues };
}

// GET                     -> the whole library, name-sorted
// GET ?action=usage&id=   -> which dashboard views reference an entry
export const GET = withRoute("saved-widgets.GET", async (request: NextRequest) => {
  const gate = await gateAgency();
  if (!gate.ok) return gate.response;

  const { searchParams } = request.nextUrl;

  if (searchParams.get("action") === "usage") {
    const parsedId = uuidSchema.safeParse(searchParams.get("id"));
    if (!parsedId.success) return badRequest("Valid id is required");
    return NextResponse.json(await getSavedWidgetUsage(parsedId.data));
  }

  return NextResponse.json(await listSavedWidgets());
});

// POST -> add a widget to the library.
export const POST = withRoute("saved-widgets.POST", async (request: NextRequest) => {
  const gate = await gateAgency();
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid payload", parsed.error.flatten());

  const config = validateConfig(parsed.data.widgetType, parsed.data.config);
  if (!config.ok) return badRequest("Invalid widget config", config.issues);

  try {
    const created = await createSavedWidget({
      name: parsed.data.name,
      widgetType: parsed.data.widgetType,
      config: config.config,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof SavedWidgetNameConflictError) return conflict(error);
    throw error;
  }
});

// PATCH -> rename and/or rewrite the config. A config write is the
// "update everywhere": every view linking this entry renders the new config.
export const PATCH = withRoute("saved-widgets.PATCH", async (request: NextRequest) => {
  const gate = await gateAgency();
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid payload", parsed.error.flatten());

  const existing = await getSavedWidget(parsed.data.id);
  if (!existing) return notFound();

  let config: Record<string, unknown> | undefined;
  if (parsed.data.config) {
    const validated = validateConfig(existing.widget_type, parsed.data.config);
    if (!validated.ok) return badRequest("Invalid widget config", validated.issues);
    config = validated.config;
  }

  try {
    const updated = await updateSavedWidget(parsed.data.id, { name: parsed.data.name, config });
    return updated ? NextResponse.json(updated) : notFound();
  } catch (error) {
    if (error instanceof SavedWidgetNameConflictError) return conflict(error);
    throw error;
  }
});

// DELETE ?id= -> detach-then-delete: the config is materialized inline into
// every view that used the entry before the row goes, so nothing breaks.
export const DELETE = withRoute("saved-widgets.DELETE", async (request: NextRequest) => {
  const gate = await gateAgency();
  if (!gate.ok) return gate.response;

  const parsedId = uuidSchema.safeParse(request.nextUrl.searchParams.get("id"));
  if (!parsedId.success) return badRequest("Valid id is required");

  const existing = await getSavedWidget(parsedId.data);
  if (!existing) return notFound();

  await deleteSavedWidget(parsedId.data);
  return NextResponse.json({ success: true });
});
