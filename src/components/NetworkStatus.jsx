/**
 * NetworkStatus — shows a banner when the user goes offline,
 * and auto-refreshes queries when they come back online.
 */
import React, { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { WifiOff, Wifi } from "lucide-react";

export default function NetworkStatus() {
  const [offline, setOffline] = useState(!navigator.onLine);
  const [wasOffline, setWasOffline] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    const goOffline = () => { setOffline(true); setWasOffline(true); };
    const goOnline  = () => {
      setOffline(false);
      // Refetch stale queries after reconnect
      setTimeout(() => qc.refetchQueries({ type: "active" }), 500);
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online",  goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online",  goOnline);
    };
  }, [qc]);

  if (!offline && !wasOffline) return null;

  return (
    <div className={`fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center gap-2 py-2 text-sm font-medium transition-all ${
      offline
        ? "bg-destructive text-white"
        : "bg-green-500 text-white"
    }`} style={{ paddingTop: `calc(env(safe-area-inset-top) + 8px)` }}>
      {offline
        ? <><WifiOff className="w-4 h-4" /> لا يوجد اتصال بالإنترنت</>
        : <><Wifi className="w-4 h-4" /> تم استعادة الاتصال ✓</>
      }
    </div>
  );
}
