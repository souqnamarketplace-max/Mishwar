import { CITIES } from "@/lib/cities";
import { useSEO } from "@/hooks/useSEO";
import { getNotifTarget } from "@/lib/notificationRouting";
import { useNotificationActions } from "@/lib/useNotificationActions";
import { normalizeDigits } from "@/lib/validation";
import React, { useState, useEffect, useMemo } from "react";
import { api } from "@/api/apiClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Plus, Trash2, MapPin, ArrowLeft, DollarSign, Calendar, ToggleLeft, ToggleRight, Check, AlertTriangle, X as XIcon, Loader2, MessageCircle, Car, UserCheck, Sparkles, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import EmptyState from "@/components/shared/EmptyState";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { createPortal } from "react-dom";
import CityAutocomplete from "@/components/shared/CityAutocomplete";

const emptyForm = {
  from_city: "",
  to_city: "",
  max_price: "",
  preferred_date: "",
  notify_on_price: true,
  notify_on_date: true,
};

// ─── Notification type → category mapping ────────────────────────────
//
// The notifications table holds 20+ distinct `type` values: booking_*,
// trip_*, new_message, favorite_driver_new_trip, subscription_*,
// admin_broadcast, account_verified, password_reset_requested, etc.
//
// Surfacing all of them in one flat list overwhelms the user. The
// categories below group related types so a passenger looking for
// "did anyone reply to my message?" can filter to messages only,
// without having to scan through 30 review notifications and
// admin broadcasts.
//
// CATEGORY DESIGN:
//   - رحلات (trips): everything trip + booking lifecycle
//   - رسائل (messages): chat-related
//   - المفضلة (favorites): proactive alerts from saved drivers/routes
//   - النظام (system): account/admin/billing — everything else
//
// 'all' is the implicit default — no filter, show everything in
// chronological order.
//
// New notification types added later: add a mapping here. Anything
// unmapped falls into 'system' as a safe default — users still see
// it under "All" and under "System", just not under a more specific
// category. Better to undercount a category than to silently hide.
const NOTIFICATION_CATEGORIES = {
  trips: {
    label: "رحلات",
    icon: Car,
    types: [
      "booking_created", "booking_confirmed", "booking_rejected",
      "booking_cancelled", "booking_cancelled_by_passenger",
      "driver_cancel_confirmed_booking", "driver_confirm_booking",
      "trip_created", "trip_starting_soon", "trip_completed",
      "trip_cancelled", "trip_updated", "driver_review_submitted",
      "passenger_review_submitted",
    ],
  },
  messages: {
    label: "رسائل",
    icon: MessageCircle,
    types: ["new_message", "message_received"],
  },
  favorites: {
    label: "المفضلة",
    icon: Sparkles,
    types: ["favorite_driver_new_trip", "trip_preference_match", "route_alert"],
  },
  system: {
    label: "النظام",
    icon: Settings,
    types: [
      "admin_broadcast", "account_verified", "subscription_approved",
      "subscription_rejected", "subscription_expiring", "subscription_granted",
      "password_reset_requested", "driver_license_approved",
      "driver_license_rejected", "passenger_verification_approved",
      "passenger_verification_rejected", "email_changed",
    ],
  },
};

// Reverse lookup: type → category key. Built once at module load.
// Anything not in this map falls into 'system' via the helper below.
const TYPE_TO_CATEGORY = Object.entries(NOTIFICATION_CATEGORIES).reduce(
  (acc, [catKey, cat]) => {
    cat.types.forEach((t) => { acc[t] = catKey; });
    return acc;
  },
  {}
);

function categoryFor(notifType) {
  return TYPE_TO_CATEGORY[notifType] || "system";
}

// Detects "private thank-you" notifications from PassengerReviewWizard.
// The producer inserts notifications with title "رسالة خاصة من راكب 📩"
// when a passenger sends a private message alongside their review. The
// notification's link points to /notifications (this page), which was
// effectively a dead end — tapping the card from this page did nothing
// since navigate(currentPath) is a no-op. We intercept those clicks and
// render a dedicated modal instead, with clear "no reply needed" copy.
//
// Title-based detection (rather than a new notif.type) keeps the change
// scoped: no migration, no producer change, no admin_audit_log churn.
// If/when we add more "view-only" notification kinds, we can promote
// this to a notif.kind field. For now, one-message families don't
// justify the schema work.
function isPrivateThankYou(notif) {
  if (!notif) return false;
  const t = notif.title || "";
  return t.includes("رسالة خاصة");
}

export default function Notifications() {
  useSEO({ title: "الإشعارات", description: "إشعارات حسابك في مشوارو" });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  // Tracks which preference id is in the delete-confirmation modal.
  // null = no modal, uuid = modal open for that preference.
  const [deletePending, setDeletePending] = useState(null);
  // Default to "inbox" — when a user lands on /notifications (either
  // by tapping the "عرض جميع الإشعارات" footer link, by URL, or by the
  // type-based fallback for notifications without trip_id+link), they
  // expect to see the inbox first, not the preferences settings UI.
  // The previous default ("preferences") was confusing — admin tapping
  // a verification notification would land here and not understand
  // why a route-watcher form was the first thing they saw.
  const [activeTab, setActiveTab] = useState("inbox");
  // Notification category filter — 'all' (default) shows the full
  // inbox in chronological order; the other keys filter to a single
  // category. Persisted only in component state, NOT in URL or
  // localStorage — the filter is exploratory ('what messages did I
  // miss?') rather than a saved preference. Resetting on every visit
  // matches the user's mental model (a fresh look at the inbox).
  const [activeCategory, setActiveCategory] = useState("all");
  // Modal for "private thank-you" notifications (post-trip messages from
  // passengers via PassengerReviewWizard). The producer sets link to
  // "/notifications" which routed users to this page — but tapping the
  // card on the page itself was a no-op (target === current path → skip
  // navigate). Now we render a dedicated modal that shows the full
  // message with explicit "no reply needed" framing, since these are
  // one-way thank-you notes attached to a completed trip's review, not
  // a chat thread the driver should reply to.
  const [viewingMessage, setViewingMessage] = useState(null);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Fetch user
  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.auth.me(),
  });

  // Preferences
  const { data: preferences = [] } = useQuery({
    queryKey: ["preferences"],
    queryFn: () => api.entities.TripPreference.list("-created_date", 50),
  });

  // Notifications
  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications", user?.email],
    queryFn: () =>
      user?.email
        ? api.entities.Notification.filter({ user_email: user.email }, "-created_date", 30)
        : [],
    enabled: !!user?.email,
  });

  // Auto-open the thank-you modal when ?msg=<notif_id> is in the URL.
  // This is how the bell popup (NotificationBell.jsx) delivers users
  // who tap a thank-you notification: routing returns
  // /notifications?msg=<id>, this effect fires when notifications load,
  // finds the row, opens the modal, then strips the param so refresh
  // doesn't keep re-opening it.
  useEffect(() => {
    const targetId = searchParams.get("msg");
    if (!targetId || notifications.length === 0) return;
    const match = notifications.find((n) => String(n.id) === targetId);
    if (match && isPrivateThankYou(match)) {
      setViewingMessage(match);
      // Strip the param so the modal doesn't re-open on every render
      // and the URL stays clean after they close it.
      const params = new URLSearchParams(searchParams);
      params.delete("msg");
      setSearchParams(params, { replace: true });
    }
  }, [searchParams, notifications, setSearchParams]);

  // Real-time subscription for notifications. TripPreference subscription
  // was removed — saved-route preferences are a low-frequency niche
  // feature, and the 60s staleTime is sufficient when the user is on
  // this page. Dropping that channel saves one shared realtime
  // subscription per logged-in user on this page.
  useEffect(() => {
    if (!user?.email) return;
    const unsubNotif = api.entities.Notification.subscribe((event) => {
      qc.invalidateQueries({ queryKey: ["notifications", user.email] });
    });
    return () => { unsubNotif(); };
  }, [user?.email, qc]);

  const createPref = useMutation({
    mutationFn: (data) => {
      // Clamp max_price to sane range. Without this, a user could
      // type -50 or 99999999 and the server would have to reject it.
      // Bounds match RequestTrip.suggested_price for consistency.
      const rawPrice = data.max_price ? Number(data.max_price) : null;
      const maxPrice = rawPrice == null
        ? null
        : Math.min(Math.max(rawPrice, 0), 1000);
      return api.entities.TripPreference.create({
        ...data,
        user_email: user?.email,
        user_name: user?.full_name,
        max_price: maxPrice,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["preferences"] });
      setForm(emptyForm);
      setShowForm(false);
      toast.success("تم إضافة التفضيل بنجاح ✅");
    },
    // Previously: no onError. RLS denials and network errors silently
    // kept the form open with no feedback — user clicked save, nothing
    // happened, they tried again, still nothing. Now they at least
    // see what went wrong.
    onError: (err) => toast.error(friendlyError(err, "تعذر إضافة التفضيل")),
  });

  const togglePref = useMutation({
    mutationFn: ({ id, is_active }) => api.entities.TripPreference.update(id, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["preferences"] }),
    onError: (err) => toast.error(friendlyError(err, "تعذر تحديث التفضيل")),
  });

  const deletePref = useMutation({
    mutationFn: (id) => api.entities.TripPreference.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["preferences"] });
      toast.success("تم حذف التفضيل");
      setDeletePending(null);
    },
    onError: (err) => {
      toast.error(friendlyError(err, "تعذر حذف التفضيل"));
      setDeletePending(null);
    },
  });

  // Resolve the pending preference for the modal (defensive — could
  // be null if the user opens then dismisses before this renders).
  const pendingPref = deletePending
    ? preferences.find((p) => p.id === deletePending)
    : null;

  // Unified actions hook — same source of truth as the bell popup. The
  // hook does optimistic update + RLS-no-op detection + rollback so we
  // never lie to the user about whether a notification is read.
  const { markRead, markAllRead, removeNotif } = useNotificationActions(user?.email);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  // Per-category counts (used both for the chip labels and to detect
  // empty-state cases for a category). Computed in one pass over
  // notifications so we don't iterate the array 5 times.
  const categoryCounts = useMemo(() => {
    const counts = { all: notifications.length, trips: 0, messages: 0, favorites: 0, system: 0 };
    for (const n of notifications) {
      const cat = categoryFor(n.type);
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  }, [notifications]);

  // Notifications filtered by the active category. 'all' is the
  // identity case (no filter applied). Recomputes only when
  // notifications or activeCategory changes — cheap, but the memo
  // keeps render references stable so the list doesn't re-mount on
  // unrelated parent re-renders (e.g. the unread badge refreshing).
  const filteredNotifications = useMemo(() => {
    if (activeCategory === "all") return notifications;
    return notifications.filter((n) => categoryFor(n.type) === activeCategory);
  }, [notifications, activeCategory]);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Bell className="w-6 h-6 text-primary" />
            الإشعارات الذكية
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            احصل على تنبيهات فورية عند توفر رحلات تناسبك
          </p>
        </div>
        {activeTab === "preferences" && (
          <Button
            onClick={() => setShowForm(!showForm)}
            className="bg-primary text-primary-foreground rounded-xl gap-2 h-10"
          >
            <Plus className="w-4 h-4" />
            تفضيل جديد
          </Button>
        )}
        {activeTab === "inbox" && unreadCount > 0 && (
          <Button variant="outline" className="rounded-xl gap-2 h-10" onClick={() => markAllRead()}>
            <Check className="w-4 h-4" />
            تحديد الكل كمقروء
          </Button>
        )}
      </div>

      {/* Tabs — inbox first (primary use case: read incoming notifications),
          preferences second (configure route-watchers). Order swapped from
          the original so a user landing on /notifications sees their inbox
          immediately. */}
      <div className="flex gap-1 bg-muted/50 p-1 rounded-xl mb-6">
        {[
          { id: "inbox", label: `صندوق الإشعارات${unreadCount > 0 ? ` (${unreadCount})` : ""}` },
          { id: "preferences", label: `تفضيلاتي (${preferences.length})` },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.id ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Add Preference Form */}
      {activeTab === "preferences" && showForm && (
        <div className="bg-card rounded-2xl border border-border p-5 mb-6">
          <h3 className="font-bold text-foreground mb-4">إضافة مسار مفضل</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-sm font-medium mb-1 block">من</label>
              <div className="bg-muted/50 rounded-xl border border-input">
                <CityAutocomplete
                  value={form.from_city}
                  onChange={(v) => setForm({ ...form, from_city: v })}
                  placeholder="ابحث عن مدينة الانطلاق..."
                  iconColor="primary"
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">إلى</label>
              <div className="bg-muted/50 rounded-xl border border-input">
                <CityAutocomplete
                  value={form.to_city}
                  onChange={(v) => setForm({ ...form, to_city: v })}
                  placeholder="ابحث عن مدينة الوجهة..."
                  iconColor="accent"
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">الحد الأقصى للسعر (اختياري)</label>
              <div className="relative">
                <DollarSign className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9٠-٩۰-۹]*"
                  placeholder="مثال: 80"
                  value={form.max_price}
                  onChange={(e) => setForm({ ...form, max_price: normalizeDigits(e.target.value).replace(/[^\d]/g, "") })}
                  className="pr-10 rounded-xl"
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">التاريخ المفضل (اختياري)</label>
              <div className="relative">
                <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="date"
                  value={form.preferred_date}
                  onChange={(e) => setForm({ ...form, preferred_date: e.target.value })}
                  className="pr-10 rounded-xl"
                />
              </div>
            </div>
          </div>

          {/* Toggle options */}
          <div className="flex flex-wrap gap-4 mb-4">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <div
                onClick={() => setForm({ ...form, notify_on_price: !form.notify_on_price })}
                className={`w-10 h-5 rounded-full transition-colors flex items-center px-0.5 ${form.notify_on_price ? "bg-primary" : "bg-muted"}`}
              >
                <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${form.notify_on_price ? "translate-x-0" : "-translate-x-5"}`} />
              </div>
              <span className="text-sm">إشعار عند تغير السعر</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <div
                onClick={() => setForm({ ...form, notify_on_date: !form.notify_on_date })}
                className={`w-10 h-5 rounded-full transition-colors flex items-center px-0.5 ${form.notify_on_date ? "bg-primary" : "bg-muted"}`}
              >
                <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${form.notify_on_date ? "translate-x-0" : "-translate-x-5"}`} />
              </div>
              <span className="text-sm">إشعار عند تطابق التاريخ</span>
            </label>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={() => createPref.mutate(form)}
              disabled={!form.from_city || !form.to_city || createPref.isPending}
              className="bg-primary text-primary-foreground rounded-xl"
            >
              {createPref.isPending ? "جاري الحفظ..." : "حفظ التفضيل"}
            </Button>
            <Button variant="outline" className="rounded-xl" onClick={() => setShowForm(false)}>إلغاء</Button>
          </div>
        </div>
      )}

      {/* Preferences List */}
      {activeTab === "preferences" && (
        <div>
          {preferences.length === 0 ? (
            <div className="bg-card rounded-2xl border border-border p-12 text-center">
              <Bell className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
              <p className="font-medium text-foreground mb-1">لا توجد تفضيلات بعد</p>
              <p className="text-sm text-muted-foreground">أضف مسارات مفضلة لتلقي إشعارات تلقائية</p>
            </div>
          ) : (
            <div className="space-y-3">
              {preferences.map((pref) => (
                <div key={pref.id} className={`bg-card rounded-2xl border p-4 transition-all ${pref.is_active ? "border-border" : "border-border/50 opacity-60"}`}>
                  <div className="flex items-center justify-between mb-3 gap-3">
                    <div className="flex items-center gap-2 font-bold text-foreground min-w-0 flex-1">
                      <MapPin className="w-4 h-4 text-primary shrink-0" />
                      <span className="truncate">{pref.from_city}</span>
                      <ArrowLeft className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="truncate">{pref.to_city}</span>
                    </div>
                    {/* Action cluster — both buttons hit the 44×44 touch
                        target Apple's HIG mandates. The old ToggleLeft/
                        ToggleRight icons were ~24px and packed tightly
                        next to a 24px trash icon, making mobile usage
                        tap-roulette. New: proper iOS-style switch
                        (40×24 toggle with thumb that slides) + 44px
                        square trash button with confirmation modal. */}
                    <div className="flex items-center gap-3 shrink-0">
                      {/* iOS-style switch */}
                      <button
                        type="button"
                        role="switch"
                        aria-checked={pref.is_active}
                        aria-label={pref.is_active ? "تعطيل التنبيهات لهذا المسار" : "تفعيل التنبيهات لهذا المسار"}
                        disabled={togglePref.isPending}
                        onClick={() => togglePref.mutate({ id: pref.id, is_active: !pref.is_active })}
                        className={`relative inline-flex items-center h-7 w-12 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary/40 ${
                          pref.is_active ? "bg-primary" : "bg-muted-foreground/30"
                        } ${togglePref.isPending ? "opacity-60 cursor-wait" : "cursor-pointer"}`}
                      >
                        <span
                          className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transform transition-transform duration-200 ${
                            // RTL-aware: in RTL the "on" position is at left
                            // (mirror of LTR). translate-x values negative for RTL.
                            pref.is_active ? "-translate-x-5" : "-translate-x-1"
                          }`}
                        />
                      </button>
                      {/* Delete with confirmation */}
                      <button
                        type="button"
                        aria-label="حذف التفضيل"
                        onClick={() => setDeletePending(pref.id)}
                        className="w-11 h-11 flex items-center justify-center rounded-xl hover:bg-destructive/10 text-destructive transition-colors"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {pref.max_price && (
                      <span className="text-xs bg-green-500/10 text-green-600 px-2 py-1 rounded-full flex items-center gap-1">
                        <DollarSign className="w-3 h-3" />
                        حتى ₪{pref.max_price}
                      </span>
                    )}
                    {pref.preferred_date && (
                      <span className="text-xs bg-accent/10 text-accent px-2 py-1 rounded-full flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {pref.preferred_date}
                      </span>
                    )}
                    {pref.notify_on_price && (
                      <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">إشعار السعر</span>
                    )}
                    {pref.notify_on_date && (
                      <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">إشعار التاريخ</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Notifications Inbox */}
      {activeTab === "inbox" && (
        <div>
          {notifications.length === 0 ? (
            <div className="bg-card rounded-2xl border border-border p-12 text-center">
              <Bell className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
              <p className="font-medium text-foreground mb-1">صندوق الإشعارات فارغ</p>
              <p className="text-sm text-muted-foreground">ستصلك إشعارات عند توفر رحلات تناسب تفضيلاتك</p>
            </div>
          ) : (
            <>
              {/* Category filter chips — horizontal scroll on mobile.
                  Counts shown inline so the user knows what's behind
                  each filter without tapping. Touch targets are 44px
                  min-height per HIG.

                  Why the chips are HERE (between tab bar and list)
                  rather than at the top of the page: they only apply
                  to the inbox tab. Putting them above the tab bar
                  would be misleading on the Preferences tab. */}
              <NotificationFilterChips
                notifications={notifications}
                activeCategory={activeCategory}
                onChange={setActiveCategory}
              />
              {filteredNotifications.length === 0 ? (
                <div className="bg-card rounded-2xl border border-border p-12 text-center">
                  <Bell className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
                  <p className="font-medium text-foreground mb-1">
                    لا توجد إشعارات في {NOTIFICATION_CATEGORIES[activeCategory]?.label || "هذا التصنيف"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    جرّب تصنيفاً آخر، أو اضغط "الكل" لرؤية جميع الإشعارات
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredNotifications.map((notif) => (
                <div
                  key={notif.id}
                  className={`bg-card rounded-2xl border p-4 transition-all cursor-pointer hover:shadow-sm ${!notif.is_read ? "border-primary/30 bg-primary/5" : "border-border"}`}
                  style={{ touchAction: "manipulation" }}
                  onClick={async () => {
                    // Mark-as-read uses the unified hook — handles
                    // optimistic flip, RLS no-op detection, and rollback.
                    // We fire-and-forget here so navigation isn't blocked
                    // on the server round-trip; the UI flips instantly
                    // via the optimistic cache update.
                    if (!notif.is_read) markRead(notif.id);
                    // Private thank-you messages get a modal popup instead
                    // of attempted navigation. The producer sets link to
                    // /notifications, which is THIS page — navigate to
                    // current path is a no-op, so the old behavior was
                    // "click did nothing visible". The modal shows the
                    // full message with explicit "no reply needed" copy.
                    if (isPrivateThankYou(notif)) {
                      setViewingMessage(notif);
                      return;
                    }
                    // Routing — single source of truth shared with the bell
                    // popup (src/lib/notificationRouting.js). Returns null
                    // for notifications with no actionable destination
                    // (e.g. admin_broadcast already shown inline). When
                    // null we stay on the page instead of navigating
                    // back to /notifications (a no-op that would feel
                    // broken to the user).
                    const target = getNotifTarget(notif);
                    if (target && target !== window.location.pathname + window.location.search) {
                      navigate(target);
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1">
                      <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${!notif.is_read ? "bg-primary" : "bg-muted-foreground/30"}`} />
                      <div>
                        <p className={`font-medium text-sm ${!notif.is_read ? "text-foreground" : "text-muted-foreground"}`}>
                          {notif.title}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{notif.message}</p>
                        <div className="flex items-center gap-3 mt-2">
                          {(notif.trip_id || notif.link) && (
                            <span className="text-xs text-primary">
                              {isPrivateThankYou(notif) ? "اضغط لقراءة الرسالة 💌" : "اضغط للعرض ←"}
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {((notif.created_at) ? new Date(notif.created_at).toLocaleDateString("ar-EG") : "—")}
                          </span>
                        </div>
                      </div>
                    </div>
                    {/* Delete button — stopPropagation is critical: the
                        parent <div> above has an onClick that marks-read
                        and navigates away. Without this, tapping the trash
                        icon would (a) delete the notification AND (b)
                        navigate the user away from the list mid-action.
                        The bell popup variant in NotificationBell.jsx
                        already does this correctly; the list page didn't. */}
                    <button
                      onClick={(e) => { e.stopPropagation(); removeNotif(notif.id); }}
                      className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ─── Delete confirmation modal ───────────────────────────────
          Two-step delete prevents fat-finger taps from wiping a saved
          route. createPortal isn't needed here — this component isn't
          inside a Framer Motion transform (unlike the bell popup),
          so fixed positioning works directly. */}
      {pendingPref && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center overflow-y-auto py-4 px-4"
          onClick={() => !deletePref.isPending && setDeletePending(null)}
          aria-hidden="true"
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-pref-title"
            aria-describedby="delete-pref-desc"
            className="bg-card rounded-2xl max-w-sm w-full p-6"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-destructive" aria-hidden="true" />
              </div>
              <div className="flex-1">
                <h3 id="delete-pref-title" className="font-bold text-foreground mb-1">حذف التفضيل</h3>
                <p id="delete-pref-desc" className="text-sm text-muted-foreground leading-relaxed">
                  هل أنت متأكد من حذف تنبيه المسار{" "}
                  <strong>{pendingPref.from_city} ← {pendingPref.to_city}</strong>؟
                  لن تصلك إشعارات عن رحلات هذا المسار بعد الحذف.
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <Button
                onClick={() => setDeletePending(null)}
                variant="outline"
                disabled={deletePref.isPending}
                className="flex-1"
              >
                إلغاء
              </Button>
              <Button
                onClick={() => deletePref.mutate(pendingPref.id)}
                disabled={deletePref.isPending}
                className="flex-1 bg-destructive hover:bg-destructive/90 text-white gap-2"
              >
                {deletePref.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                {deletePref.isPending ? "جارٍ الحذف..." : "حذف"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Private thank-you message modal ───────────────────────────
          Renders when the user taps a "رسالة خاصة من راكب" notification.
          Shows the full message body in a friendly format with explicit
          "no reply needed" copy. createPortal so it sits above the
          layout's stacking context (the route layout uses transforms
          for the page-transition animations, which would otherwise
          shrink-wrap fixed positioning to the wrong viewport). */}
      {viewingMessage && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm py-4 px-4"
          onClick={() => setViewingMessage(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="thank-you-modal-title"
        >
          <div
            className="bg-card rounded-2xl border border-border max-w-md w-full p-6 my-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-2xl" aria-hidden="true">💌</span>
                  <h2 id="thank-you-modal-title" className="text-lg font-bold text-foreground">
                    رسالة شكر من راكب
                  </h2>
                </div>
                <p className="text-xs text-muted-foreground">
                  {viewingMessage.created_at
                    ? new Date(viewingMessage.created_at).toLocaleDateString("ar-EG", {
                        year: "numeric", month: "long", day: "numeric",
                      })
                    : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewingMessage(null)}
                className="p-2 rounded-lg hover:bg-muted text-muted-foreground shrink-0"
                aria-label="إغلاق"
              >
                <XIcon className="w-4 h-4" />
              </button>
            </div>

            {/* Message body — preserve newlines via whitespace-pre-wrap
                in case the passenger sent a multi-line note. */}
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 mb-4">
              <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap break-words">
                {viewingMessage.message}
              </p>
            </div>

            {/* Explicit "no reply needed" disclosure — this is the
                user-requested change. Thank-you messages aren't a chat
                thread; they're a one-way courtesy attached to the
                passenger's post-trip review. */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
              <p className="text-xs text-amber-900 leading-relaxed">
                ℹ️ <strong>هذه رسالة شكر بعد انتهاء الرحلة</strong> — أُرسلت مع تقييم الراكب. لا حاجة للرد عليها، فلا توجد محادثة قائمة بعد اكتمال الرحلة.
              </p>
            </div>

            {/* Optional trip link — if the notification was attached to
                a specific trip, offer a way to see the trip details. */}
            {viewingMessage.trip_id && (
              <button
                type="button"
                onClick={() => {
                  setViewingMessage(null);
                  navigate(`/trip/${viewingMessage.trip_id}`);
                }}
                className="w-full mb-2 px-4 py-2.5 rounded-xl border border-border hover:bg-muted text-sm font-medium text-foreground transition-colors min-h-[44px]"
              >
                عرض تفاصيل الرحلة
              </button>
            )}

            <Button
              onClick={() => setViewingMessage(null)}
              className="w-full min-h-[44px]"
            >
              تم الاطلاع
            </Button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ─── Filter chips row ───────────────────────────────────────────────
//
// Horizontal scrollable row of category buttons. Each chip:
//   - Shows category label + count
//   - Highlights when active (primary background, white text)
//   - 44px min-height for App Store HIG compliance
//   - Tappable label includes the icon + count, no nested
//     interactive elements
//
// Layout:
//   - flex-row that overflows horizontally on narrow viewports
//   - First chip ('All') always present
//   - Category chips render only if that category has >0 notifications
//     (no point showing 'Messages (0)' if the user has no message
//     notifications — clutters the bar and reduces useful tap area)
//
// Why a scrollable row not a wrapping flex: chips wrapping creates
// vertical bulk on small screens and pushes the inbox below the fold.
// A single scrolling row stays compact and matches the iOS native
// category picker pattern (Mail, Photos albums, App Store filters).
function NotificationFilterChips({ notifications, activeCategory, onChange }) {
  // Compute counts inline — cheap, runs in render. The parent component
  // also computes these for empty-state purposes; duplicating the work
  // is fine since the array is bounded at 30 (matches the filter() in
  // the Notification query above).
  const counts = { all: notifications.length };
  for (const key of Object.keys(NOTIFICATION_CATEGORIES)) counts[key] = 0;
  for (const n of notifications) {
    const cat = categoryFor(n.type);
    counts[cat] = (counts[cat] || 0) + 1;
  }

  // Build chip list — always include 'all', then any category with >0
  // notifications. Order matches NOTIFICATION_CATEGORIES declaration
  // order for stability (trips first since most users care about
  // booking activity first, messages second, favorites third, system
  // last).
  const chips = [
    { key: "all", label: "الكل", icon: Bell, count: counts.all },
    ...Object.entries(NOTIFICATION_CATEGORIES)
      .filter(([key]) => counts[key] > 0)
      .map(([key, def]) => ({
        key,
        label: def.label,
        icon: def.icon,
        count: counts[key],
      })),
  ];

  return (
    <div
      className="flex gap-2 overflow-x-auto pb-2 mb-4 -mx-1 px-1"
      // hide scrollbar visually but keep keyboard scroll affordance
      style={{ scrollbarWidth: "none" }}
      role="tablist"
      aria-label="تصفية الإشعارات حسب التصنيف"
    >
      {chips.map(({ key, label, icon: Icon, count }) => {
        const isActive = activeCategory === key;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(key)}
            className={`shrink-0 inline-flex items-center gap-1.5 px-3 min-h-[44px] rounded-full text-sm font-medium border transition-colors ${
              isActive
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-card text-foreground border-border hover:bg-muted/50 active:bg-muted"
            }`}
          >
            <Icon className="w-4 h-4" aria-hidden="true" />
            <span>{label}</span>
            <span
              className={`text-xs ${isActive ? "opacity-90" : "text-muted-foreground"}`}
              aria-label={`${count} إشعار`}
            >
              ({count})
            </span>
          </button>
        );
      })}
    </div>
  );
}