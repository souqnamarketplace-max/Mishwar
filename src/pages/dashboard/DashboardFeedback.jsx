import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lightbulb, AlertTriangle, CheckCircle, MessageSquarePlus, ThumbsUp, Clock, Eye, Send, Filter } from "lucide-react";
import { toast } from "sonner";

const TYPE_CONFIG = {
  suggestion: { label: "اقتراح",  icon: Lightbulb,        color: "bg-yellow-100 text-yellow-700 border-yellow-200" },
  complaint:  { label: "شكوى",    icon: AlertTriangle,     color: "bg-red-100 text-red-700 border-red-200" },
  praise:     { label: "إشادة",   icon: ThumbsUp,          color: "bg-green-100 text-green-700 border-green-200" },
  other:      { label: "أخرى",    icon: MessageSquarePlus, color: "bg-blue-100 text-blue-700 border-blue-200" },
};

const STATUS_CONFIG = {
  open:        { label: "مفتوحة",       color: "bg-yellow-100 text-yellow-700" },
  in_progress: { label: "قيد المراجعة", color: "bg-blue-100 text-blue-700" },
  resolved:    { label: "تم الحل",      color: "bg-green-100 text-green-700" },
};

export default function DashboardFeedback() {
  const qc = useQueryClient();
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selected, setSelected] = useState(null);
  const [adminReply, setAdminReply] = useState("");

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ["feedback-tickets"],
    queryFn: () => base44.entities.SupportTicket.list("-created_date", 200),
  });

  // Stats
  const suggestions = tickets.filter(t => t.type === "suggestion").length;
  const complaints   = tickets.filter(t => t.type === "complaint").length;
  const praise       = tickets.filter(t => t.type === "praise").length;
  const open         = tickets.filter(t => t.status === "open").length;

  const filtered = tickets.filter(t =>
    (!typeFilter   || t.type   === typeFilter) &&
    (!statusFilter || t.status === statusFilter)
  );

  const replyMutation = useMutation({
    mutationFn: ({ id, status }) => base44.entities.SupportTicket.update(id, {
      status,
      admin_note: adminReply,
    }),
    onSuccess: () => {
      toast.success("تم الرد بنجاح");
      qc.invalidateQueries({ queryKey: ["feedback-tickets"] });
      setSelected(null); setAdminReply("");
    },
  });

  return (
    <div dir="rtl">
      <div className="mb-6">
        <h2 className="text-xl font-black">الاقتراحات والشكاوى</h2>
        <p className="text-sm text-muted-foreground">إدارة ملاحظات المستخدمين والرد عليها</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: "اقتراحات", value: suggestions, icon: Lightbulb,    color: "text-yellow-600 bg-yellow-50" },
          { label: "شكاوى",   value: complaints,  icon: AlertTriangle, color: "text-red-600 bg-red-50" },
          { label: "إشادات",  value: praise,      icon: ThumbsUp,      color: "text-green-600 bg-green-50" },
          { label: "غير مردود عليها", value: open, icon: Clock,        color: "text-blue-600 bg-blue-50" },
        ].map(s => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="bg-card border border-border rounded-2xl p-4 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${s.color}`}>
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xl font-black">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="h-9 px-3 rounded-lg bg-muted/50 border border-border text-sm">
          <option value="">كل الأنواع</option>
          {Object.entries(TYPE_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="h-9 px-3 rounded-lg bg-muted/50 border border-border text-sm">
          <option value="">كل الحالات</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <span className="text-sm text-muted-foreground self-center">{filtered.length} نتيجة</span>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">جاري التحميل...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">لا توجد ملاحظات</div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map(ticket => {
              const tc = TYPE_CONFIG[ticket.type] || TYPE_CONFIG.other;
              const sc = STATUS_CONFIG[ticket.status] || STATUS_CONFIG.open;
              const Icon = tc.icon;
              return (
                <div key={ticket.id} className="p-4 hover:bg-muted/30 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${tc.color}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-bold text-sm">{ticket.subject || tc.label}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${sc.color}`}>{sc.label}</span>
                        <span className="text-[10px] text-muted-foreground">{ticket.category}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mb-1">
                        {ticket.user_name} ({ticket.user_role}) • {new Date(ticket.created_at).toLocaleDateString("ar-SA")}
                      </p>
                      <p className="text-sm text-foreground line-clamp-2">{ticket.description}</p>
                      {ticket.admin_note && (
                        <p className="text-xs text-primary mt-1">✓ تم الرد: {ticket.admin_note.slice(0, 60)}...</p>
                      )}
                    </div>
                    <Button size="sm" variant="outline" className="shrink-0 rounded-xl gap-1"
                      onClick={() => { setSelected(ticket); setAdminReply(ticket.admin_note || ""); }}>
                      <Eye className="w-3.5 h-3.5" /> رد
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Reply Dialog */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSelected(null)} />
          <div className="relative bg-card rounded-t-3xl sm:rounded-2xl w-full sm:max-w-lg p-5 shadow-2xl" dir="rtl">
            <h3 className="font-black text-lg mb-1">{selected.subject}</h3>
            <p className="text-xs text-muted-foreground mb-3">
              {selected.user_name} • {selected.user_email} • {TYPE_CONFIG[selected.type]?.label}
            </p>
            <div className="bg-muted/50 rounded-xl p-3 mb-4 text-sm">{selected.description}</div>
            <p className="text-sm font-bold mb-2">ردك على المستخدم</p>
            <textarea value={adminReply} onChange={e => setAdminReply(e.target.value)}
              placeholder="اكتب ردك هنا..." rows={3}
              className="w-full px-4 py-3 rounded-xl bg-muted/50 border border-border text-sm focus:outline-none focus:border-primary resize-none mb-4" />
            <div className="flex gap-2">
              <Button className="flex-1 rounded-xl gap-2 bg-primary text-primary-foreground"
                onClick={() => replyMutation.mutate({ id: selected.id, status: "resolved" })}
                disabled={replyMutation.isPending}>
                <CheckCircle className="w-4 h-4" /> إغلاق وحل
              </Button>
              <Button variant="outline" className="flex-1 rounded-xl gap-2"
                onClick={() => replyMutation.mutate({ id: selected.id, status: "in_progress" })}
                disabled={replyMutation.isPending}>
                <Clock className="w-4 h-4" /> قيد المراجعة
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
