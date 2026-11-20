import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Wand2, X } from 'lucide-react';
import { saasApi } from '../../lib/api';
import type { TenantWorkspaceData, TimetableSolveResult } from '../../shared/types';

interface Props {
  workspace: TenantWorkspaceData;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onNotify: (title: string, tone?: 'success' | 'error') => void;
}

export function SolveDialog({ workspace, onClose, onRefresh, onNotify }: Props) {
  const { tenant, timetable } = workspace;
  const lessons = tenant.timetableLessons ?? [];
  const gradesWithLessons = tenant.grades.filter((g) => lessons.some((l) => l.grade === g));
  const [grades, setGrades] = useState<string[]>(gradesWithLessons);
  const [assignRooms, setAssignRooms] = useState(tenant.rooms.length > 0);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TimetableSolveResult | null>(null);
  const lockedCount = timetable.filter((s) => s.locked).length;

  async function run() {
    setRunning(true);
    try {
      const r = await saasApi.solveTimetable(tenant.id, {
        grades: grades.length === gradesWithLessons.length ? undefined : grades,
        assignRooms,
        seed: Math.floor(Math.random() * 100000) + 1,
      });
      setResult(r);
      await onRefresh();
      onNotify(
        r.unplaced.length
          ? `Placed ${r.placedPeriods} of ${r.totalPeriods} periods. ${r.unplaced.length} lesson(s) need attention.`
          : `All ${r.totalPeriods} periods placed with no clashes.`,
        r.unplaced.length ? 'error' : 'success'
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not solve the timetable.', 'error');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Solve timetable</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Places every lesson card with zero teacher, class or room clashes, honouring teacher availability and locked lessons.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-4 w-4" />
          </button>
        </div>

        {lessons.length === 0 ? (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
            There are no lesson cards yet. Open the Lessons tab and choose “Build from curriculum” first.
          </p>
        ) : (
          <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto">
            <div>
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300">Grades to solve</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {gradesWithLessons.map((g) => {
                  const on = grades.includes(g);
                  return (
                    <button
                      key={g}
                      onClick={() => setGrades((p) => (on ? p.filter((x) => x !== g) : [...p, g]))}
                      aria-pressed={on}
                      className={`rounded-full border px-3 py-1 text-xs font-medium ${
                        on
                          ? 'border-blue-600 bg-blue-600 text-white'
                          : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {g}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={assignRooms} onChange={(e) => setAssignRooms(e.target.checked)} className="mt-1" />
              <span>
                Assign rooms (no two lessons share a room at the same time)
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  Turn off if learners stay in a home classroom and teachers move.
                </span>
              </span>
            </label>
            <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
              {lockedCount > 0
                ? `${lockedCount} locked lesson(s) will stay exactly where they are.`
                : 'No lessons are locked. Lock the lessons you want to keep (padlock on a lesson) before re-solving.'}{' '}
              Unlocked lessons in the selected grades are replaced.
            </p>

            {result && (
              <div className="space-y-3">
                <div
                  className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${
                    result.unplaced.length
                      ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200'
                  }`}
                >
                  {result.unplaced.length ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                  <span className="font-medium">
                    {result.placedPeriods} of {result.totalPeriods} periods placed
                  </span>
                  <span className="text-xs opacity-80">({result.attemptsRun} attempts)</span>
                </div>
                {result.warnings.length > 0 && (
                  <ul className="list-disc space-y-1 pl-5 text-xs text-amber-800 dark:text-amber-300">
                    {result.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
                {result.unplaced.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">Could not place</p>
                    <ul className="mt-1.5 space-y-1.5">
                      {result.unplaced.map((u) => (
                        <li key={u.lessonId} className="rounded-lg border border-slate-200 p-2.5 text-xs dark:border-slate-700">
                          <span className="font-medium text-slate-900 dark:text-slate-100">
                            {u.grade} · {u.section} — {u.subject}
                          </span>{' '}
                          <span className="text-slate-600 dark:text-slate-400">
                            ({u.teacherName}) missing {u.missingPeriods} period{u.missingPeriods > 1 ? 's' : ''}: {u.reason}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-200">
            {result ? 'Close' : 'Cancel'}
          </button>
          <button
            onClick={run}
            disabled={running || lessons.length === 0 || grades.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Wand2 className="h-4 w-4" />
            {running ? 'Solving…' : result ? 'Solve again' : 'Solve'}
          </button>
        </div>
      </div>
    </div>
  );
}
