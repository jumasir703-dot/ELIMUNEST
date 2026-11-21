import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Clock, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { saasApi } from '../../lib/api';
import {
  DEFAULT_DAY_CLOSING_NOTE,
  DEFAULT_DAY_OPENING_NOTE,
  getTenantBellSchedule,
  KENYAN_BELL_SCHEDULE,
  type BellScheduleRow,
  type TenantWorkspaceData,
} from '../../shared/types';

interface Props {
  workspace: TenantWorkspaceData;
  onRefresh: () => Promise<void>;
  onNotify: (title: string, tone?: 'success' | 'error') => void;
}

function addMinutesToTime(hhmm: string, mins: number): string {
  const [hStr, mStr] = (hhmm || '08:00').split(':');
  const total = Math.min(23 * 60 + 59, Math.max(0, Number(hStr) * 60 + Number(mStr) + mins));
  const h = String(Math.floor(total / 60)).padStart(2, '0');
  const m = String(total % 60).padStart(2, '0');
  return `${h}:${m}`;
}

export function DaySchedulePanel({ workspace, onRefresh, onNotify }: Props) {
  const { tenant } = workspace;
  const [rows, setRows] = useState<BellScheduleRow[]>(() => getTenantBellSchedule(tenant));
  const [openingNote, setOpeningNote] = useState<string>(
    tenant.dayOpeningNote !== undefined ? tenant.dayOpeningNote : DEFAULT_DAY_OPENING_NOTE
  );
  const [closingNote, setClosingNote] = useState<string>(
    tenant.dayClosingNote !== undefined ? tenant.dayClosingNote : DEFAULT_DAY_CLOSING_NOTE
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRows(getTenantBellSchedule(tenant));
    setOpeningNote(
      tenant.dayOpeningNote !== undefined ? tenant.dayOpeningNote : DEFAULT_DAY_OPENING_NOTE
    );
    setClosingNote(
      tenant.dayClosingNote !== undefined ? tenant.dayClosingNote : DEFAULT_DAY_CLOSING_NOTE
    );
  }, [tenant]);

  const lessonCount = rows.filter((r) => r.kind === 'lesson').length;

  function renumberLessons(list: BellScheduleRow[]): BellScheduleRow[] {
    let p = 1;
    return list.map((row) => {
      if (row.kind === 'lesson') {
        const period = p++;
        const nextLabel =
          /^Lesson \d+$/i.test(row.label.trim()) || !row.label.trim()
            ? `Lesson ${period}`
            : row.label;
        return {
          ...row,
          period,
          label: nextLabel,
          time: `${row.startTime} – ${row.endTime}`,
        };
      }
      return {
        ...row,
        period: undefined,
        time: `${row.startTime} – ${row.endTime}`,
      };
    });
  }

  function updateRow(idx: number, patch: Partial<BellScheduleRow>) {
    setRows((prev) =>
      renumberLessons(
        prev.map((row, i) => (i === idx ? { ...row, ...patch } : row))
      )
    );
  }

  function addRow(kind: 'lesson' | 'break') {
    setRows((prev) => {
      const last = prev[prev.length - 1];
      const startTime = last ? last.endTime : '08:00';
      const endTime = addMinutesToTime(startTime, kind === 'lesson' ? 40 : 15);
      const next: BellScheduleRow = {
        id: `bell-${Date.now()}-${prev.length}`,
        kind,
        label: kind === 'lesson' ? `Lesson ${lessonCount + 1}` : 'Break',
        startTime,
        endTime,
        time: `${startTime} – ${endTime}`,
      };
      return renumberLessons([...prev, next]);
    });
  }

  function moveRow(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= rows.length) return;
    setRows((prev) => {
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(target, 0, item);
      return renumberLessons(copy);
    });
  }

  function removeRow(idx: number) {
    if (rows.length <= 1) return;
    setRows((prev) => renumberLessons(prev.filter((_, i) => i !== idx)));
  }

  function resetStandard() {
    setRows(KENYAN_BELL_SCHEDULE.map((r) => ({ ...r })));
    setOpeningNote(DEFAULT_DAY_OPENING_NOTE);
    setClosingNote(DEFAULT_DAY_CLOSING_NOTE);
  }

  async function save() {
    if (lessonCount === 0) {
      onNotify('Include at least 1 teaching lesson period in your day schedule.', 'error');
      return;
    }
    for (let i = 0; i < rows.length; i += 1) {
      if (rows[i].startTime >= rows[i].endTime) {
        onNotify(
          `Row ${i + 1} (${rows[i].label}): End time must be after Start time.`,
          'error'
        );
        return;
      }
    }
    setSaving(true);
    try {
      await saasApi.saveTimetableDaySchedule(tenant.id, {
        bellSchedule: rows,
        dayOpeningNote: openingNote,
        dayClosingNote: closingNote,
      });
      await onRefresh();
      onNotify(`Saved custom day schedule (${lessonCount} lesson periods/day · ${lessonCount * 5} slots/week).`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to save day schedule.', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
            <Clock className="h-4 w-4 text-blue-600" />
            School Day Structure & Bell Times
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Customize your school’s daily lesson periods, break intervals, and start/end times. Double lessons automatically avoid spanning across Break rows.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={resetStandard}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Default 8-Lesson Day
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Saving...' : 'Save Day Schedule'}
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
            Opening / Morning Assembly Banner (optional)
          </label>
          <input
            type="text"
            value={openingNote}
            onChange={(e) => setOpeningNote(e.target.value)}
            placeholder="e.g. 07:30 – 08:00 Morning Assembly / Prep"
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
            Closing / Co-Curricular Banner (optional)
          </label>
          <input
            type="text"
            value={closingNote}
            onChange={(e) => setClosingNote(e.target.value)}
            placeholder="e.g. 15:20 – 16:00 Clubs, Games & Remedial Study"
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                <th className="px-3 py-2.5">Type</th>
                <th className="px-3 py-2.5">Period #</th>
                <th className="px-3 py-2.5">Label</th>
                <th className="px-3 py-2.5">Start Time</th>
                <th className="px-3 py-2.5">End Time</th>
                <th className="px-3 py-2.5 text-right">Order / Remove</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {rows.map((row, idx) => (
                <tr
                  key={row.id || idx}
                  className={row.kind === 'break' ? 'bg-amber-50/40 dark:bg-amber-950/15' : ''}
                >
                  <td className="px-3 py-2">
                    <select
                      value={row.kind}
                      onChange={(e) =>
                        updateRow(idx, {
                          kind: e.target.value as 'lesson' | 'break',
                          label:
                            e.target.value === 'break'
                              ? 'Break'
                              : `Lesson`,
                        })
                      }
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    >
                      <option value="lesson">Lesson</option>
                      <option value="break">Break</option>
                    </select>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">
                    {row.kind === 'lesson' ? `P${row.period}` : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={row.label}
                      onChange={(e) => updateRow(idx, { label: e.target.value })}
                      className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="time"
                      value={row.startTime}
                      onChange={(e) => updateRow(idx, { startTime: e.target.value })}
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="time"
                      value={row.endTime}
                      onChange={(e) => updateRow(idx, { endTime: e.target.value })}
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => moveRow(idx, -1)}
                        disabled={idx === 0}
                        aria-label="Move up"
                        className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveRow(idx, 1)}
                        disabled={idx === rows.length - 1}
                        aria-label="Move down"
                        className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeRow(idx)}
                        disabled={rows.length <= 1}
                        aria-label="Remove row"
                        className="rounded p-1 text-red-500 hover:bg-red-50 disabled:opacity-30 dark:hover:bg-red-950/40"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => addRow('lesson')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Lesson Period
          </button>
          <button
            type="button"
            onClick={() => addRow('break')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Break / Recess
          </button>
        </div>
        <span className="font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
          {lessonCount} lesson periods/day · {lessonCount * 5} teaching slots/week
        </span>
      </div>
    </div>
  );
}
