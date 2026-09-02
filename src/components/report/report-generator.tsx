"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { useAppStore } from "@/store/app-store";
import { useClients } from "@/hooks/use-metrics";
import { useCurrentUser } from "@/hooks/use-current-user";
import { isAgencyRole } from "@/lib/auth/roles";
import { BiFile, BiDownload, BiRefresh, BiSlideshow, BiLink, BiChevronDown } from "react-icons/bi";
import type { ReportData } from "@/lib/report/builder";
import { ShareDialog } from "./share-dialog";

export function ReportGenerator() {
  const clientId = useAppStore((s) => s.selectedClientId);
  const dateRange = useAppStore((s) => s.dateRange);
  const { data: clients } = useClients();
  const { data: me } = useCurrentUser();
  // Share-link creation writes a share token via the reports/share API, which
  // is agency-only. Export (PDF/PPTX) stays available to everyone.
  const canShare = isAgencyRole(me?.profile.role);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingFormat, setGeneratingFormat] = useState<string | null>(null);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const lastParamsRef = useRef<string>("");

  useEffect(() => {
    const key = `${clientId}|${dateRange.start}|${dateRange.end}`;
    if (lastParamsRef.current && lastParamsRef.current !== key) {
      setReportData(null);
    }
    lastParamsRef.current = key;
  }, [clientId, dateRange.start, dateRange.end]);

  const selectedClient = clients?.find((c) => c.id === clientId);

  async function generateReport(): Promise<ReportData | null> {
    if (!clientId || !selectedClient) return null;

    if (reportData) return reportData;

    setIsGenerating(true);
    setExportError(null);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          clientName: selectedClient.name,
          startDate: dateRange.start,
          endDate: dateRange.end,
        }),
      });

      if (!res.ok) throw new Error("Failed to generate report");
      const data = await res.json();
      setReportData(data);
      return data;
    } catch (error) {
      console.error("Report generation failed:", error);
      setExportError("We couldn't generate the report. Please try again.");
      return null;
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleExportPdf() {
    setGeneratingFormat("pdf");
    const data = await generateReport();
    if (!data) { setGeneratingFormat(null); return; }

    const { generatePdfHtml } = await import("@/lib/report/export-pdf");
    const html = generatePdfHtml(data);
    const printWindow = window.open("", "_blank");
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      setTimeout(() => printWindow.print(), 500);
    } else {
      setExportError("We couldn't open the print view. Please allow pop-ups and try again.");
    }
    setGeneratingFormat(null);
  }

  async function handleExportPptx() {
    setGeneratingFormat("pptx");
    const data = await generateReport();
    if (!data) { setGeneratingFormat(null); return; }

    try {
      const { exportPptx } = await import("@/lib/report/export-pptx");
      await exportPptx(data);
    } catch (error) {
      console.error("PPTX export failed:", error);
      setExportError("We couldn't export the PowerPoint file. Please try again.");
    }
    setGeneratingFormat(null);
  }

  async function handleShareLink() {
    setGeneratingFormat("share");
    const data = await generateReport();
    if (!data) { setGeneratingFormat(null); return; }

    setGeneratingFormat(null);
    setShowShareDialog(true);
  }

  const isBusy = isGenerating || !!generatingFormat;

  return (
    <>
      <div className="relative">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              disabled={!clientId || isBusy}
              className="gap-2 rounded-full border-hairline"
            />
          }
        >
          {isBusy ? (
            <BiRefresh className="w-4 h-4 animate-spin" />
          ) : (
            <BiFile className="w-4 h-4" />
          )}
          {isBusy ? "Generating…" : "Export report"}
          <BiChevronDown className="w-3 h-3 opacity-60" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" sideOffset={6}>
          <DropdownMenuGroup>
            <DropdownMenuLabel>Export format</DropdownMenuLabel>
            <DropdownMenuItem onClick={handleExportPdf}>
              <BiDownload className="w-4 h-4 mr-2" />
              PDF
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleExportPptx}>
              <BiSlideshow className="w-4 h-4 mr-2" />
              PowerPoint (PPTX)
            </DropdownMenuItem>
          </DropdownMenuGroup>
          {canShare && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleShareLink}>
                <BiLink className="w-4 h-4 mr-2" />
                Shareable link
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {exportError && (
        <p
          role="alert"
          aria-live="polite"
          className="absolute right-0 top-full z-10 mt-1.5 max-w-[260px] rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[12px] text-red-600 shadow-sm"
        >
          {exportError}
        </p>
      )}
      </div>

      {showShareDialog && reportData && (
        <ShareDialog
          target={{ kind: "classic", reportData }}
          onClose={() => setShowShareDialog(false)}
        />
      )}
    </>
  );
}
