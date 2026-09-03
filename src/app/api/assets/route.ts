import { NextRequest, NextResponse } from "next/server";
import { del, put } from "@vercel/blob";
import { requireAgencyRole, requireUser } from "@/lib/auth/guard";
import { withRoute } from "@/lib/http/with-route";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import {
  IMAGE_UPLOAD_TYPES_LABEL,
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_IMAGE_UPLOAD_LABEL,
  UPLOAD_BLOB_PATH_PREFIX,
  findUnsafeSvgContent,
  isAdpulseUploadUrl,
  sniffImage,
} from "@/lib/uploads/image-constraints";

// Image uploads to Vercel Blob.
//
//   POST   multipart/form-data, field `file` -> { url, pathname, contentType, size }
//   DELETE ?url=<blob url>                   -> { success: true }
//
// Uploading is agency-only, the same gate dashboard writes use: an uploaded
// image ends up on a widget that client users read but never author.
//
// The Blob token is read lazily inside the handler, never at module scope, so a
// missing token is a 503 on this one route rather than an import-time crash
// that takes the whole app down.

// Generous enough to never bother a real editor, tight enough that a stolen
// session cannot fill the store. Fails open when Upstash is unconfigured.
const RATE_LIMIT = { prefix: "assets-upload", limit: 30, windowSeconds: 60 } as const;

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

async function gateAgency() {
  const gate = await requireUser();
  if (!gate.ok) return gate;
  return requireAgencyRole(gate.ctx);
}

function getBlobToken(): string | null {
  return process.env.BLOB_READ_WRITE_TOKEN ?? null;
}

function blobNotConfigured() {
  return NextResponse.json(
    { error: "Image uploads are not configured: BLOB_READ_WRITE_TOKEN is missing." },
    { status: 503 },
  );
}

export const POST = withRoute("assets.POST", async (request: NextRequest) => {
  const gate = await gateAgency();
  if (!gate.ok) return gate.response;

  const token = getBlobToken();
  if (!token) return blobNotConfigured();

  const limit = await checkRateLimit(gate.ctx.userId, RATE_LIMIT);
  if (!limit.ok) return rateLimitResponse(limit);

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return badRequest("Expected a `file` field with one image.");

  // Cheap rejection before buffering, then the authoritative check on the bytes
  // we actually hold — `file.size` is only as trustworthy as the client.
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    return badRequest(`Image is larger than ${MAX_IMAGE_UPLOAD_LABEL}.`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) return badRequest("Image is empty.");
  if (bytes.byteLength > MAX_IMAGE_UPLOAD_BYTES) {
    return badRequest(`Image is larger than ${MAX_IMAGE_UPLOAD_LABEL}.`);
  }

  // Content type comes from the bytes. The browser-declared type and the
  // filename extension are both ignored.
  const sniffed = sniffImage(bytes);
  if (!sniffed) {
    return badRequest(`Unsupported file. Upload a ${IMAGE_UPLOAD_TYPES_LABEL} image.`);
  }

  if (sniffed.contentType === "image/svg+xml") {
    const unsafe = findUnsafeSvgContent(bytes);
    if (unsafe) return badRequest(`This SVG contains ${unsafe} and was rejected.`);
  }

  // Random path, so one client's uploads cannot be found by guessing names.
  // `addRandomSuffix` adds a second random segment and removes any chance of a
  // collision rejecting the write.
  const pathname = `${UPLOAD_BLOB_PATH_PREFIX}/${crypto.randomUUID()}.${sniffed.extension}`;

  // Uploads the exact bytes that were validated, not the original File handle.
  const blob = await put(pathname, new Blob([bytes], { type: sniffed.contentType }), {
    access: "public",
    addRandomSuffix: true,
    contentType: sniffed.contentType,
    token,
  });

  return NextResponse.json(
    {
      url: blob.url,
      pathname: blob.pathname,
      contentType: sniffed.contentType,
      size: bytes.byteLength,
    },
    { status: 201 },
  );
});

// DELETE is scoped to our own prefix on purpose. AdPulse now has a dedicated
// Blob store, so this is no longer about protecting another app's files — it is
// about keeping this route from being a general "delete any blob by URL"
// primitive. The check confines a bug or a hostile caller to the files this
// route created, and rejects malformed or off-host URLs before they reach the
// Blob API.
//
// KNOWN LIMITATION — this route does NOT check that a URL is unreferenced.
// Nothing in AdPulse reference-counts uploaded images: the same URL can appear
// in any number of dashboard views, in saved-widget library entries, in
// templates, and inlined verbatim into frozen `reports.view_snapshot` blobs
// that are supposed to render identically forever. Any agency member can delete
// any upload here, and because Blob deletes are idempotent it succeeds silently
// and takes those renders down with it, unrecoverably.
//
// So do not wire this into an edit flow. `ImageUploadField` deliberately never
// calls it — removing or replacing an image only drops the reference and leaves
// an orphan, which is the far cheaper failure. Treat this as a deliberate,
// explicitly-confirmed admin action only. A safe cleanup path would have to
// cross-check every view, template and report snapshot first; see the note in
// the component for the reasoning.
export const DELETE = withRoute("assets.DELETE", async (request: NextRequest) => {
  const gate = await gateAgency();
  if (!gate.ok) return gate.response;

  const token = getBlobToken();
  if (!token) return blobNotConfigured();

  const raw = request.nextUrl.searchParams.get("url");
  if (!raw) return badRequest("A `url` query parameter is required.");

  if (!isAdpulseUploadUrl(raw)) return badRequest("`url` is not an AdPulse upload.");

  // Deleting an already-deleted blob is a no-op, so this stays idempotent.
  await del(raw, { token });
  return NextResponse.json({ success: true });
});
