"use client";

import { useEffect } from "react";
import { BiErrorCircle } from "react-icons/bi";
import { Button } from "@/components/ui/button";
import { logger } from "@/lib/log";

// Segment-level boundary for a crashed view. Renders inside the persistent
// [clientId] shell (the sidebar/header stay), so it's a compact inline panel
// rather than a full-page takeover. Next resets it automatically on navigation.
export default function ViewError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error("View segment error", error, { digest: error.digest });
  }, [error]);

  return (
    <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-8 flex flex-col items-center text-center">
      <div className="w-10 h-10 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mb-3">
        <BiErrorCircle className="w-5 h-5" />
      </div>
      <p className="text-[13px] font-medium text-ink">
        Something went wrong loading this view
      </p>
      <p className="text-[12px] text-ink-muted mt-1 mb-4">
        An unexpected error occurred while rendering this section.
      </p>
      <Button variant="outline" size="sm" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
