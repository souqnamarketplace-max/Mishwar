import React from "react";
import { captureException } from "@/lib/sentry";

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, componentStack: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Log to error tracking service. The error message + component stack
    // is what the dev needs to actually fix the bug; the user-facing
    // fallback UI just needs to recover gracefully.
    console.error("[ErrorBoundary]", error, info);
    // Stash on window for post-hoc debugging on devices where the console
    // isn't easily accessible (mobile browsers, in-app webviews). Lets
    // a user paste `window.__lastError` into a chat with support.
    try {
      window.__lastError = {
        message: error?.message || String(error),
        stack: error?.stack || null,
        componentStack: info?.componentStack || null,
        at: new Date().toISOString(),
      };
    } catch { /* defensive — never let logging break the boundary */ }
    this.setState({ componentStack: info?.componentStack || null });
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
        // If the fallback is a valid React element, clone it and inject
        // the error + componentStack so the fallback can surface technical
        // details when needed. Falls back to rendering as-is for null/strings.
        if (React.isValidElement(this.props.fallback)) {
          return React.cloneElement(this.props.fallback, {
            error: this.state.error,
            componentStack: this.state.componentStack,
          });
        }
        return this.props.fallback;
      }

      return <DefaultFallback error={this.state.error} componentStack={this.state.componentStack} />;
    }
    return this.props.children;
  }
}

// Default full-screen fallback. Extracted from inline JSX so it can hold
// its own useState for the details toggle without converting the class
// boundary to a hook component (which would lose getDerivedStateFromError).
function DefaultFallback({ error, componentStack }) {
  const [showDetails, setShowDetails] = React.useState(false);
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
        {error && (
          <div className="mt-6 text-right">
            <button
              onClick={() => setShowDetails(s => !s)}
              className="text-xs text-muted-foreground underline">
              {showDetails ? "إخفاء التفاصيل التقنية" : "عرض التفاصيل التقنية"}
            </button>
            {showDetails && (
              <pre className="mt-2 p-3 bg-muted/40 rounded-lg text-[10px] leading-snug text-foreground/80 overflow-auto max-h-64 whitespace-pre-wrap break-all text-left" dir="ltr">
                {String(error?.message || error)}
                {error?.stack ? `\n\n${error.stack}` : ""}
                {componentStack ? `\n\nComponent stack:${componentStack}` : ""}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
