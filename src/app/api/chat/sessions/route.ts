import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSession, listSessions } from "@/lib/data/chat";
import { requireClientAccess, requireUser } from "@/lib/auth/guard";
import { withRoute } from "@/lib/http/with-route";

const createSchema = z.object({
  clientId: z.string().uuid(),
  title: z.string().optional(),
});

export const GET = withRoute("chat.sessions.GET", async (request: NextRequest) => {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;

  const { searchParams } = request.nextUrl;
  const clientId = searchParams.get("clientId");

  const parsed = z.string().uuid().safeParse(clientId);
  if (!parsed.success) {
    return NextResponse.json({ error: "Valid clientId is required" }, { status: 400 });
  }

  const access = await requireClientAccess(gate.ctx, parsed.data);
  if (!access.ok) return access.response;

  return NextResponse.json({ sessions: await listSessions(parsed.data) });
});

export const POST = withRoute("chat.sessions.POST", async (request: NextRequest) => {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid parameters", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const access = await requireClientAccess(gate.ctx, parsed.data.clientId);
  if (!access.ok) return access.response;

  const title = parsed.data.title?.trim().slice(0, 80) || "New chat";
  const session = await createSession(parsed.data.clientId, title);

  return NextResponse.json({ session }, { status: 201 });
});
