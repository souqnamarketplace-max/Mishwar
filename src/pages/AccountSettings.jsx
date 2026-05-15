import { useSEO } from "@/hooks/useSEO";
import { friendlyError } from "@/lib/errors";
import { todayISO, isFutureOrToday, validatePhone } from "@/lib/validation";
import { compressImage } from "@/lib/compressImage";
import DriverPaymentSetup from "@/components/driver/DriverPaymentSetup";
import PassengerPaymentSetup from "@/components/user/PassengerPaymentSetup";
import { captureException } from "@/lib/sentry";
import { logAdminAction } from "@/lib/adminAudit";
import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { api } from "@/api/apiClient";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Lock, Mail, Phone, Image, Trash2, AlertCircle, CheckCircle, Shield, X, LogOut, Copy } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

export default function AccountSettings() {
  useSEO({ title: "الإعدادات", description: "إعدادات حسابك" });

  const { user } = useAuth();
  const qc = useQueryClient();

  // Email
  const [email, setEmail] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);

  // Password
  const [passwordForm, setPasswordForm] = useState({ current: "", new: "", confirm: "" });
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Phone
  const [phone, setPhone] = useState("");
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [gender, setGender] = useState("");
  const [city, setCity] = useState("");
  const [pendingGender, setPendingGender] = useState("");  // local UI state for the gender dropdown when set-once is available
  const [genderLoading, setGenderLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);

  // Avatar
  const [avatar, setAvatar] = useState(user?.avatar_url || "");
  const [avatarLoading, setAvatarLoading] = useState(false);

  // Sync form with user data
  // Driver License query
  const { data: license } = useQuery({
    queryKey: ["driver-license", user?.email],
    queryFn: () =>
      user?.email
        ? api.entities.DriverLicense.filter({ driver_email: user.email }, "-created_date", 1)
        : [],
    enabled: !!user?.email,
  });

  const driverLicense = license?.[0];
  const [licenseNumber, setLicenseNumber] = useState("");
  const [licenseExpiry, setLicenseExpiry] = useState("");
  const [carRegistrationExpiry, setCarRegistrationExpiry] = useState("");
  const [insuranceExpiry, setInsuranceExpiry] = useState("");
  const [licenseImageUrl, setLicenseImageUrl] = useState("");
  const [carRegistrationUrl, setCarRegistrationUrl] = useState("");
  const [insuranceUrl, setInsuranceUrl] = useState("");
  const [selfie1Url, setSelfie1Url] = useState("");
  const [selfie2Url, setSelfie2Url] = useState("");
  const [licenseLoading, setLicenseLoading] = useState(false);
  // Per-field upload state — same pattern as BecomeDriver.jsx. Lets the
  // 5 license/registration/insurance/selfie inputs run concurrently
  // instead of blocking each other through a shared boolean.
  const [uploadingFields, setUploadingFields] = useState({});

  // Delete account
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletionLoading, setDeletionLoading] = useState(false);
  // New: capture *why* the user is leaving + a typed-confirmation guard so
  // the modal copy ("type 'حذف حسابي' to continue") is no longer a lie.
  const [deletionReason, setDeletionReason] = useState("");
  const [deletionReasonOther, setDeletionReasonOther] = useState("");
  const [deletionConfirmText, setDeletionConfirmText] = useState("");

  useEffect(() => {
    if (user) {
      setEmail(user.email || "");
      setPhone(user.phone || "");
      setAvatar(user.avatar_url || "");
      setGender(user.gender || "");
      setCity(user.city || "");
    }
  }, [user]);

  // ── Account number — fetched DIRECTLY from the profiles table ──────
  // Bypasses api.auth.me's picker logic entirely. The previous approach
  // tried to surface account_number through auth.me's explicit field-
  // list mapping, which has caching layers, deploy-timing risks, and
  // requires every change to propagate through the api shim. Direct
  // fetch via supabase-js means: if the DB has the column populated,
  // the page sees it within ~200ms of mount, end of story.
  const { data: profileRow, refetch: refetchProfileRow } = useQuery({
    queryKey: ["account-number-direct", user?.id],
    enabled: !!user?.id,
    staleTime: 0,        // always treat as stale — we want fresh on every mount
    refetchOnMount: true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("account_number")
        .eq("id", user.id)
        .single();
      if (error) {
        // eslint-disable-next-line no-console
        console.warn("[AccountSettings] direct profile fetch failed:", error);
        captureException(error, { msg: "direct profile fetch failed in AccountSettings" });
        return null;
      }
      // Intentional console output so users hitting this issue can paste
      // the result to support. Once stable, remove this log.
      // eslint-disable-next-line no-console
      console.log("[AccountSettings] account_number from DB:", data?.account_number);
      return data;
    },
  });

  // The value the UI actually displays. Tries:
  //   1. Direct fetch from profiles (most reliable, no picker in the way)
  //   2. Whatever auth.me returned (works if commit 047e771 deployed)
  //   3. null (falls back to the UUID display)
  const accountNumber = profileRow?.account_number ?? user?.account_number ?? null;

  // Self-heal: if the direct fetch came back NULL (column hasn't been
  // populated for this user yet), call ensure_my_account_number RPC
  // and refetch our local query. This works even if React Query's
  // ["me"] cache is stale — we only need our own queryKey to refresh.
  useEffect(() => {
    if (!user?.id) return;
    if (profileRow === undefined) return;            // still loading
    if (profileRow?.account_number != null) return;  // already set
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.rpc("ensure_my_account_number");
        if (cancelled) return;
        if (error) {
          captureException(error, { msg: "ensure_my_account_number RPC failed" });
          // eslint-disable-next-line no-console
          console.warn("[AccountSettings] self-heal RPC failed:", error);
          return;
        }
        // eslint-disable-next-line no-console
        console.log("[AccountSettings] self-heal RPC returned:", data);
        refetchProfileRow();
        qc.invalidateQueries({ queryKey: ["me"] });
      } catch (e) {
        if (!cancelled) captureException(e, { msg: "ensure_my_account_number threw" });
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, profileRow, refetchProfileRow, qc]);

  useEffect(() => {
    if (driverLicense) {
      setLicenseNumber(driverLicense.license_number || "");
      setLicenseExpiry(driverLicense.expiry_date || "");
      setCarRegistrationExpiry(driverLicense.car_registration_expiry_date || "");
      setInsuranceExpiry(driverLicense.insurance_expiry_date || "");
      setLicenseImageUrl(driverLicense.license_image_url || "");
      setCarRegistrationUrl(driverLicense.car_registration_url || "");
      setInsuranceUrl(driverLicense.insurance_url || "");
      setSelfie1Url(driverLicense.selfie_1_url || "");
      setSelfie2Url(driverLicense.selfie_2_url || "");
    }
  }, [driverLicense]);

  const handleProfileUpdate = async () => {
    setProfileLoading(true);
    try {
      await api.auth.updateMe({ city: city || undefined });
      qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("تم تحديث المدينة ✅");
    } catch (err) {
      toast.error(friendlyError(err, "فشل التحديث"));
    } finally {
      setProfileLoading(false);
    }
  };

  // Gender: set-once (migration 040). The DB guard
  // guard_profile_protected_columns allows NULL → male|female ONCE; any
  // subsequent change requires admin via the set_user_gender_admin RPC
  // (the support path). This handler only fires from the UI when the
  // current value is NULL, so the happy path is a regular profile
  // UPDATE. If the server rejects (e.g. race: another tab set it first),
  // friendlyError already maps the 'gender is set-once' message to an
  // actionable Arabic string.
  const handleGenderSet = async () => {
    if (pendingGender !== "male" && pendingGender !== "female") {
      toast.error("اختر الجنس أولاً");
      return;
    }
    setGenderLoading(true);
    try {
      await api.auth.updateMe({ gender: pendingGender });
      qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("تم حفظ الجنس ✅", {
        description: "لا يمكن تغيير الجنس مرة أخرى. للتعديل تواصل مع الدعم.",
      });
    } catch (err) {
      toast.error(friendlyError(err, "تعذر حفظ الجنس"));
    } finally {
      setGenderLoading(false);
    }
  };

  const updateEmail = async () => {
    if (!email || email === user?.email) {
      toast.error("أدخل بريد إلكتروني جديد");
      return;
    }
    setEmailLoading(true);
    try {
      await api.auth.updateMe({ email });
      qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("تم تحديث البريد الإلكتروني بنجاح!");
    } catch (err) {
      toast.error(friendlyError(err, "تعذر تحديث البريد الإلكتروني"));
    }
    setEmailLoading(false);
  };

  const updatePassword = async () => {
    if (!passwordForm.current || !passwordForm.new || !passwordForm.confirm) {
      toast.error("يرجى ملء جميع الحقول");
      return;
    }
    if (passwordForm.new !== passwordForm.confirm) {
      toast.error("كلمات المرور غير متطابقة");
      return;
    }
    if (passwordForm.new.length < 8) {
      toast.error("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
      return;
    }
    setPasswordLoading(true);
    try {
      // Note: You'll need to implement this in your backend auth service
      await api.auth.updateMe({ password: passwordForm.new });
      setPasswordForm({ current: "", new: "", confirm: "" });
      qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("تم تغيير كلمة المرور بنجاح!");
    } catch (err) {
      toast.error(friendlyError(err, "تعذر تغيير كلمة المرور"));
    }
    setPasswordLoading(false);
  };

  const updatePhone = async () => {
    // Run the same granular validator the signup form uses, so the user
    // sees a specific reason ("الرقم قصير جداً", "رموز غير مسموحة", etc.)
    // instead of just "أدخل رقم الهاتف" when something's malformed.
    const phoneCheck = validatePhone(phone);
    if (phoneCheck.reason) { toast.error(phoneCheck.reason); return; }
    setPhoneLoading(true);
    try {
      await api.auth.updateMe({ phone });
      qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("تم تحديث رقم الهاتف!");
    } catch (err) {
      toast.error(friendlyError(err, "تعذر تحديث رقم الهاتف"));
    }
    setPhoneLoading(false);
  };

  const uploadAvatar = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setAvatarLoading(true);
    try {
      const { file_url } = await api.integrations.Core.UploadFile({ file });
      await api.auth.updateMe({ avatar_url: file_url });
      setAvatar(file_url);
      
      // Update all user's trips with new avatar
      if (user?.email) {
        const userTrips = await api.entities.Trip.filter({ created_by: user.email }, "-created_date", 100);
        await Promise.all(
          userTrips.map(trip => api.entities.Trip.update(trip.id, { driver_avatar: file_url }))
        );
      }
      
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["trips"] });
      qc.invalidateQueries({ queryKey: ["driver-trips"] });
      qc.invalidateQueries({ queryKey: ["featured-trips"] });
      toast.success("تم تحديث الصورة!");
    } catch (err) {
      toast.error(friendlyError(err, "تعذر رفع الصورة"));
    }
    setAvatarLoading(false);
  };

  const updateLicense = async () => {
    if (!licenseNumber || !licenseExpiry || !carRegistrationExpiry || !insuranceExpiry || !licenseImageUrl || !carRegistrationUrl || !insuranceUrl || !selfie1Url || !selfie2Url) {
      toast.error("يرجى ملء جميع البيانات والمستندات المطلوبة");
      return;
    }
    // Past-date guard — input min={today} blocks the picker but not
    // hand-typed dates. Don't accept already-expired documents.
    if (!isFutureOrToday(licenseExpiry))   { toast.error("تاريخ انتهاء الرخصة لا يمكن أن يكون في الماضي ⚠️"); return; }
    if (!isFutureOrToday(carRegistrationExpiry)) { toast.error("تاريخ انتهاء تسجيل المركبة لا يمكن أن يكون في الماضي ⚠️"); return; }
    if (!isFutureOrToday(insuranceExpiry))      { toast.error("تاريخ انتهاء التأمين لا يمكن أن يكون في الماضي ⚠️"); return; }
    setLicenseLoading(true);
    try {
      if (driverLicense) {
        await api.entities.DriverLicense.update(driverLicense.id, {
          license_number: licenseNumber,
          expiry_date: licenseExpiry,
          car_registration_expiry_date: carRegistrationExpiry,
          insurance_expiry_date: insuranceExpiry,
          license_image_url: licenseImageUrl,
          car_registration_url: carRegistrationUrl,
          insurance_url: insuranceUrl,
          selfie_1_url: selfie1Url,
          selfie_2_url: selfie2Url,
          status: "pending",
          rejection_reason: null,
          submitted_at: new Date().toISOString(),
          approved_at: null,
          approved_by: null,
        });
        toast.success("تم تحديث المستندات وإرسالها للمراجعة");
      } else {
        await api.entities.DriverLicense.create({
          driver_email: user?.email,
          driver_name: user?.full_name,
          license_number: licenseNumber,
          expiry_date: licenseExpiry,
          car_registration_expiry_date: carRegistrationExpiry,
          insurance_expiry_date: insuranceExpiry,
          license_image_url: licenseImageUrl,
          car_registration_url: carRegistrationUrl,
          insurance_url: insuranceUrl,
          selfie_1_url: selfie1Url,
          selfie_2_url: selfie2Url,
          status: "pending",
          submitted_at: new Date().toISOString(),
        });
        toast.success("تم إرسال جميع المستندات للمراجعة ✓");
      }
      qc.invalidateQueries({ queryKey: ["driver-license", user?.email] });
    } catch (err) {
      captureException(err, { msg: "License update error:" });
      toast.error(friendlyError(err, "تعذر تحديث المستندات"));
    }
    setLicenseLoading(false);
  };

  const uploadFile = async (e, setUrl, fileType = "صورة", fieldKey = fileType) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 12 * 1024 * 1024) {
      toast.error("حجم الملف يجب أن يكون أقل من 12 MB");
      return;
    }
    if (!file.type.startsWith("image/") && !file.type.includes("pdf")) {
      toast.error("يرجى رفع صورة أو ملف PDF فقط");
      return;
    }

    // Per-field uploading state lets multiple fields upload concurrently
    setUploadingFields(prev => ({ ...prev, [fieldKey]: true }));
    try {
      // Compress images client-side before upload — typical phone-camera
      // shot drops from 6-8 MB to ~500 KB. PDFs pass through.
      const compressed = await compressImage(file).catch(() => file);

      // Use Supabase storage directly (bypasses api upload).
      // Path is UUID-namespaced so storage RLS policies in
      // migrations/004_storage_hardening.sql can enforce ownership.
      const ext = (compressed.name || file.name).split(".").pop();
      const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await supabase.storage.from("uploads").upload(path, compressed, { upsert: true });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from("uploads").getPublicUrl(path);
      setUrl(publicUrl);
      toast.success(`✅ تم رفع ${fileType} بنجاح`);
    } catch (err) {
      console.error("Upload error:", err);
      toast.error(`خطأ في رفع ${fileType}: ${friendlyError(err, "حاول مجدداً")}`);
    } finally {
      setUploadingFields(prev => {
        const next = { ...prev };
        delete next[fieldKey];
        return next;
      });
    }
  };

  const deleteAccount = async () => {
    setDeletionLoading(true);
    try {
      const today = new Date().toISOString().split("T")[0];

      // Pre-flight: block deletion if user has active trips/bookings
      const [activeDriverTrips, activeBookings] = await Promise.all([
        api.entities.Trip.filter(
          { driver_email: user.email, status: "confirmed" },
          "-date",
          50
        ).then((trips) => (trips || []).filter((t) => t.date >= today)),
        api.entities.Booking.filter(
          { passenger_email: user.email, status: "confirmed" },
          "-created_date",
          50
        ),
      ]);

      if (activeDriverTrips.length > 0) {
        toast.error(
          `لا يمكن حذف الحساب — لديك ${activeDriverTrips.length} رحلة قادمة كسائق. يرجى إلغاؤها أولاً.`
        );
        setDeletionLoading(false);
        return;
      }
      if (activeBookings.length > 0) {
        toast.error(
          `لا يمكن حذف الحساب — لديك ${activeBookings.length} حجز قادم كراكب. يرجى إلغاؤها أولاً.`
        );
        setDeletionLoading(false);
        return;
      }

      // Build the anonymisation payload. We persist a deletion_reason so
      // the admin team can see why people are leaving (the column already
      // exists in profiles; the previous code just never wrote to it).
      const reasonToPersist =
        deletionReason === "other"
          ? deletionReasonOther.trim().slice(0, 500) || "other"
          : deletionReason || null;

      // Record intent BEFORE we touch the row, so even if the next step
      // silently fails (e.g. expired session vs RLS), the admin team sees
      // that this user attempted to delete.
      await logAdminAction(
        "account_self_delete_initiated",
        "user",
        user.id,
        {
          email: user.email,
          full_name: user.full_name,
          reason: reasonToPersist,
        }
      );

      // Anonymize PII + mark as deleted.
      // Strategy:
      //   1. Try the delete_user_account_v2 RPC (migration 003). It does
      //      a server-side cascade: anonymizes the profile, rotates the
      //      auth.users email so the user can't log back in, and updates
      //      every denormalized email column on messages/bookings/trips/
      //      notifications/reviews/blocks/reports/support_tickets.
      //   2. If the RPC isn't deployed yet (function-not-found), fall
      //      through to the legacy direct UPDATE path. The legacy path is
      //      worse for GDPR (email survives on profiles + denormalized
      //      columns) but we keep it so deletion works through the rollout
      //      window. After migration 003 lands and is verified, this
      //      legacy block can be removed.

      let rpcSucceeded = false;
      let rpcResult = null;
      const { data: rpcOut, error: rpcErr } = await supabase.rpc("delete_user_account_v2", {
        p_reason: reasonToPersist,
      });
      const rpcMissing =
        rpcErr && (rpcErr.code === "PGRST202"
          || /function .* does not exist/i.test(rpcErr.message || "")
          || /could not find the function/i.test(rpcErr.message || ""));
      if (rpcErr && !rpcMissing) {
        const msg = rpcErr.message || "";
        if (/upcoming trips as driver/i.test(msg))     throw new Error("لا يمكن حذف الحساب — لديك رحلات قادمة كسائق");
        if (/upcoming bookings as passenger/i.test(msg)) throw new Error("لا يمكن حذف الحساب — لديك حجوزات قادمة كراكب");
        if (/not authenticated/i.test(msg))            throw new Error("انتهت جلستك — يرجى إعادة تسجيل الدخول");
        throw new Error(msg.slice(0, 200) || "تعذر حذف الحساب");
      }
      if (!rpcMissing) {
        rpcSucceeded = true;
        rpcResult = rpcOut;
      }

      let updatedRows = null;
      if (!rpcSucceeded) {
        // Legacy path — only when RPC is unavailable.
        // Use supabase-js directly (not api) for two reasons:
        //   1. api.entities.Profile.update goes through restFetch which
        //      falls back to the anon key when JWT is expired. With anon,
        //      the profiles_update RLS policy (id = auth.uid()) matches 0
        //      rows; PostgREST returns 200 with [] and the old code treated
        //      that as success. The user saw "تم حذف حسابك بنجاح" but the
        //      DB never changed.
        //   2. .select() forces PostgREST to return the updated row(s) so
        //      we can VERIFY the write actually persisted before logging
        //      out and showing the success toast.
        const { data: rows, error: updateErr } = await supabase
          .from("profiles")
          .update({
            full_name: "[حساب محذوف]",
            avatar_url: null,
            phone: null,
            bio: null,
            bank_iban: null,
            jawwal_pay_number: null,
            reflect_number: null,
            pref_smoking: null,
            pref_chattiness: null,
            pref_pets: null,
            vehicle_luggage: null,
            vehicle_back_row: null,
            car_model: null,
            car_year: null,
            car_color: null,
            car_plate: null,
            car_image: null,
            driver_note: null,
            notif_push: false,
            notif_email: false,
            notif_sms: false,
            notif_marketing: false,
            deleted_at: new Date().toISOString(),
            deletion_reason: reasonToPersist,
          })
          .eq("id", user.id)
          .select("id, deleted_at");

        if (updateErr) throw updateErr;
        if (!rows || rows.length === 0) {
          // RLS blocked the update — almost always means the JWT expired
          // mid-session. Don't pretend the deletion worked.
          throw new Error("session_expired_no_rows_updated");
        }
        updatedRows = rows;
      }

      // Confirm to the audit trail that the deletion actually persisted.
      // Cascade counts (migration 036) tell admins how many dangling
      // artifacts this deletion auto-resolved — useful for spotting
      // patterns like 'we keep seeing users with 5+ open requests
      // delete their accounts, are we sending too many notifications?'
      const cascadeCounts = rpcSucceeded
        ? {
            cancelled_bookings: rpcResult?.cancelled_bookings_count ?? 0,
            cancelled_requests: rpcResult?.cancelled_requests_count ?? 0,
          }
        : { cancelled_bookings: 0, cancelled_requests: 0 };

      await logAdminAction(
        "account_self_deleted",
        "user",
        user.id,
        {
          email: user.email,
          reason: reasonToPersist,
          path: rpcSucceeded ? "rpc_v2" : "legacy_direct_update",
          confirmed_deleted_at: rpcSucceeded
            ? (rpcResult?.deleted_at || new Date().toISOString())
            : updatedRows[0].deleted_at,
          ...cascadeCounts,
        }
      );

      try {
        await api.auth.deleteMe?.();
      } catch (_) {
        /* ignore — soft delete is the source of truth */
      }

      // Compose a summary toast. The common case (no pending bookings,
      // no open requests) gets the plain message; users who had
      // dangling artifacts get an explicit reassurance that we handled
      // them, since they might be wondering whether their pending
      // bookings on driver dashboards needed manual follow-up.
      const cleanupBits = [];
      if (cascadeCounts.cancelled_bookings > 0) {
        cleanupBits.push(
          cascadeCounts.cancelled_bookings === 1
            ? "ألغينا حجزاً معلقاً واحداً"
            : `ألغينا ${cascadeCounts.cancelled_bookings} حجوزات معلقة`
        );
      }
      if (cascadeCounts.cancelled_requests > 0) {
        cleanupBits.push(
          cascadeCounts.cancelled_requests === 1
            ? "وطلب رحلة واحد"
            : `و${cascadeCounts.cancelled_requests} طلبات رحلة`
        );
      }
      if (cleanupBits.length > 0) {
        toast.success("تم حذف حسابك بنجاح", {
          description: cleanupBits.join(" ") + ".",
        });
      } else {
        toast.success("تم حذف حسابك بنجاح");
      }
      // Only collapse the modal back to step 1 on SUCCESS — keeping it
      // open on error means the user (a) sees the error toast in
      // context, (b) doesn't have to re-confirm by typing "حذف حسابي"
      // again to retry. Previously this line lived after the catch
      // and reset the modal on every code path, so any error
      // (session expired, trigger block, network) silently rolled the
      // user back to the warning step with no indication that their
      // deletion didn't go through.
      setShowDeleteModal(false);
      setTimeout(() => {
        if (api.auth.logout) api.auth.logout("/");
        else window.location.href = "/";
      }, 1500);
    } catch (err) {
      captureException(err, { msg: "Delete error:" });
      // Distinguish the silent-failure case so the user knows what happened
      // instead of seeing a generic "support" message they can't act on.
      if (err?.message === "session_expired_no_rows_updated") {
        toast.error("انتهت الجلسة — يرجى تسجيل الدخول مجدداً ثم إعادة المحاولة");
      } else {
        toast.error(friendlyError(err, "فشل حذف الحساب. يرجى الاتصال بالدعم"));
      }
      setDeletionLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <p className="text-muted-foreground">جاري التحميل...</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
        <ArrowLeft className="w-4 h-4 rotate-180" />
        رجوع
      </Link>

      <h1 className="text-2xl font-bold text-foreground mb-6">إعدادات الحساب</h1>

      <div className="space-y-6">
        {/* Profile Section */}
        <div className="bg-card rounded-2xl border border-border p-6 space-y-4">
          <h3 className="font-bold text-foreground">الملف الشخصي</h3>

          {/* Avatar */}
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-xl bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary overflow-hidden shrink-0">
              {avatar ? (
                <img loading="lazy" src={avatar} alt="" className="w-full h-full object-cover" />
              ) : (
                user.full_name?.[0] || "م"
              )}
            </div>
            <div>
              <input
                id="avatar-input"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={uploadAvatar}
                disabled={avatarLoading}
              />
              <Button 
                variant="outline" 
                className="rounded-xl gap-2" 
                disabled={avatarLoading}
                onClick={() => document.getElementById("avatar-input").click()}
              >
                <Image className="w-4 h-4" />
                {avatarLoading ? "جاري الرفع..." : "تغيير الصورة"}
              </Button>
              <p className="text-xs text-muted-foreground mt-1">JPG, PNG (Max 5MB)</p>
            </div>
          </div>

          {/* Name (Locked) */}
          <div>
            <Label>الاسم الكامل</Label>
            <div className="mt-1 px-4 py-2.5 rounded-xl border border-border bg-muted/30 text-sm text-muted-foreground flex items-center gap-2">
              <Lock className="w-4 h-4" />
              <span>{user.full_name}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">لا يمكن تغيير الاسم بعد التسجيل</p>
          </div>

          {/* User ID badge — sequential account number (migration 041)
              formatted as 'M-1000', 'M-1001', etc. Easy to read aloud,
              easy to type, easy to remember. The UUID still exists in
              the DB for FK / JOIN purposes, but users and support see
              only the short number. Admin dashboard /dashboard/users
              has a search field for this same number.

              If account_number is NULL (pre-migration-041 state, or a
              data anomaly), fall back to a formatted UUID prefix so
              users still see SOMETHING they can give support. */}
          <div>
            <Label>معرّف الحساب</Label>
            <div
              className={
                "mt-1 px-4 py-2.5 rounded-xl border flex items-center justify-between gap-2 font-mono tracking-wider " +
                (accountNumber != null
                  ? "border-primary/30 bg-primary/5 text-primary text-base font-bold"
                  : "border-border bg-muted/30 text-foreground text-sm")
              }
              dir="ltr"
            >
              <span>
                {accountNumber != null
                  ? `M-${accountNumber}`
                  : user?.id
                  ? `MSH-${String(user.id).slice(0, 4).toUpperCase()}-${String(user.id).slice(4, 8).toUpperCase()}`
                  : "—"}
              </span>
              {(accountNumber != null || user?.id) && (
                <button
                  type="button"
                  onClick={() => {
                    const idForCopy = accountNumber != null
                      ? `M-${accountNumber}`
                      : String(user.id);
                    navigator.clipboard?.writeText(idForCopy)
                      .then(() => toast.success("تم نسخ المعرّف"))
                      .catch(() => toast.error("تعذر النسخ"));
                  }}
                  className="text-primary hover:text-primary/80 transition-colors p-1"
                  aria-label="نسخ المعرّف"
                >
                  <Copy className="w-4 h-4" />
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">يُستخدم لتعريف حسابك عند التواصل مع الدعم</p>
          </div>

          {/* الجنس والمدينة */}
          <div className="bg-card rounded-2xl border border-border p-4 space-y-3">
            <h3 className="font-bold text-foreground text-sm">الجنس والمدينة</h3>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">الجنس</label>
              {user?.gender === "female" || user?.gender === "male" ? (
                // Locked display — gender is set. To change, user must
                // contact support (set_user_gender_admin RPC, migration 040).
                <>
                  <div className="flex items-center gap-2 h-10 px-3 rounded-xl border border-input bg-muted/40 text-sm">
                    <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                    {user.gender === "female"
                      ? <><span>👩</span><span className="font-medium">أنثى</span></>
                      : <><span>👨</span><span className="font-medium">ذكر</span></>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">للتغيير تواصل مع الدعم وأرسل معرّف حسابك</p>
                </>
              ) : user?.onboarding_completed ? (
                // Onboarding complete but gender not set yet — passenger
                // accounts (or Google OAuth flow) reach this state. Allow
                // the user to set it ONCE. DB enforces the set-once rule.
                <>
                  <div className="flex gap-2">
                    <select
                      value={pendingGender}
                      onChange={(e) => setPendingGender(e.target.value)}
                      className="flex-1 h-10 px-3 rounded-xl border border-input bg-background text-sm"
                    >
                      <option value="">— اختر الجنس —</option>
                      <option value="male">👨 ذكر</option>
                      <option value="female">👩 أنثى</option>
                    </select>
                    <Button
                      onClick={handleGenderSet}
                      disabled={genderLoading || !pendingGender}
                      className="rounded-xl h-10 shrink-0"
                      size="sm"
                    >
                      {genderLoading ? "..." : "حفظ"}
                    </Button>
                  </div>
                  <p className="text-xs text-amber-600 mt-1">
                    ⚠️ يمكنك تحديد الجنس مرة واحدة فقط — اختر بعناية
                  </p>
                </>
              ) : (
                // True onboarding-incomplete state — direct them back to
                // /onboarding rather than letting them piecemeal-edit.
                <div className="flex items-center gap-2 h-10 px-3 rounded-xl border border-input bg-muted/40 text-sm">
                  <span className="text-muted-foreground text-xs">لم يُحدَّد — يرجى إكمال الإعداد الأولي</span>
                </div>
              )}
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">المدينة</label>
              <div className="flex gap-2">
                <Input value={city} onChange={e => setCity(e.target.value)} placeholder="رام الله" className="rounded-xl h-10 flex-1" dir="rtl" />
                <Button onClick={handleProfileUpdate} disabled={profileLoading || city === (user?.city||"")} className="rounded-xl h-10 shrink-0" size="sm">
                  {profileLoading ? "..." : "حفظ"}
                </Button>
              </div>
            </div>
          </div>

          {/* طرق الدفع والاستلام */}
          {(user?.account_type === "driver" || user?.account_type === "both") && (
            <div className="bg-card rounded-2xl border border-border p-4 space-y-3">
              <h3 className="font-bold text-foreground text-sm flex items-center gap-2">
                <span>💳</span>
                طرق استلام المدفوعات
              </h3>
              <DriverPaymentSetup user={user} />
            </div>
          )}

          {(user?.account_type === "passenger" || user?.account_type === "both") && (
            <div className="bg-card rounded-2xl border border-border p-4 space-y-3">
              <h3 className="font-bold text-foreground text-sm flex items-center gap-2">
                <span>💳</span>
                طريقة الدفع المفضلة
              </h3>
              <PassengerPaymentSetup user={user} />
            </div>
          )}

          {/* Phone */}
          <div>
            <Label>رقم الهاتف</Label>
            <div className="flex gap-2 mt-1">
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="059XXXXXXX أو +970591234567"
                className="rounded-xl h-10"
              />
              <Button
                onClick={updatePhone}
                disabled={phoneLoading || phone === user?.phone}
                className="bg-primary text-primary-foreground rounded-xl"
              >
                {phoneLoading ? "جاري..." : "حفظ"}
              </Button>
            </div>
            {/* Live phone validation hint — same UX pattern as the
                signup and onboarding forms. */}
            {phone ? (() => {
              const c = validatePhone(phone);
              if (c.reason) {
                return (
                  <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1.5 flex items-center gap-1">
                    <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-[9px] font-bold">!</span>
                    {c.reason}
                  </p>
                );
              }
              return (
                <p className="text-[11px] text-green-600 dark:text-green-400 mt-1.5 flex items-center gap-1">
                  <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-green-100 dark:bg-green-900/40 text-[9px] font-bold">✓</span>
                  {c.looksPalestinian ? "رقم فلسطيني صالح" : "رقم دولي صالح"}
                </p>
              );
            })() : null}
          </div>
        </div>

        {/* Email Section */}
        <div className="bg-card rounded-2xl border border-border p-6 space-y-4">
          <h3 className="font-bold text-foreground flex items-center gap-2">
            <Mail className="w-4 h-4 text-primary" />
            البريد الإلكتروني
          </h3>
          <div>
            <Label>عنوان البريد</Label>
            <div className="flex gap-2 mt-1">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-xl h-10"
              />
              <Button
                onClick={updateEmail}
                disabled={emailLoading || email === user?.email}
                className="bg-primary text-primary-foreground rounded-xl"
              >
                {emailLoading ? "جاري..." : "حفظ"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">سيتم إرسال تأكيد إلى البريد الجديد</p>
          </div>
        </div>

        {/* Password Section */}
        <div className="bg-card rounded-2xl border border-border p-6 space-y-4">
          <h3 className="font-bold text-foreground flex items-center gap-2">
            <Lock className="w-4 h-4 text-primary" />
            تغيير كلمة المرور
          </h3>
          <div className="space-y-3">
            <div>
              <Label>كلمة المرور الحالية</Label>
              <Input
                type="password"
                value={passwordForm.current}
                onChange={(e) => setPasswordForm({ ...passwordForm, current: e.target.value })}
                placeholder="أدخل كلمة المرور الحالية"
                className="rounded-xl h-10 mt-1"
              />
            </div>
            <div>
              <Label>كلمة المرور الجديدة</Label>
              <Input
                type="password"
                value={passwordForm.new}
                onChange={(e) => setPasswordForm({ ...passwordForm, new: e.target.value })}
                placeholder="أدخل كلمة مرور جديدة (8+ أحرف)"
                className="rounded-xl h-10 mt-1"
              />
            </div>
            <div>
              <Label>تأكيد كلمة المرور</Label>
              <Input
                type="password"
                value={passwordForm.confirm}
                onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })}
                placeholder="أدخل كلمة المرور مرة أخرى"
                className="rounded-xl h-10 mt-1"
              />
            </div>
            <Button
              onClick={updatePassword}
              disabled={passwordLoading}
              className="w-full bg-primary text-primary-foreground rounded-xl"
            >
              {passwordLoading ? "جاري التحديث..." : "تحديث كلمة المرور"}
            </Button>
          </div>
        </div>

        {/* Driver License Section */}
        {/* PASSENGER ONLY: Slim entry point pointing to the dedicated
            5-step wizard at /become-driver. The previous in-page form
            (instant promotion + scroll wall of 10 fields) was confusing
            and failed to convert. The wizard is the primary path now. */}
        {user?.account_type === "passenger" && (
          <Link to="/become-driver" className="block">
            <div className="bg-gradient-to-br from-primary/5 via-primary/10 to-accent/10 rounded-2xl border-2 border-primary/30 p-5 hover:border-primary/50 transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center shrink-0 text-2xl">
                  🚗
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-foreground text-base">كن سائقاً في مشوارو</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">5 خطوات سهلة • 3-5 دقائق</p>
                </div>
                <Shield className="w-5 h-5 text-primary shrink-0" />
              </div>
            </div>
          </Link>
        )}

        {user?.account_type && (user.account_type === "driver" || user.account_type === "both") && (
          <div className="bg-card rounded-2xl border border-border p-6 space-y-4">
            <h3 className="font-bold text-foreground flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" />
              توثيق السائق
              <span className="text-xs font-normal text-muted-foreground mr-auto">
                (5 وثائق مطلوبة)
              </span>
            </h3>
            
            {driverLicense && (
              <div className={`p-3 rounded-xl flex items-start gap-3 ${
                driverLicense.status === "approved" ? "bg-green-500/10 border border-green-500/20" :
                driverLicense.status === "pending"  ? "bg-yellow-500/10 border border-yellow-500/20" :
                driverLicense.status === "incomplete" ? "bg-blue-500/10 border border-blue-500/20" :
                "bg-destructive/10 border border-destructive/20"
              }`}>
                <span className={`text-2xl shrink-0 ${
                  driverLicense.status === "approved" ? "text-green-600" :
                  driverLicense.status === "pending"  ? "text-yellow-600" :
                  driverLicense.status === "incomplete" ? "text-blue-600" :
                  "text-destructive"
                }`}>
                  {driverLicense.status === "approved" ? "✓" :
                   driverLicense.status === "pending"  ? "⏳" :
                   driverLicense.status === "incomplete" ? "📋" : "✕"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">
                    {driverLicense.status === "approved" ? "تم توثيق حسابك ✓ يمكنك نشر الرحلات الآن" :
                     driverLicense.status === "pending"  ? "وثائقك قيد المراجعة (1-3 أيام عمل)" :
                     driverLicense.status === "incomplete" ? "وثائقك غير مكتملة — أكمل جميع الوثائق الـ5 لإرسالها للمراجعة" :
                     "لم يتم قبول وثائقك"}
                  </p>
                  {driverLicense.rejection_reason && (
                    <p className="text-xs text-muted-foreground mt-1">السبب: {driverLicense.rejection_reason}</p>
                  )}
                  {/* Mini progress for incomplete */}
                  {(driverLicense.status === "incomplete" || !driverLicense.status) && (() => {
                    const docs = [
                      driverLicense.license_image_url,
                      driverLicense.car_registration_url,
                      driverLicense.insurance_url,
                      driverLicense.selfie_1_url,
                      driverLicense.selfie_2_url,
                    ];
                    const uploaded = docs.filter(Boolean).length;
                    return (
                      <div className="mt-2">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-muted-foreground">{uploaded} من 5 وثائق</span>
                          <span className="font-bold text-blue-600">{Math.round((uploaded/5)*100)}%</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 transition-all" style={{ width: `${(uploaded/5)*100}%` }} />
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <Label>رقم الرخصة</Label>
                <Input
                  value={licenseNumber}
                  onChange={(e) => setLicenseNumber(e.target.value)}
                  placeholder="مثال: 123456789"
                  className="rounded-xl h-10 mt-1"
                />
              </div>
              <div>
                <Label>تاريخ انتهاء الرخصة</Label>
                <Input
                  type="date"
                  min={todayISO()}
                  value={licenseExpiry}
                  onChange={(e) => setLicenseExpiry(e.target.value)}
                  className="rounded-xl h-10 mt-1"
                />
              </div>
              <div>
                <Label>تاريخ انتهاء تسجيل المركبة</Label>
                <Input
                  type="date"
                  min={todayISO()}
                  value={carRegistrationExpiry}
                  onChange={(e) => setCarRegistrationExpiry(e.target.value)}
                  className="rounded-xl h-10 mt-1"
                />
              </div>
              <div>
                <Label>تاريخ انتهاء التأمين</Label>
                <Input
                  type="date"
                  min={todayISO()}
                  value={insuranceExpiry}
                  onChange={(e) => setInsuranceExpiry(e.target.value)}
                  className="rounded-xl h-10 mt-1"
                />
              </div>

              {/* Document Uploads */}
              <div className="border-t border-border pt-3">
                <p className="text-xs font-medium text-muted-foreground mb-3">المستندات المطلوبة</p>
                
                {/* License */}
                <div className="mb-3">
                  <Label className="text-xs">1️⃣ صورة رخصة القيادة</Label>
                  <input
                    id="license-file"
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={(e) => uploadFile(e, setLicenseImageUrl, "رخصة القيادة", "license")}
                    disabled={uploadingFields.license}
                  />
                  <Button
                    variant="outline"
                    className="rounded-xl gap-2 w-full mt-1"
                    disabled={uploadingFields.license}
                    onClick={() => document.getElementById("license-file").click()}
                  >
                    <Image className="w-4 h-4" />
                    {uploadingFields.license ? "جاري الرفع..." : licenseImageUrl ? "✓ تم الرفع — تغيير" : "اختر صورة"}
                  </Button>
                </div>

                {/* Car Registration */}
                <div className="mb-3">
                  <Label className="text-xs">2️⃣ صورة تسجيل المركبة</Label>
                  <input
                    id="registration-file"
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={(e) => uploadFile(e, setCarRegistrationUrl, "تسجيل المركبة", "registration")}
                    disabled={uploadingFields.registration}
                  />
                  <Button
                    variant="outline"
                    className="rounded-xl gap-2 w-full mt-1"
                    disabled={uploadingFields.registration}
                    onClick={() => document.getElementById("registration-file").click()}
                  >
                    <Image className="w-4 h-4" />
                    {uploadingFields.registration ? "جاري الرفع..." : carRegistrationUrl ? "✓ تم الرفع — تغيير" : "اختر صورة"}
                  </Button>
                </div>

                {/* Insurance */}
                <div className="mb-3">
                  <Label className="text-xs">3️⃣ صورة التأمين</Label>
                  <input
                    id="insurance-file"
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={(e) => uploadFile(e, setInsuranceUrl, "التأمين", "insurance")}
                    disabled={uploadingFields.insurance}
                  />
                  <Button
                    variant="outline"
                    className="rounded-xl gap-2 w-full mt-1"
                    disabled={uploadingFields.insurance}
                    onClick={() => document.getElementById("insurance-file").click()}
                  >
                    <Image className="w-4 h-4" />
                    {uploadingFields.insurance ? "جاري الرفع..." : insuranceUrl ? "✓ تم الرفع — تغيير" : "اختر صورة"}
                  </Button>
                </div>

                {/* Selfie 1 */}
                <div className="mb-3">
                  <Label className="text-xs">4️⃣ سيلفي الهوية (الوجه مع الهوية)</Label>
                  <input
                    id="selfie1-file"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => uploadFile(e, setSelfie1Url, "السيلفي الأول", "selfie1")}
                    disabled={uploadingFields.selfie1}
                  />
                  <Button
                    variant="outline"
                    className="rounded-xl gap-2 w-full mt-1"
                    disabled={uploadingFields.selfie1}
                    onClick={() => document.getElementById("selfie1-file").click()}
                  >
                    <Image className="w-4 h-4" />
                    {uploadingFields.selfie1 ? "جاري الرفع..." : selfie1Url ? "✓ تم الرفع — تغيير" : "اختر صورة"}
                  </Button>
                </div>

                {/* Selfie 2 */}
                <div className="mb-3">
                  <Label className="text-xs">5️⃣ سيلفي إضافي (الوجه الواضح)</Label>
                  <input
                    id="selfie2-file"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => uploadFile(e, setSelfie2Url, "السيلفي الثاني", "selfie2")}
                    disabled={uploadingFields.selfie2}
                  />
                  <Button
                    variant="outline"
                    className="rounded-xl gap-2 w-full mt-1"
                    disabled={uploadingFields.selfie2}
                    onClick={() => document.getElementById("selfie2-file").click()}
                  >
                    <Image className="w-4 h-4" />
                    {uploadingFields.selfie2 ? "جاري الرفع..." : selfie2Url ? "✓ تم الرفع — تغيير" : "اختر صورة"}
                  </Button>
                </div>
              </div>

              <Button
                onClick={updateLicense}
                disabled={licenseLoading || Object.keys(uploadingFields).length > 0}
                className="w-full bg-primary text-primary-foreground rounded-xl"
              >
                {licenseLoading ? "جاري التحديث..." : "إرسال المستندات للمراجعة"}
              </Button>
            </div>
          </div>
        )}

        {/* Danger Zone */}
                {/* Logout button — visible signout for the user */}
        <div className="bg-card rounded-2xl border border-border p-4">
          <Button
            onClick={async () => {
              try { await api.auth.logout?.("/"); } catch {}
              window.location.href = "/";
            }}
            variant="outline"
            className="w-full rounded-xl gap-2 h-11 border-border hover:bg-muted"
          >
            <LogOut className="w-4 h-4" />
            تسجيل الخروج
          </Button>
        </div>

        <div className="bg-destructive/5 rounded-2xl border border-destructive/20 p-6">
          <h3 className="font-bold text-destructive flex items-center gap-2 mb-3">
            <AlertCircle className="w-4 h-4" />
            منطقة الخطر
          </h3>
          <Button
            variant="outline"
            className="border-destructive text-destructive hover:bg-destructive/10 rounded-xl gap-2 w-full"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2 className="w-4 h-4" />
            حذف الحساب
          </Button>
        </div>

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-card rounded-2xl border border-border p-6 max-w-sm mx-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-foreground">حذف الحساب</h3>
                <button onClick={() => setShowDeleteConfirm(false)} className="p-1 hover:bg-muted rounded-lg">
                  <X className="w-4 h-4" />
                </button>
              </div>
              
              <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4 space-y-2">
                <p className="text-sm font-medium text-destructive flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  تحذير
                </p>
                <p className="text-sm text-destructive/80">
                  سيتم حذف حسابك وجميع بيانات المرتبطة به بشكل دائم. لا يمكن التراجع عن هذا الإجراء.
                </p>
              </div>

              {!showDeleteModal ? (
                <Button
                  onClick={() => setShowDeleteModal(true)}
                  className="w-full bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-xl"
                >
                  فهمت، متابعة الحذف
                </Button>
              ) : (
                <div className="space-y-3 bg-destructive/5 p-4 rounded-xl border border-destructive/20">
                  {/* Reason picker — optional but lets the team learn why
                      people leave. The selected value is persisted to
                      profiles.deletion_reason and to the audit log. */}
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-foreground">
                      سبب الحذف (اختياري — يساعدنا في التحسين)
                    </label>
                    <select
                      value={deletionReason}
                      onChange={(e) => setDeletionReason(e.target.value)}
                      disabled={deletionLoading}
                      className="w-full h-10 px-3 rounded-lg bg-card border border-border text-sm text-foreground"
                    >
                      <option value="">— لا أرغب بذكره —</option>
                      <option value="no_longer_needed">لم أعد بحاجة للتطبيق</option>
                      <option value="found_alternative">وجدت بديلاً أفضل</option>
                      <option value="privacy">مخاوف تتعلق بالخصوصية</option>
                      <option value="duplicate_account">لدي حساب آخر</option>
                      <option value="too_many_notifications">إشعارات كثيرة</option>
                      <option value="bad_experience">تجربة سيئة</option>
                      <option value="other">سبب آخر</option>
                    </select>
                    {deletionReason === "other" && (
                      <textarea
                        value={deletionReasonOther}
                        onChange={(e) => setDeletionReasonOther(e.target.value)}
                        placeholder="أخبرنا المزيد..."
                        maxLength={500}
                        rows={2}
                        disabled={deletionLoading}
                        className="w-full px-3 py-2 rounded-lg bg-card border border-border text-sm text-foreground resize-none"
                      />
                    )}
                  </div>

                  {/* Typed-confirmation guard — modal previously claimed to
                      require typing "حذف حسابي" but had no input field. */}
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-destructive">
                      للتأكيد، اكتب <span className="font-bold">حذف حسابي</span> أدناه
                    </label>
                    <input
                      type="text"
                      value={deletionConfirmText}
                      onChange={(e) => setDeletionConfirmText(e.target.value)}
                      disabled={deletionLoading}
                      autoComplete="off"
                      className="w-full h-10 px-3 rounded-lg bg-card border border-destructive/40 text-sm text-foreground"
                    />
                  </div>

                  <div className="space-y-2">
                    <Button
                      onClick={deleteAccount}
                      disabled={deletionLoading || deletionConfirmText.trim() !== "حذف حسابي"}
                      className="w-full bg-red-600 hover:bg-red-700 text-white rounded-xl disabled:opacity-50"
                    >
                      {deletionLoading ? "جاري الحذف..." : "حذف الحساب نهائياً"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowDeleteConfirm(false);
                        setShowDeleteModal(false);
                        setDeletionReason("");
                        setDeletionReasonOther("");
                        setDeletionConfirmText("");
                      }}
                      className="w-full rounded-xl"
                      disabled={deletionLoading}
                    >
                      إلغاء
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
      </div>
    </div>
  );
}