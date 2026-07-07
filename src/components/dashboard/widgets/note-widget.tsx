"use client";

import ReactMarkdown from "react-markdown";
import { Textarea } from "@/components/ui/textarea";
import type { WidgetRenderProps, WidgetConfigFormProps } from "@/lib/dashboard/types";

function readText(config: Record<string, unknown>): string {
  return typeof config.text === "string" ? config.text : "";
}

export function NoteWidget({ config }: WidgetRenderProps) {
  const text = readText(config);
  if (!text.trim()) {
    return (
      <div className="h-full grid place-items-center text-xs text-ink-faint italic">
        Empty note — edit to add text
      </div>
    );
  }
  return (
    <div className="h-full w-full overflow-auto text-sm text-ink prose-sm max-w-none [&_p]:my-1 [&_h1]:text-base [&_h2]:text-sm [&_h1]:font-semibold [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:pl-4 [&_a]:text-primary">
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  );
}

export function NoteConfigForm({ config, onChange }: WidgetConfigFormProps) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-ink-secondary">Note (Markdown supported)</label>
      <Textarea
        value={readText(config)}
        onChange={(e) => onChange({ ...config, text: e.target.value })}
        placeholder="e.g. **Q3 focus:** shift budget to Google brand search…"
        rows={6}
      />
    </div>
  );
}
