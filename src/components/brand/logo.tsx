import { cn } from "@/lib/utils";

/**
 * AdPulse brand mark — a single-stroke pulse/signal glyph that reads both as a
 * heartbeat and a rising performance trace. Deliberately *not* the generic
 * "solid-blue rounded square + stock icon" SaaS chip: the mark is an ink tile
 * with the pulse knocked out in the surface color and one primary-colored
 * beat, so the brand colour is an accent rather than a flat fill.
 */
export function LogoMark({
  className,
  size = 28,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-[9px] bg-foreground text-background",
        className
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        width={size * 0.68}
        height={size * 0.68}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* pulse trace */}
        <path
          d="M2 14H6.4L8 14L10.4 6L13 18.5L14.9 12H18"
          stroke="currentColor"
          strokeWidth={2}
        />
        {/* the beat */}
        <circle cx="10.4" cy="6" r="1.9" fill="var(--primary)" stroke="none" />
      </svg>
    </span>
  );
}

export function Logo({
  className,
  markSize = 28,
  showWordmark = true,
}: {
  className?: string;
  markSize?: number;
  showWordmark?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      <LogoMark size={markSize} />
      {showWordmark && (
        <span className="text-[15px] font-semibold tracking-[-0.02em] text-ink">
          Ad<span className="text-ink-secondary">Pulse</span>
        </span>
      )}
    </span>
  );
}
