import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Strip console.* and debugger statements from production builds.
  // Dev builds keep them so debugging stays comfortable.
  // (audit M-05) — pairs with the captureException sentry helper which
  // continues to console.error in dev only.
  esbuild: {
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
  },
  build: {
    // Chunk splitting for better caching
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react':   ['react', 'react-dom', 'react-router-dom'],
          'vendor-ui':      ['@radix-ui/react-dialog', '@radix-ui/react-tabs', 'framer-motion'],
          'vendor-query':   ['@tanstack/react-query'],
          'vendor-supabase':['@supabase/supabase-js'],
          'vendor-leaflet': ['leaflet', 'react-leaflet'],
          // recharts intentionally NOT split into its own vendor chunk —
          // it's only used by src/components/dashboard/DashboardCharts.jsx
          // which is already lazy-imported. Letting Vite co-locate it
          // with that lazy chunk means non-admin routes never load
          // recharts at all, and admin routes load it asynchronously
          // after the dashboard shell paints.
        },
      },
    },
    // Warn if any chunk exceeds 1MB
    chunkSizeWarningLimit: 1000,
    // Enable source maps for production error tracking
    sourcemap: false,
    // Minify
    minify: 'esbuild',
    target: 'es2020',
  },
  // Optimize dependencies upfront
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', '@supabase/supabase-js'],
  },
})
