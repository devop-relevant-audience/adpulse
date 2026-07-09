import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { chatMessages, chatSessions } from "@/lib/db/schema";

export interface ChatSessionSummary {
  id: string;
  clientId: string;
  title: string;
  createdAt: string;
}

export interface ChatMessageRecord {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  referenceContext: Record<string, unknown> | null;
  createdAt: string;
}

// List a client's sessions, newest first.
export async function listSessions(clientId: string): Promise<ChatSessionSummary[]> {
  return db
    .select({
      id: chatSessions.id,
      clientId: chatSessions.clientId,
      title: chatSessions.title,
      createdAt: chatSessions.createdAt,
    })
    .from(chatSessions)
    .where(eq(chatSessions.clientId, clientId))
    .orderBy(desc(chatSessions.createdAt));
}

// Fetch one session (for ownership checks). null if not found.
export async function getSession(sessionId: string): Promise<ChatSessionSummary | null> {
  const [row] = await db
    .select({
      id: chatSessions.id,
      clientId: chatSessions.clientId,
      title: chatSessions.title,
      createdAt: chatSessions.createdAt,
    })
    .from(chatSessions)
    .where(eq(chatSessions.id, sessionId))
    .limit(1);

  return row ?? null;
}

// Create a session. title should already be trimmed/truncated by the caller.
export async function createSession(clientId: string, title: string): Promise<ChatSessionSummary> {
  const [row] = await db
    .insert(chatSessions)
    .values({ clientId, title })
    .returning({
      id: chatSessions.id,
      clientId: chatSessions.clientId,
      title: chatSessions.title,
      createdAt: chatSessions.createdAt,
    });

  return row;
}

// All messages for a session, oldest first (id tiebreaks same-timestamp rows).
export async function getMessages(sessionId: string): Promise<ChatMessageRecord[]> {
  const rows = await db
    .select({
      id: chatMessages.id,
      sessionId: chatMessages.sessionId,
      role: chatMessages.role,
      content: chatMessages.content,
      referenceContext: chatMessages.referenceContext,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id));

  return rows.map((row) => ({
    ...row,
    role: row.role as "user" | "assistant",
    referenceContext: row.referenceContext as Record<string, unknown> | null,
  }));
}

// Insert one message. referenceContext defaults to null.
export async function addMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  referenceContext: Record<string, unknown> | null = null,
): Promise<ChatMessageRecord> {
  const [row] = await db
    .insert(chatMessages)
    .values({ sessionId, role, content, referenceContext })
    .returning({
      id: chatMessages.id,
      sessionId: chatMessages.sessionId,
      role: chatMessages.role,
      content: chatMessages.content,
      referenceContext: chatMessages.referenceContext,
      createdAt: chatMessages.createdAt,
    });

  return {
    ...row,
    role: row.role as "user" | "assistant",
    referenceContext: row.referenceContext as Record<string, unknown> | null,
  };
}

// Delete a session (messages cascade via FK).
export async function deleteSession(sessionId: string): Promise<void> {
  await db.delete(chatSessions).where(eq(chatSessions.id, sessionId));
}
