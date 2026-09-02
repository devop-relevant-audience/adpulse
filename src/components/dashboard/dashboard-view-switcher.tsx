"use client";

import { useState } from "react";
import {
  BiCheck,
  BiChevronDown,
  BiCopy,
  BiGridAlt,
  BiHide,
  BiPencil,
  BiPlus,
  BiShow,
  BiSolidStar,
  BiStar,
  BiTrash,
  BiWindows,
} from "react-icons/bi";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ChipRow, ChipToggle } from "@/components/dashboard/config-ui";
import { TemplatePicker } from "@/components/dashboard/template-picker";
import {
  useCreateDashboard,
  useDeleteDashboard,
  useUpdateDashboard,
} from "@/hooks/use-dashboard";
import { useCreateTemplate } from "@/hooks/use-templates";
import { useDashboardStore } from "@/store/dashboard-store";
import type { DashboardConfig, DashboardSummary } from "@/lib/dashboard/types";
import { cn } from "@/lib/utils";

/** Where a new view's widgets/layout come from. */
type NewViewSource = "blank" | "duplicate" | "template";

interface DashboardViewSwitcherProps {
  clientId: string | null;
  views: DashboardSummary[];
  /** The view currently rendered — the built-in preset has no id. */
  current: DashboardConfig;
  /** Agency staff manage views; client users only switch between published ones. */
  canManage: boolean;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function DashboardViewSwitcher({
  clientId,
  views,
  current,
  canManage,
}: DashboardViewSwitcherProps) {
  const selectView = useDashboardStore((s) => s.selectView);
  const isDirty = useDashboardStore((s) => s.isDirty);

  const createView = useCreateDashboard(clientId);
  const updateView = useUpdateDashboard(clientId);
  const deleteView = useDeleteDashboard(clientId);
  const createTemplate = useCreateTemplate();

  const [menuOpen, setMenuOpen] = useState(false);
  // `mode` doubles as the name-dialog's open state.
  const [nameDialog, setNameDialog] = useState<"new" | "duplicate" | "rename" | null>(null);
  const [name, setName] = useState("");
  const [source, setSource] = useState<NewViewSource>("blank");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Set to the action waiting on a "discard unsaved changes?" answer.
  const [pendingDiscard, setPendingDiscard] = useState<(() => void) | null>(null);
  // "Save as template": separate dialog, since it snapshots rather than creates.
  const [templateDialog, setTemplateDialog] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");

  // The preset has no row yet, so per-view actions need a saved view.
  const currentId = current.id ?? null;
  const isSaved = !!currentId;
  const published = current.visibility === "client";
  const busy = createView.isPending || updateView.isPending || deleteView.isPending;
  // "From template" needs a pick before Create does anything.
  const sourceReady = source !== "template" || !!templateId;

  // Switching view and duplicating both drop the in-progress draft (the store
  // clears it on select, and a duplicate is taken from the SAVED row), so ask
  // first when there is something to lose.
  function withDirtyGuard(run: () => void) {
    if (isDirty) setPendingDiscard(() => run);
    else run();
  }

  function openNameDialog(mode: "new" | "duplicate" | "rename") {
    setActionError(null);
    setName(mode === "rename" ? current.name : mode === "duplicate" ? `${current.name} copy` : "");
    setSource(mode === "duplicate" ? "duplicate" : "blank");
    setTemplateId(null);
    setNameDialog(mode);
  }

  function openTemplateDialog() {
    setActionError(null);
    setTemplateName(current.name);
    setTemplateDescription("");
    setTemplateDialog(true);
  }

  async function submitName() {
    const trimmed = name.trim();
    if (!trimmed || !sourceReady) return;
    setActionError(null);
    try {
      if (nameDialog === "rename") {
        if (!currentId) return;
        await updateView.mutateAsync({ id: currentId, name: trimmed });
      } else {
        const created = await createView.mutateAsync({
          name: trimmed,
          duplicateFromId: source === "duplicate" && currentId ? currentId : undefined,
          fromTemplateId: source === "template" ? (templateId ?? undefined) : undefined,
        });
        if (created.id) selectView(clientId, created.id);
      }
      setNameDialog(null);
    } catch (error) {
      setActionError(errorMessage(error, "Could not save the view"));
    }
  }

  // Snapshots the view AS SAVED — the server reads the stored row, so unsaved
  // draft edits are deliberately not included (the dialog says so).
  async function submitTemplate() {
    const trimmed = templateName.trim();
    if (!trimmed || !currentId) return;
    setActionError(null);
    try {
      await createTemplate.mutateAsync({
        name: trimmed,
        description: templateDescription.trim() || undefined,
        fromDashboardId: currentId,
      });
      setTemplateDialog(false);
    } catch (error) {
      setActionError(errorMessage(error, "Could not save the template"));
    }
  }

  async function runAction(action: () => Promise<unknown>) {
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(errorMessage(error, "Action failed"));
    }
  }

  // The confirm stays open (with the reason) when the delete fails, so the
  // selection is never cleared for a view that still exists.
  async function handleDelete() {
    if (!currentId) return;
    setActionError(null);
    try {
      await deleteView.mutateAsync(currentId);
      // Fall back to the client's default view (resolved server-side).
      selectView(clientId, null);
      setConfirmDelete(false);
    } catch (error) {
      setActionError(errorMessage(error, "Could not delete the view"));
    }
  }

  return (
    <div className="flex items-center gap-2 min-w-0">
      <BiGridAlt className="w-4 h-4 text-ink-muted shrink-0" />

      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-1.5 -ml-1.5 gap-1 max-w-[16rem]"
              aria-label="Switch dashboard view"
            />
          }
        >
          <span className="text-lg font-semibold text-ink truncate">{current.name}</span>
          <BiChevronDown className="w-4 h-4 text-ink-muted shrink-0" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" sideOffset={6} className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Views</DropdownMenuLabel>
            {views.length === 0 ? (
              <div className="px-1.5 py-1.5 text-[12px] text-ink-muted">
                {canManage ? "No saved views yet" : "No views shared with you yet"}
              </div>
            ) : (
              views.map((view) => (
                <DropdownMenuItem
                  key={view.id}
                  onClick={() => withDirtyGuard(() => selectView(clientId, view.id))}
                  className={cn(view.id === currentId && "bg-accent/60")}
                >
                  <BiCheck
                    className={cn("w-4 h-4 mr-2 shrink-0", view.id !== currentId && "opacity-0")}
                  />
                  <span className="flex-1 min-w-0 truncate">{view.name}</span>
                  {view.isDefault && (
                    <BiSolidStar
                      className="w-3.5 h-3.5 ml-1.5 shrink-0 text-amber-500"
                      title="Default view"
                    />
                  )}
                  {canManage && view.visibility === "client" && (
                    <BiShow
                      className="w-3.5 h-3.5 ml-1.5 shrink-0 text-ink-muted"
                      title="Published to the client"
                    />
                  )}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuGroup>

          {canManage && (
            <DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Manage</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => openNameDialog("new")} disabled={busy}>
                <BiPlus className="w-4 h-4 mr-2" /> New view
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => withDirtyGuard(() => openNameDialog("duplicate"))}
                disabled={busy}
              >
                <BiCopy className="w-4 h-4 mr-2" /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => openNameDialog("rename")}
                disabled={!isSaved || busy}
              >
                <BiPencil className="w-4 h-4 mr-2" /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  currentId && runAction(() => updateView.mutateAsync({ id: currentId, isDefault: true }))
                }
                disabled={!isSaved || current.isDefault || busy}
              >
                <BiStar className="w-4 h-4 mr-2" /> Set as default
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  currentId &&
                  runAction(() =>
                    updateView.mutateAsync({
                      id: currentId,
                      visibility: published ? "internal" : "client",
                    })
                  )
                }
                disabled={!isSaved || busy}
              >
                {published ? (
                  <>
                    <BiHide className="w-4 h-4 mr-2" /> Make internal
                  </>
                ) : (
                  <>
                    <BiShow className="w-4 h-4 mr-2" /> Publish to client
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={openTemplateDialog}
                disabled={!isSaved || createTemplate.isPending}
              >
                <BiWindows className="w-4 h-4 mr-2" /> Save as template…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setConfirmDelete(true)}
                disabled={!isSaved || busy}
              >
                <BiTrash className="w-4 h-4 mr-2" /> Delete view
              </DropdownMenuItem>
            </DropdownMenuGroup>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {current.isDefault && isSaved && (
        <span className="text-[11px] font-medium text-ink-muted bg-canvas-soft px-2 py-0.5 rounded-full shrink-0">
          Default
        </span>
      )}
      {canManage && published && (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary bg-primary/8 px-2 py-0.5 rounded-full shrink-0">
          <BiShow className="w-3 h-3" /> Client
        </span>
      )}
      {actionError && (
        <span role="alert" className="text-[12px] text-destructive truncate">
          {actionError}
        </span>
      )}

      <Dialog open={nameDialog !== null} onOpenChange={(open) => !open && setNameDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {nameDialog === "rename"
                ? "Rename view"
                : nameDialog === "duplicate"
                  ? "Duplicate view"
                  : "New view"}
            </DialogTitle>
            <DialogDescription className="text-[13px]">
              {nameDialog === "rename"
                ? "Views are named per client."
                : "New views are internal until you publish them to the client."}
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
              <label htmlFor="dashboard-view-name" className="text-[12px] font-medium text-ink">
                Name
              </label>
              <Input
                id="dashboard-view-name"
                value={name}
                autoFocus
                maxLength={120}
                placeholder="Weekly performance"
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {nameDialog !== "rename" && (
              <div className="space-y-2">
                <span className="block text-[12px] font-medium text-ink">Start from</span>
                <ChipRow>
                  <ChipToggle active={source === "blank"} onClick={() => setSource("blank")}>
                    Blank
                  </ChipToggle>
                  <ChipToggle
                    active={source === "duplicate"}
                    disabled={!isSaved}
                    title={isSaved ? undefined : "Save this view first"}
                    onClick={() => setSource("duplicate")}
                  >
                    Copy of “{current.name}”
                  </ChipToggle>
                  <ChipToggle
                    active={source === "template"}
                    onClick={() => setSource("template")}
                  >
                    Template
                  </ChipToggle>
                </ChipRow>

                {source === "template" && (
                  <TemplatePicker
                    value={templateId}
                    onChange={setTemplateId}
                    enabled={nameDialog !== null}
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
                {nameDialog === "rename" ? "Rename" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={templateDialog} onOpenChange={setTemplateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save as template</DialogTitle>
            <DialogDescription className="text-[13px]">
              Templates are shared across every client, so you can create the same view for anyone.
              This saves the last saved version of “{current.name}” — save the view first if you
              have unsaved changes.
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
              <label htmlFor="dashboard-template-name" className="text-[12px] font-medium text-ink">
                Name
              </label>
              <Input
                id="dashboard-template-name"
                value={templateName}
                autoFocus
                maxLength={120}
                placeholder="Monthly client review"
                onChange={(e) => setTemplateName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="dashboard-template-description"
                className="text-[12px] font-medium text-ink"
              >
                Description <span className="text-ink-faint font-normal">(optional)</span>
              </label>
              <Textarea
                id="dashboard-template-description"
                value={templateDescription}
                rows={2}
                maxLength={500}
                placeholder="What this view is for"
                onChange={(e) => setTemplateDescription(e.target.value)}
              />
            </div>

            {actionError && (
              <p role="alert" className="text-[12px] text-destructive">
                {actionError}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setTemplateDialog(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!templateName.trim() || createTemplate.isPending}>
                {createTemplate.isPending ? "Saving…" : "Save template"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{current.name}”?</DialogTitle>
            <DialogDescription className="text-[13px]">
              This removes the view and its widget layout for every user of this client. It cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          {actionError && (
            <p role="alert" className="text-[12px] text-destructive">
              {actionError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void handleDelete()} disabled={busy}>
              {deleteView.isPending ? "Deleting…" : "Delete view"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pendingDiscard} onOpenChange={(open) => !open && setPendingDiscard(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription className="text-[13px]">
              “{current.name}” has edits that have not been saved. Continuing drops them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDiscard(null)}>
              Keep editing
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const run = pendingDiscard;
                setPendingDiscard(null);
                run?.();
              }}
            >
              Discard changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
