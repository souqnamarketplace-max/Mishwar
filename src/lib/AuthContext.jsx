import React, { createContext, useState, useContext, useEffect } from 'react';
import { captureException } from "@/lib/sentry";
import { supabase } from '@/lib/supabase';
import { queryClientInstance } from '@/lib/query-client';
import { base44 } from '@/api/base44Client';

// Read session instantly from localStorage — no network call
function readSessionFromStorage() {
  try {
    const PROJECT_REF = import.meta.env.VITE_SUPABASE_URL?.split('//')[1]?.split('.')[0] || 'dimtdwahtwaslmnuakij';
    const key = `sb-${PROJECT_REF}-auth-token`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Check expiry
    if (parsed?.expires_at && parsed.expires_at * 1000 < Date.now()) return null;
    return parsed;
  } catch { return null; }
}

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [appPublicSettings, setAppPublicSettings] = useState(null);

  useEffect(() => {
    // Hard safeguard: never let auth loading hang for more than 8 seconds
    const failsafe = setTimeout(() => {
      setIsLoadingAuth(false);
      setAuthChecked(true);
    }, 8000);

    // Check current session on mount
    checkUserAuth().finally(() => clearTimeout(failsafe));

    // Subscribe to auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        await loadUserProfile(session.user);
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        setIsAuthenticated(false);
        setAuthError(null);
      } else if (event === 'TOKEN_REFRESHED' && session?.user) {
        // Silently refresh user data
        await loadUserProfile(session.user);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const loadUserProfile = async (authUser) => {
    try {
      // Direct REST fetch — supabase-js client hangs silently after token refresh
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
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      let profile = null;
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=*&id=eq.${encodeURIComponent(authUser.id)}&limit=1`, {
          headers: { apikey: ANON_KEY, Authorization: `Bearer ${userToken}` },
          signal: ctrl.signal,
        });
        if (r.ok) {
          const rows = await r.json();
          profile = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
        }
      } finally {
        clearTimeout(timer);
      }

      const fullUser = {
        id: authUser.id,
        email: authUser.email,
        full_name: profile?.full_name ?? authUser.user_metadata?.full_name ?? authUser.email?.split('@')[0] ?? '',
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
        created_at: profile?.created_at ?? authUser.created_at,
      };
      setUser(fullUser);
      try { queryClientInstance.setQueryData(["me"], fullUser); } catch {}
      setIsAuthenticated(true);
      setAuthError(null);
    } catch (err) {
      captureException(err, { msg: 'Profile load error:' });
      // Even on error, set the user as authenticated with basic info
      setUser({
        id: authUser.id,
        email: authUser.email,
        full_name: authUser.user_metadata?.full_name ?? '',
        role: 'user',
        account_type: 'passenger',
        onboarding_completed: false,
      });
      setIsAuthenticated(true);
      setAuthError(null);
    }
  };

  /**
   * Re-fetch the current user's profile from DB.
   * Use after updates to keep the AuthContext state in sync (e.g., after onboarding,
   * profile update, role change). Doesn't toggle isLoadingAuth — non-blocking.
   */
  const refreshUser = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        await loadUserProfile(session.user);
      }
    } catch (err) {
      captureException(err, { msg: 'refreshUser failed:' });
    }
  };

  const checkUserAuth = async () => {
    try {
      setIsLoadingAuth(true);

      // Step 1: Read session from localStorage instantly (no network)
      const stored = readSessionFromStorage();

      if (stored?.user) {
        // CRITICAL: set isAuthenticated immediately with basic info from session.
        // This way, even if the profile fetch (loadUserProfile) is slow or hangs,
        // the user can still navigate. The profile data fills in shortly after.
        const basicUser = {
          id: stored.user.id,
          email: stored.user.email,
          full_name: stored.user.user_metadata?.full_name ?? stored.user.email?.split("@")[0] ?? "",
          role: "user",
          account_type: "passenger",
          onboarding_completed: true,  // assume true to avoid bouncing to onboarding while profile loads
        };
        setUser(basicUser);
        setIsAuthenticated(true);

        // Also seed React Query cache so any useQuery(["me"]) gets instant data instead of hanging
        try {
          queryClientInstance.setQueryData(["me"], basicUser);
        } catch {}

        // Now load full profile in the background (will overwrite the basic info)
        loadUserProfile(stored.user).catch(() => {});

        // And trigger Supabase to verify/refresh token (non-blocking)
        supabase.auth.getSession().catch(() => {});
      } else {
        // No local session — try network with timeout
        try {
          const { data: { session } } = await Promise.race([
            supabase.auth.getSession(),
            new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 5000)),
          ]);
          if (session?.user) {
            await loadUserProfile(session.user);
          } else {
            setIsAuthenticated(false);
            setUser(null);
            setAuthError({ type: 'auth_required', message: 'Authentication required' });
          }
        } catch {
          setIsAuthenticated(false);
          setUser(null);
          setAuthError({ type: 'auth_required', message: 'Authentication required' });
        }
      }
    } catch (error) {
      captureException(error, { msg: 'Auth check failed:' });
      setIsAuthenticated(false);
      setAuthError({ type: 'unknown', message: error.message });
    } finally {
      setIsLoadingAuth(false);
      setAuthChecked(true);
    }
  };

  /**
   * Sign in with email + password.
   * Called from the Login page.
   */
  const login = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    
    // Log attempt (best-effort, non-blocking)
    supabase.from('login_attempts').insert({
      email,
      success: !error,
    }).then(() => {}, () => {});
    
    if (error) {
      // User-friendly Arabic errors
      if (error.message?.includes('Invalid')) {
        throw new Error('البريد الإلكتروني أو كلمة المرور غير صحيحة');
      }
      if (error.message?.includes('Email not confirmed')) {
        throw new Error('يجب تأكيد البريد الإلكتروني أولاً. تحقق من بريدك');
      }
      if (error.message?.includes('rate limit')) {
        throw new Error('محاولات كثيرة جداً. حاول مرة أخرى بعد دقائق');
      }
      throw error;
    }
    
    // Immediately load profile so isAuthenticated=true before Login.jsx calls navigate()
    if (data.user) {
      await loadUserProfile(data.user);
    }
    return data;
  };

  /**
   * Sign up a new user.
   * Called from the Login page.
   */
  const register = async (email, password, fullName) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (error) throw error;
    return data;
  };

  const logout = async (shouldRedirect = true) => {
    await supabase.auth.signOut();
    setUser(null);
    setIsAuthenticated(false);
    setAuthChecked(false);
    if (shouldRedirect) {
      window.location.href = '/login';
    }
  };

  const navigateToLogin = () => {
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      appPublicSettings,
      authChecked,
      logout,
      login,
      register,
      navigateToLogin,
      checkUserAuth,
      checkAppState: checkUserAuth, // alias for compat
      refreshUser,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
