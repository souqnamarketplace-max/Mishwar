"""
Generates the two static Open Graph preview images for مِشوار:

  public/og-image.png            — used when sharing the homepage URL
                                   (e.g. https://mishwar-nu.vercel.app/)
  public/og-trip-placeholder.png — used as the og:image for /trip/:id pages.
                                   The trip's own *text* (title, route, price)
                                   is injected as og:title / og:description by
                                   api/trip.js — so this image only carries
                                   the brand frame; we don't try to bake the
                                   per-trip text into the bitmap.

Why this script exists:
  The previous og-image.png was a near-black 230 KB blob — it loaded fine in
  WhatsApp/Twitter previews but rendered as a solid dark rectangle next to
  the title, making the cards look broken. This script replaces it with a
  branded 1200×630 image that uses the app's primary green (#2d6a4f), a
  Palestinian-flag accent ribbon, and shaped Arabic text via
  arabic-reshaper + python-bidi (Pillow's basic text engine doesn't do
  bidi or letter joining on its own).

Run from repo root:  python3 scripts/generate-og-images.py
"""

import os
from PIL import Image, ImageDraw, ImageFilter
from PIL import ImageFont
import arabic_reshaper
from bidi.algorithm import get_display

# ── Constants ────────────────────────────────────────────────────────────────

W, H = 1200, 630                                    # OG standard
PRIMARY_GREEN = "#2d6a4f"                           # theme.color from index.html
PRIMARY_DARK  = "#1b3a2c"
CREAM         = "#f8f5ec"
GOLD          = "#d4a574"

# Palestinian flag stripes
FLAG_BLACK = "#000000"
FLAG_WHITE = "#ffffff"
FLAG_GREEN = "#1c8742"
FLAG_RED   = "#e3262f"

FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REG  = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


# ── Helpers ──────────────────────────────────────────────────────────────────

def ar(text):
    """Reshape Arabic text for correct rendering with a non-shaping engine."""
    return get_display(arabic_reshaper.reshape(text))


def draw_centered(draw, xy, text, font, fill):
    """Draw text horizontally centered around xy=(cx, top)."""
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    cx, y = xy
    draw.text((cx - tw / 2, y), text, font=font, fill=fill)


def vertical_gradient(size, top_color, bottom_color):
    """Solid vertical gradient between two hex colors."""
    w, h = size
    base = Image.new("RGB", (1, h))
    px = base.load()
    t = tuple(int(top_color.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
    b = tuple(int(bottom_color.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
    for y in range(h):
        ratio = y / max(h - 1, 1)
        px[0, y] = tuple(int(t[i] + (b[i] - t[i]) * ratio) for i in range(3))
    return base.resize((w, h))


def soft_dot_pattern(size, color="#ffffff", spacing=42, radius=2, opacity=22):
    """A subtle dotted overlay so the gradient doesn't look flat."""
    w, h = size
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    rgb = tuple(int(color.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
    for y in range(0, h, spacing):
        offset = (spacing // 2) if (y // spacing) % 2 else 0
        for x in range(offset, w, spacing):
            draw.ellipse([x - radius, y - radius, x + radius, y + radius],
                         fill=rgb + (opacity,))
    return layer


def flag_ribbon(size, x, y, w, h):
    """A small Palestinian-flag rectangle: black/white/green stripes + red triangle."""
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    stripe_h = h // 3
    d.rectangle([x, y,                  x + w, y + stripe_h],     fill=FLAG_BLACK)
    d.rectangle([x, y + stripe_h,       x + w, y + 2 * stripe_h], fill=FLAG_WHITE)
    d.rectangle([x, y + 2 * stripe_h,   x + w, y + h],            fill=FLAG_GREEN)
    tri_w = int(w * 0.32)
    d.polygon([(x, y), (x + tri_w, y + h // 2), (x, y + h)], fill=FLAG_RED)
    return layer


def build_base_canvas():
    """Shared visual layer: gradient + dot pattern + footer ribbon."""
    bg = vertical_gradient((W, H), PRIMARY_GREEN, PRIMARY_DARK)
    canvas = bg.convert("RGBA")
    canvas = Image.alpha_composite(canvas, soft_dot_pattern((W, H)))

    # Bottom flag ribbon — small, at the bottom-right
    flag = flag_ribbon((W, H), W - 220, H - 70, 180, 40)
    canvas = Image.alpha_composite(canvas, flag)

    # Top-left logo dot — a green/gold M mark in a circle
    mark = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    md = ImageDraw.Draw(mark)
    cx, cy, r = 80, 80, 38
    md.ellipse([cx - r, cy - r, cx + r, cy + r], fill=GOLD)
    md.ellipse([cx - r + 6, cy - r + 6, cx + r - 6, cy + r - 6], fill=PRIMARY_DARK)
    f_m = ImageFont.truetype(FONT_BOLD, 42)
    md.text((cx - 14, cy - 26), "M", font=f_m, fill=GOLD)
    canvas = Image.alpha_composite(canvas, mark)

    return canvas


def draw_car_icon(canvas, cx, cy, scale=1.0, color=GOLD):
    """A small stylised car silhouette drawn with rectangles + ellipses, since
    the bundled fonts don't include emoji glyphs and we don't want a box where
    a 🚗 character would have gone."""
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    s = scale
    # Body
    body = [cx - 70 * s, cy - 18 * s, cx + 70 * s, cy + 18 * s]
    d.rounded_rectangle(body, radius=int(14 * s), fill=color)
    # Roof / cabin
    cabin = [cx - 42 * s, cy - 38 * s, cx + 38 * s, cy - 12 * s]
    d.rounded_rectangle(cabin, radius=int(10 * s), fill=color)
    # Windows
    win_l = [cx - 38 * s, cy - 34 * s, cx - 6 * s,  cy - 14 * s]
    win_r = [cx - 2 * s,  cy - 34 * s, cx + 34 * s, cy - 14 * s]
    d.rectangle(win_l, fill=PRIMARY_DARK)
    d.rectangle(win_r, fill=PRIMARY_DARK)
    # Wheels
    wr = int(11 * s)
    d.ellipse([cx - 50 * s - wr, cy + 14 * s - wr, cx - 50 * s + wr, cy + 14 * s + wr], fill=PRIMARY_DARK)
    d.ellipse([cx - 50 * s - wr + 3, cy + 14 * s - wr + 3, cx - 50 * s + wr - 3, cy + 14 * s + wr - 3], fill=color)
    d.ellipse([cx + 50 * s - wr, cy + 14 * s - wr, cx + 50 * s + wr, cy + 14 * s + wr], fill=PRIMARY_DARK)
    d.ellipse([cx + 50 * s - wr + 3, cy + 14 * s - wr + 3, cx + 50 * s + wr - 3, cy + 14 * s + wr - 3], fill=color)
    return Image.alpha_composite(canvas, layer)


# ── Image 1: homepage og-image.png ───────────────────────────────────────────

def build_homepage_image():
    canvas = build_base_canvas()
    d = ImageDraw.Draw(canvas)

    # Big Arabic brand name. Drop the kasra diacritic ("مِشوار" → "مشوار") so
    # it renders cleanly in DejaVu — the diacritic mark falls off the bundled
    # font's glyph table and shows as a tofu box otherwise.
    f_brand   = ImageFont.truetype(FONT_BOLD, 200)
    f_tagline = ImageFont.truetype(FONT_BOLD, 60)
    f_sub     = ImageFont.truetype(FONT_REG,  42)

    draw_centered(d, (W // 2, 140), ar("مشوار"), f_brand, CREAM)
    draw_centered(d, (W // 2, 380), ar("شارك الطريق، وفر أكثر"), f_tagline, GOLD)
    draw_centered(d, (W // 2, 470), ar("منصة فلسطينية لمشاركة رحلات السيارة"),
                  f_sub, CREAM)

    # Bottom-left URL hint
    f_url = ImageFont.truetype(FONT_REG, 28)
    d.text((40, H - 60), "mishwar-nu.vercel.app", font=f_url, fill=CREAM)

    # Bottom-right "made in Palestine" tag — text only; the flag itself is
    # already drawn as a vector ribbon to the right of this text.
    f_pal = ImageFont.truetype(FONT_BOLD, 28)
    d.text((W - 470, H - 56), ar("صُنع في فلسطين"), font=f_pal, fill=CREAM)

    return canvas.convert("RGB")


# ── Image 2: trip placeholder ────────────────────────────────────────────────

def build_trip_image():
    """The image shown alongside dynamic per-trip metadata.

    The actual trip route/price/date arrives in og:title and og:description
    from api/trip.js, so the picture itself just frames the brand and signals
    that this is a trip card.
    """
    canvas = build_base_canvas()
    d = ImageDraw.Draw(canvas)

    f_brand   = ImageFont.truetype(FONT_BOLD, 110)
    f_main    = ImageFont.truetype(FONT_BOLD, 90)
    f_sub     = ImageFont.truetype(FONT_REG,  46)
    f_cta     = ImageFont.truetype(FONT_BOLD, 38)

    # Brand smaller, top center
    draw_centered(d, (W // 2, 70), ar("مشوار"), f_brand, CREAM)

    # Big "trip" heading — vector car icon to the right (RTL reading order),
    # not an emoji, since DejaVu has no emoji glyphs.
    main_text = ar("رحلة جديدة")
    main_bbox = d.textbbox((0, 0), main_text, font=f_main)
    tw = main_bbox[2] - main_bbox[0]
    text_y = 230
    d.text(((W - tw) // 2, text_y), main_text, font=f_main, fill=GOLD)
    canvas = draw_car_icon(canvas,
                           cx=(W - tw) // 2 - 110,
                           cy=text_y + (main_bbox[3] - main_bbox[1]) // 2,
                           scale=1.2, color=GOLD)
    d = ImageDraw.Draw(canvas)  # rebind after composite

    # Tagline
    draw_centered(d, (W // 2, 360), ar("شاركني الطريق ووفر معي"), f_sub, CREAM)

    # CTA pill
    pill_w, pill_h = 380, 76
    px = (W - pill_w) // 2
    py = 460
    d.rounded_rectangle([px, py, px + pill_w, py + pill_h], radius=38, fill=GOLD)
    bbox = d.textbbox((0, 0), ar("احجز مقعدك الآن"), font=f_cta)
    tw = bbox[2] - bbox[0]
    d.text((px + (pill_w - tw) // 2, py + 14),
           ar("احجز مقعدك الآن"), font=f_cta, fill=PRIMARY_DARK)

    # Bottom-left URL hint
    f_url = ImageFont.truetype(FONT_REG, 28)
    d.text((40, H - 60), "mishwar-nu.vercel.app", font=f_url, fill=CREAM)

    return canvas.convert("RGB")


# ── Render & save ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    out_dir = os.path.join(os.path.dirname(__file__), "..", "public")
    out_dir = os.path.abspath(out_dir)
    os.makedirs(out_dir, exist_ok=True)

    homepage_path = os.path.join(out_dir, "og-image.png")
    trip_path     = os.path.join(out_dir, "og-trip-placeholder.png")

    build_homepage_image().save(homepage_path, optimize=True)
    print(f"wrote {homepage_path} ({os.path.getsize(homepage_path)} bytes)")

    build_trip_image().save(trip_path, optimize=True)
    print(f"wrote {trip_path} ({os.path.getsize(trip_path)} bytes)")
