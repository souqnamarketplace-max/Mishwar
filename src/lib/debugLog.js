/**
 * Debug log capture — buffers console output and runtime errors so we
 * can surface them inside the in-app debug overlay later.
 *
 * Why monkey-patch console:
 * - Errors happening on app boot (before the overlay component mounts)
 *   would otherwise be lost.
 * - Sentry catches *errors* but not warnings or info logs that often
 *   provide the surrounding context needed to reproduce a bug.
 *
 * Capacity: keep the last MAX_LOGS entries (FIFO ring). 200 is enough
 * to cover a typical session without blowing memory on devices with
 * little RAM.
 *
 * Safety:
 * - Original console methods are still called; we only *observe*.
 * - try/catch wraps every stringify call — a circular ref or huge
 *   object should never break the app.
 * - The buffer is in-memory only. Nothing is sent anywhere unless the
 *   user explicitly opens the overlay and taps "Copy report".
 */

const MAX_LOGS = 200;
const buffer = [];
let initialized = false;

/**
 * Convert an arbitrary console argument to a short, safe string. We
 * cap the per-arg length so a giant JSON dump can't fill the buffer
 * with a single entry.
 */
function stringifyArg(arg) {
  try {
    if (arg === null) return "null";
    if (arg === undefined) return "undefined";
    if (typeof arg === "string") return arg;
    if (typeof arg === "number" || typeof arg === "boolean") return String(arg);
    if (arg instanceof Error) {
      return `${arg.name}: ${arg.message}${arg.stack ? "\n" + arg.stack : ""}`;
    }
    const s = JSON.stringify(arg, null, 2);
    return s.length > 2000 ? s.slice(0, 2000) + "…(truncated)" : s;
  } catch {
    return "[unserializable]";
  }
}

function push(level, args) {
  try {
    const msg = Array.from(args).map(stringifyArg).join(" ");
    buffer.push({
      ts: new Date().toISOString(),
      level,
      msg,
    });
    if (buffer.length > MAX_LOGS) buffer.shift();
  } catch {
    // Never let logging break the app.
  }
}

/**
 * Wire up global capture. Idempotent — safe to call more than once.
 * Call from main.jsx before render so we catch boot-time errors.
 */
export function initDebugLog() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  const original = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  console.log = (...a) => { push("log", a); original.log(...a); };
  console.info = (...a) => { push("info", a); original.info(...a); };
  console.warn = (...a) => { push("warn", a); original.warn(...a); };
  console.error = (...a) => { push("error", a); original.error(...a); };

  // Uncaught errors and unhandled promise rejections — these wouldn't
  // appear in console.error if the host doesn't print them.
  window.addEventListener("error", (e) => {
    push("error", [`Uncaught: ${e.message}`, e.error?.stack || e.filename + ":" + e.lineno]);
  });
  window.addEventListener("unhandledrejection", (e) => {
    push("error", [`UnhandledPromise: ${stringifyArg(e.reason)}`]);
  });
}

/**
 * Snapshot the current buffer. Returns a new array; the caller can't
 * mutate our internal buffer.
 */
export function getLogs() {
  return buffer.slice();
}

export function clearLogs() {
  buffer.length = 0;
}
