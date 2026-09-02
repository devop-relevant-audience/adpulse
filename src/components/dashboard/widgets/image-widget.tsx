"use client";

import { BiImage } from "react-icons/bi";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { ChipRow, ChipToggle, ConfigField, ConfigSection } from "@/components/dashboard/config-ui";
import { ImageUploadField } from "@/components/dashboard/image-upload-field";
import type { WidgetRenderProps, WidgetConfigFormProps } from "@/lib/dashboard/types";

/**
 * Pure layout: an uploaded image scaled to its tile. No data, no filters — a
 * logo, a screenshot or a diagram dropped into a dashboard or a client report.
 */
export interface ImageWidgetConfig {
  /** Public Blob URL from ImageUploadField. Absent = nothing uploaded yet. */
  url?: string;
  /** Empty means "decorative" — a valid, deliberate choice for a bare logo. */
  alt: string;
  fit: ImageFit;
}

export const IMAGE_FITS = ["contain", "cover"] as const;
export type ImageFit = (typeof IMAGE_FITS)[number];

const FIT_LABELS: Record<ImageFit, string> = {
  contain: "Fit",
  cover: "Fill",
};

export const DEFAULT_IMAGE_CONFIG = { alt: "", fit: "contain" } as const;

export function readImageConfig(config: Record<string, unknown>): ImageWidgetConfig {
  const url = typeof config.url === "string" && config.url.trim() ? config.url : undefined;
  return {
    ...(url ? { url } : {}),
    alt: typeof config.alt === "string" ? config.alt.trim().slice(0, 140) : "",
    fit: (IMAGE_FITS as readonly string[]).includes(String(config.fit))
      ? (config.fit as ImageFit)
      : DEFAULT_IMAGE_CONFIG.fit,
  };
}

export function ImageWidget({ config }: WidgetRenderProps) {
  const { url, alt, fit } = readImageConfig(config);

  if (!url) {
    return (
      <div className="h-full grid place-items-center text-center">
        <div className="text-ink-faint">
          <BiImage className="w-5 h-5 mx-auto mb-1" aria-hidden />
          <p className="text-xs">No image yet — edit to upload one</p>
        </div>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary Blob host, not a configured next/image remote pattern
    <img
      src={url}
      alt={alt}
      className={cn("h-full w-full", fit === "cover" ? "object-cover" : "object-contain")}
    />
  );
}

export function ImageConfigForm({ config, onChange }: WidgetConfigFormProps) {
  const { url, alt, fit } = readImageConfig(config);
  // Raw value while typing: readImageConfig trims, which would eat spaces.
  const altDraft = typeof config.alt === "string" ? config.alt : "";

  return (
    <ConfigSection title="Image">
      <ConfigField label="File">
        <ImageUploadField
          value={url ?? null}
          alt={alt}
          onChange={(next) => onChange({ ...config, url: next ?? undefined })}
        />
      </ConfigField>

      <ConfigField label="Alt text" hint="Screen readers and shared reports">
        <Input
          value={altDraft}
          maxLength={140}
          onChange={(e) => onChange({ ...config, alt: e.target.value })}
          placeholder="e.g. Acme logo"
          aria-label="Image alt text"
          className="h-8 text-xs bg-white"
        />
      </ConfigField>

      <ConfigField label="Scaling" hint={fit === "cover" ? "Crops to fill the tile" : "Whole image, letterboxed"}>
        <ChipRow>
          {IMAGE_FITS.map((option) => (
            <ChipToggle
              key={option}
              active={fit === option}
              onClick={() => onChange({ ...config, fit: option })}
            >
              {FIT_LABELS[option]}
            </ChipToggle>
          ))}
        </ChipRow>
      </ConfigField>
    </ConfigSection>
  );
}
