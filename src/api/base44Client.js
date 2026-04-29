/**
 * base44Client.js — Supabase compatibility shim
 *
 * Replaces @base44/sdk with a Supabase-backed implementation that
 * exposes the EXACT same API. Zero changes needed in other files.
 */

import { supabase } from '@/lib/supabase';
import { captureException } from "@/lib/sentry";

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
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  return user?.email ?? null;
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

// Read auth token directly from localStorage — bypasses supabase-js client (which hangs)
function getRestHeaders() {
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
  const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const PROJECT_REF = SUPABASE_URL?.split('//')[1]?.split('.')[0] || '';
  let userToken = ANON_KEY;
  try {
    const raw = localStorage.getItem(`sb-${PROJECT_REF}-auth-token`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.access_token) userToken = parsed.access_token;
    }
  } catch {}
  return {
    apikey: ANON_KEY,
    Authorization: `Bearer ${userToken}`,
    'Content-Type': 'application/json',
  };
}

// Direct REST fetch — avoids supabase-js client which hangs on token refresh.
// Returns parsed JSON or throws with descriptive error.
async function restFetch(pathAndQuery, opts = {}) {
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
  const url = `${SUPABASE_URL}/rest/v1${pathAndQuery}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout ?? 8000);
  try {
    const r = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: { ...getRestHeaders(), ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      throw new Error(`REST ${r.status} ${r.statusText}: ${errText.slice(0, 200)}`);
    }
    if (r.status === 204) return null;
    return await r.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`REST request timed out (${opts.timeout ?? 8000}ms)`);
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
    paginate: async ({ page = 1, pageSize = 25, sort, conditions } = {}) => {
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
      // Use direct REST instead of supabase-js (which hangs on writes after token refresh)
      const email = await getCurrentUserEmail();
      const insertData = {
        ...data,
        created_by: email,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const result = await restFetch(`/${tableName}`, {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
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

    subscribe: (callback) => {
      const channelName = `${tableName}-${Math.random().toString(36).slice(2)}`;
      const channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: tableName },
          (payload) => {
            // Realtime payload received — trigger callback for cache invalidation
            callback(payload);
          }
        )
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR') {
            console.warn(`[Realtime] Channel error on ${tableName}`);
          }
        });
      return () => supabase.removeChannel(channel);
    },
  };
}

// ─── Auth ─────────────────────────────────────────────────────

const auth = {
  me: async () => {
    // Use getSession() (reads localStorage instantly) instead of getUser() (hits network)
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    const user = session?.user;
    if (authError || !user) throw authError ?? new Error('Not authenticated');

    // 5s timeout on profile fetch — if supabase-js hangs, return basic info
    let profile = null;
    try {
      const result = await withTimeout(
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        5000,
        'auth.me profile'
      );
      if (result?.error && result.error.code !== 'PGRST116') {
        console.warn('[auth.me] profile fetch warning:', result.error.message);
      }
      profile = result?.data;
    } catch (e) {
      console.warn('[auth.me] profile fetch timeout, using session-only data:', e.message);
    }

    return {
      id: user.id,
      email: user.email,
      full_name: profile?.full_name ?? user.user_metadata?.full_name ?? '',
      avatar_url: profile?.avatar_url ?? null,
      role: profile?.role ?? 'user',
      account_type: profile?.account_type ?? 'passenger',
      phone: profile?.phone ?? null,
      gender: profile?.gender ?? null,
      bio: profile?.bio ?? null,
      car_model: profile?.car_model ?? null,
      car_year: profile?.car_year ?? null,
      car_color: profile?.car_color ?? null,
      car_plate: profile?.car_plate ?? null,
      driver_note: profile?.driver_note ?? null,
      onboarding_completed: profile?.onboarding_completed ?? false,
      verification_pending: profile?.verification_pending ?? false,
      total_rating: profile?.total_rating ?? 0,
      total_reviews: profile?.total_reviews ?? 0,
      is_active: profile?.is_active ?? true,
      created_at: profile?.created_at ?? user.created_at,
    };
  },

  updateMe: async (data) => {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
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

    // Profile data — direct REST PATCH (bypasses supabase-js client hang)
    if (Object.keys(profileData).length > 0) {
      await restFetch(`/profiles?id=eq.${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: { ...profileData, updated_at: new Date().toISOString() },
      });
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
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) throw new Error('Not authenticated');

    // Call SECURITY DEFINER RPC that handles cascade deletion safely
    const { error } = await supabase.rpc('delete_user_account', { user_id_param: user.id });
    if (error) {
      // Fallback: at minimum mark profile inactive and sign out
      captureException(error, { msg: '[deleteMe] RPC failed, falling back to soft-delete:' });
      await supabase.from('profiles').update({
        is_active: false,
        full_name: 'حساب محذوف',
        phone: null,
        avatar_url: null,
        bio: null,
      }).eq('id', user.id);
    }

    await supabase.auth.signOut();
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

      // Verify session before upload
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('يجب تسجيل الدخول أولاً لرفع الملفات');

      const ext = file.name.split('.').pop().toLowerCase() || 'jpg';
      const filePath = `public/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      // Try upload — if bucket missing, attempt creation first
      let uploadData, uploadError;
      ({ data: uploadData, error: uploadError } = await supabase.storage
        .from('uploads')
        .upload(filePath, file, { cacheControl: '3600', upsert: true, contentType: file.type }));

      if (uploadError?.message?.toLowerCase().includes('bucket')) {
        // Bucket not found — try to create it (requires service role in production, this is best-effort)
        await supabase.storage.createBucket('uploads', { public: true, fileSizeLimit: 5242880 });
        ({ data: uploadData, error: uploadError } = await supabase.storage
          .from('uploads')
          .upload(filePath, file, { cacheControl: '3600', upsert: true, contentType: file.type }));
      }

      if (uploadError) {
        captureException(uploadError, { msg: '[Storage] Upload error:' });
        if (uploadError.statusCode === 403 || uploadError.message?.includes('authorized')) {
          throw new Error('غير مصرح بالرفع — تأكد من تشغيل supabase-production.sql في Supabase');
        }
        throw new Error(uploadError.message || 'فشل رفع الملف');
      }

      const { data: { publicUrl } } = supabase.storage.from('uploads').getPublicUrl(filePath);
      return { file_url: publicUrl };
    },
  },
};

// ─── Functions ────────────────────────────────────────────────

const functions = {
  invoke: async (name, args = {}) => {
    if (name === 'cancelBooking') {
      const { booking_id } = args;
      if (!booking_id) throw new Error('cancelBooking: booking_id required');

      // Get booking
      const { data: booking, error: bErr } = await supabase
        .from('bookings').select('*').eq('id', booking_id).single();
      if (bErr || !booking) throw new Error('Booking not found');

      // Get trip
      const { data: trip, error: tErr } = await supabase
        .from('trips').select('*').eq('id', booking.trip_id).single();
      if (tErr || !trip) throw new Error('Trip not found');

      // Check cancellation window
      const tripDateTime = new Date(`${trip.date}T${trip.time}`);
      const hoursUntilTrip = (tripDateTime - new Date()) / (1000 * 60 * 60);
      const isCash = booking.payment_method === 'نقداً' || booking.payment_method === 'cash';

      if (isCash && hoursUntilTrip < 2)
        throw new Error('لا يمكن إلغاء حجوزات النقد قبل ساعتين من الرحلة');
      if (!isCash && hoursUntilTrip < 24)
        throw new Error('لا يمكن إلغاء الحجوزات المدفوعة إلا قبل 24 ساعة من الرحلة');

      // Cancel booking (trigger handles seat restore + notification)
      const { error } = await supabase
        .from('bookings').update({ status: 'cancelled' }).eq('id', booking_id);
      if (error) throw error;

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

export const base44 = {
  entities: {
    Trip:           createEntityClient('trips'),
    Booking:        createEntityClient('bookings'),
    Review:         createEntityClient('reviews'),
    Message:        createEntityClient('messages'),
    Notification:   createEntityClient('notifications'),
    DriverLicense:  createEntityClient('driver_licenses'),
    Coupon:         createEntityClient('coupons'),
    AppSettings:    createEntityClient('app_settings'),
    Announcement:   createEntityClient('announcements'),
    SupportTicket:  createEntityClient('support_tickets'),
    TripPreference: createEntityClient('trip_preferences'),
    User:           createEntityClient('profiles'),
  },
  auth,
  integrations,
  functions,
};

export default base44;
