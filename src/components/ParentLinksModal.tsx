import { useEffect, useMemo, useState } from 'react';
import { Link2, Search, Unlink, X } from 'lucide-react';
import { saasApi } from '../lib/api';
import type { Student, TenantUser, TenantWorkspaceData } from '../shared/types';

interface ParentLinksModalProps {
  workspace: TenantWorkspaceData;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onNotify: (title: string, tone?: 'success' | 'error') => void;
}

/** Admin screen: see which learners have a parent account, and link / relink / unlink them. */
export function ParentLinksModal({ workspace, onClose, onRefresh, onNotify }: ParentLinksModalProps) {
  const tenantId = workspace.tenant.id;
  const [parents, setParents] = useState<TenantUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [onlyUnlinked, setOnlyUnlinked] = useState(false);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    saasApi
      .listTenantUsers(tenantId)
      .then((res) => {
        if (!cancelled) setParents(res.users.filter((u) => u.role === 'Parent' && u.status === 'Active'));
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Could not load parent accounts.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const parentById = useMemo(() => new Map(parents.map((p) => [p.id, p])), [parents]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return workspace.students
      .filter((s) => !s.deleted && (s.status === 'Active' || s.status === 'On Leave'))
      .filter((s) => !onlyUnlinked || !s.parentUserId)
      .filter(
        (s) =>
          !q ||
          s.fullName.toLowerCase().includes(q) ||
          s.studentCode.toLowerCase().includes(q) ||
          (s.guardianName || '').toLowerCase().includes(q)
      )
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [workspace.students, query, onlyUnlinked]);

  const unlinkedCount = useMemo(
    () =>
      workspace.students.filter(
        (s) => !s.deleted && (s.status === 'Active' || s.status === 'On Leave') && !s.parentUserId
      ).length,
    [workspace.students]
  );

  async function apply(student: Student, parentUserId: string | null) {
    setBusyId(student.id);
    try {
      await saasApi.setStudentParent(tenantId, student.id, parentUserId);
      await onRefresh();
      setPick((p) => ({ ...p, [student.id]: '' }));
      onNotify(
        parentUserId
          ? `${student.fullName} linked to ${parentById.get(parentUserId)?.fullName || 'parent'}.`
          : `${student.fullName} unlinked from parent account.`,
        'success'
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not update the parent link.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Parent account links"
        className="flex max-h-[88vh] w-full max-w-4xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Parent account links</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {parents.length} parent account{parents.length === 1 ? '' : 's'} · {unlinkedCount} learner
                {unlinkedCount === 1 ? '' : 's'} without a linked parent
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 py-3 dark:border-slate-800">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search learner, admission no. or guardian"
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={onlyUnlinked}
              onChange={(e) => setOnlyUnlinked(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300"
            />
            Only unlinked
          </label>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-2">
          {loadError && (
            <p role="alert" className="my-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
              {loadError}
            </p>
          )}
          {loading && (
            <p className="py-2 text-[11px] text-slate-500">Loading parent accounts…</p>
          )}
          {rows.length === 0 ? (
            <p className="py-10 text-center text-xs text-slate-500">No learners match.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((s) => {
                const linked = s.parentUserId ? parentById.get(s.parentUserId) : undefined;
                const busy = busyId === s.id;
                return (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs">
                    <div className="min-w-[200px] flex-1">
                      <p className="font-semibold text-slate-900 dark:text-slate-100">{s.fullName}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                        {s.studentCode} · {s.grade} {s.section}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        Guardian on file: {s.guardianName || '—'}
                        {s.guardianPhone ? ` · ${s.guardianPhone}` : ''}
                      </p>
                    </div>

                    <div className="min-w-[180px] flex-1">
                      {s.parentUserId ? (
                        <span className="inline-flex flex-col rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                          <span className="font-semibold">{linked?.fullName || 'Linked parent'}</span>
                          {linked && <span className="font-mono text-[10px] opacity-80">{linked.email}</span>}
                        </span>
                      ) : (
                        <span className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
                          Not linked
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        aria-label={`Parent account for ${s.fullName}`}
                        value={pick[s.id] || ''}
                        onChange={(e) => setPick((p) => ({ ...p, [s.id]: e.target.value }))}
                        disabled={busy || parents.length === 0}
                        className="max-w-[200px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      >
                        <option value="">{parents.length === 0 ? 'No parent accounts' : 'Choose parent…'}</option>
                        {parents.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.fullName} ({p.email})
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={busy || !pick[s.id]}
                        onClick={() => apply(s, pick[s.id])}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
                      >
                        {s.parentUserId ? 'Relink' : 'Link'}
                      </button>
                      {s.parentUserId && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (window.confirm(`Unlink ${s.fullName} from ${linked?.fullName || 'this parent'}? They will lose access to this learner.`)) {
                              void apply(s, null);
                            }
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <Unlink className="h-3 w-3" />
                          Unlink
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <p className="border-t border-slate-100 px-6 py-3 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
          Parents can also link their own children by entering the admission number and the guardian phone
          number on file. A learner can be linked to one parent account at a time.
        </p>
      </div>
    </div>
  );
}
