// Config readers for the report-only blocks (cover, AI summary).
//
// Server-safe on purpose — no React, no imports beyond types — because both the
// snapshot builder (server) and the widget components (client) read the same
// config, and the builder must not pull a "use client" module into the server
// bundle to do it. Same role `custom-widget.ts` plays for the custom widget.

/** Field caps, shared with the zod schemas in `widget-schemas.ts`. */
export const COVER_TITLE_MAX = 160;
export const COVER_SUBTITLE_MAX = 300;
export const AI_SUMMARY_INSTRUCTIONS_MAX = 500;

/**
 * A report cover. The client name and the reporting period are CONTEXT, never
 * config: on the editor canvas they come from the page, and in a generated
 * report they are frozen into the snapshot. Only the wording lives here.
 */
export interface CoverConfig {
  title: string;
  /** Empty = no subtitle line. */
  subtitle: string;
}

export const DEFAULT_COVER_CONFIG = { title: "Performance report" };

export function readCoverConfig(config: Record<string, unknown>): CoverConfig {
  const title =
    typeof config.title === "string" ? config.title.trim().slice(0, COVER_TITLE_MAX) : "";
  const subtitle =
    typeof config.subtitle === "string" ? config.subtitle.trim().slice(0, COVER_SUBTITLE_MAX) : "";
  return { title: title || DEFAULT_COVER_CONFIG.title, subtitle };
}

export interface AiSummaryConfig {
  /** Steer for the model ("focus on Google spend", "mention the promo"). */
  instructions: string;
}

export function readAiSummaryConfig(config: Record<string, unknown>): AiSummaryConfig {
  const instructions =
    typeof config.instructions === "string"
      ? config.instructions.trim().slice(0, AI_SUMMARY_INSTRUCTIONS_MAX)
      : "";
  return { instructions };
}
