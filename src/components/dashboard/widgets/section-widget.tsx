"use client";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ConfigSection, ConfigField } from "@/components/dashboard/config-ui";
import type { WidgetRenderProps, WidgetConfigFormProps } from "@/lib/dashboard/types";
import {
  DEFAULT_SECTION_CONFIG,
  SECTION_SUBTITLE_MAX,
  SECTION_TITLE_MAX,
  readSectionConfig,
} from "@/lib/dashboard/section";

/**
 * Pure layout: a labelled band separator for long dashboards. No data, no
 * filters. The widget frame renders it without the Panel chrome — a heading
 * inside a card with its own title bar would be a heading under a heading.
 * The config shape itself lives in `@/lib/dashboard/section` (server-safe).
 */

export function SectionWidget({ config }: WidgetRenderProps) {
  const { title, subtitle, divider } = readSectionConfig(config);
  return (
    <div className="h-full w-full flex flex-col justify-center">
      <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-secondary truncate">
        {title}
      </h3>
      {subtitle && <p className="text-[11px] text-ink-muted truncate mt-0.5">{subtitle}</p>}
      {divider && <div className="mt-2 h-px bg-hairline" />}
    </div>
  );
}

export function SectionConfigForm({ config, onChange }: WidgetConfigFormProps) {
  // Raw values bypass readSectionConfig while typing (it trims and substitutes
  // a default, which would eat spaces and fight the empty field).
  const title = typeof config.title === "string" ? config.title : "";
  const subtitle = typeof config.subtitle === "string" ? config.subtitle : "";
  const divider = typeof config.divider === "boolean" ? config.divider : true;

  return (
    <ConfigSection title="Section header">
      <ConfigField label="Title">
        <Input
          value={title}
          maxLength={SECTION_TITLE_MAX}
          onChange={(e) => onChange({ ...config, title: e.target.value })}
          placeholder={DEFAULT_SECTION_CONFIG.title}
          aria-label="Section title"
          className="h-8 text-xs bg-white"
        />
      </ConfigField>

      <ConfigField label="Subtitle" hint="Optional">
        <Input
          value={subtitle}
          maxLength={SECTION_SUBTITLE_MAX}
          onChange={(e) => onChange({ ...config, subtitle: e.target.value })}
          placeholder="e.g. Paid search performance"
          aria-label="Section subtitle"
          className="h-8 text-xs bg-white"
        />
      </ConfigField>

      <ConfigField label="Divider" hint="Rule under the heading">
        <Switch
          checked={divider}
          onCheckedChange={(v) => onChange({ ...config, divider: v })}
          aria-label="Show divider"
        />
      </ConfigField>
    </ConfigSection>
  );
}
