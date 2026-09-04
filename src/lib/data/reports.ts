import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { reports } from "@/lib/db/schema";
import { keysToSnake } from "@/lib/db/case";
import type { ReportRow } from "@/lib/types/database";

/** One saved report by id, or null. Caller must authorize against `client_id`. */
export async function getReportById(id: string): Promise<ReportRow | null> {
  const [row] = await db.select().from(reports).where(eq(reports.id, id)).limit(1);
  return row ? (keysToSnake(row) as unknown as ReportRow) : null;
}
