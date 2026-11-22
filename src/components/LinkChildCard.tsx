import { useState } from 'react';
import { Link2 } from 'lucide-react';
import { saasApi } from '../lib/api';

interface LinkChildCardProps {
  tenantId: string;
  /** Number of learners already linked to this parent (drives the wording). */
  linkedCount: number;
  onLinked: () => Promise<void> | void;
}

/** Parent dashboard card: claim another child with admission number + guardian phone on file. */
export function LinkChildCard({ tenantId, linkedCount, onLinked }: LinkChildCardProps) {
  const [open, setOpen] = useState(linkedCount === 0);
  const [studentCode, setStudentCode] = useState('');
  const [guardianPhone, setGuardianPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!studentCode.trim() || !guardianPhone.trim()) {
      setError('Enter the admission number and the guardian phone number the school has on file.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await saasApi.linkChild(tenantId, {
        studentCode: studentCode.trim(),
        guardianPhone: guardianPhone.trim(),
      });
      setSuccess(`${res.fullName} is now linked to your account.`);
      setStudentCode('');
      setGuardianPhone('');
      await onLinked();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not link that learner.');
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls =
    'mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100';

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300">
            <Link2 className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              {linkedCount === 0 ? 'Link your child to this account' : 'Link another child'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {linkedCount === 0
                ? 'No learner is linked yet, so there is nothing to show.'
                : `${linkedCount} learner${linkedCount === 1 ? '' : 's'} linked.`}
            </p>
          </div>
        </div>
        {linkedCount > 0 && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {open ? 'Hide' : 'Add a child'}
          </button>
        )}
      </div>

      {open && (
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="lc-code" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Admission number
              </label>
              <input
                id="lc-code"
                value={studentCode}
                onChange={(e) => setStudentCode(e.target.value)}
                placeholder="ADM-2601"
                className={`${inputCls} font-mono uppercase`}
              />
            </div>
            <div>
              <label htmlFor="lc-phone" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Guardian phone on file at the school
              </label>
              <input
                id="lc-phone"
                type="tel"
                inputMode="tel"
                value={guardianPhone}
                onChange={(e) => setGuardianPhone(e.target.value)}
                placeholder="07XX XXX XXX"
                className={inputCls}
              />
            </div>
          </div>
          {error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}
          {success && (
            <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
              {success}
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              If it does not match, ask the school office to link your account.
            </p>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? 'Linking…' : 'Link child'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
