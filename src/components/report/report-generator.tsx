"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAppStore } from "@/store/app-store";
import { useClients } from "@/hooks/use-metrics";
import { FileText, Download, Loader2, Sparkles } from "lucide-react";
import type { ReportData } from "@/lib/report/builder";
import { ReportViewer } from "./report-viewer";

export function ReportGenerator() {
  const clientId = useAppStore((s) => s.selectedClientId);
  const dateRange = useAppStore((s) => s.dateRange);
  const { data: clients } = useClients();
  const [isGenerating, setIsGenerating] = useState(false);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const selectedClient = clients?.find((c) => c.id === clientId);

  async function handleGenerate() {
    if (!clientId || !selectedClient) return;

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
    } catch (error) {
      console.error("Report generation failed:", error);
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            disabled={!clientId}
            className="gap-2 rounded-full border-hairline"
            onClick={() => {
              setIsOpen(true);
              if (!reportData) handleGenerate();
            }}
          />
        }
      >
        <FileText className="w-4 h-4" />
        Generate Report
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-white scrollbar-thin">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="w-5 h-5 text-primary" />
            {selectedClient?.name} — Performance Report
          </DialogTitle>
        </DialogHeader>

        {isGenerating && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-ink-muted">
              Analyzing data and generating AI narrative...
            </p>
          </div>
        )}

        {reportData && !isGenerating && (
          <div className="space-y-6">
            <ReportViewer data={reportData} />
            <div className="flex justify-end gap-3 pt-4 border-t border-hairline">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => {
                  setReportData(null);
                  handleGenerate();
                }}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Regenerate
              </Button>
              <Button
                size="sm"
                className="gap-2 bg-primary hover:bg-primary/90 rounded-full"
                onClick={() => handleExportPdf(reportData)}
              >
                <Download className="w-3.5 h-3.5" />
                Export PDF
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function handleExportPdf(data: ReportData) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;

  const html = `<!DOCTYPE html>
<html>
<head>
  <title>${data.clientName} — Performance Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Inter, -apple-system, system-ui, sans-serif; color: #000; padding: 40px; max-width: 800px; margin: 0 auto; }
    h1 { font-size: 28px; font-weight: 700; letter-spacing: -1px; margin-bottom: 4px; }
    h2 { font-size: 18px; font-weight: 700; margin-top: 32px; margin-bottom: 12px; color: #000; }
    .subtitle { font-size: 14px; color: #615d59; margin-bottom: 32px; }
    .metrics-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 32px; }
    .metric-card { background: #f6f5f4; border-radius: 8px; padding: 16px; }
    .metric-label { font-size: 12px; color: #615d59; text-transform: uppercase; letter-spacing: 0.5px; }
    .metric-value { font-size: 24px; font-weight: 700; margin-top: 4px; }
    .metric-delta { font-size: 12px; margin-top: 2px; }
    .positive { color: #16a34a; }
    .negative { color: #dc2626; }
    .narrative { font-size: 15px; line-height: 1.7; color: #31302e; white-space: pre-wrap; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
    th { text-align: left; padding: 8px; border-bottom: 2px solid #e6e6e6; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #615d59; }
    td { padding: 8px; border-bottom: 1px solid #e6e6e6; }
    .text-right { text-align: right; }
    .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #e6e6e6; font-size: 12px; color: #a39e98; }
    @media print { body { padding: 20px; } }
  </style>
</head>
<body>
  <h1>${data.clientName}</h1>
  <p class="subtitle">Performance Report · ${data.dateRange.start} to ${data.dateRange.end}</p>

  <div class="metrics-grid">
    <div class="metric-card">
      <div class="metric-label">Impressions</div>
      <div class="metric-value">${formatNum(data.comparison.current.totalImpressions)}</div>
      <div class="metric-delta ${data.comparison.deltas.totalImpressions.percentage >= 0 ? "positive" : "negative"}">${data.comparison.deltas.totalImpressions.percentage >= 0 ? "+" : ""}${data.comparison.deltas.totalImpressions.percentage}%</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Clicks</div>
      <div class="metric-value">${formatNum(data.comparison.current.totalClicks)}</div>
      <div class="metric-delta ${data.comparison.deltas.totalClicks.percentage >= 0 ? "positive" : "negative"}">${data.comparison.deltas.totalClicks.percentage >= 0 ? "+" : ""}${data.comparison.deltas.totalClicks.percentage}%</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Spend</div>
      <div class="metric-value">$${data.comparison.current.totalSpend.toLocaleString()}</div>
      <div class="metric-delta ${data.comparison.deltas.totalSpend.percentage >= 0 ? "positive" : "negative"}">${data.comparison.deltas.totalSpend.percentage >= 0 ? "+" : ""}${data.comparison.deltas.totalSpend.percentage}%</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Conversions</div>
      <div class="metric-value">${formatNum(data.comparison.current.totalConversions)}</div>
      <div class="metric-delta ${data.comparison.deltas.totalConversions.percentage >= 0 ? "positive" : "negative"}">${data.comparison.deltas.totalConversions.percentage >= 0 ? "+" : ""}${data.comparison.deltas.totalConversions.percentage}%</div>
    </div>
  </div>

  <h2>Executive Summary</h2>
  <div class="narrative">${data.narrative}</div>

  <h2>Campaign Breakdown</h2>
  <table>
    <thead>
      <tr>
        <th>Campaign</th>
        <th>Platform</th>
        <th class="text-right">Spend</th>
        <th class="text-right">Conv.</th>
        <th class="text-right">CTR</th>
        <th class="text-right">CPC</th>
      </tr>
    </thead>
    <tbody>
      ${data.campaignBreakdown
        .sort((a, b) => b.spend - a.spend)
        .map(
          (c) => `<tr>
        <td>${c.campaignName}</td>
        <td>${c.platform}</td>
        <td class="text-right">$${c.spend.toFixed(2)}</td>
        <td class="text-right">${c.conversions}</td>
        <td class="text-right">${c.ctr}%</td>
        <td class="text-right">$${c.cpc}</td>
      </tr>`
        )
        .join("")}
    </tbody>
  </table>

  <div class="footer">
    Generated by AdPulse · ${new Date().toLocaleDateString()}
  </div>
</body>
</html>`;

  printWindow.document.write(html);
  printWindow.document.close();
  setTimeout(() => printWindow.print(), 500);
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}
