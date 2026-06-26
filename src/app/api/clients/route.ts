import { NextResponse } from "next/server";
import { getClients } from "@/lib/data/queries";

export async function GET() {
  try {
    const clients = await getClients();
    return NextResponse.json(clients);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch clients";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
