/**
 * Sentry error tracking setup.
 *
 * To activate (production):
 *   1. npm install @sentry/react
 *   2. Set VITE_SENTRY_DSN in .env
 *   3. Uncomment the Sentry.init() call below
 *
 * Until then, errors are logged to console only.
 */

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;

let sentryInstance = null;

export async function initSentry() {
  if (!SENTRY_DSN) {
    // Silently skip — log only in dev when explicitly debugging
    if (import.meta.env.DEV && import.meta.env.VITE_DEBUG_SENTRY) {
      console.debug("[Sentry] No DSN configured");
    }
    return;
  }

  // Uncomment after `npm install @sentry/react`:
  // const Sentry = await import("@sentry/react");
  // Sentry.init({
  //   dsn: SENTRY_DSN,
  //   tracesSampleRate: 0.1,
  //   environment: import.meta.env.MODE,
  //   release: import.meta.env.VITE_APP_VERSION || "dev",
  //   beforeSend(event) {
  //     // Strip PII from errors
  //     if (event.user) delete event.user.email;
  //     return event;
  //   },
  // });
  // sentryInstance = Sentry;
}

export function captureException(error, context = {}) {
  console.error("[Error]", error, context);
  if (sentryInstance) {
    sentryInstance.captureException(error, { extra: context });
  }
}

export function captureMessage(msg, level = "info") {
  if (sentryInstance) {
    sentryInstance.captureMessage(msg, level);
  }
}
