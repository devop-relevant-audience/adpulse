"use client";

// "Generate report": freeze a report layout's blocks — numbers and AI summary
// alike — into a report that never moves again. Mirrors
// `new-view-report-dialog.tsx`, but the source is a layout, not a dashboard view.

import { useState } from "react";
import { format, parseISO } from "date-fns";
import { BiRefresh } from "react-icons/bi";
import { useAppStore } from "@/store/app-store";
import { DATE_RANGE_PRESETS } from "@/lib/dashboard/date-presets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ReportRow } from "@/lib/types/database";

const CUSTOM = "custom";

function rangeLabel(range: { start: string; end: string }): string {
  try {
    return `${format(parseISO(range.start), "MMM d")} — ${format(parseISO(range.end), "MMM d, yyyy")}`;
  } catch {
    return `${range.start} — ${range.end}`;
  }
}

export function GenerateReportDialog({
  clientId,
  layoutId,
  layoutName,
  onClose,
  onCreated,
}: {
  clientId: string;
  layoutId: string;
  layoutName: string;
  onClose: () => void;
  onCreated: (report: ReportRow) => void;
}) {
  const pageRange = useAppStore((s) => s.dateRange);

  const [presetId, setPresetId] = useState<string>(CUSTOM);
  const [range, setRange] = useState(pageRange);
  // Null until the user types: the title otherwise tracks the range.
  const [titleOverride, setTitleOverride] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const autoTitle = `${layoutName} — ${rangeLabel(range)}`;
  const title = titleOverride ?? autoTitle;
  const rangeValid = !!range.start && !!range.end && range.start <= range.end;

  function applyPreset(id: string) {
    setPresetId(id);
    if (id === CUSTOM) return;
    const preset = DATE_RANGE_PRESETS.find((p) => p.id === id);
    if (preset) setRange(preset.getRange(new Date()));
  }

  function setCustomBound(key: "start" | "end", value: string) {
    setPresetId(CUSTOM);
    setRange((r) => ({ ...r, [key]: value }));
  }

  async function handleCreate() {
    if (!rangeValid || !title.trim()) return;
    setIsCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          fromReportLayoutId: layoutId,
          title: title.trim(),
          dateRange: range,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to generate the report");
      }
      onCreated((await res.json()) as ReportRow);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate the report");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate report</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-[12px] text-ink-muted">
            “{layoutName}” is built as it stands right now: the numbers and any AI summary are
            frozen onto the report and keep showing the same figures afterwards. Writing the
            summary can take a few seconds.
          </p>

          <div>
            <label className="text-[12px] font-medium text-ink-muted block mb-1.5">Date range</label>
            <Select value={presetId} onValueChange={(v) => { if (v) applyPreset(v); }}>
              <SelectTrigger className="h-9" aria-label="Date range preset">
                <SelectValue>
                  {DATE_RANGE_PRESETS.find((p) => p.id === presetId)?.label ?? "Custom range"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {DATE_RANGE_PRESETS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                ))}
                <SelectItem value={CUSTOM}>Custom range</SelectItem>
              </SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div>
                <label htmlFor="layout-report-start" className="text-[11px] text-ink-muted block mb-1">Start</label>
                <Input
                  id="layout-report-start"
                  type="date"
                  value={range.start}
                  onChange={(e) => setCustomBound("start", e.target.value)}
                  className="h-9"
                />
              </div>
              <div>
                <label htmlFor="layout-report-end" className="text-[11px] text-ink-muted block mb-1">End</label>
                <Input
                  id="layout-report-end"
                  type="date"
                  value={range.end}
                  onChange={(e) => setCustomBound("end", e.target.value)}
                  className="h-9"
                />
              </div>
            </div>
            {!rangeValid && (
              <p className="text-[11px] text-red-600 mt-1">Start must be on or before end.</p>
            )}
          </div>

          <div>
            <label htmlFor="layout-report-title" className="text-[12px] font-medium text-ink-muted block mb-1.5">Title</label>
            <Input
              id="layout-report-title"
              value={title}
              maxLength={200}
              placeholder={autoTitle || "Report title"}
              onChange={(e) => setTitleOverride(e.target.value)}
            />
          </div>

          {error && <p role="alert" className="text-[12px] text-red-600">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={isCreating}>Cancel</Button>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={isCreating || !rangeValid || !title.trim()}
            className="gap-1.5"
          >
            {isCreating && <BiRefresh className="w-4 h-4 animate-spin" />}
            {isCreating ? "Generating…" : "Generate report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
