# Mishwar — Branded Email Templates

Custom HTML templates that replace Supabase's default plain-text auth emails.
Designed in the Mishwar brand (forest green `#1a3d2a`, gold `#c9a227`,
cream `#faf5e6`) with bulletproof email HTML — works in Gmail, Outlook,
Apple Mail, Yahoo, and ProtonMail.

## Files

| File | Apply to template |
|---|---|
| `01-confirm-signup.html` | Authentication → Email Templates → **Confirm signup** |
| `02-reset-password.html` | Authentication → Email Templates → **Reset Password** |

## How to apply

1. Go to https://supabase.com/dashboard/project/dimtdwahtwaslmnuakij/auth/templates
2. Pick the template you want to update from the dropdown (e.g. "Confirm
   signup")
3. **Subject** field — set it manually (Supabase doesn't pull subject
   from the HTML body):
   - Confirm signup:  `أكّد بريدك الإلكتروني — مِشوار`
   - Reset password:  `إعادة تعيين كلمة المرور — مِشوار`
4. **Message body** — open the corresponding `.html` file in this folder,
   copy the entire contents, paste into the body field
5. Click **Save**

The template variables (`{{ .ConfirmationURL }}` and similar) are
filled in by Supabase at send time — leave them as-is in the HTML.

## What's in each template

### 01-confirm-signup.html

- Welcome message in Arabic
- Forest-green CTA button: "تأكيد البريد الإلكتروني"
- Plain URL fallback for accessibility / non-clickable clients
- **Spam-folder hint** that nudges users to move the email to inbox so
  future notifications land properly. This is critical for the
  Palestinian-Gmail delivery issue we documented in
  `docs/audits/2026-05-05-pre-launch-audit.md` — many first-time
  confirmations get routed to spam, and once a user marks it as "not
  spam," subsequent emails from the same sender get delivered to inbox.
- "If you didn't request this" note in the footer

### 02-reset-password.html

- Security-tinted icon (red border, lock emoji)
- Forest-green CTA button: "إعادة تعيين كلمة المرور"
- 1-hour expiry warning (matches Supabase default)
- Plain URL fallback
- **Security warning panel** — red-tinted box explaining what to do if
  the user didn't request a reset. Matches password-reset best
  practices for transactional emails.
- **Password requirements panel** — lists the 4 rules from
  `validatePasswordCompliance()` so users can prepare a compliant
  password before clicking the reset link

## Design tokens used

These match the in-app design system:

| Token | Value | Where used |
|---|---|---|
| `--brand-primary` | `#1a3d2a` (forest green) | Header, button, headings |
| `--brand-accent` | `#c9a227` (gold) | Tagline below logo |
| `--brand-bg` | `#faf5e6` (cream) | Page background, info panels |
| `--brand-card` | `#ffffff` | Email card |
| `--brand-border` | `#e8e2d0` (warm beige) | Card border |
| Security accent | `#fef2f2` / `#fecaca` (red-50/200) | Reset-password icon, warning panel |
| Hint accent | `#fef9e7` / `#f9e79f` (amber-50/200) | Spam-folder hint |

## Email-client compatibility

All design choices favor maximum compatibility:

- **Tables for layout** — divs/flexbox/grid don't work in Outlook or
  many corporate webmail clients. Every layout block uses
  `<table role="presentation">`.
- **Inline styles only** — `<style>` blocks are stripped by Gmail and
  several other clients. All CSS lives in `style="..."` attributes.
- **VML fallback for Outlook button** — the `<!--[if mso]>` block
  renders the CTA as a VML `<v:roundrect>` in Outlook so the rounded
  corners and centered text work correctly there too.
- **`mso-padding-alt:0`** — disables Outlook's auto-added padding on
  inline-block buttons.
- **Web-safe font stack** — `-apple-system, BlinkMacSystemFont, Segoe
  UI, Tahoma, Arial, sans-serif`. No custom font loading, which would
  fail in many clients and trigger spam filters.
- **`color-scheme: light only`** — explicitly opts out of dark-mode
  auto-inversion in iOS Mail / Outlook for Windows that would otherwise
  invert the brand green to a muddy yellow.
- **Preheader** — hidden text at the top of the body that shows up in
  inbox previews. Sets expectations before the user opens the email.
- **Plain URL below the button** — accessibility + clients that block
  links + a fallback when the button doesn't render.
- **Direction control** — `dir="rtl"` on body + every text-bearing
  cell, `direction:ltr` only on the URL fallback so the long URL
  doesn't get reversed.
- **Word-break on URL** — long URLs break across lines instead of
  overflowing the card on narrow screens.
- **560px max width** — fits the standard 600px email width while
  giving 20px of side padding on most clients.

## Testing checklist before saving

After pasting the HTML into Supabase:

1. Click "Send test" in the Supabase dashboard — sends to your admin
   email so you can verify rendering.
2. Open the test email in:
   - Gmail web (renders well in 99% of cases)
   - Gmail mobile app
   - Apple Mail (iOS or macOS)
3. Verify:
   - Brand colors render correctly (forest green header, not brown)
   - The CTA button is clickable and goes to the right URL
   - Arabic text reads right-to-left properly
   - The spam-folder hint shows in amber, not white-on-white
   - On mobile, the card scales to fit the screen (no horizontal scroll)
4. Click the CTA in the test email — it should land on
   `https://mishwar-nu.vercel.app/login` with the appropriate auth flow

## Troubleshooting

**"The button is misaligned in Outlook"**
The VML fallback handles this. Make sure you copied the entire HTML
including the `<!--[if mso]>` and `<!--[if !mso]><!-- -->` comments —
they look like junk but are required for Outlook.

**"Arabic text is left-aligned"**
Check that `dir="rtl"` is on both the `<html>` tag and the body cells.
Some Supabase template editors strip the `<html>` tag — if that
happens, add `dir="rtl"` to every text-bearing `<td>` (already done in
the templates here).

**"Brand colors look wrong in dark mode"**
The `color-scheme: light only` meta tag should prevent this. If a
client ignores it (older Outlook), the user will see a slightly
adjusted color but everything stays readable.

**"The link in plain-text fallback wraps mid-character"**
This is a `word-break: break-all` artifact and is intentional — without
it, a long URL would overflow the email card on narrow phones. Users
on iOS Mail can still tap the visible portion to open.

## When to re-send (or re-design)

- **Custom SMTP setup** (when you get a domain): Once you switch to a
  custom domain via Resend/Postmark, the templates work exactly the
  same — Supabase passes the same template variables regardless of
  delivery provider.
- **Brand updates**: If brand colors change, update the design tokens
  table above and search/replace `#1a3d2a` etc. in both `.html` files.
- **New auth flows**: If you add a "magic link" or "phone OTP" flow
  later, copy `01-confirm-signup.html` as a starting point and adjust
  the copy + icon. The structure and styles transfer directly.
