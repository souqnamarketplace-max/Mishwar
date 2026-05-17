// Chat attachment helpers — image compression, storage upload, geolocation.
//
// All three pieces of this module are pure functions or
// promise-returning utilities. They contain no React state and no
// Supabase realtime concerns; the caller (Messages.jsx send mutation)
// orchestrates upload → message-row insert.
//
// Storage path convention:   {sender_email}/{uuid}.jpg
//   - First folder name is the sender's email — the storage RLS policy
//     (migration 063) requires this so users can only upload to their
//     own folder.
//   - Filename is a UUID for unguessability (the bucket is public on
//     read; obscurity is the only access control on read).

import { supabase } from "@/lib/supabase";

const BUCKET = "chat-attachments";

// ─── Image compression ─────────────────────────────────────────────────
//
// Why client-side compression: phone cameras produce 3-12MB JPEGs.
// Without compression a 5-image conversation thread is 30MB+ for the
// receiver on mobile data. Compressing to ~1920px longest side at
// JPEG quality 0.85 yields ~200-500KB — invisible quality loss in a
// chat bubble, 90%+ bandwidth saved.
//
// Implementation uses HTMLCanvasElement.toBlob — no external dependencies.
// HEIC support: iOS Safari decodes HEIC natively, so drawImage works and
// the canvas re-encodes to JPEG. On Android Chrome HEIC isn't supported
// in canvas → the Image's onerror fires and we throw a friendly error.
//
// MAX_DIMENSION is the longest side of the output. Portrait phone
// photos are typically 3024x4032 — they become 1440x1920 after scale.
// Landscape 4032x3024 → 1920x1440. Either way under our 5MB bucket cap
// with massive headroom.
const MAX_DIMENSION = 1920;
const JPEG_QUALITY  = 0.85;

export async function compressImage(file) {
  if (!file || !(file instanceof File || file instanceof Blob)) {
    throw new Error("compressImage: invalid input");
  }
  // Use createImageBitmap when available — it handles EXIF orientation
  // correctly on every modern browser, where HTMLImageElement does not.
  // Without orientation-aware decoding, iPhone portrait photos appear
  // rotated 90° in the chat. Fall back to HTMLImageElement for very old
  // browsers (Safari < 13) where createImageBitmap is missing.
  let bitmap;
  if (typeof createImageBitmap === "function") {
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Some browsers ignore the options bag and throw — retry without it.
      bitmap = await createImageBitmap(file);
    }
  } else {
    bitmap = await loadViaHtmlImage(file);
  }

  const { width: w0, height: h0 } = bitmap;
  const scale = Math.min(1, MAX_DIMENSION / Math.max(w0, h0));
  const w = Math.round(w0 * scale);
  const h = Math.round(h0 * scale);

  // Use OffscreenCanvas if available — frees up the main-thread canvas
  // and avoids a DOM-paint stall on slow devices. Falls back to a
  // plain canvas everywhere else.
  let canvas;
  if (typeof OffscreenCanvas === "function") {
    canvas = new OffscreenCanvas(w, h);
  } else {
    canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();      // OffscreenCanvas-spec only — null-safe

  // toBlob on a normal canvas; convertToBlob on OffscreenCanvas.
  // Both return a Promise<Blob>.
  const blob = canvas.convertToBlob
    ? await canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY })
    : await new Promise((res, rej) =>
        canvas.toBlob(b => b ? res(b) : rej(new Error("toBlob failed")),
                      "image/jpeg", JPEG_QUALITY));

  return blob;
}

// Fallback decoder for old browsers without createImageBitmap.
// Reads the file via FileReader as a data URL, sets it as <img>.src,
// resolves when the image loads. Doesn't apply EXIF orientation — old
// browsers don't anyway.
function loadViaHtmlImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not decode image")); };
    img.src = url;
  });
}

// ─── Storage upload ────────────────────────────────────────────────────
//
// Returns { url, path } where:
//   - url:  publicly-fetchable URL to drop into <img src>
//   - path: bucket-relative path stored in messages.attachment_path for
//           future moderation cleanup
//
// Caller responsibilities (NOT this function's):
//   - Compress the blob first
//   - Insert the messages row after upload succeeds
//   - On insert failure, call deleteAttachment(path) to clean up orphan
//
// RLS contract: the path must start with senderEmail or storage rejects
// the INSERT. We construct the path here so callers can't accidentally
// pass a wrong email.
export async function uploadAttachment(blob, senderEmail) {
  if (!blob) throw new Error("uploadAttachment: blob required");
  if (!senderEmail) throw new Error("uploadAttachment: senderEmail required");

  const uuid = crypto.randomUUID();
  const path = `${senderEmail}/${uuid}.jpg`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, {
      contentType: "image/jpeg",
      cacheControl: "31536000",   // 1y — files are immutable (UUID names)
      upsert: false,              // never overwrite — UUID collisions are
                                  //   effectively impossible, and upsert
                                  //   would hide bugs that produce them
    });
  if (error) {
    // Surface a friendly error for the most common failure mode (RLS
    // mismatch) without leaking implementation details to users.
    if (/row-level security|policy/i.test(error.message)) {
      throw new Error("uploadAttachment: permission denied (check sign-in)");
    }
    throw error;
  }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: pub.publicUrl, path };
}

// Best-effort cleanup — used when the message-row insert fails after a
// successful upload. We don't want orphaned storage objects polluting
// the bucket if Supabase REST drops the insert. Silent on failure
// because the error path here is already an error path.
export async function deleteAttachment(path) {
  if (!path) return;
  try {
    await supabase.storage.from(BUCKET).remove([path]);
  } catch {
    // Already in a failure path — log to console for debugging but
    // don't escalate. The bucket has unlimited storage cap and a
    // few orphan KB-size objects don't move the needle on cost.
    console.warn("deleteAttachment cleanup failed for", path);
  }
}

// ─── Geolocation ──────────────────────────────────────────────────────
//
// Wraps navigator.geolocation in a promise with sane defaults and
// human-friendly error messages.
//
// enableHighAccuracy:true asks the device for GPS rather than IP-based
// geolocation. On phones this triggers GPS chip activation (fine for
// a one-shot read; ~3-5s delay on cold start). On desktop it does
// nothing different from the default.
//
// timeout:10000 — fail after 10s. Users with poor GPS signal indoors
// get a useful error rather than infinite spinner.
//
// maximumAge:30000 — accept a cached reading up to 30s old. Reduces
// wait when the user shares two locations back-to-back.
//
// Errors are normalized to readable strings in Arabic for direct toast
// display.
export async function getCurrentLocation() {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    throw new Error("الجهاز لا يدعم خاصية الموقع");
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        latitude:  pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy:  pos.coords.accuracy,    // metres
      }),
      (err) => {
        // PositionError codes: 1=permission denied, 2=position unavailable, 3=timeout
        const msg =
          err.code === 1 ? "لم تسمح بالوصول للموقع — فعّل من إعدادات النظام" :
          err.code === 2 ? "تعذر تحديد الموقع — تحقق من إشارة GPS" :
          err.code === 3 ? "استغرق تحديد الموقع وقتاً طويلاً — حاول مجدداً" :
          "فشل تحديد الموقع";
        reject(new Error(msg));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  });
}

// ─── Maps deep-link ────────────────────────────────────────────────────
//
// Cross-platform "open in maps" URL. Google Maps' query parameter
// format works on:
//   - Desktop browsers (loads in google.com)
//   - iOS Safari + WKWebView (offers Open in Maps / Google Maps)
//   - Android Chrome (offers Open in Maps app)
// We avoid platform-specific schemes like geo:// or maps:// because
// they fail silently on the other platform.
export function buildMapsUrl(latitude, longitude) {
  if (latitude == null || longitude == null) return null;
  // ~6 decimal places = 11cm precision — matches the NUMERIC(9,6)
  // database column. toFixed avoids scientific notation for very
  // small lat values near the equator (unlikely here, but defensive).
  const lat = Number(latitude).toFixed(6);
  const lng = Number(longitude).toFixed(6);
  return `https://www.google.com/maps?q=${lat},${lng}`;
}
