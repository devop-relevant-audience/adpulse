import { NextRequest, NextResponse } from "next/server";
import { deleteSession, getMessages, getSession } from "@/lib/data/chat";
import { requireClientAccess, requireUser } from "@/lib/auth/guard";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;

  try {
    const { id } = await params;

    const session = await getSession(id);
    if (!session) {
      return NextResponse.json({ error: "Chat session not found" }, { status: 404 });
    }

    const access = await requireClientAccess(gate.ctx, session.clientId);
    if (!access.ok) return access.response;

    return NextResponse.json({ session, messages: await getMessages(id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch chat session";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;

  try {
    const { id } = await params;

    const session = await getSession(id);
    if (!session) {
      return NextResponse.json({ error: "Chat session not found" }, { status: 404 });
    }

    const access = await requireClientAccess(gate.ctx, session.clientId);
    if (!access.ok) return access.response;

    await deleteSession(id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete chat session";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
