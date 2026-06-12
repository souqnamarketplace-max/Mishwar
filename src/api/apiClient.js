/**
 * apiClient.js — Supabase client wrapper
 *
 * Thin abstraction over @supabase/supabase-js that exposes a stable
 * entity API surface (api.entities.Trip.filter, api.auth.me, etc.)
 * used throughout the app. Wraps every Supabase call with:
 *   - timeout enforcement (the supabase-js client occasionally hangs
 *     after HMR or token refresh — withTimeout aborts after 7s)
 *   - direct REST fallback via fetch() when the supabase-js client
 *     misbehaves, bypassing its internal state machine
 *   - sentry capture on errors
 *
 * Historical note: this file used to be base44Client.js and exported
 * a const `base44` because the app was previously built on the Base44
 * SaaS platform. The Base44 dependency was removed; only the API
 * shape was preserved so other source files didn't all have to
 * change at once. The file is now named for what it actually is.
 */

import { supabase } from '@/lib/supabase';
import { captureException } from "@/lib/sentry";
import { readLocalSession as readSession } from "@/lib/session";

// ─── Helpers ─────────────────────────────────────────────────

function parseSortField(sort) {
  if (!sort) return { column: 'created_at', ascending: false };
  const ascending = !sort.startsWith('-');
  let column = sort.replace(/^-/, '');
  if (column === 'created_date') column = 'created_at';
  if (column === 'updated_date') column = 'updated_at';
  return { column, ascending };
}

async function getCurrentUserEmail() {
  // Direct from localStorage — avoids supabase.auth.getSession() hang
  const session = readLocalSession();
  return session?.user?.email ?? null;
}


// Wraps a promise with a timeout — prevents queries from hanging indefinitely
// (supabase-js client occasionally hangs after HMR or token refresh)
function withTimeout(promise, ms = 7000, label = 'query') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`[${label}] timeout after ${ms}ms`)), ms)),
  ]);
}

// ─── Entity factory ───────────────────────────────────────────

// Read auth token directly from localStorage — bypasses supabase-js client (which hangs).
// IMPORTANT: only use the token if it's still valid. An expired access_token sent as
// Bearer causes Supabase to return 401 on every request — including polling queries
// like the driver booking popup, which then floods the console and toasts the user
// every 15 seconds. Falling back to ANON_KEY when expired lets RLS handle authz
// properly (anonymous reads succeed for public tables, denied for protected ones).
function getRestHeaders() {
  const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
  let userToken = ANON_KEY;
  // readSession returns null if expired/missing/unparseable. When it
  // returns null we fall back to ANON_KEY so RLS handles authz —
  // sending an expired Bearer would 401 every request.
  const session = readSession();
  if (session?.access_token) {
    userToken = session.access_token;
  }
  return {
    apikey: ANON_KEY,
    Authorization: `Bearer ${userToken}`,
    'Content-Type': 'application/json',
  };
}

// Direct REST fetch — avoids supabase-js client which hangs on token refresh.
// Returns parsed JSON or throws with descriptive error.
// Pass opts.token to override the session token from localStorage (use this
// after supabase.auth.getSession() to ensure auto-refreshed tokens are used).
async function restFetch(pathAndQuery, opts = {}) {
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
  const url = `${SUPABASE_URL}/rest/v1${pathAndQuery}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout ?? 8000);
  const baseHeaders = opts.token
    ? {
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${opts.token}`,
        'Content-Type': 'application/json',
      }
    : getRestHeaders();
  try {
    const r = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: { ...baseHeaders, ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      if (r.status === 429) throw new Error('طلبات كثيرة — يرجى الانتظار لحظة');
      if (r.status === 503) throw new Error('الخادم مشغول مؤقتاً — يرجى إعادة المحاولة');
      if (r.status === 401) throw new Error('انتهت جلستك — يرجى إعادة تسجيل الدخول');
      throw new Error(`REST ${r.status} ${r.statusText}: ${errText.slice(0, 200)}`);
    }
    if (r.status === 204) return null;
    return await r.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`REST request timed out (${opts.timeout ?? 8000}ms)`);
    // Network failure (offline)
    if (e.name === 'TypeError' && e.message.includes('fetch')) {
      throw new Error('لا يوجد اتصال بالإنترنت — تحقق من شبكتك');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// PostgREST query string builder
function buildQs({ select = '*', orderBy, ascending = false, limit, filters = {} }) {
  const parts = [`select=${encodeURIComponent(select)}`];
  if (orderBy) parts.push(`order=${encodeURIComponent(orderBy)}.${ascending ? 'asc' : 'desc'}`);
  if (limit) parts.push(`limit=${Math.min(limit, 1000)}`);
  Object.entries(filters).forEach(([key, val]) => {
    if (val === undefined || val === null) return;
    parts.push(`${encodeURIComponent(key)}=eq.${encodeURIComponent(val)}`);
  });
  return parts.length ? `?${parts.join('&')}` : '';
}



// Re-export the centralized session helper under the historical name so
// existing call sites in this module keep working without churn. New code
// should import from "@/lib/session" directly.
const readLocalSession = readSession;

// Shared registry for the subscribe() implementation below.
// Maps channelName → { channel, callbacks }. See the comment on
// createEntityClient(tableName).subscribe for the why.
const subscribeRegistry = new Map();

function createEntityClient(tableName) {
  return {
    list: async (sort, limit) => {
      const { column, ascending } = parseSortField(sort);
      const qs = buildQs({ orderBy: column, ascending, limit });
      return await restFetch(`/${tableName}${qs}`);
    },

    get: async (id) => {
      if (!id) throw new Error(`${tableName}.get: id is required`);
      // PostgREST: select with id eq filter and limit 1
      const rows = await restFetch(`/${tableName}?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
      return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    },

    filter: async (conditions, sort, limit) => {
      const { column, ascending } = parseSortField(sort);
      const qs = buildQs({ orderBy: column, ascending, limit, filters: conditions || {} });
      return await restFetch(`/${tableName}${qs}`);
    },

    /**
     * Server-side pagination — fetches one page at a time with total count.
     * @param {object} opts { page, pageSize, sort, conditions }
     * @returns { rows, total, page, pageSize, totalPages }
     */
    paginate: async ({
      page = 1, pageSize = 25, sort, conditions,
      // Multi-column case-insensitive search. Pass:
      //   searchTerm:    string the admin typed (empty/undefined = no search)
      //   searchColumns: array of column names to ilike across
      // Translates to a Supabase .or() with `col.ilike.%term%` for each
      // column. Special-cases ID search when the term looks like a UUID
      // — exact id eq match instead of substring.
      searchTerm,
      searchColumns,
      // Date range filter. Pass:
      //   dateColumn: column to filter on (e.g. 'created_at', 'date')
      //   dateFrom:   ISO string lower bound (inclusive); null/undefined = no lower bound
      //   dateTo:     ISO string upper bound (inclusive); null/undefined = no upper bound
      dateColumn,
      dateFrom,
      dateTo,
    } = {}) => {
      const { column, ascending } = parseSortField(sort);
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      let query = supabase
        .from(tableName)
        .select('*', { count: 'exact' })
        .order(column, { ascending })
        .range(from, to);

      if (conditions && typeof conditions === 'object') {
        Object.entries(conditions).forEach(([key, val]) => {
          if (val !== undefined && val !== null) query = query.eq(key, val);
        });
      }

      // Multi-column ilike search. Skip if no term or no columns.
      if (searchTerm && Array.isArray(searchColumns) && searchColumns.length > 0) {
        const term = String(searchTerm).trim();
        if (term.length > 0) {
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(term);
          if (isUuid) {
            // Looks like a UUID — exact match on id (admin pasted a row id)
            query = query.eq('id', term);
          } else {
            // Escape any commas/parens in the term to keep the .or() syntax safe
            const escaped = term.replace(/[%,()]/g, ' ');
            const orClauses = searchColumns.map((c) => `${c}.ilike.%${escaped}%`).join(',');
            query = query.or(orClauses);
          }
        }
      }

      // Date range — apply both bounds independently
      if (dateColumn) {
        if (dateFrom) query = query.gte(dateColumn, dateFrom);
        if (dateTo)   query = query.lte(dateColumn, dateTo);
      }

      const { data, count, error } = await query;
      if (error) throw error;
      return {
        rows: data ?? [],
        total: count ?? 0,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
      };
    },

    create: async (data) => {
      // Use supabase.auth.getSession() for writes — it triggers auto-refresh
      // if the access_token is expired but a valid refresh_token exists.
      // readLocalSession() / getRestHeaders() return null/ANON for expired
      // tokens, causing every trip INSERT to fire with auth.uid()=NULL and
      // fail RLS with "permission denied" — which is the "ليس لديك صلاحية"
      // error all drivers saw. Writes are user-initiated so the await is fine.
      let writeToken = import.meta.env.VITE_SUPABASE_ANON_KEY;
      let email = null;
      try {
        const { data: authData } = await supabase.auth.getSession();
        if (authData?.session?.access_token) {
          writeToken = authData.session.access_token;
          email = authData.session.user?.email ?? null;
        }
      } catch {
        // getSession failed — fall back to localStorage read so at least
        // non-expired sessions still work
        email = await getCurrentUserEmail();
      }

      // Honour recipient notification preferences for the notifications table.
      // Until now `notif_push` / `notif_marketing` toggles in /account were
      // saved to profiles but never consulted before sending — turning them
      // off did nothing. This intercepts notifications writes here, in ONE
      // place, instead of editing 16+ call sites that already wrap their
      // inserts in `try{}catch{}` so any new failure mode is silently swallowed.
      //
      // Rules:
      //   - if recipient has notif_push === false → drop entirely
      //   - if data.type === 'broadcast' or 'marketing' AND recipient has
      //     notif_marketing === false → drop
      // Lookup uses anon-readable profiles (RLS already permits public reads
      // on profiles for the join cases). Failure to look up the profile (e.g.
      // network blip) falls THROUGH and lets the insert proceed — better to
      // over-notify in a degraded state than under-notify.
      if (tableName === 'notifications' && data?.user_email) {
        try {
          const { data: prefRows } = await supabase
            .from('profiles')
            .select('notif_push, notif_marketing')
            .eq('email', data.user_email)
            .limit(1);
          const prefs = prefRows?.[0];
          if (prefs) {
            if (prefs.notif_push === false) {
              // User opted out of all in-app notifications. Pretend it succeeded
              // so the caller's optimistic UI doesn't break, but write nothing.
              return null;
            }
            const isMarketing =
              data.type === 'broadcast' ||
              data.type === 'marketing' ||
              data.type === 'announcement';
            if (isMarketing && prefs.notif_marketing === false) {
              return null;
            }
          }
        } catch {
          // Profile lookup failed — proceed with the insert. The user's
          // preference is "don't notify" but we can't confirm it; defaulting
          // to send is the less-bad outcome (notifications can be dismissed,
          // missed ones cannot be undone).
        }
      }

      const insertData = {
        ...data,
        created_by: email,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const result = await restFetch(`/${tableName}`, {
        method: 'POST',
        // Override Authorization with the freshly-validated token from
        // supabase.auth.getSession() — ensures auth.uid() is set correctly
        // in RLS policies even when the localStorage token is expired.
        headers: {
          Prefer: 'return=representation',
          Authorization: `Bearer ${writeToken}`,
        },
        body: insertData,
      });
      // PostgREST returns an array — single insert returns array of 1
      return Array.isArray(result) ? result[0] : result;
    },

    update: async (id, data) => {
      // Direct REST PATCH — bypasses supabase-js client hang
      const updateData = { ...data, updated_at: new Date().toISOString() };
      const result = await restFetch(`/${tableName}?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: updateData,
      });
      return Array.isArray(result) ? result[0] : result;
    },

    delete: async (id) => {
      // Direct REST DELETE — bypasses supabase-js client hang
      await restFetch(`/${tableName}?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
      return true;
    },

    /**
     * Server-side count — returns the total number of rows matching
     * conditions without fetching the rows themselves. Uses supabase-js's
     * head:true + count:exact, which sends an HTTP HEAD-style request
     * that returns ONLY the Content-Range header with the count, no body.
     *
     * Replaces the count-via-list anti-pattern (e.g. `(await Trip.list()).length`)
     * which:
     *   1. Downloaded all row data just to get the length — wasteful
     *   2. Silently capped at PostgREST's default limit (1000) so any
     *      table with > 1000 rows reported a wrong count
     *   3. Affected Dashboard stats (totalTrips/totalBookings/totalUsers)
     *      which used a 100-row list and reported max 100 once tables grew
     *
     * @param {object} conditions - optional eq filters, same shape as filter()
     * @returns {Promise<number>} the matching row count
     */
    count: async (conditions) => {
      let query = supabase
        .from(tableName)
        .select('*', { count: 'exact', head: true });
      if (conditions && typeof conditions === 'object') {
        Object.entries(conditions).forEach(([key, val]) => {
          if (val !== undefined && val !== null) query = query.eq(key, val);
        });
      }
      const { count, error } = await query;
      if (error) throw error;
      return count ?? 0;
    },

    subscribe: (callback) => {
      // Shared per-table channel with a callback registry.
      //
      // Previously: every caller of subscribe() called
      // supabase.removeChannel(channelName) up front to "clean up
      // previous mount", then created a fresh channel. The channel
      // name (`${tableName}-realtime`) was SHARED across all callers,
      // so caller B's mount destroyed caller A's still-active
      // subscription. On a page with 20 TripCards, only the
      // last-mounted card received realtime updates; the other 19
      // were silently dead. When ANY card unmounted, the cleanup
      // destroyed the channel for everyone. AdminNotificationBell
      // had already worked around this by using its own dedicated
      // channel name; this is the fix to the underlying defect for
      // every other caller (TripCard, BookingRequestPopup,
      // DriverTripsList, DriverPassengers, FeaturedTrips, StatsBar,
      // Notifications page, Messages page, multiple dashboard
      // pages, etc.).
      //
      // Now: first subscribe() for a tableName creates the Supabase
      // channel and a callbacks Set. Subsequent subscribe() calls
      // for the same tableName just add their callback to the Set —
      // no channel teardown. Unsubscribe removes only this caller's
      // callback; only the LAST unsubscribe (callbacks Set becomes
      // empty) removes the Supabase channel.
      const channelName = `${tableName}-realtime`;
      let entry = subscribeRegistry.get(channelName);
      if (!entry) {
        const callbacks = new Set();
        const channel = supabase
          .channel(channelName, { config: { broadcast: { self: true } } })
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: tableName },
            (payload) => {
              // Fan out to every registered subscriber. Each cb is
              // wrapped in try/catch so one cb throwing doesn't
              // break delivery to the others.
              callbacks.forEach((cb) => {
                try { cb(payload); } catch (e) {
                  console.warn(`[Realtime ${tableName}] subscriber threw:`, e);
                }
              });
            }
          )
          .subscribe((status) => {
            if (status === 'CHANNEL_ERROR') {
              console.warn(`[Realtime] Channel error on ${tableName} — will retry`);
              setTimeout(() => {
                try { channel.subscribe(); } catch {}
              }, 3000);
            }
            if (status === 'TIMED_OUT') {
              console.warn(`[Realtime] Timed out on ${tableName}`);
            }
          });
        entry = { channel, callbacks };
        subscribeRegistry.set(channelName, entry);
      }
      entry.callbacks.add(callback);

      return () => {
        const e = subscribeRegistry.get(channelName);
        if (!e) return;
        e.callbacks.delete(callback);
        // Only tear down the Supabase channel when no one is
        // listening anymore. Prevents the "last-card-unmount kills
        // everyone" cascade from the previous implementation.
        if (e.callbacks.size === 0) {
          try { supabase.removeChannel(e.channel); } catch {}
          subscribeRegistry.delete(channelName);
        }
      };
    },
  };
}

// ─── Auth ─────────────────────────────────────────────────────

const auth = {
  me: async () => {
    // Read session directly from localStorage (avoids supabase.auth.getSession hang)
    const session = readLocalSession();
    const user = session?.user;
    if (!user) throw new Error('Not authenticated');

    // Fetch profile via direct REST (avoids supabase-js client hang)
    let profile = null;
    try {
      const rows = await restFetch(`/profiles?select=*&id=eq.${encodeURIComponent(user.id)}&limit=1`);
      profile = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    } catch (e) {
      console.warn('[auth.me] profile fetch error, using session-only data:', e.message);
    }

    // Fetch payment info via the SECURITY DEFINER RPC. After migration 006
    // these columns are no longer SELECTable directly from `profiles` —
    // even by the row owner — so we go through the RPC. If the RPC isn't
    // deployed yet (migration 006 not applied), the call fails silently
    // and payment fields remain undefined, matching the pre-migration
    // behaviour.
    let payment = null;
    try {
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_my_payment_info`, {
        method: 'POST',
        headers: { ...getRestHeaders(), Prefer: 'return=representation' },
        body: '{}',
      });
      if (r.ok) {
        const rows = await r.json();
        payment = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
      }
    } catch (e) {
      // RPC not yet deployed or transient error — leave payment as null
    }

    return {
      id: user.id,
      email: user.email,
      // Sequential account number (migration 041). select=* above
      // already pulls this from the DB; we just need to surface it
      // through the explicit field-list mapping so AccountSettings
      // and any other consumer can read user.account_number.
      account_number: profile?.account_number ?? null,
      full_name: profile?.full_name ?? user.user_metadata?.full_name ?? '',
      avatar_url: profile?.avatar_url ?? null,
      role: profile?.role ?? 'user',
      account_type: profile?.account_type ?? 'passenger',
      phone: profile?.phone ?? null,
      gender: profile?.gender ?? null,
      bio: profile?.bio ?? null,
      city: profile?.city ?? null,
      car_model: profile?.car_model ?? null,
      car_year: profile?.car_year ?? null,
      car_color: profile?.car_color ?? null,
      car_plate: profile?.car_plate ?? null,
      car_image: profile?.car_image ?? null,
      driver_note: profile?.driver_note ?? null,
      onboarding_completed: profile?.onboarding_completed ?? false,
      verification_pending: profile?.verification_pending ?? false,
      total_rating: profile?.total_rating ?? 0,
      total_reviews: profile?.total_reviews ?? 0,
      is_active: profile?.is_active ?? true,
      created_at: profile?.created_at ?? user.created_at,
      // ── Trip preferences (denormalized to user-shape for convenience) ──
      pref_smoking:    profile?.pref_smoking    ?? null,
      pref_chattiness: profile?.pref_chattiness ?? null,
      pref_pets:       profile?.pref_pets       ?? null,
      vehicle_luggage: profile?.vehicle_luggage ?? null,
      vehicle_back_row: profile?.vehicle_back_row ?? null,
      vehicle_capacity: profile?.vehicle_capacity ?? null,
      // ── Payment fields (via get_my_payment_info RPC) ──
      bank_name:           payment?.bank_name           ?? null,
      bank_account_name:   payment?.bank_account_name   ?? null,
      bank_account_number: payment?.bank_account_number ?? null,
      bank_iban:           payment?.bank_iban           ?? null,
      jawwal_pay_number:   payment?.jawwal_pay_number   ?? null,
      reflect_number:      payment?.reflect_number      ?? null,
      card_holder_name:    payment?.card_holder_name    ?? null,
      card_last_four:      payment?.card_last_four      ?? null,
      preferred_payment:   payment?.preferred_payment   ?? null,
    };
  },

  updateMe: async (data) => {
    // Use supabase client directly for profile PATCH — it handles auth
    // headers internally so expired tokens, incognito sessions, and
    // sessionStorage-only sessions all work without manual token passing.
    const { data: authData } = await supabase.auth.getSession();
    const user = authData?.session?.user ?? readLocalSession()?.user;
    if (!user) throw new Error('Not authenticated');

    const { email, password, ...profileData } = data;

    // Email/password updates still need supabase-js (auth-specific)
    if (email || password) {
      const authUpdate = {};
      if (email) authUpdate.email = email;
      if (password) authUpdate.password = password;
      const { error } = await supabase.auth.updateUser(authUpdate);
      if (error) throw error;
    }

    // Profile data — supabase client handles auth headers internally
    if (Object.keys(profileData).length > 0) {
      const { error } = await supabase
        .from('profiles')
        .update({ ...profileData, updated_at: new Date().toISOString() })
        .eq('id', user.id);
      if (error) throw new Error(error.message);
    }

    return auth.me();
  },

  logout: async (redirectUrl) => {
    // Aggressive logout — never hang, clear all auth state, force redirect
    try {
      // Clear every possible Supabase auth key from localStorage immediately
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('sb-') || k.includes('supabase') || k === 'auth-token') {
          localStorage.removeItem(k);
        }
      });
      // Try signOut with a timeout — but don't block on it
      Promise.race([
        supabase.auth.signOut(),
        new Promise(resolve => setTimeout(resolve, 1500)),
      ]).catch(() => {}); // swallow any errors
    } catch (e) {
      console.warn('[logout] cleanup error (continuing anyway):', e);
    }
    // Force redirect immediately — don't wait for signOut to complete
    window.location.href = redirectUrl ?? '/login';
  },

  redirectToLogin: (returnUrl) => {
    const params = returnUrl ? `?returnTo=${encodeURIComponent(returnUrl)}` : '';
    window.location.href = `/login${params}`;
  },

  deleteMe: async () => {
    // Direct localStorage — avoids supabase.auth.getSession hang
    const session = readLocalSession();
    const user = session?.user;
    if (!user) throw new Error('Not authenticated');

    // Call SECURITY DEFINER RPC via direct REST (POST to /rpc/...)
    try {
      await restFetch('/rpc/delete_user_account', {
        method: 'POST',
        body: { user_id_param: user.id },
        timeout: 10000,
      });
    } catch (rpcErr) {
      // Fallback: soft-delete via direct REST
      captureException(rpcErr, { msg: '[deleteMe] RPC failed, falling back to soft-delete:' });
      try {
        await restFetch(`/profiles?id=eq.${encodeURIComponent(user.id)}`, {
          method: 'PATCH',
          body: {
            is_active: false,
            full_name: 'حساب محذوف',
            phone: null,
            avatar_url: null,
            bio: null,
          },
        });
      } catch (softErr) {
        captureException(softErr, { msg: '[deleteMe] soft-delete also failed:' });
      }
    }

    // signOut() just clears localStorage — keep using supabase-js (no network call)
    try { await supabase.auth.signOut(); } catch {}
    window.location.href = '/';
  },
};

// ─── File uploads ─────────────────────────────────────────────

const integrations = {
  Core: {
    UploadFile: async ({ file }) => {
      if (!file) throw new Error('No file provided');

      if (file.size > 5 * 1024 * 1024) {
        throw new Error('حجم الملف يجب أن يكون أقل من 5 MB');
      }

      const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
      if (!allowed.includes(file.type)) {
        throw new Error('نوع الملف غير مدعوم. يُسمح بـ JPG و PNG و PDF فقط');
      }

      // Verify session before upload — use direct localStorage (avoids supabase-js hang)
      const session = readLocalSession();
      if (!session) throw new Error('يجب تسجيل الدخول أولاً لرفع الملفات');
      const userId = session?.user?.id;
      if (!userId) throw new Error('تعذر التحقق من هويتك. يرجى تسجيل الدخول مرة أخرى');

      const ext = file.name.split('.').pop().toLowerCase() || 'jpg';
      // Path is namespaced under the user's UUID so storage RLS policies can
      // enforce that user A cannot write/delete in user B's folder.
      // See migrations/004_storage_hardening.sql for the policy that depends
      // on this naming convention.
      const filePath = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      // Direct REST upload — bypasses supabase-js client which hangs after token refresh.
      // Storage REST API: POST /storage/v1/object/{bucket}/{path}
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
      const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const userToken = session.access_token || ANON_KEY;

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);
      let uploadResp;
      try {
        uploadResp = await fetch(
          `${SUPABASE_URL}/storage/v1/object/uploads/${filePath}`,
          {
            method: 'POST',
            headers: {
              apikey: ANON_KEY,
              Authorization: `Bearer ${userToken}`,
              'x-upsert': 'true',
              'Content-Type': file.type,
            },
            body: file,
            signal: ctrl.signal,
          }
        );
      } finally {
        clearTimeout(timer);
      }

      if (!uploadResp.ok) {
        const errBody = await uploadResp.text().catch(() => '');
        throw new Error(`فشل رفع الملف (${uploadResp.status}): ${errBody.slice(0, 200)}`);
      }

      // Build public URL deterministically — no extra network call needed
      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/uploads/${filePath}`;
      return { file_url: publicUrl };
    },
  },
};

// ─── Functions ────────────────────────────────────────────────

const functions = {
  processBookingPayment: async (bookingId, confirmedBy = 'driver') => {
    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
    const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const session = readLocalSession();
    const token = session?.access_token || ANON_KEY;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/process_booking_payment`, {
      method: 'POST',
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_booking_id: bookingId, p_confirmed_by: confirmedBy }),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => '');
      throw new Error(`processBookingPayment failed (${r.status}): ${err.slice(0, 200)}`);
    }
    return r.json();
  },
  
  invoke: async (name, args = {}) => {
    if (name === 'cancelBooking') {
      const { booking_id } = args;
      if (!booking_id) throw new Error('cancelBooking: booking_id required');

      // Use direct REST (supabase-js client hangs after token refresh)
      const bookingRows = await restFetch(`/bookings?select=*&id=eq.${encodeURIComponent(booking_id)}&limit=1`);
      const booking = Array.isArray(bookingRows) && bookingRows.length > 0 ? bookingRows[0] : null;
      if (!booking) throw new Error('Booking not found');

      const tripRows = await restFetch(`/trips?select=date,time,id&id=eq.${encodeURIComponent(booking.trip_id)}&limit=1`);
      const trip = Array.isArray(tripRows) && tripRows.length > 0 ? tripRows[0] : null;
      if (!trip) throw new Error('Trip not found');

      // Check cancellation window
      const tripDateTime = new Date(`${trip.date}T${trip.time}`);
      const hoursUntilTrip = (tripDateTime - new Date()) / (1000 * 60 * 60);
      const isCash = booking.payment_method === 'نقداً' || booking.payment_method === 'cash';

      if (isCash && hoursUntilTrip < 2)
        throw new Error('لا يمكن إلغاء حجوزات النقد قبل ساعتين من الرحلة');
      if (!isCash && hoursUntilTrip < 24)
        throw new Error('لا يمكن إلغاء الحجوزات المدفوعة إلا قبل 24 ساعة من الرحلة');

      // Cancel via the cancel_booking RPC (migration 018) instead of
      // a direct PATCH to /bookings. The RPC handles atomically:
      //   1. Authorization (passenger / driver / admin)
      //   2. Status update to 'cancelled'
      //   3. Seat refund — for BOTH 'pending' AND 'confirmed' bookings
      //      with bounds checking (LEAST/GREATEST guards). The previous
      //      direct PATCH never refunded seats from the passenger side
      //      at all, leaving trips understated for the rest of their
      //      lifetime — passengers cancelling their own bookings made
      //      the trip's available_seats stay wrong, blocking future
      //      passengers from booking real capacity.
      //   4. Late-cancellation strike enforcement (2h threshold). The
      //      direct PATCH skipped the strike system entirely, so even
      //      after migration 018 shipped the strike logic, no
      //      passenger ever actually got a strike for a late cancel.
      // The client-side 2h/24h pre-check above is kept as a UX gate —
      // it shows a friendly Arabic error before the user wastes a
      // round-trip. The RPC enforces its own (different, stricter on
      // strikes side) rules server-side regardless. If a malicious
      // client bypassed the JS check, the RPC would still apply the
      // strike correctly.
      await restFetch('/rpc/cancel_booking', {
        method: 'POST',
        body: {
          booking_id_param: booking_id,
          reason_param: 'passenger_self_cancel',
        },
      });

      return { success: true, message: 'تم إلغاء الحجز بنجاح' };
    }

    if (name === 'updateUserAdmin') {
      const { userId, data: updateData } = args;
      if (!userId) throw new Error('updateUserAdmin: userId required');
      const { error } = await supabase
        .from('profiles')
        .update({ ...updateData, updated_at: new Date().toISOString() })
        .eq('id', userId);
      if (error) throw error;
      return { success: true };
    }
    throw new Error(`Unknown function: ${name}`);
  },
};

// ─── Export ───────────────────────────────────────────────────

export const api = {
  entities: {
    Trip:           createEntityClient('trips'),
    Booking:        createEntityClient('bookings'),
    Review:         createEntityClient('reviews'),
    Message:        createEntityClient('messages'),
    AdminAuditLog:  createEntityClient('admin_audit_log'),
  Profile:         createEntityClient('profiles'),
  DriverPayout:   createEntityClient('driver_payouts'),
    Notification:   createEntityClient('notifications'),
    DriverLicense:      createEntityClient('driver_licenses'),
    DriverSubscription: createEntityClient('driver_subscriptions'),
    Coupon:         createEntityClient('coupons'),
    AppSettings:    createEntityClient('app_settings'),
    Announcement:   createEntityClient('announcements'),
    Testimonial:    createEntityClient('testimonials'),
    TeamMember:     createEntityClient('team_members'),
    BlogPost:       createEntityClient('blog_posts'),
    SupportTicket:  createEntityClient('support_tickets'),
    UserBlock:      createEntityClient('user_blocks'),
    UserReport:     createEntityClient('user_reports'),
    TripRequest:    createEntityClient('trip_requests'),
    TripPreference: createEntityClient('trip_preferences'),
    User:           createEntityClient('profiles'),
  },
  auth,
  integrations,
  functions,
};

export default api;
