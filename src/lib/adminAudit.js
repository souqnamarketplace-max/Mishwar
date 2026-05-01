import { base44 } from "@/api/base44Client";

/**
 * Log an admin/system action to the audit trail.
 * Uses direct REST (not supabase-js) — safe to call from any context.
 *
 * @example
 * await logAdminAction("delete_trip", "trip", tripId, { reason: "user request" });
 * await logAudit("booking_confirmed", "booking", bookingId, { passenger_email, driver_email });
 */
export async function logAdminAction(action, targetType, targetId, details = {}) {
  try {
    // Read admin email from session (direct localStorage — no supabase-js hang)
    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
    const PROJECT_REF  = SUPABASE_URL?.split("//")[1]?.split(".")[0] || "";
    let adminEmail = "system";
    try {
      const raw = localStorage.getItem(`sb-${PROJECT_REF}-auth-token`);
      if (raw) {
        const parsed = JSON.parse(raw);
        adminEmail = parsed?.user?.email || "system";
      }
    } catch {}

    // Use direct REST to bypass base44 SDK auto-injecting 'created_by'
    // which doesn't exist on admin_audit_log table
    const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
    await fetch(`${SUPABASE_URL}/rest/v1/admin_audit_log`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Prefer": "return=minimal",
      },
      body: JSON.stringify({
        admin_email: adminEmail,
        action,
        target_type: targetType,
        target_id:   targetId ? String(targetId) : null,
        details,
      }),
    });
  } catch (e) {
    // Audit logging failures must never block the main action
    console.warn("[adminAudit] failed to log:", e?.message);
  }
}

// Alias — use this for non-admin user actions (booking events etc.)
export const logAudit = logAdminAction;
