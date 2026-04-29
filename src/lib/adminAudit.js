import { supabase } from "@/lib/supabase";

/**
 * Log an admin action to the audit trail.
 * Call from any admin destructive action (delete, role change, ban, etc.)
 *
 * @example
 * await logAdminAction("delete_trip", "trip", tripId, { reason: "user request" });
 */
export async function logAdminAction(action, targetType, targetId, details = {}) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const adminEmail = session?.user?.email;
    if (!adminEmail) return;

    await supabase.from("admin_audit_log").insert({
      admin_email: adminEmail,
      action,
      target_type: targetType,
      target_id: targetId ? String(targetId) : null,
      details,
    });
  } catch (e) {
    // Audit logging failures should not block the action — just warn
    console.warn("[adminAudit] failed to log:", e);
  }
}
