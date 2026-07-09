"use client";

import { BiErrorCircle } from "react-icons/bi";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface QueryErrorProps {
  /** Retry handler — usually the query's `refetch`. */
  onRetry?: () => void;
  message?: string;
  /** Compact variant for small surfaces like dashboard widget cells. */
  compact?: boolean;
  className?: string;
}

/**
 * Shared "couldn't load this data" state for failed React Query reads. Makes a
 * fetch failure visibly distinct from a genuine "no data" empty state and
 * offers a retry. Use `compact` inside widget-sized surfaces.
 */
export function QueryError({
  onRetry,
  message = "Couldn't load this data",
  compact = false,
  className,
}: QueryErrorProps) {
  if (compact) {
    return (
      <div className={cn("h-full grid place-items-center text-center px-3", className)}>
        <div className="flex flex-col items-center">
          <BiErrorCircle className="w-4 h-4 text-destructive mb-1" />
          <p className="text-xs text-ink-muted">{message}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-1.5 text-[11px] font-medium text-primary hover:underline rounded outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-destructive/20 bg-destructive/5 p-8 flex flex-col items-center text-center",
        className
      )}
    >
      <div className="w-10 h-10 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mb-3">
        <BiErrorCircle className="w-5 h-5" />
      </div>
      <p className="text-[13px] font-medium text-ink">{message}</p>
      <p className="text-[12px] text-ink-muted mt-1 mb-4">
        Something went wrong while fetching this data. Please try again.
      </p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
