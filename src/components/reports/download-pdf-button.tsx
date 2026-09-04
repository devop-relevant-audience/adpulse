"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { BiDownload, BiRefresh } from "react-icons/bi";

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const match = /filename="([^"]+)"/.exec(header);
  return match ? match[1] : null;
}

export function DownloadPdfButton({ reportId, title }: { reportId: string; title: string }) {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setIsPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/pdf?id=${encodeURIComponent(reportId)}`);

      if (!res.ok) {
        let message = "We couldn't create the PDF. Please try again.";
        try {
          const body = await res.json();
          if (typeof body?.error === "string" && body.error) message = body.error;
        } catch {
          // Non-JSON error body — keep the fallback message.
        }
        setError(message);
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filenameFromDisposition(res.headers.get("Content-Disposition")) ?? `${title}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Revoke on the next tick: some browsers start the download after the
      // click handler returns, and a revoked URL cancels it.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err) {
      console.error("PDF download failed:", err);
      setError("We couldn't create the PDF. Please try again.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 shrink-0"
        disabled={isPending}
        onClick={handleDownload}
      >
        {isPending ? (
          <BiRefresh className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <BiDownload className="w-3.5 h-3.5" />
        )}
        {isPending ? "Preparing PDF…" : "Download PDF"}
      </Button>
      {error && (
        <p
          role="alert"
          aria-live="polite"
          className="absolute right-0 top-full z-10 mt-1.5 max-w-[260px] rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[12px] text-red-600 shadow-sm"
        >
          {error}
        </p>
      )}
    </div>
  );
}
