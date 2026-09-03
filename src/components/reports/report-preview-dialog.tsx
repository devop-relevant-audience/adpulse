"use client";

// "Preview": what generating this report layout right now would look like.
// Nothing is written — the server computes the snapshot, hands it back and
// forgets it — and the AI summary is skipped, so the blocks that would carry
// prose show a placeholder instead of costing a model call for a throwaway.
//
// The same dialog previews a report TEMPLATE against the selected client: what
// stamping it onto them would produce. Only the endpoint differs.

import { format, parseISO } from "date-fns";
import { useAppStore } from "@/store/app-store";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/ui/query-error";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ViewReport } from "@/components/reports/view-report";
import { useReportLayoutPreview } from "@/hooks/use-report-layouts";
import { useReportTemplatePreview } from "@/hooks/use-report-templates";

/** What is being previewed — a client's own layout, or an agency template. */
export type ReportPreviewSource = { kind: "layout"; id: string } | { kind: "template"; id: string };

function rangeLabel(range: { start: string; end: string }): string {
  try {
    return `${format(parseISO(range.start), "MMM d")} — ${format(parseISO(range.end), "MMM d, yyyy")}`;
  } catch {
    return `${range.start} — ${range.end}`;
  }
}

export function ReportPreviewDialog({
  clientId,
  source,
  name,
  onClose,
}: {
  clientId: string;
  source: ReportPreviewSource;
  /** What the dialog title names — the layout's or the template's name. */
  name: string;
  onClose: () => void;
}) {
  // The page's current range, the same one "Generate report" starts from.
  const range = useAppStore((s) => s.dateRange);
  // Both hooks are called unconditionally (rules of hooks); only the one
  // matching the source actually fetches.
  const isTemplate = source.kind === "template";
  const layoutPreview = useReportLayoutPreview(clientId, source.id, range, !isTemplate);
  const templatePreview = useReportTemplatePreview(clientId, source.id, range, isTemplate);
  const { data, isLoading, isError, error, refetch } = isTemplate
    ? templatePreview
    : layoutPreview;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-[960px]">
        <DialogHeader>
          <DialogTitle>Preview — {name}</DialogTitle>
        </DialogHeader>

        <p className="text-[12px] text-ink-muted">
          The layout as last saved, over {rangeLabel(range)}. Nothing is saved, and the AI
          summary is only written when you generate the report.
        </p>

        <div className="max-h-[80vh] overflow-y-auto rounded-xl bg-canvas-soft p-4">
          {isLoading && <Skeleton className="h-[400px] w-full rounded-xl" />}

          {!isLoading && isError && (
            <QueryError
              onRetry={() => refetch()}
              message={error instanceof Error ? error.message : "Couldn't build the preview"}
            />
          )}

          {!isLoading && !isError && data && <ViewReport snapshot={data} />}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
