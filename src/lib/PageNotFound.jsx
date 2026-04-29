import React from "react";
import { Link } from "react-router-dom";
import { Home, Search, ArrowLeft } from "lucide-react";

export default function PageNotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4" dir="rtl">
      <div className="text-center max-w-md">
        {/* Visual */}
        <div className="relative inline-block mb-6">
          <div className="text-8xl sm:text-9xl font-black text-primary/20 leading-none select-none">404</div>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center shadow-lg">
              <span className="text-3xl sm:text-4xl font-black">م</span>
            </div>
          </div>
        </div>

        <h1 className="text-2xl sm:text-3xl font-black text-foreground mb-2">عذراً، تهت في الطريق! 🗺️</h1>
        <p className="text-muted-foreground mb-8">
          الصفحة اللي تبحث عنها مش موجودة أو تم نقلها.
          <br />يمكنك العودة للرئيسية أو البحث عن رحلة.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            to="/"
            className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-2xl font-bold text-sm hover:bg-primary/90 transition-all shadow-lg active:scale-95"
          >
            <Home className="w-4 h-4" />
            الرئيسية
          </Link>
          <Link
            to="/search"
            className="inline-flex items-center justify-center gap-2 bg-card border-2 border-border text-foreground px-6 py-3 rounded-2xl font-bold text-sm hover:border-primary/30 transition-all active:scale-95"
          >
            <Search className="w-4 h-4" />
            ابحث عن رحلة
          </Link>
        </div>

        <button
          onClick={() => window.history.back()}
          className="mt-6 text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          العودة للصفحة السابقة
        </button>
      </div>
    </div>
  );
}
