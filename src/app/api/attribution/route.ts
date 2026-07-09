import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRevenueOverview, getAttributionComparison, getCohortAnalysis } from "@/lib/data/attribution";
import { requireClientAccess, requireUser } from "@/lib/auth/guard";
import { withRoute } from "@/lib/http/with-route";
import type { Platform } from "@/lib/types/database";

const attributionSchema = z.object({
  clientId: z.string().uuid(),
  startDate: z.string(),
  endDate: z.string(),
  platform: z.enum(["google", "meta", "tiktok"]).optional(),
});

export const GET = withRoute("attribution.GET", async (request: NextRequest) => {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;

  const { searchParams } = request.nextUrl;
  const action = searchParams.get("action") || "overview";

  const parsed = attributionSchema.safeParse({
    clientId: searchParams.get("clientId"),
    startDate: searchParams.get("startDate"),
    endDate: searchParams.get("endDate"),
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

  const params = {
    ...parsed.data,
    platform: parsed.data.platform as Platform | undefined,
  };

  switch (action) {
    case "attribution": {
      const result = await getAttributionComparison(params);
      return NextResponse.json(result);
    }

    case "cohorts": {
      const result = await getCohortAnalysis(params);
      return NextResponse.json(result);
    }

    case "overview":
    default: {
      const result = await getRevenueOverview(params);
      return NextResponse.json(result);
    }
  }
});
