/**
 * ModalPortal — mount a modal at document.body so its `position: fixed`
 * stays anchored to the viewport.
 *
 * WHY THIS EXISTS
 * On mobile, AppLayout.jsx wraps every page in <PageTransition>, which is
 * a framer-motion motion.div that applies CSS transforms during route
 * transitions. The CSS spec (https://www.w3.org/TR/css-transforms-1/)
 * makes a transformed element the containing block for any descendant
 * `position: fixed`. That means an overlay declared with
 *   <div className="fixed inset-0">...</div>
 * inside a page does NOT anchor to the viewport — it anchors to the
 * PageTransition div. When the user has scrolled, the overlay renders
 * relative to the scrolled position, which on tall pages puts it below
 * the fold. Users see what looks like a "modal at the bottom of the
 * page that you have to scroll to find".
 *
 * createPortal mounts the children at a target DOM node — here,
 * document.body — that's a direct child of <html>. No transformed
 * ancestor in between → fixed positioning works as authors expect.
 *
 * USAGE
 *   <ModalPortal>
 *     <div className="fixed inset-0 z-[9999] flex items-center justify-center">
 *       <div className="bg-card rounded-2xl p-6">...</div>
 *     </div>
 *   </ModalPortal>
 *
 * SSR SAFETY
 * We guard against document being undefined so prerendering / Vite SSG
 * passes don't crash. When document is unavailable we just render
 * nothing — the modal will mount client-side on hydration.
 */

import { createPortal } from "react-dom";

export default function ModalPortal({ children }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
