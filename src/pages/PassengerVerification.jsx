import React, { useState, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { useSEO } from "@/hooks/useSEO";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { notifyAdmin } from "@/lib/notifyAdmin";
import { logAudit } from "@/lib/adminAudit";
import { toast } from "sonner";
import {
  ArrowLeft, ShieldCheck, AlertCircle, Clock, CheckCircle2,
  Camera, Upload, X, FileImage, Loader2, RefreshCw
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * PassengerVerification — passenger ID verification page.
 *
 * State machine driven by the row in passenger_verifications:
 *   - No row             → "submit" form
 *   - status='pending'   → "under review" status card + photos preview
 *   - status='approved'  → "verified" success card (no form)
 *   - status='rejected'  → rejection reason + resubmit form
 *   - status='revoked'   → revocation notice + resubmit form
 *
 * Photos:
 *   - Uploaded directly to Supabase Storage (uploads-private bucket)
 *     under passenger-verifications/{user_id}/<filename>.
 *   - Storage RLS (migration 020) enforces user-can-only-touch-own-folder
 *     and admin-can-read-all.
 *   - Path stored on the row; admin viewer requests signed URLs at
 *     review time (5-min TTL — see DashboardPassengerVerifications).
 *
 * Privacy posture surfaced inline so the user knows what they're
 * agreeing to before they submit.
 */

const BUCKET = "uploads-private";

export default function PassengerVerification() {
  useSEO({
    title: "توثيق هوية الراكب",
    description: "وثّق هويتك لتتمكن من نشر طلبات الرحلات في مشوارو",
  });

  const navigate = useNavigate();
  const qc       = useQueryClient();
  const { user, isAuthenticated, isLoadingAuth } = useAuth();

  if (!isLoadingAuth && !isAuthenticated) {
    navigate("/login?returnTo=/verify-passenger", { replace: true });
    return null;
  }

  // ─── Existing verification state ────────────────────────────
  const { data: existing, isLoading } = useQuery({
    queryKey: ["my-passenger-verification", user?.email],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("passenger_verifications")
        .select("*")
        .eq("user_email", user.email)
        .maybeSingle();
      if (error && error.code !== "PGRST116") throw error;
      return data;
    },
    enabled: !!user?.email,
    staleTime: 15_000,
  });

  // Form state
  const [fullName, setFullName] = useState("");
  const [idFrontFile, setIdFrontFile] = useState(null);
  const [idBackFile,  setIdBackFile]  = useState(null);
  const [selfieFile,  setSelfieFile]  = useState(null);
  const [submissionNote, setSubmissionNote] = useState("");
  const [agreed, setAgreed] = useState(false);

  // Submit
  const submitMutation = useMutation({
    mutationFn: async () => {
      // Upload files to storage
      const uid = user.id;
      const stamp = Date.now();
      const upload = async (file, label) => {
        if (!file) return null;
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const path = `passenger-verifications/${uid}/${label}-${stamp}.${ext}`;
        const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
          cacheControl: "3600",
          upsert: true,
          contentType: file.type || "image/jpeg",
        });
        if (error) throw error;
        return path;
      };

      const [idFrontPath, idBackPath, selfiePath] = await Promise.all([
        upload(idFrontFile, "id-front"),
        upload(idBackFile,  "id-back"),
        upload(selfieFile,  "selfie"),
      ]);

      const { data, error } = await supabase.rpc("submit_passenger_verification", {
        p_full_name_on_id: fullName,
        p_id_front_url:    idFrontPath,
        p_id_back_url:     idBackPath,
        p_selfie_url:      selfiePath,
        p_submission_note: submissionNote || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("تم استلام طلب التوثيق! سنراجعه خلال 24-48 ساعة 🛡️");
      qc.invalidateQueries({ queryKey: ["my-passenger-verification"] });
      qc.invalidateQueries({ queryKey: ["is-passenger-verified"] });
      // Notify admin asynchronously — failure doesn't impact the user flow.
      // Link sends the admin straight to the verification queue tab when
      // they tap the bell row.
      notifyAdmin({
        title:   "طلب توثيق راكب جديد 🛡️",
        message: `${user?.full_name || user?.email} أرسل طلب توثيق هوية. اضغط لمراجعة الطلب.`,
        link:    "/dashboard?tab=passenger-verifications",
      }).catch(() => { /* non-fatal */ });
      // Audit log — verification submissions are a major user
      // action. Previously the admin only saw them in the dashboard
      // queue, not in the activity feed. Now both surfaces have it.
      logAudit("passenger_verification_submitted", "passenger_verification", null, {
        user_email: user?.email,
      });
    },
    onError: (err) => toast.error(friendlyError(err, "تعذر إرسال طلب التوثيق")),
  });

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center" dir="rtl">
        <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
      </div>
    );
  }

  // ─── Approved state ─────────────────────────────────────────
  if (existing?.status === "approved") {
    return (
      <Container>
        <div className="bg-gradient-to-br from-green-500 to-emerald-600 text-white rounded-2xl p-6 text-center">
          <div className="w-16 h-16 mx-auto bg-white/20 rounded-2xl flex items-center justify-center mb-4">
            <CheckCircle2 className="w-9 h-9" />
          </div>
          <h2 className="text-2xl font-bold mb-2">حسابك موثّق ✓</h2>
          <p className="text-sm opacity-95 leading-relaxed">
            تم التحقق من هويتك بنجاح. يمكنك الآن نشر طلبات الرحلات.
          </p>
          <Link to="/request-trip">
            <Button className="mt-5 bg-white text-green-700 hover:bg-white/90 font-bold">
              اطلب رحلة الآن
            </Button>
          </Link>
        </div>
        <PrivacyNote />
      </Container>
    );
  }

  // ─── Pending state ──────────────────────────────────────────
  if (existing?.status === "pending") {
    return (
      <Container>
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-800 rounded-2xl p-6">
          <div className="flex items-start gap-3">
            <Clock className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h2 className="text-lg font-bold text-amber-900 dark:text-amber-200 mb-1">
                قيد المراجعة
              </h2>
              <p className="text-sm text-amber-800 dark:text-amber-300 leading-relaxed">
                طلب التوثيق الخاص بك قيد المراجعة من قبل فريق الإدارة. عادةً يتم
                الرد خلال 24-48 ساعة. سنرسل لك إشعاراً فور صدور القرار.
              </p>
              <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-3">
                أُرسل في:{" "}
                {existing.submitted_at && new Date(existing.submitted_at).toLocaleDateString("ar-EG", { day:"numeric", month:"long", year:"numeric" })}
              </p>
            </div>
          </div>
        </div>
        <PrivacyNote />
      </Container>
    );
  }

  // ─── Submission / Resubmission form ─────────────────────────
  const isResubmit = existing && (existing.status === "rejected" || existing.status === "revoked");

  return (
    <Container>
      {/* Hero */}
      <div className="bg-gradient-to-br from-primary to-primary/70 text-primary-foreground rounded-2xl p-5 mb-5">
        <div className="flex items-center gap-3 mb-2">
          <ShieldCheck className="w-7 h-7" />
          <h1 className="text-2xl font-bold">توثيق الهوية</h1>
        </div>
        <p className="text-sm opacity-95 leading-relaxed">
          نطلب توثيق هويتك لحماية السائقين والمنصة من البلاغات الكاذبة. التوثيق
          مطلوب مرة واحدة فقط، وتبقى صورك خاصة لا تظهر لأي مستخدم آخر.
        </p>
      </div>

      {/* Rejection notice (if resubmitting) */}
      {isResubmit && existing?.rejection_reason && (
        <div className="bg-destructive/5 border border-destructive/30 rounded-2xl p-4 mb-5">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-bold text-destructive mb-1">
                {existing.status === "revoked" ? "تم إلغاء التوثيق" : "تم رفض الطلب السابق"}
              </p>
              <p className="text-xs text-destructive/90 leading-relaxed">
                <strong>السبب:</strong> {existing.rejection_reason}
              </p>
              <p className="text-[11px] text-muted-foreground mt-2">
                يمكنك إعادة الإرسال بعد معالجة المشكلة.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-2xl p-5 space-y-5">
        {/* Full name on ID */}
        <div>
          <Label className="mb-1.5 block">الاسم الرباعي كما يظهر على الهوية</Label>
          <Input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="مثال: أحمد محمد علي حسن"
            maxLength={200}
          />
        </div>

        {/* ID front */}
        <PhotoField
          label="صورة الهوية — الوجه الأمامي"
          required
          file={idFrontFile}
          onChange={setIdFrontFile}
          hint="تأكد من وضوح الاسم والصورة وجميع الحواف"
        />

        {/* ID back (optional) */}
        <PhotoField
          label="صورة الهوية — الوجه الخلفي (اختياري)"
          file={idBackFile}
          onChange={setIdBackFile}
          hint="مساعد للتحقق إذا كانت المعلومات على الخلف"
        />

        {/* Selfie */}
        <PhotoField
          label="صورة شخصية مع الهوية"
          required
          file={selfieFile}
          onChange={setSelfieFile}
          hint="صورة لك وأنت تمسك الهوية بحيث يظهر وجهك والهوية بوضوح"
        />

        {/* Optional note */}
        <div>
          <Label className="mb-1.5 block">ملاحظات للإدارة (اختياري)</Label>
          <textarea
            value={submissionNote}
            onChange={(e) => setSubmissionNote(e.target.value)}
            placeholder="إذا كان هناك ما تود توضيحه..."
            maxLength={500}
            rows={2}
            className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />
        </div>

        {/* Privacy agreement */}
        <label className="flex items-start gap-2 cursor-pointer p-3 bg-muted/40 rounded-xl">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-1 w-4 h-4 accent-primary"
          />
          <span className="text-xs text-foreground leading-relaxed">
            أوافق على معالجة بياناتي وفق{" "}
            <Link to="/privacy" className="text-primary underline">سياسة الخصوصية</Link>،
            وأقرّ بأن المعلومات والصور المُقدَّمة صحيحة وتخصني.
          </span>
        </label>

        <Button
          onClick={() => submitMutation.mutate()}
          disabled={!fullName.trim() || !idFrontFile || !selfieFile || !agreed || submitMutation.isPending}
          className="w-full h-12 text-base font-bold gap-2"
        >
          {submitMutation.isPending ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> جاري الإرسال...</>
          ) : isResubmit ? (
            <><RefreshCw className="w-4 h-4" /> إعادة إرسال</>
          ) : (
            <><ShieldCheck className="w-4 h-4" /> إرسال للمراجعة</>
          )}
        </Button>
      </div>

      <PrivacyNote />
    </Container>
  );
}

function Container({ children }) {
  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-28" dir="rtl">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="w-4 h-4 rotate-180" />
        رجوع للرئيسية
      </Link>
      {children}
    </div>
  );
}

function PhotoField({ label, required, file, onChange, hint }) {
  const inputRef = useRef(null);
  const [preview, setPreview] = useState(null);

  React.useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const handle = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) {
      toast.error("يرجى اختيار صورة (JPG/PNG/WebP)");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      toast.error("الصورة كبيرة جداً (الحد الأقصى 10 ميجابايت)");
      return;
    }
    onChange(f);
  };

  return (
    <div>
      <Label className="mb-1.5 flex items-center justify-between">
        <span>
          {label}
          {required && <span className="text-destructive mr-1">*</span>}
        </span>
        {file && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-xs text-muted-foreground hover:text-destructive"
          >
            <X className="w-3.5 h-3.5 inline" /> إزالة
          </button>
        )}
      </Label>

      {preview ? (
        <div className="relative bg-muted rounded-xl overflow-hidden border border-border">
          <img src={preview} alt="" className="w-full max-h-64 object-contain" />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full border-2 border-dashed border-border hover:border-primary rounded-xl p-6 text-center transition-colors"
        >
          <Camera className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm font-medium text-foreground">اختر صورة</p>
          {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp"
        onChange={handle}
        className="hidden"
      />
    </div>
  );
}

function PrivacyNote() {
  return (
    <div className="bg-muted/40 rounded-xl p-4 mt-5 text-xs text-muted-foreground leading-relaxed space-y-1.5">
      <p className="font-bold text-foreground">🔒 خصوصيتك محمية</p>
      <p>• الصور مخزنة في خوادم خاصة، لا تظهر لأي مستخدم آخر إطلاقاً</p>
      <p>• الإدارة فقط ترى الصور أثناء المراجعة لمدة قصيرة</p>
      <p>• لا نخزّن رقم الهوية في قاعدة البيانات — فقط الاسم للتحقق</p>
      <p>• عند حذف حسابك، تُحذف الصور والسجل بالكامل تلقائياً</p>
    </div>
  );
}
