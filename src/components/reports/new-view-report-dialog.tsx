"use client";

// "New report from view": pick a saved dashboard view and a date range, and the
// server freezes every widget's numbers into a report that never moves again.

import { useState } from "react";
import { format, parseISO } from "date-fns";
import { BiRefresh } from "react-icons/bi";
import { useDashboards } from "@/hooks/use-dashboard";
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

export function NewViewReportDialog({
  clientId,
  onClose,
  onCreated,
}: {
  clientId: string;
  onClose: () => void;
  onCreated: (report: ReportRow) => void;
}) {
  const pageRange = useAppStore((s) => s.dateRange);
  const { data: views, isLoading: viewsLoading } = useDashboards(clientId);

  const [viewId, setViewId] = useState<string>("");
  const [presetId, setPresetId] = useState<string>(CUSTOM);
  const [range, setRange] = useState(pageRange);
  // Null until the user types: the title otherwise tracks the view + range.
  const [titleOverride, setTitleOverride] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const view = views?.find((v) => v.id === viewId);
  const autoTitle = view ? `${view.name} — ${rangeLabel(range)}` : "";
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
    if (!view || !rangeValid || !title.trim()) return;
    setIsCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          fromDashboardId: view.id,
          title: title.trim(),
          dateRange: range,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to create the report");
      }
      onCreated((await res.json()) as ReportRow);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create the report");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New report from view</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-[12px] text-ink-muted">
            The report stores the view&apos;s numbers as they are right now. It keeps showing
            them even after the data, the view or its widgets change.
          </p>

          <div>
            <label className="text-[12px] font-medium text-ink-muted block mb-1.5">Dashboard view</label>
            <Select value={viewId} onValueChange={(v) => { if (v) setViewId(v); }} disabled={viewsLoading}>
              <SelectTrigger className="h-9" aria-label="Dashboard view">
                <SelectValue placeholder={viewsLoading ? "Loading views…" : "Choose a view"} />
              </SelectTrigger>
              <SelectContent>
                {views?.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                    {v.visibility === "internal" ? " (internal)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!viewsLoading && (views?.length ?? 0) === 0 && (
              <p className="text-[11px] text-ink-muted mt-1">
                This client has no saved views yet — save one on the dashboard first.
              </p>
            )}
          </div>

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
                <label htmlFor="view-report-start" className="text-[11px] text-ink-muted block mb-1">Start</label>
                <Input
                  id="view-report-start"
                  type="date"
                  value={range.start}
                  onChange={(e) => setCustomBound("start", e.target.value)}
                  className="h-9"
                />
              </div>
              <div>
                <label htmlFor="view-report-end" className="text-[11px] text-ink-muted block mb-1">End</label>
                <Input
                  id="view-report-end"
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
            <label htmlFor="view-report-title" className="text-[12px] font-medium text-ink-muted block mb-1.5">Title</label>
            <Input
              id="view-report-title"
              value={title}
              maxLength={200}
              placeholder={autoTitle || "Report title"}
              onChange={(e) => setTitleOverride(e.target.value)}
            />
          </div>

          {error && <p role="alert" className="text-[12px] text-red-600">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={isCreating || !view || !rangeValid || !title.trim()}
            className="gap-1.5"
          >
            {isCreating && <BiRefresh className="w-4 h-4 animate-spin" />}
            {isCreating ? "Building…" : "Create report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
