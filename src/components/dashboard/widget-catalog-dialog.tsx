"use client";

import { useState } from "react";
import { BiLibrary, BiPencil, BiSearch, BiTrash } from "react-icons/bi";
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
import { cn } from "@/lib/utils";
import {
  catalogForSurface,
  getWidget,
  type CatalogEntry,
  type CatalogGroup,
} from "@/lib/dashboard/widget-registry";
import {
  useDeleteSavedWidget,
  useSavedWidgets,
  useUpdateSavedWidget,
} from "@/hooks/use-saved-widgets";
import type { GridSurface, SavedWidget } from "@/lib/dashboard/types";
import { surfaceAllows } from "@/lib/dashboard/types";
import type { NewWidgetSpec } from "@/store/dashboard-store";

/** A rail item: the two cross-cutting views, then one per catalog group. */
type RailKey = "all" | "saved" | CatalogGroup;

const GROUP_ORDER: CatalogGroup[] = ["charts", "metrics", "attribution", "layout"];

const RAIL_LABELS: Record<RailKey, string> = {
  all: "All",
  saved: "Saved",
  charts: "Charts",
  metrics: "Metrics",
  attribution: "Attribution",
  layout: "Layout",
};

const RAIL_ORDER: RailKey[] = ["all", "saved", ...GROUP_ORDER];

/** Case-insensitive substring match over any of the given fields. An empty query matches everything. */
function matches(query: string, ...fields: (string | undefined)[]): boolean {
  if (!query) return true;
  return fields.some((f) => f?.toLowerCase().includes(query));
}

interface WidgetCatalogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (spec: NewWidgetSpec) => void;
  /** Adds a library entry as a LINKED instance (the entry keeps owning its config). */
  onAddSaved: (entry: SavedWidget) => void;
  /**
   * Which grid the widget is being added to. Report-only blocks (cover, AI
   * summary) are listed on `"report"` and hidden on `"dashboard"`, matching the
   * rule the PUT validators enforce.
   */
  surface?: GridSurface;
}

export function WidgetCatalogDialog({
  open,
  onOpenChange,
  onAdd,
  onAddSaved,
  surface = "dashboard",
}: WidgetCatalogDialogProps) {
  // Only fetched while the catalog is open.
  const { data: savedWidgets, isError: libraryError } = useSavedWidgets(open);
  const [editing, setEditing] = useState<SavedWidget | null>(null);
  const [deleting, setDeleting] = useState<SavedWidget | null>(null);
  const [query, setQuery] = useState("");
  const [rail, setRail] = useState<RailKey>("all");

  // Start every visit with the full catalog — done during render (React's
  // "adjusting state on prop change" pattern) rather than in an effect.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuery("");
      setRail("all");
    }
  }

  const q = query.trim().toLowerCase();
  const searching = q !== "";
  const matchedSaved = (savedWidgets ?? []).filter(
    (entry) =>
      surfaceAllows(entry.widget_type, surface) &&
      matches(q, entry.name, getWidget(entry.widget_type)?.title)
  );
  // Keywords are matched but never shown — synonyms and the vocabulary the UI
  // has since dropped ("custom") still have to find their tile.
  const matchedEntries = catalogForSurface(surface).filter((e) =>
    matches(q, e.title, e.description, ...(e.keywords ?? []))
  );

  // Counts follow the search, so the rail doubles as "where are my matches".
  const counts = {
    all: matchedSaved.length + matchedEntries.length,
    saved: matchedSaved.length,
    charts: 0,
    metrics: 0,
    attribution: 0,
    layout: 0,
  } satisfies Record<RailKey, number>;
  for (const entry of matchedEntries) counts[entry.group] += 1;

  // A search looks across every group at once — narrowing it to the selected
  // rail item would hide matches whose count the user can see right there.
  const showSaved = searching ? matchedSaved.length > 0 : rail === "all" || rail === "saved";
  const visibleGroups = GROUP_ORDER.filter((g) =>
    searching ? counts[g] > 0 : rail === "all" || rail === g
  );
  // One group on its own is already named by the rail; a heading would repeat it.
  const showHeadings = searching || rail === "all";
  const emptyLibrary = !searching && rail === "saved" && matchedSaved.length === 0 && !libraryError;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        {/* DialogContent bakes in `sm:max-w-sm`, so the wide variant must
            override at the same breakpoint or it is ignored on desktop. The
            height is FIXED, not `max-h`: searching filters the list, and an
            auto-height dialog would grow and shrink under the cursor on every
            keystroke. The list scrolls inside instead. */}
        <DialogContent className="sm:max-w-4xl p-0 gap-0 h-[min(85vh,46rem)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
          <DialogHeader className="px-5 py-4 border-b border-hairline">
            <DialogTitle>Add a widget</DialogTitle>
            <DialogDescription className="text-[13px]">
              Pick a widget to add to the bottom of your dashboard.
            </DialogDescription>
            <div className="relative mt-3">
              <BiSearch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-faint" />
              <Input
                value={query}
                autoFocus
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search widgets"
                aria-label="Search widgets"
                className="pl-8"
              />
            </div>
          </DialogHeader>

          <div className="min-h-0 grid grid-cols-[7.5rem_minmax(0,1fr)] sm:grid-cols-[11rem_minmax(0,1fr)]">
            <nav
              aria-label="Widget categories"
              className="min-h-0 overflow-y-auto border-r border-hairline bg-canvas-soft/30 p-2 space-y-0.5"
            >
              {RAIL_ORDER.map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={rail === key}
                  onClick={() => setRail(key)}
                  className={cn(
                    "w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-[13px] text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    rail === key
                      ? "bg-primary/8 text-primary font-medium"
                      : "text-ink-secondary hover:bg-canvas-soft hover:text-ink"
                  )}
                >
                  <span className="truncate">{RAIL_LABELS[key]}</span>
                  <span className="text-[11px] tabular-nums text-ink-faint shrink-0">
                    {counts[key]}
                  </span>
                </button>
              ))}
            </nav>

            <div className="min-h-0 overflow-y-auto px-5 py-4 space-y-5">
              {/* An empty library and an unreachable one look identical otherwise. */}
              {libraryError && (
                <p role="alert" className="text-[12px] text-destructive">
                  Could not load the saved widget library.
                </p>
              )}

              {searching && counts.all === 0 && (
                <p className="text-[13px] text-ink-muted py-6 text-center">
                  No widgets match “{query.trim()}”.
                </p>
              )}

              {emptyLibrary && (
                <p className="text-[13px] text-ink-muted py-6 text-center">
                  Nothing saved yet. Use the bookmark button on any widget to add it to the library.
                </p>
              )}

              {showSaved && matchedSaved.length > 0 && (
                <div>
                  {showHeadings && <GroupHeading>Saved widgets</GroupHeading>}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                    {matchedSaved.map((entry) => (
                      <SavedWidgetCard
                        key={entry.id}
                        entry={entry}
                        onAdd={() => {
                          onAddSaved(entry);
                          onOpenChange(false);
                        }}
                        onRename={() => setEditing(entry)}
                        onDelete={() => setDeleting(entry)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {visibleGroups.map((group) => (
                <div key={group}>
                  {showHeadings && <GroupHeading>{RAIL_LABELS[group]}</GroupHeading>}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                    {matchedEntries
                      .filter((e) => e.group === group)
                      .map((entry) => (
                        <CatalogTile
                          key={entry.id}
                          entry={entry}
                          onAdd={() => {
                            onAdd({
                              type: entry.type,
                              defaultSize: entry.defaultSize,
                              defaultConfig: entry.defaultConfig,
                            });
                            onOpenChange(false);
                          }}
                        />
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <RenameSavedWidgetDialog entry={editing} onClose={() => setEditing(null)} />
      <DeleteSavedWidgetDialog entry={deleting} onClose={() => setDeleting(null)} />
    </>
  );
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint mb-2">
      {children}
    </p>
  );
}

/** One catalog tile. Adding closes the dialog (the caller does the closing). */
function CatalogTile({ entry, onAdd }: { entry: CatalogEntry; onAdd: () => void }) {
  const Icon = entry.icon;
  return (
    <button
      type="button"
      onClick={onAdd}
      className="flex items-start gap-3 p-3 rounded-lg border border-hairline text-left transition-colors outline-none hover:border-primary/40 hover:bg-canvas-soft/60 focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="w-8 h-8 rounded-md bg-primary/8 text-primary grid place-items-center shrink-0">
        <Icon className="w-4 h-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{entry.title}</span>
        <span className="block text-xs text-ink-muted leading-snug mt-0.5">{entry.description}</span>
      </span>
    </button>
  );
}

/**
 * A library entry. The card body adds it (linked); the trailing buttons manage
 * the entry itself, so they must not bubble into the add action.
 */
function SavedWidgetCard({
  entry,
  onAdd,
  onRename,
  onDelete,
}: {
  entry: SavedWidget;
  onAdd: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const def = getWidget(entry.widget_type);
  const Icon = def?.icon ?? BiLibrary;

  return (
    <div className="group/saved relative flex items-start gap-3 p-3 rounded-lg border border-hairline transition-colors hover:border-primary/40 hover:bg-canvas-soft/60 focus-within:border-primary/40">
      <button
        type="button"
        onClick={onAdd}
        className="flex items-start gap-3 text-left min-w-0 flex-1 outline-none rounded focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="w-8 h-8 rounded-md bg-primary/8 text-primary grid place-items-center shrink-0">
          <Icon className="w-4 h-4" />
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="block text-sm font-medium text-ink truncate">{entry.name}</span>
            <BiLibrary className="w-3 h-3 text-primary shrink-0" title="Saved widget" />
          </span>
          <span className="block text-xs text-ink-muted leading-snug mt-0.5">
            {def?.description ?? entry.widget_type}
          </span>
        </span>
      </button>
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          type="button"
          aria-label={`Rename ${entry.name}`}
          onClick={onRename}
          className="p-1 rounded text-ink-muted hover:bg-canvas-soft hover:text-ink transition-colors"
        >
          <BiPencil className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          aria-label={`Delete ${entry.name}`}
          onClick={onDelete}
          className="p-1 rounded text-ink-muted hover:bg-red-50 hover:text-red-600 transition-colors"
        >
          <BiTrash className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function RenameSavedWidgetDialog({ entry, onClose }: { entry: SavedWidget | null; onClose: () => void }) {
  const updateWidget = useUpdateSavedWidget();
  const [name, setName] = useState(entry?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  // Re-prefill whenever the dialog opens (it closes by `entry` going null), so a
  // cancelled rename is never shown again.
  const [lastId, setLastId] = useState<string | null>(null);
  if ((entry?.id ?? null) !== lastId) {
    setLastId(entry?.id ?? null);
    if (entry) {
      setName(entry.name);
      setError(null);
    }
  }

  async function submit() {
    if (!entry) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    try {
      await updateWidget.mutateAsync({ id: entry.id, name: trimmed });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rename the widget");
    }
  }

  return (
    <Dialog open={!!entry} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename saved widget</DialogTitle>
          <DialogDescription className="text-[13px]">
            The new name shows everywhere this widget is offered. Its configuration is unchanged.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor="saved-widget-rename" className="text-[12px] font-medium text-ink">
              Name
            </label>
            <Input
              id="saved-widget-rename"
              value={name}
              autoFocus
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-[12px] text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || updateWidget.isPending}>
              {updateWidget.isPending ? "Renaming…" : "Rename"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteSavedWidgetDialog({ entry, onClose }: { entry: SavedWidget | null; onClose: () => void }) {
  const deleteWidget = useDeleteSavedWidget();
  const [error, setError] = useState<string | null>(null);
  // Clear a previous failure when the dialog opens on another entry (or reopens).
  const [lastId, setLastId] = useState<string | null>(null);
  if ((entry?.id ?? null) !== lastId) {
    setLastId(entry?.id ?? null);
    if (entry) setError(null);
  }

  async function submit() {
    if (!entry) return;
    setError(null);
    try {
      await deleteWidget.mutateAsync(entry.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the widget");
    }
  }

  return (
    <Dialog open={!!entry} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{entry?.name}”?</DialogTitle>
          <DialogDescription className="text-[13px]">
            Views that use this widget keep it — it is detached and becomes a normal widget with its
            current settings. It just stops being offered in the library, and those copies no longer
            stay in sync.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-[12px] text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void submit()} disabled={deleteWidget.isPending}>
            {deleteWidget.isPending ? "Deleting…" : "Delete widget"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
