import React, { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";

/**
 * Pull-to-refresh wrapper.
 * Mobile-only: detects touch drag down from the top, shows a spinner,
 * and on release (past the threshold) re-fetches all React Query data.
 *
 * Works on:
 *  - Mobile browsers (Chrome Android, Safari iOS)
 *  - WebViews when packaged as native app (Capacitor / Cordova / TWA)
 *
 * Desktop and non-touch devices: completely inert (zero overhead).
 */
const TRIGGER_DISTANCE = 80;
const MAX_PULL = 140;
const RESISTANCE = 0.5;
const SPINNER_SIZE = 36;

export default function PullToRefresh({ children, onRefresh }) {
  const qc = useQueryClient();
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startYRef = useRef(0);
  const isTrackingRef = useRef(false);

  const [isTouch, setIsTouch] = useState(false);
  useEffect(() => {
    setIsTouch("ontouchstart" in window || navigator.maxTouchPoints > 0);
  }, []);

  useEffect(() => {
    if (!isTouch) return;

    const handleTouchStart = (e) => {
      if (window.scrollY > 0) return;
      if (e.touches.length !== 1) return;
      startYRef.current = e.touches[0].clientY;
      isTrackingRef.current = true;
    };

    const handleTouchMove = (e) => {
      if (!isTrackingRef.current || refreshing) return;
      const currentY = e.touches[0].clientY;
      const delta = currentY - startYRef.current;
      if (delta <= 0) { setPullDistance(0); return; }
      const resisted = Math.min(delta * RESISTANCE, MAX_PULL);
      setPullDistance(resisted);
      if (delta > 5) e.preventDefault();
    };

    const handleTouchEnd = async () => {
      if (!isTrackingRef.current) return;
      isTrackingRef.current = false;
      if (pullDistance >= TRIGGER_DISTANCE && !refreshing) {
        setRefreshing(true);
        try {
          if (onRefresh) await onRefresh();
          else { await qc.invalidateQueries(); await new Promise((r) => setTimeout(r, 600)); }
        } finally { setRefreshing(false); }
      }
      setPullDistance(0);
    };

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    window.addEventListener("touchcancel", handleTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [isTouch, pullDistance, refreshing, qc, onRefresh]);

  const progress = Math.min(pullDistance / TRIGGER_DISTANCE, 1);
  const showIndicator = isTouch && (pullDistance > 0 || refreshing);

  return (
    <>
      {showIndicator && (
        <div className="fixed left-0 right-0 z-[100] flex items-start justify-center pointer-events-none"
             style={{ top: 0, transform: `translateY(${refreshing ? 16 : Math.max(pullDistance - SPINNER_SIZE, 0)}px)`, transition: refreshing ? "transform 200ms ease-out" : "none" }}>
          <div className="bg-card border border-border rounded-full shadow-lg flex items-center justify-center"
               style={{ width: SPINNER_SIZE, height: SPINNER_SIZE, opacity: refreshing ? 1 : progress }}>
            <RefreshCw className={`text-primary ${refreshing ? "animate-spin" : ""}`}
              style={{ width: SPINNER_SIZE * 0.55, height: SPINNER_SIZE * 0.55,
                       transform: refreshing ? "none" : `rotate(${progress * 270}deg)`,
                       transition: refreshing ? "none" : "transform 50ms linear" }}/>
          </div>
        </div>
      )}
      <div style={{ transform: pullDistance > 0 && !refreshing ? `translateY(${pullDistance * 0.4}px)` : "translateY(0)",
                    transition: pullDistance > 0 ? "none" : "transform 200ms ease-out" }}>
        {children}
      </div>
    </>
  );
}
