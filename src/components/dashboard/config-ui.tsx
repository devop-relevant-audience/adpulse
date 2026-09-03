"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared building blocks for the widget config dialog.
 *
 * Contract: every widget `ConfigForm` renders one or more `<ConfigSection>`
 * cards — the dialog stacks them and appends the shared Filters/Size cards,
 * so a form must NOT add its own outer spacing or headings.
 *
 * Density is the DIALOG's call, not the form's: the card padding and the gap
 * between fields read the `--config-pad` / `--config-gap` custom properties,
 * so a dialog tier loosens every card it holds by setting them on the pane
 * (see `TIER` in widget-config-dialog.tsx). Unset, they fall back to the
 * compact values every form was designed against.
 */

interface ConfigSectionProps {
  title: string;
  /** Right-aligned muted note on the section header row. */
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Extra classes on the card body (e.g. to let it flex-grow). */
  bodyClassName?: string;
}

export function ConfigSection({ title, hint, children, className, bodyClassName }: ConfigSectionProps) {
  return (
    <section className={cn("rounded-lg border border-hairline bg-white overflow-hidden", className)}>
      <div className="flex items-baseline justify-between gap-3 px-[var(--config-pad,0.875rem)] py-2 bg-canvas-soft/60 border-b border-hairline/80">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
          {title}
        </h3>
        {hint && <span className="text-[11px] text-ink-muted text-right">{hint}</span>}
      </div>
      <div
        className={cn(
          "p-[var(--config-pad,0.875rem)] space-y-[var(--config-gap,1rem)]",
          bodyClassName
        )}
      >
        {children}
      </div>
    </section>
  );
}

interface ConfigFieldProps {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function ConfigField({ label, hint, children, className }: ConfigFieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-ink-secondary">{label}</span>
        {hint && <span className="text-[11px] text-ink-muted text-right">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

const CHIP_BASE =
  "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-xs transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40 disabled:cursor-not-allowed";
const CHIP_ON = "border-primary bg-primary/8 text-primary font-medium";
const CHIP_OFF =
  "border-hairline text-ink-muted hover:text-ink hover:border-ink-faint disabled:hover:text-ink-muted disabled:hover:border-hairline";

interface ChipToggleProps {
  active?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}

/** Small pressable pill used for every multi/single choice in the config dialog. */
export function ChipToggle({ active, disabled, title, onClick, children, className }: ChipToggleProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(CHIP_BASE, active ? CHIP_ON : CHIP_OFF, className)}
    >
      {children}
    </button>
  );
}

/** Row of chips with consistent wrapping. */
export function ChipRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap gap-1.5", className)}>{children}</div>;
}
