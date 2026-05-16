import { CITIES } from "@/lib/cities";
import { useSEO } from "@/hooks/useSEO";
import { getNotifTarget } from "@/lib/notificationRouting";
import { useNotificationActions } from "@/lib/useNotificationActions";
import React, { useState, useEffect } from "react";
import { api } from "@/api/apiClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Plus, Trash2, MapPin, ArrowLeft, DollarSign, Calendar, ToggleLeft, ToggleRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import EmptyState from "@/components/shared/EmptyState";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import CityAutocomplete from "@/components/shared/CityAutocomplete";

const emptyForm = {
  from_city: "",
  to_city: "",
  max_price: "",
  preferred_date: "",
  notify_on_price: true,
  notify_on_date: true,
};

export default function Notifications() {
  useSEO({ title: "الإشعارات", description: "إشعارات حسابك في مشوارو" });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  // Default to "inbox" — when a user lands on /notifications (either
  // by tapping the "عرض جميع الإشعارات" footer link, by URL, or by the
  // type-based fallback for notifications without trip_id+link), they
  // expect to see the inbox first, not the preferences settings UI.
  // The previous default ("preferences") was confusing — admin tapping
  // a verification notification would land here and not understand
  // why a route-watcher form was the first thing they saw.
  const [activeTab, setActiveTab] = useState("inbox");
  const qc = useQueryClient();
  const navigate = useNavigate();

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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["preferences"] }); toast.success("تم حذف التفضيل"); },
    onError: (err) => toast.error(friendlyError(err, "تعذر حذف التفضيل")),
  });

  // Unified actions hook — same source of truth as the bell popup. The
  // hook does optimistic update + RLS-no-op detection + rollback so we
  // never lie to the user about whether a notification is read.
  const { markRead, markAllRead, removeNotif } = useNotificationActions(user?.email);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

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
                  type="number"
                  min="0"
                  max="1000"
                  placeholder="مثال: 80"
                  value={form.max_price}
                  onChange={(e) => setForm({ ...form, max_price: e.target.value })}
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
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 font-bold text-foreground">
                      <MapPin className="w-4 h-4 text-primary" />
                      <span>{pref.from_city}</span>
                      <ArrowLeft className="w-4 h-4 text-muted-foreground" />
                      <span>{pref.to_city}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => togglePref.mutate({ id: pref.id, is_active: !pref.is_active })}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        title={pref.is_active ? "تعطيل" : "تفعيل"}
                      >
                        {pref.is_active
                          ? <ToggleRight className="w-6 h-6 text-primary" />
                          : <ToggleLeft className="w-6 h-6" />}
                      </button>
                      <button
                        onClick={() => deletePref.mutate(pref.id)}
                        className="p-1 rounded-lg hover:bg-destructive/10 text-destructive"
                      >
                        <Trash2 className="w-4 h-4" />
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
            <div className="space-y-3">
              {notifications.map((notif) => (
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
                              اضغط للعرض ←
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
        </div>
      )}
    </div>
  );
}