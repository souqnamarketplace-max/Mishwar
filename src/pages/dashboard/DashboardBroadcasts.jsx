// ════════════════════════════════════════════════════════════════════════
// DashboardBroadcasts — admin-only marketing broadcast composer + history
// ════════════════════════════════════════════════════════════════════════
//
// Renders inside /dashboard when activePage === 'broadcasts'. Lets admin:
//   1. Compose a broadcast (title, message, audience filter, channels)
//   2. Preview the in-app rendering before sending
//   3. Send via admin_send_broadcast() RPC — bulk-inserts notifications
//      that fan out to push (mig 060) + email (mig 066) automatically
//   4. View history of past broadcasts (paginated)
//
// Admin gate: this component is only rendered for admin role users (the
// dashboard's outer guard checks role). The RPC also double-checks
// admin role server-side. Two layers because the dashboard guard could
// theoretically be bypassed by URL manipulation, but the RPC can't.
//
// COPY-DECK
//   All Arabic-language UI matches the brand voice from other dashboard
//   pages. No emoji clutter — admins prefer information density.
//
// SAFETY UX
//   Sending a broadcast is high-stakes (potentially 1000+ users get a
//   push notification on their phone). We use a two-step confirmation:
//   click "Send" → modal shows resolved audience count + preview →
//   user clicks "Confirm Send" to actually fire the RPC. Reduces "oh
//   no I clicked the wrong button" scenarios significantly.
// ════════════════════════════════════════════════════════════════════════

import React, { useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Megaphone, Send, Users, Car, User, MapPin, Smartphone, Mail,
  AlertTriangle, History, Loader2, X, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import Pagination from "@/components/dashboard/Pagination";

// ─── Audience options (matches admin_send_broadcast RPC) ─────────────────
const AUDIENCE_OPTIONS = [
  { value: "all",        label: "جميع المستخدمين",       icon: Users,  desc: "كل من فعّل العروض والتسويق" },
  { value: "drivers",    label: "السائقون فقط",         icon: Car,    desc: "أصحاب الحسابات السائقة والمزدوجة" },
  { value: "passengers", label: "الركاب فقط",            icon: User,   desc: "أصحاب حسابات الركاب والمزدوجة" },
  { value: "by_city",    label: "حسب المدينة",          icon: MapPin, desc: "ضع اسم المدينة كما يُعرض في الملف" },
];

const AUDIENCE_LABELS = Object.fromEntries(AUDIENCE_OPTIONS.map(o => [o.value, o.label]));

export default function DashboardBroadcasts() {
  const qc = useQueryClient();

  // ─── Compose form state ─────────────────────────────────────────
  const [title,          setTitle]          = useState("");
  const [message,        setMessage]        = useState("");
  const [audience,       setAudience]       = useState("all");
  const [audienceCity,   setAudienceCity]   = useState("");
  const [channelPush,    setChannelPush]    = useState(true);
  const [channelEmail,   setChannelEmail]   = useState(true);
  const [link,           setLink]           = useState("/");
  const [confirmOpen,    setConfirmOpen]    = useState(false);
  const [lastSentResult, setLastSentResult] = useState(null);

  // ─── History pagination ─────────────────────────────────────────
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  const { data: history = { rows: [], total: 0, totalPages: 1 }, isLoading: historyLoading } = useQuery({
    queryKey: ["admin-broadcasts", page],
    queryFn: async () => {
      const from = (page - 1) * PAGE_SIZE;
      const to   = from + PAGE_SIZE - 1;
      const { data, error, count } = await supabase
        .from("broadcasts")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);
      if (error) throw error;
      return {
        rows:       data || [],
        total:      count || 0,
        totalPages: Math.max(1, Math.ceil((count || 0) / PAGE_SIZE)),
      };
    },
  });

  // ─── Send mutation ──────────────────────────────────────────────
  const sendMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("admin_send_broadcast", {
        p_title:           title.trim(),
        p_message:         message.trim(),
        p_audience:        audience,
        p_audience_city:   audience === "by_city" ? audienceCity.trim() : null,
        p_channel_push:    channelPush,
        p_channel_email:   channelEmail,
        p_link:            link.trim() || "/",
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setLastSentResult(data);
      setConfirmOpen(false);
      toast.success(`تم إرسال البث إلى ${data?.recipient_count ?? 0} مستخدم`);
      // Reset form
      setTitle("");
      setMessage("");
      setAudienceCity("");
      // Don't reset audience/channels — admin often sends to same audience
      qc.invalidateQueries({ queryKey: ["admin-broadcasts"] });
    },
    onError: (err) => {
      setConfirmOpen(false);
      toast.error(err?.message || "فشل إرسال البث");
    },
  });

  // ─── Form validation ────────────────────────────────────────────
  const titleOk          = title.trim().length > 0 && title.trim().length <= 120;
  const messageOk        = message.trim().length > 0 && message.trim().length <= 500;
  const audienceCityOk   = audience !== "by_city" || audienceCity.trim().length > 0;
  const channelOk        = channelPush || channelEmail; // at least one (in-app is always implicit)
  const formValid        = titleOk && messageOk && audienceCityOk && channelOk;

  const handleSendClick = () => {
    if (!formValid) {
      toast.error("يرجى إكمال جميع الحقول المطلوبة");
      return;
    }
    setConfirmOpen(true);
  };

  return (
    <div className="space-y-6" dir="rtl">

      {/* ─── Header ─────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Megaphone className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground">البث والتسويق</h2>
          <p className="text-sm text-muted-foreground">إرسال إشعارات ترويجية لشرائح من المستخدمين</p>
        </div>
      </div>

      {/* ─── Compose card ───────────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl p-6">

        {/* Title */}
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">عنوان البث <span className="text-red-500">*</span></label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="مثال: عرض خاص لمستخدمي مشوارو"
            maxLength={120}
            className="w-full"
          />
          <div className="flex justify-between mt-1">
            <span className="text-xs text-muted-foreground">سيظهر في الإشعار وموضوع البريد الإلكتروني</span>
            <span className="text-xs text-muted-foreground">{title.length}/120</span>
          </div>
        </div>

        {/* Message */}
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">نص الرسالة <span className="text-red-500">*</span></label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="اكتب محتوى الرسالة الترويجية..."
            maxLength={500}
            rows={5}
            className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex justify-between mt-1">
            <span className="text-xs text-muted-foreground">يدعم أسطر متعددة. سيظهر في الإشعار والبريد.</span>
            <span className="text-xs text-muted-foreground">{message.length}/500</span>
          </div>
        </div>

        {/* Audience */}
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">الجمهور المستهدف <span className="text-red-500">*</span></label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {AUDIENCE_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const active = audience === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setAudience(opt.value)}
                  className={`text-right p-3 rounded-xl border-2 transition-colors ${
                    active
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className={`w-4 h-4 ${active ? "text-primary" : "text-muted-foreground"}`} />
                    <span className="text-sm font-bold">{opt.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{opt.desc}</p>
                </button>
              );
            })}
          </div>
          {audience === "by_city" && (
            <Input
              value={audienceCity}
              onChange={(e) => setAudienceCity(e.target.value)}
              placeholder="اسم المدينة (مثل: رام الله)"
              className="mt-3"
            />
          )}
        </div>

        {/* Channels */}
        <div className="mb-5">
          <label className="block text-sm font-medium mb-2">قنوات الإرسال</label>
          <div className="space-y-2">
            <label className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl cursor-pointer">
              <input type="checkbox" checked disabled className="w-4 h-4" />
              <Megaphone className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm flex-1">إشعار داخل التطبيق (مفعّل دائماً — جرس + توست)</span>
            </label>
            <label className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl cursor-pointer">
              <input
                type="checkbox"
                checked={channelPush}
                onChange={(e) => setChannelPush(e.target.checked)}
                className="w-4 h-4"
              />
              <Smartphone className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm flex-1">إشعار دفع على الهاتف (Push)</span>
            </label>
            <label className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl cursor-pointer">
              <input
                type="checkbox"
                checked={channelEmail}
                onChange={(e) => setChannelEmail(e.target.checked)}
                className="w-4 h-4"
              />
              <Mail className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm flex-1">بريد إلكتروني</span>
            </label>
          </div>
          {!channelOk && (
            <p className="text-xs text-red-500 mt-2">يجب اختيار قناة واحدة على الأقل</p>
          )}
        </div>

        {/* Optional link */}
        <div className="mb-5">
          <label className="block text-sm font-medium mb-2">رابط الإجراء (اختياري)</label>
          <Input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="/"
            className="w-full"
            dir="ltr"
          />
          <p className="text-xs text-muted-foreground mt-1">
            عند نقر المستخدم على الإشعار سينتقل إلى هذا الرابط. اتركها <code>/</code> للصفحة الرئيسية.
          </p>
        </div>

        {/* Warning + Send */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-900 leading-relaxed">
            البث الترويجي لا يصل إلا للمستخدمين الذين فعّلوا "العروض والتسويق" من إعدادات حسابهم.
            يمكن لكل مستخدم إلغاء الاشتراك بنقرة واحدة من البريد. التزم بمحتوى مفيد وغير متكرر للحفاظ على سمعة الإرسال.
          </p>
        </div>

        <Button
          onClick={handleSendClick}
          disabled={!formValid || sendMutation.isPending}
          className="w-full gap-2"
        >
          {sendMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
          {sendMutation.isPending ? "جارٍ الإرسال..." : "إرسال البث"}
        </Button>
      </div>

      {/* ─── Last-send banner (success) ───────────────────────── */}
      {lastSentResult && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
          <div className="flex-1 text-sm">
            <p className="font-bold text-green-900">تم إرسال البث بنجاح</p>
            <p className="text-green-700 mt-1">
              وصل إلى <strong>{lastSentResult.recipient_count}</strong> مستخدم.
              {lastSentResult.recipient_count === 0 && " (لم يطابق الفلتر أي مستخدم مفعّل للعروض)"}
            </p>
          </div>
          <button onClick={() => setLastSentResult(null)} className="text-green-700 hover:text-green-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ─── History ───────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-2">
          <History className="w-4 h-4 text-primary" />
          <h3 className="font-bold text-sm">سجل البث السابق</h3>
          <span className="mr-auto text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
            {(history.total || 0).toLocaleString("ar-EG")}
          </span>
        </div>
        <div className="divide-y divide-border">
          {historyLoading ? (
            <div className="p-10 text-center">
              <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" />
            </div>
          ) : history.rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              لم يتم إرسال أي بث بعد
            </div>
          ) : history.rows.map((row) => (
            <div key={row.id} className="p-4 hover:bg-muted/30 transition-colors">
              <div className="flex items-start justify-between gap-3 mb-1">
                <p className="text-sm font-bold">{row.title}</p>
                <span className="text-xs text-muted-foreground shrink-0">
                  {new Date(row.created_at).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" })}
                </span>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{row.message}</p>
              <div className="flex flex-wrap items-center gap-2 text-[10px]">
                <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                  {AUDIENCE_LABELS[row.audience] || row.audience}
                  {row.audience_city ? ` — ${row.audience_city}` : ""}
                </span>
                <span className="bg-muted text-foreground px-2 py-0.5 rounded-full">
                  {row.recipient_count} مستلم
                </span>
                {row.channel_push && (
                  <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Push</span>
                )}
                {row.channel_email && (
                  <span className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">Email</span>
                )}
                <span className="text-muted-foreground mr-auto">بواسطة: {row.created_by}</span>
              </div>
            </div>
          ))}
        </div>
        {!historyLoading && history.totalPages > 1 && (
          <div className="p-3 border-t border-border">
            <Pagination page={page} totalPages={history.totalPages} onChange={setPage} />
          </div>
        )}
      </div>

      {/* ─── Confirmation modal ───────────────────────────────── */}
      {confirmOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => !sendMutation.isPending && setConfirmOpen(false)}
        >
          <div
            className="bg-card rounded-2xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              <h3 className="font-bold">تأكيد إرسال البث</h3>
            </div>
            <div className="space-y-3 mb-5 text-sm">
              <div>
                <p className="text-muted-foreground text-xs mb-1">العنوان:</p>
                <p className="font-bold">{title}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-1">الرسالة:</p>
                <p className="text-foreground line-clamp-3">{message}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">
                  {AUDIENCE_LABELS[audience]}{audience === "by_city" && audienceCity ? ` — ${audienceCity}` : ""}
                </span>
                {channelPush && (
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">Push</span>
                )}
                {channelEmail && (
                  <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded-full">Email</span>
                )}
              </div>
              <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded p-2 leading-relaxed">
                لا يمكن التراجع عن البث بعد الإرسال. سيصل لكل مستخدم متطابق مع الفلتر.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => setConfirmOpen(false)}
                variant="outline"
                disabled={sendMutation.isPending}
                className="flex-1"
              >
                إلغاء
              </Button>
              <Button
                onClick={() => sendMutation.mutate()}
                disabled={sendMutation.isPending}
                className="flex-1 gap-2"
              >
                {sendMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                تأكيد الإرسال
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
