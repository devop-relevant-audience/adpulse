import { NextRequest, NextResponse } from "next/server";
import { listCampaigns } from "@/lib/data/queries";
import { z } from "zod";
import { requireClientAccess, requireUser } from "@/lib/auth/guard";
import type { Platform } from "@/lib/types/database";

const querySchema = z.object({
  clientId: z.string().uuid(),
  platform: z.enum(["google", "meta", "tiktok"]).optional(),
});

export async function GET(request: NextRequest) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;

  try {
    const { searchParams } = request.nextUrl;
    const parsed = querySchema.safeParse({
      clientId: searchParams.get("clientId"),
      platform: searchParams.get("platform") || undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid parameters", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const access = await requireClientAccess(gate.ctx, parsed.data.clientId);
    if (!access.ok) return access.response;

    const campaigns = await listCampaigns(
      parsed.data.clientId,
      parsed.data.platform as Platform | undefined
    );
    return NextResponse.json(campaigns);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch campaigns";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
