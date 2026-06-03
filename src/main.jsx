import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { initSentry } from '@/lib/sentry'
import { initNativeShell } from '@/lib/native'
import { initDebugLog } from '@/lib/debugLog'

// Initialize debug log capture FIRST so we catch boot-time errors.
// In-memory only, hidden from users unless they open the debug overlay.
initDebugLog();

// Initialize error tracking (no-op if VITE_SENTRY_DSN not set)
initSentry();

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)

// ─── Pinch-zoom safety net ──────────────────────────────────────────────
// The viewport meta tag in index.html (user-scalable=no, maximum-scale=1)
// disables pinch-zoom for ~95% of browsers, but iOS Safari 13+ occasionally
// honors the gesture anyway when the user uses two fingers very quickly.
// `gesturestart` is iOS-only and fires the instant a pinch begins —
// preventDefault aborts the zoom before it visibly starts. The capture-
// phase + passive:false combination is required to actually cancel the
// gesture (a passive listener can't preventDefault). No-op on desktop and
// Android where this event doesn't exist.
//
// Also block the iOS double-tap-zoom on body which `touch-action:
// manipulation` mostly handles — but some Tailwind utility classes
// re-enable touch-action implicitly, so a global gesture-blocking
// listener is the safe fallback.
if (typeof window !== 'undefined') {
  const blockGesture = (e) => e.preventDefault();
  // gesturestart/change/end are non-standard iOS-only events. Listening
  // unconditionally is safe — non-iOS browsers ignore unknown event names.
  window.addEventListener('gesturestart',  blockGesture, { passive: false });
  window.addEventListener('gesturechange', blockGesture, { passive: false });
  window.addEventListener('gestureend',    blockGesture, { passive: false });
}
// ────────────────────────────────────────────────────────────────────────

// Native shell setup — runs only when wrapped by Capacitor (iOS/Android).
// In a regular web browser this is a cheap no-op. Called AFTER render so
// the splash screen hides as soon as the React tree is on screen, not
// after the JS bundle finishes parsing.
initNativeShell();
