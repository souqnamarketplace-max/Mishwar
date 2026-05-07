/**
 * Determines whether a driver can publish trips based on their license history.
 *
 * Rules:
 * 1. Driver has approved license with all 3 docs valid → can publish
 * 2. Driver's approved license expired but has new pending submission → can publish (grace)
 * 3. Driver's approved expired AND no pending → BLOCKED, must upload new docs
 * 4. Driver never submitted → BLOCKED
 */
export function checkDriverEligibility(licenses, today = new Date()) {
  if (!Array.isArray(licenses) || licenses.length === 0) {
    return { allowed: false, reason: "no_docs", latest: null, pending: null };
  }

  const todayStr = today.toISOString().split("T")[0];

  // Sort by created_date desc so most recent first
  const sorted = [...licenses].sort((a, b) =>
    (b.created_date || b.submitted_at || "").localeCompare(a.created_date || a.submitted_at || "")
  );

  const approved = sorted.filter((l) => l.status === "approved");
  const pending = sorted.find((l) => l.status === "pending");
  const lastRejected = sorted.find((l) => l.status === "rejected");

  // Find the most recent approved with all 3 docs still valid
  const validApproved = approved.find((l) => {
    const lic = l.expiry_date && l.expiry_date >= todayStr;
    const reg = !l.car_registration_expiry_date || l.car_registration_expiry_date >= todayStr;
    const ins = !l.insurance_expiry_date || l.insurance_expiry_date >= todayStr;
    return lic && reg && ins;
  });

  if (validApproved) {
    return {
      allowed: true,
      reason: pending ? "valid_with_pending" : "valid_approved",
      latest: validApproved,
      pending,
      lastRejected,
      expiringSoon: isExpiringSoon(validApproved, todayStr, 30),
    };
  }

  // Pending grace ONLY applies to drivers who were previously approved
  // and whose docs expired — they can keep posting while their renewal
  // is reviewed. A driver awaiting their FIRST approval must not be
  // allowed to post; this was the bug where a brand-new driver could
  // submit the wizard and immediately publish trips before any human
  // ever reviewed their license.
  if (pending && approved.length > 0) {
    return {
      allowed: true,
      reason: "pending_grace",
      latest: approved[0],
      pending,
      lastRejected,
    };
  }

  // First-time pending — explicit block with a distinct reason so the
  // UI can show "your documents are under review" rather than a
  // generic expired-docs message.
  if (pending) {
    return {
      allowed: false,
      reason: "first_time_pending",
      latest: null,
      pending,
      lastRejected,
    };
  }

  return {
    allowed: false,
    reason: "expired_no_pending",
    latest: approved[0] || null,
    pending: null,
    lastRejected,
  };
}

function isExpiringSoon(license, todayStr, daysThreshold = 30) {
  const dates = [
    license.expiry_date,
    license.car_registration_expiry_date,
    license.insurance_expiry_date,
  ].filter(Boolean);

  return dates.some((d) => {
    const days = Math.round((new Date(d) - new Date(todayStr)) / 86400000);
    return days >= 0 && days <= daysThreshold;
  });
}

export function daysUntil(dateStr, today = new Date()) {
  if (!dateStr) return null;
  return Math.round((new Date(dateStr) - today) / 86400000);
}
