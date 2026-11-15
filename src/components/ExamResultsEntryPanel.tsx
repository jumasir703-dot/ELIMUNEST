import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Lock,
  RotateCcw,
  Save,
  Upload,
} from 'lucide-react';
import { saasApi } from '../lib/api';
import { computeClientGrade } from '../lib/format';
import {
  getStreamsForGrade,
  getSubjectsForGrade,
  getTeacherAssignedSubjectsForCohort,
  is844FormFourGrade,
  STANDARD_ASSESSMENT_TYPES,
  type TenantWorkspaceData,
  type UserRole,
} from '../shared/types';

interface ExamResultsEntryPanelProps {
  workspace: TenantWorkspaceData;
  currentRole: UserRole;
  onRefresh: () => Promise<void>;
  onNotify: (title: string, tone?: 'success' | 'error') => void;
  onViewResults?: (cycleId: string, grade: string) => void;
}

interface StagedScoreEntry {
  studentId: string;
  subject: string;
  score: string;
  remarks: string;
  source: 'manual' | 'excel';
}

interface ExcelPullSummary {
  fileName: string;
  pulledCount: number;
  pulledSubjects: string[];
  blockedSubjects: string[];
  skippedRows: string[];
  invalidScores: string[];
}

function getGradeBadgeColor(letterGrade: string, is844: boolean): string {
  if (is844) {
    if (letterGrade === 'A' || letterGrade === 'A-') {
      return 'text-emerald-700 dark:text-emerald-400';
    }
    if (letterGrade.startsWith('B')) {
      return 'text-blue-700 dark:text-blue-400';
    }
    if (letterGrade.startsWith('D') || letterGrade === 'E') {
      return 'text-red-700 dark:text-red-400';
    }
    return 'text-slate-800 dark:text-slate-200';
  }
  if (letterGrade.startsWith('EE')) return 'text-emerald-700 dark:text-emerald-400';
  if (letterGrade.startsWith('ME')) return 'text-blue-700 dark:text-blue-400';
  if (letterGrade.startsWith('AE')) return 'text-amber-700 dark:text-amber-400';
  if (letterGrade.startsWith('BE')) return 'text-red-700 dark:text-red-400';
  return 'text-slate-800 dark:text-slate-200';
}

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function ExamResultsEntryPanel({
  workspace,
  currentRole,
  onRefresh,
  onNotify,
  onViewResults,
}: ExamResultsEntryPanelProps) {
  const { tenant, students, examCycles, examResults, timetable } = workspace;

  const defaultGrade = tenant.grades.includes('Grade 9')
    ? 'Grade 9'
    : tenant.grades[0] || 'Grade 9';
  const defaultStream = getStreamsForGrade(tenant, defaultGrade)[0] || 'A';

  const isAdminRole = currentRole === 'Admin' || currentRole === 'Super Admin';
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>(
    tenant.teachers[0]?.id || (isAdminRole ? '__ADMIN__' : '')
  );
  const [selectedExamType, setSelectedExamType] = useState<string>(
    STANDARD_ASSESSMENT_TYPES[1]
  );
  const [selectedGrade, setSelectedGrade] = useState<string>(defaultGrade);
  const [selectedStream, setSelectedStream] = useState<string>(defaultStream);
  const [selectedSubject, setSelectedSubject] = useState<string>('');
  const [stagedEntries, setStagedEntries] = useState<Record<string, StagedScoreEntry>>({});
  const [excelSummary, setExcelSummary] = useState<ExcelPullSummary | null>(null);
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const availableStreams = useMemo(
    () => getStreamsForGrade(tenant, selectedGrade),
    [tenant, selectedGrade]
  );
  const effectiveStream = availableStreams.includes(selectedStream)
    ? selectedStream
    : availableStreams[0] || 'A';

  const levelSubjects = useMemo(
    () => getSubjectsForGrade(tenant, selectedGrade),
    [tenant, selectedGrade]
  );

  // Build available exam types (standard 3 types + any custom cycle names)
  const examTypeChoices = useMemo(() => {
    const standardSet = new Set(STANDARD_ASSESSMENT_TYPES.map((t) => t.toLowerCase()));
    const customTitles = examCycles
      .map((c) => c.title)
      .filter((title) => {
        const lower = title.toLowerCase();
        return (
          !lower.includes('opening exam') &&
          !lower.includes('mid-term exam') &&
          !lower.includes('midterm exam') &&
          !lower.includes('end of term exam') &&
          !standardSet.has(lower)
        );
      });
    return [...STANDARD_ASSESSMENT_TYPES, ...Array.from(new Set(customTitles))];
  }, [examCycles]);

  // Resolve matching exam cycle for the selected exam type
  const matchedCycle = useMemo(() => {
    const typeNorm = selectedExamType.trim().toLowerCase().replace(/^term\s+/i, '');
    return (
      examCycles.find((c) => c.title.toLowerCase().includes(typeNorm)) ||
      examCycles.find((c) => c.title.toLowerCase() === selectedExamType.toLowerCase()) ||
      null
    );
  }, [examCycles, selectedExamType]);

  const effectiveTeacherId = useMemo(() => {
    if (selectedTeacherId === '__ADMIN__' && isAdminRole) {
      return '__ADMIN__';
    }
    const found = tenant.teachers.find((t) => t.id === selectedTeacherId);
    if (found) return found.id;
    return tenant.teachers[0]?.id || (isAdminRole ? '__ADMIN__' : '');
  }, [selectedTeacherId, isAdminRole, tenant.teachers]);

  const selectedTeacher = useMemo(
    () => tenant.teachers.find((t) => t.id === effectiveTeacherId) || null,
    [tenant.teachers, effectiveTeacherId]
  );

  const allowedSubjects = useMemo(() => {
    if (effectiveTeacherId === '__ADMIN__' && isAdminRole) {
      return levelSubjects;
    }
    return getTeacherAssignedSubjectsForCohort(
      tenant,
      selectedTeacher,
      selectedGrade,
      effectiveStream,
      timetable
    );
  }, [
    effectiveTeacherId,
    isAdminRole,
    levelSubjects,
    tenant,
    selectedTeacher,
    selectedGrade,
    effectiveStream,
    timetable,
  ]);

  const effectiveSubject = useMemo(() => {
    if (allowedSubjects.length === 0) return '';
    if (allowedSubjects.includes(selectedSubject)) return selectedSubject;
    return allowedSubjects[0];
  }, [allowedSubjects, selectedSubject]);

  const cohortStudents = useMemo(
    () =>
      students
        .filter(
          (s) =>
            s.grade === selectedGrade &&
            s.section === effectiveStream &&
            s.status === 'Active'
        )
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [students, selectedGrade, effectiveStream]
  );

  const is844 = is844FormFourGrade(selectedGrade);
  const maxPoints = is844 ? 12 : 8;

  // Compute pending valid staged entries scoped to current allowed subjects & cohort students
  const pendingValidEntries = useMemo(() => {
    const allowedSet = new Set(allowedSubjects.map((s) => s.toLowerCase()));
    const studentIdSet = new Set(cohortStudents.map((s) => s.id));
    const list: Array<{ studentId: string; subject: string; score: number; remarks: string; source: 'manual' | 'excel' }> = [];

    for (const item of Object.values(stagedEntries)) {
      if (!studentIdSet.has(item.studentId)) continue;
      if (!allowedSet.has(item.subject.toLowerCase())) continue;
      const trimmed = item.score.trim();
      if (trimmed === '') continue;
      const num = Number(trimmed);
      if (!Number.isFinite(num) || num < 0 || num > 100) continue;
      list.push({
        studentId: item.studentId,
        subject: item.subject,
        score: Math.round(num),
        remarks: item.remarks.trim(),
        source: item.source,
      });
    }
    return list;
  }, [stagedEntries, allowedSubjects, cohortStudents]);

  const stagedCountBySubject = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const entry of pendingValidEntries) {
      counts[entry.subject] = (counts[entry.subject] || 0) + 1;
    }
    return counts;
  }, [pendingValidEntries]);

  function clearStagedForCohortChange() {
    setStagedEntries({});
    setExcelSummary(null);
  }

  function handleScoreChange(studentId: string, value: string, existingRemarks: string) {
    if (!effectiveSubject) return;
    const key = `${studentId}::${effectiveSubject}`;
    setStagedEntries((prev) => {
      const existingDraft = prev[key];
      return {
        ...prev,
        [key]: {
          studentId,
          subject: effectiveSubject,
          score: value,
          remarks: existingDraft?.remarks ?? existingRemarks,
          source: 'manual',
        },
      };
    });
  }

  function handleRemarksChange(studentId: string, remarksVal: string, existingScore: number | undefined) {
    if (!effectiveSubject) return;
    const key = `${studentId}::${effectiveSubject}`;
    setStagedEntries((prev) => {
      const existingDraft = prev[key];
      const fallbackScore =
        existingDraft?.score ?? (existingScore !== undefined ? String(existingScore) : '');
      return {
        ...prev,
        [key]: {
          studentId,
          subject: effectiveSubject,
          score: fallbackScore,
          remarks: remarksVal,
          source: existingDraft?.source ?? 'manual',
        },
      };
    });
  }

  function handleDownloadTemplate() {
    if (cohortStudents.length === 0) {
      onNotify(
        `No active students found in ${selectedGrade} Stream ${effectiveStream}.`,
        'error'
      );
      return;
    }
    if (allowedSubjects.length === 0) {
      onNotify(
        `${selectedTeacher?.name || 'Selected teacher'} has no assigned subjects in ${selectedGrade} Stream ${effectiveStream}.`,
        'error'
      );
      return;
    }

    const cycleId = matchedCycle?.id || '';
    const rows = cohortStudents.map((stu) => {
      const row: Record<string, string | number> = {
        'Adm No': stu.studentCode,
        'Student Name': stu.fullName,
      };
      for (const sub of allowedSubjects) {
        const existing = examResults.find(
          (r) =>
            r.examCycleId === cycleId &&
            r.studentId === stu.id &&
            r.subject.toLowerCase() === sub.toLowerCase()
        );
        row[sub] = existing ? existing.score : '';
      }
      row['Remarks'] = '';
      return row;
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      `${selectedGrade} ${effectiveStream}`.slice(0, 31)
    );
    const safeName = `${selectedExamType}-${selectedGrade}-Stream-${effectiveStream}`
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .toLowerCase();
    XLSX.writeFile(workbook, `${safeName}-marks-template.xlsx`);
    onNotify(
      `Downloaded Excel template with ${allowedSubjects.length} assigned subject column(s) for ${selectedGrade} Stream ${effectiveStream}.`
    );
  }

  async function handleExcelFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (allowedSubjects.length === 0) {
      onNotify(
        `${selectedTeacher?.name || 'Teacher'} is not assigned to teach any subject in ${selectedGrade} Stream ${effectiveStream}.`,
        'error'
      );
      return;
    }
    if (cohortStudents.length === 0) {
      onNotify(`No active students in ${selectedGrade} Stream ${effectiveStream}.`, 'error');
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        onNotify('The uploaded Excel file contains no sheets.', 'error');
        return;
      }

      const sheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: '',
        raw: false,
      });
      if (rows.length === 0) {
        onNotify('The uploaded Excel sheet has no data rows.', 'error');
        return;
      }

      const headers = Object.keys(rows[0]);
      const idHeader = headers.find((h) =>
        /^(adm(\s*no)?|admission(\s*(no|number))?|student\s*(id|code)|id|upi)$/i.test(
          normalizeHeader(h)
        )
      );
      const nameHeader = headers.find((h) =>
        /^(student\s*name|full\s*name|name|learner(\s*name)?)$/i.test(normalizeHeader(h))
      );
      const remarksHeader = headers.find((h) =>
        /^(remarks?|comment|comments|teacher\s*remarks?)$/i.test(normalizeHeader(h))
      );
      const subjectColHeader = headers.find((h) =>
        /^(subject|learning\s*area|course)$/i.test(normalizeHeader(h))
      );
      const genericScoreHeader = headers.find((h) =>
        /^(score|marks?|total\s*marks?|percentage|score\s*0\s*100)$/i.test(
          normalizeHeader(h)
        )
      );

      // Map all known school/level subjects for clear unauthorized-subject detection
      const allSchoolSubjects = Array.from(
        new Set([...levelSubjects, ...tenant.subjects])
      );
      const allowedSubjectLookup = new Map<string, string>();
      allowedSubjects.forEach((s) => allowedSubjectLookup.set(normalizeHeader(s), s));

      const allSchoolSubjectLookup = new Map<string, string>();
      allSchoolSubjects.forEach((s) => allSchoolSubjectLookup.set(normalizeHeader(s), s));

      const nonSubjectHeaders = new Set(
        [idHeader, nameHeader, remarksHeader, subjectColHeader, genericScoreHeader]
          .filter(Boolean)
          .map((h) => h as string)
      );

      // Determine multi-subject score columns vs single-score column
      const allowedScoreCols: Array<{ header: string; subject: string }> = [];
      const blockedSubjectSet = new Set<string>();

      for (const h of headers) {
        if (nonSubjectHeaders.has(h)) continue;
        const norm = normalizeHeader(h);
        if (!norm || /^(s\/?n|no|#|serial|grade|stream|section|class|rank|points|mean)$/i.test(norm)) {
          continue;
        }
        const allowedMatch = allowedSubjectLookup.get(norm);
        if (allowedMatch) {
          allowedScoreCols.push({ header: h, subject: allowedMatch });
        } else {
          const schoolMatch = allSchoolSubjectLookup.get(norm);
          blockedSubjectSet.add(schoolMatch || h.trim());
        }
      }

      if (allowedScoreCols.length === 0 && !genericScoreHeader) {
        if (blockedSubjectSet.size > 0) {
          const blockedList = Array.from(blockedSubjectSet);
          setExcelSummary({
            fileName: file.name,
            pulledCount: 0,
            pulledSubjects: [],
            blockedSubjects: blockedList,
            skippedRows: [],
            invalidScores: [],
          });
          onNotify(
            `Upload blocked: ${selectedTeacher?.name || 'Teacher'} is not assigned to teach ${blockedList.join(', ')} in ${selectedGrade} Stream ${effectiveStream}.`,
            'error'
          );
          return;
        }
        onNotify(
          'Could not detect a Score/Marks column or any assigned Subject column in the Excel sheet.',
          'error'
        );
        return;
      }

      const nextStaged = { ...stagedEntries };
      let pulledCount = 0;
      const pulledSubjectsSet = new Set<string>();
      const skippedRows: string[] = [];
      const invalidScores: string[] = [];

      rows.forEach((rawRow, idx) => {
        const rowNum = idx + 2;
        const idVal = idHeader ? String(rawRow[idHeader] ?? '').trim() : '';
        const nameVal = nameHeader ? String(rawRow[nameHeader] ?? '').trim() : '';
        if (!idVal && !nameVal) return;

        const student = cohortStudents.find((s) => {
          if (idVal) {
            const lowId = idVal.toLowerCase();
            if (
              s.studentCode.toLowerCase() === lowId ||
              s.upi.toLowerCase() === lowId ||
              s.id.toLowerCase() === lowId
            ) {
              return true;
            }
          }
          if (nameVal && s.fullName.toLowerCase() === nameVal.toLowerCase()) {
            return true;
          }
          return false;
        });

        if (!student) {
          skippedRows.push(`Row ${rowNum}: ${idVal || nameVal} (not in ${selectedGrade} Stream ${effectiveStream})`);
          return;
        }

        const rowRemarks = remarksHeader ? String(rawRow[remarksHeader] ?? '').trim() : '';

        if (allowedScoreCols.length > 0) {
          // Multi-subject or subject-named column Excel sheet
          for (const col of allowedScoreCols) {
            const rawCell = String(rawRow[col.header] ?? '').trim();
            if (rawCell === '') continue;
            const parsed = Number(rawCell);
            if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
              invalidScores.push(`Row ${rowNum} (${student.fullName} · ${col.subject}): "${rawCell}"`);
              continue;
            }
            const rounded = Math.round(parsed);
            nextStaged[`${student.id}::${col.subject}`] = {
              studentId: student.id,
              subject: col.subject,
              score: String(rounded),
              remarks: rowRemarks,
              source: 'excel',
            };
            pulledCount += 1;
            pulledSubjectsSet.add(col.subject);
          }
        } else if (genericScoreHeader) {
          // Single-score column Excel sheet
          const rawCell = String(rawRow[genericScoreHeader] ?? '').trim();
          if (rawCell === '') return;

          let targetSub = effectiveSubject;
          if (subjectColHeader) {
            const rowSubRaw = String(rawRow[subjectColHeader] ?? '').trim();
            if (rowSubRaw) {
              const matchedAllowed = allowedSubjectLookup.get(normalizeHeader(rowSubRaw));
              if (!matchedAllowed) {
                blockedSubjectSet.add(rowSubRaw);
                return;
              }
              targetSub = matchedAllowed;
            }
          }

          if (!targetSub) return;

          const parsed = Number(rawCell);
          if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
            invalidScores.push(`Row ${rowNum} (${student.fullName} · ${targetSub}): "${rawCell}"`);
            return;
          }
          const rounded = Math.round(parsed);
          nextStaged[`${student.id}::${targetSub}`] = {
            studentId: student.id,
            subject: targetSub,
            score: String(rounded),
            remarks: rowRemarks,
            source: 'excel',
          };
          pulledCount += 1;
          pulledSubjectsSet.add(targetSub);
        }
      });

      const pulledSubjects = Array.from(pulledSubjectsSet);
      const blockedSubjects = Array.from(blockedSubjectSet);

      setStagedEntries(nextStaged);
      if (pulledSubjects.length > 0 && !pulledSubjects.includes(effectiveSubject)) {
        setSelectedSubject(pulledSubjects[0]);
      }
      setExcelSummary({
        fileName: file.name,
        pulledCount,
        pulledSubjects,
        blockedSubjects,
        skippedRows,
        invalidScores,
      });

      if (pulledCount > 0) {
        onNotify(
          `Pulled ${pulledCount} mark(s) from ${file.name}. Review and click Save Results to commit.`
        );
      } else if (blockedSubjects.length > 0) {
        onNotify(
          `No marks imported: ${blockedSubjects.join(', ')} not assigned to ${selectedTeacher?.name || 'selected teacher'} in ${selectedGrade} Stream ${effectiveStream}.`,
          'error'
        );
      } else {
        onNotify('No valid matching student marks were found in the uploaded Excel file.', 'error');
      }
    } catch (err) {
      onNotify(
        err instanceof Error ? `Failed to read Excel file: ${err.message}` : 'Failed to read Excel file.',
        'error'
      );
    }
  }

  async function handleSaveAllResults() {
    if (pendingValidEntries.length === 0) {
      onNotify('Enter marks manually or upload an Excel file first.', 'error');
      return;
    }
    if (!effectiveTeacherId) {
      onNotify('Select the entering teacher before saving.', 'error');
      return;
    }

    setSaving(true);
    try {
      const response = await saasApi.saveExamScoresBatch(tenant.id, {
        examCycleId: matchedCycle?.id,
        examType: selectedExamType,
        grade: selectedGrade,
        section: effectiveStream,
        teacherId: effectiveTeacherId,
        entries: pendingValidEntries.map((item) => ({
          studentId: item.studentId,
          subject: item.subject,
          score: item.score,
          remarks: item.remarks || undefined,
        })),
      });

      await onRefresh();
      setStagedEntries({});
      setExcelSummary(null);
      onNotify(
        `Saved ${response.savedCount} result(s) to ${response.cycle.title} (${selectedGrade} Stream ${effectiveStream}).`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to save exam results.', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Configuration Controls Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Exam Results Entry
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Select teacher, exam type, grade, and stream, then enter marks manually or pull from an Excel spreadsheet before saving.
            </p>
          </div>
          {matchedCycle && (
            <span className="font-mono text-xs font-medium text-blue-700 dark:text-blue-400">
              Target Cycle: {matchedCycle.title} ({matchedCycle.status})
            </span>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              Teacher
            </label>
            <select
              aria-label="Select teacher"
              value={effectiveTeacherId}
              onChange={(e) => {
                setSelectedTeacherId(e.target.value);
                clearStagedForCohortChange();
              }}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              {tenant.teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
              {isAdminRole && (
                <option value="__ADMIN__">Exam Officer (Admin · All Subjects)</option>
              )}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              Exam Type
            </label>
            <select
              aria-label="Select exam type"
              value={selectedExamType}
              onChange={(e) => {
                setSelectedExamType(e.target.value);
                clearStagedForCohortChange();
              }}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              {examTypeChoices.map((et) => (
                <option key={et} value={et}>
                  {et}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              Grade
            </label>
            <select
              aria-label="Select grade"
              value={selectedGrade}
              onChange={(e) => {
                const nextGrade = e.target.value;
                const nextStreams = getStreamsForGrade(tenant, nextGrade);
                setSelectedGrade(nextGrade);
                setSelectedStream(nextStreams[0] || 'A');
                clearStagedForCohortChange();
              }}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              {tenant.grades.map((g) => (
                <option key={g} value={g}>
                  {is844FormFourGrade(g) ? `${g} (Form 4 · 8-4-4)` : g}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              Stream
            </label>
            <select
              aria-label="Select stream"
              value={effectiveStream}
              onChange={(e) => {
                setSelectedStream(e.target.value);
                clearStagedForCohortChange();
              }}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              {availableStreams.map((sec) => (
                <option key={sec} value={sec}>
                  Stream {sec}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              Subject (Assigned Only)
            </label>
            <select
              aria-label="Select assigned subject"
              value={effectiveSubject}
              disabled={allowedSubjects.length === 0}
              onChange={(e) => setSelectedSubject(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              {allowedSubjects.length === 0 ? (
                <option value="">No Assigned Subjects</option>
              ) : (
                allowedSubjects.map((sub) => (
                  <option key={sub} value={sub}>
                    {sub}
                    {stagedCountBySubject[sub] ? ` (${stagedCountBySubject[sub]} staged)` : ''}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        {/* Teacher Subject Assignment Scope Notice */}
        <div className="mt-4 flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-800/40">
          <div className="flex items-start gap-2.5 text-xs">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
            <div>
              {effectiveTeacherId === '__ADMIN__' ? (
                <p className="font-medium text-slate-800 dark:text-slate-200">
                  Exam Officer Mode: Full access across all {levelSubjects.length} subjects in{' '}
                  {selectedGrade} Stream {effectiveStream}.
                </p>
              ) : allowedSubjects.length > 0 ? (
                <>
                  <p className="font-medium text-slate-800 dark:text-slate-200">
                    {selectedTeacher?.name} is assigned in {selectedGrade} Stream {effectiveStream} to teach:{' '}
                    <span className="font-semibold text-blue-700 dark:text-blue-400">
                      {allowedSubjects.join(', ')}
                    </span>
                  </p>
                  <p className="mt-0.5 text-slate-500 dark:text-slate-400">
                    Only these assigned subjects can be entered manually or pulled from an uploaded Excel file. Unassigned subjects in spreadsheets are automatically blocked.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-semibold text-amber-800 dark:text-amber-300">
                    {selectedTeacher?.name || 'Selected teacher'} is not assigned to teach any subjects in {selectedGrade} Stream {effectiveStream}.
                  </p>
                  <p className="mt-0.5 text-slate-600 dark:text-slate-400">
                    Assign a subject & stream to this teacher in the Timetable module or select an assigned teacher above.
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Excel Template Download & Upload Buttons */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={allowedSubjects.length === 0 || cohortStudents.length === 0}
              onClick={handleDownloadTemplate}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Download className="h-3.5 w-3.5" />
              Excel Template
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleExcelFileSelected}
              className="hidden"
            />
            <button
              type="button"
              disabled={allowedSubjects.length === 0 || cohortStudents.length === 0}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-700"
            >
              <Upload className="h-3.5 w-3.5" />
              Upload Excel (.xlsx)
            </button>
          </div>
        </div>
      </div>

      {/* Excel Pull Feedback Banner */}
      {excelSummary && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <FileSpreadsheet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span>Excel Import: {excelSummary.fileName}</span>
            </div>
            <span className="font-mono text-xs text-slate-600 tabular-nums dark:text-slate-400">
              {excelSummary.pulledCount} mark(s) pulled
            </span>
          </div>

          {excelSummary.pulledSubjects.length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              <span>Pulled subjects ready to save:</span>
              {excelSummary.pulledSubjects.map((sub) => (
                <button
                  key={sub}
                  type="button"
                  onClick={() => setSelectedSubject(sub)}
                  className={`rounded border px-2 py-0.5 font-medium transition-colors ${
                    effectiveSubject === sub
                      ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/60 dark:text-blue-300'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:border-emerald-400 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                  }`}
                >
                  {sub} ({stagedCountBySubject[sub] || 0})
                </button>
              ))}
            </div>
          )}

          {excelSummary.blockedSubjects.length > 0 && (
            <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>
                <strong>Blocked unauthorized subject(s):</strong>{' '}
                {excelSummary.blockedSubjects.join(', ')} —{' '}
                {selectedTeacher?.name || 'selected teacher'} is not assigned to teach{' '}
                {excelSummary.blockedSubjects.length === 1 ? 'this subject' : 'these subjects'} in{' '}
                {selectedGrade} Stream {effectiveStream}.
              </div>
            </div>
          )}

          {(excelSummary.skippedRows.length > 0 || excelSummary.invalidScores.length > 0) && (
            <div className="mt-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
              {excelSummary.skippedRows.length > 0 && (
                <p>
                  Skipped {excelSummary.skippedRows.length} row(s) not matching students in{' '}
                  {selectedGrade} Stream {effectiveStream}.
                </p>
              )}
              {excelSummary.invalidScores.length > 0 && (
                <p>
                  Ignored {excelSummary.invalidScores.length} invalid mark(s) (must be 0–100).
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Manual / Staged Results Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="text-xs text-slate-600 dark:text-slate-400">
            Showing <strong className="text-slate-900 dark:text-slate-100">{cohortStudents.length}</strong>{' '}
            active student(s) in <strong className="text-slate-900 dark:text-slate-100">{selectedGrade} Stream {effectiveStream}</strong>
            {effectiveSubject ? (
              <>
                {' '}· Subject:{' '}
                <strong className="text-blue-700 dark:text-blue-400">{effectiveSubject}</strong>
              </>
            ) : null}
          </div>
          <div className="font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
            Scale: {is844 ? '8-4-4 KCSE (A–E · /12)' : 'Current CBE (EE1–BE2 · /8)'}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Adm No</th>
                <th className="px-4 py-3">Student Name</th>
                <th className="px-4 py-3 text-right">Saved Mark</th>
                <th className="px-4 py-3">Enter Mark (0–100)</th>
                <th className="px-4 py-3">Remarks</th>
                <th className="px-4 py-3 text-right">{is844 ? '8-4-4 Grade' : 'CBE Level'}</th>
                <th className="px-4 py-3 text-right">Points (/{maxPoints})</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {allowedSubjects.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                    No assigned subjects available for {selectedTeacher?.name || 'this teacher'} in {selectedGrade} Stream {effectiveStream}.
                  </td>
                </tr>
              ) : cohortStudents.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                    No active students enrolled in {selectedGrade} Stream {effectiveStream}.
                  </td>
                </tr>
              ) : (
                cohortStudents.map((stu) => {
                  const existing = matchedCycle
                    ? examResults.find(
                        (r) =>
                          r.examCycleId === matchedCycle.id &&
                          r.studentId === stu.id &&
                          r.subject.toLowerCase() === effectiveSubject.toLowerCase()
                      )
                    : undefined;
                  const draft = stagedEntries[`${stu.id}::${effectiveSubject}`];
                  const inputScore =
                    draft !== undefined
                      ? draft.score
                      : existing
                      ? String(existing.score)
                      : '';
                  const inputRemarks =
                    draft !== undefined ? draft.remarks : existing?.remarks || '';

                  const numericVal =
                    inputScore.trim() !== '' && !Number.isNaN(Number(inputScore))
                      ? Math.max(0, Math.min(100, Math.round(Number(inputScore))))
                      : null;
                  const graded =
                    numericVal !== null ? computeClientGrade(numericVal, stu.grade) : null;

                  return (
                    <tr
                      key={stu.id}
                      className={
                        draft
                          ? 'bg-blue-50/40 dark:bg-blue-950/20'
                          : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/30'
                      }
                    >
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
                        {stu.studentCode}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                        <span>{stu.fullName}</span>
                        {draft && (
                          <span className="ml-2 text-[11px] font-medium text-blue-600 dark:text-blue-400">
                            ({draft.source === 'excel' ? 'Pulled from Excel' : 'Edited'})
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
                        {existing ? `${existing.score}%` : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={inputScore}
                          onChange={(e) =>
                            handleScoreChange(stu.id, e.target.value, existing?.remarks || '')
                          }
                          placeholder="—"
                          aria-label={`Mark for ${stu.fullName}`}
                          className="w-24 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-sm text-slate-900 tabular-nums focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <input
                          type="text"
                          value={inputRemarks}
                          onChange={(e) =>
                            handleRemarksChange(stu.id, e.target.value, existing?.score)
                          }
                          placeholder="Optional remark"
                          aria-label={`Remarks for ${stu.fullName}`}
                          className="w-full min-w-[160px] rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                        />
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs font-bold tabular-nums">
                        {graded ? (
                          <span className={getGradeBadgeColor(graded.letterGrade, is844)}>
                            {graded.letterGrade}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-600 tabular-nums dark:text-slate-400">
                        {graded ? `${graded.gpaPoints} / ${maxPoints}` : '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Save Action Bar */}
        <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50/70 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-900/50">
          <div className="text-xs text-slate-600 dark:text-slate-400">
            {pendingValidEntries.length > 0 ? (
              <span>
                <strong className="font-mono text-slate-900 dark:text-slate-100">
                  {pendingValidEntries.length}
                </strong>{' '}
                unsaved mark(s) staged for{' '}
                <strong className="text-slate-900 dark:text-slate-100">
                  {selectedExamType} · {selectedGrade} Stream {effectiveStream}
                </strong>
                .
              </span>
            ) : (
              <span>
                Enter marks above or upload an Excel spreadsheet, then click <strong>Save Results</strong>.
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {matchedCycle && onViewResults && (
              <button
                type="button"
                onClick={() => onViewResults(matchedCycle.id, selectedGrade)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                View Ranked Summary
              </button>
            )}
            {pendingValidEntries.length > 0 && (
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setStagedEntries({});
                  setExcelSummary(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Discard Staged
              </button>
            )}
            <button
              type="button"
              disabled={saving || pendingValidEntries.length === 0 || allowedSubjects.length === 0}
              onClick={handleSaveAllResults}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {saving
                ? 'Saving Results...'
                : pendingValidEntries.length > 0
                ? `Save Results (${pendingValidEntries.length})`
                : 'Save Results'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
