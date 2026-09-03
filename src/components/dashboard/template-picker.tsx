"use client";

import { useState } from "react";
import { BiPencil, BiTrash } from "react-icons/bi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDeleteTemplate, useTemplates, useUpdateTemplate } from "@/hooks/use-templates";
import {
  useDeleteReportTemplate,
  useReportTemplates,
  useUpdateReportTemplate,
} from "@/hooks/use-report-templates";
import type { DashboardTemplateSummary, ReportTemplateSummary } from "@/lib/dashboard/types";
import { cn } from "@/lib/utils";

/** Dashboard templates and report templates have the same list shape. */
type PickerTemplate = DashboardTemplateSummary | ReportTemplateSummary;

interface TemplatePickerProps {
  /** Currently chosen template id, or null when none is picked yet. */
  value: string | null;
  onChange: (id: string | null) => void;
  /** Only fetch while the picker is actually shown. */
  enabled: boolean;
  /** Which library to browse — dashboard views or report layouts. */
  kind?: "dashboard" | "report";
}

/**
 * The "from template" list in the new-view dialog: a radio list of agency
 * templates plus lightweight management (rename inline, delete with an inline
 * confirm) so templates never need a settings page of their own. Rename and
 * delete are offered on the selected row only, to keep the list scannable.
 */
export function TemplatePicker({
  value,
  onChange,
  enabled,
  kind = "dashboard",
}: TemplatePickerProps) {
  const isReport = kind === "report";
  // Both hook sets are called unconditionally (rules of hooks); only the one
  // matching `kind` actually fetches, and the mutations are inert until used.
  const dashboardList = useTemplates(enabled && !isReport);
  const reportList = useReportTemplates(enabled && isReport);
  const updateDashboardTemplate = useUpdateTemplate();
  const deleteDashboardTemplate = useDeleteTemplate();
  const updateReportTemplate = useUpdateReportTemplate();
  const deleteReportTemplate = useDeleteReportTemplate();

  const { data: templates, isLoading, isError } = isReport ? reportList : dashboardList;
  const updateTemplate = isReport ? updateReportTemplate : updateDashboardTemplate;
  const deleteTemplate = isReport ? deleteReportTemplate : deleteDashboardTemplate;

  // Both are the id of the row whose inline affordance is open.
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = updateTemplate.isPending || deleteTemplate.isPending;

  function startRename(template: PickerTemplate) {
    setError(null);
    setConfirmDelete(null);
    setRenameValue(template.name);
    setRenaming(template.id);
  }

  async function submitRename(id: string) {
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    setError(null);
    try {
      await updateTemplate.mutateAsync({ id, name: trimmed });
      setRenaming(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename the template");
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await deleteTemplate.mutateAsync(id);
      setConfirmDelete(null);
      if (value === id) onChange(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the template");
    }
  }

  if (isLoading) {
    return <p className="text-[12px] text-ink-muted">Loading templates…</p>;
  }

  if (isError) {
    return (
      <p role="alert" className="text-[12px] text-destructive">
        Could not load templates.
      </p>
    );
  }

  if (!templates || templates.length === 0) {
    return (
      <p className="text-[12px] text-ink-muted">
        {isReport
          ? "No report templates yet. Save a layout as a template from its menu."
          : "No templates yet. Save a view as a template from the view menu."}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <ul className="max-h-56 overflow-y-auto rounded-lg border border-hairline divide-y divide-hairline">
        {templates.map((template) => {
          const selected = template.id === value;
          return (
            <li key={template.id} className={cn("px-2.5 py-2", selected && "bg-primary/6")}>
              {renaming === template.id ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={renameValue}
                    autoFocus
                    maxLength={120}
                    aria-label={`Rename ${template.name}`}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        // Same guard as the Save button — Enter must not fire a
                        // second rename while one is in flight.
                        if (!busy && renameValue.trim()) void submitRename(template.id);
                      }
                      if (e.key === "Escape") setRenaming(null);
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={!renameValue.trim() || busy}
                    onClick={() => void submitRename(template.id)}
                  >
                    Save
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <label className="flex flex-1 min-w-0 items-start gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name={isReport ? "report-template" : "dashboard-template"}
                      className="mt-1 accent-primary"
                      checked={selected}
                      onChange={() => onChange(template.id)}
                    />
                    <span className="flex-1 min-w-0">
                      <span className="flex items-baseline gap-2">
                        <span className="text-[13px] text-ink truncate">{template.name}</span>
                        {template.isMaster && (
                          <span className="text-[10px] font-medium uppercase tracking-wide text-primary bg-primary/10 px-1.5 py-0.5 rounded shrink-0">
                            Master
                          </span>
                        )}
                        <span className="text-[11px] text-ink-faint shrink-0 tabular-nums">
                          {template.widgetCount} widget{template.widgetCount === 1 ? "" : "s"}
                        </span>
                      </span>
                      {template.description && (
                        <span className="block text-[11px] text-ink-muted truncate">
                          {template.description}
                        </span>
                      )}
                    </span>
                  </label>

                  {confirmDelete === template.id ? (
                    <span className="flex items-center gap-1.5 shrink-0">
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={busy}
                        onClick={() => void handleDelete(template.id)}
                      >
                        {deleteTemplate.isPending ? "Deleting…" : "Delete"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmDelete(null)}
                      >
                        Cancel
                      </Button>
                    </span>
                  ) : (
                    <span className="flex items-center gap-0.5 shrink-0">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Rename ${template.name}`}
                        disabled={busy}
                        onClick={() => startRename(template)}
                      >
                        <BiPencil className="w-3.5 h-3.5" />
                      </Button>
                      {/* The master is the house template every new view and
                          layout starts from — the API refuses to delete it. */}
                      {!template.isMaster && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={`Delete ${template.name}`}
                          disabled={busy}
                          onClick={() => {
                            setRenaming(null);
                            setConfirmDelete(template.id);
                          }}
                        >
                          <BiTrash className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {error && (
        <p role="alert" className="text-[12px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
