import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { initSentry } from '@/lib/sentry'

// Initialize error tracking (no-op if VITE_SENTRY_DSN not set)
initSentry();

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
