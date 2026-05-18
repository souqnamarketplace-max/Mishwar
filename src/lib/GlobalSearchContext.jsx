import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import GlobalSearch from "@/components/shared/GlobalSearch";

/**
 * GlobalSearchProvider — wraps the app with a single GlobalSearch
 * instance that any component can open via the useGlobalSearch hook.
 *
 * Why a context + provider:
 *   - The search modal needs ONE instance for the whole app (multiple
 *     open simultaneously would be a UX disaster)
 *   - Cmd-K shortcut needs to be a single listener (not duplicated
 *     per-component) to avoid race conditions where two listeners
 *     both fire and one closes what the other opened
 *   - Trigger buttons (search icon in Navbar, '/search' shortcut on
 *     mobile bottom bar, etc.) all need the SAME open() function
 *
 * Pattern: mount once at the top of App.jsx, then any descendent
 * can do `const { open } = useGlobalSearch(); <button onClick={open}>`.
 */

const GlobalSearchCtx = createContext({ open: () => {}, close: () => {}, isOpen: false });

export function GlobalSearchProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  // ─── Global keyboard shortcut: Cmd-K / Ctrl-K ───────────────────
  //
  // Matches the de facto standard set by Slack, Linear, VS Code,
  // Notion, etc. Mac users press Cmd-K, Windows/Linux users press
  // Ctrl-K — both should open the search.
  //
  // We listen on `window` (not document) because some inputs swallow
  // keydown events at the document level. Capturing at window catches
  // them regardless of focus.
  //
  // We DO NOT preventDefault unless the modifier+key combo matches
  // exactly — we want Cmd-K specifically, not 'K' alone (would
  // hijack typing) or Cmd-Shift-K (which is a Chrome shortcut for
  // 'Show developer tools console'). Conservative matching only.
  //
  // We also handle '/' as a shortcut when no input is focused
  // (matches GitHub, Twitter, YouTube). Without the focus check,
  // typing '/' in any text field would open the search.
  useEffect(() => {
    const onKey = (e) => {
      // Cmd-K (Mac) or Ctrl-K (Win/Linux). Skip if other modifiers
      // present so we don't conflict with Cmd-Shift-K (DevTools)
      // or Ctrl-Alt-K (window manager).
      const isCmdK =
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === "k";
      if (isCmdK) {
        e.preventDefault();
        setIsOpen(true);
        return;
      }
      // '/' shortcut — only when not typing in a form field
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target?.tagName || "").toUpperCase();
        const isEditable =
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          e.target?.isContentEditable;
        if (!isEditable) {
          e.preventDefault();
          setIsOpen(true);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <GlobalSearchCtx.Provider value={{ open, close, isOpen }}>
      {children}
      <GlobalSearch isOpen={isOpen} onClose={close} />
    </GlobalSearchCtx.Provider>
  );
}

/** Hook to open/close the global search from any component. */
export function useGlobalSearch() {
  return useContext(GlobalSearchCtx);
}
