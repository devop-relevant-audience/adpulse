// Shared contract for image uploads: the size cap, the accept list, and the
// content sniffing that decides whether bytes really are an image we allow.
//
// Deliberately dependency-free and isomorphic so the API route (authority) and
// the uploader component (hints: `accept`, early size feedback) agree on the
// same numbers. The client-side checks are UX only — the route re-runs every
// one of them on the real bytes.

/**
 * 4 MB, not 5. Vercel Functions reject a request body over 4.5 MB before our
 * handler ever runs, and this route proxies the file through the function so it
 * can sniff the bytes server-side. 4 MB leaves room for multipart overhead.
 * Raising it past 4.5 MB requires switching to Blob client uploads, which would
 * mean giving up server-side byte validation.
 */
export const MAX_IMAGE_UPLOAD_BYTES = 4 * 1024 * 1024;

export const MAX_IMAGE_UPLOAD_LABEL = "4 MB";

/** For an `<input type="file" accept>` attribute. */
export const IMAGE_UPLOAD_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";

export const IMAGE_UPLOAD_TYPES_LABEL = "PNG, JPEG, WebP, GIF or SVG";

export interface SniffedImage {
  /** Canonical media type, taken from the bytes rather than the upload. */
  contentType: string;
  /** Extension to use in the stored pathname, without the dot. */
  extension: string;
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, i) => bytes[offset + i] === byte);
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const RIFF = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP = [0x57, 0x45, 0x42, 0x50]; // "WEBP" at offset 8
const GIF = [0x47, 0x49, 0x46, 0x38]; // "GIF8", then '7'|'9' and 'a'

/**
 * Identify an image from its leading bytes. Returns `null` for anything not on
 * the allow-list — the declared MIME type and the filename extension are never
 * consulted, because both are attacker-controlled.
 */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  if (startsWith(bytes, PNG)) return { contentType: "image/png", extension: "png" };
  if (startsWith(bytes, JPEG)) return { contentType: "image/jpeg", extension: "jpg" };
  if (
    startsWith(bytes, GIF) &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return { contentType: "image/gif", extension: "gif" };
  }
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) {
    return { contentType: "image/webp", extension: "webp" };
  }
  if (looksLikeSvg(bytes)) return { contentType: "image/svg+xml", extension: "svg" };
  return null;
}

// SVG has no magic number, so "sniffing" means parsing enough of the head to be
// sure it is XML that opens an <svg> root. Anything that merely *contains* the
// string "<svg" somewhere later is rejected.
function looksLikeSvg(bytes: Uint8Array): boolean {
  const head = decodeUtf8(bytes.subarray(0, 4096)).replace(/^﻿/, "").trimStart();
  if (!head.startsWith("<")) return false;

  // Skip the XML declaration, doctype, comments and processing instructions to
  // reach the first real element, which must be <svg>.
  let rest = head;
  for (let i = 0; i < 10; i += 1) {
    rest = rest.trimStart();
    if (/^<svg[\s/>]/i.test(rest)) return true;
    const match = /^<(\?[^>]*\?|!--[\s\S]*?--|![^>]*)>/.exec(rest);
    if (!match) return false;
    rest = rest.slice(match[0].length);
  }
  return false;
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

// Character references are resolved before scanning so that `java&#115;cript:`
// and friends cannot slip an active URL past the checks below.
function decodeCharRefs(text: string): string {
  return text.replace(/&#(x[0-9a-f]+|\d+);/gi, (whole, code: string) => {
    const value = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : parseInt(code, 10);
    return Number.isFinite(value) && value >= 0 && value <= 0x10ffff
      ? String.fromCodePoint(value)
      : whole;
  });
}

const SVG_REJECTIONS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /<\s*script[\s/>]/, reason: "a <script> element" },
  { pattern: /<\s*(foreignobject|iframe|embed|object|audio|video)[\s/>]/, reason: "an embedded-content element" },
  { pattern: /<\s*!\s*entity/, reason: "an XML entity declaration" },
  { pattern: /\son[a-z]+\s*=/, reason: "an inline event handler" },
  { pattern: /(javascript|vbscript|data\s*:\s*text\/html)\s*:/, reason: "a script URL" },
  // External references pull remote content into the document at render time.
  { pattern: /\b(?:xlink:)?href\s*=\s*["']?\s*(?:https?:)?\/\//, reason: "an external reference" },
  { pattern: /@import\b/, reason: "a CSS @import" },
];

/**
 * Conservative scan for the parts of SVG that execute or fetch. Returns a human
 * reason string when the markup must be rejected, or `null` when it is clean.
 *
 * This is a denylist, which is weaker than a real sanitizing parser — it is the
 * second line of defence, not the first. The first is that Blob serves these
 * files from its own `*.public.blob.vercel-storage.com` origin, so even a
 * hostile SVG has no access to an AdPulse or Atlas session.
 */
export function findUnsafeSvgContent(bytes: Uint8Array): string | null {
  const source = decodeCharRefs(decodeUtf8(bytes)).toLowerCase();
  for (const { pattern, reason } of SVG_REJECTIONS) {
    if (pattern.test(source)) return reason;
  }
  return null;
}

// --- Where an upload lives, and which of them a vision model can read -------

/** Path prefix every `POST /api/assets` upload is written under. */
export const UPLOAD_BLOB_PATH_PREFIX = "adpulse/uploads";

const UPLOAD_BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";

/**
 * True only for a URL this app itself uploaded. Anything else — another host,
 * another prefix, plain http — is not ours.
 *
 * Two callers depend on it: `DELETE /api/assets`, so that route cannot become a
 * delete-any-blob primitive, and the Builder Assistant, which hands image URLs
 * to the model and stores them on `image` widgets. Without this check a caller
 * could point either at an arbitrary URL and make the server (or the model's
 * fetcher) pull it.
 */
export function isAdpulseUploadUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "https:" &&
    parsed.hostname.endsWith(UPLOAD_BLOB_HOST_SUFFIX) &&
    parsed.pathname.startsWith(`/${UPLOAD_BLOB_PATH_PREFIX}/`)
  );
}

/**
 * The subset of the upload allow-list a vision model can actually read. GIF and
 * SVG are uploadable (an `image` widget renders both) but are not accepted as
 * chat attachments: Gemini takes PNG/JPEG/WebP, and an SVG is markup rather
 * than pixels.
 */
export const VISION_IMAGE_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/** For an `<input type="file" accept>` on the Builder Assistant composer. */
export const VISION_IMAGE_ACCEPT = VISION_IMAGE_CONTENT_TYPES.join(",");

export const VISION_IMAGE_TYPES_LABEL = "PNG, JPEG or WebP";

export function isVisionImageType(contentType: string): boolean {
  return (VISION_IMAGE_CONTENT_TYPES as readonly string[]).includes(contentType);
}
