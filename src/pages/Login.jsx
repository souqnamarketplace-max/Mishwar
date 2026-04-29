import { useSEO } from "@/hooks/useSEO";
import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { passwordStrength, isValidPalestinianPhone, isValidEmail } from "@/lib/validation";
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Eye, EyeOff, Car, Mail, Lock, User, Phone, X, ArrowRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export default function Login() {
  useSEO({ title: "تسجيل الدخول", description: "سجل دخولك إلى حسابك في مِشوار" });

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login, register, isAuthenticated } = useAuth();

  const [mode, setMode] = useState(searchParams.get('signup') === '1' ? 'signup' : 'login');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);

  const [form, setForm] = useState({
    email: '', password: '', fullName: '', phone: '', confirmPassword: '',
  });

  useEffect(() => {
    if (isAuthenticated) {
      navigate(searchParams.get('returnTo') || '/', { replace: true });
    }
  }, [isAuthenticated, navigate, searchParams]);

  const handleChange = (e) => setForm(p => ({ ...p, [e.target.name]: e.target.value }));

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!form.email || !form.password) { toast.error('يرجى ملء جميع الحقول'); return; }
    setLoading(true);
    try {
      await login(form.email, form.password);
      // No manual navigate here — the useEffect at top of this component watches
      // isAuthenticated and handles redirect once React has committed the new state.
      // Manual navigate caused a race: route changed before AuthContext state flushed,
      // resulting in a redirect loop where the user saw a stuck spinner until refresh.
    } catch (err) {
      setLoading(false);  // only reset loading on error; success path navigates away
      toast.error(err.message === 'Invalid login credentials'
        ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة'
        : err.message || 'فشل تسجيل الدخول');
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!form.email || !form.password || !form.fullName) { toast.error('يرجى ملء جميع الحقول'); return; }
    if (form.password !== form.confirmPassword) { toast.error('كلمتا المرور غير متطابقتين'); return; }
    if (form.password.length < 6) { toast.error('كلمة المرور 6 أحرف على الأقل'); return; }
    setLoading(true);
    try {
      if (form.phone && !isValidPalestinianPhone(form.phone)) {
        toast.error("رقم الهاتف غير صحيح. مثال: 0599123456");
        setLoading(false);
        return;
      }
      if (passwordStrength(form.password).score < 2) {
        toast.error("كلمة المرور ضعيفة جداً. استخدم 8 أحرف على الأقل مع أرقام");
        setLoading(false);
        return;
      }
      await register(form.email, form.password, form.fullName);
      toast.success("تم إنشاء حسابك بنجاح! تحقق من بريدك الإلكتروني لتأكيد الحساب 📧", { duration: 6000 });
      setMode('login');
      setForm(p => ({ ...p, password: '', confirmPassword: '' }));
    } catch (err) {
      toast.error(err.message || 'فشل إنشاء الحساب');
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
    } catch {
      toast.error('حدث خطأ. تأكد من البريد الإلكتروني');
    }
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
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">مِشوار</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">منصة مشاركة الرحلات</p>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl p-8 border border-slate-100 dark:border-slate-800">
          {/* Tabs */}
          <div className="flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 mb-6">
            {['login', 'register'].map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${mode === m ? 'bg-white dark:bg-slate-700 shadow text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>
                {m === 'login' ? 'تسجيل الدخول' : 'إنشاء حساب'}
              </button>
            ))}
          </div>

          {/* Login Form */}
          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <Label className="mb-1.5 block">البريد الإلكتروني</Label>
                <div className="relative">
                  <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input name="email" type="email" placeholder="example@email.com"
                    value={form.email} onChange={handleChange} className="pr-10 text-left" dir="ltr" autoComplete="email" />
                </div>
              </div>
              <div>
                <Label className="mb-1.5 block">كلمة المرور</Label>
                <div className="relative">
                  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input name="password" type={showPassword ? 'text' : 'password'} placeholder="••••••••"
                    value={form.password} onChange={handleChange} className="pr-10 pl-10" autoComplete="current-password" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
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
          {mode === 'register' && (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <Label className="mb-1.5 block">الاسم الكامل</Label>
                <div className="relative">
                  <User className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input name="fullName" type="text" placeholder="محمد أحمد"
                    value={form.fullName} onChange={handleChange} className="pr-10" autoComplete="name" />
                </div>
              </div>
              <div>
                <Label className="mb-1.5 block">رقم الهاتف (واتساب)</Label>
                <div className="relative">
                  <Phone className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input name="phone" type="tel" placeholder="05XXXXXXXX"
                    value={form.phone} onChange={handleChange} className="pr-10 text-left" dir="ltr" autoComplete="tel" />
                </div>
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
                <Label className="mb-1.5 block">كلمة المرور</Label>
                <div className="relative">
                  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input name="password" type={showPassword ? 'text' : 'password'} placeholder="6 أحرف على الأقل"
                    value={form.password} onChange={handleChange} className="pr-10 pl-10" autoComplete="new-password" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <Label className="mb-1.5 block">تأكيد كلمة المرور</Label>
                <div className="relative">
                  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input name="confirmPassword" type={showPassword ? 'text' : 'password'} placeholder="أعد كتابة كلمة المرور"
                    value={form.confirmPassword} onChange={handleChange} className="pr-10" autoComplete="new-password" />
                </div>
              </div>
              <Button type="submit" className="w-full h-11 text-base" disabled={loading}>
                {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'إنشاء الحساب'}
              </Button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          بالتسجيل، أنت توافق على شروط الاستخدام وسياسة الخصوصية
        </p>
      </div>

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
