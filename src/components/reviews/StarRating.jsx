import React, { useState } from "react";
import { Star } from "lucide-react";

export default function StarRating({ value = 0, onChange, readonly = false, size = "md" }) {
  const [hovered, setHovered] = useState(0);
  const sz = size === "sm" ? "w-4 h-4" : size === "lg" ? "w-8 h-8" : "w-6 h-6";

  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readonly}
          onClick={() => onChange?.(star)}
          onMouseEnter={() => !readonly && setHovered(star)}
          onMouseLeave={() => !readonly && setHovered(0)}
          className={`transition-transform ${!readonly ? "cursor-pointer hover:scale-110" : "cursor-default"}`}
        >
          <Star
            className={`${sz} transition-colors ${
              star <= (hovered || value)
                ? "text-yellow-500 fill-yellow-500"
                : "text-muted-foreground/40"
            }`}
          />
        </button>
      ))}
    </div>
  );
}