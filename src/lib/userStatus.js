// Helpers for user account status checks.
// Deleted accounts are anonymized by replacing their email with a value
// ending in DELETED_EMAIL_SUFFIX. The DB enforces a RESTRICTIVE RLS policy
// (`messages_block_send_to_deleted`) that returns 403 on any insert into
// `messages` whose `receiver_email` matches `%@deleted.local`. The helpers
// below let the client mirror that gate in the UI so users get a friendly
// message instead of a silent failure or a raw 403 toast.

export const DELETED_EMAIL_SUFFIX = "@deleted.local";

export function isDeletedUserEmail(email) {
  return typeof email === "string" && email.endsWith(DELETED_EMAIL_SUFFIX);
}
