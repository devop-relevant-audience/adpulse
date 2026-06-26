"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  TrendingUp,
  TrendingDown,
  Eye,
  MousePointerClick,
  DollarSign,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReportData } from "@/lib/report/builder";

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function ReportViewer({ data }: { data: ReportData }) {
  const metrics = [
    {
      label: "Impressions",
      value: formatNum(data.comparison.current.totalImpressions),
      delta: data.comparison.deltas.totalImpressions.percentage,
      icon: <Eye className="w-4 h-4" />,
    },
    {
      label: "Clicks",
      value: formatNum(data.comparison.current.totalClicks),
      delta: data.comparison.deltas.totalClicks.percentage,
      icon: <MousePointerClick className="w-4 h-4" />,
    },
    {
      label: "Spend",
      value: `$${data.comparison.current.totalSpend.toLocaleString()}`,
      delta: data.comparison.deltas.totalSpend.percentage,
      icon: <DollarSign className="w-4 h-4" />,
    },
    {
      label: "Conversions",
      value: formatNum(data.comparison.current.totalConversions),
      delta: data.comparison.deltas.totalConversions.percentage,
      icon: <Target className="w-4 h-4" />,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-3">
        {metrics.map((m) => (
          <Card key={m.label} className="bg-canvas-soft border-0">
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-ink-muted mb-1">
                {m.icon}
                <span className="text-xs">{m.label}</span>
              </div>
              <p className="text-xl font-bold tracking-tight">{m.value}</p>
              <div
                className={cn(
                  "flex items-center gap-1 text-xs mt-1",
                  m.delta >= 0 ? "text-emerald-600" : "text-red-600"
                )}
              >
                {m.delta >= 0 ? (
                  <TrendingUp className="w-3 h-3" />
                ) : (
                  <TrendingDown className="w-3 h-3" />
                )}
                {m.delta >= 0 ? "+" : ""}
                {m.delta}% vs. prior period
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Separator />

      <div>
        <h3 className="text-base font-semibold mb-3">Executive Summary</h3>
        <div className="text-sm leading-relaxed text-ink-secondary whitespace-pre-wrap">
          {data.narrative}
        </div>
      </div>

      <Separator />

      <div>
        <h3 className="text-base font-semibold mb-3">Campaign Breakdown</h3>
        <Table>
          <TableHeader>
            <TableRow className="border-hairline">
              <TableHead className="text-xs font-semibold uppercase text-ink-muted">
                Campaign
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase text-ink-muted">
                Platform
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase text-ink-muted text-right">
                Spend
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase text-ink-muted text-right">
                Conv.
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase text-ink-muted text-right">
                CTR
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase text-ink-muted text-right">
                CPC
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.campaignBreakdown
              .sort((a, b) => b.spend - a.spend)
              .map((c) => (
                <TableRow key={c.campaignName} className="border-hairline">
                  <TableCell className="font-medium text-sm">
                    {c.campaignName}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs capitalize">
                      {c.platform}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    ${c.spend.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {c.conversions}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {c.ctr}%
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    ${c.cpc}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
