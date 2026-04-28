import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { FileText, Plus, Trash2, Edit2, Check, X } from "lucide-react";
import { toast } from "sonner";

const CITIES = ["رام الله", "نابلس", "الخليل", "بيت لحم", "غزة", "جنين", "طولكرم", "قلقيلية"];

export default function DashboardContent() {
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const [newAnnouncement, setNewAnnouncement] = useState("");

  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ["announcements"],
    queryFn: () => base44.entities.Announcement.list("-created_date", 50),
  });

  const createMutation = useMutation({
    mutationFn: (text) => base44.entities.Announcement.create({ text, is_active: true }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["announcements"] }); setNewAnnouncement(""); toast.success("تم نشر الإعلان"); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, text }) => base44.entities.Announcement.update(id, { text }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["announcements"] }); setEditingId(null); toast.success("تم تحديث الإعلان"); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Announcement.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["announcements"] }); toast.success("تم حذف الإعلان"); },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }) => base44.entities.Announcement.update(id, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["announcements"] }),
  });

  return (
    <div className="space-y-6">
      {/* Cities Reference */}
      <div className="bg-card rounded-xl border border-border p-4">
        <h3 className="font-bold text-sm mb-3 flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary" />
          المدن المدعومة في التطبيق
        </h3>
        <div className="flex flex-wrap gap-2">
          {CITIES.map((city) => (
            <span key={city} className="px-3 py-1.5 bg-primary/10 text-primary text-sm rounded-lg font-medium">{city}</span>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3">لتعديل المدن يرجى التواصل مع المطور.</p>
      </div>

      {/* Announcements */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary" />
          <h3 className="font-bold text-sm">إعلانات التطبيق</h3>
        </div>

        {/* Add New */}
        <div className="p-4 border-b border-border bg-muted/20">
          <div className="flex gap-2">
            <input
              value={newAnnouncement}
              onChange={(e) => setNewAnnouncement(e.target.value)}
              placeholder="اكتب إعلاناً جديداً..."
              className="flex-1 bg-muted/50 rounded-lg px-4 py-2 text-sm outline-none border border-border"
            />
            <Button
              size="sm"
              className="gap-1 rounded-lg"
              onClick={() => newAnnouncement.trim() && createMutation.mutate(newAnnouncement.trim())}
              disabled={createMutation.isPending}
            >
              <Plus className="w-4 h-4" />
              نشر
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="p-10 text-center text-muted-foreground">جاري التحميل...</div>
        ) : announcements.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground">لا توجد إعلانات بعد</div>
        ) : (
          <div className="divide-y divide-border">
            {announcements.map((a) => (
              <div key={a.id} className="p-4 flex items-start gap-3 hover:bg-muted/30">
                <div className="flex-1">
                  {editingId === a.id ? (
                    <div className="flex gap-2">
                      <input
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="flex-1 bg-muted rounded-lg px-3 py-1 text-sm outline-none"
                      />
                      <button onClick={() => updateMutation.mutate({ id: a.id, text: editText })} className="text-accent"><Check className="w-4 h-4" /></button>
                      <button onClick={() => setEditingId(null)} className="text-muted-foreground"><X className="w-4 h-4" /></button>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm">{a.text}</p>
                      <p className="text-xs text-muted-foreground mt-1">{new Date(a.created_date).toLocaleDateString("ar")}</p>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => toggleMutation.mutate({ id: a.id, is_active: !a.is_active })}
                    className={`text-xs px-2 py-1 rounded-full ${a.is_active ? "bg-accent/10 text-accent" : "bg-muted text-muted-foreground"}`}
                  >
                    {a.is_active ? "نشط" : "مخفي"}
                  </button>
                  <button onClick={() => { setEditingId(a.id); setEditText(a.text); }} className="text-primary hover:opacity-70">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button onClick={() => deleteMutation.mutate(a.id)} className="text-destructive hover:opacity-70">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}