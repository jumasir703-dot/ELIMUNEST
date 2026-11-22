import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { saasApi } from '../lib/api';
import {
  validatePasswordStrength,
  type AuthSessionInfo,
  type PublicSchoolDirectoryItem,
} from '../shared/types';

interface ParentSignupFormProps {
  onAuthenticated: (session: AuthSessionInfo) => void;
  onBack: () => void;
  onError: (message: string | null) => void;
}

const INPUT =
  'mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100';
const LABEL = 'block text-xs font-medium text-slate-700 dark:text-slate-300';

/**
 * Parent self sign-up. The school only creates the account when BOTH the learner's admission
 * number and the guardian phone number it has on file match, so nobody can claim a child by
 * guessing one detail.
 */
export function ParentSignupForm({ onAuthenticated, onBack, onError }: ParentSignupFormProps) {
  const [schools, setSchools] = useState<PublicSchoolDirectoryItem[]>([]);
  const [loadingSchools, setLoadingSchools] = useState(true);
  const [tenantId, setTenantId] = useState('');
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [studentCode, setStudentCode] = useState('');
  const [guardianPhone, setGuardianPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    saasApi
      .getAuthSchools()
      .then((res) => {
        if (cancelled) return;
        setSchools(res.schools);
        if (res.schools.length === 1) setTenantId(res.schools[0].id);
      })
      .catch(() => {
        if (!cancelled) onError('Could not load the list of schools. Check your connection and try again.');
      })
      .finally(() => {
        if (!cancelled) setLoadingSchools(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const school = schools.find((s) => s.id === tenantId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onError(null);
    if (!school) {
      onError('Choose your child’s school.');
      return;
    }
    const cleanUsername = username.trim().toLowerCase();
    if (!cleanUsername || /[@\s]/.test(cleanUsername)) {
      onError('Choose a username without spaces or the @ sign.');
      return;
    }
    if (!studentCode.trim() || !guardianPhone.trim()) {
      onError('Enter your child’s admission number and the guardian phone number the school has on file.');
      return;
    }
    const policyErr = validatePasswordStrength(password);
    if (policyErr) {
      onError(policyErr);
      return;
    }
    if (password !== confirm) {
      onError('Password and confirmation do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const session = await saasApi.registerAccount({
        tenantId: school.id,
        fullName: fullName.trim(),
        email: `${cleanUsername}@${school.emailDomain}`,
        role: 'Parent',
        password,
        phone: phone.trim() || undefined,
        studentCode: studentCode.trim(),
        guardianPhone: guardianPhone.trim(),
      });
      onAuthenticated(session);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to create your account.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4">
      <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
        Create a parent account to see your child’s results, fees and attendance. You will need the
        admission number and the guardian phone number your school has on file.
      </p>

      <div>
        <label htmlFor="ps-school" className={LABEL}>
          School
        </label>
        <select
          id="ps-school"
          required
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          disabled={loadingSchools}
          className={INPUT}
        >
          <option value="">{loadingSchools ? 'Loading schools…' : 'Select your child’s school'}</option>
          {schools.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.location ? ` — ${s.location}` : ''}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="ps-name" className={LABEL}>
          Your full name
        </label>
        <input
          id="ps-name"
          required
          minLength={2}
          autoComplete="name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className={INPUT}
        />
      </div>

      <div>
        <label htmlFor="ps-username" className={LABEL}>
          Choose a username
        </label>
        <div className="mt-1.5 flex items-stretch overflow-hidden rounded-lg border border-slate-200 bg-white focus-within:border-blue-500 dark:border-slate-700 dark:bg-slate-950">
          <input
            id="ps-username"
            required
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. mary.achieng"
            className="min-w-0 flex-1 bg-transparent px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
          />
          <span className="flex items-center border-l border-slate-200 bg-slate-50 px-3 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
            @{school?.emailDomain || 'school'}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
          You will sign in with this address, not a personal email.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="ps-code" className={LABEL}>
            Child’s admission no.
          </label>
          <input
            id="ps-code"
            required
            value={studentCode}
            onChange={(e) => setStudentCode(e.target.value)}
            placeholder="ADM-2601"
            className={`${INPUT} font-mono uppercase`}
          />
        </div>
        <div>
          <label htmlFor="ps-gphone" className={LABEL}>
            Guardian phone on file
          </label>
          <input
            id="ps-gphone"
            required
            type="tel"
            inputMode="tel"
            value={guardianPhone}
            onChange={(e) => setGuardianPhone(e.target.value)}
            placeholder="07XX XXX XXX"
            className={INPUT}
          />
        </div>
      </div>

      <div>
        <label htmlFor="ps-phone" className={LABEL}>
          Your phone <span className="font-normal text-slate-400">(optional, for password reset)</span>
        </label>
        <input
          id="ps-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className={INPUT}
        />
      </div>

      <div>
        <label htmlFor="ps-pass" className={LABEL}>
          Password
        </label>
        <div className="relative mt-1.5">
          <input
            id="ps-pass"
            required
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 pr-10 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
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

      <div>
        <label htmlFor="ps-confirm" className={LABEL}>
          Confirm password
        </label>
        <input
          id="ps-confirm"
          required
          type={showPassword ? 'text' : 'password'}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={INPUT}
        />
      </div>

      <button
        type="submit"
        disabled={submitting || loadingSchools}
        className="inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
      >
        <span>{submitting ? 'Creating account…' : 'Create parent account'}</span>
        <ArrowRight className="h-4 w-4" />
      </button>

      <button
        type="button"
        onClick={onBack}
        className="inline-flex w-full items-center justify-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to sign in
      </button>
    </form>
  );
}
