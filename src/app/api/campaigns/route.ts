import { NextRequest, NextResponse } from "next/server";
import { listCampaigns } from "@/lib/data/queries";
import { z } from "zod";
import { requireClientAccess, requireUser } from "@/lib/auth/guard";
import { withRoute } from "@/lib/http/with-route";
import type { Platform } from "@/lib/types/database";

const querySchema = z.object({
  clientId: z.string().uuid(),
  platform: z.enum(["google", "meta", "tiktok"]).optional(),
});

export const GET = withRoute("campaigns.GET", async (request: NextRequest) => {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;

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
});
