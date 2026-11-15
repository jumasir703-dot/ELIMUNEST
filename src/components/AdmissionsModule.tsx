import { useMemo, useState } from 'react';
import { Plus, Search, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { saasApi } from '../lib/api';
import {
  getStreamsForGrade,
  KENYAN_CBC_GRADES,
  type TenantWorkspaceData,
} from '../shared/types';

interface AdmissionsModuleProps {
  workspace: TenantWorkspaceData;
  onRefresh: () => Promise<void>;
  onNotify: (title: string, tone?: 'success' | 'error') => void;
}

interface EditableStreamItem {
  original: string | null;
  value: string;
}

interface EditableGradeRow {
  id: string;
  originalGrade: string | null;
  grade: string;
  streams: EditableStreamItem[];
  newStreamDraft: string;
}

export function AdmissionsModule({ workspace, onRefresh, onNotify }: AdmissionsModuleProps) {
  const { tenant, students } = workspace;

  const availableGrades = useMemo(
    () => (tenant.grades.length > 0 ? tenant.grades : [...KENYAN_CBC_GRADES]),
    [tenant.grades]
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [gradeStreamFilter, setGradeStreamFilter] = useState<string>('All');
  const [yearFilter, setYearFilter] = useState<string>('All');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showStreamsModal, setShowStreamsModal] = useState(false);
  const [saving, setSaving] = useState(false);

  const [gradeRows, setGradeRows] = useState<EditableGradeRow[]>([]);
  const [newGradeName, setNewGradeName] = useState('');
  const [newGradeStreamsText, setNewGradeStreamsText] = useState('A, B');

  const initialGrade = availableGrades[0] || 'Playgroup';
  const initialStreams = getStreamsForGrade(tenant, initialGrade);

  const [formState, setFormState] = useState({
    fullName: '',
    studentCode: '',
    upi: '',
    dateOfBirth: '2012-05-14',
    gender: 'Female' as 'Female' | 'Male' | 'Non-binary',
    grade: initialGrade,
    section: initialStreams[0] || 'A',
    guardianName: '',
    guardianPhone: '+254 7',
    enrolledAt: new Date().toISOString().slice(0, 10),
  });

  const modalGradeStreams = useMemo(
    () => getStreamsForGrade(tenant, formState.grade),
    [tenant, formState.grade]
  );

  // Unique Grade & Stream combinations using per-grade uneven streams
  const gradeStreamOptions = useMemo(() => {
    const options: Array<{ value: string; label: string }> = [];
    availableGrades.forEach((g) => {
      const streams = getStreamsForGrade(tenant, g);
      options.push({ value: `grade:${g}`, label: `${g} (All Streams)` });
      streams.forEach((sec) => {
        options.push({ value: `${g}::${sec}`, label: `${g} · Stream ${sec}` });
      });
    });
    return options;
  }, [availableGrades, tenant]);

  // Unique Enrollment Years for dropdown filter
  const enrollmentYears = useMemo(() => {
    const years = new Set<string>();
    students.forEach((stu) => {
      const yr = stu.enrolledAt?.slice(0, 4);
      if (yr && /^\d{4}$/.test(yr)) {
        years.add(yr);
      }
    });
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [students]);

  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return students.filter((stu) => {
      if (gradeStreamFilter !== 'All') {
        if (gradeStreamFilter.startsWith('grade:')) {
          const g = gradeStreamFilter.slice(6);
          if (stu.grade !== g) return false;
        } else {
          const [g, sec] = gradeStreamFilter.split('::');
          if (stu.grade !== g || stu.section !== sec) return false;
        }
      }

      if (yearFilter !== 'All') {
        if (!stu.enrolledAt.startsWith(yearFilter)) return false;
      }

      if (!q) return true;
      return (
        stu.fullName.toLowerCase().includes(q) ||
        stu.studentCode.toLowerCase().includes(q) ||
        (stu.upi || '').toLowerCase().includes(q) ||
        stu.guardianName.toLowerCase().includes(q) ||
        stu.guardianPhone.toLowerCase().includes(q)
      );
    });
  }, [students, gradeStreamFilter, yearFilter, searchQuery]);

  function openGradesStreamsEditor() {
    const rows: EditableGradeRow[] = availableGrades.map((g, idx) => ({
      id: `grade-row-${idx}-${g}`,
      originalGrade: g,
      grade: g,
      streams: getStreamsForGrade(tenant, g).map((sec) => ({
        original: sec,
        value: sec,
      })),
      newStreamDraft: '',
    }));
    setGradeRows(rows);
    setNewGradeName('');
    setNewGradeStreamsText('A, B');
    setShowStreamsModal(true);
  }

  function handleCreateGradeRow() {
    const trimmedGrade = newGradeName.trim();
    if (!trimmedGrade) {
      onNotify('Enter a grade or class name first.', 'error');
      return;
    }
    if (
      gradeRows.some(
        (r) => r.grade.trim().toLowerCase() === trimmedGrade.toLowerCase()
      )
    ) {
      onNotify(`Grade "${trimmedGrade}" already exists.`, 'error');
      return;
    }

    const parsedStreams = Array.from(
      new Set(
        newGradeStreamsText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      )
    );
    const streamsToUse = parsedStreams.length > 0 ? parsedStreams : ['A'];

    setGradeRows((prev) => [
      ...prev,
      {
        id: `grade-row-new-${Date.now()}`,
        originalGrade: null,
        grade: trimmedGrade,
        streams: streamsToUse.map((s) => ({ original: null, value: s })),
        newStreamDraft: '',
      },
    ]);
    setNewGradeName('');
  }

  function handleAddStreamToGrade(gradeRowId: string) {
    setGradeRows((prev) =>
      prev.map((row) => {
        if (row.id !== gradeRowId) return row;
        const candidate = row.newStreamDraft.trim();
        if (!candidate) return row;
        if (
          row.streams.some(
            (st) => st.value.trim().toLowerCase() === candidate.toLowerCase()
          )
        ) {
          onNotify(`Stream "${candidate}" already exists in ${row.grade}.`, 'error');
          return row;
        }
        return {
          ...row,
          streams: [...row.streams, { original: null, value: candidate }],
          newStreamDraft: '',
        };
      })
    );
  }

  async function handleSaveGradesAndStreams(e: React.FormEvent) {
    e.preventDefault();
    if (gradeRows.length === 0) {
      onNotify('Keep at least one grade configured.', 'error');
      return;
    }

    const seenGrades = new Set<string>();
    const payloadConfigs: Array<{
      originalGrade?: string | null;
      grade: string;
      streams: string[];
      streamRenames?: Record<string, string>;
    }> = [];

    for (const row of gradeRows) {
      const gradeName = row.grade.trim();
      if (!gradeName) {
        onNotify('Grade names cannot be left blank.', 'error');
        return;
      }
      const key = gradeName.toLowerCase();
      if (seenGrades.has(key)) {
        onNotify(`Duplicate grade name "${gradeName}".`, 'error');
        return;
      }
      seenGrades.add(key);

      const cleanedStreams = row.streams.map((s) => s.value.trim()).filter(Boolean);
      if (cleanedStreams.length === 0) {
        onNotify(`Add at least one stream for ${gradeName}.`, 'error');
        return;
      }
      const uniqueStreams = Array.from(new Set(cleanedStreams));
      if (uniqueStreams.length !== cleanedStreams.length) {
        onNotify(`Stream names inside ${gradeName} must be unique.`, 'error');
        return;
      }

      const streamRenames: Record<string, string> = {};
      row.streams.forEach((st) => {
        const nextVal = st.value.trim();
        if (st.original && nextVal && st.original !== nextVal) {
          streamRenames[st.original] = nextVal;
        }
      });

      payloadConfigs.push({
        originalGrade: row.originalGrade,
        grade: gradeName,
        streams: uniqueStreams,
        streamRenames,
      });
    }

    setSaving(true);
    try {
      const { tenant: updatedTenant } = await saasApi.updateStreams(tenant.id, {
        gradeConfigs: payloadConfigs,
      });
      await onRefresh();
      setGradeStreamFilter('All');
      const nextDefaultGrade = updatedTenant.grades.includes(formState.grade)
        ? formState.grade
        : updatedTenant.grades[0] || 'Playgroup';
      const nextStreams = getStreamsForGrade(updatedTenant, nextDefaultGrade);
      setFormState((prev) => ({
        ...prev,
        grade: nextDefaultGrade,
        section: nextStreams.includes(prev.section) ? prev.section : nextStreams[0] || 'A',
      }));
      setShowStreamsModal(false);
      onNotify(`Saved ${updatedTenant.grades.length} grades and their stream assignments.`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to update grades & streams',
        'error'
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleEnrollStudent(e: React.FormEvent) {
    e.preventDefault();
    if (!formState.fullName.trim() || !formState.guardianName.trim() || !formState.guardianPhone.trim()) {
      onNotify('Student name, guardian name, and phone number are required.', 'error');
      return;
    }
    setSaving(true);
    try {
      const { student } = await saasApi.enrollStudent(tenant.id, formState);
      await onRefresh();
      setShowCreateModal(false);
      const resetGrade = availableGrades[0] || 'Playgroup';
      const resetStreams = getStreamsForGrade(tenant, resetGrade);
      setFormState({
        fullName: '',
        studentCode: '',
        upi: '',
        dateOfBirth: '2012-05-14',
        gender: 'Female',
        grade: resetGrade,
        section: resetStreams[0] || 'A',
        guardianName: '',
        guardianPhone: '+254 7',
        enrolledAt: new Date().toISOString().slice(0, 10),
      });
      onNotify(`${student.fullName} enrolled (${student.studentCode} · UPI ${student.upi}).`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to enroll student', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Student Admission & Onboarding
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Kenyan CBC student registry (Playgroup – Grade 12) with Admin No., UPI, custom grades & uneven per-class streams.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={openGradesStreamsEditor}
            className="inline-flex items-center gap-2 whitespace-nowrap shrink-0 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Customize Grades & Streams
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 whitespace-nowrap shrink-0 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-blue-600"
          >
            <Plus className="h-4 w-4" />
            New Enrollment
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between dark:border-slate-800 dark:bg-slate-900">
        <div className="relative w-full lg:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search Admin No., UPI, name, phone..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label
              htmlFor="grade-stream-filter"
              className="whitespace-nowrap text-xs font-medium text-slate-500 dark:text-slate-400"
            >
              Grade & Stream
            </label>
            <select
              id="grade-stream-filter"
              value={gradeStreamFilter}
              onChange={(e) => setGradeStreamFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="All">All Grades & Streams</option>
              {gradeStreamOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label
              htmlFor="enrollment-year-filter"
              className="whitespace-nowrap text-xs font-medium text-slate-500 dark:text-slate-400"
            >
              Enrollment Year
            </label>
            <select
              id="enrollment-year-filter"
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-800 tabular-nums focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="All">All Years</option>
              {enrollmentYears.map((yr) => (
                <option key={yr} value={yr}>
                  {yr}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Active Enrolled Student Directory */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-2 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Enrolled Students Roster
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              Showing {filteredStudents.length} of {students.length} enrolled students · {availableGrades.length} grades configured
            </p>
          </div>
          <button
            onClick={openGradesStreamsEditor}
            className="self-start text-xs font-medium text-blue-600 hover:underline sm:self-auto dark:text-blue-400"
          >
            Create / Customize Grades & Streams
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Admin No.</th>
                <th className="px-4 py-3">UPI</th>
                <th className="px-4 py-3">Full Name</th>
                <th className="px-4 py-3">Grade & Stream</th>
                <th className="px-4 py-3">Guardian Contact</th>
                <th className="px-4 py-3 text-right">Enrollment Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredStudents.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                    No students match the selected Grade & Stream or Enrollment Year filter.
                  </td>
                </tr>
              ) : (
                filteredStudents.map((stu) => (
                  <tr key={stu.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                    <td className="px-4 py-3 font-mono text-xs font-medium text-slate-700 tabular-nums dark:text-slate-300">
                      {stu.studentCode}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600 tabular-nums dark:text-slate-400">
                      {stu.upi}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                      {stu.fullName}
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                      {stu.grade} · Stream {stu.section}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700 dark:text-slate-300">
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {stu.guardianName}
                      </span>
                      <span className="mx-1.5 text-slate-400" aria-hidden="true">
                        ·
                      </span>
                      <span className="font-mono text-slate-600 tabular-nums dark:text-slate-400">
                        {stu.guardianPhone}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
                      {stu.enrolledAt}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Customize Grades & Uneven Streams Modal */}
      {showStreamsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  Customize Grades & Per-Class Streams
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Create, rename, or remove grades and assign independent streams per class (e.g. Playgroup: 1 stream, Grade 9: 3 streams).
                </p>
              </div>
              <button
                onClick={() => setShowStreamsModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveGradesAndStreams} className="flex min-h-0 flex-1 flex-col">
              {/* Add New Grade Bar */}
              <div className="border-b border-slate-100 bg-slate-50/70 px-6 py-3.5 dark:border-slate-800 dark:bg-slate-900/50">
                <p className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Create New Grade / Class
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={newGradeName}
                    onChange={(e) => setNewGradeName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCreateGradeRow();
                      }
                    }}
                    placeholder="Grade name (e.g. Daycare, Form 4, Grade 13)"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                  <input
                    type="text"
                    value={newGradeStreamsText}
                    onChange={(e) => setNewGradeStreamsText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCreateGradeRow();
                      }
                    }}
                    placeholder="Initial streams (e.g. East, West)"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none sm:w-56 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={handleCreateGradeRow}
                    className="inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Grade
                  </button>
                </div>
              </div>

              {/* Per-Grade Rows */}
              <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
                {gradeRows.map((row) => (
                  <div
                    key={row.id}
                    className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-1 items-center gap-2">
                        <input
                          type="text"
                          required
                          value={row.grade}
                          onChange={(e) =>
                            setGradeRows((prev) =>
                              prev.map((item) =>
                                item.id === row.id ? { ...item, grade: e.target.value } : item
                              )
                            )
                          }
                          aria-label="Grade name"
                          className="w-full max-w-xs rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        />
                        <span className="font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
                          {row.streams.length} {row.streams.length === 1 ? 'stream' : 'streams'}
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={gradeRows.length <= 1}
                        onClick={() =>
                          setGradeRows((prev) => prev.filter((item) => item.id !== row.id))
                        }
                        className="inline-flex items-center gap-1 self-start text-xs font-medium text-slate-500 hover:text-red-600 disabled:opacity-30 sm:self-auto dark:text-slate-400 dark:hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove Grade
                      </button>
                    </div>

                    {/* Streams list for this specific grade */}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {row.streams.map((st, sIdx) => (
                        <div
                          key={sIdx}
                          className="flex items-center rounded-lg border border-slate-200 bg-slate-50/70 pl-2.5 pr-1 py-1 dark:border-slate-700 dark:bg-slate-800"
                        >
                          <input
                            type="text"
                            required
                            value={st.value}
                            onChange={(e) =>
                              setGradeRows((prev) =>
                                prev.map((item) =>
                                  item.id === row.id
                                    ? {
                                        ...item,
                                        streams: item.streams.map((sItem, i) =>
                                          i === sIdx ? { ...sItem, value: e.target.value } : sItem
                                        ),
                                      }
                                    : item
                                )
                              )
                            }
                            aria-label={`Stream ${sIdx + 1} for ${row.grade}`}
                            className="w-24 bg-transparent text-xs font-medium text-slate-800 focus:outline-none dark:text-slate-100"
                          />
                          <button
                            type="button"
                            disabled={row.streams.length <= 1}
                            onClick={() =>
                              setGradeRows((prev) =>
                                prev.map((item) =>
                                  item.id === row.id
                                    ? {
                                        ...item,
                                        streams: item.streams.filter((_, i) => i !== sIdx),
                                      }
                                    : item
                                )
                              )
                            }
                            aria-label="Remove stream"
                            className="rounded p-1 text-slate-400 hover:text-red-600 disabled:opacity-25 dark:hover:text-red-400"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}

                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={row.newStreamDraft}
                          onChange={(e) =>
                            setGradeRows((prev) =>
                              prev.map((item) =>
                                item.id === row.id
                                  ? { ...item, newStreamDraft: e.target.value }
                                  : item
                              )
                            )
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddStreamToGrade(row.id);
                            }
                          }}
                          placeholder="New stream..."
                          className="w-28 rounded-lg border border-dashed border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        />
                        <button
                          type="button"
                          onClick={() => handleAddStreamToGrade(row.id)}
                          className="whitespace-nowrap rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          + Stream
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4 dark:border-slate-800">
                <p className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
                  {gradeRows.length} grades ·{' '}
                  {gradeRows.reduce((acc, r) => acc + r.streams.length, 0)} total streams
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowStreamsModal(false)}
                    className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save Grades & Streams'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Enrollment Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                New Student Enrollment
              </h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleEnrollStudent} className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Student Full Name
                </label>
                <input
                  required
                  type="text"
                  value={formState.fullName}
                  onChange={(e) => setFormState({ ...formState, fullName: e.target.value })}
                  placeholder="e.g. Muthoni Njeri"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Admin No. (auto if blank)
                </label>
                <input
                  type="text"
                  value={formState.studentCode}
                  onChange={(e) => setFormState({ ...formState, studentCode: e.target.value })}
                  placeholder="e.g. ADM-2615"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  UPI (auto if blank)
                </label>
                <input
                  type="text"
                  value={formState.upi}
                  onChange={(e) => setFormState({ ...formState, upi: e.target.value })}
                  placeholder="e.g. KE-8841099P"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Date of Birth
                </label>
                <input
                  required
                  type="date"
                  value={formState.dateOfBirth}
                  onChange={(e) => setFormState({ ...formState, dateOfBirth: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Grade & Stream
                </label>
                <div className="mt-1 flex gap-2">
                  <select
                    value={formState.grade}
                    onChange={(e) => {
                      const nextGrade = e.target.value;
                      const nextStreams = getStreamsForGrade(tenant, nextGrade);
                      setFormState({
                        ...formState,
                        grade: nextGrade,
                        section: nextStreams.includes(formState.section)
                          ? formState.section
                          : nextStreams[0] || 'A',
                      });
                    }}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {availableGrades.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                  <select
                    value={formState.section}
                    onChange={(e) => setFormState({ ...formState, section: e.target.value })}
                    className="w-36 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {modalGradeStreams.map((sec) => (
                      <option key={sec} value={sec}>
                        Stream {sec}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Guardian / Parent Name
                </label>
                <input
                  required
                  type="text"
                  value={formState.guardianName}
                  onChange={(e) => setFormState({ ...formState, guardianName: e.target.value })}
                  placeholder="e.g. Mary Wanjiku"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Guardian Phone No. (Kenyan)
                </label>
                <input
                  required
                  type="tel"
                  value={formState.guardianPhone}
                  onChange={(e) => setFormState({ ...formState, guardianPhone: e.target.value })}
                  placeholder="+254 712 345 678"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Gender
                </label>
                <select
                  value={formState.gender}
                  onChange={(e) =>
                    setFormState({
                      ...formState,
                      gender: e.target.value as 'Female' | 'Male' | 'Non-binary',
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="Female">Female</option>
                  <option value="Male">Male</option>
                  <option value="Non-binary">Non-binary</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Enrollment Date
                </label>
                <input
                  required
                  type="date"
                  value={formState.enrolledAt}
                  onChange={(e) => setFormState({ ...formState, enrolledAt: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2 sm:col-span-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? 'Enrolling...' : 'Enroll Student'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
