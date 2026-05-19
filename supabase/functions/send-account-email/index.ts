// ════════════════════════════════════════════════════════════════════════
// Edge Function: send-account-email
// ════════════════════════════════════════════════════════════════════════
//
// Two-mode email sender for account lifecycle events. The frontend
// calls this from AccountSettings.jsx during the self-deletion flow.
//
// MODE 1 — kind: "data_export"
//   Generates a printer-friendly Arabic HTML email containing:
//     - User profile (name, email, phone, dob, account type, member-since)
//     - Completed trips summary (last 50)
//     - Completed bookings summary (last 50, with cancelled excluded)
//   Sends via Resend to the user's CURRENT email address. User can
//   open the email in any mail client and "Print → Save as PDF" to
//   keep a permanent copy. Designed for GDPR Art. 20 portability —
//   the data is human-readable, not the JSON dump a developer would
//   want but useless to regular users.
//
//   Called BEFORE the actual deletion. If sending fails, the
//   deletion is NOT executed (the frontend awaits a 200 before
//   proceeding) so the user never ends up account-deleted-but-
//   never-got-their-data.
//
// MODE 2 — kind: "deletion_confirmed"
//   Short transactional email confirming the deletion completed.
//   "Your account was deleted on <date>. If this wasn't you,
//    contact support within 30 days."
//   Belt-and-suspenders against silent account loss / unauthorized
//   deletions. Called AFTER the deletion succeeds.
//
// ════════════════════════════════════════════════════════════════════════
//
// REQUEST SHAPE
//   POST /functions/v1/send-account-email
//   Headers: Authorization: Bearer <user JWT>   (authenticated user, not service role)
//   Body: { kind: "data_export" | "deletion_confirmed", reason?: string }
//
// RESPONSE SHAPE
//   200 OK { sent: true, resend_id: string, kind: string }
//   4xx/5xx { error: string, details?: any }
//
// ENV
//   RESEND_API_KEY   — already configured (used by send-notification-email)
//   SUPABASE_URL     — auto-injected
//   SUPABASE_ANON_KEY — auto-injected
//
// SECURITY
//   The function reads user data using the CALLER's JWT, not service
//   role. So RLS still applies — the function only sees what the
//   caller could see themselves. No risk of leaking another user's
//   data via a forged kind/email body.

// deno-lint-ignore-file no-explicit-any

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL   = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON  = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const FROM_EMAIL = "noreply@mishwaro.com";
const FROM_NAME  = "مشوارو";
const APP_BASE   = "https://www.mishwaro.com";

// ─── Helpers ─────────────────────────────────────────────────────────────

function escapeHtml(s: any): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return "—";
    return dt.toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return "—";
  }
}

function formatAccountType(t: string | null | undefined): string {
  switch (t) {
    case "passenger": return "راكب";
    case "driver":    return "سائق";
    case "both":      return "راكب وسائق";
    default:          return "—";
  }
}

// ─── REST helpers (auth-as-caller, RLS still applies) ────────────────────

async function rest(jwt: string, path: string): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_ANON || "",
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`REST ${path} failed: ${res.status} ${t.slice(0, 200)}`);
  }
  return res.json();
}

// ─── Email body builders ────────────────────────────────────────────────

function buildDataExportHtml(opts: {
  profile: any;
  trips: any[];
  bookings: any[];
}): { subject: string; html: string } {
  const { profile, trips, bookings } = opts;

  const tripsRows = trips.length === 0
    ? `<tr><td colspan="5" style="padding:16px;text-align:center;color:#888;">لا توجد رحلات منشورة</td></tr>`
    : trips.map((t) => `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(formatDate(t.date))}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(t.from_city || "—")}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(t.to_city || "—")}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">${escapeHtml(t.price || "—")} ₪</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">${escapeHtml(t.status || "—")}</td>
        </tr>
      `).join("");

  const bookingsRows = bookings.length === 0
    ? `<tr><td colspan="4" style="padding:16px;text-align:center;color:#888;">لا توجد حجوزات</td></tr>`
    : bookings.map((b) => `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(formatDate(b.created_at))}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(b.trip?.from_city || "—")} → ${escapeHtml(b.trip?.to_city || "—")}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">${escapeHtml(b.seats_booked || 1)}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">${escapeHtml(b.total_price || b.trip?.price || "—")} ₪</td>
        </tr>
      `).join("");

  const html = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <title>نسخة من بياناتك — مشوارو</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background:#faf5e6; margin:0; padding:24px 12px; direction: rtl;">
  <div style="max-width:640px; margin:0 auto; background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 2px 12px rgba(26,61,42,0.08);">

    <!-- Header -->
    <div style="background:#1a3d2a; padding:32px 24px; text-align:center;">
      <h1 style="color:#c9a227; margin:0 0 8px; font-size:28px;">مشوارو</h1>
      <p style="color:#faf5e6; margin:0; font-size:14px;">نسخة من بياناتك الشخصية</p>
    </div>

    <!-- Intro -->
    <div style="padding:24px 24px 12px;">
      <p style="margin:0 0 12px; font-size:15px; line-height:1.7; color:#333;">
        مرحباً ${escapeHtml(profile?.full_name || "")},
      </p>
      <p style="margin:0; font-size:14px; line-height:1.7; color:#555;">
        هذه نسخة من بياناتك المخزّنة في مشوارو، كما طلبت قبل حذف الحساب. يمكنك حفظ هذه الرسالة أو طباعتها بصيغة PDF من تطبيق البريد لديك للاحتفاظ بها.
      </p>
    </div>

    <!-- Profile section -->
    <div style="padding:12px 24px;">
      <h2 style="margin:16px 0 12px; font-size:18px; color:#1a3d2a; border-bottom:2px solid #c9a227; padding-bottom:8px;">معلومات الحساب</h2>
      <table style="width:100%; font-size:14px; border-collapse:collapse;">
        <tr><td style="padding:6px 0; color:#888; width:140px;">الاسم</td><td style="padding:6px 0;">${escapeHtml(profile?.full_name || "—")}</td></tr>
        <tr><td style="padding:6px 0; color:#888;">البريد</td><td style="padding:6px 0;">${escapeHtml(profile?.email || "—")}</td></tr>
        <tr><td style="padding:6px 0; color:#888;">رقم الهاتف</td><td style="padding:6px 0; direction:ltr; text-align:right;">${escapeHtml(profile?.phone || "—")}</td></tr>
        <tr><td style="padding:6px 0; color:#888;">تاريخ الميلاد</td><td style="padding:6px 0;">${escapeHtml(formatDate(profile?.dob))}</td></tr>
        <tr><td style="padding:6px 0; color:#888;">نوع الحساب</td><td style="padding:6px 0;">${escapeHtml(formatAccountType(profile?.account_type))}</td></tr>
        <tr><td style="padding:6px 0; color:#888;">عضو منذ</td><td style="padding:6px 0;">${escapeHtml(formatDate(profile?.created_at))}</td></tr>
      </table>
    </div>

    <!-- Trips section (drivers only have trips, but render for both) -->
    <div style="padding:12px 24px;">
      <h2 style="margin:16px 0 12px; font-size:18px; color:#1a3d2a; border-bottom:2px solid #c9a227; padding-bottom:8px;">رحلاتك المكتملة (آخر ${trips.length})</h2>
      <table style="width:100%; font-size:13px; border-collapse:collapse; background:#fafafa; border-radius:8px; overflow:hidden;">
        <thead style="background:#1a3d2a; color:#fff;">
          <tr>
            <th style="padding:10px 8px; text-align:right;">التاريخ</th>
            <th style="padding:10px 8px; text-align:right;">من</th>
            <th style="padding:10px 8px; text-align:right;">إلى</th>
            <th style="padding:10px 8px; text-align:center;">السعر</th>
            <th style="padding:10px 8px; text-align:center;">الحالة</th>
          </tr>
        </thead>
        <tbody>
          ${tripsRows}
        </tbody>
      </table>
    </div>

    <!-- Bookings section -->
    <div style="padding:12px 24px;">
      <h2 style="margin:16px 0 12px; font-size:18px; color:#1a3d2a; border-bottom:2px solid #c9a227; padding-bottom:8px;">حجوزاتك (آخر ${bookings.length})</h2>
      <table style="width:100%; font-size:13px; border-collapse:collapse; background:#fafafa; border-radius:8px; overflow:hidden;">
        <thead style="background:#1a3d2a; color:#fff;">
          <tr>
            <th style="padding:10px 8px; text-align:right;">التاريخ</th>
            <th style="padding:10px 8px; text-align:right;">المسار</th>
            <th style="padding:10px 8px; text-align:center;">المقاعد</th>
            <th style="padding:10px 8px; text-align:center;">الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          ${bookingsRows}
        </tbody>
      </table>
    </div>

    <!-- Footer -->
    <div style="padding:20px 24px; background:#faf5e6; text-align:center; border-top:1px solid #eee;">
      <p style="margin:0 0 6px; font-size:12px; color:#666;">
        ستحتفظ المنصة ببعض السجلات (الرحلات، التقييمات) بشكل مجهول الهوية لأغراض الامتثال القانوني.
      </p>
      <p style="margin:0; font-size:11px; color:#888;">
        لأي استفسار: <a href="mailto:privacy@mishwar.ps" style="color:#1a3d2a;">privacy@mishwar.ps</a>
      </p>
    </div>

  </div>
</body>
</html>
  `;

  return { subject: "نسخة من بياناتك في مشوارو", html };
}

function buildDeletionConfirmedHtml(opts: { name: string; reason: string | null }): { subject: string; html: string } {
  const html = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"><title>تم حذف حسابك — مشوارو</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Tahoma, sans-serif; background:#faf5e6; margin:0; padding:32px 16px; direction:rtl;">
  <div style="max-width:520px; margin:0 auto; background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 2px 12px rgba(26,61,42,0.08);">
    <div style="background:#1a3d2a; padding:32px 24px; text-align:center;">
      <h1 style="color:#c9a227; margin:0; font-size:24px;">مشوارو</h1>
    </div>
    <div style="padding:32px 24px;">
      <h2 style="margin:0 0 16px; font-size:20px; color:#1a3d2a;">تم حذف حسابك</h2>
      <p style="margin:0 0 14px; font-size:15px; line-height:1.7; color:#444;">
        مرحباً ${escapeHtml(opts.name || "")},
      </p>
      <p style="margin:0 0 14px; font-size:14px; line-height:1.7; color:#555;">
        تم حذف حسابك في مشوارو بنجاح بتاريخ <strong>${escapeHtml(formatDate(new Date().toISOString()))}</strong>. تم تجميد بياناتك الشخصية وفقاً لسياسة الخصوصية.
      </p>
      ${opts.reason ? `<p style="margin:0 0 14px; font-size:13px; line-height:1.7; color:#777;">سبب الإلغاء الذي ذكرته: <em>${escapeHtml(opts.reason)}</em></p>` : ""}
      <div style="margin:24px 0; padding:16px; background:#fff7e6; border:1px solid #f3d56f; border-radius:8px;">
        <p style="margin:0 0 6px; font-size:13px; color:#92400e; font-weight:bold;">⚠️ إن لم تكن أنت من قام بهذا الحذف</p>
        <p style="margin:0; font-size:13px; line-height:1.6; color:#92400e;">
          تواصل معنا فوراً عبر <a href="mailto:privacy@mishwar.ps" style="color:#92400e;">privacy@mishwar.ps</a> خلال 30 يوماً. بعد هذه المدة لا يمكن استرجاع الحساب.
        </p>
      </div>
      <p style="margin:24px 0 0; font-size:13px; line-height:1.7; color:#888;">
        شكراً لاستخدامك مشوارو. نأمل أن نراك مجدداً.
      </p>
    </div>
    <div style="padding:16px 24px; background:#faf5e6; text-align:center; border-top:1px solid #eee;">
      <p style="margin:0; font-size:11px; color:#888;"><a href="${APP_BASE}" style="color:#1a3d2a;">${APP_BASE}</a></p>
    </div>
  </div>
</body>
</html>
  `;
  return { subject: "تم حذف حسابك في مشوارو", html };
}

// ─── CORS ────────────────────────────────────────────────────────────────
// Browser preflight from www.mishwaro.com (and any future origin) needs
// these headers, or the OPTIONS request 404s and the actual POST never
// fires. Same pattern as send-notification-email and send-push-notification.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Main handler ───────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: "missing_env_RESEND_API_KEY" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Extract caller JWT
  const auth = req.headers.get("Authorization") || "";
  const jwt  = auth.replace(/^Bearer\s+/i, "");
  if (!jwt) {
    return new Response(JSON.stringify({ error: "missing_jwt" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Parse request body
  let body: any = {};
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const kind   = String(body.kind || "").trim();
  const reason = body.reason ? String(body.reason).slice(0, 500) : null;

  if (kind !== "data_export" && kind !== "deletion_confirmed") {
    return new Response(JSON.stringify({ error: "invalid_kind", got: kind }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Get caller's profile (RLS scopes to self automatically)
  let profile: any = null;
  try {
    const rows = await rest(jwt, "profiles?select=id,email,full_name,phone,dob,account_type,created_at&limit=1");
    profile = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  } catch (e) {
    console.error("[send-account-email] profile fetch failed:", String(e));
    return new Response(JSON.stringify({ error: "profile_fetch_failed", details: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!profile?.email) {
    return new Response(JSON.stringify({ error: "no_email_on_profile" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Build body
  let subject = "";
  let html    = "";

  if (kind === "data_export") {
    // Pull last 50 completed trips + 50 bookings (RLS-scoped to caller).
    let trips: any[]    = [];
    let bookings: any[] = [];
    try {
      trips = await rest(
        jwt,
        `trips?select=id,date,from_city,to_city,price,status&driver_email=eq.${encodeURIComponent(profile.email)}&order=date.desc&limit=50`,
      );
    } catch (e) {
      console.warn("[send-account-email] trips fetch warning:", String(e));
    }
    try {
      bookings = await rest(
        jwt,
        `bookings?select=id,created_at,seats_booked,total_price,status,trip:trips(from_city,to_city,price)&passenger_email=eq.${encodeURIComponent(profile.email)}&status=neq.cancelled&order=created_at.desc&limit=50`,
      );
    } catch (e) {
      console.warn("[send-account-email] bookings fetch warning:", String(e));
    }
    const built = buildDataExportHtml({ profile, trips, bookings });
    subject = built.subject;
    html    = built.html;
  } else {
    const built = buildDeletionConfirmedHtml({ name: profile.full_name || "", reason });
    subject = built.subject;
    html    = built.html;
  }

  // Send via Resend
  const resendBody = {
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to: [profile.email],
    subject,
    html,
    tags: [{ name: "account_email_kind", value: kind }],
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
    console.error("[send-account-email] resend unreachable:", String(e));
    return new Response(JSON.stringify({ error: "resend_unreachable", details: String(e) }), {
      status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!resendRes.ok) {
    const t = await resendRes.text();
    console.error(`[send-account-email] resend ${resendRes.status}:`, t);
    return new Response(JSON.stringify({ error: "resend_error", status: resendRes.status, details: t.slice(0, 500) }), {
      status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const resendData = await resendRes.json();
  return new Response(JSON.stringify({ sent: true, kind, resend_id: resendData?.id || null }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
