import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { X, Megaphone } from "lucide-react";
import { useState } from "react";

export default function AnnouncementBanner() {
  const [dismissed, setDismissed] = useState([]);

  const { data: announcements = [] } = useQuery({
    queryKey: ["announcements-active"],
    queryFn: () => base44.entities.Announcement.filter({ is_active: true }, "-created_date", 3),
  });

  const visible = announcements.filter(a => !dismissed.includes(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="space-y-1">
      {visible.map((ann) => (
        <div key={ann.id} className="bg-primary text-primary-foreground px-4 py-2.5 flex items-center gap-3">
          <Megaphone className="w-4 h-4 shrink-0" />
          <p className="text-sm flex-1 font-medium">{ann.text}</p>
          <button
            onClick={() => setDismissed(d => [...d, ann.id])}
            className="p-1 rounded hover:bg-white/20 transition-colors shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
