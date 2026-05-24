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
 *
 * SHOWPICKER GOTCHA (Chrome NotAllowedError):
 *   input.showPicker() must run inside a synchronous user-gesture
 *   handler. When the user clicks the wrapper div, Chrome treats
 *   that click as a gesture on the DIV, not the inner input — and
 *   sometimes the gesture context is rejected when we forward to
 *   showPicker(). This produced a noisy console error on every
 *   DateInput tap.
 *
 *   Fix:
 *     1. Don't call showPicker if the click target is the input
 *        itself (the opacity-0 input over the div will receive the
 *        click directly and open the picker natively without our
 *        help — that's the COMMON case).
 *     2. Wrap the manual showPicker call in try/catch so the rare
 *        keyboard-activation (Tab → Enter on the wrapper) gracefully
 *        falls back to .click() instead of throwing.
 */
export default function DateInput({ value, onChange, className = "", min, max, placeholder = "اختر التاريخ" }) {
  const inputRef = useRef(null);

  const formatted = value ? formatArabicDate(value + "T00:00:00") : null;

  const handleWrapperClick = (e) => {
    // CRITICAL FIX: Always attempt to open the picker programmatically.
    // Previously we returned early if the click landed on the native input
    // (e.target === inputRef.current), assuming the browser would open the
    // picker automatically. But in Chrome desktop this doesn't always happen
    // — the input receives focus but the calendar doesn't appear. Now we
    // ALWAYS call showPicker() or click() regardless of target, ensuring the
    // calendar opens on every click.
    const el = inputRef.current;
    if (!el) return;
    try {
      if (typeof el.showPicker === "function") {
        el.showPicker();
      } else {
        el.click();
      }
    } catch {
      // showPicker rejected the gesture context — fall back to a
      // programmatic click which Safari/Firefox handle without
      // requiring an explicit picker API call.
      try { el.click(); } catch { /* truly nothing we can do */ }
    }
  };

  return (
    <div
      className={`relative flex items-center cursor-pointer ${className}`}
      onClick={handleWrapperClick}
    >
      {/* Hidden native input — handles the actual picker + value */}
      <input
        ref={inputRef}
        type="date"
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10"
        style={{ colorScheme: "light" }}
      />

      {/* Visual display layer */}
      <div className="relative z-0 flex items-center w-full pointer-events-none">
        <Calendar className="w-4 h-4 text-muted-foreground shrink-0 mr-2 ml-1" />
        <span className={`text-sm select-none ${value ? "text-foreground font-medium" : "text-muted-foreground"}`}>
          {formatted || placeholder}
        </span>
      </div>
    </div>
  );
}
