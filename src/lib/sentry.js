/**
 * Sentry error tracking — opt-in, dependency-soft.
 *
 * To activate in production:
 *   1. npm install @sentry/react
 *   2. Set VITE_SENTRY_DSN in Vercel env vars
 *   3. Redeploy. That's it.
 *
 * Without those two steps every export is a safe no-op. Code across
 * the app calls captureException() / setSentryUser() unconditionally;
 * this file is the only place that knows whether Sentry is wired.
 *
 * Implementation note:
 *   We use Vite's `import.meta.glob` to find @sentry/react in
 *   node_modules. The glob resolves to an empty object at build time
 *   when the package isn't installed — so the build succeeds and
 *   every export degrades to a no-op. When the package IS installed,
 *   the glob picks it up and Sentry initializes normally.
 *
 * PII handling (when active):
 *   - sendDefaultPii=false (Sentry default; user IPs / cookies not sent)
 *   - beforeSend strips email/phone/JWT/Supabase-key patterns from
 *     breadcrumbs and extras
 *   - tracesSampleRate kept low (5%); replays disabled
 */

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;
const APP_VER    = import.meta.env.VITE_APP_VERSION || "dev";
const MODE       = import.meta.env.MODE;

let sentryInstance = null;
let initPromise    = null;

const REDACT_PATTERNS = [
  /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  /\b(?:\+?970|0)?5[02-9]\d{7}\b/g,
  /\bsb_(?:publishable|secret)_[A-Za-z0-9_]+\b/g,
];

function redact(value) {
  if (typeof value !== "string") return value;
  let out = value;
  for (const re of REDACT_PATTERNS) out = out.replace(re, "[redacted]");
  return out;
}

function scrubEvent(event) {
  if (!event) return event;
  if (event.message) event.message = redact(event.message);
  if (event.exception?.values) {
    for (const ex of event.exception.values) {
      if (ex.value) ex.value = redact(ex.value);
    }
  }
  if (event.user) {
    delete event.user.email;
    delete event.user.username;
    delete event.user.ip_address;
  }
  if (Array.isArray(event.breadcrumbs)) {
    for (const bc of event.breadcrumbs) {
      if (bc.message) bc.message = redact(bc.message);
      if (bc.data && typeof bc.data === "object") {
        for (const k of Object.keys(bc.data)) bc.data[k] = redact(bc.data[k]);
      }
    }
  }
  return event;
}

const sentryLoader = import.meta.glob("/node_modules/@sentry/react/build/esm/index.js");

export async function initSentry() {
  if (initPromise) return initPromise;
  if (!SENTRY_DSN) {
    if (import.meta.env.DEV && import.meta.env.VITE_DEBUG_SENTRY) {
      console.debug("[Sentry] No DSN configured — skipping init");
    }
    return null;
  }

  initPromise = (async () => {
    try {
      const loaderKeys = Object.keys(sentryLoader);
      if (loaderKeys.length === 0) {
        if (import.meta.env.DEV) {
          console.warn("[Sentry] @sentry/react not installed — disabled");
        }
        return null;
      }
      const Sentry = await sentryLoader[loaderKeys[0]]();
      Sentry.init({
        dsn: SENTRY_DSN,
        environment: MODE,
        release: APP_VER,
        tracesSampleRate: 0.05,
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        sendDefaultPii: false,
        beforeSend: scrubEvent,
        beforeBreadcrumb(bc) {
          if (bc?.category === "console") return null;
          return bc;
        },
      });
      sentryInstance = Sentry;
      return Sentry;
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn("[Sentry] init failed —", err?.message || err);
      }
      return null;
    }
  })();
  return initPromise;
}

export function captureException(error, context = {}) {
  if (import.meta.env.DEV) {
    console.error("[Error]", error, context);
  }
  if (sentryInstance) {
    sentryInstance.captureException(error, { extra: scrubExtra(context) });
  }
}

export function captureMessage(msg, level = "info") {
  if (sentryInstance) sentryInstance.captureMessage(redact(String(msg)), level);
}

export function setSentryUser(userId) {
  if (sentryInstance && userId) sentryInstance.setUser({ id: String(userId) });
}

export function clearSentryUser() {
  if (sentryInstance) sentryInstance.setUser(null);
}

function scrubExtra(extra) {
  if (!extra || typeof extra !== "object") return extra;
  const out = {};
  for (const [k, v] of Object.entries(extra)) {
    if (typeof v === "string")       out[k] = redact(v);
    else if (v instanceof Error)     out[k] = { message: redact(v.message), name: v.name };
    else if (typeof v === "object")  {
      try   { out[k] = JSON.parse(redact(JSON.stringify(v))); }
      catch { out[k] = "[unserializable]"; }
    } else                            out[k] = v;
  }
  return out;
}
