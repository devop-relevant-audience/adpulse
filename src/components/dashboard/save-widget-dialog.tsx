"use client";

import { useState } from "react";
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
import { useCreateSavedWidget } from "@/hooks/use-saved-widgets";
import { getWidget } from "@/lib/dashboard/widget-registry";
import { readWidgetFilters, writeWidgetFilters } from "@/lib/dashboard/filters";
import type { WidgetInstance } from "@/lib/dashboard/types";

interface SaveWidgetDialogProps {
  instance: WidgetInstance | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new library entry's id so the draft instance can link to it. */
  onSaved: (savedWidgetId: string) => void;
}

/**
 * "Save to library": copies a draft widget's current config into the
 * agency-wide library and links the instance to it. From then on the library
 * row owns the config — editing it here (or in any other view) offers to update
 * every view that uses it.
 *
 * The library entry is created immediately, independently of the dashboard
 * draft: it exists whether or not the view is saved afterwards.
 */
export function SaveWidgetDialog({ instance, open, onOpenChange, onSaved }: SaveWidgetDialogProps) {
  const createWidget = useCreateSavedWidget();
  const def = instance ? getWidget(instance.type) : undefined;
  const derivedTitle = instance && def ? (def.getTitle ? def.getTitle(instance.config) : def.title) : "";

  const [name, setName] = useState(derivedTitle);
  const [error, setError] = useState<string | null>(null);
  // Re-prefill on every open (render-time state adjustment, same pattern as the
  // config dialog): instance ids repeat across views, and an abandoned edit must
  // never come back the next time the dialog opens.
  const openKey = open && instance ? instance.i : null;
  const [lastKey, setLastKey] = useState<string | null>(null);
  if (openKey !== lastKey) {
    setLastKey(openKey);
    if (openKey) {
      setName(derivedTitle);
      setError(null);
    }
  }

  if (!instance) return null;

  // Campaign ids are client-specific, so they cannot travel with an agency-wide
  // library entry. Platform filters and a pinned date range are portable and
  // are kept.
  const filters = readWidgetFilters(instance.config);
  const strippedCampaigns = filters.campaignIds?.length ?? 0;
  const libraryConfig =
    strippedCampaigns > 0
      ? writeWidgetFilters(instance.config, {
          platforms: filters.platforms,
          dateRange: filters.dateRange,
        })
      : instance.config;

  async function submit() {
    if (!instance) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    try {
      const created = await createWidget.mutateAsync({
        name: trimmed,
        widgetType: instance.type,
        config: libraryConfig,
      });
      onSaved(created.id);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the widget");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save to library</DialogTitle>
          <DialogDescription className="text-[13px]">
            Saved widgets are shared across every client. The widget is added to the library as soon
            as you save here, whether or not you save the dashboard afterwards. Add one to another
            view and they stay in sync — editing it in one place offers to update them all.
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
            <label htmlFor="saved-widget-name" className="text-[12px] font-medium text-ink">
              Name
            </label>
            <Input
              id="saved-widget-name"
              value={name}
              autoFocus
              maxLength={120}
              placeholder="Spend vs. conversions"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {strippedCampaigns > 0 && (
            <p className="text-[12px] text-ink-muted">
              The campaign filter ({strippedCampaigns}{" "}
              {strippedCampaigns === 1 ? "campaign" : "campaigns"}) is not saved — campaigns belong
              to one client, and library widgets are used by all of them. Platform filters are kept.
            </p>
          )}

          {error && (
            <p role="alert" className="text-[12px] text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || createWidget.isPending}>
              {createWidget.isPending ? "Saving…" : "Save widget"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
