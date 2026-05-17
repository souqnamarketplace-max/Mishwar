/**
 * DashboardCities — admin review page for user-suggested cities.
 *
 * Three views via tabs:
 *   pending  — new suggestions awaiting review (default)
 *   approved — already approved (with their coordinates) for audit
 *   rejected — rejected with reason for audit
 *
 * Approve flow:
 *   1. Admin clicks "موافقة" on a row.
 *   2. Modal opens with: canonical name (defaults to suggested name),
 *      Google Maps URL paste box (auto-extracts lat/lng), or manual
 *      lat/lng inputs, optional governorate.
 *   3. Submit calls approve_city_suggestion RPC which atomically:
 *        - inserts admin_cities row with the coords
 *        - marks suggestion approved
 *        - links them via approved_city_id
 *   4. The new city appears in autocomplete for ALL users within 5min
 *      (next staleTime refresh) — no code deploy.
 *
 * Reject flow:
 *   1. Admin clicks "رفض" — modal asks for optional reason.
 *   2. Submit calls reject_city_suggestion RPC.
 *   3. Same name can be re-suggested later (e.g., spelling correction).
 */
import React, { useState } from "react";
import ModalPortal from "@/components/shared/ModalPortal";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MapPin, CheckCircle2, XCircle, Clock, ExternalLink, X, Plus, AlertCircle } from "lucide-react";
import Pagination from "@/components/dashboard/Pagination";
import { friendlyError } from "@/lib/errors";
import { logAdminAction } from "@/lib/adminAudit";
import { formatArabicDate } from "@/lib/validation";
import { useConfirm } from "@/hooks/useConfirm";

/**
 * Extract lat/lng from a Google Maps URL.
 *
 * Google Maps URLs have two coord patterns:
 *   "@LAT,LNG,ZOOMz"  — viewport center (lower precision, present in
 *                        the path right after place name)
 *   "!3dLAT!4dLNG"    — actual place coordinates (higher precision,
 *                        in the data parameter further down)
 *
 * We prefer !3d!4d when available, fall back to @ syntax.
 *
 * Returns { lat, lng } as numbers, or null if no coords found.
 *
 * Examples that work:
 *   https://www.google.com/maps/place/Foo/@32.07,35.23,15z/data=!3m1!4b1!4m6!3m5!1s.../!8m2!3d32.0707!4d35.2420
 *   https://maps.app.goo.gl/abc → won't extract (short link); admin must
 *     follow the redirect first or use the long URL.
 */
function extractCoordsFromMapsUrl(url) {
  if (!url || typeof url !== "string") return null;

  // Prefer !3d!4d (actual place coords)
  const placeMatch = url.match(/!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/);
  if (placeMatch) {
    const lat = parseFloat(placeMatch[1]);
    const lng = parseFloat(placeMatch[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  }

  // Fall back to @LAT,LNG,ZOOMz
  const viewportMatch = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (viewportMatch) {
    const lat = parseFloat(viewportMatch[1]);
    const lng = parseFloat(viewportMatch[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  }

  return null;
}

const STATUS_CONFIG = {
  pending:  { label: "قيد المراجعة", icon: Clock,        cls: "bg-yellow-500/10 text-yellow-600" },
  approved: { label: "موافق عليها",  icon: CheckCircle2, cls: "bg-green-500/10 text-green-600" },
  rejected: { label: "مرفوضة",       icon: XCircle,      cls: "bg-destructive/10 text-destructive" },
};

export default function DashboardCities() {
  const qc = useQueryClient();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [view, setView] = useState("pending");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;
  const [approveModal, setApproveModal] = useState(null); // { row } when open
  const [rejectModal,  setRejectModal]  = useState(null); // { row } when open

  const setViewAndReset = (v) => { setView(v); setPage(1); };

  // ── Suggestions query ───────────────────────────────────────────────
  const { data: suggData = { rows: [], total: 0, totalPages: 1 }, isLoading } = useQuery({
    queryKey: ["city-suggestions", view, page],
    queryFn: async () => {
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data, count, error } = await supabase
        .from("city_suggestions")
        .select("*", { count: "exact" })
        .eq("status", view)
        // Show highest-duplicate-count first within pending so most-requested
        // suggestions float to the top — clearer admin priority signal.
        .order(view === "pending" ? "duplicate_count" : "reviewed_at", { ascending: false })
        .order("created_at", { ascending: false })
        .range(from, to);
      if (error) throw error;
      return {
        rows: data ?? [],
        total: count ?? 0,
        totalPages: Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE)),
      };
    },
  });
  const rows = suggData.rows;
  const totalPages = suggData.totalPages;
  const totalForView = suggData.total;

  // ── Counts for tab badges ───────────────────────────────────────────
  const { data: counts = { pending: 0, approved: 0, rejected: 0 } } = useQuery({
    queryKey: ["city-suggestions-counts"],
    queryFn: async () => {
      const make = (status) => supabase
        .from("city_suggestions")
        .select("*", { count: "exact", head: true })
        .eq("status", status);
      const [p, a, r] = await Promise.all([
        make("pending"), make("approved"), make("rejected"),
      ]);
      return {
        pending:  p.count ?? 0,
        approved: a.count ?? 0,
        rejected: r.count ?? 0,
      };
    },
    staleTime: 30_000,
  });

  // ── Approved cities (the ones already in admin_cities) ─────────────
  // Shown as a separate panel below the queue so admin can see the
  // running list of cities they've added and edit/delete if needed.
  const { data: adminCitiesData = { rows: [], total: 0, totalPages: 1 } } = useQuery({
    queryKey: ["admin-cities-list"],
    queryFn: async () => {
      const { data, count, error } = await supabase
        .from("admin_cities")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return { rows: data ?? [], total: count ?? 0, totalPages: 1 };
    },
    staleTime: 60_000,
    enabled: view === "approved",
  });

  // ── Mutations ───────────────────────────────────────────────────────
  const approveMut = useMutation({
    mutationFn: async ({ id, canonicalName, lat, lng, governorate }) => {
      const { data, error } = await supabase.rpc("approve_city_suggestion", {
        p_suggestion_id: id,
        p_canonical_name: canonicalName,
        p_lat: lat,
        p_lng: lng,
        p_governorate: governorate || null,
      });
      if (error) throw error;
      await logAdminAction("city_suggestion_approved", "city_suggestion", id, {
        canonical_name: canonicalName,
        lat, lng,
        admin_city_id: data,
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["city-suggestions"] });
      qc.invalidateQueries({ queryKey: ["city-suggestions-counts"] });
      qc.invalidateQueries({ queryKey: ["admin-cities-list"] });
      qc.invalidateQueries({ queryKey: ["admin-approved-cities"] });
      setApproveModal(null);
      toast.success("تمت الموافقة وأُضيفت المدينة ✓");
    },
    onError: (err) => {
      const msg = err?.message || "";
      if (/admin_cities_name_key|duplicate key/i.test(msg)) {
        toast.error("هذه المدينة موجودة بالفعل في القائمة");
      } else if (/lat_bounds|lng_bounds/i.test(msg)) {
        toast.error("الإحداثيات خارج النطاق المسموح به");
      } else {
        toast.error(friendlyError(err, "فشلت الموافقة"));
      }
    },
  });

  const rejectMut = useMutation({
    mutationFn: async ({ id, reason }) => {
      const { error } = await supabase.rpc("reject_city_suggestion", {
        p_suggestion_id: id,
        p_reason: reason || null,
      });
      if (error) throw error;
      await logAdminAction("city_suggestion_rejected", "city_suggestion", id, { reason });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["city-suggestions"] });
      qc.invalidateQueries({ queryKey: ["city-suggestions-counts"] });
      setRejectModal(null);
      toast.success("تم رفض الاقتراح");
    },
    onError: (err) => toast.error(friendlyError(err, "فشل الرفض")),
  });

  const deleteCityMut = useMutation({
    mutationFn: async ({ id }) => {
      const { error } = await supabase.from("admin_cities").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-cities-list"] });
      qc.invalidateQueries({ queryKey: ["admin-approved-cities"] });
      toast.success("تم الحذف");
    },
    onError: (err) => toast.error(friendlyError(err, "فشل الحذف")),
  });

  return (
    <div dir="rtl" className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <MapPin className="w-6 h-6 text-primary" />
          المدن المقترحة
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          راجع المدن والقرى التي اقترحها المستخدمون وأضف إحداثياتها لتظهر في قائمة المدن لجميع المستخدمين.
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="قيد المراجعة" value={counts.pending}  color="text-yellow-600" alert={counts.pending > 0} />
        <StatCard label="موافق عليها"  value={counts.approved} color="text-green-600" />
        <StatCard label="مرفوضة"        value={counts.rejected} color="text-muted-foreground" />
      </div>

      {/* View tabs */}
      <div className="flex gap-2 flex-wrap">
        <ViewTab id="pending"  active={view} onChange={setViewAndReset}
          label={`قيد المراجعة${counts.pending > 0 ? ` (${counts.pending})` : ""}`}
          alert={counts.pending > 0} />
        <ViewTab id="approved" active={view} onChange={setViewAndReset} label={`موافق عليها (${counts.approved})`} />
        <ViewTab id="rejected" active={view} onChange={setViewAndReset} label={`مرفوضة (${counts.rejected})`} />
      </div>

      {/* Empty / loading / list */}
      {isLoading ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center text-muted-foreground">
          جاري التحميل...
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center">
          <MapPin className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-muted-foreground">
            {view === "pending"  && "لا توجد اقتراحات قيد المراجعة"}
            {view === "approved" && "لم تتم الموافقة على اقتراحات بعد"}
            {view === "rejected" && "لا توجد اقتراحات مرفوضة"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <SuggestionCard
              key={row.id}
              row={row}
              onApprove={() => setApproveModal({ row })}
              onReject={() => setRejectModal({ row })}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      )}

      {/* Approved cities — visible only on the approved tab */}
      {view === "approved" && adminCitiesData.rows.length > 0 && (
        <div className="bg-card border border-border rounded-2xl p-4 mt-6">
          <h3 className="font-bold text-sm mb-3 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-primary" />
            المدن المُضافة من الإدارة ({adminCitiesData.total})
          </h3>
          <p className="text-xs text-muted-foreground mb-3">
            هذه المدن تظهر تلقائياً في القائمة لجميع المستخدمين. يمكنك حذف أي مدينة إذا أُضيفت بالخطأ.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {adminCitiesData.rows.map((city) => (
              <div key={city.id} className="bg-muted/30 rounded-lg p-3 flex items-start gap-3">
                <MapPin className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm truncate">{city.name}</p>
                  <p className="text-[11px] text-muted-foreground font-mono">
                    {Number(city.lat).toFixed(4)}, {Number(city.lng).toFixed(4)}
                  </p>
                  {city.governorate && (
                    <p className="text-[11px] text-muted-foreground">{city.governorate}</p>
                  )}
                </div>
                <button
                  onClick={async () => {
                    const ok = await confirm({
                      title: "حذف المدينة",
                      message: `هل أنت متأكد من حذف "${city.name}"؟ سيؤثر ذلك على الرحلات والسائقين المرتبطين بهذه المدينة.`,
                      confirmLabel: "حذف",
                      destructive: true,
                    });
                    if (ok) deleteCityMut.mutate({ id: city.id });
                  }}
                  className="text-destructive hover:opacity-70 p-1"
                  aria-label={`حذف ${city.name}`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modals */}
      {approveModal && (
        <ApproveModal
          row={approveModal.row}
          onClose={() => setApproveModal(null)}
          onSubmit={(data) => approveMut.mutate({ id: approveModal.row.id, ...data })}
          submitting={approveMut.isPending}
        />
      )}
      {rejectModal && (
        <RejectModal
          row={rejectModal.row}
          onClose={() => setRejectModal(null)}
          onSubmit={(reason) => rejectMut.mutate({ id: rejectModal.row.id, reason })}
          submitting={rejectMut.isPending}
        />
      )}
      {confirmDialog}
    </div>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────

function StatCard({ label, value, color, alert }) {
  return (
    <div className={`bg-card rounded-xl border ${alert ? "border-yellow-500/40" : "border-border"} p-4`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-black mt-1 ${color}`}>{value.toLocaleString("ar-EG")}</p>
    </div>
  );
}

function ViewTab({ id, active, onChange, label, alert }) {
  return (
    <button
      onClick={() => onChange(id)}
      className={`px-4 py-2 rounded-xl text-sm whitespace-nowrap transition-colors relative ${
        active === id
          ? "bg-primary text-primary-foreground"
          : "bg-muted/50 text-muted-foreground hover:bg-muted"
      }`}
    >
      {label}
      {alert && active !== id && (
        <span className="absolute top-1 left-1 w-2 h-2 bg-yellow-500 rounded-full" />
      )}
    </button>
  );
}

function SuggestionCard({ row, onApprove, onReject }) {
  const sc = STATUS_CONFIG[row.status] || STATUS_CONFIG.pending;
  const Icon = sc.icon;
  const isPending = row.status === "pending";

  return (
    <div className="bg-card border border-border rounded-2xl p-4">
      <div className="flex items-start gap-3 mb-2">
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <MapPin className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-base">{row.name}</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full ${sc.cls}`}>
              <Icon className="w-3 h-3 inline ml-0.5" />
              {sc.label}
            </span>
            {row.duplicate_count > 1 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600">
                طُلبت {row.duplicate_count} مرات
              </span>
            )}
          </div>
          {row.notes && (
            <p className="text-sm text-muted-foreground mt-1.5">{row.notes}</p>
          )}
          <div className="text-[11px] text-muted-foreground mt-2 flex items-center gap-2 flex-wrap">
            {row.suggested_by_email && <span>👤 {row.suggested_by_email}</span>}
            <span>📅 {formatArabicDate(row.created_at)}</span>
            {row.original_input && row.original_input !== row.name && (
              <span className="font-mono">📝 الكتابة الأصلية: "{row.original_input}"</span>
            )}
          </div>
          {row.status === "rejected" && row.rejection_reason && (
            <p className="text-xs text-destructive mt-2 bg-destructive/5 rounded-lg px-2 py-1.5">
              سبب الرفض: {row.rejection_reason}
            </p>
          )}
        </div>
      </div>

      {isPending && (
        <div className="flex gap-2 mt-3 border-t border-border pt-3">
          <Button onClick={onReject} variant="outline" size="sm" className="rounded-xl gap-1">
            <XCircle className="w-3.5 h-3.5" /> رفض
          </Button>
          <Button onClick={onApprove} size="sm" className="rounded-xl gap-1 mr-auto bg-primary text-primary-foreground">
            <CheckCircle2 className="w-3.5 h-3.5" /> موافقة وإضافة الإحداثيات
          </Button>
        </div>
      )}
    </div>
  );
}

function ApproveModal({ row, onClose, onSubmit, submitting }) {
  const [canonicalName, setCanonicalName] = useState(row.name);
  const [mapsUrl, setMapsUrl] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [governorate, setGovernorate] = useState("");
  const [extractError, setExtractError] = useState("");

  const handleUrlPaste = (url) => {
    setMapsUrl(url);
    if (!url.trim()) {
      setExtractError("");
      return;
    }
    const coords = extractCoordsFromMapsUrl(url);
    if (coords) {
      setLat(coords.lat.toFixed(6));
      setLng(coords.lng.toFixed(6));
      setExtractError("");
    } else {
      setExtractError("لم نستطع استخراج الإحداثيات من الرابط. قد تحتاج لاستخدام الرابط الكامل بدلاً من المختصر.");
    }
  };

  const handleSubmit = () => {
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (!canonicalName.trim()) {
      toast.error("يرجى كتابة اسم المدينة");
      return;
    }
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      toast.error("يرجى إدخال إحداثيات صحيحة");
      return;
    }
    // West Bank reasonable bounds — gives a friendly error before the
    // server-side CHECK constraint rejects it
    if (latNum < 31.0 || latNum > 33.0 || lngNum < 34.5 || lngNum > 36.0) {
      const ok = confirm("الإحداثيات خارج النطاق المعتاد للضفة الغربية. هل أنت متأكد؟");
      if (!ok) return;
    }
    onSubmit({
      canonicalName: canonicalName.trim(),
      lat: latNum,
      lng: lngNum,
      governorate: governorate.trim(),
    });
  };

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose} dir="rtl">
      <div className="bg-card rounded-2xl border border-border max-w-lg w-full p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-primary" />
            موافقة على الاقتراح
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded-lg" aria-label="إغلاق">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-3 mb-4 text-xs text-muted-foreground leading-relaxed">
          الطريقة الأسهل: ابحث عن المدينة على{" "}
          <a href="https://maps.google.com" target="_blank" rel="noopener noreferrer" className="text-primary font-bold hover:underline inline-flex items-center gap-0.5">
            خرائط Google
            <ExternalLink className="w-3 h-3" />
          </a>
          {" "}ثم انسخ الرابط من شريط العنوان والصقه أدناه — سنستخرج الإحداثيات تلقائياً.
        </div>

        <label className="block mb-3">
          <span className="text-xs text-muted-foreground mb-1 block">الاسم الرسمي للمدينة *</span>
          <input
            type="text"
            value={canonicalName}
            onChange={(e) => setCanonicalName(e.target.value)}
            maxLength={100}
            className="w-full bg-muted/40 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <span className="text-[11px] text-muted-foreground mt-1 block">
            يمكنك تعديل الكتابة لتطابق الإملاء الرسمي (المستخدم اقترح: "{row.name}")
          </span>
        </label>

        <label className="block mb-3">
          <span className="text-xs text-muted-foreground mb-1 block">رابط Google Maps (الصق هنا)</span>
          <input
            type="text"
            value={mapsUrl}
            onChange={(e) => handleUrlPaste(e.target.value)}
            placeholder="https://www.google.com/maps/place/..."
            className="w-full bg-muted/40 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary font-mono"
          />
          {extractError && (
            <span className="text-[11px] text-yellow-600 mt-1 block flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {extractError}
            </span>
          )}
        </label>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <label className="block">
            <span className="text-xs text-muted-foreground mb-1 block">خط العرض (Latitude) *</span>
            <input
              type="number"
              step="any"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              placeholder="32.000000"
              className="w-full bg-muted/40 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary font-mono"
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground mb-1 block">خط الطول (Longitude) *</span>
            <input
              type="number"
              step="any"
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              placeholder="35.000000"
              className="w-full bg-muted/40 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary font-mono"
            />
          </label>
        </div>

        <label className="block mb-4">
          <span className="text-xs text-muted-foreground mb-1 block">المحافظة (اختياري)</span>
          <input
            type="text"
            value={governorate}
            onChange={(e) => setGovernorate(e.target.value)}
            placeholder="مثال: نابلس، رام الله، الخليل..."
            className="w-full bg-muted/40 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </label>

        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting} className="flex-1 rounded-xl">
            إلغاء
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !lat || !lng} className="flex-1 bg-primary text-primary-foreground rounded-xl">
            {submitting ? "جاري الإضافة..." : "موافقة وإضافة"}
          </Button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}

function RejectModal({ row, onClose, onSubmit, submitting }) {
  const [reason, setReason] = useState("");
  return (
    <ModalPortal>
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose} dir="rtl">
      <div className="bg-card rounded-2xl border border-border max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <XCircle className="w-5 h-5 text-destructive" />
            رفض الاقتراح
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded-lg" aria-label="إغلاق">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-sm text-muted-foreground mb-3">
          سيتم رفض الاقتراح لـ <span className="font-bold text-foreground">"{row.name}"</span>.
        </p>
        <label className="block mb-4">
          <span className="text-xs text-muted-foreground mb-1 block">سبب الرفض (اختياري — للسجل فقط)</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={300}
            placeholder="مثال: الاسم غير دقيق، مكرر، بحاجة لتوضيح..."
            className="w-full bg-muted/40 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary resize-none"
          />
        </label>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting} className="flex-1 rounded-xl">
            إلغاء
          </Button>
          <Button onClick={() => onSubmit(reason.trim())} disabled={submitting} className="flex-1 bg-destructive text-destructive-foreground rounded-xl">
            {submitting ? "جاري الرفض..." : "تأكيد الرفض"}
          </Button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
