import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAgencyRole, requireUser } from "@/lib/auth/guard";
import { withRoute } from "@/lib/http/with-route";
import { syncMeta } from "@/lib/windsor/sync";
import { WindsorError } from "@/lib/windsor/client";

const syncSchema = z.object({
  connector: z.enum(["meta", "google", "tiktok"]).default("meta"),
  // Rolling re-pull window override; omit for auto (28d incremental / 90d first run).
  days: z.number().int().min(1).max(365).optional(),
});

// Windsor pull + normalize can take a while on a first 90-day backfill.
export const maxDuration = 300;

export const POST = withRoute("sync.POST", async (request: NextRequest) => {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const role = requireAgencyRole(gate.ctx, "agency_admin");
  if (!role.ok) return role.response;

  const body = await request.json().catch(() => ({}));
  const parsed = syncSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.connector !== "meta") {
    return NextResponse.json(
      { error: `${parsed.data.connector} is not connected in Windsor yet` },
      { status: 501 }
    );
  }

  try {
    const summary = await syncMeta({ days: parsed.data.days });
    return NextResponse.json(summary);
  } catch (err) {
    if (err instanceof WindsorError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    throw err;
  }
});
