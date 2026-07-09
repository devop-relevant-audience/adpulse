"use client";

import { useState } from "react";
import { useAppStore } from "@/store/app-store";
import { useCurrentUser } from "@/hooks/use-current-user";
import { isAgencyRole } from "@/lib/auth/roles";
import { useCreatives } from "@/hooks/use-metrics";
import { Skeleton } from "@/components/ui/skeleton";
import { Panel } from "@/components/ui/panel";
import { QueryError } from "@/components/ui/query-error";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { BiImage, BiVideo, BiCarousel, BiError, BiMessageRounded, BiSort, BiTrendingDown, BiSolidMagicWand } from "react-icons/bi";
import { CreativeGenerator } from "@/components/dashboard/creative-generator";
import { PLATFORM_COLORS } from "@/lib/dashboard/chart-theme";
import { formatNumber as formatNum } from "@/lib/format";
import type { AdCreativeRow, Platform, CreativeStatus } from "@/lib/types/database";

const CREATIVE_TYPE_ICONS: Record<string, React.ReactNode> = {
  image: <BiImage className="w-3 h-3" />,
  video: <BiVideo className="w-3 h-3" />,
  carousel: <BiCarousel className="w-3 h-3" />,
};

const STATUS_STYLES: Record<CreativeStatus, { bg: string; text: string; label: string }> = {
  active: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Active" },
  fatigued: { bg: "bg-amber-50", text: "text-amber-700", label: "Fatigued" },
  paused: { bg: "bg-red-50", text: "text-red-600", label: "Paused" },
};

type SortKey = "spend" | "ctr" | "cpa" | "impressions" | "conversions";

function FatigueBar({ daysRunning }: { daysRunning: number }) {
  const pct = Math.min((daysRunning / 90) * 100, 100);
  const color =
    pct > 66 ? "bg-red-400" : pct > 33 ? "bg-amber-400" : "bg-emerald-400";

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-hairline rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[11px] text-ink-muted tabular-nums whitespace-nowrap">
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
    { label: "Total creatives", value: String(total), sub: null },
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
        <Panel
          key={card.label}
          className={cn(
            "p-4",
            "warn" in card && card.warn && "border-amber-200",
          )}
        >
          <p className="text-[12px] font-medium text-ink-muted">
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
            <p className="text-[11px] text-amber-700 mt-0.5">{card.sub}</p>
          )}
        </Panel>
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
    <Panel className="overflow-hidden group hover:shadow-md transition-shadow duration-200">
      {/* Thumbnail */}
      <div className="relative aspect-[4/3] bg-canvas-soft overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={creative.thumbnail_url}
          alt={creative.headline}
          className="w-full h-full object-cover"
          loading="lazy"
        />
        <div className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded bg-ink/80 text-white text-[11px] font-medium">
          {typeIcon}
          <span className="capitalize">{creative.creative_type}</span>
        </div>
        <div className={cn("absolute top-2 right-2 px-1.5 py-0.5 rounded text-[11px] font-medium", status.bg, status.text)}>
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
            style={{ backgroundColor: PLATFORM_COLORS[creative.platform] }}
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
            <p className="text-[11px] text-ink-muted mb-0.5 flex items-center gap-1">
              {creative.status === "fatigued" && (
                <BiError className="w-2.5 h-2.5 text-amber-500" />
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
          <BiMessageRounded className="w-3 h-3" />
          Ask AI about this creative
        </button>
      </div>
    </Panel>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-ink-muted">{label}</p>
      <p className="text-[12px] font-medium text-ink tabular-nums">{value}</p>
    </div>
  );
}

export function CreativeGallery() {
  const clientId = useAppStore((s) => s.selectedClientId);
  const setReferenceContext = useAppStore((s) => s.setReferenceContext);
  const { data: me } = useCurrentUser();
  // AI variant generation posts to the agency-only creatives/generate API.
  const canGenerate = isAgencyRole(me?.profile.role);

  const [platformFilter, setPlatformFilter] = useState<Platform | "">("");
  const [statusFilter, setStatusFilter] = useState<CreativeStatus | "">("");
  const [sortBy, setSortBy] = useState<SortKey>("spend");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [generatorOpen, setGeneratorOpen] = useState(false);

  const { data: creatives, isLoading, isError, refetch } = useCreatives({
    clientId,
    platform: platformFilter || undefined,
    status: statusFilter || undefined,
    sort: sortBy,
    order: sortOrder,
  });

  if (!clientId) {
    return (
      <Panel className="p-8 text-center text-ink-muted text-sm">
        Select a client to view creatives
      </Panel>
    );
  }

  if (isError) {
    return <QueryError onRetry={() => refetch()} message="Couldn't load creatives" />;
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
          <h2 className="text-lg font-semibold text-ink">Creative gallery</h2>
          <span className="text-[11px] text-ink-muted bg-canvas-soft px-2 py-0.5 rounded-md font-medium">
            {allCreatives.length}
          </span>
          {canGenerate && (
            <button
              onClick={() => setGeneratorOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-white bg-primary hover:bg-primary/90 transition-colors shadow-sm"
            >
              <BiSolidMagicWand className="w-3.5 h-3.5" />
              Generate variants
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <Select
            value={platformFilter || "all"}
            onValueChange={(v) => setPlatformFilter(v === "all" ? "" : (v as Platform))}
          >
            <SelectTrigger aria-label="Filter by platform" className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All platforms</SelectItem>
              <SelectItem value="google">Google</SelectItem>
              <SelectItem value="meta">Meta</SelectItem>
              <SelectItem value="tiktok">TikTok</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={statusFilter || "all"}
            onValueChange={(v) => setStatusFilter(v === "all" ? "" : (v as CreativeStatus))}
          >
            <SelectTrigger aria-label="Filter by status" className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="fatigued">Fatigued</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={sortBy}
            onValueChange={(v) => { if (v) setSortBy(v as SortKey); }}
          >
            <SelectTrigger aria-label="Sort creatives" className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="spend">Sort: Spend</SelectItem>
              <SelectItem value="ctr">Sort: CTR</SelectItem>
              <SelectItem value="cpa">Sort: CPA</SelectItem>
              <SelectItem value="conversions">Sort: Conversions</SelectItem>
              <SelectItem value="impressions">Sort: Impressions</SelectItem>
            </SelectContent>
          </Select>

          <button
            onClick={toggleSortOrder}
            className="flex items-center gap-1 text-xs border border-hairline rounded-md px-2 py-1.5 bg-white text-ink-muted hover:text-ink transition-colors"
            title={sortOrder === "desc" ? "Descending" : "Ascending"}
          >
            <BiSort className="w-3 h-3" />
            {sortOrder === "desc" ? "High to low" : "Low to high"}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <SummaryCards creatives={allCreatives} />

      {/* Fatigue warning banner */}
      {fatiguedCreatives.length > 0 && !statusFilter && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <BiTrendingDown className="w-4 h-4 text-amber-600 shrink-0" />
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
        <Panel className="p-12 text-center">
          <BiImage className="w-10 h-10 text-ink-muted/40 mx-auto mb-3" />
          <p className="text-sm text-ink-muted">No creatives found</p>
          <p className="text-xs text-ink-muted/60 mt-1">
            {platformFilter || statusFilter
              ? "Try adjusting your filters"
              : "Seed demo data to populate creatives"}
          </p>
        </Panel>
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
