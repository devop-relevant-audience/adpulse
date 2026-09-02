"use client";

import { Sidebar } from "./sidebar";
import { ChatPanel } from "@/components/chat/chat-panel";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  // Both right-hand panels are the same width and share the slot, so either one
  // pushes <main> aside by the same amount.
  const isChatOpen = useAppStore((s) => s.isChatOpen);
  const isBuilderOpen = useAppStore((s) => s.isBuilderOpen);

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 overflow-hidden">
        <main
          className={cn(
            "flex-1 overflow-y-auto scrollbar-thin transition-[margin] duration-300 ease-in-out",
            isChatOpen || isBuilderOpen ? "mr-[420px]" : "mr-0"
          )}
        >
          <div className="max-w-[1400px] mx-auto px-8 py-6">{children}</div>
        </main>
        <ChatPanel />
      </div>
    </div>
  );
}
