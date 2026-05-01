import { CITIES } from "@/lib/cities";
import { useSEO } from "@/hooks/useSEO";
import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Plus, Trash2, MapPin, ArrowLeft, DollarSign, Calendar, ToggleLeft, ToggleRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import EmptyState from "@/components/shared/EmptyState";
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
  useSEO({ title: "الإشعارات", description: "إشعارات حسابك في مِشوار" });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [activeTab, setActiveTab] = useState("preferences");
  const qc = useQueryClient();

  // Fetch user
  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: () => base44.auth.me(),
  });

  // Preferences
  const { data: preferences = [] } = useQuery({
    queryKey: ["preferences"],
    queryFn: () => base44.entities.TripPreference.list("-created_date", 50),
  });

  // Notifications
  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications", user?.email],
    queryFn: () =>
      user?.email
        ? base44.entities.Notification.filter({ user_email: user.email }, "-created_date", 30)
        : [],
    enabled: !!user?.email,
  });

  // Real-time subscription for notifications & preferences
  useEffect(() => {
    if (!user?.email) return;
    const unsubNotif = base44.entities.Notification.subscribe((event) => {
      qc.invalidateQueries({ queryKey: ["notifications", user.email] });
    });
    const unsubPref = base44.entities.TripPreference.subscribe((event) => {
      qc.invalidateQueries({ queryKey: ["preferences"] });
    });
    return () => { unsubNotif(); unsubPref(); };
  }, [user?.email, qc]);

  const createPref = useMutation({
    mutationFn: (data) => base44.entities.TripPreference.create({
      ...data,
      user_email: user?.email,
      user_name: user?.full_name,
      max_price: data.max_price ? Number(data.max_price) : null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["preferences"] });
      setForm(emptyForm);
      setShowForm(false);
      toast.success("تم إضافة التفضيل بنجاح ✅");
    },
  });

  const togglePref = useMutation({
    mutationFn: ({ id, is_active }) => base44.entities.TripPreference.update(id, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["preferences"] }),
  });

  const deletePref = useMutation({
    mutationFn: (id) => base44.entities.TripPreference.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["preferences"] }); toast.success("تم حذف التفضيل"); },
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      const unread = notifications.filter((n) => !n.is_read);
      await Promise.all(unread.map((n) => base44.entities.Notification.update(n.id, { is_read: true })));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications", user?.email] }),
  });

  const deleteNotif = useMutation({
    mutationFn: (id) => base44.entities.Notification.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications", user?.email] }),
  });

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
          <Button variant="outline" className="rounded-xl gap-2 h-10" onClick={() => markAllRead.mutate()}>
            <Check className="w-4 h-4" />
            تحديد الكل كمقروء
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/50 p-1 rounded-xl mb-6">
        {[
          { id: "preferences", label: `تفضيلاتي (${preferences.length})` },
          { id: "inbox", label: `صندوق الإشعارات${unreadCount > 0 ? ` (${unreadCount})` : ""}` },
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
                  onClick={async () => {
                    // Mark as read
                    if (!notif.is_read) {
                      try { await base44.entities.Notification.update(notif.id, { is_read: true }); } catch {}
                      qc.invalidateQueries({ queryKey: ["notifications", user?.email] });
                    }
                    // Type-based routing
                    const link = notif.link;
                    if (link) { navigate(link); return; }
                    switch (notif.type) {
                      case 'booking_received':    navigate('/my-trips?tab=driver'); break;
                      case 'booking_cancelled':   navigate('/my-trips?tab=driver'); break;
                      case 'trip_cancelled':      navigate('/my-trips'); break;
                      case 'license_approved':
                      case 'license_rejected':    navigate('/settings'); break;
                      case 'new_message':         navigate('/messages'); break;
                      case 'new_review':
                      default:
                        if (notif.trip_id) navigate(`/trip/${notif.trip_id}`);
                        break;
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
                          {notif.trip_id && (
                            <span className="text-xs text-primary">
                              اضغط للعرض ←
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {((notif.created_at) ? new Date(notif.created_at).toLocaleDateString("ar") : "—")}
                          </span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => deleteNotif.mutate(notif.id)}
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