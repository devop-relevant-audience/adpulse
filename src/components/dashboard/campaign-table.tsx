"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Panel } from "@/components/ui/panel";
import { useMetrics } from "@/hooks/use-metrics";
import { useAppStore } from "@/store/app-store";
import { BiSort, BiDownArrowAlt, BiUpArrowAlt, BiDownload, BiMessageRounded } from "react-icons/bi";
import { cn } from "@/lib/utils";
import { PLATFORM_COLORS } from "@/lib/dashboard/chart-theme";
import { formatNumber as formatNum } from "@/lib/format";
import { aggregateCampaignTotals } from "@/lib/data/campaign-aggregate";
import type { CampaignPerformanceRow, Platform } from "@/lib/types/database";

interface CampaignSummary {
  campaignId: string;
  campaignName: string;
  platform: Platform;
  totalImpressions: number;
  totalClicks: number;
  totalSpend: number;
  totalConversions: number;
  avgCtr: number;
  avgCpc: number;
  avgCpa: number;
}

function aggregateByCampaign(rows: CampaignPerformanceRow[]): CampaignSummary[] {
  return aggregateCampaignTotals(rows).map((c) => ({
    campaignId: c.campaignId,
    campaignName: c.campaignName,
    platform: c.platform,
    totalImpressions: c.impressions,
    totalClicks: c.clicks,
    totalSpend: c.spend,
    totalConversions: c.conversions,
    avgCtr: c.impressions > 0 ? Number(((c.clicks / c.impressions) * 100).toFixed(2)) : 0,
    avgCpc: c.clicks > 0 ? Number((c.spend / c.clicks).toFixed(2)) : 0,
    avgCpa: c.conversions > 0 ? Number((c.spend / c.conversions).toFixed(2)) : 0,
  }));
}

type SortField = keyof CampaignSummary;
type SortDirection = "asc" | "desc";

export function CampaignTable() {
  const clientId = useAppStore((s) => s.selectedClientId);
  const dateRange = useAppStore((s) => s.dateRange);
  const platform = useAppStore((s) => s.selectedPlatform);
  const setReferenceContext = useAppStore((s) => s.setReferenceContext);

  const [sortField, setSortField] = useState<SortField>("totalSpend");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const { data: metrics, isLoading } = useMetrics({
    clientId,
    startDate: dateRange.start,
    endDate: dateRange.end,
    platform,
  });

  if (!clientId || isLoading) {
    return (
      <Panel className="p-5">
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </Panel>
    );
  }

  let campaigns = aggregateByCampaign(metrics || []);
  campaigns = campaigns.sort((a, b) => {
    const aVal = a[sortField];
    const bVal = b[sortField];

    if (typeof aVal === "string" && typeof bVal === "string") {
      return sortDirection === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    return sortDirection === "asc" ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) return <BiSort className="w-3 h-3 ml-1 opacity-40" />;
    return sortDirection === "asc" ? <BiUpArrowAlt className="w-3 h-3 ml-1" /> : <BiDownArrowAlt className="w-3 h-3 ml-1" />;
  };

  const handleExportCSV = () => {
    if (!campaigns.length) return;
    const headers = ["Campaign", "Platform", "Impressions", "Clicks", "Spend", "Conversions", "CTR (%)", "CPC ($)", "CPA ($)"];
    const rows = campaigns.map(c => [c.campaignName, c.platform, c.totalImpressions, c.totalClicks, c.totalSpend, c.totalConversions, c.avgCtr, c.avgCpc, c.avgCpa]);
    const csvContent = [headers.join(","), ...rows.map(e => e.map(x => `"${x}"`).join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `campaigns_${dateRange.start}_${dateRange.end}.csv`;
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const columns: Array<{ key: SortField; label: string; align: "left" | "right" }> = [
    { key: "campaignName", label: "Campaign", align: "left" },
    { key: "platform", label: "Platform", align: "left" },
    { key: "totalImpressions", label: "Impr.", align: "right" },
    { key: "totalClicks", label: "Clicks", align: "right" },
    { key: "totalSpend", label: "Spend", align: "right" },
    { key: "totalConversions", label: "Conv.", align: "right" },
    { key: "avgCtr", label: "CTR", align: "right" },
    { key: "avgCpc", label: "CPC", align: "right" },
    { key: "avgCpa", label: "CPA", align: "right" },
  ];

  return (
    <Panel>
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-hairline">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-ink">Campaigns</h3>
          <span className="text-[11px] text-ink-muted bg-canvas-soft px-2 py-0.5 rounded-md font-medium">
            {campaigns.length}
          </span>
        </div>
        <button
          onClick={handleExportCSV}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium text-ink-muted hover:text-ink hover:bg-canvas-soft transition-colors"
        >
          <BiDownload className="w-3.5 h-3.5" />
          Export
        </button>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-hairline">
              {columns.map((col, i) => (
                <TableHead
                  key={col.key}
                  className={cn(
                    "text-[11px] font-medium text-ink-muted cursor-pointer hover:text-ink transition-colors h-9",
                    col.align === "right" && "text-right",
                    i === 0 && "pl-5",
                    i === columns.length - 1 && "pr-5"
                  )}
                  onClick={() => handleSort(col.key)}
                >
                  <div className={cn("flex items-center", col.align === "right" && "justify-end")}>
                    {col.label}
                    {renderSortIcon(col.key)}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaigns.map((campaign) => (
              <TableRow
                key={campaign.campaignId}
                className="border-hairline hover:bg-canvas-soft cursor-pointer group transition-colors duration-100"
                onClick={() =>
                  setReferenceContext({
                    campaignId: campaign.campaignId,
                    campaignName: campaign.campaignName,
                    platform: campaign.platform,
                    dateRange,
                  })
                }
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setReferenceContext({
                      campaignId: campaign.campaignId,
                      campaignName: campaign.campaignName,
                      platform: campaign.platform,
                      dateRange,
                    });
                  }
                }}
              >
                <TableCell className="pl-5 font-medium text-[13px] text-ink max-w-[220px]">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate">{campaign.campaignName}</span>
                    <BiMessageRounded className="w-3 h-3 text-primary shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5 text-[12px] text-ink-secondary capitalize">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: PLATFORM_COLORS[campaign.platform] }} />
                    {campaign.platform}
                  </div>
                </TableCell>
                <TableCell className="text-right text-[13px] tabular-nums text-ink-secondary">
                  {formatNum(campaign.totalImpressions)}
                </TableCell>
                <TableCell className="text-right text-[13px] tabular-nums text-ink-secondary">
                  {formatNum(campaign.totalClicks)}
                </TableCell>
                <TableCell className="text-right text-[13px] tabular-nums font-medium text-ink">
                  ${campaign.totalSpend.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </TableCell>
                <TableCell className="text-right text-[13px] tabular-nums text-ink-secondary">
                  {formatNum(campaign.totalConversions)}
                </TableCell>
                <TableCell className="text-right text-[13px] tabular-nums text-ink-secondary">
                  {campaign.avgCtr}%
                </TableCell>
                <TableCell className="text-right text-[13px] tabular-nums text-ink-secondary">
                  ${campaign.avgCpc.toFixed(2)}
                </TableCell>
                <TableCell className="text-right text-[13px] tabular-nums text-ink-secondary pr-5">
                  ${campaign.avgCpa.toFixed(2)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Panel>
  );
}
