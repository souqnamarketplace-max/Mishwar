import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Copy, X, Trash2, RefreshCw, CheckCircle2 } from "lucide-react";
import ModalPortal from "@/components/shared/ModalPortal";
import { getLogs, clearLogs } from "@/lib/debugLog";
import { useAuth } from "@/lib/AuthContext";

/**
 * DebugOverlay — hidden diagnostic panel triggered by tapping the
 * version number 7 times in AccountHub.
 *
 * Shows:
 *  - App version + build context
 *  - Device info (user agent, online status, viewport)
 *  - Capacitor info if running in native shell
 *  - Current route + query params
 *  - Logged-in user (id + email only — no tokens or PII beyond that)
 *  - Last 200 console log/warn/error entries captured globally
 *
 * Provides a one-tap "Copy report" button that puts everything into
 * the clipboard as plain text the user can paste into a support
 * message. The whole point is to make remote debugging tractable: the
 * user reports an issue, opens this overlay, taps Copy, and pastes the
 * dump to Souqnin.
 *
 * Privacy: nothing is auto-sent anywhere. The user has to deliberately
 * copy and share. We deliberately do NOT include auth tokens, Supabase
 * keys, or message contents — only metadata.
 */
export default function DebugOverlay({ open, onClose }) {
  const auth = useAuth();
  const user = auth?.user;
  const location = useLocation();
  const [logs, setLogs] = useState([]);
  const [capInfo, setCapInfo] = useState(null);
  const [copied, setCopied] = useState(false);

  // Refresh log snapshot when opening, and again on demand.
  const refresh = () => setLogs(getLogs().slice().reverse());

  useEffect(() => {
    if (!open) return;
    refresh();

    // Fetch native device info lazily — only when the overlay opens, so
    // we don't pay the import cost on every page load. The plugin is a
    // no-op in browser environments and returns generic web info.
    let cancelled = false;
    (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform()) {
          if (!cancelled) setCapInfo({ platform: "web", native: false });
          return;
        }
        const { Device } = await import("@capacitor/device");
        const info = await Device.getInfo();
        const id = await Device.getId();
        const battery = await Device.getBatteryInfo().catch(() => null);
        if (!cancelled) {
          setCapInfo({
            native: true,
            platform: info.platform,
            model: info.model,
            osVersion: info.osVersion,
            manufacturer: info.manufacturer,
            webViewVersion: info.webViewVersion,
            isVirtual: info.isVirtual,
            deviceId: id?.identifier,
            batteryLevel: battery?.batteryLevel,
            isCharging: battery?.isCharging,
          });
        }
      } catch (e) {
        if (!cancelled) setCapInfo({ error: String(e?.message || e) });
      }
    })();

    return () => { cancelled = true; };
  }, [open]);

  const appVersion = useMemo(
    () => import.meta.env?.VITE_APP_VERSION || "1.0.5",
    []
  );

  const buildReport = () => {
    const lines = [];
    lines.push("=== Mishwaro Debug Report ===");
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`App version: ${appVersion}`);
    lines.push("");

    lines.push("--- Route ---");
    lines.push(`Path: ${location.pathname}`);
    lines.push(`Search: ${location.search || "(none)"}`);
    lines.push(`Hash: ${location.hash || "(none)"}`);
    lines.push("");

    lines.push("--- User ---");
    if (user) {
      lines.push(`ID: ${user.id}`);
      lines.push(`Email: ${user.email || "(none)"}`);
      lines.push(`Role: ${user.role || "(unknown)"}`);
    } else {
      lines.push("(not logged in)");
    }
    lines.push("");

    lines.push("--- Device ---");
    if (capInfo?.native) {
      lines.push(`Platform: ${capInfo.platform}`);
      lines.push(`Model: ${capInfo.manufacturer || ""} ${capInfo.model || ""}`.trim());
      lines.push(`OS version: ${capInfo.osVersion}`);
      lines.push(`WebView: ${capInfo.webViewVersion || "(unknown)"}`);
      lines.push(`Virtual: ${capInfo.isVirtual ? "yes" : "no"}`);
      if (typeof capInfo.batteryLevel === "number") {
        lines.push(`Battery: ${Math.round(capInfo.batteryLevel * 100)}% ${capInfo.isCharging ? "(charging)" : ""}`);
      }
    } else {
      lines.push("Platform: web browser");
    }
    lines.push(`User agent: ${navigator.userAgent}`);
    lines.push(`Language: ${navigator.language}`);
    lines.push(`Online: ${navigator.onLine ? "yes" : "no"}`);
    lines.push(`Viewport: ${window.innerWidth}×${window.innerHeight}`);
    lines.push(`DPR: ${window.devicePixelRatio}`);
    lines.push("");

    lines.push(`--- Logs (last ${logs.length}, newest first) ---`);
    for (const entry of logs) {
      lines.push(`[${entry.ts}] [${entry.level.toUpperCase()}] ${entry.msg}`);
    }

    return lines.join("\n");
  };

  const handleCopy = async () => {
    const report = buildReport();
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can fail in some webviews — fall back to a
      // textarea so the user can still select and copy manually.
      const ta = document.createElement("textarea");
      ta.value = report;
      ta.style.position = "fixed";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); setCopied(true); setTimeout(() => setCopied(false), 2000); }
      catch { /* give up silently */ }
      finally { document.body.removeChild(ta); }
    }
  };

  if (!open) return null;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[9999] bg-black/70 flex items-end sm:items-center justify-center">
        <div
          className="bg-card w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col max-h-[90vh]"
          dir="ltr"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div>
              <h2 className="text-base font-semibold">Debug Report</h2>
              <p className="text-xs text-muted-foreground">
                Tap "Copy report" then paste in your message to support.
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-muted rounded-lg"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-4 py-3 text-xs font-mono space-y-3">
            <Section title="App">
              <Line k="version" v={appVersion} />
              <Line k="route" v={location.pathname + location.search} />
            </Section>

            <Section title="User">
              {user ? (
                <>
                  <Line k="id" v={user.id} />
                  <Line k="email" v={user.email || "(none)"} />
                </>
              ) : (
                <div className="text-muted-foreground">not logged in</div>
              )}
            </Section>

            <Section title="Device">
              {capInfo?.native ? (
                <>
                  <Line k="platform" v={capInfo.platform} />
                  <Line k="model" v={`${capInfo.manufacturer || ""} ${capInfo.model || ""}`.trim()} />
                  <Line k="os" v={capInfo.osVersion} />
                  <Line k="webview" v={capInfo.webViewVersion || "(unknown)"} />
                </>
              ) : (
                <Line k="platform" v="web browser" />
              )}
              <Line k="online" v={navigator.onLine ? "yes" : "no"} />
              <Line k="viewport" v={`${window.innerWidth}×${window.innerHeight}`} />
            </Section>

            <Section
              title={`Logs (${logs.length})`}
              right={
                <div className="flex gap-2">
                  <button
                    onClick={refresh}
                    className="text-[11px] px-2 py-1 rounded bg-muted hover:bg-muted/70 flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" /> Refresh
                  </button>
                  <button
                    onClick={() => { clearLogs(); refresh(); }}
                    className="text-[11px] px-2 py-1 rounded bg-muted hover:bg-muted/70 flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" /> Clear
                  </button>
                </div>
              }
            >
              {logs.length === 0 ? (
                <div className="text-muted-foreground">no logs captured</div>
              ) : (
                <div className="space-y-1">
                  {logs.map((entry, i) => (
                    <div key={i} className={levelClass(entry.level)}>
                      <span className="opacity-60">{entry.ts.slice(11, 19)}</span>
                      {" "}
                      <span className="font-semibold uppercase">[{entry.level}]</span>
                      {" "}
                      <span className="whitespace-pre-wrap break-words">{entry.msg}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-border">
            <button
              onClick={handleCopy}
              className="w-full bg-primary text-primary-foreground py-3 rounded-xl font-medium flex items-center justify-center gap-2"
            >
              {copied ? (
                <>
                  <CheckCircle2 className="w-4 h-4" /> Copied — paste it in your message
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" /> Copy report
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

function Section({ title, right, children }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
          {title}
        </h3>
        {right}
      </div>
      <div className="bg-muted/40 rounded-lg p-2 space-y-0.5">
        {children}
      </div>
    </div>
  );
}

function Line({ k, v }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground shrink-0">{k}:</span>
      <span className="break-all">{v}</span>
    </div>
  );
}

function levelClass(level) {
  if (level === "error") return "text-red-500";
  if (level === "warn") return "text-amber-500";
  if (level === "info") return "text-blue-500";
  return "text-foreground";
}
