import { NextRequest, NextResponse } from "next/server";
import { getCreatives, getCreativeFatigueAnalysis } from "@/lib/data/queries";
import { requireClientAccess, requireUser } from "@/lib/auth/guard";
import { withRoute } from "@/lib/http/with-route";
import type { Platform, CreativeStatus } from "@/lib/types/database";

export const GET = withRoute("creatives.GET", async (request: NextRequest) => {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;

  const { searchParams } = request.nextUrl;
  const clientId = searchParams.get("clientId");

  if (!clientId) {
    return NextResponse.json(
      { error: "clientId is required" },
      { status: 400 },
    );
  }

  const access = await requireClientAccess(gate.ctx, clientId);
  if (!access.ok) return access.response;

  const action = searchParams.get("action");

  if (action === "fatigue") {
    const data = await getCreativeFatigueAnalysis(clientId);
    return NextResponse.json(data);
  }

  const data = await getCreatives({
    clientId,
    platform: (searchParams.get("platform") as Platform) || undefined,
    status: (searchParams.get("status") as CreativeStatus) || undefined,
    campaignId: searchParams.get("campaignId") || undefined,
    sort: searchParams.get("sort") || undefined,
    order: (searchParams.get("order") as "asc" | "desc") || undefined,
  });

  return NextResponse.json(data);
});
