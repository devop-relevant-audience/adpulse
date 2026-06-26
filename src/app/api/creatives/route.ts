import { NextRequest, NextResponse } from "next/server";
import { getCreatives, getCreativeFatigueAnalysis } from "@/lib/data/queries";
import type { Platform, CreativeStatus } from "@/lib/types/database";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const clientId = searchParams.get("clientId");

    if (!clientId) {
      return NextResponse.json(
        { error: "clientId is required" },
        { status: 400 },
      );
    }

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
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch creatives";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
