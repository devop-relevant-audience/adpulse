import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDashboard, upsertDashboard } from "@/lib/data/dashboards";
import { DASHBOARD_CONFIG_VERSION } from "@/lib/dashboard/types";

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

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const clientId = searchParams.get("clientId");
    const name = searchParams.get("name") || "Default";

    const parsed = z.string().uuid().safeParse(clientId);
    if (!parsed.success) {
      return NextResponse.json({ error: "Valid clientId is required" }, { status: 400 });
    }

    const dashboard = await getDashboard(parsed.data, name);
    return NextResponse.json(dashboard);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch dashboard";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = putSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid dashboard payload", details: parsed.error.flatten() },
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save dashboard";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
