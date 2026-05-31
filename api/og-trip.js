/**
 * /api/og-trip?from=رام+الله&to=نابلس&price=30&date=الجمعة+5+يونيو&seats=3&driver=خالد
 *
 * Generates a 1200×630 PNG OG image on-the-fly for trip share cards.
 * Uses SVG → sharp (available in Vercel Node runtime).
 * WhatsApp, Telegram, iMessage, Twitter all fetch this URL when the
 * trip link is shared — they cache it by URL so params must be stable.
 *
 * No external dependencies beyond sharp (already in node_modules).
 */

export const config = { runtime: "nodejs" };

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(s, max) {
  const str = String(s || "");
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

export default async function handler(req, res) {
  const { from = "", to = "", price = "", date = "", seats = "", driver = "" } = req.query;

  const fromCity  = esc(truncate(from, 20));
  const toCity    = esc(truncate(to, 20));
  const priceStr  = price ? `₪${esc(price)} للمقعد` : "";
  const dateStr   = esc(truncate(date, 30));
  const seatsStr  = seats ? `${esc(seats)} مقاعد متاحة` : "";
  const driverStr = driver ? `السائق: ${esc(truncate(driver, 20))}` : "";

  const svg = `
<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1a3d2a"/>
      <stop offset="100%" style="stop-color:#2d5a3d"/>
    </linearGradient>
    <filter id="shadow">
      <feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#000" flood-opacity="0.3"/>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bg)"/>

  <!-- Subtle grid pattern -->
  <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
    <path d="M 60 0 L 0 0 0 60" fill="none" stroke="#ffffff" stroke-width="0.3" opacity="0.08"/>
  </pattern>
  <rect width="1200" height="630" fill="url(#grid)"/>

  <!-- Gold accent bar top -->
  <rect x="0" y="0" width="1200" height="8" fill="#c9a227"/>

  <!-- Logo area -->
  <rect x="60" y="50" width="70" height="70" rx="16" fill="#c9a227" filter="url(#shadow)"/>
  <text x="95" y="100" font-family="Arial, sans-serif" font-size="40" font-weight="900"
        fill="#1a3d2a" text-anchor="middle" dominant-baseline="middle">م</text>

  <!-- App name -->
  <text x="148" y="72" font-family="Arial, sans-serif" font-size="22" font-weight="700"
        fill="#ffffff" text-anchor="start">مشوارو</text>
  <text x="148" y="98" font-family="Arial, sans-serif" font-size="14"
        fill="#c9a227" text-anchor="start">رحلتك أسهل، أوفر، وأسرع</text>

  <!-- Palestine flag accent -->
  <text x="1140" y="85" font-family="Arial, sans-serif" font-size="44"
        text-anchor="middle" dominant-baseline="middle">🇵🇸</text>

  <!-- Route card -->
  <rect x="60" y="160" width="1080" height="280" rx="24" fill="#ffffff" fill-opacity="0.08"
        stroke="#c9a227" stroke-width="1.5" stroke-opacity="0.4"/>

  <!-- From city -->
  <text x="120" y="230" font-family="Arial, sans-serif" font-size="15"
        fill="#c9a227" text-anchor="start">من</text>
  <text x="120" y="290" font-family="Arial, sans-serif" font-size="58" font-weight="800"
        fill="#ffffff" text-anchor="start">${fromCity}</text>

  <!-- Arrow -->
  <text x="600" y="290" font-family="Arial, sans-serif" font-size="50"
        fill="#c9a227" text-anchor="middle" dominant-baseline="middle">←</text>

  <!-- To city -->
  <text x="1080" y="230" font-family="Arial, sans-serif" font-size="15"
        fill="#c9a227" text-anchor="end">إلى</text>
  <text x="1080" y="290" font-family="Arial, sans-serif" font-size="58" font-weight="800"
        fill="#ffffff" text-anchor="end">${toCity}</text>

  <!-- Divider -->
  <line x1="120" y1="330" x2="1080" y2="330" stroke="#ffffff" stroke-width="1" stroke-opacity="0.15"/>

  <!-- Trip details row -->
  ${priceStr ? `
  <rect x="120" y="355" width="240" height="54" rx="12" fill="#c9a227"/>
  <text x="240" y="390" font-family="Arial, sans-serif" font-size="22" font-weight="700"
        fill="#1a3d2a" text-anchor="middle" dominant-baseline="middle">${priceStr}</text>
  ` : ""}

  ${dateStr ? `
  <text x="420" y="390" font-family="Arial, sans-serif" font-size="20"
        fill="#ffffff" text-anchor="start" dominant-baseline="middle" fill-opacity="0.9">📅 ${dateStr}</text>
  ` : ""}

  ${seatsStr ? `
  <text x="420" y="418" font-family="Arial, sans-serif" font-size="18"
        fill="#c9a227" text-anchor="start" dominant-baseline="middle">💺 ${seatsStr}</text>
  ` : ""}

  ${driverStr ? `
  <text x="1080" y="390" font-family="Arial, sans-serif" font-size="18"
        fill="#ffffff" text-anchor="end" dominant-baseline="middle" fill-opacity="0.8">👤 ${driverStr}</text>
  ` : ""}

  <!-- Bottom CTA -->
  <rect x="0" y="560" width="1200" height="70" fill="#000000" fill-opacity="0.25"/>
  <text x="600" y="598" font-family="Arial, sans-serif" font-size="22" font-weight="600"
        fill="#ffffff" text-anchor="middle" dominant-baseline="middle">احجز الآن على www.mishwaro.com 🚗</text>
</svg>`;

  try {
    // Try sharp first (available in Vercel)
    const { default: sharp } = await import("sharp");
    const png = await sharp(Buffer.from(svg)).png().toBuffer();

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=3600");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).send(png);
  } catch {
    // sharp not available (e.g. cold start) — serve SVG
    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.status(200).send(svg);
  }
}
