import { useEffect, useMemo, useState } from 'react';
import { Layers, Plus, Save, SlidersHorizontal, Trash2 } from 'lucide-react';
import { saasApi } from '../../lib/api';
import {
  getTenantLessonRows,
  type OptionalSubjectGroup,
  type SubjectTimetableConstraint,
  type TenantWorkspaceData,
} from '../../shared/types';

interface Props {
  workspace: TenantWorkspaceData;
  onRefresh: () => Promise<void>;
  onNotify: (title: string, tone?: 'success' | 'error') => void;
}

const field =
  'mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';

export function SubjectConstraintsPanel({ workspace, onRefresh, onNotify }: Props) {
  const { tenant } = workspace;
  const lessonRows = useMemo(() => getTenantLessonRows(tenant), [tenant]);

  const allSubjectChoices = useMemo(() => {
    const set = new Set<string>(tenant.subjects || []);
    if (tenant.levelSubjects) {
      Object.values(tenant.levelSubjects).forEach((arr) =>
        arr?.forEach((s) => s && set.add(s))
      );
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [tenant.subjects, tenant.levelSubjects]);

  const [constraints, setConstraints] = useState<SubjectTimetableConstraint[]>(
    () => tenant.subjectConstraints || []
  );
  const [groups, setGroups] = useState<OptionalSubjectGroup[]>(
    () => tenant.optionalSubjectGroups || []
  );
  const [saving, setSaving] = useState(false);

  // Add constraint form
  const [ruleSubject, setRuleSubject] = useState(allSubjectChoices[0] || '');
  const [ruleGrade, setRuleGrade] = useState('All Grades');
  const [ruleDoubles, setRuleDoubles] = useState<number>(1);
  const [ruleNotBefore, setRuleNotBefore] = useState('');
  const [ruleNotAfter, setRuleNotAfter] = useState('');
  const [ruleMaxPerDay, setRuleMaxPerDay] = useState<number>(0);
  const [ruleRoom, setRuleRoom] = useState('');

  // Add optional group form
  const [groupName, setGroupName] = useState('');
  const [groupGrade, setGroupGrade] = useState('All Grades');
  const [groupSubjects, setGroupSubjects] = useState<string[]>([]);

  useEffect(() => {
    setConstraints(tenant.subjectConstraints || []);
    setGroups(tenant.optionalSubjectGroups || []);
  }, [tenant.subjectConstraints, tenant.optionalSubjectGroups]);

  async function persistAll(
    nextConstraints: SubjectTimetableConstraint[],
    nextGroups: OptionalSubjectGroup[],
    successMsg: string
  ) {
    setSaving(true);
    try {
      await saasApi.saveSubjectTimetableConfig(tenant.id, {
        subjectConstraints: nextConstraints,
        optionalSubjectGroups: nextGroups,
        syncLessons: true,
      });
      await onRefresh();
      onNotify(successMsg);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to save subject rules.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleAddRule(e: React.FormEvent) {
    e.preventDefault();
    if (!ruleSubject.trim()) {
      onNotify('Select a subject for the constraint.', 'error');
      return;
    }
    if (ruleNotBefore && ruleNotAfter && ruleNotBefore >= ruleNotAfter) {
      onNotify('"Not before" time must be earlier than "Not after" time.', 'error');
      return;
    }
    const nextRule: SubjectTimetableConstraint = {
      id: `subc-${Date.now()}`,
      subject: ruleSubject.trim(),
      grade: ruleGrade,
      ...(ruleDoubles > 0 ? { doubleLessons: ruleDoubles } : {}),
      ...(ruleNotBefore ? { notBeforeTime: ruleNotBefore } : {}),
      ...(ruleNotAfter ? { notAfterTime: ruleNotAfter } : {}),
      ...(ruleMaxPerDay > 0 ? { maxPerDay: ruleMaxPerDay } : {}),
      ...(ruleRoom ? { preferredRoom: ruleRoom } : {}),
    };
    const filtered = constraints.filter(
      (c) =>
        !(
          c.subject.toLowerCase() === nextRule.subject.toLowerCase() &&
          (c.grade || 'All Grades').toLowerCase() === (nextRule.grade || 'All Grades').toLowerCase()
        )
    );
    const updated = [...filtered, nextRule];
    setConstraints(updated);
    await persistAll(updated, groups, `Saved constraint for ${nextRule.subject} (${nextRule.grade}).`);
  }

  async function handleDeleteRule(id: string) {
    const updated = constraints.filter((c) => c.id !== id);
    setConstraints(updated);
    await persistAll(updated, groups, 'Subject constraint removed.');
  }

  function toggleGroupSubject(sub: string) {
    setGroupSubjects((prev) =>
      prev.includes(sub) ? prev.filter((s) => s !== sub) : [...prev, sub]
    );
  }

  async function handleAddGroup(e: React.FormEvent) {
    e.preventDefault();
    const cleanName = groupName.trim();
    if (!cleanName) {
      onNotify('Enter a name for the optional subject group.', 'error');
      return;
    }
    if (groupSubjects.length < 2) {
      onNotify('Select at least 2 subjects to group as parallel options.', 'error');
      return;
    }
    const nextGroup: OptionalSubjectGroup = {
      id: `optg-${Date.now()}`,
      name: cleanName,
      grade: groupGrade,
      subjects: [...groupSubjects],
    };
    const updated = [...groups, nextGroup];
    setGroups(updated);
    setGroupName('');
    setGroupSubjects([]);
    await persistAll(constraints, updated, `Created optional group "${cleanName}".`);
  }

  async function handleDeleteGroup(id: string) {
    const updated = groups.filter((g) => g.id !== id);
    setGroups(updated);
    await persistAll(constraints, updated, 'Optional subject group removed.');
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Left: Subject Rules (Double Allocation & Time Windows) */}
      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-7 dark:border-slate-800 dark:bg-slate-900">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
            <SlidersHorizontal className="h-4 w-4 text-blue-600" />
            Subject Scheduling Rules (Doubles & Time Windows)
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Allocate double lessons to a subject and prevent subjects from being scheduled before or after specific times of day (e.g. Sciences in labs before lunch, Games after 14:00).
          </p>
        </div>

        <form
          onSubmit={handleAddRule}
          className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4 sm:grid-cols-6 dark:border-slate-800 dark:bg-slate-900/40"
        >
          <div className="col-span-2 sm:col-span-3">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Subject
            </label>
            <select
              value={ruleSubject}
              onChange={(e) => setRuleSubject(e.target.value)}
              className={field}
            >
              {allSubjectChoices.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2 sm:col-span-3">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Applies To
            </label>
            <select
              value={ruleGrade}
              onChange={(e) => setRuleGrade(e.target.value)}
              className={field}
            >
              <option value="All Grades">All Grades</option>
              {tenant.grades.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>

          <div className="col-span-1 sm:col-span-2">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Double Lessons / Wk
            </label>
            <input
              type="number"
              min={0}
              max={10}
              value={ruleDoubles}
              onChange={(e) => setRuleDoubles(Number(e.target.value))}
              className={field}
            />
          </div>
          <div className="col-span-1 sm:col-span-2">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Not Before Time
            </label>
            <select
              value={ruleNotBefore}
              onChange={(e) => setRuleNotBefore(e.target.value)}
              className={field}
            >
              <option value="">Any start time</option>
              {lessonRows.map((r) => (
                <option key={r.period} value={r.startTime}>
                  {r.startTime} ({r.label})
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2 sm:col-span-2">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Not After Time
            </label>
            <select
              value={ruleNotAfter}
              onChange={(e) => setRuleNotAfter(e.target.value)}
              className={field}
            >
              <option value="">Any end time</option>
              {lessonRows.map((r) => (
                <option key={r.period} value={r.endTime}>
                  {r.endTime} ({r.label})
                </option>
              ))}
            </select>
          </div>

          <div className="col-span-1 sm:col-span-2">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Max Periods / Day
            </label>
            <input
              type="number"
              min={0}
              max={lessonRows.length}
              value={ruleMaxPerDay}
              onChange={(e) => setRuleMaxPerDay(Number(e.target.value))}
              placeholder="Auto"
              className={field}
            />
          </div>
          <div className="col-span-1 sm:col-span-2">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Dedicated Room
            </label>
            <select
              value={ruleRoom}
              onChange={(e) => setRuleRoom(e.target.value)}
              className={field}
            >
              <option value="">Any room</option>
              {tenant.rooms.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2 flex items-end sm:col-span-2">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              Save Rule
            </button>
          </div>
        </form>

        <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                <th className="px-3 py-2">Subject</th>
                <th className="px-3 py-2">Scope</th>
                <th className="px-3 py-2">Doubles</th>
                <th className="px-3 py-2">Time Window</th>
                <th className="px-3 py-2">Max/Day · Room</th>
                <th className="px-3 py-2 text-right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {constraints.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-500 dark:text-slate-400">
                    No subject rules configured yet.
                  </td>
                </tr>
              )}
              {constraints.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2.5 font-semibold text-slate-900 dark:text-slate-100">
                    {c.subject}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400">
                    {c.grade || 'All Grades'}
                  </td>
                  <td className="px-3 py-2.5 font-mono">
                    {c.doubleLessons ? `${c.doubleLessons}x double` : '—'}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-slate-700 dark:text-slate-300">
                    {c.notBeforeTime || c.notAfterTime
                      ? `${c.notBeforeTime || 'Start'} – ${c.notAfterTime || 'End'}`
                      : 'Any time'}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400">
                    {[
                      c.maxPerDay ? `Max ${c.maxPerDay}/day` : null,
                      c.preferredRoom || null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleDeleteRule(c.id)}
                      aria-label="Delete rule"
                      className="rounded p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Right: Optional Subject Grouping */}
      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-5 dark:border-slate-800 dark:bg-slate-900">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
            <Layers className="h-4 w-4 text-emerald-600" />
            Optional Subject Grouping
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Group elective or split subjects (e.g. CRE / IRE / HRE, or French / German / Computer Studies) so they are scheduled simultaneously in the same class period with separate teachers and rooms.
          </p>
        </div>

        <form
          onSubmit={handleAddGroup}
          className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-900/40"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Group Name
              </label>
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="e.g. Option Block A"
                className={field}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Grade Scope
              </label>
              <select
                value={groupGrade}
                onChange={(e) => setGroupGrade(e.target.value)}
                className={field}
              >
                <option value="All Grades">All Grades</option>
                {tenant.grades.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Select Parallel Subjects (min 2)
            </p>
            <div className="mt-2 flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
              {allSubjectChoices.map((sub) => {
                const picked = groupSubjects.includes(sub);
                return (
                  <button
                    key={sub}
                    type="button"
                    onClick={() => toggleGroupSubject(sub)}
                    className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                      picked
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {sub}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="submit"
            disabled={saving || groupSubjects.length < 2}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            Save Optional Group
          </button>
        </form>

        <div className="space-y-2">
          {groups.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
              No optional subject groups created yet.
            </p>
          ) : (
            groups.map((grp) => (
              <div
                key={grp.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {grp.name}{' '}
                    <span className="font-normal text-xs text-slate-500 dark:text-slate-400">
                      ({grp.grade || 'All Grades'})
                    </span>
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {grp.subjects.map((sub) => (
                      <span
                        key={sub}
                        className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                      >
                        {sub}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleDeleteGroup(grp.id)}
                  aria-label="Delete optional group"
                  className="rounded p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
