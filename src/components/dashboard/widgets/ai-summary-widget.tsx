"use client";

import ReactMarkdown from "react-markdown";
import { BiBot } from "react-icons/bi";
import { Textarea } from "@/components/ui/textarea";
import { ConfigSection } from "@/components/dashboard/config-ui";
import type { WidgetRenderProps, WidgetConfigFormProps } from "@/lib/dashboard/types";
import {
  AI_SUMMARY_INSTRUCTIONS_MAX,
  readAiSummaryConfig,
} from "@/lib/dashboard/report-blocks";

// A report-only block whose text is written ONCE, when the report is generated,
// and frozen into the snapshot with every other number. On the editor canvas
// there is nothing to show but the placeholder below — no data hook, no
// request: the summary does not exist until a report is built from the layout.

/**
 * The presentational half, shared by the frozen report renderer — no hooks.
 * `generated: false` means the model was unavailable and the text is the
 * deterministic fallback, which is stated so nobody reads it as AI analysis.
 */
export function AiSummaryBlock({ content, generated }: { content: string; generated: boolean }) {
  return (
    <div className="h-full w-full overflow-auto">
      <div className="text-sm text-ink prose-sm max-w-none [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-4">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
      {!generated && (
        <p className="mt-2 text-[11px] text-ink-faint">Written from the period totals.</p>
      )}
    </div>
  );
}

export function AiSummaryWidget({ config }: WidgetRenderProps) {
  const { instructions } = readAiSummaryConfig(config);
  return (
    <div className="h-full w-full flex flex-col justify-center gap-2 p-4 text-center">
      <span className="inline-flex items-center justify-center gap-1.5 text-[12px] font-medium text-ink-secondary">
        <BiBot className="w-4 h-4 shrink-0" />
        AI summary — written when the report is generated
      </span>
      {instructions && (
        <p className="text-[11px] text-ink-muted line-clamp-3">
          Instructions: {instructions}
        </p>
      )}
    </div>
  );
}

export function AiSummaryConfigForm({ config, onChange }: WidgetConfigFormProps) {
  const instructions = typeof config.instructions === "string" ? config.instructions : "";
  return (
    <ConfigSection title="AI summary" hint="Optional steer for the model">
      <Textarea
        value={instructions}
        maxLength={AI_SUMMARY_INSTRUCTIONS_MAX}
        onChange={(e) => onChange({ ...config, instructions: e.target.value })}
        placeholder="e.g. Lead with conversion volume, then explain the CPA move. Two paragraphs."
        aria-label="AI summary instructions"
        rows={5}
      />
    </ConfigSection>
  );
}
