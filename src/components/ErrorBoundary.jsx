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
    // Log to error tracking service
    console.error("[ErrorBoundary]", error, info);
    captureException(error, { componentStack: info.componentStack });
  }

  render() {
    if (this.state.hasError) {
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
