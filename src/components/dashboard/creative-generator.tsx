"use client";

import { useState, useCallback } from "react";
import { useAppStore } from "@/store/app-store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Sparkles,
  Loader2,
  Image,
  Video,
  Layers,
  Lightbulb,
  Trophy,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
} from "lucide-react";
import type { Platform, CreativeType } from "@/lib/types/database";

interface GeneratedCreative {
  headline: string;
  body_copy: string;
  creative_type: CreativeType;
  platform: Platform;
  rationale: string;
  thumbnail_url: string;
  inspired_by: string[];
}

interface TopPerformerSummary {
  headline: string;
  creative_type: string;
  platform: string;
  ctr: number;
  cpa: number;
  conversions: number;
}

interface GenerateResponse {
  variants: GeneratedCreative[];
  topPerformers: TopPerformerSummary[];
  generatedWith: "ai" | "fallback";
}

const PLATFORM_DOTS: Record<Platform, string> = {
  google: "#4285F4",
  meta: "#0668E1",
  tiktok: "#121212",
};

const TYPE_ICONS: Record<CreativeType, React.ReactNode> = {
  image: <Image className="w-3.5 h-3.5" />,
  video: <Video className="w-3.5 h-3.5" />,
  carousel: <Layers className="w-3.5 h-3.5" />,
};

function VariantCard({
  variant,
  index,
}: {
  variant: GeneratedCreative;
  index: number;
}) {
  const [showRationale, setShowRationale] = useState(false);
  const [copied, setCopied] = useState<"headline" | "body" | null>(null);

  const handleCopy = useCallback(
    (text: string, field: "headline" | "body") => {
      navigator.clipboard.writeText(text);
      setCopied(field);
      setTimeout(() => setCopied(null), 1500);
    },
    [],
  );

  return (
    <div className="bg-white rounded-xl border border-hairline overflow-hidden hover:shadow-md transition-shadow duration-200">
      <div className="relative aspect-4/3 bg-gray-50 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={variant.thumbnail_url}
          alt={variant.headline}
          className="w-full h-full object-cover"
          loading="lazy"
        />
        <div className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] font-medium backdrop-blur-sm">
          {TYPE_ICONS[variant.creative_type]}
          <span className="capitalize">{variant.creative_type}</span>
        </div>
        <div className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 rounded bg-violet-500/90 text-white text-[10px] font-medium backdrop-blur-sm">
          <Sparkles className="w-2.5 h-2.5" />
          #{index + 1}
        </div>
      </div>

      <div className="p-3.5 space-y-2">
        <div>
          <div className="flex items-start justify-between gap-1">
            <h4 className="text-[13px] font-semibold text-ink leading-tight line-clamp-2 flex-1">
              {variant.headline}
            </h4>
            <button
              onClick={() => handleCopy(variant.headline, "headline")}
              className="p-0.5 text-ink-muted hover:text-ink transition-colors shrink-0"
              title="Copy headline"
            >
              {copied === "headline" ? (
                <Check className="w-3 h-3 text-emerald-500" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </button>
          </div>
          <div className="flex items-start justify-between gap-1 mt-1">
            <p className="text-[11px] text-ink-muted leading-relaxed line-clamp-2 flex-1">
              {variant.body_copy}
            </p>
            <button
              onClick={() => handleCopy(variant.body_copy, "body")}
              className="p-0.5 text-ink-muted hover:text-ink transition-colors shrink-0"
              title="Copy body"
            >
              {copied === "body" ? (
                <Check className="w-3 h-3 text-emerald-500" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-ink-muted">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: PLATFORM_DOTS[variant.platform] }}
          />
          <span className="capitalize">{variant.platform}</span>
        </div>

        <button
          onClick={() => setShowRationale(!showRationale)}
          className="flex items-center gap-1 w-full text-[11px] text-violet-600 hover:text-violet-800 transition-colors"
        >
          <Lightbulb className="w-3 h-3" />
          <span>Strategy</span>
          {showRationale ? (
            <ChevronUp className="w-3 h-3 ml-auto" />
          ) : (
            <ChevronDown className="w-3 h-3 ml-auto" />
          )}
        </button>

        {showRationale && (
          <div className="bg-violet-50 rounded-lg p-2.5 space-y-1.5">
            <p className="text-[11px] text-violet-800 leading-relaxed">
              {variant.rationale}
            </p>
            {variant.inspired_by.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {variant.inspired_by.map((source) => (
                  <span
                    key={source}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-violet-100 text-[9px] font-medium text-violet-700"
                  >
                    <Trophy className="w-2 h-2" />
                    {source.length > 25 ? source.slice(0, 25) + "..." : source}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TopPerformerPill({ performer }: { performer: TopPerformerSummary }) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 bg-emerald-50 rounded-lg border border-emerald-100 min-w-0">
      <Trophy className="w-3 h-3 text-emerald-600 shrink-0" />
      <span className="text-[11px] font-medium text-emerald-800 truncate">
        {performer.headline}
      </span>
      <span className="text-[10px] text-emerald-600 tabular-nums whitespace-nowrap">
        {(Number(performer.ctr) * 100).toFixed(1)}% CTR
      </span>
    </div>
  );
}

export function CreativeGenerator({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const clientId = useAppStore((s) => s.selectedClientId);

  const [count, setCount] = useState(6);
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = useCallback(async () => {
    if (!clientId) return;

    setIsGenerating(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/creatives/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, count }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to generate creatives");
      }

      const data: GenerateResponse = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsGenerating(false);
    }
  }, [clientId, count]);

  const handleReset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-500" />
            AI Creative Generator
          </DialogTitle>
          <DialogDescription>
            Analyze your top-performing creatives and generate new variants that
            combine winning elements.
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-4">
            <div className="bg-canvas-soft rounded-xl p-4 space-y-3">
              <h3 className="text-[12px] font-semibold text-ink uppercase tracking-wider">
                How it works
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  {
                    step: "1",
                    title: "Analyze",
                    desc: "Reviews your top performers by CTR, conversions & CPA",
                  },
                  {
                    step: "2",
                    title: "Combine",
                    desc: "Mixes winning headlines, copy angles & formats",
                  },
                  {
                    step: "3",
                    title: "Generate",
                    desc: "Creates new variants with preview thumbnails",
                  },
                ].map((item) => (
                  <div
                    key={item.step}
                    className="flex items-start gap-2.5"
                  >
                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-violet-100 text-violet-700 text-[10px] font-bold shrink-0 mt-0.5">
                      {item.step}
                    </span>
                    <div>
                      <p className="text-[12px] font-semibold text-ink">
                        {item.title}
                      </p>
                      <p className="text-[11px] text-ink-muted leading-relaxed">
                        {item.desc}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <label className="text-[12px] font-medium text-ink">
                Variants to generate:
              </label>
              <div className="flex items-center gap-1">
                {[3, 6, 9, 12].map((n) => (
                  <button
                    key={n}
                    onClick={() => setCount(n)}
                    className={cn(
                      "px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors",
                      count === n
                        ? "bg-violet-100 text-violet-700 border border-violet-200"
                        : "bg-white border border-hairline text-ink-muted hover:text-ink hover:border-gray-300",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <p className="text-[12px] text-red-700">{error}</p>
              </div>
            )}

            <Button
              onClick={handleGenerate}
              disabled={isGenerating || !clientId}
              className="w-full bg-violet-600 hover:bg-violet-700 text-white"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Analyzing top performers & generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Generate {count} Creative Variants
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-ink">
                  {result.variants.length} variants generated
                </span>
                {result.generatedWith === "ai" && (
                  <span className="px-1.5 py-0.5 rounded bg-violet-100 text-[10px] font-medium text-violet-700">
                    AI-powered
                  </span>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={handleReset}>
                Generate more
              </Button>
            </div>

            {result.topPerformers.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-ink-muted uppercase tracking-wider">
                  Based on top performers
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {result.topPerformers.slice(0, 4).map((p) => (
                    <TopPerformerPill key={p.headline} performer={p} />
                  ))}
                  {result.topPerformers.length > 4 && (
                    <span className="text-[10px] text-ink-muted self-center">
                      +{result.topPerformers.length - 4} more
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {result.variants.map((variant, i) => (
                <VariantCard key={i} variant={variant} index={i} />
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
