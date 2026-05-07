import React, { useRef } from "react";
import { Calendar } from "lucide-react";
import { formatArabicDate } from "@/lib/validation";

/**
 * DateInput — replaces native <input type="date"> across the app.
 * Shows an Arabic placeholder when no date is selected, while keeping
 * the native date-picker fully functional.
 *
 * Date format: Gregorian + Arabic month names ("٦ مايو ٢٠٢٦"), per
 * Palestinian convention. We do NOT use ar-SA because that defaults
 * to the Hijri/Islamic calendar which is unfamiliar in Palestine.
 */
export default function DateInput({ value, onChange, className = "", min, max, placeholder = "اختر التاريخ" }) {
  const inputRef = useRef(null);

  const formatted = value ? formatArabicDate(value + "T00:00:00") : null;

  return (
    <div
      className={`relative flex items-center cursor-pointer ${className}`}
      onClick={() => inputRef.current?.showPicker?.() || inputRef.current?.click()}
    >
      {/* Hidden native input — handles the actual picker + value */}
      <input
        ref={inputRef}
        type="date"
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
        style={{ colorScheme: "light" }}
      />

      {/* Visual display layer */}
      <Calendar className="w-4 h-4 text-muted-foreground shrink-0 mr-2 ml-1" />
      <span className={`text-sm select-none ${value ? "text-foreground font-medium" : "text-muted-foreground"}`}>
        {formatted || placeholder}
      </span>
    </div>
  );
}
