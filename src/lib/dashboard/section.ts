// Contract for the "section header" widget: pure layout, no data, no filters.
// Split out of the widget (client) file so server code — the Builder
// Assistant's schemas and titles — can read a section's config without pulling
// React in, and so the default title exists in exactly one place.

export interface SectionConfig {
  title: string;
  /** Empty = no subtitle line. */
  subtitle: string;
  divider: boolean;
}

export const DEFAULT_SECTION_CONFIG = { title: "Section", divider: true };

export const SECTION_TITLE_MAX = 80;
export const SECTION_SUBTITLE_MAX = 140;

export function readSectionConfig(config: Record<string, unknown>): SectionConfig {
  const title =
    typeof config.title === "string" ? config.title.trim().slice(0, SECTION_TITLE_MAX) : "";
  const subtitle =
    typeof config.subtitle === "string" ? config.subtitle.trim().slice(0, SECTION_SUBTITLE_MAX) : "";
  return {
    title: title || DEFAULT_SECTION_CONFIG.title,
    subtitle,
    divider: typeof config.divider === "boolean" ? config.divider : DEFAULT_SECTION_CONFIG.divider,
  };
}
