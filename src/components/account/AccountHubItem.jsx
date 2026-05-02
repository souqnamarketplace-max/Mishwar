import React from "react";
import { ChevronLeft } from "lucide-react";

/**
 * Reusable navigable list item for the account hub (Poparide-style row).
 */
export default function AccountHubItem({ icon: Icon, label, sublabel, badge, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3.5 border-b border-border/50 hover:bg-muted/40 transition-colors text-right ${danger ? "text-destructive" : "text-foreground"}`}
    >
      {Icon && (
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${danger ? "bg-destructive/10" : "bg-primary/10"}`}>
          <Icon className={`w-4 h-4 ${danger ? "text-destructive" : "text-primary"}`} />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className={`font-bold text-sm ${danger ? "text-destructive" : "text-foreground"}`}>{label}</p>
        {sublabel && <p className="text-xs text-muted-foreground truncate">{sublabel}</p>}
      </div>
      {badge && (
        <span className="text-[10px] font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full shrink-0">
          {badge}
        </span>
      )}
      <ChevronLeft className={`w-4 h-4 ${danger ? "text-destructive/60" : "text-muted-foreground/60"} shrink-0`} />
    </button>
  );
}
