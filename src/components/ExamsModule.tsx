import { useMemo, useState } from 'react';
import {
  Award,
  CheckCircle2,
  Copy,
  FileSpreadsheet,
  FileText,
  MessageCircle,
  Phone,
  Plus,
  Printer,
  Search,
  Trophy,
  X,
} from 'lucide-react';
import { saasApi } from '../lib/api';
import { computeClientGrade, formatDateShort } from '../lib/format';
import {
  buildReportCardWhatsAppMessage,
  buildWhatsAppUrl,
  resolveStudentGuardianContact,
} from '../lib/whatsapp';
import {
  ALL_REGISTERED_SUBJECTS_OPTION,
  CBE_GRADING_SCALE,
  CLASS_TEACHER_SUBJECT_TOKEN,
  getAssessmentGradingSystem,
  getClusterForGrade,
  getSubjectsForGrade,
  is844FormFourGrade,
  KCSE_844_GRADING_SCALE,
  KENYAN_CBC_CLUSTERS,
  STANDARD_ASSESSMENT_TYPES,
  type Student,
  type TeacherProfile,
  type Tenant,
  type TenantWorkspaceData,
  type TimetableSlot,
  type UserRole,
} from '../shared/types';
import { ExamResultsEntryPanel } from './ExamResultsEntryPanel';
import { TenantDocumentHeader } from './TenantDocumentHeader';

interface ExamsModuleProps {
  workspace: TenantWorkspaceData;
  currentRole?: UserRole;
  onRefresh: () => Promise<void>;
  onNotify: (title: string, tone?: 'success' | 'error') => void;
}

function getCycleOrderRank(title: string): number {
  const lower = title.toLowerCase();
  if (/opening/.test(lower)) return 0;
  if (/mid[- ]?term/.test(lower)) return 1;
  if (/end\s*of\s*term|final/.test(lower)) return 2;
  return 3;
}

function shortenCycleTitle(title: string): string {
  return title
    .replace(/\bTerm\s+(\d+)\b/i, 'T$1')
    .replace(/\bExamination\b|\bExam\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function deriveTeacherInitials(fullName?: string): string {
  if (!fullName) return '—';
  const cleaned = fullName
    .trim()
    .replace(/\b(dr|prof|mr|mrs|ms|miss|rev|eng|tr|sir|madam)\.?\s+/gi, ' ')
    .replace(/[^a-zA-Z\s-]/g, ' ')
    .trim();
  if (!cleaned) return '—';
  const parts = cleaned.split(/[\s-]+/).filter(Boolean);
  if (parts.length === 0) return '—';
  return `${parts
    .slice(0, 3)
    .map((part) => part[0].toUpperCase())
    .join('.')}.`;
}

function resolveSubjectTeacher(
  tenant: Pick<Tenant, 'teachers'>,
  timetable: TimetableSlot[],
  student: Pick<Student, 'grade' | 'section'>,
  subject: string
): { name: string; initials: string } {
  const gNorm = student.grade.trim().toLowerCase();
  const sNorm = student.section.trim().toLowerCase();
  const subNorm = subject.trim().toLowerCase();

  // 1. Direct timetable slot match for this student's grade, stream & subject
  const slotMatch = timetable.find(
    (slot) =>
      slot.grade.trim().toLowerCase() === gNorm &&
      slot.section.trim().toLowerCase() === sNorm &&
      slot.subject.trim().toLowerCase() === subNorm &&
      slot.teacherName
  );
  if (slotMatch) {
    return {
      name: slotMatch.teacherName,
      initials: deriveTeacherInitials(slotMatch.teacherName),
    };
  }

  const teachers: TeacherProfile[] = tenant.teachers || [];

  // 2. Teacher explicitly assigned to this grade + stream + subject
  const explicitCohortMatch = teachers.find((t) =>
    (t.assignedClasses || []).some(
      (c) =>
        c.grade.trim().toLowerCase() === gNorm &&
        (c.section.trim().toLowerCase() === sNorm ||
          c.section.trim().toLowerCase() === 'all streams') &&
        ((c.subject && c.subject.trim().toLowerCase() === subNorm) ||
          c.subject === CLASS_TEACHER_SUBJECT_TOKEN ||
          (!c.subject &&
            (t.subjects.some((s) => s.trim().toLowerCase() === subNorm) ||
              t.subjects.includes(CLASS_TEACHER_SUBJECT_TOKEN))))
    )
  );
  if (explicitCohortMatch) {
    return {
      name: explicitCohortMatch.name,
      initials: deriveTeacherInitials(explicitCohortMatch.name),
    };
  }

  // 3. Teacher open to all classes (assignedClasses empty) teaching this subject
  const openSubjectTeacher = teachers.find(
    (t) =>
      (!t.assignedClasses || t.assignedClasses.length === 0) &&
      (t.subjects.some((s) => s.trim().toLowerCase() === subNorm) ||
        t.subjects.includes(CLASS_TEACHER_SUBJECT_TOKEN))
  );
  if (openSubjectTeacher) {
    return {
      name: openSubjectTeacher.name,
      initials: deriveTeacherInitials(openSubjectTeacher.name),
    };
  }

  // 4. Any teacher configured with this subject
  const anySubjectTeacher = teachers.find((t) =>
    t.subjects.some((s) => s.trim().toLowerCase() === subNorm)
  );
  if (anySubjectTeacher) {
    return {
      name: anySubjectTeacher.name,
      initials: deriveTeacherInitials(anySubjectTeacher.name),
    };
  }

  return { name: 'Unassigned', initials: '—' };
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
  if (letterGrade.startsWith('EE')) {
    return 'text-emerald-700 dark:text-emerald-400';
  }
  if (letterGrade.startsWith('ME')) {
    return 'text-blue-700 dark:text-blue-400';
  }
  if (letterGrade.startsWith('AE')) {
    return 'text-amber-700 dark:text-amber-400';
  }
  if (letterGrade.startsWith('BE')) {
    return 'text-red-700 dark:text-red-400';
  }
  return 'text-slate-800 dark:text-slate-200';
}

export function ExamsModule({
  workspace,
  currentRole = 'Teacher',
  onRefresh,
  onNotify,
}: ExamsModuleProps) {
  const { tenant, students, admissions, examCycles, examResults, timetable } = workspace;
  const whatsappDispatches = workspace.whatsappDispatches || [];
  const defaultGrade = tenant.grades.includes('Grade 9') ? 'Grade 9' : tenant.grades[0] || 'Grade 9';

  const orderedCycles = useMemo(() => {
    return [...examCycles].sort((a, b) => {
      const termCmp = a.term.localeCompare(b.term);
      if (termCmp !== 0) return termCmp;
      const rankDiff = getCycleOrderRank(a.title) - getCycleOrderRank(b.title);
      if (rankDiff !== 0) return rankDiff;
      return a.startDate.localeCompare(b.startDate);
    });
  }, [examCycles]);

  const [activeTab, setActiveTab] = useState<'results' | 'entry'>('results');
  const [selectedCycleId, setSelectedCycleId] = useState<string>(
    orderedCycles.find((c) => /mid[- ]?term/i.test(c.title))?.id || orderedCycles[0]?.id || ''
  );
  const [selectedGrade, setSelectedGrade] = useState<string>(defaultGrade);
  const [selectedSubject, setSelectedSubject] = useState<string>(ALL_REGISTERED_SUBJECTS_OPTION);
  const [draftScores, setDraftScores] = useState<Record<string, string>>({});
  const [savingStudentId, setSavingStudentId] = useState<string | null>(null);
  const [reportCardStudentId, setReportCardStudentId] = useState<string | null>(null);
  const [reportCardWhatsAppOpen, setReportCardWhatsAppOpen] = useState(false);
  const [whatsAppPhoneOverride, setWhatsAppPhoneOverride] = useState('');
  const [whatsAppCustomNote, setWhatsAppCustomNote] = useState('');
  const [showWhatsAppQueueModal, setShowWhatsAppQueueModal] = useState(false);
  const [queueSearch, setQueueSearch] = useState('');
  const [queueSelectedStudentId, setQueueSelectedStudentId] = useState<string | null>(null);
  const [showCycleModal, setShowCycleModal] = useState(false);

  const levelSubjects = useMemo(
    () => getSubjectsForGrade(tenant, selectedGrade),
    [tenant, selectedGrade]
  );

  const isAllSubjectsMode = selectedSubject === ALL_REGISTERED_SUBJECTS_OPTION;
  const effectiveSubject = isAllSubjectsMode
    ? ALL_REGISTERED_SUBJECTS_OPTION
    : levelSubjects.includes(selectedSubject)
    ? selectedSubject
    : levelSubjects[0] || ALL_REGISTERED_SUBJECTS_OPTION;

  const is844 = is844FormFourGrade(selectedGrade);
  const gradingSystem = getAssessmentGradingSystem(selectedGrade);
  const maxPoints = is844 ? 12 : 8;
  const activeScale = is844 ? KCSE_844_GRADING_SCALE : CBE_GRADING_SCALE;
  const clusterLabel =
    KENYAN_CBC_CLUSTERS.find((c) => c.id === getClusterForGrade(selectedGrade))?.label ||
    'CBE';

  const [cycleForm, setCycleForm] = useState<{
    examType: (typeof STANDARD_ASSESSMENT_TYPES)[number] | 'Custom';
    title: string;
    term: string;
    startDate: string;
    endDate: string;
  }>({
    examType: 'End of Term Exam',
    title: `${tenant.currentTerm || 'Term 1'} End of Term Exam`,
    term: tenant.currentTerm || 'Term 1',
    startDate: '2026-12-07',
    endDate: '2026-12-11',
  });

  const activeCycle = useMemo(
    () => orderedCycles.find((c) => c.id === selectedCycleId) || orderedCycles[0] || null,
    [orderedCycles, selectedCycleId]
  );

  const gradeStudents = useMemo(
    () => students.filter((s) => s.grade === selectedGrade && s.status === 'Active'),
    [students, selectedGrade]
  );

  // Build single-subject gradebook rows with CBE / 8-4-4 grades & ranking
  const singleSubjectRows = useMemo(() => {
    if (isAllSubjectsMode) return [];
    const cycleId = activeCycle?.id || '';
    const rows = gradeStudents.map((stu) => {
      const existing = examResults.find(
        (r) =>
          r.examCycleId === cycleId &&
          r.studentId === stu.id &&
          r.subject === effectiveSubject
      );
      const rawInput = draftScores[`${stu.id}:${effectiveSubject}`];
      const numericScore =
        rawInput !== undefined && rawInput !== ''
          ? Math.max(0, Math.min(100, Number(rawInput)))
          : existing?.score ?? null;

      const computed =
        numericScore !== null ? computeClientGrade(numericScore, stu.grade) : null;
      return {
        student: stu,
        existing,
        score: numericScore,
        letterGrade: computed?.letterGrade ?? '—',
        gpaPoints: computed?.gpaPoints ?? null,
        remarks: existing?.remarks || '',
      };
    });

    const sortedScores = rows
      .filter((r) => r.score !== null)
      .map((r) => r.score as number)
      .sort((a, b) => b - a);

    return rows.map((row) => ({
      ...row,
      rank: row.score !== null ? sortedScores.indexOf(row.score) + 1 : null,
    }));
  }, [isAllSubjectsMode, gradeStudents, examResults, activeCycle, effectiveSubject, draftScores]);

  // Build All Registered Subjects mark-summation rows (sum marks across subjects, grade & rank)
  const allSubjectsRankedRows = useMemo(() => {
    const cycleId = activeCycle?.id || '';
    const base = gradeStudents.map((stu) => {
      const stuResults = examResults.filter(
        (r) => r.examCycleId === cycleId && r.studentId === stu.id
      );
      const registeredSubjects = Array.from(
        new Set([...levelSubjects, ...stuResults.map((r) => r.subject)])
      );

      const subjectsSat = stuResults.length;
      const totalScore = stuResults.reduce((sum, item) => sum + item.score, 0);
      const maxPossible = stuResults.reduce((sum, item) => sum + (item.maxScore || 100), 0);
      const meanScore =
        maxPossible > 0 ? Math.round((totalScore / maxPossible) * 1000) / 10 : null;
      const overallGradeInfo =
        meanScore !== null ? computeClientGrade(meanScore, stu.grade) : null;

      return {
        student: stu,
        subjectsSat,
        registeredCount: registeredSubjects.length,
        totalScore,
        maxPossible,
        meanScore,
        overallGrade: overallGradeInfo?.letterGrade || '—',
        overallPoints: overallGradeInfo?.gpaPoints ?? null,
      };
    });

    // Sort by summed marks descending, then grade points & mean percentage descending
    const sorted = [...base].sort((a, b) => {
      if ((a.subjectsSat > 0) !== (b.subjectsSat > 0)) {
        return a.subjectsSat > 0 ? -1 : 1;
      }
      const totalDiff = b.totalScore - a.totalScore;
      if (totalDiff !== 0) return totalDiff;
      const ptsDiff = (b.overallPoints ?? -1) - (a.overallPoints ?? -1);
      if (ptsDiff !== 0) return ptsDiff;
      const meanDiff = (b.meanScore ?? -1) - (a.meanScore ?? -1);
      if (meanDiff !== 0) return meanDiff;
      return a.student.fullName.localeCompare(b.student.fullName);
    });

    let lastKey = '';
    let lastRank = 0;
    return sorted.map((row, idx) => {
      if (row.subjectsSat === 0) {
        return { ...row, rank: null as number | null };
      }
      const rankKey = `${row.totalScore}::${row.overallPoints ?? 0}`;
      const rank = rankKey === lastKey ? lastRank : idx + 1;
      lastKey = rankKey;
      lastRank = rank;
      return { ...row, rank };
    });
  }, [gradeStudents, examResults, activeCycle, levelSubjects]);

  const classStats = useMemo(() => {
    const passCutoff = is844 ? 40 : 41; // 8-4-4 D+ (40%) or CBE ME2 (41%)
    if (isAllSubjectsMode) {
      const ranked = allSubjectsRankedRows.filter((r) => r.meanScore !== null);
      if (ranked.length === 0) {
        return { mean: 0, highest: 0, highestLabel: '0', passRate: 0, count: 0 };
      }
      const mean =
        Math.round(
          (ranked.reduce((sum, r) => sum + (r.meanScore || 0), 0) / ranked.length) * 10
        ) / 10;
      const topStudent = ranked[0];
      const passCount = ranked.filter((r) => (r.meanScore || 0) >= passCutoff).length;
      const passRate = Math.round((passCount / ranked.length) * 100);
      return {
        mean,
        highest: topStudent.totalScore,
        highestLabel: `${topStudent.totalScore} / ${topStudent.maxPossible} (${topStudent.overallGrade})`,
        passRate,
        count: ranked.length,
      };
    }

    const scored = singleSubjectRows
      .filter((r) => r.score !== null)
      .map((r) => r.score as number);
    if (scored.length === 0) {
      return { mean: 0, highest: 0, highestLabel: '0', passRate: 0, count: 0 };
    }
    const mean = Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 10) / 10;
    const highest = Math.max(...scored);
    const passCount = scored.filter((s) => s >= passCutoff).length;
    const passRate = Math.round((passCount / scored.length) * 100);
    return {
      mean,
      highest,
      highestLabel: String(highest),
      passRate,
      count: scored.length,
    };
  }, [isAllSubjectsMode, allSubjectsRankedRows, singleSubjectRows, is844]);

  async function saveScore(studentId: string, rawVal: string) {
    if (!activeCycle || rawVal === '' || isAllSubjectsMode) return;
    const score = Number(rawVal);
    if (Number.isNaN(score)) return;
    setSavingStudentId(studentId);
    try {
      await saasApi.upsertExamScore(tenant.id, {
        examCycleId: activeCycle.id,
        studentId,
        subject: effectiveSubject,
        score,
      });
      await onRefresh();
      setDraftScores((prev) => {
        const next = { ...prev };
        delete next[`${studentId}:${effectiveSubject}`];
        return next;
      });
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to save score', 'error');
    } finally {
      setSavingStudentId(null);
    }
  }

  async function handlePublishCycle() {
    if (!activeCycle) return;
    try {
      await saasApi.publishExamCycle(tenant.id, activeCycle.id);
      await onRefresh();
      onNotify(`${activeCycle.title} published across ${tenant.name}.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to publish cycle', 'error');
    }
  }

  async function handleCreateCycle(e: React.FormEvent) {
    e.preventDefault();
    if (!cycleForm.title.trim()) return;
    try {
      const { cycle } = await saasApi.createExamCycle(tenant.id, {
        title: cycleForm.title.trim(),
        term: cycleForm.term.trim(),
        startDate: cycleForm.startDate,
        endDate: cycleForm.endDate,
      });
      await onRefresh();
      setSelectedCycleId(cycle.id);
      setShowCycleModal(false);
      setCycleForm({
        examType: 'End of Term Exam',
        title: `${tenant.currentTerm || 'Term 1'} End of Term Exam`,
        term: tenant.currentTerm || 'Term 1',
        startDate: '2026-12-07',
        endDate: '2026-12-11',
      });
      onNotify(`Exam cycle "${cycle.title}" created.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to create cycle', 'error');
    }
  }

  const reportCardDispatchesByStudent = useMemo(() => {
    const map = new Map<string, { sentAt: string; guardianPhone: string }>();
    if (!activeCycle) return map;
    for (const rec of whatsappDispatches) {
      if (
        rec.category === 'Report Card' &&
        rec.referenceLabel === activeCycle.title &&
        !map.has(rec.studentId)
      ) {
        map.set(rec.studentId, { sentAt: rec.sentAt, guardianPhone: rec.guardianPhone });
      }
    }
    return map;
  }, [whatsappDispatches, activeCycle]);

  function openReportCardModal(studentId: string, openWhatsAppPanel = false) {
    const stu = students.find((s) => s.id === studentId);
    const contact = resolveStudentGuardianContact(stu, admissions);
    setReportCardStudentId(studentId);
    setReportCardWhatsAppOpen(openWhatsAppPanel);
    setWhatsAppPhoneOverride(contact.guardianPhone);
    setWhatsAppCustomNote('');
  }

  async function recordReportCardDispatch(params: {
    studentId: string;
    studentName: string;
    guardianName: string;
    guardianPhone: string;
    messagePreview: string;
  }) {
    if (!activeCycle) return;
    try {
      await saasApi.logWhatsAppDispatch(tenant.id, {
        category: 'Report Card',
        studentId: params.studentId,
        studentName: params.studentName,
        guardianName: params.guardianName,
        guardianPhone: params.guardianPhone,
        referenceLabel: activeCycle.title,
        messagePreview: params.messagePreview,
        sentBy: `${currentRole} Desk`,
      });
      await onRefresh();
      onNotify(
        `WhatsApp report card prepared for ${params.guardianName} (${params.guardianPhone}).`
      );
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Unable to log WhatsApp dispatch',
        'error'
      );
    }
  }

  async function handleCopyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      onNotify(`${label} copied to clipboard.`);
    } catch {
      onNotify('Unable to access clipboard. Select and copy the message preview directly.', 'error');
    }
  }

  const classWhatsAppQueue = useMemo(() => {
    if (!activeCycle) return [];
    const q = queueSearch.trim().toLowerCase();
    return allSubjectsRankedRows
      .map((row) => {
        const stu = row.student;
        const contact = resolveStudentGuardianContact(stu, admissions);
        const results = examResults
          .filter((r) => r.examCycleId === activeCycle.id && r.studentId === stu.id)
          .map((r) => {
            const graded = computeClientGrade(r.score, stu.grade);
            return {
              subject: r.subject,
              score: r.score,
              maxScore: r.maxScore || 100,
              letterGrade: graded.letterGrade,
              remarks: r.remarks,
            };
          });
        const stuIs844 = is844FormFourGrade(stu.grade);
        const stuMaxPts = stuIs844 ? 12 : 8;
        const totalRanked = allSubjectsRankedRows.filter((r) => r.rank !== null).length;
        const message = buildReportCardWhatsAppMessage({
          tenant,
          cycle: activeCycle,
          student: stu,
          guardianName: contact.guardianName,
          subjects: results,
          totalMarks: row.totalScore,
          maxPossible: row.maxPossible,
          avgScore: row.meanScore ?? 0,
          meanGrade: row.overallGrade,
          meanPoints: row.overallPoints !== null ? String(row.overallPoints) : '0',
          maxPoints: stuMaxPts,
          overallRank: row.rank,
          totalRanked,
        });
        const waUrl = buildWhatsAppUrl(contact.guardianPhone, message);
        const dispatch = reportCardDispatchesByStudent.get(stu.id) || null;
        return {
          row,
          contact,
          resultsCount: results.length,
          message,
          waUrl,
          dispatch,
        };
      })
      .filter((item) => {
        if (!q) return true;
        return (
          item.row.student.fullName.toLowerCase().includes(q) ||
          item.row.student.studentCode.toLowerCase().includes(q) ||
          item.contact.guardianName.toLowerCase().includes(q) ||
          item.contact.guardianPhone.toLowerCase().includes(q)
        );
      });
  }, [
    activeCycle,
    allSubjectsRankedRows,
    admissions,
    examResults,
    tenant,
    reportCardDispatchesByStudent,
    queueSearch,
  ]);

  const activeQueueItem = useMemo(() => {
    if (classWhatsAppQueue.length === 0) return null;
    return (
      classWhatsAppQueue.find((item) => item.row.student.id === queueSelectedStudentId) ||
      classWhatsAppQueue[0]
    );
  }, [classWhatsAppQueue, queueSelectedStudentId]);

  const reportCardData = useMemo(() => {
    if (!reportCardStudentId || !activeCycle) return null;
    const student = students.find((s) => s.id === reportCardStudentId);
    if (!student) return null;
    const studentIs844 = is844FormFourGrade(student.grade);
    const studentMaxPts = studentIs844 ? 12 : 8;
    const results = examResults
      .filter((r) => r.examCycleId === activeCycle.id && r.studentId === student.id)
      .map((r) => {
        const graded = computeClientGrade(r.score, student.grade);
        const teacherInfo = resolveSubjectTeacher(tenant, timetable, student, r.subject);
        return {
          ...r,
          letterGrade: graded.letterGrade,
          gpaPoints: graded.gpaPoints,
          teacherName: teacherInfo.name,
          teacherInitials: teacherInfo.initials,
        };
      });
    const totalMarks = results.reduce((sum, r) => sum + r.score, 0);
    const maxPossible = results.reduce((sum, r) => sum + (r.maxScore || 100), 0);
    const avgScore =
      maxPossible > 0 ? Math.round((totalMarks / maxPossible) * 1000) / 10 : 0;
    const overallGradeInfo =
      results.length > 0 ? computeClientGrade(avgScore, student.grade) : null;
    const rankRow = allSubjectsRankedRows.find((r) => r.student.id === student.id);
    const totalRanked = allSubjectsRankedRows.filter((r) => r.rank !== null).length;

    // Build chronological progression across exam cycles up to and including the active cycle
    const activeCycleIdx = orderedCycles.findIndex((c) => c.id === activeCycle.id);
    const candidateCycles =
      activeCycleIdx >= 0 ? orderedCycles.slice(0, activeCycleIdx + 1) : orderedCycles;
    const rawProgression = candidateCycles
      .map((cycle) => {
        const cycleResults = examResults.filter(
          (r) => r.examCycleId === cycle.id && r.studentId === student.id
        );
        if (cycleResults.length === 0) return null;
        const cTotal = cycleResults.reduce((sum, r) => sum + r.score, 0);
        const cMax = cycleResults.reduce((sum, r) => sum + (r.maxScore || 100), 0);
        const cAvg = cMax > 0 ? Math.round((cTotal / cMax) * 1000) / 10 : 0;
        const cGrade = computeClientGrade(cAvg, student.grade);
        return {
          cycleId: cycle.id,
          title: cycle.title,
          shortLabel: shortenCycleTitle(cycle.title),
          term: cycle.term,
          startDate: cycle.startDate,
          avgScore: cAvg,
          totalMarks: cTotal,
          maxPossible: cMax,
          subjectsSat: cycleResults.length,
          meanGrade: cGrade.letterGrade,
          gpaPoints: cGrade.gpaPoints,
          isCurrent: cycle.id === activeCycle.id,
          cycleResults,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    const progressionPoints = rawProgression.map((pt, idx) => ({
      ...pt,
      deltaFromPrev:
        idx > 0
          ? Math.round((pt.avgScore - rawProgression[idx - 1].avgScore) * 10) / 10
          : null,
    }));

    const currentProgIdx = progressionPoints.findIndex((p) => p.isCurrent);
    const previousCyclePoint =
      currentProgIdx > 0
        ? progressionPoints[currentProgIdx - 1]
        : !progressionPoints.some((p) => p.isCurrent) && progressionPoints.length > 0
        ? progressionPoints[progressionPoints.length - 1]
        : null;

    const subjectComparison = results.map((r) => {
      const prevMatch = previousCyclePoint?.cycleResults.find(
        (pr) => pr.subject.trim().toLowerCase() === r.subject.trim().toLowerCase()
      );
      const currentPct =
        (r.maxScore || 100) > 0 ? Math.round((r.score / (r.maxScore || 100)) * 100) : r.score;
      const previousPct = prevMatch
        ? (prevMatch.maxScore || 100) > 0
          ? Math.round((prevMatch.score / (prevMatch.maxScore || 100)) * 100)
          : prevMatch.score
        : null;
      return {
        subject: r.subject,
        shortSubject: r.subject.length > 14 ? `${r.subject.slice(0, 12)}…` : r.subject,
        currentScore: currentPct,
        previousScore: previousPct,
        delta: previousPct !== null ? currentPct - previousPct : null,
      };
    });

    const guardianContact = resolveStudentGuardianContact(student, admissions);
    const effectivePhone = whatsAppPhoneOverride.trim() || guardianContact.guardianPhone;
    const whatsappMessage = buildReportCardWhatsAppMessage({
      tenant,
      cycle: activeCycle,
      student,
      guardianName: guardianContact.guardianName,
      subjects: results.map((r) => ({
        subject: r.subject,
        score: r.score,
        maxScore: r.maxScore || 100,
        letterGrade: r.letterGrade,
        remarks: r.remarks,
      })),
      totalMarks,
      maxPossible,
      avgScore,
      meanGrade: overallGradeInfo?.letterGrade || '—',
      meanPoints: overallGradeInfo ? String(overallGradeInfo.gpaPoints) : '0',
      maxPoints: studentMaxPts,
      overallRank: rankRow?.rank || null,
      totalRanked,
      customNote: whatsAppCustomNote,
    });
    const whatsappUrl = buildWhatsAppUrl(effectivePhone, whatsappMessage);
    const lastDispatch = reportCardDispatchesByStudent.get(student.id) || null;
    return {
      student,
      results,
      totalMarks,
      maxPossible,
      avgScore,
      meanPoints: overallGradeInfo ? String(overallGradeInfo.gpaPoints) : '0',
      meanGrade: overallGradeInfo?.letterGrade || '—',
      studentMaxPts,
      studentSystemLabel: studentIs844 ? '8-4-4 KCSE (Form 4)' : 'Current CBE',
      overallRank: rankRow?.rank || null,
      totalRanked,
      progressionPoints,
      previousCyclePoint,
      subjectComparison,
      guardianContact,
      effectivePhone,
      whatsappMessage,
      whatsappUrl,
      lastDispatch,
    };
  }, [
    reportCardStudentId,
    activeCycle,
    orderedCycles,
    students,
    admissions,
    examResults,
    timetable,
    allSubjectsRankedRows,
    tenant,
    whatsAppPhoneOverride,
    whatsAppCustomNote,
    reportCardDispatchesByStudent,
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Exams & Assessment
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Term Opening, Mid-Term, and End of Term exams with Kenyan CBE (EE1–BE2) grading for all CBE levels, 8-4-4 KCSE (A–E) for Form 4 (Grade 12), and full-subject mark summation ranking.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setActiveTab('results')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === 'results'
                  ? 'bg-slate-900 text-white dark:bg-blue-600'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Results & Merit List
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('entry')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === 'entry'
                  ? 'bg-slate-900 text-white dark:bg-blue-600'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Exam Results Entry
            </button>
          </div>
          <button
            onClick={() => {
              setQueueSelectedStudentId(gradeStudents[0]?.id || null);
              setShowWhatsAppQueueModal(true);
            }}
            disabled={!activeCycle || gradeStudents.length === 0}
            className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/70"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            WhatsApp Report Cards
          </button>
          <button
            onClick={() => setShowCycleModal(true)}
            className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Plus className="h-3.5 w-3.5" />
            New Exam Cycle
          </button>
          {activeTab === 'results' && activeCycle && activeCycle.status !== 'Published' && (
            <button
              onClick={handlePublishCycle}
              className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Publish Results
            </button>
          )}
        </div>
      </div>

      {activeTab === 'entry' ? (
        <ExamResultsEntryPanel
          workspace={workspace}
          currentRole={currentRole}
          onRefresh={onRefresh}
          onNotify={onNotify}
          onViewResults={(cycleId, grade) => {
            setSelectedCycleId(cycleId);
            setSelectedGrade(grade);
            setSelectedSubject(ALL_REGISTERED_SUBJECTS_OPTION);
            setActiveTab('results');
          }}
        />
      ) : (
        <>
      {/* Filters & Cycle Summary */}
      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="Select exam cycle"
            value={activeCycle?.id || ''}
            onChange={(e) => setSelectedCycleId(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            {orderedCycles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} ({c.status})
              </option>
            ))}
          </select>

          <select
            aria-label="Select grade level"
            value={selectedGrade}
            onChange={(e) => {
              const nextGrade = e.target.value;
              const nextSubs = getSubjectsForGrade(tenant, nextGrade);
              setSelectedGrade(nextGrade);
              if (
                selectedSubject !== ALL_REGISTERED_SUBJECTS_OPTION &&
                !nextSubs.includes(selectedSubject) &&
                nextSubs[0]
              ) {
                setSelectedSubject(nextSubs[0]);
              }
            }}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            {tenant.grades.map((g) => (
              <option key={g} value={g}>
                {is844FormFourGrade(g) ? `${g} (Form 4 · 8-4-4)` : g}
              </option>
            ))}
          </select>

          <select
            aria-label="Select subject or all registered subjects"
            value={effectiveSubject}
            onChange={(e) => setSelectedSubject(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            <option value={ALL_REGISTERED_SUBJECTS_OPTION}>
              All Registered Subjects (Mark Summation & Ranking)
            </option>
            {levelSubjects.map((sub) => (
              <option key={sub} value={sub}>
                {sub}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 tabular-nums dark:text-slate-400">
          <span>
            Class Mean: <strong className="font-mono text-slate-900 dark:text-slate-100">{classStats.mean}%</strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {isAllSubjectsMode ? 'Top Summation:' : 'High Score:'}{' '}
            <strong className="font-mono text-slate-900 dark:text-slate-100">
              {classStats.highestLabel}
            </strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {is844 ? 'Pass Rate (D+ & above):' : 'Meeting+ (ME2 & above):'}{' '}
            <strong className="font-mono text-emerald-700 dark:text-emerald-400">
              {classStats.passRate}%
            </strong>
          </span>
        </div>
      </div>

      {/* Active Grading Scale Reference Strip */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/60">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
            <Trophy className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            <span>
              {is844
                ? `8-4-4 KCSE Grading System — ${selectedGrade} (Form 4) · 12-Point Scale`
                : `Current CBE Grading System — ${clusterLabel} (${selectedGrade}) · 8-Point Scale`}
            </span>
          </div>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {gradingSystem === '8-4-4'
              ? 'Only Grade 12 (Form 4) uses 8-4-4 KCSE grades'
              : 'All Playgroup – Grade 11 classes use KNEC CBE performance levels'}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-slate-600 tabular-nums dark:text-slate-400">
          {activeScale.map((band) => (
            <span key={band.grade}>
              <strong className={getGradeBadgeColor(band.grade, is844)}>{band.grade}</strong>:{' '}
              {band.minScore}–{band.maxScore}% ({band.points}pt)
            </span>
          ))}
        </div>
      </div>

      {/* Gradebook Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          {isAllSubjectsMode ? (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Rank</th>
                  <th className="px-4 py-3">Student ID</th>
                  <th className="px-4 py-3">Student Name</th>
                  <th className="px-4 py-3 text-right">Subjects Sat</th>
                  <th className="px-4 py-3 text-right">Total Marks</th>
                  <th className="px-4 py-3 text-right">Mean (%)</th>
                  <th className="px-4 py-3 text-right">
                    {is844 ? '8-4-4 Grade' : 'CBE Level'}
                  </th>
                  <th className="px-4 py-3 text-right">Points (/{maxPoints})</th>
                  <th className="px-4 py-3 text-right">Transcript</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {allSubjectsRankedRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                      No active students enrolled in {selectedGrade}.
                    </td>
                  </tr>
                ) : (
                  allSubjectsRankedRows.map((row) => (
                    <tr key={row.student.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                      <td className="px-4 py-3 font-mono text-xs font-bold text-slate-900 tabular-nums dark:text-slate-100">
                        {row.rank ? `#${row.rank}` : '—'}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
                        {row.student.studentCode}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                        {row.student.fullName}
                        <span className="ml-2 text-xs font-normal text-slate-400">
                          Stream {row.student.section}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-slate-600 tabular-nums dark:text-slate-400">
                        {row.subjectsSat} / {row.registeredCount}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm font-bold text-slate-900 tabular-nums dark:text-slate-100">
                        {row.subjectsSat > 0 ? `${row.totalScore} / ${row.maxPossible}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs font-medium text-slate-700 tabular-nums dark:text-slate-300">
                        {row.meanScore !== null ? `${row.meanScore}%` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs font-bold tabular-nums">
                        <span className={getGradeBadgeColor(row.overallGrade, is844)}>
                          {row.overallGrade}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-slate-600 tabular-nums dark:text-slate-400">
                        {row.overallPoints !== null ? `${row.overallPoints} / ${maxPoints}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center justify-end gap-3">
                          <button
                            type="button"
                            onClick={() => openReportCardModal(row.student.id, false)}
                            className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                          >
                            <FileText className="h-3.5 w-3.5" />
                            Report Card
                          </button>
                          <button
                            type="button"
                            onClick={() => openReportCardModal(row.student.id, true)}
                            title={`Send report card via WhatsApp to guardian (${row.student.guardianPhone || 'admissions contact'})`}
                            className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                            {reportCardDispatchesByStudent.has(row.student.id) ? 'Sent ✓' : 'WhatsApp'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Student ID</th>
                  <th className="px-4 py-3">Student Name</th>
                  <th className="px-4 py-3">Score (0–100)</th>
                  <th className="px-4 py-3 text-right">
                    {is844 ? '8-4-4 Grade' : 'CBE Level'}
                  </th>
                  <th className="px-4 py-3 text-right">Points (/{maxPoints})</th>
                  <th className="px-4 py-3 text-right">Subject Rank</th>
                  <th className="px-4 py-3 text-right">Transcript</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {singleSubjectRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                      No active students enrolled in {selectedGrade}.
                    </td>
                  </tr>
                ) : (
                  singleSubjectRows.map((row) => {
                    const key = `${row.student.id}:${effectiveSubject}`;
                    const inputVal =
                      draftScores[key] !== undefined
                        ? draftScores[key]
                        : row.existing
                        ? String(row.existing.score)
                        : '';
                    const isDirty =
                      draftScores[key] !== undefined &&
                      Number(draftScores[key]) !== row.existing?.score;
                    return (
                      <tr key={row.student.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
                          {row.student.studentCode}
                        </td>
                        <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                          {row.student.fullName}
                          <span className="ml-2 text-xs font-normal text-slate-400">
                            Stream {row.student.section}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={inputVal}
                              onChange={(e) =>
                                setDraftScores((prev) => ({ ...prev, [key]: e.target.value }))
                              }
                              onBlur={() => {
                                if (isDirty) saveScore(row.student.id, inputVal);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveScore(row.student.id, inputVal);
                              }}
                              placeholder="—"
                              className="w-20 rounded-md border border-slate-200 bg-white px-2.5 py-1 font-mono text-sm text-slate-900 tabular-nums focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                            />
                            {isDirty && (
                              <button
                                type="button"
                                disabled={savingStudentId === row.student.id}
                                onClick={() => saveScore(row.student.id, inputVal)}
                                className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700"
                              >
                                Save
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold tabular-nums">
                          <span className={getGradeBadgeColor(row.letterGrade, is844)}>
                            {row.letterGrade}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-600 tabular-nums dark:text-slate-400">
                          {row.gpaPoints !== null ? `${row.gpaPoints} / ${maxPoints}` : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-600 tabular-nums dark:text-slate-400">
                          {row.rank ? `#${row.rank}` : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="inline-flex items-center justify-end gap-3">
                            <button
                              type="button"
                              onClick={() => openReportCardModal(row.student.id, false)}
                              className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                            >
                              <FileText className="h-3.5 w-3.5" />
                              Report Card
                            </button>
                            <button
                              type="button"
                              onClick={() => openReportCardModal(row.student.id, true)}
                              title={`Send report card via WhatsApp to guardian (${row.student.guardianPhone || 'admissions contact'})`}
                              className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
                            >
                              <MessageCircle className="h-3.5 w-3.5" />
                              {reportCardDispatchesByStudent.has(row.student.id) ? 'Sent ✓' : 'WhatsApp'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
        </>
      )}

      {/* Report Card Modal */}
      {reportCardData && activeCycle && (
        <div className="print-modal-root fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4">
          <div className="print-modal-sheet my-8 max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex flex-wrap items-center justify-end gap-2 no-print">
              <button
                type="button"
                onClick={() => setReportCardWhatsAppOpen((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                  reportCardWhatsAppOpen
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-300'
                }`}
              >
                <MessageCircle className="h-3.5 w-3.5" />
                Send via WhatsApp
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Printer className="h-3.5 w-3.5" />
                Print
              </button>
              <button
                type="button"
                onClick={() => {
                  setReportCardStudentId(null);
                  setReportCardWhatsAppOpen(false);
                }}
                aria-label="Close report card"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <TenantDocumentHeader
              tenant={tenant}
              documentTitle="Academic Report Card"
              subtitle={`${activeCycle.title} · ${reportCardData.studentSystemLabel}`}
              rightMeta={[
                { label: 'Student', value: reportCardData.student.fullName },
                { label: 'Adm No', value: reportCardData.student.studentCode },
              ]}
              compact
            />

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-2 font-mono text-xs text-slate-600 tabular-nums dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300">
              <span>
                Class: <strong className="text-slate-900 dark:text-slate-100">{reportCardData.student.grade} Stream {reportCardData.student.section}</strong>
              </span>
              <span>
                Guardian: <strong className="text-slate-900 dark:text-slate-100">{reportCardData.guardianContact.guardianName}</strong> ({reportCardData.guardianContact.guardianPhone || 'No number on file'})
              </span>
            </div>

            {/* Expandable WhatsApp Dispatch Panel using Admissions Guardian Phone */}
            {reportCardWhatsAppOpen && (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 no-print dark:border-emerald-900/60 dark:bg-emerald-950/20">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="flex items-center gap-1.5 text-xs font-bold text-emerald-900 dark:text-emerald-200">
                      <Phone className="h-3.5 w-3.5" />
                      WhatsApp Guardian Delivery (Admissions Contact)
                    </h3>
                    <p className="mt-0.5 text-[11px] text-emerald-800/80 dark:text-emerald-300/80">
                      Recipient: <span className="font-semibold">{reportCardData.guardianContact.guardianName}</span>
                      {reportCardData.lastDispatch
                        ? ` · Last sent ${formatDateShort(reportCardData.lastDispatch.sentAt)}`
                        : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        handleCopyText(reportCardData.whatsappMessage, 'Report card summary')
                      }
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-50 dark:border-emerald-800 dark:bg-slate-900 dark:text-emerald-300"
                    >
                      <Copy className="h-3 w-3" />
                      Copy Text
                    </button>
                    {reportCardData.whatsappUrl ? (
                      <a
                        href={reportCardData.whatsappUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => {
                          void recordReportCardDispatch({
                            studentId: reportCardData.student.id,
                            studentName: reportCardData.student.fullName,
                            guardianName: reportCardData.guardianContact.guardianName,
                            guardianPhone: reportCardData.effectivePhone,
                            messagePreview: reportCardData.whatsappMessage,
                          });
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                        Open WhatsApp &amp; Send
                      </a>
                    ) : (
                      <span className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                        Enter a valid guardian phone number below
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                      Guardian WhatsApp Number (from Admissions)
                    </label>
                    <input
                      type="text"
                      value={whatsAppPhoneOverride}
                      onChange={(e) => setWhatsAppPhoneOverride(e.target.value)}
                      placeholder="+254 712 345 678"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                      Optional Principal / Teacher Remark
                    </label>
                    <input
                      type="text"
                      value={whatsAppCustomNote}
                      onChange={(e) => setWhatsAppCustomNote(e.target.value)}
                      placeholder="e.g. Commendable improvement in Mathematics."
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>

                <pre className="mt-3 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-emerald-200/80 bg-white p-3 font-sans text-[11px] leading-relaxed text-slate-700 dark:border-emerald-900/60 dark:bg-slate-900 dark:text-slate-300">
                  {reportCardData.whatsappMessage}
                </pre>
              </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-4 border-b border-slate-100 pb-4 text-xs sm:grid-cols-4 dark:border-slate-800">
              <div>
                <p className="text-slate-500 dark:text-slate-400">Total / Mean</p>
                <p className="mt-1 font-mono text-base font-bold text-slate-900 tabular-nums dark:text-slate-100">
                  {reportCardData.totalMarks} / {reportCardData.maxPossible} ({reportCardData.avgScore}%)
                </p>
              </div>
              <div>
                <p className="text-slate-500 dark:text-slate-400">Overall Grade</p>
                <p className="mt-1 font-mono text-base font-bold text-blue-700 tabular-nums dark:text-blue-400">
                  {reportCardData.meanGrade} ({reportCardData.meanPoints}/{reportCardData.studentMaxPts})
                </p>
              </div>
              <div>
                <p className="text-slate-500 dark:text-slate-400">Class Position</p>
                <p className="mt-1 font-mono text-base font-bold text-slate-900 tabular-nums dark:text-slate-100">
                  {reportCardData.overallRank
                    ? `#${reportCardData.overallRank} / ${reportCardData.totalRanked}`
                    : '—'}
                </p>
              </div>
              <div>
                <p className="text-slate-500 dark:text-slate-400">Cycle Status</p>
                <p className="mt-1 flex items-center gap-1 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  <Award className="h-4 w-4" />
                  {activeCycle.status}
                </p>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <tr>
                    <th className="py-2">Subject</th>
                    <th className="py-2 text-right">Score</th>
                    <th className="py-2 text-right">Grade</th>
                    <th className="py-2 text-right">Points</th>
                    <th className="py-2 pl-4">Instructor Remarks</th>
                    <th className="py-2 pl-3 text-right">Teacher Initials</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {reportCardData.results.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-xs text-slate-500">
                        No marks recorded yet for this student in {activeCycle.title}.
                      </td>
                    </tr>
                  ) : (
                    reportCardData.results.map((r) => (
                      <tr key={r.id}>
                        <td className="py-2.5 font-medium text-slate-900 dark:text-slate-100">
                          {r.subject}
                        </td>
                        <td className="py-2.5 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                          {r.score} / {r.maxScore}
                        </td>
                        <td className="py-2.5 text-right font-mono font-semibold text-slate-900 dark:text-slate-100">
                          {r.letterGrade}
                        </td>
                        <td className="py-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                          {r.gpaPoints} / {reportCardData.studentMaxPts}
                        </td>
                        <td className="py-2.5 pl-4 text-xs text-slate-600 dark:text-slate-400">
                          {r.remarks}
                        </td>
                        <td
                          title={r.teacherName}
                          className="py-2.5 pl-3 text-right font-mono text-xs font-semibold text-slate-800 tabular-nums dark:text-slate-200"
                        >
                          {r.teacherInitials}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Progressive Performance Graphs (Historical Exam Cycles & Subject Trajectory) */}
            {reportCardData.progressionPoints.length > 0 && (
              <div className="mt-5 break-inside-avoid rounded-lg border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-950/40">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 pb-2.5 dark:border-slate-800">
                  <div>
                    <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      Academic Performance Progression
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Longitudinal mean score trend across previous &amp; current assessments
                    </p>
                  </div>
                  {(() => {
                    const latestPt =
                      reportCardData.progressionPoints.find((p) => p.isCurrent) ||
                      reportCardData.progressionPoints[reportCardData.progressionPoints.length - 1];
                    if (!latestPt || latestPt.deltaFromPrev === null) {
                      return (
                        <span className="rounded border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-600 tabular-nums dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                          Baseline Assessment
                        </span>
                      );
                    }
                    const d = latestPt.deltaFromPrev;
                    return (
                      <span
                        className={`rounded border px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums ${
                          d > 0
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                            : d < 0
                            ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
                            : 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                        }`}
                      >
                        {d > 0 ? `+${d}%` : `${d}%`} vs {reportCardData.previousCyclePoint?.shortLabel || 'Prior Exam'}
                      </span>
                    );
                  })()}
                </div>

                <div
                  className={`mt-3 grid grid-cols-1 gap-4 ${
                    reportCardData.subjectComparison.length > 0 && reportCardData.previousCyclePoint
                      ? 'md:grid-cols-2'
                      : ''
                  }`}
                >
                  {/* Graph 1: Mean Percentage Trend Line Across Exam Cycles */}
                  <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                    <p className="mb-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                      Exam Cycle Mean Trend (%)
                    </p>
                    {(() => {
                      const pts = reportCardData.progressionPoints;
                      const w = 360;
                      const h = 148;
                      const padL = 32;
                      const padR = 24;
                      const padT = 22;
                      const padB = 34;
                      const plotW = w - padL - padR;
                      const plotH = h - padT - padB;
                      const coords = pts.map((pt, idx) => {
                        const x =
                          pts.length === 1
                            ? padL + plotW / 2
                            : padL + (idx / (pts.length - 1)) * plotW;
                        const y = padT + ((100 - Math.max(0, Math.min(100, pt.avgScore))) / 100) * plotH;
                        return { ...pt, x, y };
                      });
                      const linePoints = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
                      const areaPoints =
                        coords.length > 1
                          ? `${coords[0].x.toFixed(1)},${(padT + plotH).toFixed(1)} ${linePoints} ${coords[
                              coords.length - 1
                            ].x.toFixed(1)},${(padT + plotH).toFixed(1)}`
                          : '';
                      return (
                        <svg
                          viewBox={`0 0 ${w} ${h}`}
                          className="h-36 w-full overflow-visible"
                          role="img"
                          aria-label="Student progressive mean score line graph"
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
                                  x={padL - 5}
                                  y={ty + 3}
                                  textAnchor="end"
                                  fill="#64748b"
                                  fontSize="9"
                                  fontFamily="var(--font-mono), monospace"
                                >
                                  {tick}
                                </text>
                              </g>
                            );
                          })}
                          {areaPoints && (
                            <polygon points={areaPoints} fill="rgba(37, 99, 235, 0.10)" />
                          )}
                          {coords.length > 1 && (
                            <polyline
                              fill="none"
                              stroke="#2563EB"
                              strokeWidth="2.25"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              points={linePoints}
                            />
                          )}
                          {coords.map((c) => (
                            <g key={c.cycleId}>
                              <circle
                                cx={c.x}
                                cy={c.y}
                                r={c.isCurrent ? 5 : 3.75}
                                fill={c.isCurrent ? '#2563EB' : '#ffffff'}
                                stroke="#2563EB"
                                strokeWidth="2"
                              />
                              <text
                                x={c.x}
                                y={Math.max(11, c.y - 9)}
                                textAnchor="middle"
                                fill="#0f172a"
                                className="dark:fill-slate-100"
                                fontSize="9.5"
                                fontWeight="700"
                                fontFamily="var(--font-mono), monospace"
                              >
                                {c.avgScore}%
                              </text>
                              <text
                                x={c.x}
                                y={h - 16}
                                textAnchor="middle"
                                fill="#475569"
                                className="dark:fill-slate-300"
                                fontSize="8.5"
                                fontWeight={c.isCurrent ? '700' : '500'}
                              >
                                {c.shortLabel}
                              </text>
                              <text
                                x={c.x}
                                y={h - 5}
                                textAnchor="middle"
                                fill="#2563EB"
                                fontSize="8"
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

                  {/* Graph 2: Subject-by-Subject Progress vs Previous Exam */}
                  {reportCardData.subjectComparison.length > 0 && reportCardData.previousCyclePoint && (
                    <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                      <div className="mb-2 flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                          Subject Progress vs {reportCardData.previousCyclePoint.shortLabel}
                        </span>
                        <span className="flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                          <span className="inline-flex items-center gap-1">
                            <span className="inline-block h-2 w-2 bg-slate-400" />
                            Prior
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <span className="inline-block h-2 w-2 bg-blue-600" />
                            Current
                          </span>
                        </span>
                      </div>
                      <div className="space-y-2">
                        {reportCardData.subjectComparison.map((item) => (
                          <div key={item.subject} className="space-y-0.5">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="truncate font-medium text-slate-700 dark:text-slate-200">
                                {item.subject}
                              </span>
                              <span className="shrink-0 font-mono text-[10px] tabular-nums">
                                <span className="text-slate-500 dark:text-slate-400">
                                  {item.previousScore !== null ? `${item.previousScore}% → ` : ''}
                                </span>
                                <strong className="text-slate-900 dark:text-slate-100">
                                  {item.currentScore}%
                                </strong>
                                {item.delta !== null && (
                                  <span
                                    className={`ml-1.5 font-semibold ${
                                      item.delta > 0
                                        ? 'text-emerald-700 dark:text-emerald-400'
                                        : item.delta < 0
                                        ? 'text-rose-600 dark:text-rose-400'
                                        : 'text-slate-500'
                                    }`}
                                  >
                                    ({item.delta > 0 ? `+${item.delta}` : item.delta})
                                  </span>
                                )}
                              </span>
                            </div>
                            <svg
                              viewBox="0 0 260 12"
                              className="h-3 w-full"
                              role="img"
                              aria-label={`${item.subject} comparison bar`}
                            >
                              <rect x="0" y="1" width="260" height="4" rx="2" fill="#e2e8f0" />
                              {item.previousScore !== null && (
                                <rect
                                  x="0"
                                  y="1"
                                  width={Math.max(4, (Math.min(100, item.previousScore) / 100) * 260)}
                                  height="4"
                                  rx="2"
                                  fill="#94a3b8"
                                />
                              )}
                              <rect x="0" y="7" width="260" height="4" rx="2" fill="#e2e8f0" />
                              <rect
                                x="0"
                                y="7"
                                width={Math.max(4, (Math.min(100, item.currentScore) / 100) * 260)}
                                height="4"
                                rx="2"
                                fill="#2563EB"
                              />
                            </svg>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Compact Cycle History Strip */}
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {reportCardData.progressionPoints.map((pt) => (
                    <div
                      key={pt.cycleId}
                      className={`rounded-md border px-2.5 py-1.5 text-[11px] ${
                        pt.isCurrent
                          ? 'border-blue-300 bg-blue-50/70 dark:border-blue-800 dark:bg-blue-950/30'
                          : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate font-semibold text-slate-800 dark:text-slate-100">
                          {pt.title}
                        </span>
                        <span className="shrink-0 font-mono font-bold text-blue-700 dark:text-blue-400">
                          {pt.meanGrade}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between font-mono text-[10px] text-slate-500 tabular-nums dark:text-slate-400">
                        <span>
                          {pt.totalMarks}/{pt.maxPossible} ({pt.avgScore}%)
                        </span>
                        {pt.deltaFromPrev !== null && (
                          <span
                            className={
                              pt.deltaFromPrev > 0
                                ? 'font-semibold text-emerald-700 dark:text-emerald-400'
                                : pt.deltaFromPrev < 0
                                ? 'font-semibold text-rose-600 dark:text-rose-400'
                                : ''
                            }
                          >
                            {pt.deltaFromPrev > 0 ? `+${pt.deltaFromPrev}%` : `${pt.deltaFromPrev}%`}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Class WhatsApp Report Card Dispatch Queue Modal */}
      {showWhatsAppQueueModal && activeCycle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4">
          <div className="my-6 w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-slate-100">
                  <MessageCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  Send Class Report Cards via WhatsApp
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {selectedGrade} · {activeCycle.title} · Guardian phone numbers pulled directly from Admissions records
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowWhatsAppQueueModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 divide-y divide-slate-200 lg:grid-cols-12 lg:divide-x lg:divide-y-0 dark:divide-slate-800">
              {/* Left: Class Roster & Admissions Phone Numbers */}
              <div className="flex max-h-[540px] flex-col lg:col-span-7">
                <div className="border-b border-slate-200 p-3.5 dark:border-slate-800">
                  <div className="relative">
                    <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={queueSearch}
                      onChange={(e) => setQueueSearch(e.target.value)}
                      placeholder="Filter by student, code, guardian name, or phone..."
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pr-3 pl-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                </div>

                <div className="flex-1 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
                  {classWhatsAppQueue.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                      No students in {selectedGrade} match the current filter.
                    </div>
                  ) : (
                    classWhatsAppQueue.map((item) => {
                      const stu = item.row.student;
                      const isSelected = activeQueueItem?.row.student.id === stu.id;
                      return (
                        <div
                          key={stu.id}
                          onClick={() => setQueueSelectedStudentId(stu.id)}
                          className={`flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-xs transition-colors ${
                            isSelected
                              ? 'bg-emerald-50/70 dark:bg-emerald-950/25'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-900 dark:text-slate-100">
                                {stu.fullName}
                              </span>
                              <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                                {stu.studentCode}
                              </span>
                            </div>
                            <p className="mt-0.5 truncate text-[11px] text-slate-600 dark:text-slate-400">
                              Guardian: {item.contact.guardianName} ·{' '}
                              <span className="font-mono">
                                {item.contact.guardianPhone || 'Missing phone'}
                              </span>
                            </p>
                            <p className="mt-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                              Mean: {item.row.meanScore !== null ? `${item.row.meanScore}%` : '—'} · Grade:{' '}
                              {item.row.overallGrade}
                              {item.row.rank ? ` · Rank #${item.row.rank}` : ''}
                            </p>
                          </div>

                          <div className="flex shrink-0 items-center gap-2">
                            {item.dispatch && (
                              <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-300">
                                Sent {formatDateShort(item.dispatch.sentAt)}
                              </span>
                            )}
                            {item.waUrl ? (
                              <a
                                href={item.waUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void recordReportCardDispatch({
                                    studentId: stu.id,
                                    studentName: stu.fullName,
                                    guardianName: item.contact.guardianName,
                                    guardianPhone: item.contact.guardianPhone,
                                    messagePreview: item.message,
                                  });
                                }}
                                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-semibold text-white whitespace-nowrap hover:bg-emerald-700"
                              >
                                <MessageCircle className="h-3 w-3" />
                                Send
                              </a>
                            ) : (
                              <span className="text-[11px] text-amber-600 dark:text-amber-400">
                                No Phone
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Right: Live Report Card WhatsApp Message Preview */}
              <div className="flex flex-col justify-between bg-slate-50/70 p-5 lg:col-span-5 dark:bg-slate-950/40">
                {activeQueueItem ? (
                  <div className="flex h-full flex-col justify-between gap-4">
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          WhatsApp Message Preview
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            openReportCardModal(activeQueueItem.row.student.id, true)
                          }
                          className="text-[11px] font-semibold text-blue-600 hover:underline dark:text-blue-400"
                        >
                          Edit Phone / Remark
                        </button>
                      </div>
                      <p className="mt-1 text-xs font-semibold text-slate-900 dark:text-slate-100">
                        To: {activeQueueItem.contact.guardianName} (
                        <span className="font-mono">
                          {activeQueueItem.contact.guardianPhone || '—'}
                        </span>
                        )
                      </p>
                      <pre className="mt-3 max-h-[340px] overflow-y-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-white p-3.5 font-sans text-[11px] leading-relaxed text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                        {activeQueueItem.message}
                      </pre>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() =>
                          handleCopyText(
                            activeQueueItem.message,
                            `${activeQueueItem.row.student.fullName} report card`
                          )
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Copy Text
                      </button>

                      {activeQueueItem.waUrl && (
                        <a
                          href={activeQueueItem.waUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => {
                            void recordReportCardDispatch({
                              studentId: activeQueueItem.row.student.id,
                              studentName: activeQueueItem.row.student.fullName,
                              guardianName: activeQueueItem.contact.guardianName,
                              guardianPhone: activeQueueItem.contact.guardianPhone,
                              messagePreview: activeQueueItem.message,
                            });
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                          Send on WhatsApp
                        </a>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">Select a student to preview their report card message.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Exam Cycle Modal */}
      {showCycleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                Create Assessment Cycle
              </h2>
              <button
                onClick={() => setShowCycleModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreateCycle} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Assessment Type
                  </label>
                  <select
                    value={cycleForm.examType}
                    onChange={(e) => {
                      const nextType = e.target.value as
                        | (typeof STANDARD_ASSESSMENT_TYPES)[number]
                        | 'Custom';
                      const nextTitle =
                        nextType === 'Custom'
                          ? cycleForm.title
                          : `${cycleForm.term || 'Term 1'} ${nextType.replace(/^Term\s+/i, '')}`;
                      setCycleForm({
                        ...cycleForm,
                        examType: nextType,
                        title: nextTitle,
                      });
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {STANDARD_ASSESSMENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                    <option value="Custom">Custom Assessment</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Academic Term
                  </label>
                  <input
                    required
                    type="text"
                    value={cycleForm.term}
                    onChange={(e) => {
                      const nextTerm = e.target.value;
                      const nextTitle =
                        cycleForm.examType === 'Custom'
                          ? cycleForm.title
                          : `${nextTerm || 'Term 1'} ${cycleForm.examType.replace(/^Term\s+/i, '')}`;
                      setCycleForm({
                        ...cycleForm,
                        term: nextTerm,
                        title: nextTitle,
                      });
                    }}
                    placeholder="e.g. Term 1, Term 2"
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Cycle Title
                </label>
                <input
                  required
                  type="text"
                  value={cycleForm.title}
                  onChange={(e) => setCycleForm({ ...cycleForm, title: e.target.value })}
                  placeholder="e.g. Term 2 Opening Exam"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Start Date
                  </label>
                  <input
                    required
                    type="date"
                    value={cycleForm.startDate}
                    onChange={(e) => setCycleForm({ ...cycleForm, startDate: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    End Date
                  </label>
                  <input
                    required
                    type="date"
                    value={cycleForm.endDate}
                    onChange={(e) => setCycleForm({ ...cycleForm, endDate: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCycleModal(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Create Cycle
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
