import React, { useState } from "react";
import Pagination from "@/components/dashboard/Pagination";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tag, Plus, Trash2, Copy } from "lucide-react";
import { toast } from "sonner";

export default function DashboardOffers() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: "", discount_percent: 10, max_uses: 100, expires_at: "" });

  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;
  const { data: couponsData = { rows: [], total: 0, totalPages: 1 }, isLoading } = useQuery({
    queryKey: ["coupons", page],
    queryFn: () => base44.entities.Coupon.paginate({ page, pageSize: PAGE_SIZE, sort: "-created_date" }),
  });
  const coupons = couponsData.rows;
  const totalPages = couponsData.totalPages;

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Coupon.create({ ...data, is_active: true, uses_count: 0 }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coupons"] });
      setShowForm(false);
      setForm({ code: "", discount_percent: 10, max_uses: 100, expires_at: "" });
      toast.success("تم إنشاء الكوبون");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Coupon.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["coupons"] }); toast.success("تم حذف الكوبون"); },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }) => base44.entities.Coupon.update(id, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coupons"] }),
  });

  const generateCode = () => {
    const code = "SAYARTNA-" + Math.random().toString(36).substring(2, 7).toUpperCase();
    setForm((f) => ({ ...f, code }));
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Tag className="w-4 h-4 text-primary" />
          <span className="text-sm text-muted-foreground">{coupons.length} كوبون</span>
        </div>
        <Button size="sm" className="gap-1 rounded-lg" onClick={() => setShowForm(!showForm)}>
          <Plus className="w-4 h-4" />
          إنشاء كوبون
        </Button>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="bg-card rounded-xl border border-border p-4 mb-4 space-y-3">
          <h3 className="font-bold text-sm">كوبون جديد</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">كود الكوبون</label>
              <div className="flex gap-2">
                <input
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                  placeholder="SAVE10"
                  className="flex-1 bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none"
                />
                <button onClick={generateCode} className="text-xs bg-muted px-2 rounded-lg hover:bg-muted/80">توليد</button>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">نسبة الخصم (%)</label>
              <input
                type="number" min="1" max="100"
                value={form.discount_percent}
                onChange={(e) => setForm((f) => ({ ...f, discount_percent: parseInt(e.target.value) }))}
                className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">الحد الأقصى للاستخدام</label>
              <input
                type="number"
                value={form.max_uses}
                onChange={(e) => setForm((f) => ({ ...f, max_uses: parseInt(e.target.value) }))}
                className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">تاريخ الانتهاء</label>
              <input
                type="date"
                value={form.expires_at}
                onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value }))}
                className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" className="rounded-lg" onClick={() => setShowForm(false)}>إلغاء</Button>
            <Button size="sm" className="rounded-lg" onClick={() => createMutation.mutate(form)} disabled={!form.code || createMutation.isPending}>
              إنشاء
            </Button>
          </div>
        </div>
      )}

      {/* Coupons List */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {isLoading ? (
          <div className="p-10 text-center text-muted-foreground">جاري التحميل...</div>
        ) : coupons.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground">
            <Tag className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>لا توجد كوبونات بعد</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {coupons.map((coupon) => (
              <div key={coupon.id} className="p-4 flex items-center gap-4 hover:bg-muted/30">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Tag className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <code className="font-bold text-sm bg-muted px-2 py-0.5 rounded">{coupon.code}</code>
                    <button onClick={() = aria-label="نسخ"> { navigator.clipboard.writeText(coupon.code); toast("تم نسخ الكود"); }}>
                      <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    خصم {coupon.discount_percent}% • استُخدم {coupon.uses_count || 0}/{coupon.max_uses} مرة
                    {coupon.expires_at && ` • ينتهي ${new Date(coupon.expires_at).toLocaleDateString("ar")}`}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => toggleMutation.mutate({ id: coupon.id, is_active: !coupon.is_active })}
                    className={`text-xs px-2 py-1 rounded-full ${coupon.is_active ? "bg-accent/10 text-accent" : "bg-muted text-muted-foreground"}`}
                  >
                    {coupon.is_active ? "نشط" : "معطل"}
                  </button>
                  <button onClick={() => deleteMutation.mutate(coupon.id)} className="text-destructive hover:opacity-70">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {!isLoading && totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      )}
    </div>
  );
}