import React from "react";
import { Link } from "react-router-dom";

/**
 * Reusable empty state with icon + title + description + optional CTA.
 *
 * @example
 * <EmptyState emoji="📭" title="ما عندك رحلات بعد" description="ابحث عن رحلتك الأولى" cta={{ to: "/search", label: "ابحث الآن" }} />
 */
export default function EmptyState({ emoji = "📭", title, description, cta, className = "" }) {
  return (
    <div className={`flex flex-col items-center justify-center py-16 px-4 text-center ${className}`} dir="rtl">
      <div className="w-20 h-20 rounded-3xl bg-muted flex items-center justify-center mb-4 text-4xl">
        {emoji}
      </div>
      <h3 className="text-lg font-bold text-foreground mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-xs mb-6 leading-relaxed">
          {description}
        </p>
      )}
      {cta && (
        <Link
          to={cta.to}
          className="inline-flex items-center justify-center px-6 py-3 bg-primary text-primary-foreground rounded-xl font-bold text-sm hover:bg-primary/90 active:scale-95 transition-all shadow-md"
        >
          {cta.label}
        </Link>
      )}
    </div>
  );
}
