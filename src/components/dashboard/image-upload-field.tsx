"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BiImageAdd, BiTrash, BiErrorCircle } from "react-icons/bi";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  IMAGE_UPLOAD_ACCEPT,
  IMAGE_UPLOAD_TYPES_LABEL,
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_IMAGE_UPLOAD_LABEL,
} from "@/lib/uploads/image-constraints";

/**
 * Drag-and-drop / click-to-browse image uploader. Sends the file to
 * `POST /api/assets` (agency-only) and hands back the public Blob URL.
 *
 * Interface:
 *
 *   <ImageUploadField
 *     value={config.imageUrl ?? null}          // current URL, or null when empty
 *     onChange={(url) => onChange({ ...config, imageUrl: url ?? undefined })}
 *     alt="Client logo"                        // optional, preview alt text
 *     label="Drop an image or click to browse" // optional, empty-state copy
 *     disabled={false}                         // optional
 *     className="…"                            // optional, on the outer wrapper
 *   />
 *
 * `onChange` fires exactly once per completed action, with the new URL on a
 * successful upload and `null` on remove. It never fires mid-upload, so the
 * parent's config only ever holds a URL that actually exists.
 *
 * Uploads are NEVER auto-deleted. Removing or replacing an image only changes
 * the draft config — the blob behind the old URL is deliberately left in place.
 * This component edits a draft that may be cancelled, and even once applied it
 * cannot know whether the URL is still referenced elsewhere: other dashboard
 * views, templates, and any number of frozen report snapshots may inline the
 * same URL, and nothing in the system reference-counts them. Deleting on edit
 * meant a Cancel after Remove, or a replace on a library-linked widget, could
 * permanently break an already-published client report. An orphaned image costs
 * a few hundred kilobytes; a report that silently loses its logo is
 * unrecoverable. Orphans are the cheaper failure. `DELETE /api/assets` still
 * exists for a deliberate cleanup action, but nothing here calls it.
 *
 * It renders its own control only. Wrap it in a `<ConfigField>` when used
 * inside the widget config dialog; it adds no outer heading or spacing.
 */
export interface ImageUploadFieldProps {
  value: string | null;
  onChange: (url: string | null) => void;
  alt?: string;
  label?: string;
  disabled?: boolean;
  className?: string;
}

interface UploadResponse {
  url: string;
}

export function ImageUploadField({
  value,
  onChange,
  alt = "Uploaded image",
  label = "Drop an image, or click to browse",
  disabled = false,
  className,
}: ImageUploadFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const uploading = progress !== null;
  const busy = uploading || disabled;

  // Abort an in-flight upload if the config dialog closes mid-request.
  useEffect(() => () => xhrRef.current?.abort(), []);

  const upload = useCallback(
    (file: File) => {
      setError(null);

      // Mirrors the route's cap so an oversized file fails instantly instead of
      // after a pointless round trip. The route re-checks it regardless.
      if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
        setError(`Image is larger than ${MAX_IMAGE_UPLOAD_LABEL}.`);
        return;
      }

      const body = new FormData();
      body.append("file", file);

      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      xhr.open("POST", "/api/assets");
      xhr.responseType = "json";

      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          setProgress(Math.round((event.loaded / event.total) * 100));
        }
      });

      xhr.addEventListener("load", () => {
        xhrRef.current = null;
        setProgress(null);
        const payload = xhr.response as (UploadResponse & { error?: string }) | null;
        if (xhr.status >= 200 && xhr.status < 300 && payload?.url) {
          // The URL being replaced is intentionally left in the store — see the
          // note on the component above.
          onChange(payload.url);
        } else {
          setError(payload?.error ?? "Upload failed. Please try again.");
        }
      });

      xhr.addEventListener("error", () => {
        xhrRef.current = null;
        setProgress(null);
        setError("Upload failed. Check your connection and try again.");
      });

      xhr.addEventListener("abort", () => {
        xhrRef.current = null;
        setProgress(null);
      });

      setProgress(0);
      xhr.send(body);
    },
    [onChange],
  );

  function openPicker() {
    if (!busy) inputRef.current?.click();
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    const file = event.dataTransfer.files[0];
    if (file) upload(file);
  }

  // Clears the draft's reference only. The blob stays in the store: this edit
  // may still be cancelled, and the URL may be referenced by other views,
  // templates or already-published report snapshots.
  function handleRemove() {
    setError(null);
    onChange(null);
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_UPLOAD_ACCEPT}
        className="sr-only"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset so picking the same file twice in a row still fires change.
          event.target.value = "";
          if (file) upload(file);
        }}
      />

      {value && !uploading ? (
        <div className="flex items-center gap-3 rounded-lg border border-hairline bg-white p-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary Blob host, not a configured next/image remote pattern */}
          <img
            src={value}
            alt={alt}
            className="h-14 w-14 shrink-0 rounded-md object-contain bg-canvas-soft/60"
          />
          <p className="min-w-0 flex-1 truncate text-xs text-ink-muted" title={value}>
            {value.split("/").pop()}
          </p>
          <div className="flex shrink-0 gap-1">
            <Button type="button" variant="outline" size="xs" disabled={busy} onClick={openPicker}>
              Replace
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={busy}
              onClick={handleRemove}
              aria-label="Remove image"
            >
              <BiTrash />
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={openPicker}
          onDragOver={(event) => {
            event.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={cn(
            "flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-6 text-center transition-colors outline-none",
            "focus-visible:ring-3 focus-visible:ring-ring/50",
            dragging ? "border-primary bg-primary/5" : "border-hairline hover:border-ink-faint",
            busy && "cursor-not-allowed opacity-60",
          )}
        >
          {uploading ? (
            <>
              <span className="text-xs text-ink-secondary">Uploading… {progress}%</span>
              <span
                role="progressbar"
                aria-label="Upload progress"
                aria-valuenow={progress ?? 0}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-1 w-full max-w-40 overflow-hidden rounded-full bg-canvas-soft"
              >
                <span
                  className="block h-full rounded-full bg-primary transition-[width] duration-150"
                  style={{ width: `${progress ?? 0}%` }}
                />
              </span>
            </>
          ) : (
            <>
              <BiImageAdd className="h-5 w-5 text-ink-faint" aria-hidden />
              <span className="text-xs text-ink-secondary">{label}</span>
              <span className="text-[11px] text-ink-muted">
                {IMAGE_UPLOAD_TYPES_LABEL}, up to {MAX_IMAGE_UPLOAD_LABEL}
              </span>
            </>
          )}
        </button>
      )}

      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-[11px] text-destructive">
          <BiErrorCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}
