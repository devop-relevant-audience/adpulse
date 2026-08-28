import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDashboard, upsertDashboard } from "@/lib/data/dashboards";
import { DASHBOARD_CONFIG_VERSION } from "@/lib/dashboard/types";
import { validateWidgetConfig } from "@/lib/dashboard/widget-schemas";
import { requireAgencyRole, requireClientAccess, requireUser } from "@/lib/auth/guard";
import { withRoute } from "@/lib/http/with-route";

const gridItemSchema = z.object({
  i: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  minW: z.number().optional(),
  minH: z.number().optional(),
  maxW: z.number().optional(),
  maxH: z.number().optional(),
  static: z.boolean().optional(),
  moved: z.boolean().optional(),
});

const configSchema = z.object({
  name: z.string().min(1).max(120),
  version: z.number().optional(),
  widgets: z.array(
    z.object({
      i: z.string(),
      type: z.string(),
      config: z.record(z.string(), z.unknown()),
    })
  ),
  layouts: z.object({
    lg: z.array(gridItemSchema),
    md: z.array(gridItemSchema),
    sm: z.array(gridItemSchema),
  }),
});

const putSchema = z.object({
  clientId: z.string().uuid(),
  config: configSchema,
});

export const GET = withRoute("dashboards.GET", async (request: NextRequest) => {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;

  const { searchParams } = request.nextUrl;
  const clientId = searchParams.get("clientId");
  const name = searchParams.get("name") || "Default";

  const parsed = z.string().uuid().safeParse(clientId);
  if (!parsed.success) {
    return NextResponse.json({ error: "Valid clientId is required" }, { status: 400 });
  }

  const access = await requireClientAccess(gate.ctx, parsed.data);
  if (!access.ok) return access.response;

  const dashboard = await getDashboard(parsed.data, name);
  return NextResponse.json(dashboard);
});

export const PUT = withRoute("dashboards.PUT", async (request: NextRequest) => {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  // Dashboard layouts are per-client shared assets: client users view, agencies edit.
  const role = requireAgencyRole(gate.ctx);
  if (!role.ok) return role.response;

  const body = await request.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid dashboard payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Per-widget config validation (strict for "custom", shared `filters` shape
  // for every other known type). Keyed by widget instance id.
  const widgetIssues: Record<string, string[]> = {};
  for (const widget of parsed.data.config.widgets) {
    const result = validateWidgetConfig(widget.type, widget.config);
    if (!result.ok) widgetIssues[widget.i] = result.issues;
  }
  if (Object.keys(widgetIssues).length > 0) {
    return NextResponse.json(
      { error: "Invalid widget config", details: widgetIssues },
      { status: 400 }
    );
  }

  const config = {
    ...parsed.data.config,
    version: parsed.data.config.version ?? DASHBOARD_CONFIG_VERSION,
  };
  // Cast is safe: zod validated the structural shape above.
  const saved = await upsertDashboard(parsed.data.clientId, config as Parameters<typeof upsertDashboard>[1]);
  return NextResponse.json(saved);
});
