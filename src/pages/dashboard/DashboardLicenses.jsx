import React, { useState } from "react";
import Pagination from "@/components/dashboard/Pagination";
import { logAdminAction } from "@/lib/adminAudit";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, Clock, Search, Filter, Eye, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function DashboardLicenses() {
  const [filterStatus, setFilterStatus] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedLicense, setSelectedLicense] = useState(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const qc = useQueryClient();

  React.useEffect(() => {
    const u = base44.entities.DriverLicense.subscribe(() => qc.invalidateQueries({ queryKey: ["admin-licenses"] }));
    return () => u();
  }, []);

  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;
  const { data: licensesData = { rows: [], total: 0, totalPages: 1 }, isLoading } = useQuery({
    queryKey: ["licenses", page],
    queryFn: () => base44.entities.DriverLicense.paginate({ page, pageSize: PAGE_SIZE, sort: "-created_date" }),
  });
  const licenses = licensesData.rows;
  const totalPages = licensesData.totalPages;

  const approveMutation = useMutation({
    mutationFn: async (licenseId) => {
      const license = licenses.find((l) => l.id === licenseId);
      await base44.entities.DriverLicense.update(licenseId, {
        status: "approved",
        approved_at: new Date().toISOString(),
        approved_by: "admin",
      });
      // Notify driver
      await base44.entities.Notification.create({
        user_email: license.driver_email,
        title: "تم توثيق حسابك ✓",
        message: `تم التحقق من جميع وثائقك. يمكنك الآن نشر الرحلات بصفة سائق موثّق.`,
        type: "system",
        is_read: false,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["all-licenses"] });
      qc.invalidateQueries({ queryKey: ["all-notifications"] });
      toast.success("✓ تم توثيق السائق");
      setSelectedLicense(null);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (licenseId) => {
      const license = licenses.find((l) => l.id === licenseId);
      const reason = rejectionReason || "لم يتم توفير سبب";
      await base44.entities.DriverLicense.update(licenseId, {
        status: "rejected",
        rejection_reason: reason,
      });
      // Notify driver
      await base44.entities.Notification.create({
        user_email: license.driver_email,
        title: "لم يتم توثيق حسابك ✗",
        message: `لم يتم التحقق من وثائقك. السبب: ${reason}. يمكنك إعادة الرفع من صفحة الإعدادات.`,
        type: "system",
        is_read: false,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["all-licenses"] });
      qc.invalidateQueries({ queryKey: ["all-notifications"] });
      toast.success("✗ تم رفض التوثيق");
      setSelectedLicense(null);
      setRejectionReason("");
    },
  });

  const filteredLicenses = licenses.filter((l) => {
    const matchStatus = filterStatus === "all" || l.status === filterStatus;
    const matchSearch = l.driver_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                       l.driver_email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                       l.license_number?.includes(searchTerm);
    return matchStatus && matchSearch;
  });

  const statusConfig = {
    incomplete: { bg: "bg-blue-500/10",      text: "text-blue-700",     label: "غير مكتمل",   icon: Clock },
    pending:    { bg: "bg-yellow-500/10",    text: "text-yellow-700",   label: "قيد المراجعة", icon: Clock },
    approved:   { bg: "bg-green-500/10",     text: "text-green-700",    label: "موثّق",        icon: CheckCircle },
    rejected:   { bg: "bg-destructive/10",   text: "text-destructive",  label: "مرفوض",        icon: XCircle },
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="ابحث بالاسم أو البريد أو رقم الرخصة..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pr-10 rounded-xl"
          />
        </div>
        <div className="flex gap-2">
          {[
            { value: "all", label: "الكل" },
            { value: "incomplete", label: "غير مكتمل" },
            { value: "pending", label: "قيد المراجعة" },
            { value: "approved", label: "موثّق" },
            { value: "rejected", label: "مرفوض" },
          ].map((filter) => (
            <Button
              key={filter.value}
              variant={filterStatus === filter.value ? "default" : "outline"}
              size="sm"
              className="rounded-lg"
              onClick={() => setFilterStatus(filter.value)}
            >
              {filter.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "قيد المراجعة", count: licenses.filter((l) => l.status === "pending").length, color: "bg-yellow-500/10" },
          { label: "موثّق", count: licenses.filter((l) => l.status === "approved").length, color: "bg-green-500/10" },
          { label: "مرفوض", count: licenses.filter((l) => l.status === "rejected").length, color: "bg-destructive/10" },
        ].map((stat) => (
          <div key={stat.label} className={`${stat.color} rounded-xl p-4 text-center`}>
            <p className="text-2xl font-bold text-foreground">{stat.count}</p>
            <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-xs text-muted-foreground border-b border-border bg-muted/50">
                <th className="p-3">السائق</th>
                <th className="p-3">البريد</th>
                <th className="p-3">رقم الرخصة</th>
                <th className="p-3">انتهاء الصلاحية</th>
                <th className="p-3">الحالة</th>
                <th className="p-3">التاريخ</th>
                <th className="p-3">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan="7" className="p-6 text-center text-muted-foreground">جاري التحميل...</td></tr>
              ) : filteredLicenses.length === 0 ? (
                <tr><td colSpan="7" className="p-6 text-center text-muted-foreground">لم يتم العثور على رخص</td></tr>
              ) : (
                filteredLicenses.map((license) => {
                  const config = statusConfig[license.status];
                  const Icon = config.icon;
                  return (
                    <tr key={license.id} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="p-3 font-medium">{license.driver_name}</td>
                      <td className="p-3 text-xs text-muted-foreground">{license.driver_email}</td>
                      <td className="p-3 font-mono text-xs">{license.license_number}</td>
                      <td className="p-3">{new Date(license.expiry_date).toLocaleDateString("ar")}</td>
                      <td className="p-3">
                        <Badge className={`${config.bg} ${config.text} text-xs gap-1`}>
                          <Icon className="w-3 h-3" />
                          {config.label}
                        </Badge>
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {new Date(license.submitted_at).toLocaleDateString("ar")}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-2 rounded-lg"
                            onClick={() => setSelectedLicense(license)}
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* License Detail Modal */}
      {selectedLicense && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl border border-border max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">{selectedLicense.driver_name}</h2>

            <div className="space-y-4 mb-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">البريد</p>
                  <p className="text-sm font-medium">{selectedLicense.driver_email}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">رقم الرخصة</p>
                  <p className="text-sm font-medium">{selectedLicense.license_number}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">تاريخ الانتهاء</p>
                  <p className="text-sm font-medium">{new Date(selectedLicense.expiry_date).toLocaleDateString("ar")}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">تاريخ التقديم</p>
                  <p className="text-sm font-medium">{new Date(selectedLicense.submitted_at).toLocaleDateString("ar")}</p>
                </div>
              </div>

              {/* All 5 verification documents */}
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground font-bold flex items-center gap-2">
                  <Eye className="w-3.5 h-3.5" />
                  وثائق التحقق ({[
                    selectedLicense.license_image_url,
                    selectedLicense.car_registration_url,
                    selectedLicense.insurance_url,
                    selectedLicense.selfie_1_url,
                    selectedLicense.selfie_2_url,
                  ].filter(Boolean).length}/5)
                </p>

                {[
                  { key: "license_image_url",   label: "1️⃣ صورة رخصة القيادة",         expiry: "expiry_date" },
                  { key: "car_registration_url", label: "2️⃣ صورة تسجيل المركبة",       expiry: "car_registration_expiry_date" },
                  { key: "insurance_url",        label: "3️⃣ صورة التأمين",             expiry: "insurance_expiry_date" },
                  { key: "selfie_1_url",         label: "4️⃣ سيلفي الهوية (الوجه مع الهوية)", expiry: null },
                  { key: "selfie_2_url",         label: "5️⃣ سيلفي إضافي (الوجه الواضح)",     expiry: null },
                ].map((doc) => (
                  <div key={doc.key} className="bg-muted/30 rounded-lg border border-border overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 bg-card border-b border-border">
                      <p className="text-xs font-medium text-foreground">{doc.label}</p>
                      {doc.expiry && selectedLicense[doc.expiry] && (
                        <p className="text-[10px] text-muted-foreground">
                          ينتهي: {new Date(selectedLicense[doc.expiry]).toLocaleDateString("ar")}
                          {new Date(selectedLicense[doc.expiry]) < new Date() && (
                            <span className="text-destructive font-bold mr-1">(منتهي ⚠️)</span>
                          )}
                        </p>
                      )}
                    </div>
                    {selectedLicense[doc.key] ? (
                      <a
                        href={selectedLicense[doc.key]}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block hover:opacity-90 transition-opacity"
                        title="انقر للعرض بالحجم الكامل"
                      >
                        <img
                          loading="lazy"
                          src={selectedLicense[doc.key]}
                          alt={doc.label}
                          className="w-full max-h-56 object-contain bg-white"
                        />
                      </a>
                    ) : (
                      <div className="p-6 text-center text-xs text-muted-foreground bg-muted/20">
                        لم يتم رفع هذا المستند
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Status */}
              <div>
                <p className="text-xs text-muted-foreground mb-2">الحالة الحالية</p>
                <Badge className={`${statusConfig[selectedLicense.status].bg} ${statusConfig[selectedLicense.status].text}`}>
                  {statusConfig[selectedLicense.status].label}
                </Badge>
              </div>

              {/* Rejection Reason */}
              {selectedLicense.status === "rejected" && selectedLicense.rejection_reason && (
                <div className="p-3 bg-destructive/10 rounded-lg border border-destructive/20">
                  <p className="text-xs text-destructive font-medium">سبب الرفض:</p>
                  <p className="text-sm text-destructive mt-1">{selectedLicense.rejection_reason}</p>
                </div>
              )}
            </div>

            {/* Actions */}
            {selectedLicense.status === "pending" && (
              <div className="space-y-3">
                <Button
                  className="w-full bg-green-600 hover:bg-green-700 text-white rounded-lg"
                  onClick={() => approveMutation.mutate(selectedLicense.id)}
                  disabled={approveMutation.isPending}
                >
                  ✓ الموافقة
                </Button>
                <div className="space-y-2">
                  <textarea
                    placeholder="سبب الرفض (إن وجد)..."
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    className="w-full h-20 p-2 rounded-lg border border-input bg-background text-sm resize-none"
                  />
                  <Button
                    className="w-full bg-destructive hover:bg-destructive/90 text-white rounded-lg"
                    onClick={() => rejectMutation.mutate(selectedLicense.id)}
                    disabled={rejectMutation.isPending}
                  >
                    ✗ الرفض
                  </Button>
                </div>
              </div>
            )}

            <Button
              variant="outline"
              className="w-full rounded-lg mt-4"
              onClick={() => {
                setSelectedLicense(null);
                setRejectionReason("");
              }}
            >
              إغلاق
            </Button>
          </div>
        </div>
      )}
      {!isLoading && totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      )}
    </div>
  );
}