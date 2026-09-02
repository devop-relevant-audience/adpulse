"use client";

// The agency-internal list of a client's report layouts: create, rename,
// duplicate, delete, snapshot as a template, edit the blocks, and generate a
// report from one. Client users never see this panel (the whole
// /api/report-layouts route is agency-only).

import { useState } from "react";
import { format, parseISO } from "date-fns";
import {
  BiCopy,
  BiDotsHorizontalRounded,
  BiFile,
  BiPencil,
  BiPlus,
  BiTrash,
  BiWindows,
} from "react-icons/bi";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/ui/query-error";
import { ChipRow, ChipToggle } from "@/components/dashboard/config-ui";
import { TemplatePicker } from "@/components/dashboard/template-picker";
import {
  useCreateReportLayout,
  useDeleteReportLayout,
  useRenameReportLayout,
  useReportLayouts,
} from "@/hooks/use-report-layouts";
import { useCreateReportTemplate } from "@/hooks/use-report-templates";
import { ReportPreviewDialog } from "@/components/reports/report-preview-dialog";
import type { ReportLayoutSummary } from "@/lib/dashboard/types";

/** Where a new layout's blocks come from. */
type NewLayoutSource = "blank" | "duplicate" | "template";

type NameDialogState =
  | { mode: "new" }
  | { mode: "duplicate"; layout: ReportLayoutSummary }
  | { mode: "rename"; layout: ReportLayoutSummary };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function ReportLayoutsPanel({
  clientId,
  onEdit,
  onGenerate,
}: {
  clientId: string;
  onEdit: (layout: ReportLayoutSummary) => void;
  onGenerate: (layout: ReportLayoutSummary) => void;
}) {
  const { data: layouts, isLoading, isError, refetch } = useReportLayouts(clientId);
  const createLayout = useCreateReportLayout(clientId);
  const renameLayout = useRenameReportLayout(clientId);
  const deleteLayout = useDeleteReportLayout(clientId);
  const createTemplate = useCreateReportTemplate();

  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
  const [name, setName] = useState("");
  const [source, setSource] = useState<NewLayoutSource>("blank");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ReportLayoutSummary | null>(null);
  const [templateFor, setTemplateFor] = useState<ReportLayoutSummary | null>(null);
  const [previewFor, setPreviewFor] = useState<ReportLayoutSummary | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const busy = createLayout.isPending || renameLayout.isPending || deleteLayout.isPending;
  // "From template" needs a pick before Create does anything.
  const sourceReady = source !== "template" || !!templateId;

  function openNameDialog(state: NameDialogState) {
    setActionError(null);
    setName(
      state.mode === "rename"
        ? state.layout.name
        : state.mode === "duplicate"
          ? `${state.layout.name} copy`
          : ""
    );
    setSource(state.mode === "duplicate" ? "duplicate" : "blank");
    setTemplateId(null);
    setNameDialog(state);
  }

  function openTemplateDialog(layout: ReportLayoutSummary) {
    setActionError(null);
    setTemplateName(layout.name);
    setTemplateDescription("");
    setTemplateFor(layout);
  }

  async function submitName() {
    const trimmed = name.trim();
    if (!nameDialog || !trimmed || !sourceReady) return;
    setActionError(null);
    try {
      if (nameDialog.mode === "rename") {
        await renameLayout.mutateAsync({ id: nameDialog.layout.id, name: trimmed });
      } else {
        const created = await createLayout.mutateAsync({
          name: trimmed,
          duplicateFromId:
            source === "duplicate" && nameDialog.mode === "duplicate"
              ? nameDialog.layout.id
              : undefined,
          fromTemplateId: source === "template" ? (templateId ?? undefined) : undefined,
        });
        setNameDialog(null);
        // A new layout is empty (or a fresh copy) — the next step is always
        // editing it, so go straight to the canvas instead of leaving the user
        // on the list.
        if (created.id) {
          onEdit({ id: created.id, name: created.name, updatedAt: new Date().toISOString() });
        }
        return;
      }
      setNameDialog(null);
    } catch (error) {
      setActionError(errorMessage(error, "Could not save the report layout"));
    }
  }

  // Snapshots the layout AS SAVED — the server reads the stored row, so unsaved
  // edits open in the editor are deliberately not included.
  async function submitTemplate() {
    const trimmed = templateName.trim();
    if (!templateFor || !trimmed) return;
    setActionError(null);
    try {
      await createTemplate.mutateAsync({
        name: trimmed,
        description: templateDescription.trim() || undefined,
        fromReportLayoutId: templateFor.id,
      });
      setTemplateFor(null);
    } catch (error) {
      setActionError(errorMessage(error, "Could not save the report template"));
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setActionError(null);
    try {
      await deleteLayout.mutateAsync(confirmDelete.id);
      setConfirmDelete(null);
    } catch (error) {
      setActionError(errorMessage(error, "Could not delete the report layout"));
    }
  }

  const duplicateSource = nameDialog?.mode === "duplicate" ? nameDialog.layout : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-medium text-ink">Report layouts</h2>
          <p className="text-[12px] text-ink-muted">
            Block-based report structures for this client. Internal — clients only see the
            reports you generate.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 shrink-0"
          onClick={() => openNameDialog({ mode: "new" })}
          disabled={busy}
        >
          <BiPlus className="w-3.5 h-3.5" /> New layout
        </Button>
      </div>

      {isLoading && <Skeleton className="h-16 w-full" />}

      {!isLoading && isError && (
        <QueryError onRetry={() => refetch()} message="Couldn't load report layouts" />
      )}

      {!isLoading && !isError && (layouts?.length ?? 0) === 0 && (
        <Panel className="p-6 text-center">
          <BiFile className="w-8 h-8 text-ink-muted/40 mx-auto mb-2" />
          <p className="text-[13px] text-ink-muted">No report layouts yet.</p>
          <p className="text-[12px] text-ink-muted mt-1">
            Create one to design a report block by block, then generate it for any period.
          </p>
        </Panel>
      )}

      {layouts?.map((layout) => (
        <Panel key={layout.id} className="p-4 flex items-center gap-4">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <BiWindows className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-[14px] font-medium text-ink truncate">{layout.name}</h4>
            <p className="text-[12px] text-ink-muted">
              Updated {format(parseISO(layout.updatedAt), "MMM d, yyyy")}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button variant="outline" size="sm" onClick={() => setPreviewFor(layout)}>
              Preview
            </Button>
            <Button variant="outline" size="sm" onClick={() => onEdit(layout)}>
              Edit
            </Button>
            <Button size="sm" onClick={() => onGenerate(layout)}>
              Generate
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-8 h-8"
                    aria-label={`More actions for ${layout.name}`}
                  />
                }
              >
                <BiDotsHorizontalRounded className="w-4 h-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={6} className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    onClick={() => openNameDialog({ mode: "rename", layout })}
                    disabled={busy}
                  >
                    <BiPencil className="w-4 h-4 mr-2" /> Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => openNameDialog({ mode: "duplicate", layout })}
                    disabled={busy}
                  >
                    <BiCopy className="w-4 h-4 mr-2" /> Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => openTemplateDialog(layout)}
                    disabled={createTemplate.isPending}
                  >
                    <BiWindows className="w-4 h-4 mr-2" /> Save as template…
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setConfirmDelete(layout)}
                    disabled={busy}
                  >
                    <BiTrash className="w-4 h-4 mr-2" /> Delete layout
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </Panel>
      ))}

      {actionError && !nameDialog && !confirmDelete && !templateFor && (
        <p role="alert" className="text-[12px] text-destructive">
          {actionError}
        </p>
      )}

      {previewFor && (
        <ReportPreviewDialog
          clientId={clientId}
          layoutId={previewFor.id}
          layoutName={previewFor.name}
          onClose={() => setPreviewFor(null)}
        />
      )}

      <Dialog open={!!nameDialog} onOpenChange={(open) => !open && setNameDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {nameDialog?.mode === "rename"
                ? "Rename report layout"
                : nameDialog?.mode === "duplicate"
                  ? "Duplicate report layout"
                  : "New report layout"}
            </DialogTitle>
            <DialogDescription className="text-[13px]">
              Layouts are named per client and stay internal to the agency.
            </DialogDescription>
          </DialogHeader>

          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submitName();
            }}
          >
            <div className="space-y-1.5">
              <label htmlFor="report-layout-name" className="text-[12px] font-medium text-ink">
                Name
              </label>
              <Input
                id="report-layout-name"
                value={name}
                autoFocus
                maxLength={120}
                placeholder="Monthly performance report"
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {nameDialog?.mode !== "rename" && (
              <div className="space-y-2">
                <span className="block text-[12px] font-medium text-ink">Start from</span>
                <ChipRow>
                  <ChipToggle active={source === "blank"} onClick={() => setSource("blank")}>
                    Blank
                  </ChipToggle>
                  {duplicateSource && (
                    <ChipToggle
                      active={source === "duplicate"}
                      onClick={() => setSource("duplicate")}
                    >
                      Copy of “{duplicateSource.name}”
                    </ChipToggle>
                  )}
                  <ChipToggle active={source === "template"} onClick={() => setSource("template")}>
                    Template
                  </ChipToggle>
                </ChipRow>

                {source === "template" && (
                  <TemplatePicker
                    kind="report"
                    value={templateId}
                    onChange={setTemplateId}
                    enabled={!!nameDialog}
                  />
                )}
              </div>
            )}

            {actionError && (
              <p role="alert" className="text-[12px] text-destructive">
                {actionError}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNameDialog(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim() || !sourceReady || busy}>
                {nameDialog?.mode === "rename" ? "Rename" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!templateFor} onOpenChange={(open) => !open && setTemplateFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save as report template</DialogTitle>
            <DialogDescription className="text-[13px]">
              Report templates are shared across every client, so you can build the same report
              for anyone. This saves the last saved version of “{templateFor?.name}”.
            </DialogDescription>
          </DialogHeader>

          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submitTemplate();
            }}
          >
            <div className="space-y-1.5">
              <label htmlFor="report-template-name" className="text-[12px] font-medium text-ink">
                Name
              </label>
              <Input
                id="report-template-name"
                value={templateName}
                autoFocus
                maxLength={120}
                placeholder="Monthly client report"
                onChange={(e) => setTemplateName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="report-template-description"
                className="text-[12px] font-medium text-ink"
              >
                Description <span className="text-ink-faint font-normal">(optional)</span>
              </label>
              <Textarea
                id="report-template-description"
                value={templateDescription}
                rows={2}
                maxLength={500}
                placeholder="What this report covers"
                onChange={(e) => setTemplateDescription(e.target.value)}
              />
            </div>

            {actionError && (
              <p role="alert" className="text-[12px] text-destructive">
                {actionError}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setTemplateFor(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!templateName.trim() || createTemplate.isPending}>
                {createTemplate.isPending ? "Saving…" : "Save template"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{confirmDelete?.name}”?</DialogTitle>
            <DialogDescription className="text-[13px]">
              This removes the layout and its blocks. Reports already generated from it keep
              working — they hold their own frozen copy.
            </DialogDescription>
          </DialogHeader>
          {actionError && (
            <p role="alert" className="text-[12px] text-destructive">
              {actionError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void handleDelete()} disabled={busy}>
              {deleteLayout.isPending ? "Deleting…" : "Delete layout"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
