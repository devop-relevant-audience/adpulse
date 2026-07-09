import { NextRequest, NextResponse } from "next/server";
import { deleteSession, getMessages, getSession } from "@/lib/data/chat";
import { requireClientAccess, requireUser } from "@/lib/auth/guard";
import { withRoute } from "@/lib/http/with-route";

export const GET = withRoute(
  "chat.sessions.[id].GET",
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const gate = await requireUser();
    if (!gate.ok) return gate.response;

    const { id } = await params;

    const session = await getSession(id);
    if (!session) {
      return NextResponse.json({ error: "Chat session not found" }, { status: 404 });
    }

    const access = await requireClientAccess(gate.ctx, session.clientId);
    if (!access.ok) return access.response;

    return NextResponse.json({ session, messages: await getMessages(id) });
  }
);

export const DELETE = withRoute(
  "chat.sessions.[id].DELETE",
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const gate = await requireUser();
    if (!gate.ok) return gate.response;

    const { id } = await params;

    const session = await getSession(id);
    if (!session) {
      return NextResponse.json({ error: "Chat session not found" }, { status: 404 });
    }

    const access = await requireClientAccess(gate.ctx, session.clientId);
    if (!access.ok) return access.response;

    await deleteSession(id);

    return NextResponse.json({ ok: true });
  }
);
