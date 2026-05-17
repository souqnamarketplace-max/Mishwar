// ════════════════════════════════════════════════════════════════════════
// useConfirm — promise-based async confirmation dialog
// ════════════════════════════════════════════════════════════════════════
//
// Replacement for window.confirm() which is forbidden in App Store and
// Play Store reviews (Apple HIG 4.0, Google Play Quality guidelines)
// because native browser confirms break the visual consistency of the
// app and can render differently or not at all inside WKWebView /
// Android System WebView (Capacitor).
//
// USAGE
// In a component:
//
//   const { confirm, dialog } = useConfirm();
//
//   async function handleDelete() {
//     const ok = await confirm({
//       title: "حذف المدينة",
//       message: 'هل أنت متأكد من حذف "رام الله"؟ لا يمكن التراجع.',
//       confirmLabel: "حذف",
//       destructive: true,
//     });
//     if (ok) deleteMutation.mutate(cityId);
//   }
//
//   return (
//     <>
//       <button onClick={handleDelete}>حذف</button>
//       {dialog}
//     </>
//   );
//
// WHY THE { confirm, dialog } TUPLE
// React doesn't allow rendering JSX from outside the component tree
// without a Portal + Provider. The hook returns both:
//   - confirm(): the imperative async function callers invoke
//   - dialog:    the JSX the component must render somewhere so the
//                modal mounts when triggered
//
// Keep `{dialog}` near the end of your component's JSX. It conditionally
// mounts (renders null when no confirmation is active) so it costs
// nothing when idle.
//
// ACCESSIBILITY
// Backed by @radix-ui/react-alert-dialog. Out of the box:
//   - Proper role="alertdialog" + aria-labelledby + aria-describedby
//   - Focus trapped within the dialog while open
//   - Escape key dismisses (treated as cancel)
//   - Click outside dismisses (treated as cancel)
//   - Returns focus to the trigger on close
//
// RTL
// AlertDialogContent receives dir="rtl" automatically so the Arabic
// title/message renders correctly. Cancel + confirm buttons are
// ordered to match RTL conventions (confirm on the left, cancel on
// the right — opposite of LTR).
//
// LIFECYCLE
// One concurrent confirm per hook instance. If the caller invokes
// confirm() while one is already open, the second call's promise
// REJECTS — preventing accidental "double confirm" UIs from sneaking
// in. In practice this never happens because callers await the first.
// ════════════════════════════════════════════════════════════════════════

import React, { useState, useRef, useCallback } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function useConfirm() {
  const [config, setConfig] = useState(null);
  const resolverRef = useRef(null);

  const confirm = useCallback((opts) => {
    return new Promise((resolve, reject) => {
      if (resolverRef.current) {
        // Already showing a different confirm. Reject so the caller
        // knows their call was no-op'd. Practically unreachable since
        // callers await the previous promise before calling again.
        reject(new Error("useConfirm: a confirmation is already in flight"));
        return;
      }
      resolverRef.current = resolve;
      setConfig({
        title:        opts?.title        || "تأكيد",
        message:      opts?.message      || "",
        confirmLabel: opts?.confirmLabel || "تأكيد",
        cancelLabel:  opts?.cancelLabel  || "إلغاء",
        destructive:  opts?.destructive  || false,
      });
    });
  }, []);

  const handleClose = useCallback((result) => {
    if (resolverRef.current) {
      resolverRef.current(result);
      resolverRef.current = null;
    }
    setConfig(null);
  }, []);

  const dialog = config ? (
    <AlertDialog
      open
      onOpenChange={(open) => { if (!open) handleClose(false); }}
    >
      <AlertDialogContent dir="rtl">
        <AlertDialogHeader>
          <AlertDialogTitle>{config.title}</AlertDialogTitle>
          {config.message && (
            <AlertDialogDescription className="leading-relaxed">
              {config.message}
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => handleClose(false)}>
            {config.cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => handleClose(true)}
            className={
              config.destructive
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : ""
            }
          >
            {config.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ) : null;

  return { confirm, dialog };
}
