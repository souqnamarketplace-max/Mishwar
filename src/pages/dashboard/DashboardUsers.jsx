import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, Search, Shield, UserCheck, Mail, Trash2, Edit2, Car, Lock, Unlock, Copy, Eye, EyeOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function DashboardUsers() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all"); // all, driver, passenger, admin
  const [selectedUser, setSelectedUser] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [showAccessKey, setShowAccessKey] = useState(false);
  const qc = useQueryClient();

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: () => base44.entities.User.list("-created_date", 100),
  });

  const { data: userTrips = {} } = useQuery({
    queryKey: ["user-trips"],
    queryFn: async () => {
      const allTrips = await base44.entities.Trip.list("-created_date", 200);
      const tripsByUser = {};
      users.forEach(u => {
        tripsByUser[u.email] = allTrips.filter(t => t.created_by === u.email).length;
      });
      return tripsByUser;
    },
    enabled: users.length > 0,
  });

  const { data: userBookings = {} } = useQuery({
    queryKey: ["user-bookings"],
    queryFn: async () => {
      const allBookings = await base44.entities.Booking.list("-created_date", 200);
      const bookingsByUser = {};
      users.forEach(u => {
        bookingsByUser[u.email] = allBookings.filter(b => b.passenger_email === u.email).length;
      });
      return bookingsByUser;
    },
    enabled: users.length > 0,
  });

  const updateUserMutation = useMutation({
    mutationFn: (data) => base44.functions.invoke('updateUserAdmin', {
      userId: data.id,
      data: {
        full_name: data.full_name,
        phone: data.phone,
        role: data.role,
        is_active: data.is_active,
      }
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.success("تم تحديث بيانات المستخدم");
      setShowModal(false);
    },
    onError: (error) => {
      toast.error(error.message || "حدث خطأ في التحديث");
    }
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (user) => base44.functions.invoke('updateUserAdmin', {
      userId: user.id,
      data: { is_active: !user.is_active }
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.success("تم تحديث حالة المستخدم");
    },
    onError: (error) => {
      toast.error(error.message || "فشل التحديث");
    }
  });

  const filtered = users.filter((u) => {
    const matchSearch = !search || 
      u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
      u.email?.toLowerCase().includes(search.toLowerCase());
    
    const matchFilter = filter === "all" || 
      (filter === "admin" && u.role === "admin") ||
      (filter === "driver" && (u.account_type === "driver" || u.account_type === "both")) ||
      (filter === "passenger" && (u.account_type === "passenger" || u.account_type === "both"));
    
    return matchSearch && matchFilter;
  });

  const stats = [
    { label: "إجمالي المستخدمين", value: users.length, icon: Users, color: "text-primary" },
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
              placeholder="ابحث بالاسم أو الإيميل..."
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
                            <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            user.full_name?.[0] || "؟"
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium truncate">{user.full_name || "—"}</p>
                          <p className="text-xs text-muted-foreground truncate">{user.email}</p>
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
                      {new Date(user.created_date).toLocaleDateString("ar")}
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

              {/* Metadata */}
              <div className="col-span-2">
                <Label className="text-sm">معلومات إضافية</Label>
                <div className="mt-1 space-y-1.5 text-xs text-muted-foreground">
                  <p>📅 تاريخ التسجيل: {new Date(selectedUser.created_date).toLocaleDateString("ar")}</p>
                  {selectedUser.phone && <p>📱 الهاتف المسجل: {selectedUser.phone}</p>}
                  {selectedUser.city && <p>📍 المدينة: {selectedUser.city}</p>}
                </div>
              </div>
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
    </div>
  );
}