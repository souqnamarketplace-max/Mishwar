/**
 * /api/og-trip — Dynamic OG image for trip share cards
 *
 * Uses @vercel/og (Satori) which handles Arabic text correctly.
 * Fetches the Noto Sans Arabic font from Google Fonts at cold-start,
 * then caches it in the module scope for subsequent requests.
 */

export const config = { runtime: "edge" };

// Font is fetched once and cached in module scope (survives warm invocations)
let fontData = null;

async function getFont() {
  if (fontData) return fontData;
  // Noto Sans Arabic — good Unicode coverage, RTL support, free
  const res = await fetch(
    "https://fonts.gstatic.com/s/notosansarabic/v18/nwpxtLGrOAZMl5nJ_wfgRg3DrWFZWsnVBJ_sS6tlqHHFlhQ5l3sQWIHPqzCfly27.woff"
  );
  if (!res.ok) throw new Error("Font fetch failed: " + res.status);
  fontData = await res.arrayBuffer();
  return fontData;
}

export default async function handler(req) {
  const { ImageResponse } = await import("@vercel/og");

  const { searchParams } = new URL(req.url);
  const from   = searchParams.get("from")   || "";
  const to     = searchParams.get("to")     || "";
  const price  = searchParams.get("price")  || "";
  const date   = searchParams.get("date")   || "";
  const seats  = searchParams.get("seats")  || "";
  const driver = searchParams.get("driver") || "";

  const truncate = (s, n) => s.length > n ? s.slice(0, n - 1) + "…" : s;

  const priceStr  = price  ? `₪${price} للمقعد`               : "";
  const dateStr   = date   ? `📅 ${truncate(date, 30)}`         : "";
  const seatsStr  = seats  ? `💺 ${seats} مقاعد متاحة`         : "";
  const driverStr = driver ? `👤 ${truncate(driver, 20)}`        : "";

  let font;
  try {
    font = await getFont();
  } catch {
    // Font load failed — return a minimal fallback
    font = null;
  }

  const fonts = font ? [{ name: "NotoArabic", data: font, weight: 700, style: "normal" }] : [];

  return new ImageResponse(
    {
      type: "div",
      props: {
        style: {
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "linear-gradient(135deg, #1a3d2a 0%, #2d5a3d 100%)",
          fontFamily: font ? "NotoArabic" : "sans-serif",
          position: "relative",
          overflow: "hidden",
        },
        children: [
          // Gold top bar
          {
            type: "div",
            props: {
              style: { position: "absolute", top: 0, left: 0, right: 0, height: 10, background: "#c9a227" },
            },
          },

          // Header row — logo + app name + flag
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "40px 60px 0",
                direction: "rtl",
              },
              children: [
                // Logo + name
                {
                  type: "div",
                  props: {
                    style: { display: "flex", flexDirection: "row", alignItems: "center", gap: 16 },
                    children: [
                      {
                        type: "div",
                        props: {
                          style: {
                            width: 72, height: 72, borderRadius: 16,
                            background: "#c9a227",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 40, fontWeight: 900, color: "#1a3d2a",
                          },
                          children: "م",
                        },
                      },
                      {
                        type: "div",
                        props: {
                          style: { display: "flex", flexDirection: "column" },
                          children: [
                            { type: "div", props: { style: { color: "#fff", fontSize: 26, fontWeight: 700 }, children: "مشوارو" } },
                            { type: "div", props: { style: { color: "#c9a227", fontSize: 14 }, children: "رحلتك أسهل، أوفر، وأسرع" } },
                          ],
                        },
                      },
                    ],
                  },
                },
                // Palestine flag
                { type: "div", props: { style: { fontSize: 52 }, children: "🇵🇸" } },
              ],
            },
          },

          // Route card
          {
            type: "div",
            props: {
              style: {
                margin: "32px 60px 0",
                background: "rgba(255,255,255,0.07)",
                border: "1.5px solid rgba(201,162,39,0.35)",
                borderRadius: 24,
                padding: "32px 40px",
                display: "flex",
                flexDirection: "column",
                direction: "rtl",
              },
              children: [
                // Cities row
                {
                  type: "div",
                  props: {
                    style: {
                      display: "flex",
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 20,
                    },
                    children: [
                      // From
                      {
                        type: "div",
                        props: {
                          style: { display: "flex", flexDirection: "column" },
                          children: [
                            { type: "div", props: { style: { color: "#c9a227", fontSize: 14, marginBottom: 6 }, children: "من" } },
                            { type: "div", props: { style: { color: "#fff", fontSize: 52, fontWeight: 800, lineHeight: 1 }, children: truncate(from, 14) } },
                          ],
                        },
                      },
                      // Arrow
                      { type: "div", props: { style: { color: "#c9a227", fontSize: 44, margin: "0 20px" }, children: "←" } },
                      // To
                      {
                        type: "div",
                        props: {
                          style: { display: "flex", flexDirection: "column", alignItems: "flex-end" },
                          children: [
                            { type: "div", props: { style: { color: "#c9a227", fontSize: 14, marginBottom: 6 }, children: "إلى" } },
                            { type: "div", props: { style: { color: "#fff", fontSize: 52, fontWeight: 800, lineHeight: 1 }, children: truncate(to, 14) } },
                          ],
                        },
                      },
                    ],
                  },
                },

                // Divider
                { type: "div", props: { style: { height: 1, background: "rgba(255,255,255,0.12)", margin: "0 0 20px" } } },

                // Details row
                {
                  type: "div",
                  props: {
                    style: {
                      display: "flex",
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 16,
                    },
                    children: [
                      // Price pill
                      priceStr ? {
                        type: "div",
                        props: {
                          style: {
                            background: "#c9a227",
                            borderRadius: 12,
                            padding: "10px 24px",
                            color: "#1a3d2a",
                            fontSize: 22,
                            fontWeight: 700,
                          },
                          children: priceStr,
                        },
                      } : null,
                      // Date + seats + driver
                      {
                        type: "div",
                        props: {
                          style: { display: "flex", flexDirection: "column", gap: 4, flex: 1, alignItems: "flex-start" },
                          children: [
                            dateStr   ? { type: "div", props: { style: { color: "rgba(255,255,255,0.85)", fontSize: 18 }, children: dateStr } }   : null,
                            seatsStr  ? { type: "div", props: { style: { color: "#c9a227", fontSize: 16 }, children: seatsStr } }                  : null,
                          ].filter(Boolean),
                        },
                      },
                      driverStr ? { type: "div", props: { style: { color: "rgba(255,255,255,0.75)", fontSize: 17 }, children: driverStr } } : null,
                    ].filter(Boolean),
                  },
                },
              ],
            },
          },

          // Bottom CTA
          {
            type: "div",
            props: {
              style: {
                position: "absolute",
                bottom: 0, left: 0, right: 0,
                background: "rgba(0,0,0,0.28)",
                padding: "18px 60px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontSize: 22,
                fontWeight: 600,
              },
              children: "احجز الآن على www.mishwaro.com 🚗",
            },
          },
        ],
      },
    },
    {
      width: 1200,
      height: 630,
      fonts,
      headers: {
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600",
      },
    }
  );
}
