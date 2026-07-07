"use client";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "./dashboard-grid.css";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveGridLayout,
  useContainerWidth,
  type Layout,
  type ResponsiveLayouts,
} from "react-grid-layout";
import { Pencil, Plus, Check, X, RotateCcw, LayoutDashboard } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { useDashboard, useSaveDashboard } from "@/hooks/use-dashboard";
import { useDashboardStore } from "@/store/dashboard-store";
import { buildDefaultDashboard } from "@/lib/dashboard/default-preset";
import {
  GRID_COLS,
  GRID_BREAKPOINTS,
  GRID_ROW_HEIGHT,
  GRID_MARGIN,
  type DashboardConfig,
  type DashboardLayouts,
  type WidgetInstance,
} from "@/lib/dashboard/types";
import { WidgetFrame } from "@/components/dashboard/widget-frame";
import { WidgetCatalogDialog } from "@/components/dashboard/widget-catalog-dialog";
import { WidgetConfigDialog } from "@/components/dashboard/widget-config-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function CustomizableDashboard() {
  const clientId = useAppStore((s) => s.selectedClientId);
  // RGL 2.x self-measures via this hook (WidthProvider was removed in 2.0).
  const { width, containerRef } = useContainerWidth();
  const { data: saved, isLoading } = useDashboard(clientId);
  const saveDashboard = useSaveDashboard(clientId);

  const editMode = useDashboardStore((s) => s.editMode);
  const draft = useDashboardStore((s) => s.draft);
  const isDirty = useDashboardStore((s) => s.isDirty);
  const beginEdit = useDashboardStore((s) => s.beginEdit);
  const cancelEdit = useDashboardStore((s) => s.cancelEdit);
  const endEdit = useDashboardStore((s) => s.endEdit);
  const setLayouts = useDashboardStore((s) => s.setLayouts);
  const addWidget = useDashboardStore((s) => s.addWidget);
  const removeWidget = useDashboardStore((s) => s.removeWidget);
  const updateWidgetConfig = useDashboardStore((s) => s.updateWidgetConfig);
  const resizeWidget = useDashboardStore((s) => s.resizeWidget);

  const [catalogOpen, setCatalogOpen] = useState(false);
  const [configuringId, setConfiguringId] = useState<string | null>(null);

  // Leaving edit mode when the client changes avoids editing a stale draft.
  useEffect(() => {
    cancelEdit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const config: DashboardConfig | undefined = editMode && draft ? draft : saved;

  const widgetsById = useMemo(() => {
    const m = new Map<string, WidgetInstance>();
    config?.widgets.forEach((w) => m.set(w.i, w));
    return m;
  }, [config]);

  const configuring = configuringId ? widgetsById.get(configuringId) ?? null : null;
  const configuringWidth = configuring
    ? config?.layouts.lg.find((l) => l.i === configuring.i)?.w
    : undefined;

  if (isLoading || !config) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-9 w-28" />
        </div>
        <Skeleton className="h-[400px] w-full rounded-xl" />
      </div>
    );
  }

  function handleLayoutChange(_current: Layout, all: ResponsiveLayouts) {
    if (!editMode) return;
    const cur = useDashboardStore.getState().draft?.layouts;
    setLayouts({
      lg: [...(all.lg ?? cur?.lg ?? [])] as DashboardLayouts["lg"],
      md: [...(all.md ?? cur?.md ?? [])] as DashboardLayouts["md"],
      sm: [...(all.sm ?? cur?.sm ?? [])] as DashboardLayouts["sm"],
    });
  }

  async function handleSave() {
    if (draft) await saveDashboard.mutateAsync(draft);
    endEdit();
  }

  return (
    <div className={cn(editMode && "dash-editing")}>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <LayoutDashboard className="w-4 h-4 text-ink-muted shrink-0" />
          <h2 className="text-lg font-semibold text-ink truncate">{config.name}</h2>
          {editMode && (
            <span className="text-[11px] font-medium text-primary bg-primary/8 px-2 py-0.5 rounded-full">
              Editing
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {editMode ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setCatalogOpen(true)}>
                <Plus className="w-4 h-4" /> Add widget
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => beginEdit(buildDefaultDashboard(config.name))}
                title="Reset to the default layout"
              >
                <RotateCcw className="w-4 h-4" /> Reset
              </Button>
              <Button variant="ghost" size="sm" onClick={cancelEdit}>
                <X className="w-4 h-4" /> Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={!isDirty || saveDashboard.isPending}>
                <Check className="w-4 h-4" /> {saveDashboard.isPending ? "Saving…" : "Save"}
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => beginEdit(config)}>
              <Pencil className="w-4 h-4" /> Customize
            </Button>
          )}
        </div>
      </div>

      {config.widgets.length === 0 ? (
        <div className="border border-dashed border-hairline rounded-xl py-16 grid place-items-center text-center">
          <LayoutDashboard className="w-8 h-8 text-ink-faint mb-3" />
          <p className="text-sm font-medium text-ink">This dashboard is empty</p>
          <p className="text-xs text-ink-muted mt-1 mb-4">
            {editMode ? "Add widgets to build your view." : "Customize to add widgets."}
          </p>
          {editMode ? (
            <Button size="sm" onClick={() => setCatalogOpen(true)}>
              <Plus className="w-4 h-4" /> Add widget
            </Button>
          ) : (
            <Button size="sm" onClick={() => beginEdit(config)}>
              <Pencil className="w-4 h-4" /> Customize
            </Button>
          )}
        </div>
      ) : (
        <div ref={containerRef}>
          <ResponsiveGridLayout
            className="layout"
            width={width}
            layouts={config.layouts as unknown as ResponsiveLayouts}
            breakpoints={GRID_BREAKPOINTS}
            cols={GRID_COLS}
            rowHeight={GRID_ROW_HEIGHT}
            margin={GRID_MARGIN}
            dragConfig={{ enabled: editMode, handle: ".widget-drag-handle" }}
            resizeConfig={{ enabled: editMode }}
            onLayoutChange={handleLayoutChange}
          >
            {config.widgets.map((w) => (
              <div key={w.i}>
                <WidgetFrame
                  instance={w}
                  editMode={editMode}
                  onConfigure={setConfiguringId}
                  onRemove={removeWidget}
                />
              </div>
            ))}
          </ResponsiveGridLayout>
        </div>
      )}

      <WidgetCatalogDialog open={catalogOpen} onOpenChange={setCatalogOpen} onAdd={addWidget} />
      <WidgetConfigDialog
        instance={configuring}
        currentWidth={configuringWidth}
        open={!!configuringId}
        onOpenChange={(o) => !o && setConfiguringId(null)}
        onSave={(cfg) => configuring && updateWidgetConfig(configuring.i, cfg)}
        onResize={(w) => configuring && resizeWidget(configuring.i, w)}
      />
    </div>
  );
}
