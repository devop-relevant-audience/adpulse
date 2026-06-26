import { NextRequest, NextResponse } from "next/server";
import { getChannelMixAnalysis } from "@/lib/data/optimizer";
import { z } from "zod";

const optimizerSchema = z.object({
  clientId: z.string().uuid(),
  startDate: z.string(),
  endDate: z.string(),
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    const parsed = optimizerSchema.safeParse({
      clientId: searchParams.get("clientId"),
      startDate: searchParams.get("startDate"),
      endDate: searchParams.get("endDate"),
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid parameters", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const result = await getChannelMixAnalysis(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to analyze channel mix";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
