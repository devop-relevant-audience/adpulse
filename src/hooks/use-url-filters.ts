"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Platform } from "@/lib/types/database";

const PLATFORMS: Platform[] = ["google", "meta", "tiktok"];

export function isPlatform(value: string | null | undefined): value is Platform {
  return !!value && (PLATFORMS as string[]).includes(value);
}

/**
 * Reads the shared dashboard filters out of the URL search params. `start`/`end`
 * fall back to `null` when absent (callers keep the store default in that case);
 * `platform` is `undefined` for the "all platforms" state.
 */
export function useUrlFilters() {
  const sp = useSearchParams();
  const start = sp.get("start");
  const end = sp.get("end");
  const platformRaw = sp.get("platform");
  return {
    start: start || null,
    end: end || null,
    platform: isPlatform(platformRaw) ? platformRaw : undefined,
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

  return { setDateRange, setPlatform };
}

/** Builds a `?start&end&platform` query string from the current filters, for
 * carrying filter state across nav links. Returns "" when nothing is set. */
export function useFilterQuery() {
  const sp = useSearchParams();
  const next = new URLSearchParams();
  for (const key of ["start", "end", "platform"]) {
    const v = sp.get(key);
    if (v) next.set(key, v);
  }
  const s = next.toString();
  return s ? `?${s}` : "";
}
