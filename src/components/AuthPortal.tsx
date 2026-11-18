import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  GraduationCap,
  KeyRound,
  Moon,
  Phone,
  Sun,
} from 'lucide-react';
import { saasApi } from '../lib/api';
import type { AuthSessionInfo } from '../shared/types';

interface AuthPortalProps {
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onAuthenticated: (session: AuthSessionInfo) => void;
}

type AuthPortalView = 'signin' | 'forgot-request' | 'forgot-verify';

export function AuthPortal({
  darkMode,
  onToggleDarkMode,
  onAuthenticated,
}: AuthPortalProps) {
  const [view, setView] = useState<AuthPortalView>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Phone-authenticated password reset state
  const [resetEmail, setResetEmail] = useState('');
  const [resetPhone, setResetPhone] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [maskedPhone, setMaskedPhone] = useState('');
  const [demoOtpHint, setDemoOtpHint] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !password) {
      setErrorMsg('Enter your email and password.');
      return;
    }
    setSubmitting(true);
    try {
      const session = await saasApi.login({
        email: trimmedEmail,
        password,
      });
      onAuthenticated(session);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  }

  function openForgotPassword() {
    setErrorMsg(null);
    setSuccessMsg(null);
    setResetEmail(email.trim().toLowerCase());
    setResetPhone('');
    setResetCode('');
    setResetNewPassword('');
    setResetConfirmPassword('');
    setMaskedPhone('');
    setDemoOtpHint('');
    setView('forgot-request');
  }

  async function handleRequestPhoneCode(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    const cleanEmail = resetEmail.trim().toLowerCase();
    const cleanPhone = resetPhone.trim();
    if (!cleanEmail || !cleanPhone) {
      setErrorMsg('Enter both your account email and registered phone number.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await saasApi.requestPasswordResetByPhone({
        email: cleanEmail,
        phone: cleanPhone,
      });
      setMaskedPhone(res.maskedPhone);
      setDemoOtpHint(res.verificationCode);
      setResetCode('');
      setView('forgot-verify');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to verify phone number.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyPhoneReset(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (!resetCode.trim()) {
      setErrorMsg('Enter the 6-digit phone verification code.');
      return;
    }
    if (resetNewPassword.length < 8) {
      setErrorMsg('New password must be at least 8 characters.');
      return;
    }
    if (resetNewPassword !== resetConfirmPassword) {
      setErrorMsg('New password and confirmation do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const cleanEmail = resetEmail.trim().toLowerCase();
      await saasApi.verifyPasswordResetByPhone({
        email: cleanEmail,
        phone: resetPhone.trim(),
        code: resetCode.trim(),
        newPassword: resetNewPassword,
      });
      setEmail(cleanEmail);
      setPassword('');
      setSuccessMsg('Password reset verified via phone. Sign in with your new password.');
      setView('signin');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to reset password.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-10 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <button
        type="button"
        onClick={onToggleDarkMode}
        aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
        className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>

      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-7 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white">
            <GraduationCap className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
              elimuNest
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {view === 'signin'
                ? 'Account Sign In'
                : 'Reset Forgotten Password'}
            </p>
          </div>
        </div>

        {successMsg && (
          <div
            role="status"
            className="mt-5 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-medium text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
          >
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div
            role="alert"
            className="mt-5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
          >
            {errorMsg}
          </div>
        )}

        {view === 'signin' && (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="unified-login-email"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Email
              </label>
              <input
                id="unified-login-email"
                type="email"
                required
                autoFocus
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@domain"
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label
                  htmlFor="unified-login-password"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Password
                </label>
                <button
                  type="button"
                  onClick={openForgotPassword}
                  className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative mt-1.5">
                <input
                  id="unified-login-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 pr-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              <span>{submitting ? 'Signing in...' : 'Sign In'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>
        )}

        {view === 'forgot-request' && (
          <form onSubmit={handleRequestPhoneCode} className="mt-6 space-y-4">
            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              Verify your registered phone number to receive a 6-digit SMS code and reset your password.
            </p>

            <div>
              <label
                htmlFor="reset-email"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Account Email
              </label>
              <input
                id="reset-email"
                type="email"
                required
                autoFocus
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                placeholder="name@school.ac.ke"
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <div>
              <label
                htmlFor="reset-phone"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Registered Phone Number
              </label>
              <div className="relative mt-1.5">
                <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="reset-phone"
                  type="tel"
                  required
                  value={resetPhone}
                  onChange={(e) => setResetPhone(e.target.value)}
                  placeholder="+254 712 345 678"
                  className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3.5 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              <span>{submitting ? 'Verifying phone...' : 'Send Verification Code'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => {
                setErrorMsg(null);
                setView('signin');
              }}
              className="inline-flex w-full items-center justify-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Sign In
            </button>
          </form>
        )}

        {view === 'forgot-verify' && (
          <form onSubmit={handleVerifyPhoneReset} className="mt-6 space-y-4">
            <div className="rounded-lg border border-blue-200 bg-blue-50/70 px-3.5 py-2.5 text-xs text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200">
              <p className="font-semibold">
                Phone Verified: <span className="font-mono">{maskedPhone}</span>
              </p>
              <p className="mt-0.5 text-[11px] text-blue-800/90 dark:text-blue-300/90">
                Verification code dispatched via SMS:{' '}
                <span className="font-mono font-bold tracking-wider">{demoOtpHint}</span>
              </p>
            </div>

            <div>
              <label
                htmlFor="reset-otp-code"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                6-Digit SMS Verification Code
              </label>
              <input
                id="reset-otp-code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                required
                autoFocus
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value)}
                placeholder="123456"
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 font-mono text-sm tracking-widest text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <div>
              <label
                htmlFor="reset-new-password"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                New Password (min 8 chars)
              </label>
              <div className="relative mt-1.5">
                <input
                  id="reset-new-password"
                  type={showResetPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  value={resetNewPassword}
                  onChange={(e) => setResetNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 pr-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <button
                  type="button"
                  onClick={() => setShowResetPassword((v) => !v)}
                  aria-label={showResetPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  {showResetPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="reset-confirm-password"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Confirm New Password
              </label>
              <input
                id="reset-confirm-password"
                type={showResetPassword ? 'text' : 'password'}
                required
                minLength={8}
                value={resetConfirmPassword}
                onChange={(e) => setResetConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              <KeyRound className="h-4 w-4" />
              <span>{submitting ? 'Updating password...' : 'Verify & Reset Password'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setErrorMsg(null);
                setView('forgot-request');
              }}
              className="inline-flex w-full items-center justify-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Change Phone or Email
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
