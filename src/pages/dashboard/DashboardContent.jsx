/**
 * DashboardContent — admin editor for the four content surfaces that
 * used to be hardcoded:
 *   • Announcements   (existing — banner at top of home page)
 *   • Testimonials    (new — TrustBadges.jsx carousel)
 *   • Team members    (new — AboutUs.jsx team grid)
 *   • Blog posts      (new — Blog.jsx page)
 *
 * Each tab is a self-contained CRUD pane below the tab strip. Tables
 * are populated empty by default — the homepage / about / blog pages
 * all hide their respective sections when the underlying tables are
 * empty, so launch-day default is "no fake content" (correct).
 */
import { CITIES } from "@/lib/cities";
import Pagination from "@/components/dashboard/Pagination";
import React, { useState } from "react";
import { api } from "@/api/apiClient";
import { supabase } from "@/lib/supabase";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { FileText, Plus, Trash2, Edit2, Check, X, Megaphone, MessageSquare, Users, Newspaper, MapPin, Sparkles, Globe } from "lucide-react";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { useConfirm } from "@/hooks/useConfirm";

const TABS = [
  { id: "announcements", label: "إعلانات",   icon: Megaphone },
  { id: "release-notes", label: "ما الجديد",  icon: Sparkles },
  { id: "testimonials",  label: "آراء المستخدمين", icon: MessageSquare },
  { id: "team",          label: "الفريق",      icon: Users },
  { id: "blog",          label: "المدونة",     icon: Newspaper },
  { id: "cities",        label: "المدن",       icon: MapPin },
  { id: "seo-pages",     label: "صفحات SEO",  icon: Globe },
];

export default function DashboardContent() {
  const [tab, setTab] = useState("announcements");

  return (
    <div className="space-y-4">
      {/* Tab strip */}
      <div className="bg-card rounded-xl border border-border p-1.5 flex gap-1 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-colors shrink-0 ${
                active
                  ? "bg-primary text-primary-foreground font-bold"
                  : "text-muted-foreground hover:bg-muted/50"
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "announcements" && <AnnouncementsTab />}
      {tab === "release-notes" && <ReleaseNotesTab />}
      {tab === "testimonials"  && <TestimonialsTab />}
      {tab === "team"          && <TeamTab />}
      {tab === "blog"          && <BlogTab />}
      {tab === "cities"        && <CitiesTab />}
      {tab === "seo-pages"     && <SeoPagesTab />}
    </div>
  );
}

// ============================================================================
// Announcements (existing functionality, unchanged behaviour)
// ============================================================================
function AnnouncementsTab() {
  const qc = useQueryClient();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const [newText, setNewText] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;

  const { data: annData = { rows: [], total: 0, totalPages: 1 }, isLoading } = useQuery({
    queryKey: ["announcements-admin", page],
    queryFn: async () => {
      const from = (page - 1) * PAGE_SIZE;
      const to   = from + PAGE_SIZE - 1;
      const { data, error, count } = await supabase
        .from("announcements")
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
  const rows = annData.rows;

  const create = useMutation({
    mutationFn: async (text) => {
      const { error } = await supabase.from("announcements").insert({ text, is_active: true });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["announcements-admin"] });
      qc.invalidateQueries({ queryKey: ["announcements-active"] });
      setNewText("");
      toast.success("تم نشر الإعلان");
    },
    onError: (e) => toast.error(friendlyError(e, "فشل النشر")),
  });
  const update = useMutation({
    mutationFn: async ({ id, text }) => {
      const { error } = await supabase.from("announcements").update({ text }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["announcements-admin"] });
      qc.invalidateQueries({ queryKey: ["announcements-active"] });
      setEditingId(null);
      toast.success("تم تحديث الإعلان");
    },
    onError: (e) => toast.error(friendlyError(e, "فشل التحديث")),
  });
  const del = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("announcements").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["announcements-admin"] });
      qc.invalidateQueries({ queryKey: ["announcements-active"] });
      toast.success("تم الحذف");
    },
    onError: (e) => toast.error(friendlyError(e, "فشل الحذف")),
  });
  const toggle = useMutation({
    mutationFn: async ({ id, is_active }) => {
      const { error } = await supabase.from("announcements").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["announcements-admin"] });
      qc.invalidateQueries({ queryKey: ["announcements-active"] });
    },
  });

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="p-4 border-b border-border bg-muted/20">
        <div className="flex gap-2">
          <input
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="اكتب إعلاناً جديداً..."
            className="flex-1 bg-muted/50 rounded-lg px-4 py-2 text-sm outline-none border border-border"
          />
          <Button
            size="sm"
            className="gap-1 rounded-lg"
            onClick={() => newText.trim() && create.mutate(newText.trim())}
            disabled={create.isPending}
          >
            <Plus className="w-4 h-4" />
            نشر
          </Button>
        </div>
      </div>

      {isLoading
        ? <div className="p-10 text-center text-muted-foreground">جاري التحميل...</div>
        : rows.length === 0
        ? <div className="p-10 text-center text-muted-foreground">لا توجد إعلانات بعد</div>
        : <div className="divide-y divide-border">
            {rows.map((a) => (
              <div key={a.id} className="p-4 flex items-start gap-3 hover:bg-muted/30">
                <div className="flex-1">
                  {editingId === a.id ? (
                    <div className="flex gap-2">
                      <input
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="flex-1 bg-muted rounded-lg px-3 py-1 text-sm outline-none"
                      />
                      <button onClick={() => update.mutate({ id: a.id, text: editText })} className="text-accent"><Check className="w-4 h-4" /></button>
                      <button onClick={() => setEditingId(null)} className="text-muted-foreground"><X className="w-4 h-4" /></button>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm">{a.text}</p>
                      <p className="text-xs text-muted-foreground mt-1">{a.created_at ? new Date(a.created_at).toLocaleDateString("ar-EG") : "—"}</p>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => toggle.mutate({ id: a.id, is_active: !a.is_active })}
                    className={`text-xs px-2 py-1 rounded-full ${a.is_active ? "bg-accent/10 text-accent" : "bg-muted text-muted-foreground"}`}
                  >
                    {a.is_active ? "نشط" : "مخفي"}
                  </button>
                  <button onClick={() => { setEditingId(a.id); setEditText(a.text); }} className="text-primary hover:opacity-70">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button onClick={async () => { if (await confirm({ title: "حذف الإعلان", message: "هل أنت متأكد من حذف هذا الإعلان؟", confirmLabel: "حذف", destructive: true })) del.mutate(a.id); }} className="text-destructive hover:opacity-70" aria-label="حذف الإعلان">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
      }
      {!isLoading && annData.totalPages > 1 && (
        <div className="p-4 border-t border-border">
          <Pagination page={page} totalPages={annData.totalPages} onChange={setPage} />
        </div>
      )}
      {confirmDialog}
    </div>
  );
}

// ============================================================================
// Testimonials
// ============================================================================
const EMPTY_TESTIMONIAL = {
  display_name: "", city: "", role: "passenger",
  avatar_letter: "", text: "", rating: 5, route: "",
  is_published: false, sort_order: 0,
};

function TestimonialsTab() {
  const qc = useQueryClient();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [editing, setEditing] = useState(null); // null = no editor; {} = new; {id, ...} = existing
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;
  const { data: rowsData = { rows: [], total: 0, totalPages: 1 }, isLoading } = useQuery({
    queryKey: ["testimonials-admin", page],
    queryFn: async () => {
      const from = (page - 1) * PAGE_SIZE;
      const to   = from + PAGE_SIZE - 1;
      const { data, error, count } = await supabase
        .from("testimonials")
        .select("*", { count: "exact" })
        .order("sort_order", { ascending: true })
        .range(from, to);
      if (error) throw error;
      return {
        rows:       data || [],
        total:      count || 0,
        totalPages: Math.max(1, Math.ceil((count || 0) / PAGE_SIZE)),
      };
    },
  });
  const rows = rowsData.rows;
  const totalPages = rowsData.totalPages;

  const save = useMutation({
    mutationFn: async (form) => {
      if (form.id) {
        const { id, ...patch } = form;
        const { error } = await supabase.from("testimonials").update(patch).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("testimonials").insert(form);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["testimonials-admin"] });
      qc.invalidateQueries({ queryKey: ["testimonials-published"] });
      setEditing(null);
      toast.success("تم الحفظ");
    },
    onError: (e) => toast.error(friendlyError(e, "فشل الحفظ")),
  });
  const del = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("testimonials").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["testimonials-admin"] });
      qc.invalidateQueries({ queryKey: ["testimonials-published"] });
      toast.success("تم الحذف");
    },
    onError: (e) => toast.error(friendlyError(e, "فشل الحذف")),
  });

  return (
    <div className="space-y-3">
      <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 text-xs text-amber-900 dark:text-amber-200">
        ⚠️ أضف فقط آراءً حقيقية من مستخدمين موافقين. الآراء المختلقة تنتهك سياسات App Store / Play Store
        وقوانين حماية المستهلك.
      </div>

      <div className="flex justify-end">
        <Button size="sm" className="gap-1 rounded-lg" onClick={() => setEditing({ ...EMPTY_TESTIMONIAL })}>
          <Plus className="w-4 h-4" /> رأي جديد
        </Button>
      </div>

      {editing && <TestimonialEditor value={editing} onChange={setEditing} onSave={() => save.mutate(editing)} onCancel={() => setEditing(null)} saving={save.isPending} />}

      {isLoading
        ? <div className="bg-card rounded-xl border border-border p-10 text-center text-muted-foreground">جاري التحميل...</div>
        : rows.length === 0
        ? <div className="bg-card rounded-xl border border-border p-10 text-center text-muted-foreground">لا توجد آراء بعد. أضف أول رأي حقيقي ⬆️</div>
        : <div className="bg-card rounded-xl border border-border divide-y divide-border">
            {rows.map((r) => (
              <div key={r.id} className="p-4 flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-black text-primary text-sm shrink-0">
                  {r.avatar_letter || (r.display_name?.[0] || "?")}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-sm">{r.display_name}</p>
                    {r.city && <span className="text-xs text-muted-foreground">• {r.city}</span>}
                    {r.role && <span className="text-xs text-muted-foreground">• {r.role === "driver" ? "سائق" : r.role === "passenger" ? "راكب" : "كلاهما"}</span>}
                    <span className="text-xs text-yellow-600">{"⭐".repeat(r.rating || 0)}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{r.text}</p>
                  {r.route && <p className="text-xs text-muted-foreground mt-1">🚗 {r.route}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className={`text-xs px-2 py-1 rounded-full ${r.is_published ? "bg-accent/10 text-accent" : "bg-muted text-muted-foreground"}`}>
                    {r.is_published ? "منشور" : "مسودة"}
                  </span>
                  <button onClick={() => setEditing({ ...r })} className="text-primary hover:opacity-70 p-1"><Edit2 className="w-4 h-4" /></button>
                  <button onClick={async () => { if (await confirm({ title: "حذف الرأي", message: "هل أنت متأكد من حذف هذا الرأي؟", confirmLabel: "حذف", destructive: true })) del.mutate(r.id); }} className="text-destructive hover:opacity-70 p-1" aria-label="حذف الرأي"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
      }

      {!isLoading && totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      )}
      {confirmDialog}
    </div>
  );
}

function TestimonialEditor({ value, onChange, onSave, onCancel, saving }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  return (
    <div className="bg-card rounded-xl border-2 border-primary/40 p-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">الاسم المعروض *</label>
          <input value={value.display_name || ""} onChange={(e) => set("display_name", e.target.value)}
            placeholder="مثال: سارة ع."
            className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">المدينة</label>
          <input value={value.city || ""} onChange={(e) => set("city", e.target.value)}
            placeholder="مثال: رام الله"
            className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">الدور</label>
          <select value={value.role || "passenger"} onChange={(e) => set("role", e.target.value)}
            className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none">
            <option value="passenger">راكب</option>
            <option value="driver">سائق</option>
            <option value="both">كلاهما</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">الحرف الأول (للأفاتار)</label>
          <input value={value.avatar_letter || ""} onChange={(e) => set("avatar_letter", e.target.value.slice(0, 2))}
            placeholder="س"
            className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">المسار</label>
          <input value={value.route || ""} onChange={(e) => set("route", e.target.value)}
            placeholder="مثال: رام الله ← نابلس"
            className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">التقييم (1-5)</label>
          <input type="number" min={1} max={5} value={value.rating || 5} onChange={(e) => set("rating", parseInt(e.target.value) || 5)}
            className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">ترتيب العرض</label>
          <input type="number" value={value.sort_order || 0} onChange={(e) => set("sort_order", parseInt(e.target.value) || 0)}
            className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none" />
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">نص الرأي *</label>
        <textarea value={value.text || ""} onChange={(e) => set("text", e.target.value)}
          rows={3} maxLength={600}
          placeholder="ما رأيه/ها في مشوارو..."
          className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none" />
        <p className="text-[11px] text-muted-foreground mt-1">{(value.text || "").length}/600 — يجب أن يكون رأياً حقيقياً وموافقاً عليه من المستخدم</p>
      </div>
      <div className="flex items-center justify-between gap-3 pt-2 border-t border-border">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!value.is_published} onChange={(e) => set("is_published", e.target.checked)} />
          منشور (يظهر على الصفحة الرئيسية)
        </label>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>إلغاء</Button>
          <Button size="sm" onClick={onSave} disabled={saving || !(value.display_name && value.text)}>حفظ</Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Team
// ============================================================================
const EMPTY_MEMBER = { full_name: "", role_title: "", emoji: "👤", avatar_url: "", bio: "", is_published: true, sort_order: 0 };

function TeamTab() {
  const qc = useQueryClient();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [editing, setEditing] = useState(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;
  const { data: rowsData = { rows: [], total: 0, totalPages: 1 }, isLoading } = useQuery({
    queryKey: ["team-admin", page],
    queryFn: async () => {
      const from = (page - 1) * PAGE_SIZE;
      const to   = from + PAGE_SIZE - 1;
      const { data, error, count } = await supabase
        .from("team_members")
        .select("*", { count: "exact" })
        .order("sort_order", { ascending: true })
        .range(from, to);
      if (error) throw error;
      return {
        rows:       data || [],
        total:      count || 0,
        totalPages: Math.max(1, Math.ceil((count || 0) / PAGE_SIZE)),
      };
    },
  });
  const rows = rowsData.rows;
  const totalPages = rowsData.totalPages;

  const save = useMutation({
    mutationFn: async (form) => {
      if (form.id) {
        const { id, ...patch } = form;
        const { error } = await supabase.from("team_members").update(patch).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("team_members").insert(form);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-admin"] });
      qc.invalidateQueries({ queryKey: ["team-members-published"] });
      setEditing(null);
      toast.success("تم الحفظ");
    },
    onError: (e) => toast.error(friendlyError(e, "فشل الحفظ")),
  });
  const del = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("team_members").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-admin"] });
      qc.invalidateQueries({ queryKey: ["team-members-published"] });
      toast.success("تم الحذف");
    },
    onError: (e) => toast.error(friendlyError(e, "فشل الحذف")),
  });

  return (
    <div className="space-y-3">
      <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 text-xs text-amber-900 dark:text-amber-200">
        ⚠️ أضف فقط أعضاء حقيقيين في الفريق. أصبحت قائمة الفريق المختلقة سبباً معتاداً لرفض التطبيقات على متاجر التطبيقات.
      </div>

      <div className="flex justify-end">
        <Button size="sm" className="gap-1 rounded-lg" onClick={() => setEditing({ ...EMPTY_MEMBER })}>
          <Plus className="w-4 h-4" /> عضو جديد
        </Button>
      </div>

      {editing && <TeamMemberEditor value={editing} onChange={setEditing} onSave={() => save.mutate(editing)} onCancel={() => setEditing(null)} saving={save.isPending} />}

      {isLoading
        ? <div className="bg-card rounded-xl border border-border p-10 text-center text-muted-foreground">جاري التحميل...</div>
        : rows.length === 0
        ? <div className="bg-card rounded-xl border border-border p-10 text-center text-muted-foreground">لا يوجد أعضاء في الفريق بعد</div>
        : <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {rows.map((m) => (
              <div key={m.id} className="bg-card rounded-xl border border-border p-4 flex items-start gap-3">
                {m.avatar_url
                  ? <img loading="lazy" src={m.avatar_url} alt="" className="w-12 h-12 rounded-full object-cover shrink-0" />
                  : <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-2xl shrink-0">{m.emoji || "👤"}</div>}
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm">{m.full_name}</p>
                  {m.role_title && <p className="text-xs text-muted-foreground">{m.role_title}</p>}
                  <span className={`inline-block mt-1.5 text-xs px-2 py-0.5 rounded-full ${m.is_published ? "bg-accent/10 text-accent" : "bg-muted text-muted-foreground"}`}>
                    {m.is_published ? "ظاهر" : "مخفي"}
                  </span>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <button onClick={() => setEditing({ ...m })} className="text-primary hover:opacity-70 p-1"><Edit2 className="w-4 h-4" /></button>
                  <button onClick={async () => { if (await confirm({ title: "حذف العضو", message: "هل أنت متأكد من حذف هذا العضو من الفريق؟", confirmLabel: "حذف", destructive: true })) del.mutate(m.id); }} className="text-destructive hover:opacity-70 p-1" aria-label="حذف العضو"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
      }

      {!isLoading && totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      )}
      {confirmDialog}
    </div>
  );
}

function TeamMemberEditor({ value, onChange, onSave, onCancel, saving }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  return (
    <div className="bg-card rounded-xl border-2 border-primary/40 p-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">الاسم الكامل *</label>
          <input value={value.full_name || ""} onChange={(e) => set("full_name", e.target.value)}
            className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">المنصب</label>
          <input value={value.role_title || ""} onChange={(e) => set("role_title", e.target.value)}
            placeholder="مثال: المؤسس"
            className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">الإيموجي (إذا لا توجد صورة)</label>
          <input value={value.emoji || ""} onChange={(e) => set("emoji", e.target.value)}
            placeholder="👤"
            className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">رابط الصورة الشخصية (اختياري)</label>
          <input value={value.avatar_url || ""} onChange={(e) => set("avatar_url", e.target.value)}
            placeholder="https://..."
            className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none" dir="ltr" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">ترتيب العرض</label>
          <input type="number" value={value.sort_order || 0} onChange={(e) => set("sort_order", parseInt(e.target.value) || 0)}
            className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none" />
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">نبذة (اختياري)</label>
        <textarea value={value.bio || ""} onChange={(e) => set("bio", e.target.value)}
          rows={2} maxLength={500}
          className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none" />
      </div>
      <div className="flex items-center justify-between gap-3 pt-2 border-t border-border">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!value.is_published} onChange={(e) => set("is_published", e.target.checked)} />
          ظاهر في الموقع
        </label>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>إلغاء</Button>
          <Button size="sm" onClick={onSave} disabled={saving || !value.full_name}>حفظ</Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Blog
// ============================================================================
function nowISO() { return new Date().toISOString(); }
function toSlug(title) {
  const base = (title || "").trim().toLowerCase()
    .replace(/\s+/g, "-").replace(/[^a-z0-9\u0600-\u06FF-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  return (base || "post") + "-" + Date.now();
}
const EMPTY_POST = {
  title: "", slug: "", excerpt: "", body: "", emoji: "📝",
  category: "", cover_url: "", author_name: "",
  published_at: null, is_published: false,
};

function BlogTab() {
  const qc = useQueryClient();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [editing, setEditing] = useState(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;
  const { data: rowsData = { rows: [], total: 0, totalPages: 1 }, isLoading } = useQuery({
    queryKey: ["blog-admin", page],
    queryFn: async () => {
      const from = (page - 1) * PAGE_SIZE;
      const to   = from + PAGE_SIZE - 1;
      const { data, error, count } = await supabase
        .from("blog_posts")
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
  const rows = rowsData.rows;
  const totalPages = rowsData.totalPages;

  const save = useMutation({
    mutationFn: async (form) => {
      // If publishing for the first time and no published_at set, stamp it
      const out = { ...form };
      if (out.is_published && !out.published_at) out.published_at = nowISO();
      // slug UNIQUE constraint — empty string collides across multiple posts.
      // Auto-generate from title when blank so every post gets a unique slug.
      if (!out.slug || out.slug.trim() === "") out.slug = toSlug(out.title);
      if (out.id) {
        const { id, ...patch } = out;
        const { error } = await supabase.from("blog_posts").update(patch).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("blog_posts").insert(out);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["blog-admin"] });
      qc.invalidateQueries({ queryKey: ["blog-posts-published"] });
      setEditing(null);
      toast.success("تم الحفظ");
    },
    onError: (e) => toast.error(friendlyError(e, "فشل الحفظ")),
  });
  const del = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("blog_posts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["blog-admin"] });
      qc.invalidateQueries({ queryKey: ["blog-posts-published"] });
      toast.success("تم الحذف");
    },
    onError: (e) => toast.error(friendlyError(e, "فشل الحذف")),
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" className="gap-1 rounded-lg" onClick={() => setEditing({ ...EMPTY_POST })}>
          <Plus className="w-4 h-4" /> مقال جديد
        </Button>
      </div>

      {editing && <BlogPostEditor value={editing} onChange={setEditing} onSave={() => save.mutate(editing)} onCancel={() => setEditing(null)} saving={save.isPending} />}

      {isLoading
        ? <div className="bg-card rounded-xl border border-border p-10 text-center text-muted-foreground">جاري التحميل...</div>
        : rows.length === 0
        ? <div className="bg-card rounded-xl border border-border p-10 text-center text-muted-foreground">لا توجد مقالات بعد</div>
        : <div className="bg-card rounded-xl border border-border divide-y divide-border">
            {rows.map((p) => (
              <div key={p.id} className="p-4 flex items-start gap-3">
                <div className="text-3xl shrink-0">{p.emoji || "📝"}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-sm">{p.title}</p>
                    {p.category && <span className="text-xs bg-primary/10 text-primary rounded-full px-2 py-0.5">{p.category}</span>}
                  </div>
                  {p.excerpt && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{p.excerpt}</p>}
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1.5">
                    {p.author_name && <span>✍️ {p.author_name}</span>}
                    {p.published_at && <span>📅 {new Date(p.published_at).toLocaleDateString("ar-EG")}</span>}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={`text-xs px-2 py-1 rounded-full ${p.is_published ? "bg-accent/10 text-accent" : "bg-muted text-muted-foreground"}`}>
                    {p.is_published ? "منشور" : "مسودة"}
                  </span>
                  <div className="flex gap-1">
                    <button onClick={() => setEditing({ ...p })} className="text-primary hover:opacity-70 p-1"><Edit2 className="w-4 h-4" /></button>
                    <button onClick={async () => { if (await confirm({ title: "حذف المقال", message: "هل أنت متأكد من حذف هذا المقال؟ لا يمكن التراجع.", confirmLabel: "حذف", destructive: true })) del.mutate(p.id); }} className="text-destructive hover:opacity-70 p-1" aria-label="حذف المقال"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
      }

      {!isLoading && totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      )}
      {confirmDialog}
    </div>
  );
}

function BlogPostEditor({ value, onChange, onSave, onCancel, saving }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  return (
    <div className="bg-card rounded-xl border-2 border-primary/40 p-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="text-xs text-muted-foreground mb-1 block">العنوان *</label>
          <input value={value.title || ""} onChange={(e) => set("title", e.target.value)}
            className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">المعرف (slug — اختياري)</label>
          <input value={value.slug || ""} onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
            placeholder="auto-generated"
            className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none" dir="ltr" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">التصنيف</label>
          <input value={value.category || ""} onChange={(e) => set("category", e.target.value)}
            placeholder="مثال: نصائح"
            className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">الإيموجي</label>
          <input value={value.emoji || ""} onChange={(e) => set("emoji", e.target.value)}
            placeholder="📝"
            className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">اسم الكاتب</label>
          <input value={value.author_name || ""} onChange={(e) => set("author_name", e.target.value)}
            className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none" />
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs text-muted-foreground mb-1 block">رابط صورة الغلاف (اختياري)</label>
          <input value={value.cover_url || ""} onChange={(e) => set("cover_url", e.target.value)}
            placeholder="https://..."
            className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none" dir="ltr" />
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs text-muted-foreground mb-1 block">المقتطف (يظهر في القائمة)</label>
          <textarea value={value.excerpt || ""} onChange={(e) => set("excerpt", e.target.value)}
            rows={2} maxLength={500}
            className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none" />
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs text-muted-foreground mb-1 block">المحتوى الكامل (Markdown)</label>
          <textarea value={value.body || ""} onChange={(e) => set("body", e.target.value)}
            rows={10} maxLength={50000}
            placeholder="# عنوان&#10;&#10;محتوى المقال..."
            className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none font-mono" />
          <p className="text-[11px] text-muted-foreground mt-1">{(value.body || "").length}/50,000 حرف</p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 pt-2 border-t border-border">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!value.is_published} onChange={(e) => set("is_published", e.target.checked)} />
          منشور
        </label>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>إلغاء</Button>
          <Button size="sm" onClick={onSave} disabled={saving || !value.title}>حفظ</Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Cities reference (read-only)
// ============================================================================
function CitiesTab() {
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center gap-2 mb-3">
        <FileText className="w-4 h-4 text-primary" />
        <h3 className="font-bold text-sm">المدن المدعومة في التطبيق</h3>
      </div>
      <div className="flex flex-wrap gap-2">
        {CITIES.map((city) => (
          <span key={city} className="px-3 py-1.5 bg-primary/10 text-primary text-sm rounded-lg font-medium">{city}</span>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-3">
        إجمالي: {CITIES.length} مدينة وقرية. لتعديل القائمة يرجى التواصل مع المطور
        (مرتبطة بإحداثيات الخريطة).
      </p>
    </div>
  );
}

// ============================================================================
// Release notes ("ما الجديد") — admin-authored changelog entries
// ============================================================================
//
// Replaces the SQL-only workflow that mig 083 originally shipped with.
// Admins can now post entries via this UI without ever opening the
// Supabase SQL editor. Same table (public.release_notes), same RLS
// (admin-all policy gates writes), same audience/icon allowlists.
//
// EDITOR FIELDS:
//   title       — required, 1-200 chars (enforced by CHECK constraint)
//   body        — required, 1-5000 chars (enforced by CHECK constraint)
//   audience    — select: all / drivers / passengers / admins
//   icon        — select from the same allowlist WhatsNew.jsx renders
//                 (any name outside the allowlist falls back to Sparkles
//                  on the public page, so the admin can technically type
//                  anything — but the select limits typos)
//   is_pinned   — checkbox; pinned entries sort to the top of /whats-new
//   published_at — defaults to NOW() on insert. Editing this column
//                  via the UI is intentionally NOT supported; if an
//                  admin needs to schedule a future-published note,
//                  they fall back to SQL (rare case).

// ICON ALLOWLIST — must match the ICONS map in src/pages/WhatsNew.jsx
const RELEASE_ICONS = [
  "Sparkles", "Repeat", "Heart", "Bell", "Car", "MessageCircle",
  "UserCheck", "MapPin", "Calendar", "Clock", "Star", "Settings",
  "ShieldCheck", "Zap", "Gift", "TrendingUp", "Award", "AlertCircle",
  "CheckCircle", "Plus", "Search",
];

const AUDIENCE_LABELS = {
  all:        "الجميع",
  drivers:    "السائقون فقط",
  passengers: "الركاب فقط",
  admins:     "المسؤولون فقط (إعلان داخلي)",
};

const EMPTY_RELEASE_NOTE = {
  title: "",
  body: "",
  audience: "all",
  icon: "Sparkles",
  is_pinned: false,
};

function ReleaseNotesTab() {
  const qc = useQueryClient();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [editing, setEditing] = useState(null); // null = no editor; {} = new; {id, ...} = existing
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;

  const { data: rowsData = { rows: [], total: 0, totalPages: 1 }, isLoading } = useQuery({
    queryKey: ["release-notes-admin", page],
    queryFn: async () => {
      const from = (page - 1) * PAGE_SIZE;
      const to   = from + PAGE_SIZE - 1;
      // Admin sees ALL audiences (including 'admins'-only entries) —
      // the admin RLS policy allows full access. The .neq filter that
      // hides 'admins' entries from regular users doesn't apply here.
      const { data, error, count } = await supabase
        .from("release_notes")
        .select("id, title, body, audience, icon, is_pinned, published_at, created_by, created_at", { count: "exact" })
        .order("is_pinned", { ascending: false })
        .order("published_at", { ascending: false })
        .range(from, to);
      if (error) throw error;
      return {
        rows:       data || [],
        total:      count || 0,
        totalPages: Math.max(1, Math.ceil((count || 0) / PAGE_SIZE)),
      };
    },
  });
  const rows = rowsData.rows;
  const totalPages = rowsData.totalPages;

  // Get current admin email from auth — used as created_by on INSERT.
  // We don't trust the client to supply this; the RLS admin policy
  // requires auth.uid() to match an admin profile, so even if a
  // tampered client tried to set a different created_by, the row
  // would still be authored by the actual logged-in admin from the
  // RLS perspective. The created_by column is just a denormalized
  // audit trail.
  const { data: adminEmail } = useQuery({
    queryKey: ["current-admin-email"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user?.email || "";
    },
  });

  const save = useMutation({
    mutationFn: async (form) => {
      if (form.id) {
        const { id, created_by, created_at, ...patch } = form;
        const { error } = await supabase.from("release_notes").update(patch).eq("id", id);
        if (error) throw error;
      } else {
        // For new entries, include created_by (required NOT NULL column).
        // published_at omitted → defaults to NOW() per the table default.
        const { error } = await supabase.from("release_notes").insert({
          ...form,
          created_by: adminEmail || "admin",
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["release-notes-admin"] });
      // Invalidate the public-facing query so any open /whats-new tab
      // also picks up the new entry on next focus.
      qc.invalidateQueries({ queryKey: ["release-notes"] });
      qc.invalidateQueries({ queryKey: ["unread-release-notes-count"] });
      setEditing(null);
      toast.success("تم الحفظ — سيرى المستخدمون الإعلان فوراً");
    },
    onError: (e) => toast.error(friendlyError(e, "فشل الحفظ")),
  });

  const del = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("release_notes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["release-notes-admin"] });
      qc.invalidateQueries({ queryKey: ["release-notes"] });
      qc.invalidateQueries({ queryKey: ["unread-release-notes-count"] });
      toast.success("تم الحذف");
    },
    onError: (e) => toast.error(friendlyError(e, "فشل الحذف")),
  });

  return (
    <div className="space-y-3">
      <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 text-xs text-foreground/80">
        ✨ كل إعلان تنشره هنا يظهر فوراً في صفحة <span className="font-bold">ما الجديد</span> للمستخدمين،
        ويُضاف عداد أحمر على أيقونة النجمة في الشريط العلوي. اختر الجمهور المناسب لكل إعلان
        (الجميع، السائقون فقط، الركاب فقط).
      </div>

      <div className="flex justify-end">
        <Button size="sm" className="gap-1 rounded-lg" onClick={() => setEditing({ ...EMPTY_RELEASE_NOTE })}>
          <Plus className="w-4 h-4" /> إعلان جديد
        </Button>
      </div>

      {editing && (
        <ReleaseNoteEditor
          value={editing}
          onChange={setEditing}
          onSave={() => save.mutate(editing)}
          onCancel={() => setEditing(null)}
          saving={save.isPending}
        />
      )}

      {isLoading ? (
        <div className="bg-card rounded-xl border border-border p-10 text-center text-muted-foreground">
          جاري التحميل...
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-10 text-center text-muted-foreground">
          لا توجد إعلانات بعد. اضغط "إعلان جديد" لإضافة أول إعلان ⬆️
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border divide-y divide-border">
          {rows.map((r) => (
            <div key={r.id} className="p-4 flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-bold text-sm">{r.title}</p>
                  {r.is_pinned && (
                    <span className="text-[10px] bg-amber-500/10 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded-full font-medium">
                      مثبَّت
                    </span>
                  )}
                  <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">
                    {AUDIENCE_LABELS[r.audience] || r.audience}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{r.body}</p>
                <p className="text-[11px] text-muted-foreground/70 mt-1">
                  {new Date(r.published_at).toLocaleDateString("ar-EG", { day: "numeric", month: "long", year: "numeric" })}
                  {r.created_by && ` · ${r.created_by}`}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setEditing({ ...r })}
                  className="text-primary hover:opacity-70 p-1"
                  aria-label="تعديل"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={async () => {
                    if (await confirm({
                      title: "حذف الإعلان",
                      message: "سيختفي الإعلان من صفحة 'ما الجديد' لجميع المستخدمين. هل تريد المتابعة؟",
                      confirmLabel: "حذف",
                      destructive: true,
                    })) del.mutate(r.id);
                  }}
                  className="text-destructive hover:opacity-70 p-1"
                  aria-label="حذف"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      )}
      {confirmDialog}
    </div>
  );
}

function ReleaseNoteEditor({ value, onChange, onSave, onCancel, saving }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  // Validation matches the CHECK constraints in mig 083:
  //   title  1-200 chars (required)
  //   body   1-5000 chars (required)
  const titleLen = (value.title || "").length;
  const bodyLen  = (value.body  || "").length;
  const titleValid = titleLen > 0 && titleLen <= 200;
  const bodyValid  = bodyLen  > 0 && bodyLen  <= 5000;
  const canSave    = titleValid && bodyValid;

  return (
    <div className="bg-card rounded-xl border-2 border-primary/40 p-4 space-y-3">
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">العنوان *</label>
        <input
          value={value.title || ""}
          onChange={(e) => set("title", e.target.value)}
          placeholder="مثال: الرحلات المتكررة 🔁"
          maxLength={200}
          className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none"
        />
        <p className={`text-[11px] mt-1 ${titleLen > 200 ? "text-destructive" : "text-muted-foreground"}`}>
          {titleLen}/200
        </p>
      </div>

      <div>
        <label className="text-xs text-muted-foreground mb-1 block">نص الإعلان *</label>
        <textarea
          value={value.body || ""}
          onChange={(e) => set("body", e.target.value)}
          rows={5}
          maxLength={5000}
          placeholder="اشرح الميزة الجديدة بوضوح. اذكر أين يجدها المستخدم وكيف يستخدمها."
          className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none"
        />
        <p className={`text-[11px] mt-1 ${bodyLen > 5000 ? "text-destructive" : "text-muted-foreground"}`}>
          {bodyLen}/5000
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">الجمهور</label>
          <select
            value={value.audience || "all"}
            onChange={(e) => set("audience", e.target.value)}
            className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none"
          >
            {Object.entries(AUDIENCE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">الأيقونة</label>
          <select
            value={value.icon || "Sparkles"}
            onChange={(e) => set("icon", e.target.value)}
            className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none"
          >
            {RELEASE_ICONS.map((icon) => (
              <option key={icon} value={icon}>{icon}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 pt-2 border-t border-border">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!!value.is_pinned}
            onChange={(e) => set("is_pinned", e.target.checked)}
          />
          تثبيت في الأعلى (للإعلانات المهمة فقط)
        </label>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>إلغاء</Button>
          <Button size="sm" onClick={onSave} disabled={saving || !canSave}>
            {value.id ? "حفظ التغييرات" : "نشر الإعلان"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// SEO Pages CMS — manage /cities/* and /routes/* content from the dashboard
// without code deploys. Backed by the seo_pages table (migration 099).
// ============================================================================

const EMPTY_SEO_PAGE = {
  slug: "",
  page_type: "city",
  title: "",
  subtitle: "",
  intro: "",
  sections: [],          // [{ heading, body }]
  faq: [],               // [{ q, a }]
  related_links: [],     // [{ label, path }]
  breadcrumbs: [],       // [{ name, path }]
  keywords: [],
  meta_description: "",
  search_link: "",
  is_published: true,
};

function SeoPagesTab() {
  const qc = useQueryClient();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [editing, setEditing] = useState(null);
  const [filter, setFilter]   = useState("all");

  const { data: pages = [], isLoading } = useQuery({
    queryKey: ["seo-pages-admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("seo_pages")
        .select("*")
        .order("page_type", { ascending: true })
        .order("slug",      { ascending: true });
      if (error) throw error;
      return data || [];
    },
    staleTime: 30 * 1000,
  });

  const save = useMutation({
    mutationFn: async (form) => {
      const out = { ...form };
      // Trim and validate slug
      out.slug = (out.slug || "").trim().toLowerCase();
      if (!out.slug) throw new Error("المعرّف (slug) مطلوب");
      if (!/^[a-z0-9-]+$/.test(out.slug)) throw new Error("المعرّف يحتوي على رموز غير مسموحة (أحرف لاتينية صغيرة وأرقام و- فقط)");
      if (out.id) {
        const { id, created_at, updated_at, ...patch } = out;
        const { error } = await supabase.from("seo_pages").update(patch).eq("id", id);
        if (error) throw error;
      } else {
        const { id, created_at, updated_at, ...insert } = out;
        const { error } = await supabase.from("seo_pages").insert(insert);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["seo-pages-admin"] });
      qc.invalidateQueries({ queryKey: ["seo-page"] }); // invalidate the public-facing cache too
      toast.success("تم الحفظ");
      setEditing(null);
    },
    onError: (err) => toast.error(friendlyError(err, "فشل الحفظ")),
  });

  const remove = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("seo_pages").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["seo-pages-admin"] });
      qc.invalidateQueries({ queryKey: ["seo-page"] });
      toast.success("تم الحذف");
    },
    onError: (err) => toast.error(friendlyError(err, "فشل الحذف")),
  });

  const visible = filter === "all" ? pages : pages.filter(p => p.page_type === filter);

  return (
    <div className="space-y-3">
      {confirmDialog}

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1 bg-card border border-border rounded-lg p-1">
          {[["all","الكل"],["city","المدن"],["route","المسارات"],["other","أخرى"]].map(([k,l]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-3 py-1.5 rounded-md text-xs transition-colors ${
                filter === k ? "bg-primary text-primary-foreground font-bold" : "text-muted-foreground hover:bg-muted/50"
              }`}
            >{l}</button>
          ))}
        </div>
        <Button size="sm" className="gap-1 rounded-lg" onClick={() => setEditing({ ...EMPTY_SEO_PAGE })}>
          <Plus className="w-4 h-4" />
          صفحة جديدة
        </Button>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-xs text-yellow-900">
        ⚠️ تغييراتك هنا تنعكس فورياً على الصفحات الحية على mishwaro.com. هذه الصفحات مفهرسة في Google — تجنب الحذف العشوائي.
      </div>

      {editing && (
        <SeoPageEditor
          value={editing}
          onChange={setEditing}
          onSave={() => save.mutate(editing)}
          onCancel={() => setEditing(null)}
          saving={save.isPending}
        />
      )}

      {isLoading && <p className="text-sm text-muted-foreground p-4">جاري التحميل...</p>}

      <div className="grid gap-2">
        {visible.map((p) => (
          <div key={p.id} className="bg-card border border-border rounded-xl p-3 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                  p.page_type === "city" ? "bg-blue-100 text-blue-800" :
                  p.page_type === "route" ? "bg-green-100 text-green-800" :
                  "bg-gray-100 text-gray-800"
                }`}>{p.page_type}</span>
                <span className="font-bold text-sm">{p.title}</span>
                {!p.is_published && <span className="text-[10px] bg-red-100 text-red-800 px-1.5 py-0.5 rounded">غير منشور</span>}
              </div>
              <a
                href={p.page_type === "city" ? `/cities/${p.slug}` : p.page_type === "route" ? `/routes/${p.slug}` : `/${p.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline truncate block"
              >
                /{p.page_type === "city" ? "cities" : p.page_type === "route" ? "routes" : ""}/{p.slug}
              </a>
              <p className="text-[11px] text-muted-foreground mt-1">
                {p.faq?.length || 0} سؤال · {p.sections?.length || 0} قسم · آخر تعديل: {p.updated_at ? new Date(p.updated_at).toLocaleDateString("ar-EG") : "—"}
              </p>
            </div>
            <div className="flex gap-1 shrink-0">
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setEditing(p)} title="تعديل">
                <Edit2 className="w-4 h-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 text-red-600 hover:text-red-700"
                onClick={async () => {
                  if (await confirm({ title: "حذف هذه الصفحة؟", description: `سيتم حذف "${p.title}" نهائياً. الرابط /${p.page_type === "city" ? "cities" : "routes"}/${p.slug} سيظهر 404. متأكد؟`, confirmText: "حذف", danger: true })) {
                    remove.mutate(p.id);
                  }
                }}
                title="حذف"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}
        {!isLoading && visible.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-8">لا توجد صفحات بعد</p>
        )}
      </div>
    </div>
  );
}

function SeoPageEditor({ value, onChange, onSave, onCancel, saving }) {
  const set = (key, val) => onChange({ ...value, [key]: val });

  // Helpers for editing nested arrays (sections, faq, related, breadcrumbs)
  const updateArrayItem = (arrKey, idx, patch) => {
    const arr = [...(value[arrKey] || [])];
    arr[idx] = { ...arr[idx], ...patch };
    set(arrKey, arr);
  };
  const addArrayItem = (arrKey, template) => {
    set(arrKey, [...(value[arrKey] || []), template]);
  };
  const removeArrayItem = (arrKey, idx) => {
    const arr = [...(value[arrKey] || [])];
    arr.splice(idx, 1);
    set(arrKey, arr);
  };

  return (
    <div className="bg-card border-2 border-primary/30 rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold">{value.id ? "تعديل صفحة SEO" : "صفحة SEO جديدة"}</h3>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onCancel}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">المعرّف (slug) *</label>
          <input
            value={value.slug || ""}
            onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
            placeholder="مثال: ramallah أو ramallah-nablus"
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            disabled={!!value.id}
          />
          {value.id && <p className="text-[10px] text-muted-foreground mt-1">لا يمكن تعديل المعرّف بعد الحفظ</p>}
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">نوع الصفحة *</label>
          <select
            value={value.page_type}
            onChange={(e) => set("page_type", e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          >
            <option value="city">مدينة (/cities/...)</option>
            <option value="route">مسار (/routes/...)</option>
            <option value="other">أخرى</option>
          </select>
        </div>
      </div>

      <div>
        <label className="text-xs text-muted-foreground mb-1 block">العنوان (H1) *</label>
        <input value={value.title || ""} onChange={(e) => set("title", e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" dir="rtl" />
      </div>

      <div>
        <label className="text-xs text-muted-foreground mb-1 block">العنوان الفرعي</label>
        <textarea value={value.subtitle || ""} onChange={(e) => set("subtitle", e.target.value)} rows={2} className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" dir="rtl" />
      </div>

      <div>
        <label className="text-xs text-muted-foreground mb-1 block">المقدمة (٢-٣ فقرات، افصلها بسطر فارغ)</label>
        <textarea value={value.intro || ""} onChange={(e) => set("intro", e.target.value)} rows={6} className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" dir="rtl" />
      </div>

      <div>
        <label className="text-xs text-muted-foreground mb-1 block">وصف Meta لمحركات البحث (١٥٠-١٦٠ حرف مثالي)</label>
        <textarea value={value.meta_description || ""} onChange={(e) => set("meta_description", e.target.value)} rows={2} className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" dir="rtl" maxLength={300} />
        <p className="text-[10px] text-muted-foreground mt-0.5">{(value.meta_description || "").length} / 160</p>
      </div>

      <div>
        <label className="text-xs text-muted-foreground mb-1 block">رابط البحث (اختياري)</label>
        <input value={value.search_link || ""} onChange={(e) => set("search_link", e.target.value)} placeholder="/search?from=رام الله" className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
      </div>

      <div>
        <label className="text-xs text-muted-foreground mb-1 block">كلمات مفتاحية (افصل بفاصلة)</label>
        <input
          value={(value.keywords || []).join("، ")}
          onChange={(e) => set("keywords", e.target.value.split(/[,،]/).map(s => s.trim()).filter(Boolean))}
          placeholder="رحلات رام الله، مشاوير رام الله، carpool Ramallah"
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          dir="rtl"
        />
      </div>

      {/* Sections editor */}
      <fieldset className="border border-border rounded-lg p-3">
        <legend className="text-xs font-bold px-2">الأقسام ({(value.sections || []).length})</legend>
        <div className="space-y-2">
          {(value.sections || []).map((s, i) => (
            <div key={i} className="bg-muted/30 rounded-lg p-2 space-y-1.5">
              <div className="flex gap-1">
                <input
                  value={s.heading || ""}
                  onChange={(e) => updateArrayItem("sections", i, { heading: e.target.value })}
                  placeholder="عنوان القسم (H2)"
                  className="flex-1 px-2 py-1.5 rounded border border-border bg-background text-sm"
                  dir="rtl"
                />
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-600" onClick={() => removeArrayItem("sections", i)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
              <textarea
                value={s.body || ""}
                onChange={(e) => updateArrayItem("sections", i, { body: e.target.value })}
                placeholder="محتوى القسم (افصل الفقرات بسطر فارغ)"
                rows={4}
                className="w-full px-2 py-1.5 rounded border border-border bg-background text-sm"
                dir="rtl"
              />
            </div>
          ))}
          <Button size="sm" variant="outline" className="w-full gap-1 rounded-lg" onClick={() => addArrayItem("sections", { heading: "", body: "" })}>
            <Plus className="w-3.5 h-3.5" /> إضافة قسم
          </Button>
        </div>
      </fieldset>

      {/* FAQ editor */}
      <fieldset className="border border-border rounded-lg p-3">
        <legend className="text-xs font-bold px-2">الأسئلة الشائعة ({(value.faq || []).length})</legend>
        <div className="space-y-2">
          {(value.faq || []).map((f, i) => (
            <div key={i} className="bg-muted/30 rounded-lg p-2 space-y-1.5">
              <div className="flex gap-1">
                <input
                  value={f.q || ""}
                  onChange={(e) => updateArrayItem("faq", i, { q: e.target.value })}
                  placeholder="السؤال"
                  className="flex-1 px-2 py-1.5 rounded border border-border bg-background text-sm"
                  dir="rtl"
                />
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-600" onClick={() => removeArrayItem("faq", i)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
              <textarea
                value={f.a || ""}
                onChange={(e) => updateArrayItem("faq", i, { a: e.target.value })}
                placeholder="الجواب"
                rows={2}
                className="w-full px-2 py-1.5 rounded border border-border bg-background text-sm"
                dir="rtl"
              />
            </div>
          ))}
          <Button size="sm" variant="outline" className="w-full gap-1 rounded-lg" onClick={() => addArrayItem("faq", { q: "", a: "" })}>
            <Plus className="w-3.5 h-3.5" /> إضافة سؤال
          </Button>
        </div>
      </fieldset>

      {/* Related links */}
      <fieldset className="border border-border rounded-lg p-3">
        <legend className="text-xs font-bold px-2">روابط ذات صلة ({(value.related_links || []).length})</legend>
        <div className="space-y-2">
          {(value.related_links || []).map((r, i) => (
            <div key={i} className="flex gap-1">
              <input
                value={r.label || ""}
                onChange={(e) => updateArrayItem("related_links", i, { label: e.target.value })}
                placeholder="نص الرابط"
                className="flex-1 px-2 py-1.5 rounded border border-border bg-background text-sm"
                dir="rtl"
              />
              <input
                value={r.path || ""}
                onChange={(e) => updateArrayItem("related_links", i, { path: e.target.value })}
                placeholder="/cities/..."
                className="flex-1 px-2 py-1.5 rounded border border-border bg-background text-sm"
              />
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-600" onClick={() => removeArrayItem("related_links", i)}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
          <Button size="sm" variant="outline" className="w-full gap-1 rounded-lg" onClick={() => addArrayItem("related_links", { label: "", path: "" })}>
            <Plus className="w-3.5 h-3.5" /> إضافة رابط
          </Button>
        </div>
      </fieldset>

      {/* Breadcrumbs */}
      <fieldset className="border border-border rounded-lg p-3">
        <legend className="text-xs font-bold px-2">مسار التنقل (Breadcrumbs)</legend>
        <div className="space-y-2">
          {(value.breadcrumbs || []).map((b, i) => (
            <div key={i} className="flex gap-1">
              <input
                value={b.name || ""}
                onChange={(e) => updateArrayItem("breadcrumbs", i, { name: e.target.value })}
                placeholder="الاسم"
                className="flex-1 px-2 py-1.5 rounded border border-border bg-background text-sm"
                dir="rtl"
              />
              <input
                value={b.path || ""}
                onChange={(e) => updateArrayItem("breadcrumbs", i, { path: e.target.value })}
                placeholder="/cities/..."
                className="flex-1 px-2 py-1.5 rounded border border-border bg-background text-sm"
              />
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-600" onClick={() => removeArrayItem("breadcrumbs", i)}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
          <Button size="sm" variant="outline" className="w-full gap-1 rounded-lg" onClick={() => addArrayItem("breadcrumbs", { name: "", path: "" })}>
            <Plus className="w-3.5 h-3.5" /> إضافة عنصر
          </Button>
        </div>
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={!!value.is_published} onChange={(e) => set("is_published", e.target.checked)} />
        <span>منشور (مرئي على الموقع)</span>
      </label>

      <div className="flex justify-end gap-2 pt-2 border-t border-border">
        <Button variant="outline" onClick={onCancel} disabled={saving}>إلغاء</Button>
        <Button onClick={onSave} disabled={saving} className="gap-1">
          <Check className="w-4 h-4" />
          {saving ? "جاري الحفظ..." : "حفظ"}
        </Button>
      </div>
    </div>
  );
}
