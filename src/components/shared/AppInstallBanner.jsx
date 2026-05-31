import React, { useState, useEffect, useRef } from "react";
import { X, Download } from "lucide-react";

/**
 * AppInstallBanner — multi-layer mobile app discovery
 *
 * Layer 1 (Android Chrome): captures the browser's native beforeinstallprompt
 *   event and shows a custom trigger. When the user taps "تحميل", Chrome shows
 *   the OS-level "Add to Home Screen" sheet immediately.
 *
 * Layer 2 (All mobile browsers): bottom-sheet banner linking to the correct
 *   app store — App Store for iOS, Google Play for Android.
 *
 * Layer 3 (Nav chip): a small persistent "📲 تحميل التطبيق" chip in the
 *   mobile nav so users who dismiss the banner still have a way back.
 *
 * Rules:
 * - Never shows inside Capacitor native shell
 * - Never shows in standalone/PWA mode
 * - Banner respects 14-day dismiss, nav chip is always visible on mobile
 * - iOS Chrome (CriOS) is treated same as iOS Safari — links to App Store
 */

const IOS_APP_URL     = "https://apps.apple.com/dz/app/mishwaro-%D9%85%D8%B4%D9%88%D8%A7%D8%B1%D9%88/id6768105898";
const ANDROID_APP_URL = "https://play.google.com/store/apps/details?id=com.mishwaro.app";
const DISMISS_KEY     = "mishwaro_app_banner_v2";
const DISMISS_DAYS    = 7; // reduced to 7 — more chances to convert

function isDismissed() {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const { ts } = JSON.parse(raw);
    const expired = Date.now() - ts > DISMISS_DAYS * 86_400_000;
    if (expired) localStorage.removeItem(DISMISS_KEY);
    return !expired;
  } catch { return false; }
}

function saveDismissal() {
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify({ ts: Date.now() })); } catch {}
}

function detectPlatform(ua) {
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua) && /Mobile/i.test(ua)) return "android";
  return null;
}

export default function AppInstallBanner() {
  const [visible, setVisible] = useState(false);
  const [platform, setPlatform] = useState(null);
  const [pwaPrompt, setPwaPrompt] = useState(null); // Android Chrome native prompt
  const pwaPromptRef = useRef(null);

  useEffect(() => {
    // Never show inside Capacitor or PWA standalone mode
    if (window.Capacitor?.isNativePlatform?.()) return;
    if (window.matchMedia("(display-mode: standalone)").matches) return;

    const ua = navigator.userAgent || "";
    const plat = detectPlatform(ua);
    if (!plat) return;
    setPlatform(plat);

    // Capture Android Chrome native install prompt
    const handlePrompt = (e) => {
      e.preventDefault();
      pwaPromptRef.current = e;
      setPwaPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handlePrompt);

    // Show banner after 2.5s if not dismissed
    if (!isDismissed()) {
      const t = setTimeout(() => setVisible(true), 2500);
      return () => {
        window.removeEventListener("beforeinstallprompt", handlePrompt);
        clearTimeout(t);
      };
    }

    return () => window.removeEventListener("beforeinstallprompt", handlePrompt);
  }, []);

  const handleDismiss = () => {
    saveDismissal();
    setVisible(false);
  };

  const handleDownload = async () => {
    // Android Chrome: trigger native OS install sheet
    if (pwaPromptRef.current) {
      pwaPromptRef.current.prompt();
      const { outcome } = await pwaPromptRef.current.userChoice;
      if (outcome === "accepted") {
        setVisible(false);
        return;
      }
    }
    // Fallback: open the store URL
    window.open(
      platform === "ios" ? IOS_APP_URL : ANDROID_APP_URL,
      "_blank",
      "noopener,noreferrer"
    );
    handleDismiss();
  };

  if (!platform) return null;

  const storeLabel = platform === "ios" ? "App Store" : "Google Play";
  const storeIcon  = platform === "ios" ? "🍎" : "▶";

  return (
    <>
      {/* ── Bottom-sheet banner ──────────────────────────────── */}
      {visible && (
        <div
          dir="rtl"
          role="dialog"
          aria-label="تنزيل تطبيق مشوارو"
          className="fixed bottom-0 inset-x-0 z-[200]"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        >
          {/* Tap-outside to dismiss */}
          <div
            className="fixed inset-0 bg-black/20 backdrop-blur-[1px]"
            onClick={handleDismiss}
          />

          <div className="relative mx-3 mb-3 bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
            {/* Accent bar */}
            <div className="h-1 w-full bg-gradient-to-l from-primary to-accent" />

            <div className="p-4 flex items-center gap-3">
              {/* App icon */}
              <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center shrink-0 shadow-lg">
                <span className="text-primary-foreground font-black text-2xl select-none">م</span>
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm text-foreground leading-snug">مشوارو — تطبيق السفر الفلسطيني</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  إشعارات فورية • أسرع • متوفر على {storeLabel}
                </p>
                <div className="flex items-center gap-0.5 mt-1">
                  {[1,2,3,4,5].map(i => (
                    <span key={i} className="text-yellow-400 text-[10px]">★</span>
                  ))}
                  <span className="text-[10px] text-muted-foreground mr-1">مجاني</span>
                </div>
              </div>

              {/* CTA */}
              <div className="flex flex-col items-center gap-1.5 shrink-0">
                <button
                  onClick={handleDownload}
                  className="bg-primary text-primary-foreground text-xs font-bold px-4 py-2 rounded-xl shadow-lg active:scale-95 transition-all whitespace-nowrap"
                >
                  {storeIcon} تحميل
                </button>
                <button
                  onClick={handleDismiss}
                  className="text-[10px] text-muted-foreground"
                >
                  لاحقاً
                </button>
              </div>
            </div>

            {/* Close button */}
            <button
              onClick={handleDismiss}
              className="absolute top-3 left-3 w-6 h-6 flex items-center justify-center rounded-full bg-muted"
              aria-label="إغلاق"
            >
              <X className="w-3 h-3 text-muted-foreground" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * MobileAppChip — small persistent chip shown in mobile nav.
 * Always visible on mobile (doesn't respect the dismiss state).
 * Gives users a second chance after dismissing the banner.
 */
export function MobileAppChip() {
  const [platform, setPlatform] = useState(null);
  const [pwaPrompt, setPwaPrompt] = useState(null);

  useEffect(() => {
    if (window.Capacitor?.isNativePlatform?.()) return;
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    const ua = navigator.userAgent || "";
    const plat = detectPlatform(ua);
    if (plat) setPlatform(plat);

    const handler = (e) => { e.preventDefault(); setPwaPrompt(e); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!platform) return null;

  const handleTap = async () => {
    if (pwaPrompt) {
      pwaPrompt.prompt();
      return;
    }
    window.open(
      platform === "ios" ? IOS_APP_URL : ANDROID_APP_URL,
      "_blank",
      "noopener,noreferrer"
    );
  };

  return (
    <button
      onClick={handleTap}
      className="sm:hidden flex items-center px-3.5 py-1.5 rounded-full border border-border bg-background text-foreground text-[13px] font-medium shadow-sm active:scale-95 transition-transform whitespace-nowrap"
      aria-label="تحميل تطبيق مشوارو"
    >
      احصل على التطبيق
    </button>
  );
}
