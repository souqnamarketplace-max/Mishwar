/**
 * BlockedUsersSection — list users I've blocked + an unblock action.
 *
 * Without this, blocking is one-way: once you tap "حظر" in the 3-dot menu
 * on a profile, that user disappears from your search/messages forever
 * with no UI to reverse it. The DB row exists in user_blocks; we just
 * never showed it to the user. This screen reads `user_blocks` filtered
 * by my email and lets me delete rows I created — i.e., undo my own
 * blocks. Blocks AGAINST me (someone blocked me) are intentionally
 * not surfaced — that's the other party's choice and reflecting it back
 * to me would just enable harassment retries.
 */
import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/apiClient";
import { invalidateBlockCache } from "@/lib/blockUtils";
import { Button } from "@/components/ui/button";
import { Shield, X } from "lucide-react";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";

export default function BlockedUsersSection({ user }) {
  const qc = useQueryClient();

  const { data: blocks = [], isLoading } = useQuery({
    queryKey: ["my-blocks-list", user?.email],
    queryFn: () => user?.email
      ? api.entities.UserBlock.filter({ blocker_email: user.email }, "-created_at", 200)
      : [],
    enabled: !!user?.email,
  });

  const unblockMutation = useMutation({
    mutationFn: (id) => api.entities.UserBlock.delete(id),
    onSuccess: () => {
      // Invalidate every cache that filters by blocks: search results,
      // trip lists, the cached set in blockUtils, and our own list view.
      invalidateBlockCache();
      qc.invalidateQueries({ queryKey: ["my-blocks-list", user?.email] });
      qc.invalidateQueries({ queryKey: ["my-blocks", user?.email] });
      qc.invalidateQueries({ queryKey: ["trips"] });
      qc.invalidateQueries({ queryKey: ["search-trips"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      toast.success("تم إلغاء الحظر");
    },
    onError: (err) => toast.error(friendlyError(err, "فشل إلغاء الحظر")),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>;
  }

  if (!blocks.length) {
    return (
      <div className="text-center py-10">
        <Shield className="w-12 h-12 mx-auto mb-3 text-muted-foreground/40" />
        <p className="text-sm font-medium text-foreground mb-1">لا يوجد مستخدمون محظورون</p>
        <p className="text-xs text-muted-foreground">
          يمكنك حظر أي مستخدم من قائمة الخيارات (⋮) في صفحته الشخصية أو في رحلة.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground mb-4">
        المستخدمون الذين قمت بحظرهم — لن تتلقى منهم رسائل ولن تظهر رحلاتهم في بحثك.
      </p>
      {blocks.map((b) => (
        <div
          key={b.id}
          className="flex items-center justify-between p-3 bg-muted/30 rounded-xl border border-border/50"
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{b.blocked_email}</p>
            {b.reason && (
              <p className="text-xs text-muted-foreground truncate">{b.reason}</p>
            )}
            {b.created_at && (
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {new Date(b.created_at).toLocaleDateString("ar-EG")}
              </p>
            )}
          </div>
          <Button
            onClick={() => unblockMutation.mutate(b.id)}
            disabled={unblockMutation.isPending}
            variant="ghost"
            size="sm"
            className="text-xs text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
          >
            <X className="w-3.5 h-3.5 mr-1" />
            إلغاء الحظر
          </Button>
        </div>
      ))}
    </div>
  );
}
