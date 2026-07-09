"use client";

import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";
import { PLATFORM_COLORS } from "@/lib/dashboard/chart-theme";
import type { Platform } from "@/lib/types/database";

const PLATFORM_OPTIONS: Array<{ value: Platform | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "google", label: "Google" },
  { value: "meta", label: "Meta" },
  { value: "tiktok", label: "TikTok" },
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
            "flex items-center gap-1.5 px-2.5 py-1 text-[12px] rounded-md transition-colors duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            currentValue === opt.value
              ? "bg-white font-medium text-ink shadow-sm"
              : "text-ink-muted hover:text-ink"
          )}
        >
          {opt.value === "all" ? (
            <span className="w-1.5 h-1.5 rounded-full bg-ink-muted" />
          ) : (
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: PLATFORM_COLORS[opt.value] }}
            />
          )}
          {opt.label}
        </button>
      ))}
    </div>
  );
}
