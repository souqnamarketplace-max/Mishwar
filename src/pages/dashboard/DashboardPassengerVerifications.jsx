import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { logAdminAction } from "@/lib/adminAudit";
import { toast } from "sonner";
import { ShieldCheck, Search, Loader2, CheckCircle2, X, Eye, AlertTriangle, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/**
 * DashboardPassengerVerifications — admin review queue.
 *
 * Photos are stored in the private uploads-private bucket. Admin gets
 * 5-minute signed URLs (Supabase storage createSignedUrl) on demand
 * when expanding a row, so we never bake long-lived URLs into the DOM.
 *
 * Decisions go through admin_review_passenger_verification RPC which
 * enforces admin role server-side + writes the audit fields. Each
 * decision also fires:
 *   - logAdminAction (admin_audit_log table)
 *   - Notification to the user (approval / rejection with reason)
 */

const STATUS_FILTERS = [
  { id: "pending",  label: "قيد المراجعة" },
  { id: "approved", label: "موثّقة" },
  { id: "rejected", label: "مرفوضة" },
  { id: "revoked",  label: "ملغاة" },
  { id: "all",      label: "الكل" },
];

export default function DashboardPassengerVerifications() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("pending");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["admin-passenger-verifications", filter, search],
    queryFn: async () => {
      let q = supabase.from("passenger_verifications").select("*").order("submitted_at", { ascending: false }).limit(200);
      if (filter !== "all") q = q.eq("status", filter);
      if (search) q = q.or(`user_email.ilike.%${search}%,full_name_on_id.ilike.%${search}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    staleTime: 15_000,
  });

  // Counts by status for tile display
  const { data: counts = {} } = useQuery({
    queryKey: ["admin-passenger-verifications-counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("passenger_verifications")
        .select("status");
      if (error) throw error;
      const c = { pending: 0, approved: 0, rejected: 0, revoked: 0 };
      for (const r of (data || [])) {
        if (c[r.status] != null) c[r.status]++;
      }
      return c;
    },
    staleTime: 30_000,
  });

  return (
    <div dir="rtl" className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground">توثيق الركاب</h1>
        <p className="text-sm text-muted-foreground mt-1">
          مراجعة طلبات توثيق هوية الركاب — مطلوب قبل نشر طلبات الرحلات
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="قيد المراجعة" value={counts.pending  || 0} color="text-amber-600"  bg="bg-amber-500/10" urgent={counts.pending > 0} />
        <StatTile label="موثّقة"        value={counts.approved || 0} color="text-green-600"  bg="bg-green-500/10" />
        <StatTile label="مرفوضة"        value={counts.rejected || 0} color="text-destructive" bg="bg-destructive/10" />
        <StatTile label="ملغاة"         value={counts.revoked  || 0} color="text-muted-foreground" bg="bg-muted/40" />
      </div>

      {/* Filters */}
      <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filter === f.id ? "bg-primary text-primary-foreground" : "bg-muted/50 text-foreground hover:bg-muted"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث بالبريد أو الاسم..."
            className="pr-10"
          />
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-12 text-center">
          <ShieldCheck className="w-12 h-12 mx-auto text-muted-foreground opacity-40 mb-3" />
          <p className="text-sm text-muted-foreground">لا توجد طلبات تطابق الفلاتر</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map(r => (
            <VerificationRow
              key={r.id}
              row={r}
              expanded={expandedId === r.id}
              onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
              onReviewed={() => {
                qc.invalidateQueries({ queryKey: ["admin-passenger-verifications"] });
                qc.invalidateQueries({ queryKey: ["admin-passenger-verifications-counts"] });
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, color, bg, urgent }) {
  return (
    <div className={`bg-card border rounded-2xl p-4 ${urgent ? "border-amber-500/40" : "border-border"}`}>
      <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center mb-2`}>
        <ShieldCheck className={`w-4 h-4 ${color}`} />
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

function VerificationRow({ row, expanded, onToggle, onReviewed }) {
  const qc = useQueryClient();
  const [decision, setDecision] = useState(null); // 'approved' | 'rejected' | 'revoked'
  const [reason, setReason] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [signedUrls, setSignedUrls] = useState(null);
  const [loadingUrls, setLoadingUrls] = useState(false);

  // Lazily fetch signed URLs only when admin expands the row
  React.useEffect(() => {
    if (!expanded || signedUrls) return;
    (async () => {
      setLoadingUrls(true);
      try {
        const paths = [row.id_front_url, row.id_back_url, row.selfie_url].filter(Boolean);
        const { data, error } = await supabase.storage.from("uploads-private").createSignedUrls(paths, 300); // 5 min TTL
        if (error) throw error;
        const map = {};
        for (const item of (data || [])) {
          map[item.path] = item.signedUrl;
        }
        setSignedUrls(map);
      } catch (err) {
        toast.error(friendlyError(err, "تعذر تحميل الصور"));
      } finally {
        setLoadingUrls(false);
      }
    })();
  }, [expanded, signedUrls, row.id_front_url, row.id_back_url, row.selfie_url]);

  const reviewMutation = useMutation({
    mutationFn: async () => {
      if (decision === "rejected" && !reason.trim()) {
        throw new Error("rejection reason required");
      }
      const { error } = await supabase.rpc("admin_review_passenger_verification", {
        p_verification_id: row.id,
        p_decision:        decision,
        p_reason:          reason || null,
        p_admin_note:      adminNote || null,
      });
      if (error) throw error;

      // Audit log
      try {
        await logAdminAction(
          `passenger_verification_${decision}`,
          "passenger_verification",
          row.id,
          { user_email: row.user_email, reason: reason || null }
        );
      } catch { /* non-fatal */ }

      // Notify the user. Routes through create_notification (migration
      // 027) instead of a direct INSERT into public.notifications:
      //   - Direct INSERT was rejected by the migration 002 RLS policy
      //     (notifications_insert allows the row only when user_email
      //     matches the caller — admin notifying another user fails)
      //   - The custom type ("verification") was ALSO blocked by the
      //     old CHECK constraint that whitelisted only 4 type values
      //     (migration 037 loosens that constraint, but going through
      //     the RPC is still the correct call: it's the single
      //     authorization chokepoint for cross-user notifications, so
      //     a future RLS tweak won't quietly break this path again)
      //   - The `link` column also didn't exist before migration 037,
      //     so the link field on the old direct insert was being
      //     ignored entirely
      // Wrapped in try/catch so a notification failure doesn't roll back
      // the verification decision (which is the actual action).
      try {
        const titles = {
          approved: "تم توثيق هويتك! ✓",
          rejected: "لم يتم قبول طلب التوثيق",
          revoked:  "تم إلغاء توثيق هويتك",
        };
        const messages = {
          approved: "تم التحقق من هويتك بنجاح. يمكنك الآن نشر طلبات الرحلات في مشوارو.",
          rejected: `لم نتمكن من قبول طلب التوثيق. السبب: ${reason}. يمكنك إعادة الإرسال بعد معالجة المشكلة.`,
          revoked:  `تم إلغاء توثيق حسابك. السبب: ${reason || "بقرار من الإدارة"}. للتفاصيل تواصل مع الدعم.`,
        };
        const { error: notifErr } = await supabase.rpc("create_notification", {
          p_user_email: row.user_email,
          p_title:      titles[decision],
          p_message:    messages[decision],
          p_type:       "verification",
          p_trip_id:    null,
          p_link:       decision === "approved" ? "/request-trip" : "/verify-passenger",
        });
        if (notifErr) {
          // Don't swallow silently like the old try/catch did — at least
          // log so future failures surface in Sentry/devtools instead of
          // being invisible the way this bug was.
          console.warn("[verification] notify user failed:", notifErr?.message || notifErr);
        }
      } catch (e) {
        console.warn("[verification] notify user threw:", e?.message || e);
      }
    },
    onSuccess: () => {
      toast.success(decision === "approved" ? "تم اعتماد التوثيق" : decision === "rejected" ? "تم رفض الطلب" : "تم الإلغاء");
      setDecision(null); setReason(""); setAdminNote("");
      onReviewed();
    },
    onError: (err) => toast.error(friendlyError(err, "تعذر تنفيذ الإجراء")),
  });

  const statusColor = {
    pending:  "text-amber-600 bg-amber-500/10",
    approved: "text-green-600 bg-green-500/10",
    rejected: "text-destructive bg-destructive/10",
    revoked:  "text-muted-foreground bg-muted/50",
  }[row.status] || "text-muted-foreground bg-muted/50";

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <button onClick={onToggle} className="w-full text-right p-4 hover:bg-muted/30 transition-colors">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-bold text-foreground truncate">{row.full_name_on_id}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{row.user_email}</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              أُرسل: {new Date(row.submitted_at).toLocaleDateString("ar-EG", { day:"numeric", month:"short", year:"numeric" })}
              {row.resubmit_count > 0 && (
                <> • <span className="text-amber-600 font-bold">إعادة إرسال #{row.resubmit_count}</span></>
              )}
            </p>
          </div>
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusColor}`}>
            {{ pending:"قيد المراجعة", approved:"موثّقة", rejected:"مرفوضة", revoked:"ملغاة" }[row.status]}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border p-4 space-y-4 bg-muted/20">
          {/* Photo viewer */}
          {loadingUrls ? (
            <div className="text-center py-6">
              <Loader2 className="w-6 h-6 mx-auto animate-spin text-primary" />
            </div>
          ) : signedUrls ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <PhotoCard label="الهوية — أمامي"  url={signedUrls[row.id_front_url]} />
              <PhotoCard label="الهوية — خلفي"   url={signedUrls[row.id_back_url]} />
              <PhotoCard label="صورة شخصية"      url={signedUrls[row.selfie_url]} />
            </div>
          ) : null}

          {/* Submission note */}
          {row.submission_note && (
            <div className="bg-card border border-border rounded-xl p-3">
              <p className="text-[11px] font-bold text-muted-foreground mb-1">ملاحظة المستخدم:</p>
              <p className="text-sm text-foreground/90 whitespace-pre-wrap">{row.submission_note}</p>
            </div>
          )}

          {/* Previous decision (read-only when not pending) */}
          {row.status !== "pending" && row.rejection_reason && (
            <div className="bg-destructive/5 border border-destructive/30 rounded-xl p-3">
              <p className="text-[11px] font-bold text-destructive mb-1">سبب القرار السابق:</p>
              <p className="text-sm text-foreground/90">{row.rejection_reason}</p>
              {row.reviewed_by && (
                <p className="text-[10px] text-muted-foreground mt-2">
                  بواسطة {row.reviewed_by} • {new Date(row.reviewed_at).toLocaleDateString("ar-EG", { day:"numeric", month:"short" })}
                </p>
              )}
            </div>
          )}

          {/* Action panel — only for pending or approved (allow revoke) */}
          {(row.status === "pending" || row.status === "approved") && (
            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <p className="text-sm font-bold text-foreground">القرار</p>
              <div className="grid grid-cols-3 gap-2">
                {row.status === "pending" && (
                  <>
                    <ActionButton active={decision === "approved"} onClick={() => setDecision("approved")} label="اعتماد" tone="success" />
                    <ActionButton active={decision === "rejected"} onClick={() => setDecision("rejected")} label="رفض" tone="danger" />
                  </>
                )}
                {row.status === "approved" && (
                  <ActionButton active={decision === "revoked"} onClick={() => setDecision("revoked")} label="إلغاء التوثيق" tone="danger" />
                )}
              </div>

              {(decision === "rejected" || decision === "revoked") && (
                <div>
                  <Label className="text-xs mb-1 block">السبب (يظهر للمستخدم) *</Label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="مثلاً: الصورة غير واضحة، الاسم لا يطابق..."
                    maxLength={500}
                    rows={2}
                    className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
              )}

              <div>
                <Label className="text-xs mb-1 block">ملاحظة داخلية (لا تظهر للمستخدم)</Label>
                <Input
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                  className="text-xs"
                  maxLength={1000}
                />
              </div>

              <Button
                onClick={() => reviewMutation.mutate()}
                disabled={!decision || reviewMutation.isPending}
                className="w-full gap-2"
              >
                {reviewMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> جاري...</>
                ) : decision === "approved" ? (
                  <><CheckCircle2 className="w-4 h-4" /> اعتماد التوثيق</>
                ) : decision === "rejected" ? (
                  <><X className="w-4 h-4" /> رفض الطلب</>
                ) : decision === "revoked" ? (
                  <><AlertTriangle className="w-4 h-4" /> إلغاء التوثيق</>
                ) : (
                  "اختر إجراء"
                )}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PhotoCard({ label, url }) {
  if (!url) return (
    <div className="bg-muted/40 rounded-xl border border-border p-3 text-center text-xs text-muted-foreground">
      {label}<br/><span className="text-[10px]">— غير متوفر —</span>
    </div>
  );
  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <p className="text-[11px] font-bold text-muted-foreground p-2 border-b border-border">{label}</p>
      <a href={url} target="_blank" rel="noopener noreferrer" className="block">
        <img src={url} alt={label} className="w-full h-48 object-contain bg-black/5" loading="lazy" />
      </a>
    </div>
  );
}

function ActionButton({ active, onClick, label, tone }) {
  const tones = {
    success: active ? "bg-green-600 text-white"      : "bg-green-500/10 text-green-700 hover:bg-green-500/20",
    danger:  active ? "bg-destructive text-destructive-foreground" : "bg-destructive/10 text-destructive hover:bg-destructive/20",
  };
  return (
    <button onClick={onClick} className={`py-2 rounded-lg text-sm font-medium transition-colors ${tones[tone]}`}>
      {label}
    </button>
  );
}
