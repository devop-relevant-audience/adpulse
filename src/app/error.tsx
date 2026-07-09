"use client";

import { useEffect } from "react";
import { BiErrorCircle } from "react-icons/bi";
import { Button } from "@/components/ui/button";
import { logger } from "@/lib/log";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error("Route segment error", error, { digest: error.digest });
  }, [error]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-hairline bg-white p-8 text-center shadow-elevated">
        <div className="w-12 h-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto mb-4">
          <BiErrorCircle className="w-6 h-6" />
        </div>
        <h1 className="text-lg font-semibold text-ink">Something went wrong</h1>
        <p className="text-[13px] text-ink-muted mt-1.5">
          We hit an unexpected error loading this page. You can try again, and if the problem
          persists, refresh the page.
        </p>
        <div className="flex items-center justify-center gap-2 mt-6">
          <Button size="sm" onClick={reset}>
            Try again
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            Reload page
          </Button>
        </div>
      </div>
    </div>
  );
}
