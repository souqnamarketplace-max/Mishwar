import React, { useState, useEffect } from "react";
import { X } from "lucide-react";

/**
 * AppInstallBanner
 *
 * Shows a bottom-sheet banner prompting mobile browser users to download
 * the native app. Detects the platform and links to the correct store.
 *
 * Rules:
 * - Only shows on mobile browsers (not in the Capacitor native app shell)
 * - Only shows on iOS or Android
 * - Dismissed state persists in localStorage for 14 days
 * - Never shows if the user is already in standalone/PWA mode
 * - Delays 3 seconds after page load so it doesn't interrupt first impression
 */

const IOS_APP_URL    = "https://apps.apple.com/app/id6768105898";
const ANDROID_APP_URL = "https://play.google.com/store/apps/details?id=com.mishwaro.app";
const DISMISS_KEY    = "mishwaro_app_banner_dismissed";
const DISMISS_DAYS   = 14;

function getStoredDismissal() {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const { ts } = JSON.parse(raw);
    const expired = Date.now() - ts > DISMISS_DAYS * 86_400_000;
    if (expired) localStorage.removeItem(DISMISS_KEY);
    return !expired;
  } catch {
    return false;
  }
}

function dismiss() {
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify({ ts: Date.now() })); } catch {}
}

export default function AppInstallBanner() {
  const [visible, setVisible] = useState(false);
  const [platform, setPlatform] = useState(null); // "ios" | "android"

  useEffect(() => {
    // Already in native app (Capacitor) — never show
    if (window.Capacitor?.isNativePlatform?.()) return;
    // Already installed as PWA/standalone
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    // Already dismissed recently
    if (getStoredDismissal()) return;

    const ua = navigator.userAgent || "";
    const isIOS     = /iPhone|iPad|iPod/i.test(ua) && !/CriOS|FxiOS/i.test(ua);
    // Show on Android Chrome/WebView — exclude desktop Chrome
    const isAndroid = /Android/i.test(ua) && /Mobile/i.test(ua);

    if (!isIOS && !isAndroid) return;

    setPlatform(isIOS ? "ios" : "android");

    // Delay so the user sees the page first
    const t = setTimeout(() => setVisible(true), 3000);
    return () => clearTimeout(t);
  }, []);

  if (!visible || !platform) return null;

  const storeUrl  = platform === "ios" ? IOS_APP_URL : ANDROID_APP_URL;
  const storeLabel = platform === "ios"
    ? "App Store"
    : "Google Play";
  const storeIcon = platform === "ios" ? "🍎" : "▶";

  const handleDismiss = () => {
    dismiss();
    setVisible(false);
  };

  return (
    <div
      dir="rtl"
      className="fixed bottom-0 inset-x-0 z-[200] safe-bottom"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {/* Backdrop tap to dismiss */}
      <div className="absolute inset-x-0 bottom-full h-8" onClick={handleDismiss} />

      <div className="mx-3 mb-3 bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        {/* Green accent bar */}
        <div className="h-1 w-full bg-gradient-to-l from-primary to-accent" />

        <div className="p-4 flex items-center gap-3">
          {/* App icon */}
          <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center shrink-0 shadow-md">
            <span className="text-primary-foreground font-black text-2xl">م</span>
          </div>

          {/* Text */}
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm text-foreground leading-tight">
              حمّل تطبيق مشوارو
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-tight">
              تجربة أسرع وإشعارات فورية عبر {storeLabel}
            </p>
            {/* Stars */}
            <div className="flex items-center gap-0.5 mt-1">
              {[1,2,3,4,5].map(i => (
                <span key={i} className="text-yellow-400 text-[10px]">★</span>
              ))}
              <span className="text-[10px] text-muted-foreground mr-1">مجاني</span>
            </div>
          </div>

          {/* CTA */}
          <div className="flex flex-col items-center gap-2 shrink-0">
            <a
              href={storeUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleDismiss}
              className="bg-primary text-primary-foreground text-xs font-bold px-4 py-2 rounded-xl shadow hover:bg-primary/90 active:scale-95 transition-all whitespace-nowrap"
            >
              {storeIcon} تحميل
            </a>
            <button
              onClick={handleDismiss}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              لاحقاً
            </button>
          </div>

          {/* Close */}
          <button
            onClick={handleDismiss}
            className="absolute top-3 left-3 w-6 h-6 flex items-center justify-center rounded-full bg-muted hover:bg-muted/80"
            aria-label="إغلاق"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>
    </div>
  );
}
