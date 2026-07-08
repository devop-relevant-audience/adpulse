import { NextResponse } from "next/server";
import { getClients } from "@/lib/data/queries";
import { allowedClientIds, requireUser } from "@/lib/auth/guard";

export async function GET() {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;

  try {
    const clients = await getClients();
    const allowed = await allowedClientIds(gate.ctx);
    // Agency (null) sees every client; a client_user sees only their memberships.
    const visible = allowed === null ? clients : clients.filter((c) => allowed.includes(c.id));
    return NextResponse.json(visible);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch clients";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
