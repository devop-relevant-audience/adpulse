"use client";

import React from "react";

/**
 * The tabular form of whatever a widget currently displays, published so the
 * frame's view-mode menu can offer "Download CSV". Widgets opt in by calling
 * `useRegisterWidgetData`; a widget that publishes nothing simply has no CSV
 * item.
 */
export interface WidgetData {
  /** Base name for the downloaded file (no extension). Defaults to the title. */
  filename?: string;
  columns: string[];
  rows: (string | number | null)[][];
}

type Listener = () => void;

/**
 * Registered widget data, keyed by grid instance id.
 *
 * Deliberately an external store rather than React state: widgets re-publish on
 * every render, and putting that in a parent's state would re-render the frame
 * (and the widget inside it) in a loop. Readers subscribe to a boolean
 * (`useHasWidgetData`) that only flips once, and pull the rows at click time.
 */
class WidgetDataStore {
  private data = new Map<string, WidgetData>();
  private listeners = new Set<Listener>();

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get(instanceId: string): WidgetData | null {
    return this.data.get(instanceId) ?? null;
  }

  has = (instanceId: string): boolean => this.data.has(instanceId);

  set(instanceId: string, data: WidgetData): void {
    this.data.set(instanceId, data);
    this.emit();
  }

  /**
   * Removes `data` only if it is still the registered value. The same instance
   * can be mounted twice (grid + expand dialog); without this identity check,
   * unmounting the copy would clear the live one's registration.
   */
  clear(instanceId: string, data: WidgetData): void {
    if (this.data.get(instanceId) !== data) return;
    this.data.delete(instanceId);
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

const WidgetDataContext = React.createContext<WidgetDataStore | null>(null);

/**
 * Wraps the dashboard grid. Outside a provider every hook here no-ops, so
 * widgets rendered in the config preview or a report snapshot are unaffected.
 */
export function WidgetDataProvider({ children }: { children: React.ReactNode }) {
  const [store] = React.useState(() => new WidgetDataStore());
  return <WidgetDataContext.Provider value={store}>{children}</WidgetDataContext.Provider>;
}

/**
 * Publishes this widget's current rows. Call it unconditionally from a widget's
 * Render component and pass `null` while loading or when there is nothing
 * tabular to export.
 */
export function useRegisterWidgetData(instanceId: string, data: WidgetData | null): void {
  const store = React.useContext(WidgetDataContext);
  React.useEffect(() => {
    if (!store || !data) return;
    store.set(instanceId, data);
    return () => store.clear(instanceId, data);
  }, [store, instanceId, data]);
}

/** True once the widget has published rows. Stable, so it re-renders once. */
export function useHasWidgetData(instanceId: string): boolean {
  const store = React.useContext(WidgetDataContext);
  const subscribe = store?.subscribe ?? noopSubscribe;
  return React.useSyncExternalStore(
    subscribe,
    () => (store ? store.has(instanceId) : false),
    () => false
  );
}

/** Reads the registered rows on demand (menu click), not during render. */
export function useWidgetDataReader(): (instanceId: string) => WidgetData | null {
  const store = React.useContext(WidgetDataContext);
  return React.useCallback((instanceId: string) => store?.get(instanceId) ?? null, [store]);
}

function noopSubscribe() {
  return () => {};
}

function csvCell(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(data: WidgetData): string {
  return [data.columns, ...data.rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

/** Browser-side download — no server round trip, the rows are already here. */
export function downloadWidgetCsv(data: WidgetData, fallbackName: string): void {
  const base = (data.filename ?? fallbackName).trim() || "widget";
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "widget";
  const blob = new Blob([toCsv(data)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slug}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
