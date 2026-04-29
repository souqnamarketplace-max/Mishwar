import React from "react";
import { ChevronRight, ChevronLeft } from "lucide-react";

/**
 * Reusable pagination controls for admin tables.
 * @param {number} page         current page (1-indexed)
 * @param {number} totalPages   total page count
 * @param {function} onChange   (newPage) => void
 */
export default function Pagination({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null;

  const pages = [];
  // Show: first, current-1, current, current+1, last (with ellipses)
  const add = n => { if (!pages.includes(n) && n >= 1 && n <= totalPages) pages.push(n); };
  add(1);
  add(page - 1);
  add(page);
  add(page + 1);
  add(totalPages);
  pages.sort((a, b) => a - b);

  return (
    <div className="flex items-center justify-center gap-1 py-4" dir="rtl">
      <button
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page === 1}
        className="w-9 h-9 rounded-lg flex items-center justify-center border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <ChevronRight className="w-4 h-4" />
      </button>

      {pages.map((p, i) => {
        const showEllipsis = i > 0 && p - pages[i - 1] > 1;
        return (
          <React.Fragment key={p}>
            {showEllipsis && <span className="px-1 text-muted-foreground">…</span>}
            <button
              onClick={() => onChange(p)}
              className={`min-w-[36px] h-9 rounded-lg px-3 text-sm font-medium transition-colors ${
                p === page
                  ? "bg-primary text-primary-foreground"
                  : "border border-border hover:bg-muted"
              }`}
            >
              {p.toLocaleString("ar")}
            </button>
          </React.Fragment>
        );
      })}

      <button
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page === totalPages}
        className="w-9 h-9 rounded-lg flex items-center justify-center border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
    </div>
  );
}
