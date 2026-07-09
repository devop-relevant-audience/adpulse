import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSession, listSessions } from "@/lib/data/chat";
import { requireClientAccess, requireUser } from "@/lib/auth/guard";

const createSchema = z.object({
  clientId: z.string().uuid(),
  title: z.string().optional(),
});

export async function GET(request: NextRequest) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;

  try {
    const { searchParams } = request.nextUrl;
    const clientId = searchParams.get("clientId");

    const parsed = z.string().uuid().safeParse(clientId);
    if (!parsed.success) {
      return NextResponse.json({ error: "Valid clientId is required" }, { status: 400 });
    }

    const access = await requireClientAccess(gate.ctx, parsed.data);
    if (!access.ok) return access.response;

    return NextResponse.json({ sessions: await listSessions(parsed.data) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch chat sessions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;

  try {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create chat session";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
