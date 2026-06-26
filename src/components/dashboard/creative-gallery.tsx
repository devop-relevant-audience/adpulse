"use client";

import { useState } from "react";
import { useAppStore } from "@/store/app-store";
import { useCreatives } from "@/hooks/use-metrics";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  Image,
  Video,
  Layers,
  AlertTriangle,
  MessageCircle,
  ArrowUpDown,
  TrendingDown,
  Sparkles,
} from "lucide-react";
import { CreativeGenerator } from "@/components/dashboard/creative-generator";
import type { AdCreativeRow, Platform, CreativeStatus } from "@/lib/types/database";

const PLATFORM_DOTS: Record<Platform, string> = {
  google: "#4285F4",
  meta: "#0668E1",
  tiktok: "#121212",
};

const CREATIVE_TYPE_ICONS: Record<string, React.ReactNode> = {
  image: <Image className="w-3 h-3" />,
  video: <Video className="w-3 h-3" />,
  carousel: <Layers className="w-3 h-3" />,
};

const STATUS_STYLES: Record<CreativeStatus, { bg: string; text: string; label: string }> = {
  active: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Active" },
  fatigued: { bg: "bg-amber-50", text: "text-amber-700", label: "Fatigued" },
  paused: { bg: "bg-red-50", text: "text-red-600", label: "Paused" },
};

type SortKey = "spend" | "ctr" | "cpa" | "impressions" | "conversions";

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function FatigueBar({ daysRunning }: { daysRunning: number }) {
  const pct = Math.min((daysRunning / 90) * 100, 100);
  const color =
    pct > 66 ? "bg-red-400" : pct > 33 ? "bg-amber-400" : "bg-emerald-400";

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-ink-muted tabular-nums whitespace-nowrap">
        {daysRunning}d
      </span>
    </div>
  );
}

function SummaryCards({ creatives }: { creatives: AdCreativeRow[] }) {
  const total = creatives.length;
  const avgCtr =
    total > 0
      ? (creatives.reduce((s, c) => s + Number(c.ctr), 0) / total) * 100
      : 0;
  const avgCpa =
    total > 0
      ? creatives.reduce((s, c) => s + Number(c.cpa), 0) / total
      : 0;
  const fatiguedCount = creatives.filter((c) => c.status === "fatigued").length;

  const cards = [
    { label: "Total Creatives", value: String(total), sub: null },
    { label: "Avg CTR", value: `${avgCtr.toFixed(2)}%`, sub: null },
    { label: "Avg CPA", value: `$${avgCpa.toFixed(2)}`, sub: null },
    {
      label: "Fatigued",
      value: String(fatiguedCount),
      sub: fatiguedCount > 0 ? "needs attention" : null,
      warn: fatiguedCount > 0,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {cards.map((card) => (
        <div
          key={card.label}
          className={cn(
            "bg-white rounded-xl border border-hairline p-4",
            "warn" in card && card.warn && "border-amber-200",
          )}
        >
          <p className="text-[11px] font-medium text-ink-muted uppercase tracking-wider">
            {card.label}
          </p>
          <p
            className={cn(
              "text-xl font-semibold mt-1 tabular-nums",
              "warn" in card && card.warn ? "text-amber-600" : "text-ink",
            )}
          >
            {card.value}
          </p>
          {card.sub && (
            <p className="text-[10px] text-amber-500 mt-0.5">{card.sub}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function CreativeCard({
  creative,
  onAskAI,
}: {
  creative: AdCreativeRow;
  onAskAI: () => void;
}) {
  const status = STATUS_STYLES[creative.status as CreativeStatus];
  const typeIcon = CREATIVE_TYPE_ICONS[creative.creative_type];

  return (
    <div className="bg-white rounded-xl border border-hairline overflow-hidden group hover:shadow-md transition-shadow duration-200">
      {/* Thumbnail */}
      <div className="relative aspect-[4/3] bg-gray-50 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={creative.thumbnail_url}
          alt={creative.headline}
          className="w-full h-full object-cover"
          loading="lazy"
        />
        <div className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] font-medium backdrop-blur-sm">
          {typeIcon}
          <span className="capitalize">{creative.creative_type}</span>
        </div>
        <div className={cn("absolute top-2 right-2 px-1.5 py-0.5 rounded text-[10px] font-medium", status.bg, status.text)}>
          {status.label}
        </div>
      </div>

      {/* Content */}
      <div className="p-3.5 space-y-2.5">
        {/* Headline & copy */}
        <div>
          <h4 className="text-[13px] font-semibold text-ink leading-tight line-clamp-1">
            {creative.headline}
          </h4>
          <p className="text-[11px] text-ink-muted mt-0.5 line-clamp-2 leading-relaxed">
            {creative.body_copy}
          </p>
        </div>

        {/* Platform & campaign */}
        <div className="flex items-center gap-1.5 text-[11px] text-ink-muted">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: PLATFORM_DOTS[creative.platform] }}
          />
          <span className="capitalize">{creative.platform}</span>
        </div>

        {/* Metrics grid */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          <MetricCell label="CTR" value={`${(Number(creative.ctr) * 100).toFixed(2)}%`} />
          <MetricCell label="CPA" value={`$${Number(creative.cpa).toFixed(2)}`} />
          <MetricCell label="Spend" value={`$${formatNum(Number(creative.spend))}`} />
          <MetricCell label="Conv." value={formatNum(Number(creative.conversions))} />
        </div>

        {/* Fatigue bar */}
        {Number(creative.days_running) > 14 && (
          <div>
            <p className="text-[10px] text-ink-muted mb-0.5 flex items-center gap-1">
              {creative.status === "fatigued" && (
                <AlertTriangle className="w-2.5 h-2.5 text-amber-500" />
              )}
              Creative age
            </p>
            <FatigueBar daysRunning={Number(creative.days_running)} />
          </div>
        )}

        {/* Ask AI button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAskAI();
          }}
          className="flex items-center gap-1.5 w-full px-2.5 py-1.5 rounded-md text-[11px] font-medium text-primary bg-primary/5 hover:bg-primary/10 transition-colors"
        >
          <MessageCircle className="w-3 h-3" />
          Ask AI about this creative
        </button>
      </div>
    </div>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-ink-muted">{label}</p>
      <p className="text-[12px] font-medium text-ink tabular-nums">{value}</p>
    </div>
  );
}

export function CreativeGallery() {
  const clientId = useAppStore((s) => s.selectedClientId);
  const setReferenceContext = useAppStore((s) => s.setReferenceContext);

  const [platformFilter, setPlatformFilter] = useState<Platform | "">("");
  const [statusFilter, setStatusFilter] = useState<CreativeStatus | "">("");
  const [sortBy, setSortBy] = useState<SortKey>("spend");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [generatorOpen, setGeneratorOpen] = useState(false);

  const { data: creatives, isLoading } = useCreatives({
    clientId,
    platform: platformFilter || undefined,
    status: statusFilter || undefined,
    sort: sortBy,
    order: sortOrder,
  });

  if (!clientId) {
    return (
      <div className="bg-white rounded-xl border border-hairline p-8 text-center text-ink-muted text-sm">
        Select a client to view creatives
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[360px] rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const allCreatives = creatives || [];

  const handleAskAI = (creative: AdCreativeRow) => {
    setReferenceContext({
      campaignId: creative.campaign_id,
      campaignName: creative.ad_name,
      platform: creative.platform,
      metric: creative.status === "fatigued" ? "creative_fatigue" : "creative_performance",
    });
  };

  const toggleSortOrder = () => {
    setSortOrder((prev) => (prev === "desc" ? "asc" : "desc"));
  };

  const fatiguedCreatives = allCreatives.filter((c) => c.status === "fatigued");

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-ink">Creative Gallery</h2>
          <span className="text-[11px] text-ink-muted bg-canvas-soft px-2 py-0.5 rounded-md font-medium">
            {allCreatives.length}
          </span>
          <button
            onClick={() => setGeneratorOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-white bg-violet-600 hover:bg-violet-700 transition-colors shadow-sm"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Generate Variants
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value as Platform | "")}
            className="text-xs border border-hairline rounded-md px-2.5 py-1.5 bg-white text-ink focus:outline-none focus:ring-1 focus:ring-primary/30"
          >
            <option value="">All Platforms</option>
            <option value="google">Google</option>
            <option value="meta">Meta</option>
            <option value="tiktok">TikTok</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as CreativeStatus | "")}
            className="text-xs border border-hairline rounded-md px-2.5 py-1.5 bg-white text-ink focus:outline-none focus:ring-1 focus:ring-primary/30"
          >
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="fatigued">Fatigued</option>
            <option value="paused">Paused</option>
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="text-xs border border-hairline rounded-md px-2.5 py-1.5 bg-white text-ink focus:outline-none focus:ring-1 focus:ring-primary/30"
          >
            <option value="spend">Sort: Spend</option>
            <option value="ctr">Sort: CTR</option>
            <option value="cpa">Sort: CPA</option>
            <option value="conversions">Sort: Conversions</option>
            <option value="impressions">Sort: Impressions</option>
          </select>

          <button
            onClick={toggleSortOrder}
            className="flex items-center gap-1 text-xs border border-hairline rounded-md px-2 py-1.5 bg-white text-ink-muted hover:text-ink transition-colors"
            title={sortOrder === "desc" ? "Descending" : "Ascending"}
          >
            <ArrowUpDown className="w-3 h-3" />
            {sortOrder === "desc" ? "High-Low" : "Low-High"}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <SummaryCards creatives={allCreatives} />

      {/* Fatigue warning banner */}
      {fatiguedCreatives.length > 0 && !statusFilter && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <TrendingDown className="w-4 h-4 text-amber-600 shrink-0" />
          <div className="flex-1">
            <p className="text-[13px] font-medium text-amber-800">
              {fatiguedCreatives.length} creative{fatiguedCreatives.length > 1 ? "s" : ""} showing fatigue
            </p>
            <p className="text-[11px] text-amber-600">
              These ads have been running 45+ days with declining CTR. Consider refreshing creative or pausing.
            </p>
          </div>
          <button
            onClick={() => setStatusFilter("fatigued")}
            className="text-[11px] font-medium text-amber-700 hover:text-amber-900 px-2.5 py-1 rounded-md border border-amber-300 hover:bg-amber-100 transition-colors shrink-0"
          >
            Show fatigued
          </button>
        </div>
      )}

      {/* Gallery grid */}
      {allCreatives.length === 0 ? (
        <div className="bg-white rounded-xl border border-hairline p-12 text-center">
          <Image className="w-10 h-10 text-ink-muted/40 mx-auto mb-3" />
          <p className="text-sm text-ink-muted">No creatives found</p>
          <p className="text-xs text-ink-muted/60 mt-1">
            {platformFilter || statusFilter
              ? "Try adjusting your filters"
              : "Seed demo data to populate creatives"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {allCreatives.map((creative) => (
            <CreativeCard
              key={creative.id}
              creative={creative}
              onAskAI={() => handleAskAI(creative)}
            />
          ))}
        </div>
      )}

      <CreativeGenerator open={generatorOpen} onOpenChange={setGeneratorOpen} />
    </div>
  );
}
