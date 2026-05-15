import React, { useState } from "react";
import { useSEO } from "@/hooks/useSEO";
import { useAuth } from "@/lib/AuthContext";
import { api } from "@/api/apiClient";
import { notifyAdmin } from "@/lib/notifyAdmin";
import { logAudit } from "@/lib/adminAudit";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { MessageSquarePlus, Lightbulb, AlertTriangle, CheckCircle, Clock, ChevronDown, ChevronUp, Send } from "lucide-react";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";

const TYPES = [
  { id: "suggestion", label: "اقتراح", icon: Lightbulb, color: "text-yellow-600 bg-yellow-50 border-yellow-200" },
  { id: "complaint",  label: "شكوى",   icon: AlertTriangle, color: "text-red-600 bg-red-50 border-red-200" },
  { id: "praise",     label: "إشادة",  icon: CheckCircle, color: "text-green-600 bg-green-50 border-green-200" },
  { id: "other",      label: "أخرى",   icon: MessageSquarePlus, color: "text-blue-600 bg-blue-50 border-blue-200" },
];

const CATEGORIES = [
  "تجربة المستخدم", "السائق", "الراكب", "الدفع", "الأمان",
  "التطبيق والتقنية", "الرحلة", "خدمة العملاء", "أخرى",
];

const STATUS_CONFIG = {
  open:        { label: "مفتوحة",        color: "bg-yellow-100 text-yellow-700" },
  in_progress: { label: "قيد المراجعة",  color: "bg-blue-100 text-blue-700" },
  resolved:    { label: "تم الحل",        color: "bg-green-100 text-green-700" },
};

export default function Feedback() {
  useSEO({ title: "الاقتراحات والشكاوى", description: "شاركنا رأيك لتحسين مشوارو" });
  const { user } = useAuth();
  const qc = useQueryClient();

  const [type, setType] = useState("suggestion");
  const [category, setCategory] = useState("أخرى");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [expanded, setExpanded] = useState(null);

  const { data: myTickets = [] } = useQuery({
    queryKey: ["my-tickets", user?.email],
    queryFn: () => api.entities.SupportTicket.filter({ user_email: user.email }, "-created_date", 20),
    enabled: !!user?.email,
  });

  const submit = useMutation({
    mutationFn: async () => {
      const ticket = await api.entities.SupportTicket.create({
        user_email: user?.email || "anonymous",
        user_name:  user?.full_name || "مستخدم",
        user_role:  user?.account_type || "passenger",
        subject:    subject || TYPES.find(t => t.id === type)?.label,
        description: message,
        type,
        category,
        status: "open",
        priority: type === "complaint" ? "high" : "normal",
      });
      return ticket;
    },
    onSuccess: (ticket) => {
      toast.success("تم إرسال ملاحظتك بنجاح! سنرد عليك قريباً 🙏");
      setSubject(""); setMessage(""); setType("suggestion"); setCategory("أخرى");
      qc.invalidateQueries({ queryKey: ["my-tickets", user?.email] });
      // Notify admin so it shows up in the dashboard bell. Truly
      // fire-and-forget now — moved out of the mutationFn await
      // chain. Previously it was awaited there, so if the admin
      // notification insert failed (RLS edge case, network blip),
      // the WHOLE mutation rejected — the user saw 'تعذر إرسال
      // الملاحظة' even though their ticket was already created.
      // Now: ticket creation is authoritative success; admin ping
      // is best-effort decoration.
      const typeLabel = TYPES.find(t => t.id === type)?.label || type;
      const titleEmoji = type === "complaint" ? "⚠️" : type === "praise" ? "💚" : "💡";
      notifyAdmin({
        title: `${titleEmoji} ${typeLabel} جديد${type === "complaint" ? "ة" : ""} من ${user?.full_name || "مستخدم"}`,
        message: (subject || message).slice(0, 200),
        link: "/dashboard?tab=feedback",
      }).catch(() => { /* non-fatal — ticket is already saved */ });
      // Audit log — feedback / complaint / praise submissions are
      // a key signal admins need to track for support workload
      // planning. Captures the type (complaint vs suggestion vs
      // praise) so admins can answer 'how many complaints did we
      // get this month' without scanning ticket subject lines.
      logAudit("feedback_submitted", "feedback", ticket?.id || null, {
        user_email: user?.email,
        ticket_type: type,
        category,
      });
    },
    onError: (err) => toast.error(friendlyError(err, "تعذر إرسال الملاحظة — حاول مجدداً")),
  });

  return (
    <div className="max-w-2xl mx-auto px-4 py-6" dir="rtl">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
          <MessageSquarePlus className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-2xl font-black text-foreground">اقتراحات وشكاوى</h1>
        <p className="text-muted-foreground text-sm mt-1">رأيك يهمنا — ساعدنا في تحسين مشوارو</p>
      </div>

      {/* Form */}
      <div className="bg-card border border-border rounded-2xl p-5 mb-6 shadow-sm">
        {/* Type selector */}
        <p className="text-sm font-bold mb-3">نوع الملاحظة</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
          {TYPES.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.id} onClick={() => setType(t.id)}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs font-bold transition-all ${
                  type === t.id ? t.color + " shadow-sm" : "border-border bg-muted/30 text-muted-foreground hover:bg-muted"
                }`}>
                <Icon className="w-5 h-5" />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Category */}
        <p className="text-sm font-bold mb-2">الفئة</p>
        <div className="flex flex-wrap gap-2 mb-5">
          {CATEGORIES.map(c => (
            <button key={c} onClick={() => setCategory(c)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
                category === c ? "bg-primary/10 border-primary text-primary" : "border-border bg-muted/30 text-muted-foreground hover:bg-muted"
              }`}>
              {c}
            </button>
          ))}
        </div>

        {/* Subject */}
        <p className="text-sm font-bold mb-2">الموضوع</p>
        <input value={subject} onChange={e => setSubject(e.target.value)}
          placeholder="عنوان مختصر لملاحظتك..."
          maxLength={200}
          className="w-full h-11 px-4 rounded-xl bg-muted/50 border border-border text-sm focus:outline-none focus:border-primary mb-4" />

        {/* Message */}
        <p className="text-sm font-bold mb-2">التفاصيل</p>
        <textarea value={message} onChange={e => setMessage(e.target.value)}
          placeholder="اكتب ملاحظتك بالتفصيل..."
          rows={4}
          maxLength={2000}
          className="w-full px-4 py-3 rounded-xl bg-muted/50 border border-border text-sm focus:outline-none focus:border-primary resize-none mb-1" />
        {/* Live counter — appears once over 80% of cap, red at 95%+.
            Without a length limit, users could paste essays into the
            DB. 2000 chars is plenty for a support ticket description. */}
        {message.length > 1600 && (
          <p className={`text-[10px] mb-3 text-left ${message.length > 1900 ? "text-destructive" : "text-muted-foreground"}`}>
            {message.length} / 2000
          </p>
        )}
        {message.length <= 1600 && <div className="mb-3" />}

        <Button onClick={() => submit.mutate()} disabled={!message.trim() || submit.isPending}
          className="w-full h-11 rounded-xl font-bold gap-2 bg-primary text-primary-foreground">
          <Send className="w-4 h-4" />
          {submit.isPending ? "جاري الإرسال..." : "إرسال الملاحظة"}
        </Button>
      </div>

      {/* My previous tickets */}
      {myTickets.length > 0 && (
        <div>
          <h2 className="font-bold text-base mb-3">ملاحظاتي السابقة ({myTickets.length})</h2>
          <div className="space-y-3">
            {myTickets.map(ticket => {
              const typeInfo = TYPES.find(t => t.id === ticket.type) || TYPES[3];
              const Icon = typeInfo.icon;
              const statusInfo = STATUS_CONFIG[ticket.status] || STATUS_CONFIG.open;
              const isOpen = expanded === ticket.id;
              return (
                <div key={ticket.id} className="bg-card border border-border rounded-2xl overflow-hidden">
                  <button className="w-full flex items-center gap-3 p-4 text-right"
                    onClick={() => setExpanded(isOpen ? null : ticket.id)}>
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${typeInfo.color.split(' ').slice(1).join(' ')}`}>
                      <Icon className={`w-4 h-4 ${typeInfo.color.split(' ')[0]}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm text-foreground truncate">{ticket.subject || typeInfo.label}</p>
                      <p className="text-xs text-muted-foreground">{ticket.category} • {new Date(ticket.created_at).toLocaleDateString("ar-EG")}</p>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-1 rounded-full shrink-0 ${statusInfo.color}`}>{statusInfo.label}</span>
                    {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 border-t border-border pt-3">
                      <p className="text-sm text-foreground whitespace-pre-wrap">{ticket.description}</p>
                      {ticket.admin_note && (
                        <div className="mt-3 p-3 bg-primary/5 border border-primary/20 rounded-xl">
                          <p className="text-xs font-bold text-primary mb-1">رد الإدارة:</p>
                          <p className="text-sm text-foreground">{ticket.admin_note}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
