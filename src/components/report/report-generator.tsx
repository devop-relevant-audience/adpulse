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
import { FileText, Download, Loader2, Presentation, Link2, ChevronDown } from "lucide-react";
import type { ReportData } from "@/lib/report/builder";
import { ShareDialog } from "./share-dialog";

export function ReportGenerator() {
  const clientId = useAppStore((s) => s.selectedClientId);
  const dateRange = useAppStore((s) => s.dateRange);
  const { data: clients } = useClients();
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingFormat, setGeneratingFormat] = useState<string | null>(null);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [showShareDialog, setShowShareDialog] = useState(false);

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
    }
    setGeneratingFormat(null);
  }

  async function handleExportPptx() {
    setGeneratingFormat("pptx");
    const data = await generateReport();
    if (!data) { setGeneratingFormat(null); return; }

    const { exportPptx } = await import("@/lib/report/export-pptx");
    await exportPptx(data);
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
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <FileText className="w-4 h-4" />
          )}
          {isBusy ? "Generating..." : "Export Report"}
          <ChevronDown className="w-3 h-3 opacity-60" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" sideOffset={6}>
          <DropdownMenuGroup>
            <DropdownMenuLabel>Export format</DropdownMenuLabel>
            <DropdownMenuItem onClick={handleExportPdf}>
              <Download className="w-4 h-4 mr-2" />
              PDF
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleExportPptx}>
              <Presentation className="w-4 h-4 mr-2" />
              PowerPoint (PPTX)
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleShareLink}>
            <Link2 className="w-4 h-4 mr-2" />
            Shareable Link
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {showShareDialog && reportData && (
        <ShareDialog
          reportData={reportData}
          onClose={() => setShowShareDialog(false)}
        />
      )}
    </>
  );
}
