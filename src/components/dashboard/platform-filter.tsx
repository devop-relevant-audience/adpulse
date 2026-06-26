"use client";

import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";
import type { Platform } from "@/lib/types/database";

const PLATFORM_OPTIONS: Array<{ value: Platform | "all"; label: string; color: string }> = [
  { value: "all", label: "All", color: "bg-ink-muted" },
  { value: "google", label: "Google", color: "bg-[#4285F4]" },
  { value: "meta", label: "Meta", color: "bg-[#0668E1]" },
  { value: "tiktok", label: "TikTok", color: "bg-[#121212]" },
];

export function PlatformFilter() {
  const selectedPlatform = useAppStore((s) => s.selectedPlatform);
  const setSelectedPlatform = useAppStore((s) => s.setSelectedPlatform);

  const currentValue = selectedPlatform || "all";

  function handleSelect(value: Platform | "all") {
    setSelectedPlatform(value === "all" ? undefined : value);
  }

  return (
    <div className="flex items-center gap-0.5 p-0.5 bg-canvas-soft rounded-lg" role="tablist">
      {PLATFORM_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => handleSelect(opt.value)}
          role="tab"
          aria-selected={currentValue === opt.value}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 text-[12px] rounded-md transition-all duration-150",
            currentValue === opt.value
              ? "bg-white font-medium text-ink shadow-sm"
              : "text-ink-muted hover:text-ink"
          )}
        >
          <span className={cn("w-1.5 h-1.5 rounded-full", opt.color)} />
          {opt.label}
        </button>
      ))}
    </div>
  );
}
