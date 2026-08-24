"use client";

import type { ReactNode } from "react";
import { BiInfoCircle } from "react-icons/bi";
import { Panel } from "@/components/ui/panel";
import { useSelectedClient } from "@/hooks/use-selected-client";

/**
 * Attribution and creatives run entirely on fabricated demo data
 * (attribution_journeys / customer_cohorts / ad_creatives — see CLAUDE.md).
 * Real clients (`is_demo === false`) don't have those data sources connected
 * yet, so these views/widgets are gated off for them. Demo clients
 * (`is_demo === true`, or unresolved) see everything unchanged.
 */

/** Full-page-section empty state for a view that's entirely demo-only.
 * Renders in place of the real page content on direct URL navigation, not
 * just when nav is hidden. */
export function DemoOnlyEmptyState({ description }: { description: string }) {
  return (
    <Panel className="p-10">
      <div className="max-w-md mx-auto text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-canvas-soft grid place-items-center mb-4">
          <BiInfoCircle className="w-6 h-6 text-ink-muted" />
        </div>
        <h2 className="text-base font-semibold text-ink">Not available for live clients yet</h2>
        <p className="text-[13px] text-ink-muted mt-2 leading-relaxed">{description}</p>
      </div>
    </Panel>
  );
}

/** Wraps a demo-only page's content. Renders `children` for demo clients (and
 * while the client is still resolving) and the empty state otherwise — so
 * direct navigation to the URL is gated the same as the nav link. */
export function DemoOnlyGate({ description, children }: { description: string; children: ReactNode }) {
  const client = useSelectedClient();
  if (client?.is_demo === false) {
    return <DemoOnlyEmptyState description={description} />;
  }
  return <>{children}</>;
}

/** Compact placeholder for a dashboard widget backed by demo-only data. */
export function DemoOnlyWidgetPlaceholder({ label }: { label: string }) {
  return (
    <div className="h-full w-full grid place-items-center px-2 text-center">
      <div>
        <BiInfoCircle className="w-4 h-4 text-ink-muted mx-auto mb-1.5" />
        <p className="text-[11px] text-ink-muted leading-snug">{label}</p>
      </div>
    </div>
  );
}
