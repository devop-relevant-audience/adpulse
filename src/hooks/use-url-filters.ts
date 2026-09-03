"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Platform } from "@/lib/types/database";
import { isCompareMode, type CompareMode } from "@/lib/dashboard/date-presets";

const PLATFORMS: Platform[] = ["google", "meta", "tiktok"];

/** Same cap the metrics API enforces on a `campaignIds` list. */
export const MAX_PAGE_CAMPAIGN_IDS = 200;

export function isPlatform(value: string | null | undefined): value is Platform {
  return !!value && (PLATFORMS as string[]).includes(value);
}

/** Comma list → deduped non-empty ids, capped. Mirrors `splitList` in the
 * metrics route so the page filter can never build a URL that route rejects. */
function parseCampaignIds(raw: string | null): string[] {
  if (!raw) return [];
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return Array.from(new Set(ids)).slice(0, MAX_PAGE_CAMPAIGN_IDS);
}

/**
 * Reads the shared dashboard filters out of the URL search params. `start`/`end`
 * fall back to `null` when absent (callers keep the store default in that case);
 * `platform` is `undefined` for the "all platforms" state; `compare` is
 * `"none"` when absent or unrecognized; `campaignIds` is empty for "all
 * campaigns" and keeps a stable identity per raw param string, since the store
 * bridge's effect depends on it.
 */
export function useUrlFilters() {
  const sp = useSearchParams();
  const start = sp.get("start");
  const end = sp.get("end");
  const platformRaw = sp.get("platform");
  const compareRaw = sp.get("compare");
  const campaignsRaw = sp.get("campaigns");
  const campaignIds = useMemo(() => parseCampaignIds(campaignsRaw), [campaignsRaw]);
  return {
    start: start || null,
    end: end || null,
    platform: isPlatform(platformRaw) ? platformRaw : undefined,
    compare: isCompareMode(compareRaw) ? compareRaw : ("none" as CompareMode),
    campaignIds,
  };
}

/**
 * Writes the shared filters back to the URL (replace, no scroll) while
 * preserving every other query param. The `[clientId]` layout mirrors these
 * into the Zustand store, so existing consumers keep reading the store.
 */
export function useSetUrlFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const setDateRange = useCallback(
    (range: { start: string; end: string }) => {
      const next = new URLSearchParams(sp.toString());
      next.set("start", range.start);
      next.set("end", range.end);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [router, pathname, sp]
  );

  const setPlatform = useCallback(
    (platform: Platform | undefined) => {
      const next = new URLSearchParams(sp.toString());
      if (platform) next.set("platform", platform);
      else next.delete("platform");
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [router, pathname, sp]
  );

  const setCompareMode = useCallback(
    (mode: CompareMode) => {
      const next = new URLSearchParams(sp.toString());
      if (mode === "none") next.delete("compare");
      else next.set("compare", mode);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [router, pathname, sp]
  );

  const setCampaignIds = useCallback(
    (ids: string[]) => {
      const next = new URLSearchParams(sp.toString());
      if (ids.length === 0) next.delete("campaigns");
      else next.set("campaigns", ids.join(","));
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [router, pathname, sp]
  );

  /** Clears platform/compare/campaigns and sets the date range in ONE replace.
   * Calling the individual setters in sequence would not work: each builds its
   * URL from the same render's search params, so only the last write survives. */
  const resetFilters = useCallback(
    (range: { start: string; end: string }) => {
      const next = new URLSearchParams(sp.toString());
      next.set("start", range.start);
      next.set("end", range.end);
      next.delete("platform");
      next.delete("compare");
      next.delete("campaigns");
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [router, pathname, sp]
  );

  return { setDateRange, setPlatform, setCompareMode, setCampaignIds, resetFilters };
}

/** Builds a `?start&end&platform&compare&campaigns` query string from the
 * current filters, for carrying filter state across nav links. Returns "" when
 * nothing is set. Pass `includeCampaigns: false` for links that switch CLIENT:
 * campaign ids belong to one client, so they must not travel to another. */
export function useFilterQuery(options?: { includeCampaigns?: boolean }) {
  const includeCampaigns = options?.includeCampaigns ?? true;
  const sp = useSearchParams();
  const next = new URLSearchParams();
  const keys = includeCampaigns
    ? ["start", "end", "platform", "compare", "campaigns"]
    : ["start", "end", "platform", "compare"];
  for (const key of keys) {
    const v = sp.get(key);
    if (v) next.set(key, v);
  }
  const s = next.toString();
  return s ? `?${s}` : "";
}
