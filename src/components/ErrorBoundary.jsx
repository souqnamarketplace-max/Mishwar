import React from "react";
import { captureException } from "@/lib/sentry";

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Log to error tracking service. The error message + component stack
    // is what the dev needs to actually fix the bug; the user-facing
    // fallback UI just needs to recover gracefully.
    console.error("[ErrorBoundary]", error, info);
    captureException(error, { componentStack: info.componentStack });
  }

  render() {
    if (this.state.hasError) {
      // Caller can opt into a custom inline fallback (e.g. an empty
      // span where a small widget used to be) instead of the default
      // full-screen recovery UI. Use cases:
      //   - inline widgets (notification bell, badges) where a full
      //     screen takeover would be jarring
      //   - non-critical sections (recent activity panel, charts)
      //     where the rest of the page should still work
      // If `fallback={null}` is passed, the failed subtree just
      // renders nothing — error is still logged so we can fix it.
      if (this.props.fallback !== undefined) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4" dir="rtl">
          <div className="text-center max-w-sm">
            <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">⚠️</span>
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2">حدث خطأ غير متوقع</h2>
            <p className="text-sm text-muted-foreground mb-6">
              نعتذر عن الإزعاج. يرجى تحديث الصفحة أو العودة للرئيسية.
            </p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => window.location.reload()}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium">
                تحديث الصفحة
              </button>
              <a href="/" className="px-4 py-2 bg-muted text-foreground rounded-xl text-sm font-medium">
                الرئيسية
              </a>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
