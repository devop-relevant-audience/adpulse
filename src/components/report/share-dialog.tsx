"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BiLink, BiRefresh, BiCopy, BiCheck, BiShield } from "react-icons/bi";
import type { ReportData } from "@/lib/report/builder";
import { useAppStore } from "@/store/app-store";

interface ShareDialogProps {
  reportData: ReportData;
  onClose: () => void;
}

export function ShareDialog({ reportData, onClose }: ShareDialogProps) {
  const clientId = useAppStore((s) => s.selectedClientId);
  const [password, setPassword] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreateLink() {
    if (password.length < 4) {
      setError("Password must be at least 4 characters");
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const res = await fetch("/api/reports/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password,
          reportId: reportData.id || undefined,
          clientId: clientId || undefined,
          clientName: reportData.clientName,
          dateRange: reportData.dateRange,
          comparisonRange: reportData.comparisonRange,
          narrative: reportData.narratives.executive,
          metricsSummary: {
            comparison: reportData.comparison,
            campaignBreakdown: reportData.campaignBreakdown,
            platformBreakdown: reportData.platformBreakdown,
            trendSummary: reportData.trendSummary,
            funnel: reportData.funnel,
            healthScore: reportData.healthScore,
            narratives: reportData.narratives,
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        const msg = data.error || "Failed to create share link";
        if (msg.includes("row-level security") || msg.includes("policy")) {
          console.error("Share link creation failed — database write permissions not configured (set SUPABASE_SERVICE_ROLE_KEY):", msg);
          throw new Error("Sharing is temporarily unavailable. Please try again later.");
        }
        throw new Error(msg);
      }

      const data = await res.json();
      setShareUrl(data.shareUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create share link");
    } finally {
      setIsCreating(false);
    }
  }

  function handleCopy() {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md bg-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <BiLink className="w-4 h-4 text-primary" />
            Share Report
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-canvas-soft/80 rounded-lg p-3">
            <p className="text-[12px] text-ink-muted">
              <BiShield className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
              This will create a password-protected link that only shows data for{" "}
              <strong className="text-ink">{reportData.clientName}</strong>. Recipients will need the password to view.
            </p>
          </div>

          {!shareUrl ? (
            <>
              <div>
                <label htmlFor="share-password" className="text-[12px] font-medium text-ink mb-1.5 block">
                  Set a password for this link
                </label>
                <Input
                  id="share-password"
                  type="password"
                  placeholder="Enter password (min 4 characters)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleCreateLink(); }}
                  className="text-sm"
                />
              </div>

              {error && (
                <p role="alert" aria-live="polite" className="text-[12px] text-red-600">{error}</p>
              )}

              <Button
                onClick={handleCreateLink}
                disabled={isCreating || password.length < 4}
                className="w-full gap-2 bg-primary hover:bg-primary/90 text-white"
              >
                {isCreating ? (
                  <BiRefresh className="w-4 h-4 animate-spin" />
                ) : (
                  <BiLink className="w-4 h-4" />
                )}
                {isCreating ? "Creating link..." : "Create Share Link"}
              </Button>
            </>
          ) : (
            <>
              <div>
                <label className="text-[12px] font-medium text-ink mb-1.5 block">
                  Share this link
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={shareUrl}
                    className="text-sm font-mono bg-canvas-soft"
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleCopy}
                    aria-label={copied ? "Link copied to clipboard" : "Copy share link"}
                    className="shrink-0"
                  >
                    {copied ? <BiCheck className="w-4 h-4 text-emerald-600" /> : <BiCopy className="w-4 h-4" />}
                  </Button>
                </div>
                <span role="status" aria-live="polite" className="sr-only">
                  {copied ? "Link copied to clipboard" : ""}
                </span>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-[12px] text-amber-700">
                  <strong>Password:</strong> Share the password separately with your recipient.
                  The link will not work without it.
                </p>
              </div>

              <Button
                variant="outline"
                onClick={onClose}
                className="w-full"
              >
                Done
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
