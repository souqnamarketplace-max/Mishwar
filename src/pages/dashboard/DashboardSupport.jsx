import React, { useState } from "react";
import Pagination from "@/components/dashboard/Pagination";
import { logAdminAction } from "@/lib/adminAudit";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Headphones, CheckCircle, Clock, AlertCircle, Trash2, MessageSquare, X, Download } from "lucide-react";
import { toast } from "sonner";

const statusConfig = {
  open: { label: "مفتوحة", color: "bg-yellow-500/10 text-yellow-600" },
  in_progress: { label: "قيد المعالجة", color: "bg-primary/10 text-primary" },
  resolved: { label: "محلولة", color: "bg-accent/10 text-accent" },
};

// CSV export helper
function exportCSV(data, filename) {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const csv = [headers.join(","), ...data.map(row => headers.map(h => `"${(row[h] || "").toString().replace(/"/g, '""')}"`).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function DashboardSupport() {
  const qc = useQueryClient();
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyNote, setReplyNote] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;
  const { data: ticketsData = { rows: [], total: 0, totalPages: 1 }, isLoading } = useQuery({
    queryKey: ["tickets", page],
    queryFn: () => base44.entities.SupportTicket.paginate({ page, pageSize: PAGE_SIZE, sort: "-created_date" }),
  });
  const tickets = ticketsData.rows;
  const totalPages = ticketsData.totalPages;

  const updateMutation = useMutation({
    mutationFn: ({ id, status, resolution_note }) => base44.entities.SupportTicket.update(id, { status, ...(resolution_note ? { description: resolution_note } : {}) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["support_tickets"] }); setReplyingTo(null); setReplyNote(""); toast.success("تم تحديث الحالة"); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.SupportTicket.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["support_tickets"] }); toast.success("تم حذف التذكرة"); },
  });

  const open = tickets.filter((t) => t.status === "open").length;
  const inProgress = tickets.filter((t) => t.status === "in_progress").length;
  const resolved = tickets.filter((t) => t.status === "resolved").length;

  return (
    <div>
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: "مفتوحة", value: open, icon: AlertCircle, color: "text-yellow-600 bg-yellow-500/10" },
          { label: "قيد المعالجة", value: inProgress, icon: Clock, color: "text-primary bg-primary/10" },
          { label: "محلولة", value: resolved, icon: CheckCircle, color: "text-accent bg-accent/10" },
        ].map((s) => (
          <div key={s.label} className="bg-card rounded-xl border border-border p-4 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${s.color}`}>
              <s.icon className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-xl font-bold">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tickets */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Headphones className="w-4 h-4 text-primary" />
            <h3 className="font-bold text-sm">تذاكر الدعم</h3>
          </div>
          <Button size="sm" variant="outline" className="rounded-lg gap-1 text-xs" onClick={() => exportCSV(tickets.map(t => ({ subject: t.subject, user: t.user_email, status: t.status, date: t.created_at })), "support-tickets.csv")}>
            <Download className="w-3.5 h-3.5" /> تصدير
          </Button>
        </div>
        {isLoading ? (
          <div className="p-10 text-center text-muted-foreground">جاري التحميل...</div>
        ) : tickets.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground">
            <Headphones className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>لا توجد تذاكر دعم حتى الآن</p>
            <p className="text-xs mt-1">ستظهر تذاكر الدعم هنا عند إنشائها</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {tickets.map((ticket) => (
              <div key={ticket.id} className="p-4 hover:bg-muted/30 flex items-start gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-medium text-sm">{ticket.subject || "شكوى"}</p>
                    <Badge className={statusConfig[ticket.status]?.color || "bg-muted"}>
                      {statusConfig[ticket.status]?.label || ticket.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mb-1">{ticket.description || "—"}</p>
                  <p className="text-xs text-muted-foreground">
                    {ticket.user_name || ticket.user_email || "—"} • {((ticket.created_at) ? new Date(ticket.created_at).toLocaleDateString("ar") : "—")}
                  </p>
                </div>
                <div className="flex gap-2 items-center shrink-0">
                  <button onClick={() => { setReplyingTo(ticket.id); setReplyNote(""); }} className="text-primary hover:opacity-70" title="إضافة ملاحظة">
                    <MessageSquare className="w-4 h-4" />
                  </button>
                  <select
                    value={ticket.status || "open"}
                    onChange={(e) => updateMutation.mutate({ id: ticket.id, status: e.target.value })}
                    className="text-xs bg-muted rounded-lg px-2 py-1 border-0 outline-none"
                  >
                    <option value="open">مفتوحة</option>
                    <option value="in_progress">قيد المعالجة</option>
                    <option value="resolved">محلولة</option>
                  </select>
                  <button onClick={() => deleteMutation.mutate(ticket.id)} className="text-destructive hover:opacity-70">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Resolution Note Modal */}
      {replyingTo && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-card rounded-2xl border border-border p-6 w-full max-w-sm" dir="rtl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold">إضافة ملاحظة / حل</h3>
              <button onClick={() => setReplyingTo(null)}><X className="w-4 h-4" /></button>
            </div>
            <textarea
              value={replyNote}
              onChange={e => setReplyNote(e.target.value)}
              placeholder="اكتب الحل أو ملاحظة للمراجعة الداخلية..."
              className="w-full h-28 px-3 py-2 rounded-xl bg-muted/50 border border-border text-sm resize-none mb-3"
            />
            <div className="flex gap-2">
              <Button className="flex-1 rounded-xl" onClick={() => updateMutation.mutate({ id: replyingTo, status: "resolved", resolution_note: replyNote })}>
                حفظ وإغلاق التذكرة
              </Button>
              <Button variant="outline" className="rounded-xl" onClick={() => updateMutation.mutate({ id: replyingTo, status: "in_progress", resolution_note: replyNote })}>
                حفظ فقط
              </Button>
            </div>
          </div>
        </div>
      )}
      {!isLoading && totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      )}
    </div>
  );
}