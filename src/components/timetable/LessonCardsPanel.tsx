import { useMemo, useState } from 'react';
import { AlertTriangle, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { saasApi } from '../../lib/api';
import {
  getStreamsForGrade,
  getSubjectsForGrade,
  type TenantWorkspaceData,
  type TimetableLesson,
} from '../../shared/types';

interface Props {
  workspace: TenantWorkspaceData;
  onRefresh: () => Promise<void>;
  onNotify: (title: string, tone?: 'success' | 'error') => void;
}

const SLOTS_PER_WEEK = 40; // 5 days x 8 lesson periods

const field =
  'mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';
const label = 'block text-xs font-medium text-slate-700 dark:text-slate-300';

export function LessonCardsPanel({ workspace, onRefresh, onNotify }: Props) {
  const { tenant } = workspace;
  const lessons = tenant.timetableLessons ?? [];
  const [grade, setGrade] = useState(tenant.grades[0] || '');
  const streams = getStreamsForGrade(tenant, grade);
  const [section, setSection] = useState(streams[0] || 'A');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const emptyForm = {
    subject: '',
    teacherId: tenant.teachers[0]?.id || '',
    periodsPerWeek: 4,
    doubleLessons: 0,
    room: '',
    maxPerDay: 0,
  };
  const [form, setForm] = useState(emptyForm);

  const classLessons = useMemo(
    () => lessons.filter((l) => l.grade === grade && l.section === section),
    [lessons, grade, section]
  );
  const classTotal = classLessons.reduce((n, l) => n + l.periodsPerWeek, 0);
  const teacherName = (id: string) => tenant.teachers.find((t) => t.id === id)?.name || 'Unknown';

  const workload = useMemo(
    () =>
      tenant.teachers
        .map((t) => {
          const assigned = lessons.filter((l) => l.teacherId === t.id).reduce((n, l) => n + l.periodsPerWeek, 0);
          const blocked = (t.unavailable || []).length;
          const dayCap = t.maxLessonsPerDay ? t.maxLessonsPerDay * 5 : SLOTS_PER_WEEK;
          const capacity = Math.min(SLOTS_PER_WEEK - blocked, dayCap);
          return { id: t.id, name: t.name, assigned, capacity };
        })
        .filter((w) => w.assigned > 0)
        .sort((a, b) => b.assigned - a.assigned),
    [tenant.teachers, lessons]
  );

  function startEdit(l: TimetableLesson) {
    setEditing(l.id);
    setForm({
      subject: l.subject,
      teacherId: l.teacherId,
      periodsPerWeek: l.periodsPerWeek,
      doubleLessons: l.doubleLessons || 0,
      room: l.room || '',
      maxPerDay: l.maxPerDay || 0,
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.subject.trim()) {
      onNotify('Choose a subject for the lesson.', 'error');
      return;
    }
    setBusy(true);
    try {
      await saasApi.saveTimetableLesson(tenant.id, {
        ...(editing ? { id: editing } : {}),
        grade,
        section,
        subject: form.subject.trim(),
        teacherId: form.teacherId,
        periodsPerWeek: form.periodsPerWeek,
        doubleLessons: form.doubleLessons || undefined,
        room: form.room || undefined,
        maxPerDay: form.maxPerDay || undefined,
      });
      await onRefresh();
      setEditing(null);
      setForm({ ...emptyForm, teacherId: form.teacherId });
      onNotify(editing ? 'Lesson updated.' : 'Lesson added.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not save lesson.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await saasApi.deleteTimetableLesson(tenant.id, id);
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not delete lesson.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function build(allGrades: boolean) {
    if (
      lessons.length > 0 &&
      !window.confirm(
        `Rebuild lesson cards for ${allGrades ? 'ALL grades' : grade}? Existing cards for those classes will be replaced.`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const r = await saasApi.buildTimetableLessons(tenant.id, {
        grades: allGrades ? undefined : [grade],
        replace: true,
      });
      await onRefresh();
      onNotify(
        r.skipped.length
          ? `Built ${r.created} lessons. No teacher yet for: ${r.skipped.join(', ')}.`
          : `Built ${r.created} lessons from the curriculum.`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not build lessons.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <div className="space-y-4 lg:col-span-8">
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={grade}
              onChange={(e) => {
                const g = e.target.value;
                setGrade(g);
                setSection(getStreamsForGrade(tenant, g)[0] || 'A');
              }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              {tenant.grades.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
            <select
              value={section}
              onChange={(e) => setSection(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              {streams.map((s) => (
                <option key={s} value={s}>
                  Stream {s}
                </option>
              ))}
            </select>
            <span
              className={`rounded-md px-2 py-1 font-mono text-xs tabular-nums ${
                classTotal > SLOTS_PER_WEEK
                  ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                  : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {classTotal} / {SLOTS_PER_WEEK} periods
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              disabled={busy}
              onClick={() => build(false)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50/80 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Build {grade} from curriculum
            </button>
            <button
              disabled={busy}
              onClick={() => build(true)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              Build all grades
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                  <th className="px-4 py-2.5">Subject</th>
                  <th className="px-4 py-2.5">Teacher</th>
                  <th className="px-3 py-2.5 text-center">Periods / wk</th>
                  <th className="px-3 py-2.5 text-center">Doubles</th>
                  <th className="px-3 py-2.5">Room</th>
                  <th className="px-3 py-2.5 text-center">Max / day</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {classLessons.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                      No lessons for {grade} · Stream {section} yet. Use “Build from curriculum” or add one below.
                    </td>
                  </tr>
                )}
                {classLessons.map((l) => (
                  <tr key={l.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800/70">
                    <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">{l.subject}</td>
                    <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300">{teacherName(l.teacherId)}</td>
                    <td className="px-3 py-2.5 text-center font-mono tabular-nums">{l.periodsPerWeek}</td>
                    <td className="px-3 py-2.5 text-center font-mono tabular-nums">{l.doubleLessons || '–'}</td>
                    <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400">{l.room || 'Any'}</td>
                    <td className="px-3 py-2.5 text-center font-mono tabular-nums">{l.maxPerDay || 'Auto'}</td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        onClick={() => startEdit(l)}
                        aria-label="Edit lesson"
                        className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => remove(l.id)}
                        aria-label="Delete lesson"
                        className="rounded p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form
            onSubmit={save}
            className="grid grid-cols-2 gap-3 border-t border-slate-200 bg-slate-50/60 p-4 sm:grid-cols-6 dark:border-slate-800 dark:bg-slate-900/40"
          >
            <div className="col-span-2">
              <label className={label}>Subject</label>
              <input
                list="lesson-subjects"
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                className={field}
                placeholder="e.g. Mathematics"
              />
              <datalist id="lesson-subjects">
                {getSubjectsForGrade(tenant, grade).map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
            <div className="col-span-2">
              <label className={label}>Teacher</label>
              <select
                value={form.teacherId}
                onChange={(e) => setForm({ ...form, teacherId: e.target.value })}
                className={field}
              >
                {tenant.teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Periods / wk</label>
              <input
                type="number"
                min={1}
                max={40}
                value={form.periodsPerWeek}
                onChange={(e) => setForm({ ...form, periodsPerWeek: Number(e.target.value) })}
                className={field}
              />
            </div>
            <div>
              <label className={label}>Doubles</label>
              <input
                type="number"
                min={0}
                max={Math.floor(form.periodsPerWeek / 2)}
                value={form.doubleLessons}
                onChange={(e) => setForm({ ...form, doubleLessons: Number(e.target.value) })}
                className={field}
              />
            </div>
            <div className="col-span-2">
              <label className={label}>Fixed room (optional)</label>
              <select value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} className={field}>
                <option value="">Any room</option>
                {tenant.rooms.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Max / day</label>
              <input
                type="number"
                min={0}
                max={8}
                value={form.maxPerDay}
                onChange={(e) => setForm({ ...form, maxPerDay: Number(e.target.value) })}
                className={field}
                placeholder="Auto"
              />
            </div>
            <div className="col-span-2 flex items-end gap-2 sm:col-span-3">
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                {editing ? 'Update lesson' : `Add to ${grade} · ${section}`}
              </button>
              {editing && (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(null);
                    setForm(emptyForm);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300"
                >
                  <X className="h-3.5 w-3.5" /> Cancel
                </button>
              )}
            </div>
          </form>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Teacher workload</h2>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          Periods assigned per week against what each teacher can actually teach (after unavailable slots and daily limits).
        </p>
        <ul className="mt-3 space-y-2">
          {workload.length === 0 && <li className="text-xs text-slate-500">No lessons assigned yet.</li>}
          {workload.map((w) => {
            const over = w.assigned > w.capacity;
            return (
              <li key={w.id}>
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1 truncate font-medium text-slate-800 dark:text-slate-200">
                    {over && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-500" />}
                    {w.name}
                  </span>
                  <span className={`font-mono tabular-nums ${over ? 'text-red-600 dark:text-red-400' : 'text-slate-500'}`}>
                    {w.assigned} / {w.capacity}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className={`h-full rounded-full ${over ? 'bg-red-500' : 'bg-blue-500'}`}
                    style={{ width: `${Math.min(100, (w.assigned / Math.max(1, w.capacity)) * 100)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
