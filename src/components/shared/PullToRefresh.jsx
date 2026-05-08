import React, { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";

/**
 * Pull-to-refresh wrapper.
 *
 * Mobile-only: detects a touch drag-down from the very top of the scroll
 * container, shows a spinner, and on release past the trigger threshold
 * re-fetches every React Query cache (or fires a custom onRefresh).
 *
 * Why we listen on the wrapper element, not window:
 * MobileLayout wraps the entire app in `fixed inset-0` and the actual
 * scroll container is an inner `<main className="overflow-y-auto">`.
 * Window `scrollY` is therefore *always* 0, and `touchmove` events that
 * bubble to window are already past the inner scroller's chance to scroll —
 * meaning the previous implementation's `e.preventDefault()` arrived too
 * late to stop the inner scroll, and the gesture felt like nothing.
 *
 * The new approach attaches the listeners to the wrapper ref. On touchstart
 * we walk up the DOM from the target until we find an element whose
 * computed style is overflow-y: auto/scroll AND whose scrollTop is 0 —
 * that's the user's actual scroll container at this moment, the only place
 * where pull-to-refresh makes sense. If they're scrolled down anywhere in
 * the chain, we don't track. This handles MobileLayout's `<main>`, the
 * AccountHub side panel's inner scroller, and the desktop window-scroll
 * case (we also fall back to documentElement when nothing else matches).
 */

const TRIGGER_DISTANCE = 80;       // px to pull before refresh fires
const MAX_PULL = 140;              // visual cap — feels like resistance
const RESISTANCE = 0.5;            // multiplier on the raw drag delta
const SPINNER_SIZE = 36;

// True if the element is itself scrollable in the y-axis. We allow auto/scroll
// only — overlay/visible/hidden don't qualify.
function isYScrollable(el) {
  if (!el || el.nodeType !== 1) return false;
  const style = getComputedStyle(el);
  const oy = style.overflowY;
  return (oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight;
}

// Walk up from `start` to find the nearest y-scrollable ancestor.
// Returns the document scrolling element as a final fallback.
function findScrollContainer(start) {
  let el = start;
  while (el && el !== document.body) {
    if (isYScrollable(el)) return el;
    el = el.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

export default function PullToRefresh({ children, onRefresh }) {
  const qc = useQueryClient();
  // Visual state (drives the spinner + content offset) — updated from
  // refs in a rAF loop. Don't read these inside the touch handlers.
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const wrapperRef = useRef(null);
  // ALL gesture state lives in refs — never read closure-captured state
  // inside the touch handlers. Avoids the React-batching race where
  // touchend could read a stale pullDistance and miss a refresh.
  const startYRef        = useRef(0);
  const isTrackingRef    = useRef(false);
  const scrollerRef      = useRef(null);
  const pullDistanceRef  = useRef(0);
  const refreshingRef    = useRef(false);
  // Stable refs for the user-supplied callbacks so listeners don't
  // remount when the parent passes a new function each render.
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => { onRefreshRef.current = onRefresh; }, [onRefresh]);
  const qcRef = useRef(qc);
  useEffect(() => { qcRef.current = qc; }, [qc]);

  const [isTouch, setIsTouch] = useState(false);
  useEffect(() => {
    setIsTouch("ontouchstart" in window || navigator.maxTouchPoints > 0);
  }, []);

  useEffect(() => {
    if (!isTouch) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const handleTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      // If a refresh is already running, ignore new gestures.
      if (refreshingRef.current) return;
      // Find the actual scroll container at the touch point. If it's
      // not at the top, the user is mid-scroll; don't hijack.
      const scroller = findScrollContainer(e.target);
      if (!scroller || scroller.scrollTop > 0) return;
      scrollerRef.current = scroller;
      startYRef.current = e.touches[0].clientY;
      isTrackingRef.current = true;
      pullDistanceRef.current = 0;
    };

    const handleTouchMove = (e) => {
      if (!isTrackingRef.current || refreshingRef.current) return;
      // If the scroller has moved off the top during this gesture
      // (e.g. a momentum scroll started), bail.
      const scroller = scrollerRef.current;
      if (scroller && scroller.scrollTop > 0) {
        isTrackingRef.current = false;
        pullDistanceRef.current = 0;
        setPullDistance(0);
        return;
      }
      const currentY = e.touches[0].clientY;
      const delta = currentY - startYRef.current;
      if (delta <= 0) {
        if (pullDistanceRef.current !== 0) {
          pullDistanceRef.current = 0;
          setPullDistance(0);
        }
        return;
      }
      const resisted = Math.min(delta * RESISTANCE, MAX_PULL);
      pullDistanceRef.current = resisted;
      setPullDistance(resisted);
      // Stop the inner scroller from rubber-banding while we own the
      // gesture. Listener uses passive:false (below) so this works.
      if (delta > 5) e.preventDefault();
    };

    const handleTouchEnd = async () => {
      if (!isTrackingRef.current) return;
      isTrackingRef.current = false;
      // Read from REF, not closure-captured state. The previous
      // implementation read `pullDistance` which could be stale due to
      // React batching, causing touchend to miss a refresh that should
      // have fired (or fire one that shouldn't have).
      const distance = pullDistanceRef.current;

      if (distance >= TRIGGER_DISTANCE && !refreshingRef.current) {
        refreshingRef.current = true;
        setRefreshing(true);
        try {
          if (onRefreshRef.current) {
            await onRefreshRef.current();
          } else {
            await qcRef.current.invalidateQueries();
            // Hold the spinner briefly so the action feels intentional.
            await new Promise((r) => setTimeout(r, 600));
          }
        } finally {
          refreshingRef.current = false;
          setRefreshing(false);
        }
      }
      pullDistanceRef.current = 0;
      setPullDistance(0);
    };

    // Attach to the WRAPPER, not window. Listeners are STABLE across
    // the gesture's lifetime — the dep array is just [isTouch] now,
    // not the previous [isTouch, pullDistance, refreshing, qc, onRefresh]
    // which caused listener churn at ~60fps during a pull and missed events.
    wrapper.addEventListener("touchstart", handleTouchStart, { passive: true });
    wrapper.addEventListener("touchmove", handleTouchMove, { passive: false });
    wrapper.addEventListener("touchend", handleTouchEnd, { passive: true });
    wrapper.addEventListener("touchcancel", handleTouchEnd, { passive: true });

    return () => {
      wrapper.removeEventListener("touchstart", handleTouchStart);
      wrapper.removeEventListener("touchmove", handleTouchMove);
      wrapper.removeEventListener("touchend", handleTouchEnd);
      wrapper.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [isTouch]);  // ← stable dep array; refs handle the rest

  const progress = Math.min(pullDistance / TRIGGER_DISTANCE, 1);
  const showIndicator = isTouch && (pullDistance > 0 || refreshing);

  return (
    <div ref={wrapperRef} className="relative">
      {showIndicator && (
        <div
          className="fixed left-0 right-0 z-[100] flex items-start justify-center pointer-events-none"
          style={{
            top: 0,
            transform: `translateY(${refreshing ? 16 : Math.max(pullDistance - SPINNER_SIZE, 0)}px)`,
            transition: refreshing ? "transform 200ms ease-out" : "none",
          }}
        >
          <div
            className="bg-card border border-border rounded-full shadow-lg flex items-center justify-center"
            style={{
              width: SPINNER_SIZE,
              height: SPINNER_SIZE,
              opacity: refreshing ? 1 : progress,
            }}
          >
            <RefreshCw
              className={`text-primary ${refreshing ? "animate-spin" : ""}`}
              style={{
                width: SPINNER_SIZE * 0.55,
                height: SPINNER_SIZE * 0.55,
                transform: refreshing ? "none" : `rotate(${progress * 270}deg)`,
                transition: refreshing ? "none" : "transform 50ms linear",
              }}
            />
          </div>
        </div>
      )}

      {/* Visually drag the content with the pull so the gesture feels physical */}
      <div
        style={{
          transform: pullDistance > 0 && !refreshing ? `translateY(${pullDistance * 0.4}px)` : "translateY(0)",
          transition: pullDistance > 0 ? "none" : "transform 200ms ease-out",
        }}
      >
        {children}
      </div>
    </div>
  );
}
