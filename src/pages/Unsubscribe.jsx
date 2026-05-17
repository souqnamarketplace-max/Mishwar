// ════════════════════════════════════════════════════════════════════════
// Unsubscribe — public route /unsubscribe
// ════════════════════════════════════════════════════════════════════════
//
// Reached from the "إلغاء الاشتراك بنقرة واحدة" link in every marketing
// email. NO AUTH REQUIRED — the HMAC token in the URL is the auth.
// Required to be public for legal compliance (CAN-SPAM-equivalent
// email-marketing regulations) — users must be able to opt out without
// having to log in.
//
// FLOW
//   1. Mount → read email + token from URL
//   2. Call public_unsubscribe_marketing RPC (anon-callable via the
//      Supabase anon key already in this app's bundle)
//   3. Show success | already-unsubscribed | invalid-token result
//   4. Offer link back to home (or to login if user wants to re-subscribe
//      from their settings)
//
// SECURITY
//   - Token verification is server-side in the RPC. We never trust the
//     URL params, just relay them.
//   - Successful unsubscribe sets notif_marketing = false in profiles.
//     Re-subscribing requires logging in and toggling the preference
//     back on in /account → notification settings. By design — prevents
//     someone from spoofing a "re-subscribe" link to undo an opt-out.
//
// DESIGN
//   - Matches the brand (forest green / gold / cream) and is RTL.
//   - Renders correctly even on a phone since this is the most likely
//     access vector (people open marketing emails on mobile).
// ════════════════════════════════════════════════════════════════════════

import React, { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthContext";
import { CheckCircle2, XCircle, Loader2, Home } from "lucide-react";

export default function Unsubscribe() {
  const [searchParams] = useSearchParams();
  const email = searchParams.get("email") || "";
  const token = searchParams.get("token") || "";

  // useAuth is null-safe — Unsubscribe is mounted outside AppLayout
  // so it works for logged-out users too. When the user IS logged in
  // (most common case — they clicked the link in the same browser
  // they're signed into), we call refreshUser() after a successful
  // unsubscribe so the in-app notification toggle reflects the new
  // FALSE state immediately. Without this, navigating back to
  // /account?section=notifications shows the stale TRUE state until
  // the user does a hard refresh — confusing UX.
  const auth = useAuth();

  // state machine: 'loading' | 'success' | 'already' | 'invalid' | 'error'
  const [status, setStatus] = useState("loading");
  const [resolvedEmail, setResolvedEmail] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function doUnsubscribe() {
      // Defensive: missing params means the link was hand-typed or
      // corrupted in transit. Treat as invalid.
      if (!email || !token) {
        if (!cancelled) setStatus("invalid");
        return;
      }

      try {
        const { data, error } = await supabase.rpc("public_unsubscribe_marketing", {
          p_email: email,
          p_token: token,
        });

        if (cancelled) return;

        if (error) {
          // RPC failed — unexpected. Show generic error.
          console.error("[unsubscribe] RPC error:", error);
          setStatus("error");
          return;
        }

        // RPC returns JSONB: { success: true|false, email?, error?, note? }
        if (data?.success === true) {
          setResolvedEmail(data.email || email);
          // Distinguish first unsubscribe from re-clicking (idempotent)
          setStatus(data.note === "already_unsubscribed" ? "already" : "success");

          // Refresh the cached user object so the in-app notification
          // toggle reflects the new FALSE state. No-op if the visitor
          // isn't signed in (refreshUser silently does nothing without
          // a session). Fire-and-forget — the visual state machine
          // already moved to "success", we don't gate on this.
          if (auth?.refreshUser) {
            auth.refreshUser().catch(() => {});
          }
        } else if (data?.error === "invalid_token" || data?.error === "invalid_token_format") {
          setStatus("invalid");
        } else if (data?.error === "service_unavailable") {
          setStatus("error");
        } else {
          setStatus("invalid");
        }
      } catch (err) {
        if (!cancelled) {
          console.error("[unsubscribe] threw:", err);
          setStatus("error");
        }
      }
    }

    doUnsubscribe();
    return () => { cancelled = true; };
  }, [email, token, auth]);

  return (
    <div
      dir="rtl"
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: "#faf5e6" }}
    >
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg overflow-hidden">
        {/* Header */}
        <div
          className="p-8 text-center"
          style={{ background: "#1a3d2a" }}
        >
          <div className="text-3xl font-bold" style={{ color: "#c9a227" }}>
            مشوارو
          </div>
          <div className="text-sm mt-1 text-white/80">
            إلغاء الاشتراك في الرسائل الترويجية
          </div>
        </div>

        {/* Body — state-machine driven */}
        <div className="p-8 text-center">
          {status === "loading" && (
            <>
              <Loader2 className="w-12 h-12 mx-auto animate-spin text-primary mb-4" style={{ color: "#1a3d2a" }} />
              <p className="text-foreground" style={{ color: "#1a3d2a" }}>
                جارٍ معالجة طلبك...
              </p>
            </>
          )}

          {status === "success" && (
            <>
              <CheckCircle2 className="w-16 h-16 mx-auto mb-4" style={{ color: "#1a3d2a" }} />
              <h1 className="text-xl font-bold mb-2" style={{ color: "#1a3d2a" }}>
                تم إلغاء الاشتراك بنجاح
              </h1>
              <p className="text-sm text-gray-600 mb-6 leading-relaxed">
                لن تستلم بعد الآن رسائل ترويجية على البريد:
                <br />
                <span className="font-mono text-xs" dir="ltr">{resolvedEmail}</span>
              </p>
              <p className="text-xs text-gray-500 leading-relaxed mb-6">
                ملاحظة: ستستمر في تلقي الرسائل المتعلقة بحجوزاتك ورحلاتك
                (مثل تأكيد الحجز والتذكيرات) لأنها ضرورية لاستخدام الخدمة.
                لإيقافها أيضاً، يمكنك تعديل ذلك من إعدادات حسابك.
              </p>
            </>
          )}

          {status === "already" && (
            <>
              <CheckCircle2 className="w-16 h-16 mx-auto mb-4" style={{ color: "#1a3d2a" }} />
              <h1 className="text-xl font-bold mb-2" style={{ color: "#1a3d2a" }}>
                لقد ألغيت اشتراكك سابقاً
              </h1>
              <p className="text-sm text-gray-600 mb-6 leading-relaxed">
                لم تكن مشتركاً في الرسائل الترويجية أصلاً، أو ألغيت اشتراكك من قبل.
              </p>
            </>
          )}

          {status === "invalid" && (
            <>
              <XCircle className="w-16 h-16 mx-auto mb-4 text-red-500" />
              <h1 className="text-xl font-bold mb-2" style={{ color: "#1a3d2a" }}>
                الرابط غير صالح
              </h1>
              <p className="text-sm text-gray-600 mb-6 leading-relaxed">
                يبدو أن الرابط منتهي الصلاحية أو معطوب. لإلغاء اشتراكك في الرسائل
                الترويجية، يرجى تسجيل الدخول وتعديل الإعدادات من حسابك.
              </p>
            </>
          )}

          {status === "error" && (
            <>
              <XCircle className="w-16 h-16 mx-auto mb-4 text-amber-500" />
              <h1 className="text-xl font-bold mb-2" style={{ color: "#1a3d2a" }}>
                تعذّر إكمال الطلب
              </h1>
              <p className="text-sm text-gray-600 mb-6 leading-relaxed">
                حدث خطأ مؤقت. يمكنك المحاولة مرة أخرى لاحقاً، أو تسجيل الدخول
                وإلغاء الاشتراك من إعدادات حسابك.
              </p>
            </>
          )}

          {status !== "loading" && (
            <Link
              to="/"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-white font-bold text-sm"
              style={{ background: "#1a3d2a" }}
            >
              <Home className="w-4 h-4" />
              العودة إلى مشوارو
            </Link>
          )}
        </div>

        {/* Compliance footer */}
        <div className="px-8 py-4 text-center text-xs text-gray-500 border-t" style={{ background: "#faf5e6" }}>
          مشوارو — رام الله، فلسطين
          <br />
          © 2026 مشوارو. جميع الحقوق محفوظة.
        </div>
      </div>
    </div>
  );
}
