import React, { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  // Curated icon set for release notes — these are the names admin
  // can use in the release_notes.icon column. Adding a new icon
  // requires one import line here. We avoid `import * as LucideIcons`
  // because Vite cannot tree-shake star-imports — the resulting
  // bundle ballooned to 759KB (every lucide icon, ~700 of them).
  // Explicit imports keep WhatsNew chunk under 50KB while still
  // letting admin pick from a sensible variety.
  Sparkles, Pin, Loader2,
  Repeat, Heart, Bell, Car, MessageCircle, UserCheck, MapPin,
  Calendar, Clock, Star, Settings, ShieldCheck, Zap, Gift,
  TrendingUp, Award, AlertCircle, CheckCircle, Plus, Search,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthContext";
import { useSEO } from "@/hooks/useSEO";
import EmptyState from "@/components/shared/EmptyState";

// String → component lookup. Admins reference these by name in the
// release_notes.icon column. Unknown names fall back to Sparkles.
const ICONS = {
  Sparkles, Repeat, Heart, Bell, Car, MessageCircle, UserCheck,
  MapPin, Calendar, Clock, Star, Settings, ShieldCheck, Zap,
  Gift, TrendingUp, Award, AlertCircle, CheckCircle, Plus, Search,
};

/**
 * /whats-new — public changelog page.
 *
 * Lists release_notes entries (mig 083) targeted at the current user's
 * audience. Marks all visible entries as read on mount so the navbar
 * badge clears immediately when the user visits.
 *
 * Audience filtering:
 *   - 'all'        → everyone sees
 *   - 'drivers'    → only role='driver' or trip-creators see
 *   - 'passengers' → only non-drivers see
 *   - 'admins'     → admin role only (NOT shown on this public page;
 *                    RLS already hides them)
 *
 * Frontend filtering is in addition to the RLS gate — we use role
 * info from useAuth() to refine, since RLS can't easily tell
 * 'is this user a driver?' from auth.uid() alone (would require a
 * profiles join in policy USING clauses, which is doable but adds
 * load on every read).
 *
 * Icons: each release note has an optional `icon` field (lucide name
 * string, e.g. 'Repeat', 'Heart', 'Sparkles'). We resolve the
 * component dynamically from lucide-react's named exports. Unknown
 * names fall back to Sparkles.
 */
export default function WhatsNew() {
  useSEO({
    title: "ما الجديد",
    description: "آخر الميزات والتحديثات في مشوارو",
  });
  const { user } = useAuth();
  const qc = useQueryClient();

  // Determine user audience for filtering
  const isAdmin   = user?.role === "admin";
  const isDriver  = user?.role === "driver" || isAdmin;
  const audiences = isAdmin
    ? ["all", "admins", "drivers", "passengers"]  // admins see everything
    : isDriver
      ? ["all", "drivers"]
      : ["all", "passengers"];

  const { data: notes = [], isLoading } = useQuery({
    queryKey: ["release-notes", audiences.join(",")],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("release_notes")
        .select("id, title, body, audience, icon, is_pinned, published_at")
        .in("audience", audiences)
        .lte("published_at", new Date().toISOString())
        .order("is_pinned", { ascending: false })
        .order("published_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Per-user read status for badge management
  const { data: readSet = new Set() } = useQuery({
    queryKey: ["release-note-reads", user?.email],
    queryFn: async () => {
      if (!user?.email) return new Set();
      const { data, error } = await supabase
        .from("release_note_reads")
        .select("release_note_id");
      if (error) throw error;
      return new Set((data || []).map(r => r.release_note_id));
    },
    enabled: !!user?.email,
  });

  // Mark-all-read mutation — fires on visit. Each note ID gets one
  // INSERT (idempotent via ON CONFLICT DO NOTHING in the RPC).
  // Done one-at-a-time to keep the RPC contract simple; with typical
  // <20 unread entries, the round-trip burst is fine.
  const markRead = useMutation({
    mutationFn: async (ids) => {
      await Promise.all(
        ids.map(id => supabase.rpc("mark_release_note_read", { p_note_id: id }))
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["release-note-reads"] });
      qc.invalidateQueries({ queryKey: ["unread-release-notes-count"] });
    },
  });

  // On mount, mark all currently-visible notes as read. Slight delay
  // (300ms) so the user has a chance to SEE the unread indicator
  // before it disappears — feels more responsive.
  useEffect(() => {
    if (notes.length === 0 || !user?.email) return;
    const unread = notes.filter(n => !readSet.has(n.id)).map(n => n.id);
    if (unread.length === 0) return;
    const t = setTimeout(() => markRead.mutate(unread), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes.length, readSet.size, user?.email]);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Sparkles className="w-6 h-6 text-primary" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">ما الجديد</h1>
          <p className="text-sm text-muted-foreground">آخر الميزات والتحديثات في مشوارو</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
        </div>
      ) : notes.length === 0 ? (
        <EmptyState
          icon={<Sparkles className="w-12 h-12" />}
          title="لا توجد تحديثات بعد"
          description="ستظهر الميزات الجديدة هنا فور إصدارها"
        />
      ) : (
        <div className="space-y-4">
          {notes.map((note) => {
            const Icon = (note.icon && ICONS[note.icon]) || Sparkles;
            const isUnread = !readSet.has(note.id);
            return (
              <div
                key={note.id}
                className={`bg-card rounded-2xl border p-5 transition-colors ${
                  isUnread ? "border-primary/30 bg-primary/5" : "border-border"
                }`}
              >
                <div className="flex items-start gap-3 mb-2">
                  <div className="shrink-0 w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Icon className="w-5 h-5 text-primary" aria-hidden="true" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-foreground">{note.title}</h3>
                      {note.is_pinned && (
                        <span className="inline-flex items-center gap-1 text-[10px] bg-amber-500/10 text-amber-700 px-1.5 py-0.5 rounded-full">
                          <Pin className="w-3 h-3" aria-hidden="true" />
                          مثبَّت
                        </span>
                      )}
                      {isUnread && (
                        <span className="text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full font-medium">
                          جديد
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(note.published_at).toLocaleDateString("ar-EG", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                </div>
                <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap mt-3">
                  {note.body}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
