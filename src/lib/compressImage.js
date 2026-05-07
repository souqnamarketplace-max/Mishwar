/**
 * compressImage — downscale + recompress a File on the client before
 * upload. Cuts upload time dramatically on mobile networks where
 * 8 MB straight-from-camera photos can take 30-60 seconds to send
 * but the recipient (admin reviewing KYC) only needs ~1500px wide.
 *
 * Returns a new File. If the input is already smaller than maxBytes
 * AND its longest edge is already below maxEdge, returns it unchanged.
 *
 * PDF/non-image inputs pass through untouched — we only compress
 * images.
 *
 * Why not browser-image-compression npm package? Adds ~30 KB to the
 * bundle for what's a 40-line job. Canvas API is universally
 * supported on every browser we care about (iOS Safari 13+, modern
 * Chrome, modern Firefox).
 */
export async function compressImage(file, {
  maxEdge = 1800,        // longest edge in pixels — KYC docs need to be readable
  maxBytes = 800 * 1024, // 800 KB target — safe ceiling for slow 3G
  mimeType = "image/jpeg",
  quality = 0.82,
} = {}) {
  if (!file) return null;

  // Pass-through for non-images (PDFs, etc) — can't canvas-compress
  // those and they're usually already reasonable size.
  if (!file.type.startsWith("image/")) return file;

  // Already small enough on both axes? Skip the work.
  if (file.size <= maxBytes) {
    // Still might want to downscale a huge but well-compressed image,
    // but if it's already small, ship it.
    return file;
  }

  // Decode the image off the file
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });

  // Compute target dimensions preserving aspect ratio
  let { width, height } = img;
  if (width > maxEdge || height > maxEdge) {
    const ratio = width > height ? maxEdge / width : maxEdge / height;
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  // Render to canvas at target size
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  // Encode and convert back to a File
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, mimeType, quality)
  );
  if (!blob) return file; // canvas couldn't encode — fall back to original

  // Iterate quality down if still over budget — handles edge case of
  // very high-detail photos that don't shrink at first pass
  let finalBlob = blob;
  let q = quality;
  while (finalBlob.size > maxBytes && q > 0.5) {
    q -= 0.1;
    finalBlob = await new Promise((resolve) =>
      canvas.toBlob(resolve, mimeType, q)
    );
    if (!finalBlob) { finalBlob = blob; break; }
  }

  // Build a File so name + lastModified are preserved
  const newName = file.name.replace(/\.(png|webp|heic|heif|gif|bmp)$/i, ".jpg");
  return new File([finalBlob], newName, {
    type: mimeType,
    lastModified: file.lastModified || Date.now(),
  });
}
