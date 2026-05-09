import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { useSEO } from "@/hooks/useSEO";
import { supabase } from "@/lib/supabase";
import { base44 } from "@/api/base44Client";
import { friendlyError } from "@/lib/errors";
import { toast } from "sonner";
import { Plus, Inbox, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import RequestCard from "@/components/requests/RequestCard";

/**
 * MyRequests — passenger-facing list of their own trip requests.
 *
 * Tabs:
 *   - "نشطة" (open): can edit/cancel
 *   - "مغلقة" (matched/cancelled/expired): read-only history
 *
 * Each card surfaces analytics (view count + contact count) so the
 * passenger sees the engagement on their post — encourages tweaking
 * (lower price? change time?) if a request gets few views.
 */
export default function MyRequests() {
  useSEO({
    title: "طلباتي",
    description: "إدارة طلبات الرحلات التي نشرتها",
    canonical: "https://mishwar-nu.vercel.app/my-requests",
  });

  const { user, isAuthenticated, isLoadingAuth } = useAuth();
  const qc       = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState("open");

  if (!isLoadingAuth && !isAuthenticated) {
    navigate("/login?returnTo=/my-requests", { replace: true });
    return null;
  }

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["my-trip-requests", user?.email],
    queryFn: () => base44.entities.TripRequest.filter(
      { passenger_email: user.email }, "-created_at", 100
    ),
    enabled: !!user?.email,
    staleTime: 30_000,
  });

  const cancelMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.rpc("cancel_trip_request", { p_request_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-trip-requests"] });
      qc.invalidateQueries({ queryKey: ["my-active-request-count"] });
      toast.success("تم إلغاء الطلب");
    },
    onError: (err) => toast.error(friendlyError(err, "تعذر الإلغاء")),
  });

  const open    = requests.filter(r => r.status === "open");
  const closed  = requests.filter(r => r.status !== "open");
  const visible = tab === "open" ? open : closed;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-28" dir="rtl">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="w-4 h-4 rotate-180" />
        رجوع للرئيسية
      </Link>

      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-foreground">طلباتي</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {open.length === 0 ? "لا توجد طلبات نشطة" : `${open.length} من 3 طلبات نشطة`}
          </p>
        </div>
        {open.length < 3 && (
          <Link to="/request-trip">
            <Button className="rounded-xl gap-1">
              <Plus className="w-4 h-4" />
              طلب جديد
            </Button>
          </Link>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-5 border-b border-border">
        {[
          { id: "open",   label: `نشطة (${open.length})` },
          { id: "closed", label: `مغلقة (${closed.length})` },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <div className="space-y-3">
          {visible.map(r => (
            <RequestCard
              key={r.id}
              request={r}
              mode="owner"
              action={r.status === "open" ? (
                <div className="flex items-center justify-end gap-3 pt-3 mt-3 border-t border-border/60">
                  <button
                    onClick={() => {
                      if (window.confirm("إلغاء هذا الطلب؟")) cancelMutation.mutate(r.id);
                    }}
                    disabled={cancelMutation.isPending}
                    className="text-xs text-destructive hover:underline"
                  >
                    إلغاء الطلب
                  </button>
                </div>
              ) : null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ tab }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-8 text-center" dir="rtl">
      <div className="w-14 h-14 mx-auto bg-muted/40 rounded-2xl flex items-center justify-center mb-3">
        <Inbox className="w-7 h-7 text-muted-foreground" />
      </div>
      <h3 className="font-bold text-foreground mb-2">
        {tab === "open" ? "لا توجد طلبات نشطة" : "لا يوجد سجل طلبات سابقة"}
      </h3>
      {tab === "open" && (
        <>
          <p className="text-sm text-muted-foreground leading-relaxed mb-5 max-w-sm mx-auto">
            انشر طلب رحلة وسيتواصل معك السائقون المتجهون لوجهتك.
            خدمة مجانية للراكب.
          </p>
          <Link to="/request-trip">
            <Button className="rounded-xl gap-1">
              <Plus className="w-4 h-4" />
              اطلب رحلة الآن
            </Button>
          </Link>
        </>
      )}
    </div>
  );
}
