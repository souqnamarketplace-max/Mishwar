import React, { useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Calendar, Clock, Users, MapPin, Eye, MessageSquare, Star, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/api/apiClient";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthContext";
import { useSEO } from "@/hooks/useSEO";
import { useBlockedEmails } from "@/lib/blockUtils";
import { isDeletedUserEmail } from "@/lib/userStatus";
import RequestStatusBadge from "@/components/requests/RequestStatusBadge";
import UserActionsMenu from "@/components/shared/UserActionsMenu";

/**
 * RequestDetails — driver-facing detail view for a single passenger
 * trip request. Mirrors TripDetails.jsx (the passenger-facing trip view)
 * for visual consistency: route header, trip facts card, person profile
 * card, primary CTA.
 *
 * Flow:
 *   /passenger-requests (list)
 *     → tap a card
 *     → /passenger-requests/:id (this page)        ← driver reviews the request
 *     → tap "راسل الراكب"
 *     → /messages?to=<passenger>&request=<id>     ← chat scoped to this request
 *
 * Why an intermediate page rather than jumping straight to chat:
 *   - Driver should see full trip details + passenger profile BEFORE
 *     committing to a message — that's the designed UX
 *   - view_count needs an unambiguous "viewed" event; the list page is
 *     a flyover, the detail page is a real read
 *   - Each request gets its OWN message thread (the chat is keyed by
 *     request_id), which matches the mental model "this is a different
 *     conversation than the last passenger request I responded to"
 *
 * Privacy / self-protect: if the current user IS the passenger who
 * created this request, we redirect to /my-requests rather than show
 * "Message Passenger" pointing at themselves.
 */
const FLEX_LABEL = {
  exact:     null,
  morning:   "صباحاً",
  afternoon: "بعد الظهر",
  evening:   "مساءً",
  flexible:  "أي وقت",
};

const PS_MONTHS = [
  "كانون الثاني","شباط","آذار","نيسان","أيار","حزيران",
  "تموز","آب","أيلول","تشرين الأول","تشرين الثاني","كانون الأول",
];

function fmtFullDate(dateStr) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr + "T12:00:00");
    if (isNaN(d.getTime())) return dateStr;
    const today = new Date(); today.setHours(0,0,0,0);
    const target = new Date(d); target.setHours(0,0,0,0);
    const diff = Math.round((target - today) / 86400000);
    const base = `${d.getDate()} ${PS_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    if (diff === 0) return `${base} (اليوم)`;
    if (diff === 1) return `${base} (غداً)`;
    return base;
  } catch { return dateStr; }
}

function fmtTime(req) {
  if (req.time_flexibility === "exact" && req.requested_time) {
    return req.requested_time.slice(0, 5);
  }
  return FLEX_LABEL[req.time_flexibility] || "أي وقت";
}

export default function RequestDetails() {
  useSEO({ title: "تفاصيل طلب الراكب", description: "مراجعة طلب رحلة من راكب والتواصل معه" });

  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const blockedSet = useBlockedEmails();

  // ─── Fetch the request ────────────────────────────────────────
  // Single-row lookup. RLS on trip_requests (migration 019) restricts
  // visibility to subscribed drivers + the owning passenger, so an
  // unauthorized fetch returns no row rather than 403 — we surface
  // that the same way as "request not found / expired".
  const { data: request, isLoading, isError } = useQuery({
    queryKey: ["trip-request", id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("trip_requests")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data || null;
    },
    enabled: !!id,
    staleTime: 30_000,
  });

  // ─── Fetch passenger profile (avatar, rating, reviews) ────────
  const passengerEmail = request?.passenger_email;
  const { data: passengerProfile } = useQuery({
    queryKey: ["passenger-profile-by-email", passengerEmail],
    queryFn: async () => {
      if (!passengerEmail) return null;
      const rows = await api.entities.Profile.filter({ email: passengerEmail }, "-created_at", 1);
      return rows?.[0] || null;
    },
    enabled: !!passengerEmail,
    staleTime: 60_000,
  });

  // ─── Track view ───────────────────────────────────────────────
  // Increments view_count on the request. Server-side dedup via the
  // same UNIQUE INDEX pattern as track_request_contact (one view per
  // viewer per request). Fire-and-forget, analytics only.
  //
  // We use `await` inside an async IIFE rather than chaining `.catch()`
  // — supabase.rpc() returns a PostgrestFilterBuilder which is
  // thenable but NOT a Promise, so a direct `.catch()` chain throws
  // synchronously and bubbles to the page-level ErrorBoundary
  // (the exact bug that took down /messages?...&request= before
  // commit c546856). Same idiom now used wherever we fire-and-forget
  // a supabase RPC from a useEffect.
  useEffect(() => {
    if (!id || !user?.email || !passengerEmail) return;
    if (passengerEmail === user.email) return; // viewing your own request
    (async () => {
      try {
        await supabase.rpc("track_request_view", { p_request_id: id });
      } catch { /* non-fatal — analytics only */ }
    })();
  }, [id, user?.email, passengerEmail]);

  // ─── Self-protect: passenger viewing their own request ────────
  // The request author shouldn't see a "Message Passenger" button
  // pointing at themselves. Redirect them to /my-requests where they
  // can edit/cancel instead.
  useEffect(() => {
    if (!request || !user?.email) return;
    if (request.passenger_email === user.email || request.created_by === user.email) {
      navigate("/my-requests", { replace: true });
    }
  }, [request, user?.email, navigate]);

  // ─── Loading / not found ──────────────────────────────────────
  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center" dir="rtl">
        <p className="text-muted-foreground">جاري التحميل...</p>
      </div>
    );
  }

  if (isError || !request) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center" dir="rtl">
        <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl">🔍</span>
        </div>
        <h2 className="text-xl font-bold mb-2">الطلب غير متاح</h2>
        <p className="text-sm text-muted-foreground mb-6">
          قد يكون الطلب قد انتهى أو تم إلغاؤه.
        </p>
        <Link to="/passenger-requests">
          <Button className="rounded-xl">العودة إلى طلبات الركاب</Button>
        </Link>
      </div>
    );
  }

  // ─── Derived state ────────────────────────────────────────────
  const isBlocked = !!(passengerEmail && blockedSet.has(passengerEmail));
  const isDeleted = isDeletedUserEmail(passengerEmail);
  const isOpen    = request.status === "open";
  const canMessage = isOpen && !isBlocked && !isDeleted;

  const passengerAvatar = passengerProfile?.profile_picture
                       || passengerProfile?.selfie_url
                       || passengerProfile?.avatar
                       || passengerProfile?.avatar_url
                       || null;
  const passengerRating       = passengerProfile?.rating ?? null;
  const passengerReviewsCount = passengerProfile?.reviews_count ?? 0;

  const onMessage = () => {
    if (!canMessage) return;
    const params = new URLSearchParams({
      to:      request.passenger_email,
      name:    request.passenger_name || request.passenger_email.split("@")[0],
      request: request.id,
    });
    navigate(`/messages?${params.toString()}`);
  };

  // ─── Render ───────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-28" dir="rtl">
      <Link
        to="/passenger-requests"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="w-4 h-4 rotate-180" />
        طلبات الركاب
      </Link>

      {/* ─── Title row ─── */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-foreground leading-tight">
            {request.from_city} <span className="text-muted-foreground mx-1">←</span> {request.to_city}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            طلب من راكب يبحث عن سائق
          </p>
        </div>
        <RequestStatusBadge status={request.status} />
      </div>

      {/* ─── Trip facts ─── */}
      <div className="bg-card rounded-2xl border border-border p-5 mb-4">
        <h3 className="font-bold text-foreground mb-4">تفاصيل الطلب</h3>

        <div className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
          <div>
            <div className="flex items-center gap-1.5 text-muted-foreground text-xs mb-1">
              <Calendar className="w-3.5 h-3.5" />
              التاريخ
            </div>
            <p className="font-medium text-foreground">{fmtFullDate(request.requested_date)}</p>
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-muted-foreground text-xs mb-1">
              <Clock className="w-3.5 h-3.5" />
              الوقت
            </div>
            <p className="font-medium text-foreground">{fmtTime(request)}</p>
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-muted-foreground text-xs mb-1">
              <Users className="w-3.5 h-3.5" />
              عدد المقاعد
            </div>
            <p className="font-medium text-foreground">
              {request.seats_needed} {request.seats_needed === 1 ? "مقعد" : "مقاعد"}
            </p>
          </div>
          <div>
            <div className="text-muted-foreground text-xs mb-1">السعر المقترح</div>
            <p className="font-bold text-primary">₪{request.suggested_price}</p>
          </div>
        </div>

        {(request.pickup_details || request.dropoff_details) && (
          <div className="mt-4 pt-4 border-t border-border space-y-2 text-sm">
            {request.pickup_details && (
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-green-600" />
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">نقطة الانطلاق</p>
                  <p className="text-foreground">{request.pickup_details}</p>
                </div>
              </div>
            )}
            {request.dropoff_details && (
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-destructive" />
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">نقطة الوصول</p>
                  <p className="text-foreground">{request.dropoff_details}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {request.notes && (
          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-xs text-muted-foreground mb-1">ملاحظات الراكب</p>
            <p className="text-sm text-foreground/90 bg-muted/40 rounded-lg p-3 whitespace-pre-wrap">
              {request.notes}
            </p>
          </div>
        )}
      </div>

      {/* ─── Passenger profile ─── */}
      <div className="bg-card rounded-2xl border border-border p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-foreground">عن الراكب</h3>
          {/* Block / Report — same drop-in used on Messages, TripDetails, etc */}
          <UserActionsMenu
            targetEmail={passengerEmail}
            targetName={request.passenger_name}
            contextType="request"
            contextId={request.id}
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-xl font-bold text-primary shrink-0 overflow-hidden">
            {passengerAvatar ? (
              <img loading="lazy" decoding="async" src={passengerAvatar} alt="" className="w-full h-full object-cover" />
            ) : (
              request.passenger_name?.[0] || "ر"
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-bold truncate">{request.passenger_name || "راكب"}</h4>
            <div className="flex items-center gap-1 mt-0.5">
              <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
              <span className="text-sm font-medium">
                {passengerRating != null ? Number(passengerRating).toFixed(1) : "جديد"}
              </span>
              <span className="text-xs text-muted-foreground">
                {passengerReviewsCount > 0 ? `(${passengerReviewsCount} تقييم)` : "(لا يوجد تقييم بعد)"}
              </span>
            </div>
          </div>
          {/* Canonical /profile/:id link — uses the passenger profile's
              UUID from passengerProfile fetched above. Until the profile
              query resolves, render a non-clickable label so we never
              fall back to /profile?email= (the leak this refactor fixes). */}
          {passengerProfile?.id ? (
            <Link
              to={`/profile/${passengerProfile.id}`}
              className="text-xs text-primary hover:underline shrink-0"
            >
              عرض الملف ←
            </Link>
          ) : (
            <span className="text-xs text-muted-foreground shrink-0">عرض الملف ←</span>
          )}
        </div>
      </div>

      {/* ─── Stats footer ─── */}
      <div className="flex items-center justify-center gap-6 text-xs text-muted-foreground mb-6">
        <span className="flex items-center gap-1.5">
          <Eye className="w-3.5 h-3.5" />
          {request.view_count || 0} مشاهدة
        </span>
        <span className="flex items-center gap-1.5">
          <MessageSquare className="w-3.5 h-3.5" />
          {request.contact_count || 0} تواصل
        </span>
      </div>

      {/* ─── Primary CTA ─── */}
      {canMessage ? (
        <Button
          onClick={onMessage}
          className="w-full h-14 rounded-xl text-base font-bold gap-2"
        >
          <MessageCircle className="w-5 h-5" />
          راسل الراكب
        </Button>
      ) : (
        <div className="bg-muted/40 border border-border rounded-xl p-4 text-center text-sm text-muted-foreground">
          {!isOpen && "هذا الطلب لم يعد متاحاً للتواصل"}
          {isOpen && isDeleted && "تم حذف حساب الراكب"}
          {isOpen && !isDeleted && isBlocked && "لا يمكنك مراسلة هذا الراكب — أحدكما حظر الآخر"}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground text-center mt-3">
        كل محادثة عن هذا الطلب ستظهر كمحادثة منفصلة في رسائلك
      </p>
    </div>
  );
}
