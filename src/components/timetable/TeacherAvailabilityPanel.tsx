import { useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import { saasApi } from '../../lib/api';
import {
  getTenantLessonRows,
  type DayOfWeek,
  type TenantWorkspaceData,
} from '../../shared/types';

interface Props {
  workspace: TenantWorkspaceData;
  onRefresh: () => Promise<void>;
  onNotify: (title: string, tone?: 'success' | 'error') => void;
}

const DAYS: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const key = (d: DayOfWeek, p: number) => `${d}|${p}`;

export function TeacherAvailabilityPanel({ workspace, onRefresh, onNotify }: Props) {
  const { tenant } = workspace;
  const lessonRows = useMemo(() => getTenantLessonRows(tenant), [tenant]);
  const periods = useMemo(() => lessonRows.map((r) => r.period as number), [lessonRows]);
  const [teacherId, setTeacherId] = useState(tenant.teachers[0]?.id || '');
  const teacher = tenant.teachers.find((t) => t.id === teacherId);
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [maxPerDay, setMaxPerDay] = useState<number>(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const valid = new Set(periods);
    setBlocked(
      new Set(
        (teacher?.unavailable || [])
          .filter((u) => valid.has(u.period))
          .map((u) => key(u.day, u.period))
      )
    );
    setMaxPerDay(teacher?.maxLessonsPerDay || 0);
  }, [teacher?.id, teacher?.unavailable, teacher?.maxLessonsPerDay, periods]);

  const toggle = (d: DayOfWeek, p: number) =>
    setBlocked((prev) => {
      const next = new Set(prev);
      next.has(key(d, p)) ? next.delete(key(d, p)) : next.add(key(d, p));
      return next;
    });

  const toggleMany = (cells: Array<[DayOfWeek, number]>) =>
    setBlocked((prev) => {
      const next = new Set(prev);
      const allBlocked = cells.every(([d, p]) => next.has(key(d, p)));
      cells.forEach(([d, p]) => (allBlocked ? next.delete(key(d, p)) : next.add(key(d, p))));
      return next;
    });

  async function save() {
    if (!teacher) return;
    setSaving(true);
    try {
      await saasApi.setTeacherAvailability(tenant.id, teacher.id, {
        unavailable: [...blocked].map((k) => {
          const [day, period] = k.split('|');
          return { day: day as DayOfWeek, period: Number(period) };
        }),
        maxLessonsPerDay: maxPerDay > 0 ? maxPerDay : null,
      });
      await onRefresh();
      onNotify(`Availability saved for ${teacher.name}.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not save availability.', 'error');
    } finally {
      setSaving(false);
    }
  }

  const available = DAYS.length * periods.length - blocked.size;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Teacher availability</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Click a slot to mark it unavailable (red). Click a day or lesson heading to toggle the whole column or row. The solver never schedules a teacher in a red slot.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Teacher</label>
            <select
              value={teacherId}
              onChange={(e) => setTeacherId(e.target.value)}
              className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              {tenant.teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Max lessons / day</label>
            <input
              type="number"
              min={0}
              max={periods.length}
              value={maxPerDay}
              onChange={(e) => setMaxPerDay(Number(e.target.value))}
              placeholder="No limit"
              className="mt-1 w-28 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
          <button
            onClick={save}
            disabled={saving || !teacher}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Save className="h-4 w-4" /> Save
          </button>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[620px] border-separate border-spacing-1 text-center text-xs">
          <thead>
            <tr>
              <th />
              {DAYS.map((d) => (
                <th key={d}>
                  <button
                    onClick={() => toggleMany(periods.map((p) => [d, p]))}
                    className="w-full rounded-md bg-slate-100 px-2 py-1.5 font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    {d}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lessonRows.map((row) => (
              <tr key={row.period}>
                <th className="pr-1 text-left">
                  <button
                    onClick={() => toggleMany(DAYS.map((d) => [d, row.period as number]))}
                    className="w-full rounded-md bg-slate-100 px-2 py-2 text-left font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    {row.label}
                    <span className="ml-1.5 font-mono text-[10px] font-normal text-slate-500 dark:text-slate-400">
                      {row.time}
                    </span>
                  </button>
                </th>
                {DAYS.map((d) => {
                  const off = blocked.has(key(d, row.period as number));
                  return (
                    <td key={d}>
                      <button
                        onClick={() => toggle(d, row.period as number)}
                        aria-pressed={off}
                        aria-label={`${d} ${row.label} ${off ? 'unavailable' : 'available'}`}
                        className={`h-10 w-full rounded-md border text-[11px] font-medium transition-colors ${
                          off
                            ? 'border-red-300 bg-red-100 text-red-700 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
                        }`}
                      >
                        {off ? 'Unavailable' : 'Available'}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
        {available} of {DAYS.length * periods.length} weekly slots available{maxPerDay > 0 ? `, max ${maxPerDay} lessons per day` : ''}.
      </p>
    </div>
  );
}
