// ════════════════════════════════════════════════════════════════════════
// Edge Function: send-welcome-email
// ════════════════════════════════════════════════════════════════════════
//
// Sends a branded Arabic welcome email when a user confirms their email
// address (or immediately on sign-up for social/Apple auth which skips
// email confirmation).
//
// Triggered by Postgres via pg_net from migration 102:
//   on_email_confirmed  → auth.users AFTER UPDATE OF email_confirmed_at
//   on_social_signup    → public.profiles AFTER INSERT (for OAuth users)
//
// The email explains Mishwaro and gives the user 3 clear paths:
//   1. 🚗 سائق   — Become a driver
//   2. 🧳 راكب   — Find a trip as a passenger
//   3. 🔄 كليهما — Do both
//
// REQUEST SHAPE (called by pg_net from trigger)
//   POST /functions/v1/send-welcome-email
//   Headers: Authorization: Bearer <SERVICE_ROLE_KEY>
//   Body: {
//     user_email: string,
//     full_name?: string     // may be null for email signups before profile completes
//   }
//
// RESPONSE SHAPE
//   200 { sent: true, resend_id: string }
//   200 { skipped: string }    (already sent, no email, etc.)
//   4xx/5xx { error: string }
//
// ENV
//   RESEND_API_KEY            — configured in Supabase dashboard secrets
//   SUPABASE_URL              — auto-injected
//   SUPABASE_SERVICE_ROLE_KEY — auto-injected
// ════════════════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RESEND_API_KEY            = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const FROM_EMAIL   = "noreply@mishwaro.com";
const FROM_NAME    = "مشوارو";
const APP_BASE_URL = "https://www.mishwaro.com";

const BRAND_GREEN = "#1a3d2a";
const BRAND_GOLD  = "#c9a227";
const BRAND_CREAM = "#faf5e6";

// ─── Duplicate-send guard ────────────────────────────────────────────────────
// We store a flag in profiles.welcome_email_sent (boolean, added in mig 102).
// Before sending we check; after sending we set it. This prevents duplicate
// welcomes if the trigger fires more than once (e.g. user re-confirms email).
async function hasWelcomeBeenSent(email: string): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?select=welcome_email_sent&email=eq.${encodeURIComponent(email)}&limit=1`,
    { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
  );
  if (!res.ok) return false;
  const rows = await res.json() as { welcome_email_sent: boolean | null }[];
  return rows[0]?.welcome_email_sent === true;
}

async function markWelcomeSent(email: string): Promise<void> {
  await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}`,
    {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ welcome_email_sent: true }),
    }
  );
}

// ─── Email template ───────────────────────────────────────────────────────────
function welcomeTemplate(fullName: string | null): string {
  const greeting = fullName ? `أهلاً ${fullName}! 👋` : "أهلاً بك في مشوارو! 👋";

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>مرحباً بك في مشوارو</title>
</head>
<body style="margin:0;padding:0;background-color:${BRAND_CREAM};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Tahoma,Arial,sans-serif;direction:rtl;text-align:right;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${BRAND_CREAM};padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:500px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(26,61,42,0.10);">

      <!-- Header -->
      <tr>
        <td style="background:${BRAND_GREEN};padding:36px 24px;text-align:center;">
          <div style="color:${BRAND_GOLD};font-size:32px;font-weight:bold;letter-spacing:-0.5px;">مشوارو</div>
          <div style="color:rgba(255,255,255,0.75);font-size:13px;margin-top:6px;">منصة مشاركة الرحلات في فلسطين</div>
        </td>
      </tr>

      <!-- Welcome headline -->
      <tr>
        <td style="padding:36px 28px 24px 28px;text-align:center;">
          <div style="font-size:28px;margin-bottom:8px;">🎉</div>
          <h1 style="font-size:22px;font-weight:bold;color:${BRAND_GREEN};margin:0 0 12px 0;">${greeting}</h1>
          <p style="font-size:15px;color:#4b5563;line-height:1.8;margin:0;">
            تم تفعيل حسابك بنجاح. مشوارو هو تطبيقك لمشاركة رحلات السيارة بين مدن الضفة الغربية — أسرع، أرخص، وأكثر أماناً.
          </p>
        </td>
      </tr>

      <!-- Divider -->
      <tr><td style="padding:0 28px;"><div style="height:1px;background:#f0e6d0;"></div></td></tr>

      <!-- 3 paths section -->
      <tr>
        <td style="padding:28px 28px 8px 28px;">
          <p style="font-size:14px;font-weight:bold;color:${BRAND_GREEN};margin:0 0 20px 0;text-align:center;">كيف تريد أن تبدأ؟</p>

          <!-- Path 1: Driver -->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:12px;background:${BRAND_CREAM};border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:18px 20px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td style="width:44px;font-size:28px;vertical-align:middle;">🚗</td>
                    <td style="vertical-align:middle;padding-right:12px;">
                      <div style="font-size:15px;font-weight:bold;color:${BRAND_GREEN};margin-bottom:4px;">أنشر رحلتك كسائق</div>
                      <div style="font-size:12px;color:#6b7280;line-height:1.6;">سافر يومياً؟ اربح من رحلاتك. الاشتراك ٣٠ شيكل شهرياً بدون عمولة على كل رحلة.</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

          <!-- CTA: Driver -->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:20px;">
            <tr><td align="center">
              <a href="${APP_BASE_URL}/become-driver" style="display:inline-block;background:${BRAND_GREEN};color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;padding:12px 32px;border-radius:10px;">
                ابدأ كسائق
              </a>
            </td></tr>
          </table>

          <!-- Divider -->
          <div style="height:1px;background:#f0e6d0;margin-bottom:20px;"></div>

          <!-- Path 2: Passenger -->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:12px;background:${BRAND_CREAM};border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:18px 20px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td style="width:44px;font-size:28px;vertical-align:middle;">🧳</td>
                    <td style="vertical-align:middle;padding-right:12px;">
                      <div style="font-size:15px;font-weight:bold;color:${BRAND_GREEN};margin-bottom:4px;">احجز مقعدك كراكب</div>
                      <div style="font-size:12px;color:#6b7280;line-height:1.6;">ابحث عن رحلات متاحة بين مدنك بسائقين موثَّقين وأسعار شفافة.</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

          <!-- CTA: Passenger -->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:20px;">
            <tr><td align="center">
              <a href="${APP_BASE_URL}/search" style="display:inline-block;background:${BRAND_GOLD};color:${BRAND_GREEN};text-decoration:none;font-weight:bold;font-size:14px;padding:12px 32px;border-radius:10px;">
                ابحث عن رحلة الآن
              </a>
            </td></tr>
          </table>

          <!-- Divider -->
          <div style="height:1px;background:#f0e6d0;margin-bottom:20px;"></div>

          <!-- Path 3: Both -->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:12px;background:${BRAND_CREAM};border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:18px 20px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td style="width:44px;font-size:28px;vertical-align:middle;">🔄</td>
                    <td style="vertical-align:middle;padding-right:12px;">
                      <div style="font-size:15px;font-weight:bold;color:${BRAND_GREEN};margin-bottom:4px;">الاثنان معاً</div>
                      <div style="font-size:12px;color:#6b7280;line-height:1.6;">يمكنك أن تكون سائقاً وراكباً في نفس الوقت — المرونة الكاملة.</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

          <!-- CTA: Both -->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:8px;">
            <tr><td align="center">
              <a href="${APP_BASE_URL}/how-it-works" style="display:inline-block;border:2px solid ${BRAND_GREEN};color:${BRAND_GREEN};text-decoration:none;font-weight:bold;font-size:14px;padding:10px 32px;border-radius:10px;background:#ffffff;">
                اعرف أكثر عن مشوارو
              </a>
            </td></tr>
          </table>
        </td>
      </tr>

      <!-- Trust strip -->
      <tr>
        <td style="padding:28px 28px;">
          <div style="background:${BRAND_GREEN};border-radius:14px;padding:20px;text-align:center;">
            <p style="color:${BRAND_GOLD};font-size:13px;font-weight:bold;margin:0 0 12px 0;">لماذا مشوارو؟</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="text-align:center;padding:4px;">
                  <div style="color:#ffffff;font-size:11px;line-height:1.7;">
                    ✅ سائقون موثَّقون<br>
                    ✅ أسعار شفافة بدون مفاجآت<br>
                    ✅ تواصل داخل التطبيق فقط<br>
                    ✅ متاح في كل مدن الضفة الغربية
                  </div>
                </td>
              </tr>
            </table>
          </div>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="background:${BRAND_CREAM};padding:20px 28px;text-align:center;color:#6b7280;font-size:11px;line-height:1.8;border-top:1px solid #f0e6d0;">
          <p style="margin:0 0 4px 0;font-weight:600;color:${BRAND_GREEN};">مشوارو — منصة مشاركة الرحلات الفلسطينية</p>
          <p style="margin:0 0 6px 0;">يمكنك إيقاف إشعارات البريد الإلكتروني من إعدادات حسابك.</p>
          <p style="margin:0;color:#9ca3af;">© 2026 مشوارو. جميع الحقوق محفوظة.</p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ─── Handler ──────────────────────────────────────────────────────────────────
serve(async (req) => {
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
      status: 405, headers: { "Content-Type": "application/json" },
    });
  }

  // Auth check — service role only
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  if (!RESEND_API_KEY) {
    console.error("[send-welcome-email] RESEND_API_KEY missing");
    return new Response(JSON.stringify({ error: "resend_key_not_configured" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  let body: { user_email: string; full_name?: string | null };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const { user_email: email, full_name: fullName = null } = body;

  if (!email || !email.includes("@")) {
    return new Response(JSON.stringify({ skipped: "no_valid_email" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  // Skip Apple "Hide My Email" private relay addresses — Resend cannot
  // deliver to @privaterelay.appleid.com without Apple relay registration.
  if (email.endsWith("@privaterelay.appleid.com")) {
    console.log(`[send-welcome-email] Skipping Apple private relay: ${email}`);
    return new Response(JSON.stringify({ skipped: "apple_private_relay" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  // Duplicate-send guard — don't welcome the same user twice
  const alreadySent = await hasWelcomeBeenSent(email);
  if (alreadySent) {
    return new Response(JSON.stringify({ skipped: "already_sent" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  const html = welcomeTemplate(fullName ?? null);

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [email],
      subject: "🎉 أهلاً بك في مشوارو — ابدأ رحلتك الأولى",
      html,
      tags: [{ name: "email_type", value: "welcome" }],
    }),
  });

  if (!resendRes.ok) {
    const err = await resendRes.text();
    console.error(`[send-welcome-email] Resend error ${resendRes.status}: ${err}`);
    return new Response(JSON.stringify({ error: "resend_error", status: resendRes.status }), {
      status: 502, headers: { "Content-Type": "application/json" },
    });
  }

  // Mark as sent so we never double-send
  await markWelcomeSent(email);

  const result = await resendRes.json() as { id?: string };
  console.log(`[send-welcome-email] Sent to ${email}, resend_id=${result.id}`);

  return new Response(JSON.stringify({ sent: true, resend_id: result.id }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
