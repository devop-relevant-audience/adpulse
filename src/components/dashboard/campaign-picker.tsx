"use client";

import { useMemo, useState } from "react";
import { BiSearch } from "react-icons/bi";
import { useCampaigns } from "@/hooks/use-metrics";
import { MAX_PAGE_CAMPAIGN_IDS } from "@/hooks/use-url-filters";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PLATFORM_COLORS, PLATFORM_LABELS_SHORT } from "@/lib/dashboard/chart-theme";
import { cn } from "@/lib/utils";
import type { Platform } from "@/lib/types/database";

/** "1 campaign" / "N campaigns" — shared by the page filter chip and the
 * widget config hint so both read the same way. */
export function campaignCountLabel(count: number): string {
  return `${count} campaign${count === 1 ? "" : "s"}`;
}

interface CampaignPickerProps {
  clientId: string | null;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  /** Restrict the list to these platforms when non-empty. */
  platforms?: Platform[];
  className?: string;
  /** Tailwind max-height for the scroll area. */
  maxHeightClassName?: string;
}

/**
 * Searchable campaign checkbox list. Used by both the page filter popover and
 * the widget config dialog, so it owns no filter state: the caller passes the
 * current selection and receives the next one. Selected ids outside the visible
 * (searched / platform-narrowed) list are always kept, and the selection can
 * never exceed `MAX_PAGE_CAMPAIGN_IDS`.
 */
export function CampaignPicker({
  clientId,
  selectedIds,
  onChange,
  platforms,
  className,
  maxHeightClassName = "max-h-56",
}: CampaignPickerProps) {
  const [search, setSearch] = useState("");
  const { data: campaigns, isLoading } = useCampaigns(clientId);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (campaigns ?? []).filter((c) => {
      if (platforms && platforms.length > 0 && !platforms.includes(c.platform as Platform)) return false;
      if (q && !c.campaign_name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [campaigns, platforms, search]);

  const searching = search.trim().length > 0;
  const atCap = selectedIds.length >= MAX_PAGE_CAMPAIGN_IDS;

  function toggle(id: string) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
      return;
    }
    if (atCap) return;
    onChange([...selectedIds, id]);
  }

  function selectAllShown() {
    const next = new Set(selectedIds);
    for (const c of visible) {
      if (next.size >= MAX_PAGE_CAMPAIGN_IDS) break;
      next.add(c.campaign_id);
    }
    onChange([...next]);
  }

  return (
    <div className={className}>
      <div className="relative">
        <BiSearch className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-faint pointer-events-none" />
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search campaigns"
          aria-label="Search campaigns"
          className="h-8 text-xs pl-7"
        />
      </div>
      <div
        className={cn(
          "mt-1.5 overflow-y-auto rounded-lg border border-hairline bg-white",
          maxHeightClassName
        )}
      >
        {!clientId || isLoading ? (
          <div className="p-2 space-y-1.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <p className="p-4 text-center text-xs text-ink-muted">No campaigns found</p>
        ) : (
          <ul className="divide-y divide-hairline/60">
            {visible.map((c) => {
              const checked = selectedIds.includes(c.campaign_id);
              const platform = c.platform as Platform;
              return (
                <li key={`${c.platform}:${c.campaign_id}`}>
                  <label className="flex items-center gap-2 px-2.5 py-2 cursor-pointer hover:bg-canvas-soft/60 transition-colors">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!checked && atCap}
                      onChange={() => toggle(c.campaign_id)}
                      className="h-3.5 w-3.5 shrink-0 rounded border-hairline accent-primary"
                    />
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: PLATFORM_COLORS[platform] }}
                    />
                    <span className="text-xs text-ink truncate flex-1 min-w-0" title={c.campaign_name}>
                      {c.campaign_name}
                    </span>
                    <span className="shrink-0 text-[10px] text-ink-muted">
                      {PLATFORM_LABELS_SHORT[platform] ?? c.platform}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {(selectedIds.length > 0 || (searching && visible.length > 0)) && (
        <div className="mt-1.5 flex items-baseline justify-between gap-2 text-[11px] text-ink-muted">
          <span>{selectedIds.length > 0 ? `${campaignCountLabel(selectedIds.length)} selected` : ""}</span>
          <span className="flex items-center gap-2">
            {searching && visible.length > 0 && (
              <TextAction onClick={selectAllShown}>Select all shown</TextAction>
            )}
            {selectedIds.length > 0 && <TextAction onClick={() => onChange([])}>Clear</TextAction>}
          </span>
        </div>
      )}
    </div>
  );
}

function TextAction({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[11px] text-ink-muted hover:text-ink underline underline-offset-2 transition-colors"
    >
      {children}
    </button>
  );
}
