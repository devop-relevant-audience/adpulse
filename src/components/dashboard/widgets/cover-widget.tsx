"use client";

import { format, parseISO } from "date-fns";
import { Input } from "@/components/ui/input";
import { ConfigSection, ConfigField } from "@/components/dashboard/config-ui";
import { useSelectedClient } from "@/hooks/use-selected-client";
import { useAppStore } from "@/store/app-store";
import type { WidgetRenderProps, WidgetConfigFormProps } from "@/lib/dashboard/types";
import {
  COVER_SUBTITLE_MAX,
  COVER_TITLE_MAX,
  DEFAULT_COVER_CONFIG,
  readCoverConfig,
} from "@/lib/dashboard/report-blocks";

// A report's cover block: report-only page furniture. Config shape and readers
// live in `@/lib/dashboard/report-blocks` — the snapshot builder reads them too.

function formatDate(iso: string): string {
  try {
    return format(parseISO(iso), "MMM d, yyyy");
  } catch {
    return iso;
  }
}

/**
 * The presentational half, shared by the editor canvas and the frozen report
 * renderer — no hooks, so `view-report.tsx` stays data-free.
 */
export function CoverBlock({
  clientName,
  title,
  subtitle,
  dateRange,
}: {
  clientName: string;
  title: string;
  subtitle: string;
  dateRange: { start: string; end: string };
}) {
  return (
    <div className="h-full w-full flex flex-col justify-center gap-1">
      {clientName && (
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted">
          {clientName}
        </p>
      )}
      <h2 className="text-2xl font-semibold tracking-[-0.4px] text-ink">{title}</h2>
      {subtitle && <p className="text-[13px] text-ink-secondary">{subtitle}</p>}
      <p className="text-[12px] text-ink-muted">
        Reporting period: {formatDate(dateRange.start)} — {formatDate(dateRange.end)}
      </p>
    </div>
  );
}

export function CoverWidget({ config }: WidgetRenderProps) {
  const { title, subtitle } = readCoverConfig(config);
  const client = useSelectedClient();
  const dateRange = useAppStore((s) => s.dateRange);

  return (
    <CoverBlock
      clientName={client?.name ?? ""}
      title={title}
      subtitle={subtitle}
      dateRange={dateRange}
    />
  );
}

export function CoverConfigForm({ config, onChange }: WidgetConfigFormProps) {
  // Raw values bypass readCoverConfig while typing (it trims and substitutes a
  // default, which would eat spaces and fight the empty field).
  const title = typeof config.title === "string" ? config.title : "";
  const subtitle = typeof config.subtitle === "string" ? config.subtitle : "";

  return (
    <ConfigSection title="Cover" hint="Client name and period come from the report">
      <ConfigField label="Title">
        <Input
          value={title}
          maxLength={COVER_TITLE_MAX}
          onChange={(e) => onChange({ ...config, title: e.target.value })}
          placeholder={DEFAULT_COVER_CONFIG.title}
          aria-label="Cover title"
          className="h-8 text-xs bg-white"
        />
      </ConfigField>

      <ConfigField label="Subtitle" hint="Optional">
        <Input
          value={subtitle}
          maxLength={COVER_SUBTITLE_MAX}
          onChange={(e) => onChange({ ...config, subtitle: e.target.value })}
          placeholder="e.g. Prepared by the Relevant Audience team"
          aria-label="Cover subtitle"
          className="h-8 text-xs bg-white"
        />
      </ConfigField>
    </ConfigSection>
  );
}
