import { useSEO } from "@/hooks/useSEO";
import { friendlyError } from "@/lib/errors";
import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { passwordStrength, PASSWORD_MIN_LENGTH, PASSWORD_MIN_SCORE, isCommonPassword, isValidPalestinianPhone, isValidEmail, validatePasswordCompliance, passwordComplianceMessage, validatePhone, validateFullName, validateDateOfBirth, MIN_AGE_YEARS } from "@/lib/validation";
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Eye, EyeOff, Car, Mail, Lock, User, Phone, X, ArrowRight, Calendar } from 'lucide-react';
import { supabase, setRememberMe, getRememberMe } from '@/lib/supabase';
import { signInWithGoogle } from '@/lib/googleAuth';
import { Checkbox } from '@/components/ui/checkbox';
import LegalSheet from '@/components/legal/LegalSheet';
import { TERMS_LAST_UPDATED } from '@/lib/legalContent';

export default function Login() {
  useSEO({ title: "تسجيل الدخول", description: "سجل دخولك إلى حسابك في مشوارو" });

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const auth = useAuth();
  const { login, register, resendConfirmation, isAuthenticated } = auth;

  // ?signup=1 in the URL pre-selects the registration tab. Without this
  // initializer a user clicking "إنشاء حساب" anywhere in the app would
  // land on the login tab and have to switch manually.
  //
  // CRITICAL: the value MUST match the tab IDs declared at the form
  // toggle below ('login' / 'register'). Earlier this was 'signup'
  // which silently set mode to an unrecognized value — neither tab
  // lit up, and BOTH forms hid (lines below check `mode === 'login'`
  // and `mode === 'register'` strictly). Users saw a blank panel
  // between the tab strip and the footer.
  const [mode, setMode] = useState(searchParams.get('signup') === '1' ? 'register' : 'login');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);
  // Separate loading state for the Google OAuth button so its spinner
  // doesn't fight with the email/password form's `loading`. Keeping
  // them independent also means if the OAuth pop-up gets stuck (user
  // backgrounds the app during consent, etc.) the user can still try
  // the email/password path without a full page reload.
  const [googleLoading, setGoogleLoading] = useState(false);
  // Drives the inline Terms / Privacy sheet on the login screen. One
  // state for both so opening one closes the other automatically.
  // Pass "terms" / "privacy" / null. See components/legal/LegalSheet.jsx.
  const [openLegal, setOpenLegal] = useState(null);
  // Resend confirmation flow — shown when login fails with "email not confirmed"
  // OR when a fresh signup completes. Stores the email so the user doesn't
  // have to retype it.
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [resending, setResending] = useState(false);
  const [resentAt, setResentAt] = useState(0); // timestamp of last successful resend
  // Remember-me toggle. Default: read whatever the user picked last
  // time (persisted in localStorage by setRememberMe). On a fresh
  // browser this evaluates to true — most users expect to stay logged
  // in. When unchecked, the actual session token is written to
  // sessionStorage instead of localStorage, so it's cleared by the
  // browser when the tab closes.
  const [rememberMe, setRememberMeState] = useState(() => getRememberMe());
  // ─── Password recovery flow ─────────────────────────────────────────
  // The flag now lives in AuthContext (single source of truth) so it's:
  //   - Set synchronously on first render via lazy state initializer
  //     that reads window.location.hash (covers implicit-flow recovery
  //     URLs like #type=recovery before any useEffect can fire and
  //     mistakenly trigger the auto-redirect).
  //   - Set canonically via PASSWORD_RECOVERY auth event (covers PKCE
  //     flow with ?code=... query params, which can't be detected from
  //     the URL alone).
  //   - Cleared via SIGNED_OUT or USER_UPDATED (the latter fires after
  //     supabase.auth.updateUser succeeds).
  // We read it via useAuth() and treat recoveryMode as derived state.
  const recoveryMode = !!auth?.isPasswordRecovery;
  const exitPasswordRecovery = auth?.exitPasswordRecovery;
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  // Brute force protection — max 5 attempts per 15 minutes
  const getRateLimit = () => {
    try {
      const d = JSON.parse(localStorage.getItem('mishwaro_login_rl') || '{}');
      return d;
    } catch { return {}; }
  };
  const checkRateLimit = () => {
    const d = getRateLimit();
    const now = Date.now();
    if (d.until && now < d.until) return false; // blocked
    if (d.until && now >= d.until) localStorage.removeItem('mishwaro_login_rl'); // reset
    return true;
  };
  const incrementAttempts = () => {
    const d = getRateLimit();
    const attempts = (d.attempts || 0) + 1;
    if (attempts >= 5) {
      localStorage.setItem('mishwaro_login_rl', JSON.stringify({ attempts, until: Date.now() + 15 * 60 * 1000 }));
    } else {
      localStorage.setItem('mishwaro_login_rl', JSON.stringify({ attempts }));
    }
  };

  const [form, setForm] = useState(() => {
    // Pre-fill email from the last successful login so users don't have to
    // retype it after sign-out. Convenience for personal-device users (the
    // primary audience for مشوارو). Cleared explicitly by the user via the
    // X button in the email field. Password is NEVER stored.
    let savedEmail = '';
    try { savedEmail = localStorage.getItem('mishwaro_last_email') || ''; } catch {}
    return { email: savedEmail, password: '', fullName: '', phone: '', confirmPassword: '', dob: '', acceptedTerms: false };
  });

  useEffect(() => {
    // While we're in password-recovery mode, don't redirect home —
    // the user has to set a new password first. The hash already put
    // them in an authenticated state but the only allowed action is
    // updateUser({ password }).
    if (isAuthenticated && !recoveryMode) {
      // Validate returnTo — only allow internal paths (prevent open redirect)
      const raw = searchParams.get('returnTo') || '/';
      const safePath = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
      navigate(safePath, { replace: true });
    }
  }, [isAuthenticated, recoveryMode, navigate, searchParams]);

  const handleChange = (e) => setForm(p => ({ ...p, [e.target.name]: e.target.value }));

  // Sign-in-with-Google entry point. The actual flow lives in
  // lib/googleAuth.js — this handler just manages the loading state +
  // error toast. On web Supabase redirects the whole page during the
  // call, so the spinner you set here is only visible for ~200ms before
  // the redirect kicks in; on native the spinner stays up until the
  // user lands back from the system browser and the deep-link listener
  // in native.js completes setSession() (which fires onAuthStateChange,
  // which navigates the user, which unmounts this component).
  const handleGoogleSignIn = async () => {
    if (googleLoading) return;
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
      // Don't navigate from here — AuthContext.onAuthStateChange picks
      // up the new session and routes appropriately (existing user →
      // home; new user → onboarding).
    } catch (err) {
      console.warn("[Login] Google sign-in failed:", err);
      toast.error(friendlyError(err, "تعذر تسجيل الدخول عبر Google. حاول مجدداً أو استخدم البريد الإلكتروني."));
      setGoogleLoading(false);
    }
    // Intentionally NOT clearing googleLoading on success — the page
    // navigates away before the user could click again, and clearing
    // briefly would flash the button into a "ready" state during the
    // OAuth redirect. The state resets naturally on component unmount.
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    // Field-presence check BEFORE rate-limit so users who accidentally
    // submit an empty form don't burn a rate-limit slot. Same idea for
    // email format — a malformed local string never reaches the auth
    // endpoint, so it shouldn't count as an attempt.
    if (!form.email || !form.password) { toast.error('يرجى ملء جميع الحقول'); return; }
    if (!isValidEmail(form.email)) { toast.error('صيغة البريد الإلكتروني غير صحيحة'); return; }
    if (!checkRateLimit()) {
      const mins = Math.ceil((getRateLimit().until - Date.now()) / 60000);
      // Explicit "من هذا الجهاز" wording so users don't think the lock
      // is account-specific and waste time trying other emails — the
      // counter is per-device (localStorage), not per-email. Suggests
      // the password-reset flow as an out: it goes through Supabase's
      // /auth/v1/recover endpoint, which is rate-limited separately,
      // so a locked-out user can still recover access immediately
      // instead of waiting the full 15 minutes.
      toast.error(
        `محاولات تسجيل دخول كثيرة من هذا الجهاز. انتظر ${mins} دقيقة، أو استخدم "نسيت كلمة المرور؟" أدناه لاستعادة حسابك.`,
        { duration: 8000 }
      );
      return;
    }
    setLoading(true);
    try {
      // Persist the remember-me choice BEFORE the login request so the
      // storage adapter (in src/lib/supabase.js) routes the new session
      // token to the right backing store on its first write.
      setRememberMe(rememberMe);
      await login(form.email, form.password);
      // Login succeeded — clear the rate-limit counter so a future
      // typo on the next session doesn't immediately lock the user out.
      // Without this, a user at 4 attempts who finally gets in keeps
      // the counter pinned at 4 across sessions.
      try { localStorage.removeItem('mishwaro_login_rl'); } catch {}
      // Save email locally so the next visit (after sign-out) pre-fills
      // it. Password is intentionally never stored — iOS Password Autofill
      // / iCloud Keychain handle that securely if the user opts in.
      try { localStorage.setItem('mishwaro_last_email', form.email); } catch {}
      // No manual navigate here — the useEffect at top of this component watches
      // isAuthenticated and handles redirect once React has committed the new state.
      // Manual navigate caused a race: route changed before AuthContext state flushed,
      // resulting in a redirect loop where the user saw a stuck spinner until refresh.
    } catch (err) {
      setLoading(false);  // only reset loading on error; success path navigates away
      const msg = err?.message || '';
      // The most common failure mode for new users in Palestine:
      // they signed up, the confirmation email never arrived (spam, ISP
      // delays, throttling), and now they're trying to log in. Detect
      // this specific error and offer a resend instead of just toasting.
      // This case is NOT counted against the rate limit — it's a valid
      // user trying to recover, not a brute-force attempt.
      if (/email not confirmed|email_not_confirmed/i.test(msg)) {
        setConfirmEmail(form.email);
        setNeedsConfirm(true);
        return;
      }
      // Every other failure (wrong password, account doesn't exist,
      // network error) increments the rate-limit counter. Previously
      // incrementAttempts() was defined at the top of the file but
      // NEVER CALLED — so the rate limit was dead code despite the
      // comment claiming "Brute force protection — max 5 attempts per
      // 15 minutes." A malicious actor could try unlimited passwords
      // subject only to Supabase's server-side limit. Wiring this up
      // now means checkRateLimit() at the top of handleLogin will
      // actually trip after 5 bad attempts.
      incrementAttempts();
      toast.error(friendlyError(err, "فشل تسجيل الدخول"));
    }
  };

  const handleResendConfirmation = async () => {
    // Supabase rate-limits resend to 1/min by default. Disable button
    // for 60s after a successful resend so the user doesn't bash it.
    const COOLDOWN_MS = 60_000;
    if (Date.now() - resentAt < COOLDOWN_MS) {
      const remaining = Math.ceil((COOLDOWN_MS - (Date.now() - resentAt)) / 1000);
      toast.error(`يرجى الانتظار ${remaining} ثانية قبل إعادة الإرسال`);
      return;
    }
    if (!confirmEmail) { toast.error('يرجى إدخال البريد الإلكتروني'); return; }
    setResending(true);
    try {
      await resendConfirmation(confirmEmail);
      setResentAt(Date.now());
      toast.success('تم إرسال رابط التأكيد مجدداً ✓ تحقق من بريدك (وصندوق الرسائل غير المرغوب فيها)', { duration: 8000 });
    } catch (err) {
      const msg = err?.message || '';
      if (/already.*confirmed/i.test(msg)) {
        toast.success('بريدك مؤكد بالفعل! حاول تسجيل الدخول');
        setNeedsConfirm(false);
      } else if (/rate.*limit|too many/i.test(msg)) {
        toast.error('تم إرسال رسائل كثيرة. حاول بعد دقيقة');
      } else {
        toast.error(friendlyError(err, 'فشل إعادة الإرسال'));
      }
    } finally {
      setResending(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    // Run validators in order and stop at the first failure with that
    // validator's specific reason (no more "يرجى ملء جميع الحقول" — the
    // user gets told exactly what's wrong).
    const nameCheck = validateFullName(form.fullName);
    if (nameCheck.reason) { toast.error(nameCheck.reason); return; }
    if (form.phone) {
      const phoneCheck = validatePhone(form.phone);
      if (phoneCheck.reason) { toast.error(phoneCheck.reason); return; }
    }
    if (!form.email) { toast.error("يرجى إدخال البريد الإلكتروني"); return; }
    if (!isValidEmail(form.email)) { toast.error("صيغة البريد الإلكتروني غير صحيحة"); return; }
    // Age gate (App Store / Play Store requirement for rideshare apps).
    // Stated in Terms section 3; enforced here client-side and at the
    // database layer via a CHECK constraint in migration 058. Both
    // matter — the client check gives a helpful Arabic toast, the DB
    // check stops API-direct signup bypass attempts.
    const dobCheck = validateDateOfBirth(form.dob);
    if (!dobCheck.ok) { toast.error(dobCheck.reason); return; }
    if (!form.password) { toast.error("يرجى إدخال كلمة المرور"); return; }
    if (form.password !== form.confirmPassword) { toast.error('كلمتا المرور غير متطابقتين'); return; }
    // Mandatory check: password must satisfy Supabase's server-side policy
    // (lowercase + uppercase + digit + min length). Without this, users get
    // a generic "failed" toast after Supabase rejects the signup with HTTP
    // 422 weak_password — the #1 mysterious-signup-failure cause in prod.
    // Showing the EXACT missing requirements client-side prevents the
    // round-trip and gives users actionable feedback.
    const compliance = validatePasswordCompliance(form.password);
    if (compliance.missing.length > 0) {
      toast.error(passwordComplianceMessage(compliance), { duration: 7000 });
      return;
    }
    if (isCommonPassword(form.password)) {
      toast.error('هذه كلمة مرور شائعة جداً وغير آمنة. اختر كلمة مرور أصعب');
      return;
    }
    // Explicit consent — required for App Store. We render a checkbox
    // alongside the existing "بالتسجيل، أنت توافق على..." paragraph
    // (which alone is "consent through action", borderline-acceptable
    // but Apple prefers explicit). The checkbox state is stamped onto
    // the profile row with the current Terms version so we can prove
    // which version the user agreed to at signup time. If we ever
    // materially change Terms, we can detect users whose accepted
    // version < current and re-prompt them.
    if (!form.acceptedTerms) {
      toast.error("يجب الموافقة على شروط الاستخدام وسياسة الخصوصية للمتابعة");
      return;
    }
    setLoading(true);
    try {
      // Note: passwordStrength score check removed. The compliance check
      // above is mandatory and matches Supabase's server policy exactly.
      // The strength score was advisory — adding 1 point for special chars
      // — but it caused false-positive REJECTIONS when users had a 12-char
      // password without uppercase that scored 4 here but failed Supabase.
      await register(form.email, form.password, {
        full_name: form.fullName,
        dob: form.dob,
        terms_version: TERMS_LAST_UPDATED,
        terms_accepted_at: new Date().toISOString(),
      });
      // Success — but they still need to confirm their email. Switch the
      // UI to the resend panel with their email pre-filled, so if the
      // confirmation never arrives they can immediately resend instead
      // of getting stuck on a login that won't work.
      setConfirmEmail(form.email);
      setNeedsConfirm(true);
      setResentAt(Date.now()); // start the cooldown — first email was just sent
      setForm(p => ({ ...p, password: '', confirmPassword: '' }));
    } catch (err) {
      toast.error(friendlyError(err, "فشل إنشاء الحساب"));
    } finally { setLoading(false); }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    if (!forgotEmail) { toast.error('يرجى إدخال البريد الإلكتروني'); return; }
    try {
      await supabase.auth.resetPasswordForEmail(forgotEmail, {
        redirectTo: window.location.origin + '/login',
      });
      setForgotSent(true);
    } catch (err) {
      toast.error(friendlyError(err, 'تعذر إرسال رابط الاستعادة — تأكد من البريد الإلكتروني'));
    }
  };

  /**
   * Set the user's password during the recovery flow.
   *
   * Triggered after the user clicked the link in a "Reset Password"
   * email — by this point Supabase has already validated the token,
   * and they have a recovery session that allows updateUser({ password }).
   *
   * Same compliance check as signup, so the new password meets
   * Supabase's server-side policy (lowercase + uppercase + digit + 8
   * chars). Without this, the server would reject the update with a
   * generic error and the user would be stuck on the recovery page.
   *
   * After success, we clear the URL hash (so a refresh doesn't re-enter
   * recovery mode) and navigate to home where the user is now logged in.
   */
  const handleUpdatePassword = async (e) => {
    e.preventDefault();
    if (newPassword !== newPasswordConfirm) {
      toast.error('كلمتا المرور غير متطابقتين');
      return;
    }
    const compliance = validatePasswordCompliance(newPassword);
    if (compliance.missing.length > 0) {
      toast.error(passwordComplianceMessage(compliance), { duration: 7000 });
      return;
    }
    if (isCommonPassword(newPassword)) {
      toast.error('هذه كلمة مرور شائعة جداً وغير آمنة. اختر كلمة مرور أصعب');
      return;
    }
    setUpdatingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success('تم تغيير كلمة المرور بنجاح! 🎉', { duration: 5000 });
      // Clear the recovery hash so a refresh doesn't re-trigger this UI
      window.history.replaceState(null, '', window.location.pathname);
      // USER_UPDATED auth event will clear the recovery flag and
      // transition isAuthenticated to true — but we also call the
      // explicit exit here so navigation happens immediately without
      // racing the event listener.
      exitPasswordRecovery?.();
      setNewPassword('');
      setNewPasswordConfirm('');
      navigate('/', { replace: true });
    } catch (err) {
      toast.error(friendlyError(err, 'تعذر تغيير كلمة المرور — حاول مجدداً'));
    } finally {
      setUpdatingPassword(false);
    }
  };

  /** Cancel the recovery flow — sign out and return to a clean login. */
  const cancelRecovery = async () => {
    try { await supabase.auth.signOut(); } catch { /* ignore */ }
    window.history.replaceState(null, '', window.location.pathname);
    // SIGNED_OUT auth event will clear the recovery flag, but call
    // the explicit exit too in case signOut errored or the listener
    // hasn't propagated yet.
    exitPasswordRecovery?.();
    setNewPassword('');
    setNewPasswordConfirm('');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4" dir="rtl">
      <div className="w-full max-w-md">
        {/* Back to home link */}
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300 hover:text-primary dark:hover:text-primary mb-6 transition-colors"
        >
          <ArrowRight className="w-4 h-4" />
          <span>العودة للرئيسية</span>
        </Link>

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Car className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">مشوارو</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">منصة مشاركة الرحلات</p>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl p-8 border border-slate-100 dark:border-slate-800">
          {/* Password recovery panel — shown when user lands here from
              a "Reset Password" email link. Supabase has already
              authenticated them via the token, but the only allowed
              action right now is updating the password. We render a
              dedicated form with the same live requirements indicator
              the signup uses, so the UX is consistent and the user
              can't pick a noncompliant password. */}
          {recoveryMode && (
            <div className="space-y-4">
              <div className="text-center">
                <div className="w-14 h-14 mx-auto bg-primary/10 rounded-2xl flex items-center justify-center mb-3">
                  <Lock className="w-7 h-7 text-primary" />
                </div>
                <h3 className="font-bold text-lg text-slate-900 dark:text-white mb-1">
                  اختر كلمة مرور جديدة
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  اكتب كلمة المرور الجديدة لحسابك في مشوارو. ستستخدمها لتسجيل الدخول من الآن.
                </p>
              </div>
              <form onSubmit={handleUpdatePassword} className="space-y-4">
                <div>
                  <Label className="mb-1.5 block flex items-center justify-between">
                    <span>كلمة المرور الجديدة</span>
                    <span className="text-[10px] font-normal text-slate-500">(انظر المتطلبات أدناه)</span>
                  </Label>
                  <div className="relative">
                    <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                      type={showNewPassword ? 'text' : 'password'}
                      placeholder="مثال: Mishwar123"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="pr-10 pl-10"
                      autoComplete="new-password"
                      autoFocus
                    />
                    <button type="button" onClick={() => setShowNewPassword(!showNewPassword)}
                      aria-label={showNewPassword ? "إخفاء كلمة المرور الجديدة" : "إظهار كلمة المرور الجديدة"}
                      aria-pressed={showNewPassword}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      {showNewPassword ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
                    </button>
                  </div>
                  {/* Same live requirements indicator used by signup —
                      keeps the password UX consistent across flows. */}
                  {(() => {
                    const c = validatePasswordCompliance(newPassword);
                    const allMet = newPassword && c.missing.length === 0;
                    const Item = ({ ok, text }) => (
                      <span className={`text-[11px] flex items-center gap-1.5 ${ok ? 'text-green-700 dark:text-green-400' : 'text-slate-600 dark:text-slate-400'}`}>
                        <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold shrink-0 ${ok ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-slate-200 text-slate-400 dark:bg-slate-700 dark:text-slate-500'}`}>
                          {ok ? '✓' : '○'}
                        </span>
                        {text}
                      </span>
                    );
                    return (
                      <div className={`mt-2 rounded-xl border p-3 transition-colors ${allMet ? 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900' : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700'}`}>
                        <p className="text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-2">
                          متطلبات كلمة المرور:
                        </p>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                          <Item ok={c.longEnough} text={`${PASSWORD_MIN_LENGTH} أحرف على الأقل`} />
                          <Item ok={c.hasUpper}   text="حرف كبير (A-Z)" />
                          <Item ok={c.hasLower}   text="حرف صغير (a-z)" />
                          <Item ok={c.hasDigit}   text="رقم (0-9)" />
                        </div>
                      </div>
                    );
                  })()}
                </div>
                <div>
                  <Label className="mb-1.5 block">تأكيد كلمة المرور الجديدة</Label>
                  <div className="relative">
                    <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                      type={showNewPassword ? 'text' : 'password'}
                      placeholder="أعد كتابة كلمة المرور"
                      value={newPasswordConfirm}
                      onChange={(e) => setNewPasswordConfirm(e.target.value)}
                      className="pr-10"
                      autoComplete="new-password"
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full h-11 text-base" disabled={updatingPassword}>
                  {updatingPassword
                    ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    : 'تحديث كلمة المرور'}
                </Button>
                <button
                  type="button"
                  onClick={cancelRecovery}
                  className="text-sm text-primary hover:underline w-full text-center"
                >
                  إلغاء
                </button>
              </form>
            </div>
          )}

          {/* Email confirmation panel — shown after a fresh signup OR
              when login fails because the user hasn't confirmed yet.
              Critical for the Palestinian-region case where confirmation
              emails are often delayed or routed to spam, leaving users
              stuck. The "Did not receive?" resend button + spam-folder
              hint cover ~95% of the support burden. */}
          {!recoveryMode && needsConfirm && (
            <div className="space-y-4">
              <div className="text-center">
                <div className="w-14 h-14 mx-auto bg-primary/10 rounded-2xl flex items-center justify-center mb-3">
                  <Mail className="w-7 h-7 text-primary" />
                </div>
                <h3 className="font-bold text-lg text-slate-900 dark:text-white mb-1">
                  تحقق من بريدك الإلكتروني
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  أرسلنا رابط تأكيد إلى <span className="font-bold text-foreground" dir="ltr">{confirmEmail}</span>.
                  انقر على الرابط لتفعيل حسابك.
                </p>
              </div>
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-xl p-3">
                <p className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
                  <strong>لم تجد الرسالة؟</strong> تحقق من مجلد <strong>الرسائل غير المرغوب فيها (Spam)</strong> — وأحياناً تستغرق الرسالة بضع دقائق للوصول.
                </p>
              </div>
              <div>
                <Label className="mb-1.5 block">البريد الإلكتروني</Label>
                <div className="relative">
                  <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    type="email"
                    placeholder="example@email.com"
                    value={confirmEmail}
                    onChange={(e) => setConfirmEmail(e.target.value)}
                    className="pr-10 text-left"
                    dir="ltr"
                    autoComplete="email"
                  />
                </div>
              </div>
              <Button
                onClick={handleResendConfirmation}
                disabled={resending || !confirmEmail}
                className="w-full"
              >
                {resending ? 'جاري الإرسال...' : 'إعادة إرسال رابط التأكيد'}
              </Button>
              <button
                type="button"
                onClick={() => { setNeedsConfirm(false); setMode('login'); }}
                className="text-sm text-primary hover:underline w-full text-center"
              >
                العودة لتسجيل الدخول
              </button>
            </div>
          )}

          {/* Google sign-in — appears above the email/password tabs so
              it's the first thing visible after the tabs. Hidden during
              recovery (Supabase has already authenticated the user via
              the reset token; the only allowed action is updating the
              password) and during the email-confirmation reminder
              (which is specific to email/password signups; Google
              accounts arrive pre-verified). */}
          {!recoveryMode && !needsConfirm && (
            <>
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={googleLoading || loading}
                className="w-full flex items-center justify-center gap-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 active:bg-slate-100 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                aria-label="تسجيل الدخول عبر Google"
              >
                {googleLoading ? (
                  <div className="w-4 h-4 border-2 border-slate-400/30 border-t-slate-700 rounded-full animate-spin" />
                ) : (
                  // Inline SVG — avoids pulling in a brand-icon library
                  // just for one button. The four-color G is Google's
                  // official mark; spec ref: developers.google.com/
                  // identity/branding-guidelines.
                  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                    <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                    <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
                    <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                    <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                  </svg>
                )}
                <span>{googleLoading ? "جاري التحويل..." : "متابعة عبر Google"}</span>
              </button>

              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                <span className="text-xs text-slate-400 dark:text-slate-500">أو</span>
                <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
              </div>
            </>
          )}

          {/* Tabs */}
          {!recoveryMode && !needsConfirm && (
          <div className="flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 mb-6">
            {['login', 'register'].map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${mode === m ? 'bg-white dark:bg-slate-700 shadow text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>
                {m === 'login' ? 'تسجيل الدخول' : 'إنشاء حساب'}
              </button>
            ))}
          </div>
          )}

          {/* Login Form */}
          {!recoveryMode && !needsConfirm && mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <Label htmlFor="login-email" className="mb-1.5 block">البريد الإلكتروني</Label>
                <div className="relative">
                  <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden="true" />
                  <Input id="login-email" name="email" type="email" placeholder="example@email.com"
                    value={form.email} onChange={handleChange} className="pr-10 text-left" dir="ltr" autoComplete="email" />
                </div>
              </div>
              <div>
                <Label htmlFor="login-password" className="mb-1.5 block">كلمة المرور</Label>
                <div className="relative">
                  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden="true" />
                  <Input id="login-password" name="password" type={showPassword ? 'text' : 'password'} placeholder="••••••••"
                    value={form.password} onChange={handleChange} className="pr-10 pl-10" autoComplete="current-password" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                    aria-pressed={showPassword}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    {showPassword ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
                  </button>
                </div>
              </div>
              {/* Remember me — when checked, session persists in
                  localStorage across browser restarts (default).
                  When unchecked, session is written to sessionStorage
                  and is cleared when the browser closes. The choice
                  is persisted across visits. */}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="remember-me"
                  checked={rememberMe}
                  onCheckedChange={(v) => setRememberMeState(v === true)}
                />
                <label
                  htmlFor="remember-me"
                  className="text-sm text-slate-700 dark:text-slate-300 cursor-pointer select-none"
                >
                  تذكرني على هذا الجهاز
                </label>
              </div>
              <Button type="submit" className="w-full h-11 text-base" disabled={loading}>
                {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'تسجيل الدخول'}
              </Button>
              <button type="button" onClick={() => setShowForgot(true)}
                className="text-sm text-primary hover:underline text-center w-full">
                نسيت كلمة المرور؟
              </button>
            </form>
          )}

          {/* Register Form */}
          {!recoveryMode && !needsConfirm && mode === 'register' && (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <Label className="mb-1.5 block">الاسم الكامل</Label>
                <div className="relative">
                  <User className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input name="fullName" type="text" placeholder="محمد أحمد"
                    value={form.fullName} onChange={handleChange} className="pr-10" autoComplete="name" />
                </div>
                {/* Live name validation — only shows when there's an
                    issue with the typed value. Doesn't clutter the form
                    when the name is fine. Tells user EXACTLY what's wrong
                    rather than the generic "fill all fields" toast. */}
                {form.fullName && (() => {
                  const c = validateFullName(form.fullName);
                  if (!c.reason) {
                    return (
                      <p className="text-[11px] text-green-600 dark:text-green-400 mt-1.5 flex items-center gap-1">
                        <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-green-100 dark:bg-green-900/40 text-[9px] font-bold">✓</span>
                        اسم صالح
                      </p>
                    );
                  }
                  return (
                    <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1.5 flex items-center gap-1">
                      <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-[9px] font-bold">!</span>
                      {c.reason}
                    </p>
                  );
                })()}
                {!form.fullName && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
                    استخدم اسمك الحقيقي بالعربية أو الإنجليزية (حرفان على الأقل)
                  </p>
                )}
              </div>
              <div>
                <Label className="mb-1.5 block flex items-center justify-between">
                  <span>رقم الهاتف <span className="text-[10px] font-normal text-slate-500">(اختياري)</span></span>
                </Label>
                <div className="relative">
                  <Phone className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input name="phone" type="tel" placeholder="059XXXXXXX أو +970591234567"
                    value={form.phone} onChange={handleChange} className="pr-10 text-left" dir="ltr" autoComplete="tel" />
                </div>
                {/* Live phone validation — same pattern as name. Shows a
                    green check + "Palestinian format" badge when the
                    user enters a recognizable PS number, neutral OK for
                    other valid international numbers, and a specific
                    Arabic reason when the input is malformed. */}
                {form.phone && (() => {
                  const c = validatePhone(form.phone);
                  if (c.reason) {
                    return (
                      <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1.5 flex items-center gap-1">
                        <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-[9px] font-bold">!</span>
                        {c.reason}
                      </p>
                    );
                  }
                  if (c.looksPalestinian) {
                    return (
                      <p className="text-[11px] text-green-600 dark:text-green-400 mt-1.5 flex items-center gap-1">
                        <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-green-100 dark:bg-green-900/40 text-[9px] font-bold">✓</span>
                        رقم فلسطيني صالح
                      </p>
                    );
                  }
                  return (
                    <p className="text-[11px] text-green-600 dark:text-green-400 mt-1.5 flex items-center gap-1">
                      <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-green-100 dark:bg-green-900/40 text-[9px] font-bold">✓</span>
                      رقم دولي صالح
                    </p>
                  );
                })()}
                {!form.phone && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
                    مثل: 0591234567 أو ‎+970 لرقم فلسطيني، أو رقم دولي بصيغة E.164
                  </p>
                )}
              </div>
              <div>
                <Label className="mb-1.5 block flex items-center justify-between">
                  <span>تاريخ الميلاد</span>
                  <span className="text-[10px] font-normal text-slate-500">({MIN_AGE_YEARS}+ سنة)</span>
                </Label>
                <div className="relative">
                  <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  <Input
                    name="dob"
                    type="date"
                    value={form.dob}
                    onChange={handleChange}
                    /* `max` = 18 years ago today, so the native iOS/Android
                       picker won't even let the user scroll to a date that
                       would make them under-age. We still validate in JS
                       on submit because the server-side check enforces
                       the same rule regardless. */
                    max={(() => {
                      const d = new Date();
                      d.setFullYear(d.getFullYear() - MIN_AGE_YEARS);
                      return d.toISOString().split("T")[0];
                    })()}
                    /* `min` = 120 years ago, sanity floor. */
                    min={(() => {
                      const d = new Date();
                      d.setFullYear(d.getFullYear() - 120);
                      return d.toISOString().split("T")[0];
                    })()}
                    className="pr-10 text-left"
                    dir="ltr"
                    autoComplete="bday"
                  />
                </div>
                {form.dob && (() => {
                  const c = validateDateOfBirth(form.dob);
                  if (!c.ok) {
                    return (
                      <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1.5 flex items-center gap-1">
                        <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-[9px] font-bold">!</span>
                        {c.reason}
                      </p>
                    );
                  }
                  return (
                    <p className="text-[11px] text-green-600 dark:text-green-400 mt-1.5 flex items-center gap-1">
                      <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-green-100 dark:bg-green-900/40 text-[9px] font-bold">✓</span>
                      العمر: {c.age} سنة
                    </p>
                  );
                })()}
                {!form.dob && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
                    لاستخدام مشوارو يجب أن يكون عمرك {MIN_AGE_YEARS} سنة أو أكثر
                  </p>
                )}
              </div>
              <div>
                <Label className="mb-1.5 block">البريد الإلكتروني</Label>
                <div className="relative">
                  <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input name="email" type="email" placeholder="example@email.com"
                    value={form.email} onChange={handleChange} className="pr-10 text-left" dir="ltr" autoComplete="email" />
                </div>
              </div>
              <div>
                <Label className="mb-1.5 block flex items-center justify-between">
                  <span>كلمة المرور</span>
                  <span className="text-[10px] font-normal text-slate-500">(انظر المتطلبات أدناه)</span>
                </Label>
                <div className="relative">
                  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden="true" />
                  <Input name="password" type={showPassword ? 'text' : 'password'} placeholder="مثال: Mishwar123"
                    value={form.password} onChange={handleChange} className="pr-10 pl-10" autoComplete="new-password" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                    aria-pressed={showPassword}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    {showPassword ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
                  </button>
                </div>
                {/* Password requirements panel — ALWAYS visible (not gated
                    on form.password being non-empty). Users need to know
                    the rules BEFORE they start typing, not discover them
                    after a failure. The 4 items turn green as each is met,
                    so the panel doubles as a live progress indicator.
                    The static heading makes it clear this is the spec.

                    Specifically prevents the previous failure mode where
                    users typed e.g. "khaled@1994", saw no requirements
                    upfront, hit submit, and got a rejection. */}
                {(() => {
                  const c = validatePasswordCompliance(form.password);
                  const allMet = form.password && c.missing.length === 0;
                  const Item = ({ ok, text }) => (
                    <span className={`text-[11px] flex items-center gap-1.5 ${ok ? 'text-green-700 dark:text-green-400' : 'text-slate-600 dark:text-slate-400'}`}>
                      <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold shrink-0 ${ok ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-slate-200 text-slate-400 dark:bg-slate-700 dark:text-slate-500'}`}>
                        {ok ? '✓' : '○'}
                      </span>
                      {text}
                    </span>
                  );
                  return (
                    <div className={`mt-2 rounded-xl border p-3 transition-colors ${allMet ? 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900' : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700'}`}>
                      <p className="text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-2">
                        متطلبات كلمة المرور:
                      </p>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                        <Item ok={c.longEnough} text={`${PASSWORD_MIN_LENGTH} أحرف على الأقل`} />
                        <Item ok={c.hasUpper}   text="حرف كبير (A-Z)" />
                        <Item ok={c.hasLower}   text="حرف صغير (a-z)" />
                        <Item ok={c.hasDigit}   text="رقم (0-9)" />
                      </div>
                    </div>
                  );
                })()}
              </div>
              <div>
                <Label className="mb-1.5 block">تأكيد كلمة المرور</Label>
                <div className="relative">
                  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input name="confirmPassword" type={showPassword ? 'text' : 'password'} placeholder="أعد كتابة كلمة المرور"
                    value={form.confirmPassword} onChange={handleChange} className="pr-10" autoComplete="new-password" />
                </div>
              </div>
              {/* Required consent checkbox. Apple guideline 5.1.1 (Data
                  Collection and Storage) prefers explicit consent — a
                  checkbox the user actively ticks — over consent-through-
                  action (e.g. "by signing up you agree to..."). Both
                  patterns can pass review but explicit is safer for a
                  rideshare app, which collects identity-level PII.

                  The footer paragraph below this form (existing) still
                  shows the links for users who want to read first; this
                  checkbox is the explicit acceptance. The on-submit
                  handler enforces the check — we don't disable the
                  button itself so the user can click and see a clear
                  toast explaining the requirement. */}
              <label
                htmlFor="acceptedTerms"
                className="flex items-start gap-2.5 cursor-pointer select-none min-h-[44px] py-2"
              >
                <Checkbox
                  id="acceptedTerms"
                  checked={form.acceptedTerms}
                  onCheckedChange={(checked) =>
                    setForm(p => ({ ...p, acceptedTerms: checked === true }))
                  }
                  className="mt-0.5 shrink-0"
                />
                <span className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  أوافق على{" "}
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); setOpenLegal("terms"); }}
                    className="underline underline-offset-2 text-primary font-medium"
                  >
                    شروط الاستخدام
                  </button>
                  {" "}و
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); setOpenLegal("privacy"); }}
                    className="underline underline-offset-2 text-primary font-medium"
                  >
                    سياسة الخصوصية
                  </button>
                </span>
              </label>
              <Button type="submit" className="w-full h-11 text-base" disabled={loading}>
                {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'إنشاء الحساب'}
              </Button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          بالتسجيل، أنت توافق على{" "}
          <button
            type="button"
            onClick={() => setOpenLegal("terms")}
            className="underline underline-offset-2 text-slate-500 hover:text-primary active:text-primary font-medium"
          >
            شروط الاستخدام
          </button>
          {" "}و
          <button
            type="button"
            onClick={() => setOpenLegal("privacy")}
            className="underline underline-offset-2 text-slate-500 hover:text-primary active:text-primary font-medium"
          >
            سياسة الخصوصية
          </button>
        </p>
      </div>

      {/* Inline Terms / Privacy sheet. Renders nothing while openLegal
          is null. Lives outside the form card so form state is
          preserved across opens/closes — a user can tap "شروط
          الاستخدام", read, close, and return to a fully-filled
          signup form. */}
      <LegalSheet kind={openLegal} onClose={() => setOpenLegal(null)} />

      {/* Forgot Password Modal — outside the card, always rendered when needed */}
      {showForgot && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg">استعادة كلمة المرور</h3>
              <button onClick={() => { setShowForgot(false); setForgotSent(false); }}
                className="p-1 rounded-lg hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            {forgotSent ? (
              <div className="text-center py-4">
                <div className="text-5xl mb-3">📧</div>
                <p className="font-medium mb-1">تم إرسال الرابط!</p>
                <p className="text-sm text-slate-500">تحقق من بريدك الإلكتروني واتبع الرابط لإعادة تعيين كلمة المرور</p>
                <button onClick={() => { setShowForgot(false); setForgotSent(false); }}
                  className="mt-4 text-sm text-primary hover:underline">إغلاق</button>
              </div>
            ) : (
              <form onSubmit={handleForgotPassword}>
                <p className="text-sm text-slate-500 mb-3">أدخل بريدك الإلكتروني وسنرسل لك رابط إعادة التعيين</p>
                <Input type="email" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)}
                  placeholder="example@email.com" dir="ltr" className="mb-3 text-left" />
                <div className="flex gap-2">
                  <Button type="submit" className="flex-1 rounded-xl">إرسال الرابط</Button>
                  <Button type="button" variant="outline" className="rounded-xl"
                    onClick={() => setShowForgot(false)}>إلغاء</Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
