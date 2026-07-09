import { NextResponse } from "next/server";
import { getClients } from "@/lib/data/queries";
import { allowedClientIds, requireUser } from "@/lib/auth/guard";
import { withRoute } from "@/lib/http/with-route";

export const GET = withRoute("clients.GET", async () => {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;

  const clients = await getClients();
  const allowed = await allowedClientIds(gate.ctx);
  // Agency (null) sees every client; a client_user sees only their memberships.
  const visible = allowed === null ? clients : clients.filter((c) => allowed.includes(c.id));
  return NextResponse.json(visible);
});
