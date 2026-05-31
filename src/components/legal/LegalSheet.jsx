/**
 * LegalSheet — bottom-anchored modal that shows the Terms or Privacy
 * Policy text inline, without navigating away from the current page.
 *
 * WHY THIS EXISTS
 * The login screen has a disclaimer "بالتسجيل، أنت توافق على شروط
 * الاستخدام وسياسة الخصوصية" but the two named documents were plain
 * text — not clickable. App Store + Play Store review both expect the
 * legal documents to be accessible from the signup flow itself; a
 * disclaimer line that ISN'T a link is a known reason for "missing
 * required information" rejections.
 *
 * Linking out to /terms or /privacy would work, but on a phone-sized
 * viewport that would also wipe whatever the user has typed into the
 * signup form (email, password, full name, etc.) — a small but real
 * UX cost that pushes the conversion rate down. Rendering the legal
 * text in a modal keeps the form state intact.
 *
 * USAGE
 *   const [legalKind, setLegalKind] = useState(null);
 *   ...
 *   <span onClick={() => setLegalKind("terms")}>شروط الاستخدام</span>
 *   ...
 *   <LegalSheet kind={legalKind} onClose={() => setLegalKind(null)} />
 *
 * Pass `kind` as one of "terms" or "privacy"; pass null/undefined to
 * keep the sheet closed.
 *
 * The sheet mounts via ModalPortal (document.body) to escape the
 * framer-motion <PageTransition> transform that would otherwise
 * trap `position: fixed` and put the modal half-off-screen. See
 * ModalPortal.jsx for the full explanation of that issue.
 */

import React, { useEffect } from "react";
import { createPortal } from 'react-dom';
import { X } from "lucide-react";
import ModalPortal from "@/components/shared/ModalPortal";
import {
  TERMS_LAST_UPDATED, TERMS_SECTIONS,
  PRIVACY_LAST_UPDATED, PRIVACY_SECTIONS,
} from "@/lib/legalContent";

function formatArabicMonthYear(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat("ar-EG", { month: "long", year: "numeric" }).format(d);
  } catch {
    return iso;
  }
}

export default function LegalSheet({ kind, onClose }) {
  // Lock body scroll while the sheet is open so users dragging on the
  // overlay don't accidentally scroll the page underneath. Restore on
  // unmount AND when the sheet closes — without the cleanup the page
  // stays locked if the user reloads while a sheet was open and the
  // class persisted in some edge case.
  useEffect(() => {
    if (!kind) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [kind]);

  // Esc-to-close — desktop nicety. Mobile users dismiss with the X
  // button or the backdrop tap.
  useEffect(() => {
    if (!kind) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kind, onClose]);

  if (!kind) return null;

  const isTerms = kind === "terms";
  const title       = isTerms ? "شروط الاستخدام" : "سياسة الخصوصية";
  const lastUpdated = isTerms ? TERMS_LAST_UPDATED : PRIVACY_LAST_UPDATED;
  const sections    = isTerms ? TERMS_SECTIONS : PRIVACY_SECTIONS;

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        dir="rtl"
      >
        <div
          // Stop click-through so taps inside the sheet don't close it.
          onClick={(e) => e.stopPropagation()}
          className="bg-card w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col max-h-[85dvh] sm:max-h-[80dvh]"
        >
          {/* Sticky header with close button so the user can dismiss
              even after scrolling deep into the legal text. */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-card rounded-t-2xl">
            <div>
              <h2 className="font-bold text-lg text-foreground">{title}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                آخر تحديث: {formatArabicMonthYear(lastUpdated)}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 -m-2 rounded-lg hover:bg-muted/60 active:bg-muted text-muted-foreground"
              aria-label="إغلاق"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Scrollable content. dvh on the parent + overflow-y-auto
              here means the legal text scrolls inside the sheet, not
              the whole page — so on a small phone the user can read
              all 10+ sections without losing the close button. */}
          <div className="overflow-y-auto px-5 py-5 flex-1">
            {sections.map(s => (
              <section key={s.title} className="mb-5 last:mb-0">
                <h3 className="text-sm font-bold text-foreground mb-1.5">{s.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{s.body}</p>
              </section>
            ))}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
