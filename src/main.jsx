import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { initSentry } from '@/lib/sentry'
import { initNativeShell } from '@/lib/native'

// Initialize error tracking (no-op if VITE_SENTRY_DSN not set)
initSentry();

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)

// Native shell setup — runs only when wrapped by Capacitor (iOS/Android).
// In a regular web browser this is a cheap no-op. Called AFTER render so
// the splash screen hides as soon as the React tree is on screen, not
// after the JS bundle finishes parsing.
initNativeShell();
