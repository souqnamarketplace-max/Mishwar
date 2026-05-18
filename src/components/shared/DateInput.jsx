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
    // If the click landed directly on the native input (because the
    // opacity-0 layer covers the whole div), the browser will open
    // the picker on its own. Stop here to avoid the double-trigger
    // that causes Chrome's NotAllowedError.
    if (e.target === inputRef.current) return;

    // Otherwise (click on the calendar icon or visual text layer):
    // try showPicker first, fall back to .click() if rejected.
    // try/catch handles both the gesture-context rejection AND any
    // browser that doesn't implement showPicker (older Safari).
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
