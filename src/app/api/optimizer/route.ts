import { NextRequest, NextResponse } from "next/server";
import { getChannelMixAnalysis } from "@/lib/data/optimizer";
import { z } from "zod";
import { requireClientAccess, requireUser } from "@/lib/auth/guard";
import { withRoute } from "@/lib/http/with-route";

const optimizerSchema = z.object({
  clientId: z.string().uuid(),
  startDate: z.string(),
  endDate: z.string(),
});

export const GET = withRoute("optimizer.GET", async (request: NextRequest) => {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;

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

  const access = await requireClientAccess(gate.ctx, parsed.data.clientId);
  if (!access.ok) return access.response;

  const result = await getChannelMixAnalysis(parsed.data);
  return NextResponse.json(result);
});
