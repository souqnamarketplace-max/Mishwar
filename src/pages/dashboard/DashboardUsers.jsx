import React, { useState } from "react";
import { logAdminAction } from "@/lib/adminAudit";
import { api } from "@/api/apiClient";
import { supabase } from "@/lib/supabase";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, Search, Shield, UserCheck, Mail, Trash2, Edit2, Car, Lock, Unlock, Copy, Eye, EyeOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import UserHistorySection from "@/components/dashboard/UserHistorySection";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import Pagination from "@/components/dashboard/Pagination";
import { usePaginatedData } from "@/hooks/usePaginatedData";
import { useConfirm } from "@/hooks/useConfirm";

export default function DashboardUsers() {
  // Pagination wired — see <Pagination /> at bottom
  const PAGE_SIZE = 25;
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all"); // all, driver, passenger, admin
  const [selectedUser, setSelectedUser] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [showAccessKey, setShowAccessKey] = useState(false);
  const qc = useQueryClient();

  React.useEffect(() => {
    const u = api.entities.Profile.subscribe(() => qc.invalidateQueries({ queryKey: ["users"] }));
    return () => u();
  }, []);

  // Server-side pagination — only loads 25 users at a time
  const [page, setPage] = useState(1);

  const { data: usersData = { rows: [], total: 0, totalPages: 1 }, isLoading } = useQuery({
    queryKey: ["users", page],
    queryFn: async () => {
      // Direct supabase to bypass api created_by auto-filter that hid
      // every user the admin didn't create themselves. Note: profiles
      // table uses created_at (not created_date) and does NOT have a
      // created_by column at all, but api still filters via current
      // session user, returning at most one row.
      const from = (page - 1) * PAGE_SIZE;
      const to   = from + PAGE_SIZE - 1;
      const { data, error, count } = await supabase
        .from("profiles")
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
  const users = usersData.rows;
  const totalUsers = usersData.total;
  const totalPages = usersData.totalPages;

  // Trip + booking counts per user — at scale (500k+ trips), the prior
  // implementation that fetched the latest 200 rows and counted in JS
  // produced silently-wrong "0 trips" for almost every user. Now we call
  // the user_activity_counts RPC (migration 014) with the 25 emails on
  // the current page, getting accurate aggregate counts in one roundtrip
  // regardless of how many trips/bookings exist in the system.
  //
  // RPC fallback handling: if the RPC doesn't exist yet (migration not
  // applied), we surface zeros instead of throwing — admins still get a
  // working page, just without counts.
  const pageEmails = users.map((u) => u.email).filter(Boolean);
  const { data: countsByEmail = {} } = useQuery({
    queryKey: ["user-activity-counts", pageEmails.join(",")],
    queryFn: async () => {
      if (pageEmails.length === 0) return {};
      const { data, error } = await supabase.rpc("user_activity_counts", {
        p_emails: pageEmails,
      });
      if (error) {
        // If the RPC is missing, return empty (page renders, counts show 0)
        if (
          error.code === "PGRST202" ||
          /function .* does not exist/i.test(error.message || "")
        ) {
          return {};
        }
        throw error;
      }
      // Reshape array → email-keyed map for O(1) lookup in render
      const map = {};
      for (const row of data || []) {
        map[row.email] = {
          trips: Number(row.trip_count || 0),
          bookings: Number(row.booking_count || 0),
        };
      }
      return map;
    },
    enabled: pageEmails.length > 0,
    staleTime: 30_000,
  });

  // Backwards-compatible shape so existing render code (`userTrips[u.email]`,
  // `userBookings[u.email]`) keeps working without touching the JSX.
  const userTrips    = Object.fromEntries(Object.entries(countsByEmail).map(([k, v]) => [k, v.trips]));
  const userBookings = Object.fromEntries(Object.entries(countsByEmail).map(([k, v]) => [k, v.bookings]));

  // Email-confirmation status per user. profiles table doesn't carry the
  // confirmation flag — it lives in auth.users.email_confirmed_at, which
  // RLS hides from regular clients. The emails_confirmation_status RPC
  // (migration 016) is admin-only and returns just (email, confirmed)
  // rows for the page's emails. Result shape: { [lowercaseEmail]: bool }.
  //
  // Used by the modal to show/hide the "Confirm manually" panel and by
  // the row to render a small ⚠️ next to unconfirmed users so the admin
  // sees at-a-glance who's stuck.
  const { data: confirmedByEmail = {} } = useQuery({
    queryKey: ["users-confirmation-status", pageEmails.join(",")],
    queryFn: async () => {
      if (pageEmails.length === 0) return {};
      const { data, error } = await supabase.rpc("emails_confirmation_status", {
        p_emails: pageEmails,
      });
      if (error) {
        // Silently degrade — don't break the page.
        // PGRST202 = function not found (migration not applied yet)
        // 42501     = admin only (non-admin user somehow on this page)
        if (
          error.code === "PGRST202" ||
          error.code === "42501"     ||
          /function .* does not exist/i.test(error.message || "") ||
          /admin only/i.test(error.message || "")
        ) {
          return {};
        }
        throw error;
      }
      const map = {};
      for (const row of data || []) {
        map[(row.email || "").toLowerCase()] = !!row.confirmed;
      }
      return map;
    },
    enabled: pageEmails.length > 0,
    staleTime: 30_000,
  });

  // Helper — returns true if user is confirmed, true if status unknown
  // (RPC missing). The "show warning" branch only triggers on explicit
  // false, so admins never see false-positive warnings.
  const isUserConfirmed = (user) => {
    if (!user?.email) return true;
    const v = confirmedByEmail[user.email.toLowerCase()];
    return v === undefined ? true : v;
  };

  const updateUserMutation = useMutation({
    mutationFn: (data) => api.functions.invoke('updateUserAdmin', {
      userId: data.id,
      data: {
        full_name: data.full_name,
        phone: data.phone,
        role: data.role,
        is_active: data.is_active,
      }
    }),
    onSuccess: (_, data) => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.success("تم تحديث بيانات المستخدم");
      logAdminAction("admin_update_user", "user", data.userId, { role: data.data?.role, is_active: data.data?.is_active });
      setShowModal(false);
    },
    onError: (error) => {
      toast.error(friendlyError(error, "حدث خطأ في التحديث"));
    }
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (user) => api.functions.invoke('updateUserAdmin', {
      userId: user.id,
      data: { is_active: !user.is_active }
    }),
    onSuccess: (_, user) => {
      qc.invalidateQueries({ queryKey: ["users"] });
      logAdminAction(user.is_active ? "admin_deactivate_user" : "admin_activate_user", "user", user.id, { email: user.email });
      toast.success("تم تحديث حالة المستخدم");
    },
    onError: (error) => {
      toast.error(friendlyError(error, "فشل التحديث"));
    }
  });

  // Manually mark a user's email as confirmed. The most common need
  // for this: a Palestinian user signs up but the confirmation email
  // never arrives (spam, ISP block, Supabase auth rate limit). Admin
  // verifies their identity through another channel and confirms here.
  // Migration 016's RPC writes directly to auth.users.email_confirmed_at.
  const confirmEmailMutation = useMutation({
    mutationFn: async (user) => {
      const { data, error } = await supabase.rpc("admin_confirm_user_email", {
        p_user_email: user.email,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data, user) => {
      qc.invalidateQueries({ queryKey: ["users"] });
      if (data?.already_confirmed) {
        toast.info("بريد المستخدم مؤكد بالفعل");
      } else if (data?.success) {
        toast.success("تم تأكيد بريد المستخدم — يستطيع الآن تسجيل الدخول ✓");
      } else {
        toast.error(data?.reason === "user_not_found" ? "المستخدم غير موجود" : "فشل التأكيد");
      }
    },
    onError: (error) => {
      toast.error(friendlyError(error, "فشل التأكيد"));
    }
  });

  const filtered = users.filter((u) => {
    // Match by full_name / email substring OR by exact account_number.
    // The account_number search accepts both raw '1000' and the
    // user-facing 'M-1000' format (the prefix is stripped before
    // comparison). Admins can paste exactly what the user reads to
    // them from the AccountSettings 'معرّف الحساب' field.
    let matchSearch = !search;
    if (!matchSearch) {
      const q = search.toLowerCase().trim();
      const acctMatch = q.replace(/^m[-\s]?/i, "");  // 'M-1000' / 'm-1000' / 'M 1000' → '1000'
      matchSearch =
        u.full_name?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        (u.account_number != null && String(u.account_number) === acctMatch);
    }

    const matchFilter = filter === "all" ||
      (filter === "admin" && u.role === "admin") ||
      (filter === "driver" && (u.account_type === "driver" || u.account_type === "both")) ||
      (filter === "passenger" && (u.account_type === "passenger" || u.account_type === "both"));

    return matchSearch && matchFilter;
  });

  const stats = [
    { label: "إجمالي المستخدمين", value: totalUsers, icon: Users, color: "text-primary" },
    { label: "سائقون", value: users.filter(u => u.account_type === "driver" || u.account_type === "both").length, icon: Car, color: "text-accent" },
    { label: "ركاب", value: users.filter(u => u.account_type === "passenger" || u.account_type === "both").length, icon: UserCheck, color: "text-green-600" },
    { label: "مشرفون", value: users.filter(u => u.role === "admin").length, icon: Shield, color: "text-yellow-600" },
  ];

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              <stat.icon className={`w-4 h-4 ${stat.color}`} />
            </div>
            <p className="text-2xl font-bold text-foreground">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Search & Filter */}
      <div className="bg-card rounded-xl border border-border">
        <div className="p-4 border-b border-border space-y-3">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث بالاسم أو الإيميل أو رقم الحساب (M-1000)..."
              aria-label="بحث في المستخدمين"
              className="pr-10 rounded-xl"
            />
          </div>
          <div className="flex gap-2">
            {[
              { value: "all", label: "الكل" },
              { value: "driver", label: "سائقون" },
              { value: "passenger", label: "ركاب" },
              { value: "admin", label: "مشرفون" },
            ].map((f) => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  filter === f.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">جاري التحميل...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center">
            <Users className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">لا توجد نتائج</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right text-xs text-muted-foreground border-b border-border bg-muted/30">
                  <th className="p-3">المستخدم</th>
                  <th className="p-3">النوع</th>
                  <th className="p-3">الإحصائيات</th>
                  <th className="p-3">الصلاحية</th>
                  <th className="p-3">الحالة</th>
                  <th className="p-3">التسجيل</th>
                  <th className="p-3">الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((user) => (
                  <tr key={user.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary overflow-hidden">
                          {user.avatar_url ? (
                            <img loading="lazy" src={user.avatar_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            user.full_name?.[0] || "؟"
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium truncate flex items-center gap-1">
                            {user.full_name || "—"}
                            {/* Small ⚠️ next to unconfirmed users so the
                                admin can spot them at a glance. Title
                                attribute provides hover context. */}
                            {!isUserConfirmed(user) && (
                              <span
                                className="text-xs text-amber-600"
                                title="البريد غير مؤكد — لا يستطيع المستخدم تسجيل الدخول"
                              >
                                ⚠️
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                          {/* Sequential account number (migration 041) —
                              same format users see on their /account-settings
                              page. Displayed as a small primary-coloured
                              pill so admins can spot 'M-1014' at a glance
                              when a user says "my ID is M-1014". */}
                          {user.account_number != null ? (
                            <span
                              className="inline-block mt-1 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-mono font-bold tracking-wider"
                              dir="ltr"
                            >
                              M-{user.account_number}
                            </span>
                          ) : (
                            <span
                              className="inline-block mt-1 px-2 py-0.5 rounded-md bg-muted text-muted-foreground text-[10px] font-mono"
                              dir="ltr"
                            >
                              MSH-{String(user.id || "").slice(0, 4).toUpperCase()}-{String(user.id || "").slice(4, 8).toUpperCase()}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="p-3">
                      <Badge variant="outline" className="text-xs">
                        {user.account_type === "both" ? "سائق + راكب" :
                         user.account_type === "driver" ? "سائق" :
                         "راكب"}
                      </Badge>
                    </td>
                    <td className="p-3">
                      <div className="text-xs space-y-0.5">
                        {user.account_type !== "passenger" && (
                          <p>🚗 {userTrips[user.email] || 0} رحلة</p>
                        )}
                        {user.account_type !== "driver" && (
                          <p>✓ {userBookings[user.email] || 0} حجز</p>
                        )}
                      </div>
                    </td>
                    <td className="p-3">
                      <Badge className={user.role === "admin" ? "bg-primary/10 text-primary border-0" : "bg-muted text-muted-foreground border-0"}>
                        {user.role === "admin" ? (
                          <span className="flex items-center gap-1"><Shield className="w-3 h-3" />مشرف</span>
                        ) : (
                          <span className="flex items-center gap-1"><UserCheck className="w-3 h-3" />مستخدم</span>
                        )}
                      </Badge>
                    </td>
                    <td className="p-3">
                      <Badge className={!user.is_active ? "bg-destructive/10 text-destructive border-0" : "bg-green-500/10 text-green-600 border-0"}>
                        {!user.is_active ? "معطل" : "نشط"}
                      </Badge>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {((user.created_at) ? new Date(user.created_at).toLocaleDateString("ar-EG") : "—")}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            setSelectedUser(user);
                            setEditForm({
                              id: user.id,
                              full_name: user.full_name,
                              phone: user.phone,
                              role: user.role,
                              is_active: user.is_active !== false,
                            });
                            setShowModal(true);
                          }}
                          className="p-1.5 hover:bg-muted rounded-lg transition-colors"
                          title="تعديل"
                        >
                          <Edit2 className="w-4 h-4 text-blue-600" />
                        </button>
                        <button
                          onClick={() => toggleActiveMutation.mutate(user)}
                          className="p-1.5 hover:bg-muted rounded-lg transition-colors"
                          disabled={toggleActiveMutation.isPending}
                          title={user.is_active ? "تعطيل" : "تفعيل"}
                        >
                          {user.is_active ? 
                            <Lock className="w-4 h-4 text-yellow-600" /> :
                            <Unlock className="w-4 h-4 text-yellow-600" />
                          }
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!isLoading && totalPages > 1 && (
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        )}
      </div>

      {/* User Edit Modal */}
      {showModal && selectedUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl border border-border max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5">
            <div>
              <h2 className="text-xl font-bold text-foreground">تعديل بيانات المستخدم</h2>
              <p className="text-sm text-muted-foreground">{selectedUser.email}</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Basic Info */}
              <div className="col-span-2 space-y-3">
                <div>
                  <Label className="text-sm">الاسم الكامل</Label>
                  <Input
                    value={editForm.full_name || ""}
                    onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })}
                    className="rounded-lg mt-1"
                  />
                </div>
                <div>
                  <Label className="text-sm">رقم الهاتف</Label>
                  <Input
                    value={editForm.phone || ""}
                    onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                    className="rounded-lg mt-1"
                  />
                </div>
              </div>

              {/* Account Type & Role */}
              <div>
                <Label className="text-sm">نوع الحساب</Label>
                <div className="mt-1 p-3 bg-muted/50 rounded-lg text-sm">
                  {selectedUser.account_type === "both" ? "سائق + راكب" :
                   selectedUser.account_type === "driver" ? "سائق" :
                   "راكب"}
                </div>
              </div>
              <div>
                <Label className="text-sm">الصلاحية</Label>
                <select
                  value={editForm.role || "user"}
                  onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm mt-1"
                >
                  <option value="user">مستخدم</option>
                  <option value="admin">مشرف</option>
                </select>
              </div>

              {/* Status */}
              <div className="col-span-2">
                <Label className="text-sm flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editForm.is_active !== false}
                    onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })}
                    className="rounded"
                  />
                  نشط
                </Label>
              </div>

              {/* Admin Access Key */}
              {selectedUser.role === "admin" && (
                <div className="col-span-2 bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-medium text-primary">🔑 مفتاح وصول المشرف</p>
                  <div className="flex items-center gap-2">
                    <Input
                      type={showAccessKey ? "text" : "password"}
                      value={`admin_${selectedUser.id.slice(0, 8)}`}
                      readOnly
                      className="flex-1 text-xs rounded-lg bg-background"
                    />
                    <button
                      onClick={() => setShowAccessKey(!showAccessKey)}
                      className="p-2 hover:bg-muted rounded-lg"
                    >
                      {showAccessKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(`admin_${selectedUser.id.slice(0, 8)}`);
                        toast.success("تم نسخ المفتاح");
                      }}
                      className="p-2 hover:bg-muted rounded-lg"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">يستخدم للوصول إلى بيانات المستخدمين وإدارتها</p>
                </div>
              )}

              {/* User history — counts + recent activity, helps admin
                  triage without leaving the modal. */}
              <UserHistorySection user={selectedUser} />

              {/* Metadata */}
              <div className="col-span-2">
                <Label className="text-sm">معلومات إضافية</Label>
                <div className="mt-1 space-y-1.5 text-xs text-muted-foreground">
                  <p>📅 تاريخ التسجيل: {(selectedUser.created_at ? new Date(selectedUser.created_at).toLocaleDateString("ar-EG") : "—")}</p>
                  {selectedUser.phone && <p>📱 الهاتف المسجل: {selectedUser.phone}</p>}
                  {selectedUser.city && <p>📍 المدينة: {selectedUser.city}</p>}
                </div>
              </div>

              {/* Email confirmation status — only shown if NOT confirmed.
                  Admin sees this when a user reports they can't log in;
                  one click marks them confirmed via the migration 016 RPC. */}
              {!isUserConfirmed(selectedUser) && (
                <div className="col-span-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-xl p-3">
                  <div className="flex items-start gap-2">
                    <span className="text-lg">⚠️</span>
                    <div className="flex-1">
                      <p className="text-xs font-bold text-amber-900 dark:text-amber-200 mb-1">
                        البريد غير مؤكد
                      </p>
                      <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed mb-2">
                        لم يضغط المستخدم على رابط التأكيد بعد. إذا تواصل معك وأكد هويته، يمكنك تأكيد بريده يدوياً.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          const ok = await confirm({
                            title: "تأكيد البريد يدوياً",
                            message: `تأكيد بريد ${selectedUser.email} يدوياً؟ سيتمكن المستخدم من تسجيل الدخول مباشرة بعد ذلك.`,
                            confirmLabel: "تأكيد",
                          });
                          if (ok) confirmEmailMutation.mutate(selectedUser);
                        }}
                        disabled={confirmEmailMutation.isPending}
                        className="rounded-lg text-xs"
                      >
                        {confirmEmailMutation.isPending ? "جاري التأكيد..." : "تأكيد البريد يدوياً"}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                onClick={() => setShowModal(false)}
                variant="outline"
                className="flex-1 rounded-xl"
              >
                إلغاء
              </Button>
              <Button
                onClick={() => updateUserMutation.mutate(editForm)}
                className="flex-1 bg-primary text-primary-foreground rounded-xl"
                disabled={updateUserMutation.isPending}
              >
                {updateUserMutation.isPending ? "جاري..." : "حفظ التعديلات"}
              </Button>
            </div>
          </div>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}