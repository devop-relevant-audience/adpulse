"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  X,
  Send,
  Sparkles,
  User,
  Trash2,
  StopCircle,
} from "lucide-react";
import { useAppStore, type ReferenceContext } from "@/store/app-store";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  referenceContext?: ReferenceContext | null;
}

function formatRefContext(ctx: ReferenceContext): string {
  if (ctx.comparisonType === "campaigns" && ctx.comparisonCampaigns) {
    const names = ctx.comparisonCampaigns.map((c) => c.name);
    return `Comparing: ${names.join(" vs ")}`;
  }
  if (ctx.comparisonType === "periods" && ctx.comparisonPeriods) {
    return `Comparing: ${ctx.comparisonPeriods.periodA.label} vs ${ctx.comparisonPeriods.periodB.label}`;
  }
  const parts: string[] = [];
  if (ctx.campaignName) parts.push(ctx.campaignName);
  if (ctx.platform) parts.push(ctx.platform);
  if (ctx.metric) parts.push(ctx.metric);
  if (ctx.dateRange) parts.push(`${ctx.dateRange.start} → ${ctx.dateRange.end}`);
  return parts.join(" · ");
}

export function ChatPanel() {
  const isChatOpen = useAppStore((s) => s.isChatOpen);
  const setChatOpen = useAppStore((s) => s.setChatOpen);
  const referenceContext = useAppStore((s) => s.referenceContext);
  const setReferenceContext = useAppStore((s) => s.setReferenceContext);
  const clientId = useAppStore((s) => s.selectedClientId);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, scrollToBottom]);

  useEffect(() => {
    if (isChatOpen && textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 200);
    }
  }, [isChatOpen]);

  function handleAbort() {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsLoading(false);
    if (streamingContent) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: streamingContent + "\n\n_(Response interrupted)_",
        },
      ]);
      setStreamingContent("");
    }
  }

  async function handleSend(directMessage?: string) {
    const text = directMessage ?? input.trim();
    if (!text || isLoading || !clientId) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      referenceContext,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setReferenceContext(null);
    setIsLoading(true);
    setStreamingContent("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage.content,
          clientId,
          referenceContext,
          history: messages.slice(-10).map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error("Failed to get response");

      const contentType = res.headers.get("content-type") || "";

      if (contentType.includes("text/event-stream")) {
        const reader = res.body?.getReader();
        if (!reader) throw new Error("No reader available");

        const decoder = new TextDecoder();
        let accumulated = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") break;
              try {
                const parsed = JSON.parse(data);
                if (parsed.content) {
                  accumulated += parsed.content;
                  setStreamingContent(accumulated);
                }
              } catch {
                // skip
              }
            }
          }
        }

        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: accumulated || "I couldn't generate a response.",
          },
        ]);
        setStreamingContent("");
      } else {
        const data = await res.json();
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: data.response || data.error || "I couldn't generate a response.",
          },
        ]);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Sorry, something went wrong. Please try again.",
        },
      ]);
    } finally {
      setIsLoading(false);
      setStreamingContent("");
      abortRef.current = null;
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleClearChat() {
    setMessages([]);
    setStreamingContent("");
  }

  return (
    <aside
      className={cn(
        "fixed top-0 right-0 bottom-0 w-[420px] bg-white border-l border-hairline flex flex-col z-40",
        "transition-transform duration-300 ease-in-out shadow-(--shadow-elevated)",
        isChatOpen ? "translate-x-0" : "translate-x-full"
      )}
      aria-label="AI Chat Panel"
      aria-hidden={!isChatOpen}
    >
      <div className="flex items-center justify-between px-5 h-14 border-b border-hairline shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
          </div>
          <h2 className="font-semibold text-[13px] text-ink">AI Assistant</h2>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-ink-muted hover:text-ink"
              onClick={handleClearChat}
              aria-label="Clear chat"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-ink-muted hover:text-ink"
            onClick={() => setChatOpen(false)}
            aria-label="Close chat"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-5 py-4 scrollbar-thin"
      >
        {messages.length === 0 && !streamingContent && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-10 h-10 rounded-xl bg-primary/8 flex items-center justify-center mb-4">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <p className="text-sm font-medium text-ink mb-1">
              Ask anything about your ad data
            </p>
            <p className="text-[12px] text-ink-muted max-w-[240px] leading-relaxed mb-5">
              Click any metric, chart point, or campaign row to pre-load context, then ask.
            </p>
            <div className="flex flex-col gap-2 w-full max-w-[320px]">
              {[
                "Which campaigns are underperforming this month?",
                "How can I improve my ROAS across platforms?",
                "Summarize my ad spend and conversions this week",
                "Are there any budget pacing issues I should fix?",
              ].map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => handleSend(prompt)}
                  disabled={!clientId}
                  className="text-left px-3.5 py-2.5 rounded-lg border border-hairline bg-white hover:bg-primary/5 hover:border-primary/30 text-[12px] text-ink-muted hover:text-ink transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn("flex gap-2.5", msg.role === "user" && "justify-end")}
            >
              {msg.role === "assistant" && (
                <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Sparkles className="w-3 h-3 text-primary" />
                </div>
              )}
              <div
                className={cn(
                  "max-w-[85%] rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed",
                  msg.role === "user"
                    ? "bg-primary text-white"
                    : "bg-[#f4f4f5] text-ink"
                )}
              >
                {msg.referenceContext && (
                  <div className="mb-2 pb-2 border-b border-white/20">
                    <Badge
                      variant="secondary"
                      className="text-[10px] bg-white/20 text-white border-0"
                    >
                      @ {formatRefContext(msg.referenceContext)}
                    </Badge>
                  </div>
                )}
                <div className="prose-chat">
                  {msg.role === "assistant" ? (
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  ) : (
                    <span className="whitespace-pre-wrap">{msg.content}</span>
                  )}
                </div>
              </div>
              {msg.role === "user" && (
                <div className="w-6 h-6 rounded-md bg-ink/8 flex items-center justify-center shrink-0 mt-0.5">
                  <User className="w-3 h-3 text-ink-muted" />
                </div>
              )}
            </div>
          ))}

          {isLoading && streamingContent && (
            <div className="flex gap-2.5">
              <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <Sparkles className="w-3 h-3 text-primary" />
              </div>
              <div className="max-w-[85%] rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed bg-[#f4f4f5] text-ink">
                <div className="prose-chat">
                  <ReactMarkdown>{streamingContent}</ReactMarkdown>
                </div>
                <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse ml-0.5 rounded-sm" />
              </div>
            </div>
          )}

          {isLoading && !streamingContent && (
            <div className="flex gap-2.5">
              <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                <Sparkles className="w-3 h-3 text-primary animate-pulse" />
              </div>
              <div className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-[#f4f4f5]">
                <span className="w-1.5 h-1.5 rounded-full bg-ink-muted animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-ink-muted animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-ink-muted animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-hairline p-4 shrink-0">
        {referenceContext && (
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="secondary" className="text-[11px] gap-1">
              @ {formatRefContext(referenceContext)}
              <button
                onClick={() => setReferenceContext(null)}
                className="ml-1 hover:text-destructive transition-colors"
                aria-label="Remove context"
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          </div>
        )}
        <div className="flex items-end gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={clientId ? "Ask about your ad performance..." : "Select a client first"}
            disabled={!clientId}
            className="min-h-[40px] max-h-[120px] resize-none border-hairline rounded-lg text-[13px] focus:ring-2 focus:ring-primary/20 focus:border-primary transition-shadow"
            rows={1}
          />
          {isLoading ? (
            <Button
              size="icon"
              variant="outline"
              onClick={handleAbort}
              className="rounded-lg h-10 w-10 shrink-0 border-destructive text-destructive hover:bg-destructive/10"
              aria-label="Stop generating"
            >
              <StopCircle className="w-4 h-4" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={() => handleSend()}
              disabled={!input.trim() || !clientId}
              className="rounded-lg h-10 w-10 bg-primary hover:bg-primary/90 shrink-0 transition-colors"
              aria-label="Send message"
            >
              <Send className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}
