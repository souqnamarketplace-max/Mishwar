// ════════════════════════════════════════════════════════════════════════
// Edge Function: send-push-notification
// ════════════════════════════════════════════════════════════════════════
//
// Receives a request from the Postgres trigger on notifications-INSERT.
// Looks up the user's device_tokens, sends a push via FCM HTTP v1 to
// each one. Cleans up stale tokens (INVALID_ARGUMENT / UNREGISTERED).
//
// REQUEST SHAPE
//   POST /functions/v1/send-push-notification
//   Headers: Authorization: Bearer <SERVICE_ROLE_KEY>
//   Body:    {
//     user_email: string,
//     title: string,
//     body: string,
//     data?: { [key: string]: string }  // becomes "data" payload — small strings only
//   }
//
// RESPONSE SHAPE
//   200 OK { sent: number, failed: number, removed_tokens: number }
//   4xx/5xx { error: string }
//
// AUTHENTICATION
//   The function itself is invoked by the Postgres trigger using the
//   project's service_role key (configured automatically by Supabase).
//   The function then mints its own short-lived OAuth2 access token
//   from the Firebase Admin service account JSON to call FCM.
//
// ENV
//   FIREBASE_SERVICE_ACCOUNT — JSON string of the service account key
//   SUPABASE_URL              — set automatically by Supabase
//   SUPABASE_SERVICE_ROLE_KEY — set automatically by Supabase
//
// NOTES ON ERROR HANDLING
//   FCM returns several error codes. The ones we care about:
//     - UNREGISTERED   — user uninstalled the app, delete the token
//     - INVALID_ARGUMENT — usually a malformed token, delete it
//     - SENDER_ID_MISMATCH — token belongs to a different Firebase project,
//                            delete it (shouldn't happen with one project,
//                            but defensive cleanup)
//     - QUOTA_EXCEEDED  — rare, don't delete the token; the next push
//                         will work
//     - UNAVAILABLE     — transient, retry later (we don't retry here;
//                         next push attempt will work)
// ════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.1/mod.ts";

// CORS headers for the rare case someone invokes this from a browser
// (we don't — only the trigger does — but keep it consistent with
// Supabase's standard).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface PushRequest {
  user_email: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

interface ServiceAccount {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  // ...other fields exist but we only need these
}

// ─── FCM OAuth2 access token ───────────────────────────────────────
// FCM HTTP v1 requires an OAuth2 Bearer token, NOT the legacy server
// key. The standard pattern is: sign a JWT with the service account
// private key, claim the FCM scope, exchange it for an access token
// at Google's OAuth endpoint, cache for 50 minutes (tokens last 60).
//
// We cache in module scope since each Edge Function invocation runs
// in a fresh Deno isolate, but Supabase reuses isolates across many
// invocations when warm — the cache survives across maybe ~100 calls
// on a hot function.
let cachedAccessToken: { token: string; expiresAt: number } | null = null;

async function getFcmAccessToken(sa: ServiceAccount): Promise<string> {
  if (cachedAccessToken && Date.now() < cachedAccessToken.expiresAt) {
    return cachedAccessToken.token;
  }

  // Build a JWT signed with the service account's private key.
  // RS256 = RSA with SHA-256. Standard for Google's OAuth2 service-
  // account flow.
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  // djwt expects the private key as a CryptoKey. The service account
  // JSON has it as a PEM string with \n escapes. Convert PEM → DER →
  // CryptoKey.
  const pemContents = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\n/g, "")
    .replace(/\\n/g, "")
    .trim();
  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const jwt = await create({ alg: "RS256", typ: "JWT" }, payload, cryptoKey);

  // Exchange the JWT for an access token.
  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!tokenResp.ok) {
    const errText = await tokenResp.text();
    throw new Error(`OAuth token exchange failed: ${tokenResp.status} ${errText}`);
  }

  const tokenData = await tokenResp.json();
  cachedAccessToken = {
    token: tokenData.access_token,
    // Refresh 10 minutes before expiry to avoid edge cases on slow networks
    expiresAt: Date.now() + (tokenData.expires_in - 600) * 1000,
  };
  return cachedAccessToken.token;
}

// ─── FCM send ──────────────────────────────────────────────────────
// HTTP v1 endpoint: POST projects/<project_id>/messages:send
// Body shape:
//   { message: { token, notification: { title, body }, data, apns, android } }
//
// We populate both apns and android sections so iOS gets the right
// alert payload and Android gets a high-priority data message that
// wakes the app even if killed.
interface FcmSendResult {
  success: boolean;
  errorCode?: string;
  rawError?: string;
}

async function sendFcmToToken(
  accessToken: string,
  projectId: string,
  token: string,
  platform: string,
  title: string,
  body: string,
  data: Record<string, string>
): Promise<FcmSendResult> {
  // FCM "data" payload values MUST be strings. Coerce defensively.
  const stringifiedData: Record<string, string> = {};
  for (const [k, v] of Object.entries(data || {})) {
    stringifiedData[k] = v === null || v === undefined ? "" : String(v);
  }

  const message: Record<string, unknown> = {
    token,
    notification: { title, body },
    data: stringifiedData,
    apns: {
      payload: {
        aps: {
          alert: { title, body },
          sound: "default",
          badge: 1,
          // Arabic content needs the alert-body to render right-to-left
          // by default — iOS handles this from the system locale, no
          // payload flag needed.
        },
      },
    },
    android: {
      priority: "high",
      notification: {
        sound: "default",
        // channel_id matches the channel we create on first launch in
        // pushNotifications.js. Required on Android 8.0+ (API 26+).
        channel_id: "mishwaro_default",
      },
    },
  };

  const resp = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message }),
    }
  );

  if (resp.ok) {
    return { success: true };
  }

  // Parse the FCM error to decide cleanup.
  let errorCode = "UNKNOWN";
  let rawError = "";
  try {
    const errBody = await resp.json();
    rawError = JSON.stringify(errBody);
    // FCM error format: { error: { code, message, status, details: [{ errorCode }] } }
    const details = errBody?.error?.details || [];
    for (const d of details) {
      if (d.errorCode) {
        errorCode = d.errorCode;
        break;
      }
    }
    if (errorCode === "UNKNOWN") {
      errorCode = errBody?.error?.status || "UNKNOWN";
    }
  } catch {
    rawError = await resp.text().catch(() => "(no body)");
  }

  return { success: false, errorCode, rawError };
}

// ─── Main handler ──────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body: PushRequest = await req.json();
    if (!body?.user_email || !body?.title || !body?.body) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: user_email, title, body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load the service account JSON from the secret.
    const saJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
    if (!saJson) {
      return new Response(
        JSON.stringify({ error: "FIREBASE_SERVICE_ACCOUNT secret not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    let sa: ServiceAccount;
    try {
      sa = JSON.parse(saJson);
    } catch {
      return new Response(
        JSON.stringify({ error: "FIREBASE_SERVICE_ACCOUNT is not valid JSON" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Service-role client for token lookups + cleanup. Bypasses RLS so
    // we can read every device token row, not just the caller's.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const { data: tokens, error: tokenErr } = await supabase
      .from("device_tokens")
      .select("id, token, platform")
      .eq("user_email", body.user_email);

    if (tokenErr) {
      return new Response(
        JSON.stringify({ error: `Failed to load device_tokens: ${tokenErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!tokens || tokens.length === 0) {
      // No devices registered for this user. Not an error — they
      // just won't get a push. The notifications row is still in
      // the DB so they'll see it next time they open the app.
      return new Response(
        JSON.stringify({ sent: 0, failed: 0, removed_tokens: 0, reason: "no_devices" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const accessToken = await getFcmAccessToken(sa);

    let sent = 0;
    let failed = 0;
    const tokensToRemove: string[] = [];
    const STALE_CODES = new Set([
      "UNREGISTERED",
      "INVALID_ARGUMENT",
      "SENDER_ID_MISMATCH",
      "NOT_FOUND",
    ]);

    // Send sequentially. Could parallelize with Promise.allSettled but
    // typical user has 1-3 devices; the latency benefit is negligible
    // and sequential is easier to debug.
    for (const t of tokens) {
      const result = await sendFcmToToken(
        accessToken,
        sa.project_id,
        t.token,
        t.platform,
        body.title,
        body.body,
        body.data || {}
      );
      if (result.success) {
        sent++;
      } else {
        failed++;
        if (result.errorCode && STALE_CODES.has(result.errorCode)) {
          tokensToRemove.push(t.id);
        }
        console.log(
          `FCM send failed: user=${body.user_email} platform=${t.platform} code=${result.errorCode} raw=${result.rawError}`
        );
      }
    }

    let removed = 0;
    if (tokensToRemove.length > 0) {
      const { error: delErr, count } = await supabase
        .from("device_tokens")
        .delete({ count: "exact" })
        .in("id", tokensToRemove);
      if (delErr) {
        console.error(`Failed to clean up stale tokens: ${delErr.message}`);
      } else {
        removed = count || 0;
      }
    }

    return new Response(
      JSON.stringify({ sent, failed, removed_tokens: removed }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`send-push-notification crashed: ${msg}`);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
