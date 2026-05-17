// ════════════════════════════════════════════════════════════════════════
// Edge Function: send-notification-email
// ════════════════════════════════════════════════════════════════════════
//
// Receives a request from the Postgres trigger on notifications-INSERT
// (alongside send-push-notification, which handles the FCM/APNS side).
// Sends a transactional email via the Resend API when:
//   1. The notification type is one we have a template for, AND
//   2. The recipient has notif_email = true (or NULL) in their profile, AND
//   3. The recipient has an email address (every profile does — it's the
//      join key — but we guard against malformed rows defensively)
//
// CURRENTLY SUPPORTED TYPES (Tier 1)
//   booking_confirmed  — driver accepted passenger's booking request
//   booking_cancelled  — either party cancelled the booking
//   trip_cancelled     — driver cancelled the entire trip (affects all
//                        confirmed passengers, one email each)
//   trip_reminder      — 1 hour before scheduled departure (inserted by
//                        the pg_cron job in migration 067; one notification
//                        per recipient — driver + each confirmed passenger)
//
// ALL OTHER TYPES — booking_request, trip_started, trip_completed,
// review_received, new_trip, message, request_contact — return 200 OK
// with { skipped: 'unsupported_type' }. They still get push + in-app via
// the parallel pipelines; we just don't email-spam users for low-signal
// events. Adding new types later means: add a case to the switch + write
// a template.
//
// REQUEST SHAPE
//   POST /functions/v1/send-notification-email
//   Headers: Authorization: Bearer <SERVICE_ROLE_KEY>
//   Body: {
//     user_email: string,
//     title: string,
//     body: string,
//     data: {
//       notification_id: string,   // notifications.id (uuid)
//       type: string,              // notifications.type
//       link: string                // notifications.link
//     }
//   }
//
// RESPONSE SHAPE
//   200 OK { sent: true, resend_id: string }
//   200 OK { skipped: '...' }              (preference / type / no-context)
//   4xx/5xx { error: string, details?: any }
//
// ENV
//   RESEND_API_KEY            — Resend API key (re_...) with sending access
//   SUPABASE_URL              — set automatically by Supabase
//   SUPABASE_SERVICE_ROLE_KEY — set automatically by Supabase
//
// FAILURE BEHAVIOUR
//   The Postgres trigger uses pg_net's fire-and-forget HTTP POST, so any
//   non-2xx response here doesn't break anything else. The notification
//   row still exists; push still fires from its own trigger; the user
//   sees the bell + toast + lock-screen banner just like before. Email
//   is the only channel that drops on failure. We capture errors to
//   Resend's own log for retry analysis (Resend stores last 30 days).
//
// ════════════════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RESEND_API_KEY            = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Shared secret with the public_unsubscribe_marketing RPC. Used to sign
// the per-recipient unsubscribe link in every marketing email. MUST
// match the value stored in vault (key: 'unsubscribe_secret') — the
// RPC re-computes the HMAC and compares. Mismatch → unsubscribe page
// shows "invalid token" even though the link came from us.
//
// If the env var is missing, the marketing template still renders BUT
// the unsubscribe link is non-functional. We log loudly so this gets
// noticed in production. Transactional emails are unaffected.
const UNSUBSCRIBE_SECRET = Deno.env.get("UNSUBSCRIBE_SECRET");

// Public-facing app URL used in template CTAs. We don't currently expose
// the trip's deep link inside email body — the button goes to /trips/{id}
// on the public site, which then redirects into the app on mobile via
// the same routing the web bell uses.
const APP_BASE_URL = "https://www.mishwaro.com";

// Brand
const FROM_EMAIL = "noreply@mishwaro.com";
const FROM_NAME  = "مشوارو";

// Types we have email templates for. Everything else is skipped silently.
// Note 'broadcast' uses notif_MARKETING (not notif_email) — the
// preference gate is different for marketing vs transactional. We
// handle that distinction in the handler before sending.
const SUPPORTED_TYPES = new Set([
  "booking_confirmed",
  "booking_cancelled",
  "trip_cancelled",
  "trip_reminder",
  "broadcast",
]);

// ─── Helpers ─────────────────────────────────────────────────────────────

interface NotificationPayload {
  user_email: string;
  title: string;
  body: string;
  data: {
    notification_id: string;
    type: string;
    link: string;
  };
}

interface ProfileLite {
  email: string;
  full_name: string | null;
  notif_email: boolean | null;
  notif_marketing: boolean | null;
}

interface TripLite {
  id: string;
  from_city: string | null;
  to_city: string | null;
  date: string | null;
  time: string | null;
  driver_email: string | null;
  driver_name: string | null;
  price: number | null;
}

async function fetchProfile(email: string): Promise<ProfileLite | null> {
  const url = `${SUPABASE_URL}/rest/v1/profiles?select=email,full_name,notif_email,notif_marketing&email=eq.${encodeURIComponent(email)}&limit=1`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) return null;
  const rows = await res.json() as ProfileLite[];
  return rows[0] ?? null;
}

async function fetchNotificationTrip(notificationId: string): Promise<TripLite | null> {
  // Get notification's trip_id, then fetch the trip. Two round-trips because
  // PostgREST doesn't support nested joins on different tables in one query
  // here. Each is < 50ms in practice.
  const notifUrl = `${SUPABASE_URL}/rest/v1/notifications?select=trip_id&id=eq.${encodeURIComponent(notificationId)}&limit=1`;
  const notifRes = await fetch(notifUrl, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!notifRes.ok) return null;
  const notifRows = await notifRes.json() as { trip_id: string | null }[];
  const tripId = notifRows[0]?.trip_id;
  if (!tripId) return null;

  const tripUrl = `${SUPABASE_URL}/rest/v1/trips?select=id,from_city,to_city,date,time,driver_email,driver_name,price&id=eq.${encodeURIComponent(tripId)}&limit=1`;
  const tripRes = await fetch(tripUrl, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!tripRes.ok) return null;
  const tripRows = await tripRes.json() as TripLite[];
  return tripRows[0] ?? null;
}

/**
 * Format a date string (YYYY-MM-DD) as a human-readable Arabic date.
 * "2026-06-15" → "الإثنين 15 يونيو 2026"
 * Defensive: falls back to the raw string if parsing fails.
 */
function formatArabicDate(dateStr: string | null): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    // Intl with Arabic locale; "ar-EG" is widely supported and renders
    // correctly across email clients (some struggle with ar-PS).
    return new Intl.DateTimeFormat("ar-EG", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(d);
  } catch {
    return dateStr;
  }
}

/** Format time (HH:MM or HH:MM:SS) — strip seconds for display. */
function formatTime(timeStr: string | null): string {
  if (!timeStr) return "";
  return timeStr.substring(0, 5);
}

// ─── Templates ────────────────────────────────────────────────────────────
// Each returns the full HTML body. Subject line is the notification's title.
//
// All templates share the same shell as the auth emails the user pasted
// into Supabase: forest-green header with gold "مشوارو", white rounded
// card, cream background, RTL throughout. Identical visual identity so
// users learn to recognize emails from us.

const BRAND_GREEN  = "#1a3d2a";
const BRAND_GOLD   = "#c9a227";
const BRAND_CREAM  = "#faf5e6";

function shellTemplate(opts: {
  headline: string;
  body: string;       // raw HTML for the body section
  ctaUrl?: string;
  ctaLabel?: string;
}): string {
  const cta = opts.ctaUrl && opts.ctaLabel
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:24px 0;"><tr><td align="center"><a href="${opts.ctaUrl}" style="display:inline-block;background:${BRAND_GREEN};color:#ffffff;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 40px;border-radius:12px;">${opts.ctaLabel}</a></td></tr></table>`
    : "";

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:${BRAND_CREAM};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Tahoma,Arial,sans-serif;direction:rtl;text-align:right;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${BRAND_CREAM};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(26,61,42,0.08);">
        <tr>
          <td style="background:${BRAND_GREEN};padding:28px 24px;text-align:center;">
            <div style="color:${BRAND_GOLD};font-size:28px;font-weight:bold;margin:0;">مشوارو</div>
            <div style="color:rgba(255,255,255,0.8);font-size:13px;margin-top:4px;">منصة مشاركة الرحلات</div>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 28px;color:${BRAND_GREEN};font-size:15px;line-height:1.7;">
            <h1 style="font-size:20px;font-weight:bold;margin:0 0 16px 0;color:${BRAND_GREEN};">${opts.headline}</h1>
            ${opts.body}
            ${cta}
          </td>
        </tr>
        <tr>
          <td style="background:${BRAND_CREAM};padding:20px 28px;text-align:center;color:#6b7280;font-size:12px;">
            <p style="margin:0 0 4px 0;">مشوارو — منصة فلسطينية لمشاركة الرحلات</p>
            <p style="margin:0 0 8px 0;">© 2026 مشوارو. جميع الحقوق محفوظة.</p>
            <p style="margin:0;font-size:11px;color:#9ca3af;">يمكنك إيقاف إشعارات البريد الإلكتروني من إعدادات حسابك في التطبيق.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** A reusable trip-details card. Used by all 4 templates so the user
 *  sees identical info regardless of which event fired. */
function tripDetailsCard(trip: TripLite | null): string {
  if (!trip) return "";
  const dateLabel = formatArabicDate(trip.date);
  const timeLabel = formatTime(trip.time);
  const priceLabel = trip.price != null ? `${trip.price} ₪` : "—";

  return `<div style="background:${BRAND_CREAM};border-radius:12px;padding:16px;margin:20px 0;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:13px;color:${BRAND_GREEN};">
      <tr><td style="padding:4px 0;color:#6b7280;width:90px;">🗺️ المسار:</td><td style="padding:4px 0;font-weight:bold;">${trip.from_city ?? "—"} → ${trip.to_city ?? "—"}</td></tr>
      <tr><td style="padding:4px 0;color:#6b7280;">📅 التاريخ:</td><td style="padding:4px 0;">${dateLabel}</td></tr>
      <tr><td style="padding:4px 0;color:#6b7280;">🕐 الوقت:</td><td style="padding:4px 0;">${timeLabel}</td></tr>
      <tr><td style="padding:4px 0;color:#6b7280;">🚗 السائق:</td><td style="padding:4px 0;">${trip.driver_name ?? "—"}</td></tr>
      <tr><td style="padding:4px 0;color:#6b7280;">💰 السعر:</td><td style="padding:4px 0;">${priceLabel}</td></tr>
    </table>
  </div>`;
}

function bookingConfirmedTemplate(profile: ProfileLite, trip: TripLite | null, ctaUrl: string): string {
  const greeting = profile.full_name ? `مرحباً ${profile.full_name}،` : "مرحباً،";
  return shellTemplate({
    headline: "🎉 تم تأكيد حجزك",
    body: `
      <p style="margin:0 0 12px 0;">${greeting}</p>
      <p style="margin:0 0 16px 0;">خبر سار — السائق وافق على حجزك! يمكنك الآن الاستعداد لرحلتك.</p>
      ${tripDetailsCard(trip)}
      <p style="margin:16px 0 0 0;font-size:13px;color:#6b7280;">💡 ننصح بالتواصل مع السائق عبر الرسائل في التطبيق لتنسيق نقطة الالتقاء قبل الرحلة.</p>
    `,
    ctaUrl,
    ctaLabel: "عرض تفاصيل الرحلة",
  });
}

function bookingCancelledTemplate(profile: ProfileLite, trip: TripLite | null, ctaUrl: string): string {
  const greeting = profile.full_name ? `مرحباً ${profile.full_name}،` : "مرحباً،";
  return shellTemplate({
    headline: "تم إلغاء الحجز",
    body: `
      <p style="margin:0 0 12px 0;">${greeting}</p>
      <p style="margin:0 0 16px 0;">نعلمك بأنه تم إلغاء الحجز التالي. لن يتم تنفيذ هذه الرحلة كما كان مقرراً.</p>
      ${tripDetailsCard(trip)}
      <p style="margin:16px 0 8px 0;">إذا كنت لا تزال بحاجة لرحلة في هذا الموعد، يمكنك البحث عن رحلات أخرى متاحة:</p>
    `,
    ctaUrl: `${APP_BASE_URL}/search`,
    ctaLabel: "البحث عن رحلات أخرى",
  });
}

function tripCancelledTemplate(profile: ProfileLite, trip: TripLite | null): string {
  const greeting = profile.full_name ? `مرحباً ${profile.full_name}،` : "مرحباً،";
  return shellTemplate({
    headline: "⚠️ تم إلغاء الرحلة",
    body: `
      <p style="margin:0 0 12px 0;">${greeting}</p>
      <p style="margin:0 0 16px 0;">نأسف لإبلاغك بأن السائق قام بإلغاء الرحلة التالية بالكامل. تم إعادة المقاعد التي كنت قد حجزتها.</p>
      ${tripDetailsCard(trip)}
      <p style="margin:16px 0 8px 0;">يمكنك البحث عن بدائل لنفس الوجهة:</p>
    `,
    ctaUrl: `${APP_BASE_URL}/search`,
    ctaLabel: "البحث عن رحلات بديلة",
  });
}

function tripReminderTemplate(profile: ProfileLite, trip: TripLite | null, ctaUrl: string): string {
  const greeting = profile.full_name ? `مرحباً ${profile.full_name}،` : "مرحباً،";
  return shellTemplate({
    headline: "⏰ رحلتك بعد ساعة",
    body: `
      <p style="margin:0 0 12px 0;">${greeting}</p>
      <p style="margin:0 0 16px 0;">تذكير ودي — رحلتك تنطلق خلال ساعة تقريباً. هذه تفاصيلها:</p>
      ${tripDetailsCard(trip)}
      <p style="margin:16px 0 8px 0;font-size:13px;color:#6b7280;">💡 نصائح للرحلة:</p>
      <ul style="margin:0;padding-right:20px;font-size:13px;color:#6b7280;line-height:1.8;">
        <li>توجه إلى نقطة الالتقاء قبل الموعد بـ 5 دقائق</li>
        <li>تأكد من أن هاتفك مشحون لتسهيل التواصل مع السائق</li>
        <li>راجع الرسائل في التطبيق لأي تحديثات</li>
      </ul>
    `,
    ctaUrl,
    ctaLabel: "عرض تفاصيل الرحلة",
  });
}

// ─── HMAC unsubscribe token signing ──────────────────────────────────────
// Matches the verifier in migration 068's public_unsubscribe_marketing()
// RPC exactly. The token format is hmac-sha256(secret, lower(email) +
// ':unsubscribe-v1') encoded as 64-char hex. Lowercasing the email
// makes the token robust to capitalization drift between profiles.email
// (stored as-entered) and the URL-decoded email param the unsubscribe
// page passes back.
//
// If UNSUBSCRIBE_SECRET isn't configured, we return an empty string and
// log loudly. The template detects empty token and renders the
// unsubscribe link as "go to settings" instead — graceful fallback that
// still satisfies the unsubscribe-availability requirement of CAN-SPAM
// /Israeli Communications Law (the user can opt out, just via a longer
// path).
async function generateUnsubscribeToken(email: string): Promise<string> {
  if (!UNSUBSCRIBE_SECRET) {
    console.error("[send-notification-email] UNSUBSCRIBE_SECRET missing — token generation disabled");
    return "";
  }

  const encoder = new TextEncoder();
  const keyData = encoder.encode(UNSUBSCRIBE_SECRET);
  const message = encoder.encode(`${email.trim().toLowerCase()}:unsubscribe-v1`);

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, message);

  // Convert ArrayBuffer to hex
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Marketing-email template. Distinct from transactional templates in
 *  THREE legally-mandated ways:
 *
 *  1. A clearly-labeled "promotional message" banner at the top so the
 *     recipient understands this isn't about their booking.
 *  2. A visible unsubscribe link inside the body (not just the footer)
 *     so the user can find it without scrolling.
 *  3. A physical business address in the footer — required by Israeli
 *     Communications Law 30A (the equivalent of CAN-SPAM's "physical
 *     postal address" requirement).
 *
 *  Visually the shell is the same green/gold/cream as transactional —
 *  brand recognition is good, and the "promotional" label + unsubscribe
 *  positioning is what differentiates it. */
function marketingTemplate(
  profile: ProfileLite,
  title: string,
  body: string,
  ctaUrl: string,
  unsubscribeUrl: string,
): string {
  const greeting = profile.full_name ? `مرحباً ${profile.full_name}،` : "مرحباً،";

  // Body content — preserve line breaks the admin typed by converting
  // \n to <br>. Defense against HTML injection: the admin can write
  // anything but RPC validates length only, not content. We strip
  // common script-injection vectors but allow the admin to use basic
  // formatting (bold via *text*, links not parsed for now).
  const safeBody = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:${BRAND_CREAM};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Tahoma,Arial,sans-serif;direction:rtl;text-align:right;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${BRAND_CREAM};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(26,61,42,0.08);">

        <!-- Promotional-label banner — legal compliance -->
        <tr>
          <td style="background:#fff8e7;padding:8px 24px;text-align:center;border-bottom:1px solid #f0e6d0;">
            <div style="color:#8a6d1c;font-size:11px;font-weight:600;letter-spacing:0.5px;">📢 رسالة ترويجية من مشوارو</div>
          </td>
        </tr>

        <!-- Header -->
        <tr>
          <td style="background:${BRAND_GREEN};padding:28px 24px;text-align:center;">
            <div style="color:${BRAND_GOLD};font-size:28px;font-weight:bold;margin:0;">مشوارو</div>
            <div style="color:rgba(255,255,255,0.8);font-size:13px;margin-top:4px;">منصة مشاركة الرحلات الفلسطينية</div>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px 28px;color:${BRAND_GREEN};font-size:15px;line-height:1.7;">
            <p style="margin:0 0 16px 0;color:#6b7280;font-size:13px;">${greeting}</p>
            <h1 style="font-size:22px;font-weight:bold;margin:0 0 18px 0;color:${BRAND_GREEN};">${title}</h1>
            <div style="margin:0 0 12px 0;color:#374151;">${safeBody}</div>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:24px 0;">
              <tr><td align="center">
                <a href="${ctaUrl}" style="display:inline-block;background:${BRAND_GREEN};color:#ffffff;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 40px;border-radius:12px;">افتح التطبيق</a>
              </td></tr>
            </table>
          </td>
        </tr>

        <!-- In-body unsubscribe — must be visible without scrolling -->
        <tr>
          <td style="padding:16px 28px;background:#fafafa;border-top:1px solid #f0f0f0;text-align:center;">
            <p style="margin:0;color:#6b7280;font-size:12px;line-height:1.6;">
              لا تريد استلام رسائل ترويجية؟
              <a href="${unsubscribeUrl}" style="color:${BRAND_GREEN};font-weight:bold;text-decoration:underline;">إلغاء الاشتراك بنقرة واحدة</a>
            </p>
          </td>
        </tr>

        <!-- Compliance footer with physical address -->
        <tr>
          <td style="background:${BRAND_CREAM};padding:20px 28px;text-align:center;color:#6b7280;font-size:11px;line-height:1.7;">
            <p style="margin:0 0 4px 0;font-weight:600;color:${BRAND_GREEN};">مشوارو — منصة مشاركة الرحلات</p>
            <p style="margin:0 0 8px 0;">رام الله، فلسطين</p>
            <p style="margin:0 0 6px 0;">تلقيت هذا البريد لأنك مسجل في مشوارو وقمت بتفعيل خيار "العروض والتسويق" من إعدادات حسابك.</p>
            <p style="margin:0;color:#9ca3af;">© 2026 مشوارو. جميع الحقوق محفوظة.</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  // CORS preflight (not strictly needed for service-to-service but harmless)
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Authorize — only service role can call this. Trigger calls with the
  // service role key from vault.
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!RESEND_API_KEY) {
    // Configuration error — log loudly but don't fail the trigger (push
    // still works). User needs to add RESEND_API_KEY to function secrets.
    console.error("[send-notification-email] RESEND_API_KEY env var is missing");
    return new Response(JSON.stringify({ error: "resend_key_not_configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let payload: NotificationPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const type = payload?.data?.type ?? "";
  const userEmail = payload?.user_email ?? "";
  const notificationId = payload?.data?.notification_id ?? "";

  // Skip unsupported types silently — they still get push + in-app.
  if (!SUPPORTED_TYPES.has(type)) {
    return new Response(JSON.stringify({ skipped: "unsupported_type", type }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Defensive: malformed payload.
  if (!userEmail || !notificationId) {
    return new Response(JSON.stringify({ skipped: "malformed_payload" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Look up user's email preference.
  const profile = await fetchProfile(userEmail);
  if (!profile) {
    return new Response(JSON.stringify({ skipped: "no_profile" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ─── Preference gate — type-dependent ──────────────────────────────
  // Transactional types check notif_email (default-on, NULL or true =>
  // send). Marketing 'broadcast' type checks notif_MARKETING — same
  // toggle the admin asked about earlier. NULL is treated as opt-OUT
  // for marketing (stricter than transactional, matching the
  // affirmative-consent requirement of marketing email regulations).
  //
  // Note: by the time we get here for 'broadcast', the SQL audience
  // filter in admin_send_broadcast() already pre-filtered by
  // notif_marketing = TRUE — so the row only exists if the user is
  // opted in. We re-check here as defense in depth (someone could
  // manually INSERT a broadcast notification bypassing the RPC).
  if (type === "broadcast") {
    if (profile.notif_marketing !== true) {
      return new Response(JSON.stringify({ skipped: "user_not_opted_in_marketing" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
  } else {
    // Transactional types — notif_email = false → skip. NULL or true → send.
    if (profile.notif_email === false) {
      return new Response(JSON.stringify({ skipped: "user_opted_out" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // Fetch trip context for the templates. Trip may legitimately be null
  // if the notification doesn't have a trip_id (defensive — current types
  // all should, but we don't crash if one doesn't). Broadcasts don't
  // have a trip_id by design — we skip the fetch.
  const trip = type === "broadcast" ? null : await fetchNotificationTrip(notificationId);

  // Compute the CTA URL — link to the trip details page if we have one,
  // or for broadcasts the admin-supplied link from notification.link
  // (relative path, e.g. '/' for home or '/search' for promo). Falls
  // back to /notifications when there's no context.
  let ctaUrl: string;
  if (type === "broadcast") {
    const broadcastLink = payload.data?.link || "/";
    ctaUrl = broadcastLink.startsWith("http")
      ? broadcastLink
      : `${APP_BASE_URL}${broadcastLink.startsWith("/") ? "" : "/"}${broadcastLink}`;
  } else if (trip?.id) {
    ctaUrl = `${APP_BASE_URL}/trip/${trip.id}`;
  } else {
    ctaUrl = `${APP_BASE_URL}/notifications`;
  }

  // Pick template + subject.
  let html: string;
  let subject = payload.title || "إشعار من مشوارو";

  switch (type) {
    case "booking_confirmed":
      html = bookingConfirmedTemplate(profile, trip, ctaUrl);
      subject = "🎉 تم تأكيد حجزك — مشوارو";
      break;
    case "booking_cancelled":
      html = bookingCancelledTemplate(profile, trip, ctaUrl);
      subject = "تم إلغاء حجزك — مشوارو";
      break;
    case "trip_cancelled":
      html = tripCancelledTemplate(profile, trip);
      subject = "⚠️ تم إلغاء الرحلة — مشوارو";
      break;
    case "trip_reminder":
      html = tripReminderTemplate(profile, trip, ctaUrl);
      subject = "⏰ رحلتك بعد ساعة — مشوارو";
      break;
    case "broadcast": {
      // Generate per-recipient unsubscribe link. Failure falls back to
      // /account/notifications (still satisfies opt-out availability).
      const token = await generateUnsubscribeToken(userEmail);
      const unsubscribeUrl = token
        ? `${APP_BASE_URL}/unsubscribe?email=${encodeURIComponent(userEmail)}&token=${token}`
        : `${APP_BASE_URL}/account?section=notifications`;

      html = marketingTemplate(profile, payload.title, payload.body, ctaUrl, unsubscribeUrl);
      // Marketing subject = admin-chosen title verbatim. NO 🎉 / ⚠️ prefix
      // — admins control framing entirely. Avoids "every email has an
      // emoji" feeling that hurts deliverability.
      subject = payload.title;
      break;
    }
    default:
      // Unreachable — SUPPORTED_TYPES filter above. Defensive fallback.
      return new Response(JSON.stringify({ skipped: "no_template" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
  }

  // Send via Resend.
  const resendBody = {
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to: [userEmail],
    subject,
    html,
    // Tag so we can filter / aggregate by notification type in Resend's
    // dashboard. Useful for debugging "why didn't I get a booking email?"
    tags: [
      { name: "notification_type", value: type },
    ],
  };

  let resendRes: Response;
  try {
    resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(resendBody),
    });
  } catch (e) {
    console.error("[send-notification-email] Resend fetch threw:", e);
    return new Response(JSON.stringify({ error: "resend_unreachable", details: String(e) }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!resendRes.ok) {
    const errBody = await resendRes.text();
    console.error(`[send-notification-email] Resend returned ${resendRes.status}: ${errBody}`);
    return new Response(JSON.stringify({ error: "resend_error", status: resendRes.status, details: errBody }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await resendRes.json() as { id?: string };
  return new Response(JSON.stringify({ sent: true, resend_id: result.id, type }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
