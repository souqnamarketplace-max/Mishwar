/**
 * Append a row to the admin_audit_log table.
 *
 * Why this lives outside base44Client:
 *   - The base44 entity client auto-injects `created_by`, which doesn't exist
 *     on admin_audit_log and would cause every insert to fail.
 *   - We need finely-tuned auth handling — must use the USER's JWT so that
 *     RLS policies (`audit_insert_admin` for admins, `audit_insert_self`
 *     where admin_email = auth_user_email()) actually pass. The previous
 *     version sent a hardcoded anon key as Bearer, which made
 *     auth_user_role() / auth_user_email() resolve to NULL — so every
 *     client-side audit insert was being SILENTLY rejected by RLS. That
 *     explained why account deletions, mark-paid clicks, and other admin
 *     actions never showed up in the audit log.
 *
 * Logging failures must never block the main action — the catch is
 * intentionally swallowing. But we surface the error in dev console.
 *
 * @example
 *   await logAdminAction("delete_trip", "trip", tripId, { reason: "spam" });
 *   await logAudit("booking_confirmed", "booking", bookingId, {...});
 */
const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

import { readLocalSession } from "@/lib/session";

// Thin wrapper that returns just the (token, email) shape this module
// uses. The expiry check is already done inside readLocalSession.
function readSessionFromStorage() {
  const session = readLocalSession();
  if (!session?.access_token) return null;
  return {
    token: session.access_token,
    email: session?.user?.email || null,
  };
}

export async function logAdminAction(action, targetType, targetId, details = {}) {
  const session = readSessionFromStorage();

  // No valid session → we can't pass the audit_insert_self RLS check
  // (which requires admin_email = auth_user_email()). Skip rather than
  // attempting an insert that would be rejected.
  if (!session?.token || !session?.email) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.debug("[audit] skip — no valid session", { action, targetType });
    }
    return;
  }

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/admin_audit_log`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        // apikey stays as the anon key — that's the project key, separate
        // from the user identity. The Bearer is the user's JWT so RLS
        // resolves their email and role.
        "apikey":        SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${session.token}`,
        "Prefer":        "return=minimal",
      },
      body: JSON.stringify({
        admin_email: session.email,   // must match auth_user_email() per RLS
        action,
        target_type: targetType,
        target_id:   targetId ? String(targetId) : null,
        details,
      }),
    });

    if (!r.ok && import.meta.env.DEV) {
      const text = await r.text().catch(() => "");
      // eslint-disable-next-line no-console
      console.warn("[audit] insert failed", r.status, text);
    }
  } catch (e) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn("[audit] insert threw", e);
    }
  }
}

// Alias — use this for non-admin user actions (booking events etc.)
export const logAudit = logAdminAction;
