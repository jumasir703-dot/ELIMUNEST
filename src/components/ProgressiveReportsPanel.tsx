import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Edit3,
  FileSpreadsheet,
  Plus,
  Printer,
  Save,
  Trash2,
  TrendingUp,
  Upload,
} from 'lucide-react';
import { saasApi } from '../lib/api';
import {
  createBrandedWorksheetFromObjects,
  parseExcelSheetRowsSmart,
} from '../lib/documentBranding';
import { isNonSatExamResult, shortenCycleTitle, sortExamCyclesChronologically } from '../lib/examAnalytics';
import { computeClientGrade, formatDateShort } from '../lib/format';
import {
  getStreamsForGrade,
  getStudentRegisteredSubjects,
  getSubjectsForGrade,
  getTeacherAssignedSubjectsForCohort,
  type CbcLearnerMasteryLevel,
  type ExamResultStatus,
  type LearnerProgressiveEntry,
  type ProgressiveReportSubjectScore,
  type TenantWorkspaceData,
  type UserRole,
} from '../shared/types';
import { TenantDocumentHeader } from './TenantDocumentHeader';

interface ProgressiveReportsPanelProps {
  workspace: TenantWorkspaceData;
  currentRole?: UserRole;
  currentUserId?: string;
  currentUserEmail?: string;
  readOnly?: boolean;
  onRefresh: () => Promise<void>;
  onNotify: (title: string, tone?: 'success' | 'error') => void;
}

type PanelMode = 'viewer' | 'manual' | 'import';

interface SubjectDraftRow {
  subject: string;
  resultStatus: ExamResultStatus;
  score: string;
  masteryLevel: CbcLearnerMasteryLevel | '';
  remarks: string;
}

interface ParsedImportRow {
  rowIndex: number;
  studentCode?: string;
  studentName?: string;
  matchedStudentId?: string;
  matchedStudentLabel?: string;
  subjects: Array<{
    subject: string;
    score: number | null;
    resultStatus: ExamResultStatus;
  }>;
  classTeacherRemarks?: string;
  warning?: string;
}

interface UnifiedCheckpoint {
  id: string;
  kind: 'exam-cycle' | 'manual' | 'import';
  title: string;
  shortLabel: string;
  academicYear: string;
  term: string;
  date: string;
  totalScore: number;
  maxPossible: number;
  meanScore: number;
  meanGrade: string;
  deltaFromPrev: number | null;
  subjects: Array<{
    subject: string;
    score: number | null;
    maxScore: number;
    resultStatus?: ExamResultStatus;
    letterGrade: string;
    masteryLevel?: CbcLearnerMasteryLevel;
    remarks?: string;
  }>;
  classTeacherRemarks?: string;
  recordedByName?: string;
  progressiveEntry?: LearnerProgressiveEntry;
}

const MASTERY_LEVELS: CbcLearnerMasteryLevel[] = [
  'Exceeding Expectations',
  'Meeting Expectations',
  'Approaching Expectations',
  'Below Expectations',
];

const LABEL_PRESETS = ['Opener CAT', 'CAT 1', 'Mid-Term Check', 'CAT 2', 'End of Term'];

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function autoMasteryFromScore(score: number): CbcLearnerMasteryLevel {
  if (score >= 80) return 'Exceeding Expectations';
  if (score >= 60) return 'Meeting Expectations';
  if (score >= 40) return 'Approaching Expectations';
  return 'Below Expectations';
}

export function ProgressiveReportsPanel({
  workspace,
  currentRole = 'Teacher',
  currentUserId,
  currentUserEmail,
  readOnly = false,
  onRefresh,
  onNotify,
}: ProgressiveReportsPanelProps) {
  const { tenant, students, examCycles, examResults, timetable } = workspace;
  const progressiveReports = workspace.progressiveReports || [];

  const isParentOrStudent = currentRole === 'Parent' || currentRole === 'Student';
  const isAdminRole =
    !readOnly &&
    (currentRole === 'Developer' || currentRole === 'Super Admin' || currentRole === 'Admin');
  const isTeacherRole = !readOnly && currentRole === 'Teacher';
  const canWrite = !readOnly && !isParentOrStudent && (isAdminRole || isTeacherRole);

  const ownTeacherProfile = useMemo(() => {
    if (!isTeacherRole) return undefined;
    const normEmail = (currentUserEmail || '').trim().toLowerCase();
    if (normEmail) {
      const byEmail = tenant.teachers.find(
        (t) => (t.email || '').trim().toLowerCase() === normEmail
      );
      if (byEmail) return byEmail;
    }
    return undefined;
  }, [tenant.teachers, isTeacherRole, currentUserEmail]);

  const activeStudents = useMemo(
    () => students.filter((s) => !s.deleted && s.status === 'Active'),
    [students]
  );

  const defaultGrade = useMemo(() => {
    if (activeStudents.length > 0 && isParentOrStudent) {
      return activeStudents[0].grade;
    }
    return tenant.grades.includes('Grade 9')
      ? 'Grade 9'
      : tenant.grades[0] || activeStudents[0]?.grade || 'Grade 7';
  }, [tenant.grades, activeStudents, isParentOrStudent]);

  const [mode, setMode] = useState<PanelMode>('viewer');
  const [selectedGrade, setSelectedGrade] = useState<string>(defaultGrade);
  const [selectedStream, setSelectedStream] = useState<string>('All');
  const [selectedStudentId, setSelectedStudentId] = useState<string>(
    activeStudents[0]?.id || ''
  );
  const [expandedCheckpointId, setExpandedCheckpointId] = useState<string | null>(null);

  // Manual Entry State
  const [manualEditingId, setManualEditingId] = useState<string | undefined>(undefined);
  const [manualAcademicYear, setManualAcademicYear] = useState<string>(
    tenant.academicYear || '2026–2027'
  );
  const [manualTerm, setManualTerm] = useState<string>(tenant.currentTerm || 'Term 1');
  const [manualLabel, setManualLabel] = useState<string>('CAT 1');
  const [manualDate, setManualDate] = useState<string>('2026-11-18');
  const [manualRemarks, setManualRemarks] = useState<string>('');
  const [subjectDrafts, setSubjectDrafts] = useState<SubjectDraftRow[]>([]);
  const [savingManual, setSavingManual] = useState(false);

  // Import State
  const [importAcademicYear, setImportAcademicYear] = useState<string>(
    tenant.academicYear || '2026–2027'
  );
  const [importTerm, setImportTerm] = useState<string>(tenant.currentTerm || 'Term 1');
  const [importLabel, setImportLabel] = useState<string>('CAT 1');
  const [importDate, setImportDate] = useState<string>('2026-11-18');
  const [importFileName, setImportFileName] = useState<string>('');
  const [parsedImportRows, setParsedImportRows] = useState<ParsedImportRow[]>([]);
  const [blockedImportColumns, setBlockedImportColumns] = useState<string[]>([]);
  const [importingRows, setImportingRows] = useState(false);
  const [lastImportSummary, setLastImportSummary] = useState<{
    savedCount: number;
    skippedRows: number;
    errors: Array<{ rowIndex: number; identifier: string; reason: string }>;
  } | null>(null);

  const availableStreams = useMemo(
    () => getStreamsForGrade(tenant, selectedGrade),
    [tenant, selectedGrade]
  );

  const effectiveStream =
    selectedStream === 'All' || availableStreams.includes(selectedStream)
      ? selectedStream
      : 'All';

  const cohortStudents = useMemo(() => {
    if (isParentOrStudent) return activeStudents;
    return activeStudents
      .filter((s) => {
        if (s.grade !== selectedGrade) return false;
        if (effectiveStream !== 'All' && s.section !== effectiveStream) return false;
        return true;
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [activeStudents, isParentOrStudent, selectedGrade, effectiveStream]);

  const activeStudent = useMemo(() => {
    const inCohort = cohortStudents.find((s) => s.id === selectedStudentId);
    return inCohort || cohortStudents[0] || null;
  }, [cohortStudents, selectedStudentId]);

  useEffect(() => {
    if (activeStudent && activeStudent.id !== selectedStudentId) {
      setSelectedStudentId(activeStudent.id);
    }
  }, [activeStudent, selectedStudentId]);

  // Determine editable subjects for Manual / Import based on role & cohort
  const resolveAllowedSubjectsForStudent = (
    grade: string,
    section: string,
    registered?: string[]
  ): string[] => {
    const levelSubs = getSubjectsForGrade(tenant, grade);
    const learnerSubs =
      Array.isArray(registered) && registered.length > 0 ? registered : levelSubs;
    if (!isTeacherRole || !ownTeacherProfile) {
      return learnerSubs;
    }
    const assigned = getTeacherAssignedSubjectsForCohort(
      tenant,
      ownTeacherProfile,
      grade,
      section,
      timetable
    );
    if (assigned.length === 0) return [];
    const assignedLower = new Set(assigned.map((s) => s.trim().toLowerCase()));
    return learnerSubs.filter((s) => assignedLower.has(s.trim().toLowerCase()));
  };

  // Hydrate manual entry subject rows when activeStudent or manual checkpoint selection changes
  useEffect(() => {
    if (!activeStudent) {
      setSubjectDrafts([]);
      return;
    }
    const studentSubs = resolveAllowedSubjectsForStudent(
      activeStudent.grade,
      activeStudent.section,
      getStudentRegisteredSubjects(tenant, activeStudent)
    );

    const matchingExisting = manualEditingId
      ? progressiveReports.find((p) => p.id === manualEditingId)
      : progressiveReports.find(
          (p) =>
            p.studentId === activeStudent.id &&
            p.academicYear.toLowerCase() === manualAcademicYear.trim().toLowerCase() &&
            p.term.toLowerCase() === manualTerm.trim().toLowerCase() &&
            p.assessmentLabel.toLowerCase() === manualLabel.trim().toLowerCase()
        );

    const existingMap = new Map<string, ProgressiveReportSubjectScore>();
    matchingExisting?.subjects.forEach((s) => existingMap.set(s.subject.toLowerCase(), s));

    if (matchingExisting && !manualEditingId) {
      setManualRemarks(matchingExisting.classTeacherRemarks || '');
    } else if (!matchingExisting && !manualEditingId) {
      setManualRemarks('');
    }

    setSubjectDrafts(
      studentSubs.map((sub) => {
        const hit = existingMap.get(sub.toLowerCase());
        return {
          subject: sub,
          resultStatus: hit?.resultStatus || 'Scored',
          score: hit?.score !== null && hit?.score !== undefined ? String(hit.score) : '',
          masteryLevel: hit?.masteryLevel || '',
          remarks: hit?.remarks || '',
        };
      })
    );
  }, [
    activeStudent?.id,
    activeStudent?.grade,
    activeStudent?.section,
    manualAcademicYear,
    manualTerm,
    manualLabel,
    manualEditingId,
    progressiveReports,
  ]);

  // Unified chronological checkpoints for the selected learner (Exam Cycles + Progressive Reports)
  const unifiedCheckpoints = useMemo((): UnifiedCheckpoint[] => {
    if (!activeStudent) return [];

    const orderedCycles = sortExamCyclesChronologically(examCycles);
    const items: Array<Omit<UnifiedCheckpoint, 'deltaFromPrev'> & { sortKey: string }> = [];

    for (const cycle of orderedCycles) {
      if (isParentOrStudent && cycle.status !== 'Published') continue;
      const results = examResults.filter(
        (r) => r.examCycleId === cycle.id && r.studentId === activeStudent.id
      );
      if (results.length === 0) continue;
      const scored = results.filter((r) => !isNonSatExamResult(r));
      const totalScore = scored.reduce((sum, r) => sum + r.score, 0);
      const maxPossible = scored.reduce((sum, r) => sum + (r.maxScore || 100), 0);
      const meanScore =
        maxPossible > 0 ? Math.round((totalScore / maxPossible) * 1000) / 10 : 0;
      const gradeInfo = computeClientGrade(meanScore, activeStudent.grade);

      items.push({
        id: `cycle-${cycle.id}`,
        kind: 'exam-cycle',
        title: cycle.title,
        shortLabel: shortenCycleTitle(cycle.title),
        academicYear: tenant.academicYear || '2026–2027',
        term: cycle.term,
        date: cycle.startDate || cycle.createdAt.slice(0, 10),
        sortKey: `${cycle.startDate || cycle.createdAt.slice(0, 10)}-1-${cycle.title}`,
        totalScore,
        maxPossible,
        meanScore,
        meanGrade: scored.length > 0 ? gradeInfo.letterGrade : '—',
        subjects: results.map((r) => ({
          subject: r.subject,
          score: isNonSatExamResult(r) ? null : r.score,
          maxScore: r.maxScore || 100,
          resultStatus: r.resultStatus || 'Scored',
          letterGrade: r.letterGrade,
          remarks: r.remarks,
        })),
      });
    }

    const learnerProg = progressiveReports.filter((p) => p.studentId === activeStudent.id);
    for (const entry of learnerProg) {
      items.push({
        id: entry.id,
        kind: entry.source === 'import' ? 'import' : 'manual',
        title: entry.assessmentLabel,
        shortLabel:
          entry.assessmentLabel.length > 14
            ? `${entry.assessmentLabel.slice(0, 12)}…`
            : entry.assessmentLabel,
        academicYear: entry.academicYear,
        term: entry.term,
        date: entry.assessmentDate,
        sortKey: `${entry.assessmentDate}-2-${entry.sequenceOrder ?? 99}-${entry.assessmentLabel}`,
        totalScore: entry.totalScore,
        maxPossible: entry.maxPossible,
        meanScore: entry.meanScore,
        meanGrade: entry.meanGrade,
        subjects: entry.subjects.map((s) => ({
          subject: s.subject,
          score: s.score,
          maxScore: s.maxScore || 100,
          resultStatus: s.resultStatus || 'Scored',
          letterGrade: s.letterGrade || '—',
          masteryLevel: s.masteryLevel,
          remarks: s.remarks,
        })),
        classTeacherRemarks: entry.classTeacherRemarks,
        recordedByName: entry.recordedByName,
        progressiveEntry: entry,
      });
    }

    items.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    return items.map((pt, idx) => ({
      ...pt,
      deltaFromPrev:
        idx > 0 ? Math.round((pt.meanScore - items[idx - 1].meanScore) * 10) / 10 : null,
    }));
  }, [activeStudent, examCycles, examResults, progressiveReports, isParentOrStudent, tenant.academicYear]);

  const latestCheckpoint = unifiedCheckpoints[unifiedCheckpoints.length - 1] || null;
  const firstCheckpoint = unifiedCheckpoints[0] || null;
  const netGain =
    unifiedCheckpoints.length >= 2 && latestCheckpoint && firstCheckpoint
      ? Math.round((latestCheckpoint.meanScore - firstCheckpoint.meanScore) * 10) / 10
      : null;

  async function handleSaveManualReport(e: React.FormEvent) {
    e.preventDefault();
    if (!activeStudent) {
      onNotify('Select a learner before saving a progressive report.', 'error');
      return;
    }
    if (!manualLabel.trim()) {
      onNotify('Enter an assessment label (e.g. CAT 1, Opener CAT).', 'error');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(manualDate.trim())) {
      onNotify('Assessment date must use YYYY-MM-DD format.', 'error');
      return;
    }

    const preparedSubjects: Array<{
      subject: string;
      score?: number | null;
      resultStatus?: ExamResultStatus;
      masteryLevel?: CbcLearnerMasteryLevel;
      remarks?: string;
    }> = [];

    for (const row of subjectDrafts) {
      if (row.resultStatus === 'Absent' || row.resultStatus === 'Exempt') {
        preparedSubjects.push({
          subject: row.subject,
          score: null,
          resultStatus: row.resultStatus,
          masteryLevel: row.masteryLevel || undefined,
          remarks: row.remarks.trim() || undefined,
        });
        continue;
      }
      const raw = row.score.trim();
      if (!raw) continue;
      const numeric = Number(raw);
      if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
        onNotify(`Score for ${row.subject} must be between 0 and 100.`, 'error');
        return;
      }
      preparedSubjects.push({
        subject: row.subject,
        score: Math.round(numeric),
        resultStatus: 'Scored',
        masteryLevel: row.masteryLevel || autoMasteryFromScore(Math.round(numeric)),
        remarks: row.remarks.trim() || undefined,
      });
    }

    if (preparedSubjects.length === 0) {
      onNotify('Enter at least one subject score (or mark ABS/EXM) before saving.', 'error');
      return;
    }

    setSavingManual(true);
    try {
      await saasApi.saveProgressiveReport(tenant.id, {
        id: manualEditingId,
        studentId: activeStudent.id,
        academicYear: manualAcademicYear.trim(),
        term: manualTerm.trim(),
        assessmentLabel: manualLabel.trim(),
        assessmentDate: manualDate.trim(),
        subjects: preparedSubjects,
        classTeacherRemarks: manualRemarks.trim() || undefined,
        source: 'manual',
      });
      setManualEditingId(undefined);
      onNotify(
        `Saved progressive report "${manualLabel.trim()}" for ${activeStudent.fullName}.`,
        'success'
      );
      await onRefresh();
      setMode('viewer');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Could not save progressive report.',
        'error'
      );
    } finally {
      setSavingManual(false);
    }
  }

  function handleDownloadImportTemplate() {
    if (cohortStudents.length === 0) {
      onNotify('No active learners in the selected cohort to export a template.', 'error');
      return;
    }
    const gradeSubs = getSubjectsForGrade(tenant, selectedGrade);
    const scopedSubjects =
      isTeacherRole && ownTeacherProfile
        ? getTeacherAssignedSubjectsForCohort(
            tenant,
            ownTeacherProfile,
            selectedGrade,
            effectiveStream === 'All' ? availableStreams[0] || 'A' : effectiveStream,
            timetable
          )
        : gradeSubs;

    const templateSubjects = scopedSubjects.length > 0 ? scopedSubjects : gradeSubs;
    const rows = cohortStudents.map((stu) => {
      const existing = progressiveReports.find(
        (p) =>
          p.studentId === stu.id &&
          p.academicYear.toLowerCase() === importAcademicYear.trim().toLowerCase() &&
          p.term.toLowerCase() === importTerm.trim().toLowerCase() &&
          p.assessmentLabel.toLowerCase() === importLabel.trim().toLowerCase()
      );
      const record: Record<string, string | number> = {
        'Adm No': stu.studentCode,
        'Student Name': stu.fullName,
      };
      for (const sub of templateSubjects) {
        const hit = existing?.subjects.find((s) => s.subject.toLowerCase() === sub.toLowerCase());
        record[sub] =
          hit?.resultStatus === 'Absent'
            ? 'ABS'
            : hit?.resultStatus === 'Exempt'
            ? 'EXM'
            : hit?.score !== null && hit?.score !== undefined
            ? hit.score
            : '';
      }
      record['Class Teacher Remarks'] = existing?.classTeacherRemarks || '';
      return record;
    });

    const worksheet = createBrandedWorksheetFromObjects(
      tenant,
      `${importLabel || 'Progressive Report'} Template (${selectedGrade}${effectiveStream !== 'All' ? ` Stream ${effectiveStream}` : ''})`,
      rows
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, worksheet, `${selectedGrade} ${effectiveStream}`.slice(0, 31));
    const safeName = `${importLabel || 'progressive'}-${selectedGrade}-${effectiveStream}`
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .toLowerCase();
    XLSX.writeFile(wb, `${tenant.slug}-${safeName}-template.xlsx`);
    onNotify(
      `Downloaded progressive report template for ${cohortStudents.length} learner(s) across ${templateSubjects.length} subject(s).`
    );
  }

  async function handleImportFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setLastImportSummary(null);
    setBlockedImportColumns([]);

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const firstSheet = wb.SheetNames[0];
      if (!firstSheet) {
        onNotify('The uploaded workbook has no sheets.', 'error');
        return;
      }
      const rows = parseExcelSheetRowsSmart(wb.Sheets[firstSheet], [
        'adm',
        'student',
        'name',
        'math',
        'english',
        'remarks',
      ]);
      if (rows.length === 0) {
        onNotify('No tabular learner rows were detected in the uploaded file.', 'error');
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
        /^(class\s*teacher\s*remarks?|remarks?|comment|comments)$/i.test(normalizeHeader(h))
      );

      const allSchoolSubjects = Array.from(
        new Set([...getSubjectsForGrade(tenant, selectedGrade), ...tenant.subjects])
      );
      const schoolSubjectByNorm = new Map<string, string>();
      allSchoolSubjects.forEach((s) => schoolSubjectByNorm.set(normalizeHeader(s), s));

      const teacherAssignedLower =
        isTeacherRole && ownTeacherProfile
          ? new Set(
              getTeacherAssignedSubjectsForCohort(
                tenant,
                ownTeacherProfile,
                selectedGrade,
                effectiveStream === 'All' ? availableStreams[0] || 'A' : effectiveStream,
                timetable
              ).map((s) => normalizeHeader(s))
            )
          : null;

      const knownNonSubject = new Set(
        [idHeader, nameHeader, remarksHeader].filter(Boolean) as string[]
      );

      const subjectCols: Array<{ header: string; subject: string }> = [];
      const blockedCols: string[] = [];

      for (const h of headers) {
        if (knownNonSubject.has(h)) continue;
        const norm = normalizeHeader(h);
        if (!norm || norm.startsWith('empty')) continue;
        const canonical = schoolSubjectByNorm.get(norm) || h.trim();
        if (teacherAssignedLower && !teacherAssignedLower.has(normalizeHeader(canonical))) {
          blockedCols.push(canonical);
          continue;
        }
        subjectCols.push({ header: h, subject: canonical });
      }

      if (subjectCols.length === 0) {
        onNotify(
          blockedCols.length > 0
            ? `Uploaded columns (${blockedCols.join(', ')}) are outside your assigned subjects.`
            : 'No subject score columns matched in the uploaded file.',
          'error'
        );
        return;
      }

      const byCode = new Map(
        activeStudents.map((s) => [s.studentCode.trim().toLowerCase(), s])
      );
      const byName = new Map(
        activeStudents.map((s) => [s.fullName.trim().toLowerCase(), s])
      );

      const parsed: ParsedImportRow[] = [];
      rows.forEach((rawRow, idx) => {
        const rawCode = idHeader ? String(rawRow[idHeader] ?? '').trim() : '';
        const rawName = nameHeader ? String(rawRow[nameHeader] ?? '').trim() : '';
        if (!rawCode && !rawName) return;

        const matched =
          (rawCode && byCode.get(rawCode.toLowerCase())) ||
          (rawName && byName.get(rawName.toLowerCase())) ||
          undefined;

        const subjects: ParsedImportRow['subjects'] = [];
        let badScoreMsg = '';

        for (const col of subjectCols) {
          const rawVal = String(rawRow[col.header] ?? '').trim();
          if (!rawVal) continue;
          const upper = rawVal.toUpperCase();
          if (upper === 'ABS' || upper === 'ABSENT') {
            subjects.push({ subject: col.subject, score: null, resultStatus: 'Absent' });
          } else if (upper === 'EXM' || upper === 'EXEMPT') {
            subjects.push({ subject: col.subject, score: null, resultStatus: 'Exempt' });
          } else {
            const n = Number(rawVal);
            if (!Number.isFinite(n) || n < 0 || n > 100) {
              badScoreMsg = `${col.subject}: invalid "${rawVal}" (0–100, ABS, or EXM)`;
            } else {
              subjects.push({
                subject: col.subject,
                score: Math.round(n),
                resultStatus: 'Scored',
              });
            }
          }
        }

        const warning = !matched
          ? `Learner not found ("${rawCode || rawName}")`
          : badScoreMsg
          ? badScoreMsg
          : subjects.length === 0
          ? 'No scores filled on this row'
          : undefined;

        parsed.push({
          rowIndex: idx + 1,
          studentCode: rawCode || undefined,
          studentName: rawName || undefined,
          matchedStudentId: matched?.id,
          matchedStudentLabel: matched ? `${matched.fullName} (${matched.grade} ${matched.section})` : undefined,
          subjects,
          classTeacherRemarks: remarksHeader
            ? String(rawRow[remarksHeader] ?? '').trim() || undefined
            : undefined,
          warning,
        });
      });

      setImportFileName(file.name);
      setBlockedImportColumns(blockedCols);
      setParsedImportRows(parsed);
      onNotify(
        `Parsed ${parsed.length} row(s) from ${file.name}. Review below and click Import Rows.`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to parse spreadsheet.', 'error');
    }
  }

  async function handleCommitImport() {
    const readyRows = parsedImportRows.filter(
      (r) => r.matchedStudentId && r.subjects.length > 0
    );
    if (readyRows.length === 0) {
      onNotify('No valid matched learner rows with scores to import.', 'error');
      return;
    }
    if (!importLabel.trim()) {
      onNotify('Provide an Assessment Label before importing.', 'error');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(importDate.trim())) {
      onNotify('Assessment Date must use YYYY-MM-DD format.', 'error');
      return;
    }

    setImportingRows(true);
    try {
      const res = await saasApi.importProgressiveReports(tenant.id, {
        academicYear: importAcademicYear.trim(),
        term: importTerm.trim(),
        assessmentLabel: importLabel.trim(),
        assessmentDate: importDate.trim(),
        rows: readyRows.map((r) => ({
          studentId: r.matchedStudentId,
          studentCode: r.studentCode,
          studentName: r.studentName,
          subjects: r.subjects,
          classTeacherRemarks: r.classTeacherRemarks,
        })),
      });
      setLastImportSummary({
        savedCount: res.savedCount,
        skippedRows: res.skippedRows,
        errors: res.errors,
      });
      onNotify(
        `Imported progressive reports for ${res.savedCount} learner(s)${
          res.skippedRows > 0 ? ` (${res.skippedRows} skipped)` : ''
        }.`,
        'success'
      );
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Progressive report import failed.', 'error');
    } finally {
      setImportingRows(false);
    }
  }

  async function handleDeleteProgressiveEntry(entry: LearnerProgressiveEntry) {
    try {
      await saasApi.deleteProgressiveReport(tenant.id, entry.id);
      onNotify(`Removed progressive checkpoint "${entry.assessmentLabel}".`);
      await onRefresh();
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Could not delete progressive checkpoint.',
        'error'
      );
    }
  }

  function handleEditProgressiveEntry(entry: LearnerProgressiveEntry) {
    setSelectedGrade(entry.grade);
    setSelectedStream(entry.section);
    setSelectedStudentId(entry.studentId);
    setManualEditingId(entry.id);
    setManualAcademicYear(entry.academicYear);
    setManualTerm(entry.term);
    setManualLabel(entry.assessmentLabel);
    setManualDate(entry.assessmentDate);
    setManualRemarks(entry.classTeacherRemarks || '');
    setMode('manual');
  }

  return (
    <div className="space-y-5">
      {/* Top Toolbar */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between no-print dark:border-slate-800 dark:bg-slate-900">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-100">
            <TrendingUp className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            Learners Progressive Report
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Longitudinal academic tracking combining formal exam cycles, manual CAT/checkpoint entries, and spreadsheet imports.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canWrite && (
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-950">
              <button
                type="button"
                onClick={() => setMode('viewer')}
                className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  mode === 'viewer'
                    ? 'bg-slate-900 text-white dark:bg-blue-600'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                Report Card &amp; History
              </button>
              <button
                type="button"
                onClick={() => {
                  setManualEditingId(undefined);
                  setMode('manual');
                }}
                className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  mode === 'manual'
                    ? 'bg-slate-900 text-white dark:bg-blue-600'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <Plus className="h-3.5 w-3.5" />
                Manual Entry
              </button>
              <button
                type="button"
                onClick={() => setMode('import')}
                className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  mode === 'import'
                    ? 'bg-slate-900 text-white dark:bg-blue-600'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Spreadsheet Import
              </button>
            </div>
          )}

          {mode === 'viewer' && activeStudent && (
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Printer className="h-3.5 w-3.5" />
              Print Progressive Report
            </button>
          )}
        </div>
      </div>

      {/* Shared Cohort & Learner Filter Bar */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 no-print dark:border-slate-800 dark:bg-slate-900">
        {!isParentOrStudent && (
          <>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Grade
              </label>
              <select
                aria-label="Progressive report grade"
                value={selectedGrade}
                onChange={(e) => {
                  setSelectedGrade(e.target.value);
                  setSelectedStream('All');
                  setManualEditingId(undefined);
                }}
                className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                {tenant.grades.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Stream
              </label>
              <select
                aria-label="Progressive report stream"
                value={effectiveStream}
                onChange={(e) => {
                  setSelectedStream(e.target.value);
                  setManualEditingId(undefined);
                }}
                className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="All">All Streams</option>
                {availableStreams.map((sec) => (
                  <option key={sec} value={sec}>
                    Stream {sec}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {mode !== 'import' && (
          <div className="min-w-[240px] flex-1">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Learner
            </label>
            <select
              aria-label="Progressive report learner"
              value={activeStudent?.id || ''}
              onChange={(e) => {
                setSelectedStudentId(e.target.value);
                setManualEditingId(undefined);
              }}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              {cohortStudents.length === 0 ? (
                <option value="">No active learners in cohort</option>
              ) : (
                cohortStudents.map((stu) => (
                  <option key={stu.id} value={stu.id}>
                    {stu.fullName} ({stu.studentCode} · {stu.grade} {stu.section})
                  </option>
                ))
              )}
            </select>
          </div>
        )}

        {mode === 'import' && (
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Cohort target:{' '}
            <strong className="font-semibold text-slate-900 dark:text-slate-100">
              {selectedGrade} {effectiveStream === 'All' ? '(All Streams)' : `Stream ${effectiveStream}`}
            </strong>{' '}
            · <span className="font-mono tabular-nums">{cohortStudents.length}</span> active learner(s)
          </p>
        )}
      </div>

      {/* MODE 1: VIEWER & LONGITUDINAL REPORT CARD */}
      {mode === 'viewer' && (
        <div className="space-y-5">
          {!activeStudent ? (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
              Select a grade, stream, and learner to view their progressive academic trajectory.
            </div>
          ) : (
            <>
              {/* Printable Institutional Header */}
              <div className="hidden print:block rounded-xl border border-slate-200 bg-white p-6">
                <TenantDocumentHeader
                  tenant={tenant}
                  documentTitle="Learner Progressive Academic Report"
                  subtitle={`${activeStudent.fullName} (${activeStudent.studentCode}) · ${activeStudent.grade} Stream ${activeStudent.section}`}
                  rightMeta={[
                    { label: 'Year', value: tenant.academicYear },
                    { label: 'Term', value: tenant.currentTerm },
                    { label: 'Checkpoints', value: String(unifiedCheckpoints.length) },
                  ]}
                  compact
                />
              </div>

              {/* 4 KPI Cards */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Assessments Tracked
                  </span>
                  <p className="mt-1.5 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
                    {unifiedCheckpoints.length}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    {unifiedCheckpoints.filter((c) => c.kind === 'exam-cycle').length} exam cycle(s) ·{' '}
                    {unifiedCheckpoints.filter((c) => c.kind !== 'exam-cycle').length} progressive check(s)
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Latest Mean Score
                  </span>
                  <p className="mt-1.5 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
                    {latestCheckpoint ? `${latestCheckpoint.meanScore}%` : '—'}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    {latestCheckpoint
                      ? `${latestCheckpoint.title} (${latestCheckpoint.meanGrade})`
                      : 'No checkpoints recorded'}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Net Progression vs Baseline
                  </span>
                  <p
                    className={`mt-1.5 font-mono text-2xl font-bold tabular-nums ${
                      netGain === null
                        ? 'text-slate-900 dark:text-slate-100'
                        : netGain >= 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {netGain === null ? '—' : `${netGain > 0 ? '+' : ''}${netGain}%`}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    {firstCheckpoint && latestCheckpoint && firstCheckpoint.id !== latestCheckpoint.id
                      ? `From ${firstCheckpoint.meanScore}% (${firstCheckpoint.shortLabel})`
                      : 'Need 2+ checkpoints for trend'}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Learner Cohort
                  </span>
                  <p className="mt-1.5 text-sm font-bold text-slate-900 dark:text-slate-100">
                    {activeStudent.fullName}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                    {activeStudent.studentCode} · {activeStudent.grade} {activeStudent.section}
                  </p>
                </div>
              </div>

              {/* Progression Line Chart */}
              {unifiedCheckpoints.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        Unified Longitudinal Mean Score Trajectory (%)
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Combines published Exam Cycles with manual &amp; spreadsheet-imported progressive assessments
                      </p>
                    </div>
                    <span className="font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
                      {unifiedCheckpoints.length} checkpoint(s)
                    </span>
                  </div>

                  <div className="mt-4">
                    {(() => {
                      const pts = unifiedCheckpoints;
                      const w = 720;
                      const h = 190;
                      const padL = 38;
                      const padR = 32;
                      const padT = 24;
                      const padB = 42;
                      const plotW = w - padL - padR;
                      const plotH = h - padT - padB;
                      const coords = pts.map((pt, idx) => {
                        const x =
                          pts.length === 1
                            ? padL + plotW / 2
                            : padL + (idx / (pts.length - 1)) * plotW;
                        const y =
                          padT + ((100 - Math.max(0, Math.min(100, pt.meanScore))) / 100) * plotH;
                        return { ...pt, x, y };
                      });
                      const linePoints = coords
                        .map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`)
                        .join(' ');
                      const areaPoints =
                        coords.length > 1
                          ? `${coords[0].x.toFixed(1)},${(padT + plotH).toFixed(1)} ${linePoints} ${coords[
                              coords.length - 1
                            ].x.toFixed(1)},${(padT + plotH).toFixed(1)}`
                          : '';

                      return (
                        <svg
                          viewBox={`0 0 ${w} ${h}`}
                          className="h-48 w-full overflow-visible"
                          role="img"
                          aria-label="Learner progressive report mean trajectory graph"
                        >
                          {[0, 25, 50, 75, 100].map((tick) => {
                            const ty = padT + ((100 - tick) / 100) * plotH;
                            return (
                              <g key={tick}>
                                <line
                                  x1={padL}
                                  y1={ty}
                                  x2={w - padR}
                                  y2={ty}
                                  stroke="#cbd5e1"
                                  strokeWidth="0.75"
                                  strokeDasharray={tick === 0 ? undefined : '3 3'}
                                />
                                <text
                                  x={padL - 6}
                                  y={ty + 3}
                                  textAnchor="end"
                                  fill="#64748b"
                                  fontSize="10"
                                  fontFamily="var(--font-mono), monospace"
                                >
                                  {tick}
                                </text>
                              </g>
                            );
                          })}
                          {areaPoints && (
                            <polygon points={areaPoints} fill="rgba(37, 99, 235, 0.08)" />
                          )}
                          {coords.length > 1 && (
                            <polyline
                              fill="none"
                              stroke="#2563EB"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              points={linePoints}
                            />
                          )}
                          {coords.map((c, idx) => (
                            <g key={c.id}>
                              <circle
                                cx={c.x}
                                cy={c.y}
                                r={idx === coords.length - 1 ? 5.5 : 4.2}
                                fill={
                                  c.kind === 'exam-cycle'
                                    ? '#2563EB'
                                    : c.kind === 'import'
                                    ? '#0D9488'
                                    : '#475569'
                                }
                                stroke="#ffffff"
                                strokeWidth="1.5"
                              />
                              <text
                                x={c.x}
                                y={Math.max(12, c.y - 10)}
                                textAnchor="middle"
                                fill="#0f172a"
                                className="dark:fill-slate-100"
                                fontSize="10.5"
                                fontWeight="700"
                                fontFamily="var(--font-mono), monospace"
                              >
                                {c.meanScore}%
                              </text>
                              <text
                                x={c.x}
                                y={h - 20}
                                textAnchor="middle"
                                fill="#475569"
                                className="dark:fill-slate-300"
                                fontSize="9.5"
                                fontWeight="600"
                              >
                                {c.shortLabel}
                              </text>
                              <text
                                x={c.x}
                                y={h - 7}
                                textAnchor="middle"
                                fill="#2563EB"
                                fontSize="9"
                                fontWeight="700"
                                fontFamily="var(--font-mono), monospace"
                              >
                                {c.meanGrade}
                              </text>
                            </g>
                          ))}
                        </svg>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* Chronological Assessment Checkpoints Table */}
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Assessment Checkpoint Breakdown
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Click any assessment row to inspect subject scores, CBC mastery levels, and teacher remarks.
                    </p>
                  </div>
                  {canWrite && (
                    <button
                      type="button"
                      onClick={() => {
                        setManualEditingId(undefined);
                        setMode('manual');
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0 no-print dark:bg-blue-600 dark:hover:bg-blue-500"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Progressive Check
                    </button>
                  )}
                </div>

                {unifiedCheckpoints.length === 0 ? (
                  <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">
                    No progressive assessments or exam results recorded for {activeStudent.fullName} yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                        <tr>
                          <th className="px-4 py-3">Assessment</th>
                          <th className="px-4 py-3">Year · Term</th>
                          <th className="px-4 py-3">Date</th>
                          <th className="px-4 py-3">Source</th>
                          <th className="px-4 py-3 text-right">Subjects</th>
                          <th className="px-4 py-3 text-right">Total</th>
                          <th className="px-4 py-3 text-right">Mean %</th>
                          <th className="px-4 py-3 text-right">Delta</th>
                          <th className="px-4 py-3 text-right">Grade</th>
                          <th className="px-4 py-3 text-right no-print">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {unifiedCheckpoints.map((cp) => {
                          const isExpanded = expandedCheckpointId === cp.id;
                          const canModifyProg =
                            canWrite &&
                            Boolean(cp.progressiveEntry) &&
                            (isAdminRole || cp.progressiveEntry?.recordedByUserId === currentUserId);
                          return (
                            <>
                              <tr
                                key={cp.id}
                                onClick={() =>
                                  setExpandedCheckpointId(isExpanded ? null : cp.id)
                                }
                                className="cursor-pointer hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                              >
                                <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
                                  {cp.title}
                                  {cp.classTeacherRemarks && (
                                    <p className="mt-0.5 text-[11px] font-normal text-slate-500 dark:text-slate-400">
                                      {cp.classTeacherRemarks}
                                    </p>
                                  )}
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-slate-600 dark:text-slate-400">
                                  {cp.academicYear} · {cp.term}
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap font-mono tabular-nums text-slate-600 dark:text-slate-400">
                                  {formatDateShort(cp.date)}
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-slate-600 dark:text-slate-400">
                                  {cp.kind === 'exam-cycle'
                                    ? 'Exam Cycle'
                                    : cp.kind === 'import'
                                    ? 'Spreadsheet Import'
                                    : 'Manual Entry'}
                                </td>
                                <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                                  {cp.subjects.length}
                                </td>
                                <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                                  {cp.totalScore}/{cp.maxPossible}
                                </td>
                                <td className="px-4 py-3 text-right font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                                  {cp.meanScore}%
                                </td>
                                <td className="px-4 py-3 text-right font-mono tabular-nums">
                                  {cp.deltaFromPrev === null ? (
                                    <span className="text-slate-400">—</span>
                                  ) : (
                                    <span
                                      className={
                                        cp.deltaFromPrev > 0
                                          ? 'font-semibold text-emerald-700 dark:text-emerald-400'
                                          : cp.deltaFromPrev < 0
                                          ? 'font-semibold text-rose-600 dark:text-rose-400'
                                          : 'text-slate-500'
                                      }
                                    >
                                      {cp.deltaFromPrev > 0
                                        ? `+${cp.deltaFromPrev}%`
                                        : `${cp.deltaFromPrev}%`}
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-right font-mono font-bold text-blue-700 dark:text-blue-400">
                                  {cp.meanGrade}
                                </td>
                                <td
                                  className="px-4 py-3 text-right whitespace-nowrap no-print"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <div className="inline-flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setExpandedCheckpointId(isExpanded ? null : cp.id)
                                      }
                                      className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                                    >
                                      {isExpanded ? 'Hide' : 'Subjects'}
                                    </button>
                                    {canWrite && cp.progressiveEntry && (
                                      <button
                                        type="button"
                                        title="Edit progressive entry"
                                        onClick={() =>
                                          handleEditProgressiveEntry(cp.progressiveEntry!)
                                        }
                                        className="rounded-md border border-slate-200 p-1 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                                      >
                                        <Edit3 className="h-3 w-3" />
                                      </button>
                                    )}
                                    {canModifyProg && cp.progressiveEntry && (
                                      <button
                                        type="button"
                                        title="Delete progressive entry"
                                        onClick={() =>
                                          handleDeleteProgressiveEntry(cp.progressiveEntry!)
                                        }
                                        className="rounded-md border border-slate-200 p-1 text-slate-500 hover:border-red-200 hover:text-red-600 dark:border-slate-700 dark:text-slate-400"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr key={`${cp.id}-details`} className="bg-slate-50/60 dark:bg-slate-950/40">
                                  <td colSpan={10} className="px-6 py-4">
                                    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                                      <table className="w-full text-left text-xs">
                                        <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                                          <tr>
                                            <th className="px-3 py-2">Subject</th>
                                            <th className="px-3 py-2 text-right">Score</th>
                                            <th className="px-3 py-2 text-right">Grade</th>
                                            <th className="px-3 py-2">Mastery Level</th>
                                            <th className="px-3 py-2">Remarks</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                          {cp.subjects.map((sub) => (
                                            <tr key={sub.subject}>
                                              <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">
                                                {sub.subject}
                                              </td>
                                              <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                                                {sub.resultStatus === 'Absent'
                                                  ? 'ABS'
                                                  : sub.resultStatus === 'Exempt'
                                                  ? 'EXM'
                                                  : sub.score !== null
                                                  ? `${sub.score} / ${sub.maxScore}`
                                                  : '—'}
                                              </td>
                                              <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900 dark:text-slate-100">
                                                {sub.letterGrade}
                                              </td>
                                              <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                                                {sub.masteryLevel || '—'}
                                              </td>
                                              <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                                                {sub.remarks || '—'}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                    {cp.recordedByName && (
                                      <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                                        Recorded by: {cp.recordedByName}
                                      </p>
                                    )}
                                  </td>
                                </tr>
                              )}
                            </>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* MODE 2: MANUAL ENTRY */}
      {mode === 'manual' && canWrite && (
        <form
          onSubmit={handleSaveManualReport}
          className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3 dark:border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {manualEditingId ? 'Update Progressive Report Entry' : 'Manual Progressive Report Entry'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Record CATs, term openers, or continuous assessments. If a matching checkpoint exists for the learner, submitted subjects merge cleanly.
              </p>
            </div>
            {activeStudent && (
              <span className="font-mono text-xs text-slate-600 dark:text-slate-400">
                {activeStudent.fullName} · {activeStudent.studentCode}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-600 dark:text-slate-300">
                Academic Year
              </label>
              <input
                type="text"
                required
                value={manualAcademicYear}
                onChange={(e) => setManualAcademicYear(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-600 dark:text-slate-300">
                Term
              </label>
              <input
                type="text"
                required
                value={manualTerm}
                onChange={(e) => setManualTerm(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-600 dark:text-slate-300">
                Assessment Label
              </label>
              <input
                type="text"
                required
                value={manualLabel}
                onChange={(e) => setManualLabel(e.target.value)}
                placeholder="e.g. CAT 1, Opener Exam"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-600 dark:text-slate-300">
                Assessment Date
              </label>
              <input
                type="date"
                required
                value={manualDate}
                onChange={(e) => setManualDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          {/* Preset Label Quick Selector */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Quick labels:
            </span>
            {LABEL_PRESETS.map((lbl) => (
              <button
                key={lbl}
                type="button"
                onClick={() => setManualLabel(lbl)}
                className={`rounded-md border px-2 py-1 text-[11px] font-medium whitespace-nowrap ${
                  manualLabel.trim().toLowerCase() === lbl.toLowerCase()
                    ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>

          {!activeStudent ? (
            <div className="rounded-lg border border-slate-200 p-6 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
              Select a learner above to enter subject scores.
            </div>
          ) : subjectDrafts.length === 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              You have no assigned subjects matching {activeStudent.fullName}&apos;s registered subjects in{' '}
              {activeStudent.grade} Stream {activeStudent.section}.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2.5">Subject</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5">Score (0–100)</th>
                    <th className="px-3 py-2.5">Grade</th>
                    <th className="px-3 py-2.5">CBC Mastery Level</th>
                    <th className="px-3 py-2.5">Subject Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {subjectDrafts.map((row, idx) => {
                    const numeric = Number(row.score);
                    const validNum =
                      row.resultStatus === 'Scored' &&
                      row.score.trim() !== '' &&
                      Number.isFinite(numeric) &&
                      numeric >= 0 &&
                      numeric <= 100;
                    const gradeBadge =
                      row.resultStatus === 'Absent'
                        ? 'ABS'
                        : row.resultStatus === 'Exempt'
                        ? 'EXM'
                        : validNum
                        ? computeClientGrade(Math.round(numeric), activeStudent.grade).letterGrade
                        : '—';
                    return (
                      <tr key={row.subject}>
                        <td className="px-3 py-2 font-semibold text-slate-900 dark:text-slate-100">
                          {row.subject}
                        </td>
                        <td className="px-3 py-2">
                          <select
                            aria-label={`${row.subject} status`}
                            value={row.resultStatus}
                            onChange={(e) => {
                              const nextStatus = e.target.value as ExamResultStatus;
                              setSubjectDrafts((prev) =>
                                prev.map((item, i) =>
                                  i === idx ? { ...item, resultStatus: nextStatus } : item
                                )
                              );
                            }}
                            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                          >
                            <option value="Scored">Scored</option>
                            <option value="Absent">Absent (ABS)</option>
                            <option value="Exempt">Exempt (EXM)</option>
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            disabled={row.resultStatus !== 'Scored'}
                            value={row.resultStatus === 'Scored' ? row.score : ''}
                            placeholder={row.resultStatus === 'Scored' ? '0–100' : row.resultStatus}
                            onChange={(e) => {
                              const val = e.target.value;
                              setSubjectDrafts((prev) =>
                                prev.map((item, i) => (i === idx ? { ...item, score: val } : item))
                              );
                            }}
                            className="w-24 rounded-md border border-slate-200 bg-white px-2.5 py-1 font-mono tabular-nums disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:disabled:bg-slate-800"
                          />
                        </td>
                        <td className="px-3 py-2 font-mono font-bold text-blue-700 dark:text-blue-400">
                          {gradeBadge}
                        </td>
                        <td className="px-3 py-2">
                          <select
                            aria-label={`${row.subject} mastery`}
                            value={row.masteryLevel}
                            onChange={(e) => {
                              const val = e.target.value as CbcLearnerMasteryLevel | '';
                              setSubjectDrafts((prev) =>
                                prev.map((item, i) =>
                                  i === idx ? { ...item, masteryLevel: val } : item
                                )
                              );
                            }}
                            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                          >
                            <option value="">Auto from score</option>
                            {MASTERY_LEVELS.map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={row.remarks}
                            placeholder="Optional remark..."
                            onChange={(e) => {
                              const val = e.target.value;
                              setSubjectDrafts((prev) =>
                                prev.map((item, i) => (i === idx ? { ...item, remarks: val } : item))
                              );
                            }}
                            className="w-full min-w-[160px] rounded-md border border-slate-200 bg-white px-2.5 py-1 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Class Teacher Overall Remarks
            </label>
            <textarea
              rows={2}
              value={manualRemarks}
              onChange={(e) => setManualRemarks(e.target.value)}
              placeholder="Summarize learner progress, strengths, and focus areas..."
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setManualEditingId(undefined);
                setMode('viewer');
              }}
              className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingManual || subjectDrafts.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0 dark:bg-blue-600 dark:hover:bg-blue-500"
            >
              <Save className="h-3.5 w-3.5" />
              {savingManual ? 'Saving...' : 'Save Progressive Report'}
            </button>
          </div>
        </form>
      )}

      {/* MODE 3: SPREADSHEET IMPORT */}
      {mode === 'import' && canWrite && (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Bulk Progressive Report Import (.xlsx / .csv)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Download a branded class template, populate subject marks (0–100, ABS, or EXM), and upload to update learners&apos; progressive reports.
              </p>
            </div>
            <button
              type="button"
              onClick={handleDownloadImportTemplate}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              <Download className="h-3.5 w-3.5" />
              Download Branded Template
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-600 dark:text-slate-300">
                Academic Year
              </label>
              <input
                type="text"
                value={importAcademicYear}
                onChange={(e) => setImportAcademicYear(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-600 dark:text-slate-300">
                Term
              </label>
              <input
                type="text"
                value={importTerm}
                onChange={(e) => setImportTerm(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-600 dark:text-slate-300">
                Assessment Label
              </label>
              <input
                type="text"
                value={importLabel}
                onChange={(e) => setImportLabel(e.target.value)}
                placeholder="e.g. CAT 1"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-600 dark:text-slate-300">
                Assessment Date
              </label>
              <input
                type="date"
                value={importDate}
                onChange={(e) => setImportDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-950/40">
            <div className="text-xs">
              <p className="font-semibold text-slate-800 dark:text-slate-200">
                {importFileName ? `Loaded file: ${importFileName}` : 'Choose Excel (.xlsx / .xls) or CSV file'}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                Columns expected: Adm No (or Student Name), Subject columns, and optional Class Teacher Remarks.
              </p>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0 dark:bg-blue-600 dark:hover:bg-blue-500">
              <Upload className="h-3.5 w-3.5" />
              Select Spreadsheet
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleImportFileSelected}
                className="hidden"
              />
            </label>
          </div>

          {blockedImportColumns.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                Ignored unassigned subject column(s) for your teacher profile:{' '}
                <strong>{blockedImportColumns.join(', ')}</strong>.
              </div>
            </div>
          )}

          {lastImportSummary && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3.5 text-xs text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                Imported {lastImportSummary.savedCount} learner record(s) · Skipped{' '}
                {lastImportSummary.skippedRows} row(s).
              </div>
              {lastImportSummary.errors.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px] text-amber-900 dark:text-amber-200">
                  {lastImportSummary.errors.slice(0, 8).map((err, i) => (
                    <li key={i}>
                      Row {err.rowIndex} ({err.identifier}): {err.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {parsedImportRows.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Preview ({parsedImportRows.filter((r) => r.matchedStudentId && r.subjects.length > 0).length} ready of{' '}
                  {parsedImportRows.length} rows)
                </p>
                <button
                  type="button"
                  disabled={
                    importingRows ||
                    parsedImportRows.filter((r) => r.matchedStudentId && r.subjects.length > 0)
                      .length === 0
                  }
                  onClick={handleCommitImport}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <Upload className="h-3.5 w-3.5" />
                  {importingRows ? 'Importing...' : 'Import Progressive Rows'}
                </button>
              </div>

              <div className="max-h-72 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2">Row</th>
                      <th className="px-3 py-2">Matched Learner</th>
                      <th className="px-3 py-2">Parsed Subjects</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {parsedImportRows.map((row) => (
                      <tr key={row.rowIndex}>
                        <td className="px-3 py-2 font-mono tabular-nums text-slate-500">
                          {row.rowIndex}
                        </td>
                        <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">
                          {row.matchedStudentLabel || row.studentCode || row.studentName || '—'}
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                          {row.subjects.length > 0
                            ? row.subjects
                                .map(
                                  (s) =>
                                    `${s.subject}: ${
                                      s.resultStatus === 'Absent'
                                        ? 'ABS'
                                        : s.resultStatus === 'Exempt'
                                        ? 'EXM'
                                        : s.score
                                    }`
                                )
                                .join(' · ')
                            : 'None'}
                        </td>
                        <td className="px-3 py-2">
                          {row.warning ? (
                            <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                              {row.warning}
                            </span>
                          ) : (
                            <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                              Ready
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
