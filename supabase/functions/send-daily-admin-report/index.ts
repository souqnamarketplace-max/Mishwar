import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_EMAIL    = "souqnamarketplace@gmail.com";
const FROM_EMAIL     = "reports@mishwaro.com";

Deno.serve(async () => {
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // Get stats from DB function
  const { data: stats, error } = await sb.rpc("generate_daily_admin_stats");
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const s = stats as any;
  const d = new Date().toLocaleDateString("ar-PS", { timeZone: "Asia/Jerusalem", weekday:"long", year:"numeric", month:"long", day:"numeric" });

  const html = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"><style>
  body { font-family: Arial, sans-serif; background:#f5f5f5; margin:0; padding:20px; direction:rtl; }
  .container { max-width:600px; margin:0 auto; background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,.1); }
  .header { background:#1a3d2a; padding:24px; text-align:center; }
  .header h1 { color:#c9a227; margin:0; font-size:22px; }
  .header p  { color:#fff; margin:4px 0 0; font-size:13px; opacity:.8; }
  .section { padding:20px 24px; border-bottom:1px solid #eee; }
  .section h2 { color:#1a3d2a; font-size:15px; margin:0 0 12px; display:flex; align-items:center; gap:8px; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .stat { background:#f9f6f0; border-radius:8px; padding:12px; }
  .stat .val { font-size:24px; font-weight:bold; color:#1a3d2a; }
  .stat .lbl { font-size:11px; color:#666; margin-top:2px; }
  .alert { background:#fff3cd; border:1px solid #ffc107; border-radius:8px; padding:12px 16px; margin:8px 0; color:#856404; font-size:13px; }
  .footer { background:#f9f6f0; padding:16px 24px; text-align:center; font-size:12px; color:#999; }
  .badge-new { background:#c9a227; color:#fff; font-size:10px; padding:2px 6px; border-radius:10px; margin-right:6px; }
</style></head>
<body><div class="container">
  <div class="header">
    <h1>📊 تقرير مشوارو اليومي</h1>
    <p>${d}</p>
  </div>

  ${s.verification.overdue_licenses > 0 ? `
  <div class="section">
    <div class="alert">⚠️ <strong>${s.verification.overdue_licenses} طلب توثيق</strong> في انتظار المراجعة لأكثر من 48 ساعة — <a href="https://mishwaro.com/dashboard?tab=licenses" style="color:#856404">مراجعة الطلبات</a></div>
  </div>` : ""}

  <div class="section">
    <h2>👥 المستخدمون</h2>
    <div class="grid">
      <div class="stat"><div class="val">${s.users.total}</div><div class="lbl">إجمالي المستخدمين</div></div>
      <div class="stat"><div class="val">${s.users.onboarded}</div><div class="lbl">أكملوا الإعداد</div></div>
      <div class="stat"><div class="val">${s.users.new_today} <span class="badge-new">اليوم</span></div><div class="lbl">مستخدمون جدد اليوم</div></div>
      <div class="stat"><div class="val">${s.users.new_this_week}</div><div class="lbl">مستخدمون جدد هذا الأسبوع</div></div>
      <div class="stat"><div class="val">${s.users.drivers}</div><div class="lbl">سائقون نشطون</div></div>
      <div class="stat"><div class="val">${s.users.passengers}</div><div class="lbl">ركاب مسجلون</div></div>
      <div class="stat"><div class="val">${s.users.verified}</div><div class="lbl">حسابات موثّقة ✓</div></div>
      <div class="stat"><div class="val">${s.users.stuck_onboarding}</div><div class="lbl">عالقون في الإعداد</div></div>
    </div>
  </div>

  <div class="section">
    <h2>📱 المنصات</h2>
    <div class="grid">
      <div class="stat"><div class="val">${s.users.ios}</div><div class="lbl">🍎 مستخدمو iOS</div></div>
      <div class="stat"><div class="val">${s.users.android}</div><div class="lbl">🤖 مستخدمو Android</div></div>
      <div class="stat"><div class="val">${s.push.ios_tokens}</div><div class="lbl">توكنات iOS</div></div>
      <div class="stat"><div class="val">${s.push.android_tokens}</div><div class="lbl">توكنات Android</div></div>
    </div>
  </div>

  <div class="section">
    <h2>🚗 الرحلات</h2>
    <div class="grid">
      <div class="stat"><div class="val">${s.trips.new_today}</div><div class="lbl">رحلات جديدة اليوم</div></div>
      <div class="stat"><div class="val">${s.trips.new_this_week}</div><div class="lbl">رحلات هذا الأسبوع</div></div>
      <div class="stat"><div class="val">${s.trips.active}</div><div class="lbl">رحلات نشطة الآن</div></div>
      <div class="stat"><div class="val">${s.trips.completed_this_week}</div><div class="lbl">مكتملة هذا الأسبوع</div></div>
    </div>
  </div>

  <div class="section">
    <h2>📋 طلبات الركاب</h2>
    <div class="grid">
      <div class="stat"><div class="val">${s.requests.open}</div><div class="lbl">طلبات مفتوحة الآن</div></div>
      <div class="stat"><div class="val">${s.requests.new_today}</div><div class="lbl">طلبات جديدة اليوم</div></div>
      <div class="stat"><div class="val">${s.bookings.new_today}</div><div class="lbl">حجوزات اليوم</div></div>
      <div class="stat"><div class="val">${s.bookings.completed_this_week}</div><div class="lbl">حجوزات مكتملة الأسبوع</div></div>
    </div>
  </div>

  <div class="section">
    <h2>🪪 التوثيق</h2>
    <div class="grid">
      <div class="stat"><div class="val">${s.verification.pending_licenses}</div><div class="lbl">طلبات قيد المراجعة</div></div>
      <div class="stat"><div class="val" style="color:${s.verification.overdue_licenses > 0 ? '#dc3545' : '#1a3d2a'}">${s.verification.overdue_licenses}</div><div class="lbl">متأخرة +48 ساعة ⚠️</div></div>
      <div class="stat"><div class="val">${s.verification.approved_this_week}</div><div class="lbl">تمت الموافقة عليها الأسبوع</div></div>
      <div class="stat"><div class="val">${s.verification.pending_passengers}</div><div class="lbl">توثيق ركاب معلق</div></div>
    </div>
  </div>

  <div class="footer">
    مشوارو — لوحة الإدارة: <a href="https://mishwaro.com/dashboard">mishwaro.com/dashboard</a><br>
    هذا البريد مُرسَل تلقائياً كل يوم في الساعة 8:00 صباحاً (القدس)
  </div>
</div></body></html>`;

  // Send via Resend
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to:   [ADMIN_EMAIL],
      subject: `📊 تقرير مشوارو — ${d} | ${s.users.new_today} مستخدم جديد | ${s.trips.new_today} رحلة`,
      html,
    }),
  });

  const result = await res.json();
  return new Response(JSON.stringify({ ok: res.ok, result, stats }), {
    status: res.ok ? 200 : 500,
    headers: { "Content-Type": "application/json" },
  });
});
