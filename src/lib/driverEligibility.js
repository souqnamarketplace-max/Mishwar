/**
 * Determines whether a driver can publish trips based on their license history
 * AND their subscription status (when the kill switch is on).
 *
 * License rules:
 * 1. Driver has approved license with all 3 docs valid → can publish
 * 2. Driver's approved license expired but has new pending submission → can publish (grace)
 * 3. Driver's approved expired AND no pending → BLOCKED, must upload new docs
 * 4. Driver never submitted → BLOCKED
 *
 * Subscription rules (only applied when subscriptionStatus is supplied):
 * 5. Subscription kill switch off (status = not_required) → no impact
 * 6. Subscription active or in grace → no impact (license rules still apply)
 * 7. Subscription pending_review / expired / never_subscribed → BLOCKED
 *
 * Subscription block takes precedence over license-allowed states. A driver
 * with valid docs but no active subscription cannot post — that's the entire
 * point of the subscription system.
 *
 * @param {Array}  licenses           Driver license rows (from DriverLicense entity)
 * @param {Object} [subscriptionStatus] Output of driver_subscription_status RPC.
 *                                     If omitted, subscription gating is skipped
 *                                     (callers that don't need the gate, e.g.
 *                                     read-only badges, can pass nothing).
 * @param {Date}   [today]            For deterministic testing
 */
export function checkDriverEligibility(licenses, subscriptionStatus = null, today = new Date()) {
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

  // Compute the license-only verdict first
  let licenseVerdict;
  if (validApproved) {
    licenseVerdict = {
      allowed: true,
      reason: pending ? "valid_with_pending" : "valid_approved",
      latest: validApproved,
      pending,
      lastRejected,
      expiringSoon: isExpiringSoon(validApproved, todayStr, 30),
    };
  } else if (pending && approved.length > 0) {
    // Pending grace ONLY applies to drivers who were previously approved
    // and whose docs expired — they can keep posting while their renewal
    // is reviewed.
    licenseVerdict = {
      allowed: true,
      reason: "pending_grace",
      latest: approved[0],
      pending,
      lastRejected,
    };
  } else if (pending) {
    // First-time pending — explicit block with a distinct reason so the
    // UI can show "your documents are under review" rather than a
    // generic expired-docs message.
    licenseVerdict = {
      allowed: false,
      reason: "first_time_pending",
      latest: null,
      pending,
      lastRejected,
    };
  } else {
    licenseVerdict = {
      allowed: false,
      reason: "expired_no_pending",
      latest: approved[0] || null,
      pending: null,
      lastRejected,
    };
  }

  // Subscription gate — only applied when caller passes a status object.
  // The kill switch + RPC make this a no-op when the system isn't enforced.
  if (subscriptionStatus && licenseVerdict.allowed) {
    const sub = subscriptionStatus.status;
    // not_required / not_deployed / active / in_grace → all allow
    if (sub === "expired" || sub === "never_subscribed" || sub === "pending_review") {
      return {
        ...licenseVerdict,
        allowed: false,
        reason: `subscription_${sub}`,                  // subscription_expired / subscription_never_subscribed / subscription_pending_review
        subscriptionStatus,                              // pass-through for the UI to render details
      };
    }
    // Active or in_grace — pass-through with the subscription metadata
    // attached so the form can show a "X days left" banner.
    if (sub === "in_grace") {
      return {
        ...licenseVerdict,
        reason: "subscription_in_grace",
        subscriptionStatus,
      };
    }
  }

  return licenseVerdict;
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
