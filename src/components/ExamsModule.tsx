import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  Award,
  BarChart3,
  CheckCircle2,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  Lock,
  MessageCircle,
  Phone,
  Plus,
  Printer,
  Search,
  Trophy,
  Unlock,
  X,
} from 'lucide-react';
import { saasApi } from '../lib/api';
import { createBrandedWorksheetFromObjects } from '../lib/documentBranding';
import {
  buildBroadsheetRows,
  buildGradeAnalyticsReport,
  isNonSatExamResult,
  resolveSubjectTeacher,
  shortenCycleTitle,
  sortExamCyclesChronologically,
} from '../lib/examAnalytics';
import { computeClientGrade, formatDateShort } from '../lib/format';
import {
  buildReportCardWhatsAppMessage,
  buildWhatsAppUrl,
  resolveStudentGuardianContact,
} from '../lib/whatsapp';
import {
  ALL_REGISTERED_SUBJECTS_OPTION,
  CBE_GRADING_SCALE,
  getAssessmentGradingSystem,
  getClusterForGrade,
  getStreamsForGrade,
  getSubjectsForGrade,
  is844FormFourGrade,
  KCSE_844_GRADING_SCALE,
  KENYAN_CBC_CLUSTERS,
  STANDARD_ASSESSMENT_TYPES,
  type ExamResultStatus,
  type TenantWorkspaceData,
  type UserRole,
} from '../shared/types';
import {
  ExamResultsEntryPanel,
  type ExamEntryPrefillTarget,
} from './ExamResultsEntryPanel';
import { TenantDocumentHeader } from './TenantDocumentHeader';
import { ZerakiExamAnalyticsPanel } from './ZerakiExamAnalyticsPanel';

interface ExamsModuleProps {
  workspace: TenantWorkspaceData;
  currentRole?: UserRole;
  readOnly?: boolean;
  onRefresh: () => Promise<void>;
  onNotify: (title: string, tone?: 'success' | 'error') => void;
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
  readOnly = false,
  onRefresh,
  onNotify,
}: ExamsModuleProps) {
  const { tenant, students, admissions, examCycles, examResults, timetable } = workspace;
  const whatsappDispatches = workspace.whatsappDispatches || [];
  const defaultGrade = tenant.grades.includes('Grade 9') ? 'Grade 9' : tenant.grades[0] || 'Grade 9';

  const orderedCycles = useMemo(
    () => sortExamCyclesChronologically(examCycles),
    [examCycles]
  );

  const [activeTab, setActiveTab] = useState<'results' | 'analytics' | 'entry'>('results');
  const [selectedCycleId, setSelectedCycleId] = useState<string>(
    orderedCycles.find((c) => /mid[- ]?term/i.test(c.title))?.id || orderedCycles[0]?.id || ''
  );
  const [selectedGrade, setSelectedGrade] = useState<string>(defaultGrade);
  const [selectedStream, setSelectedStream] = useState<string>('All');
  const [selectedSubject, setSelectedSubject] = useState<string>(ALL_REGISTERED_SUBJECTS_OPTION);
  const [kcseBest7Mode, setKcseBest7Mode] = useState<boolean>(true);
  const [entryPrefillTarget, setEntryPrefillTarget] = useState<ExamEntryPrefillTarget | null>(
    null
  );
  const [draftScores, setDraftScores] = useState<Record<string, string>>({});
  const [savingStudentId, setSavingStudentId] = useState<string | null>(null);
  const [reportCardStudentId, setReportCardStudentId] = useState<string | null>(null);
  const [reportCardWhatsAppOpen, setReportCardWhatsAppOpen] = useState(false);
  const [whatsAppPhoneOverride, setWhatsAppPhoneOverride] = useState('');
  const [whatsAppCustomNote, setWhatsAppCustomNote] = useState('');
  const [showWhatsAppQueueModal, setShowWhatsAppQueueModal] = useState(false);
  const [queueSearch, setQueueSearch] = useState('');
  const [queueStreamFilter, setQueueStreamFilter] = useState<string>('All');
  const [queueSelectedStudentId, setQueueSelectedStudentId] = useState<string | null>(null);
  const isAdminRole =
    !readOnly &&
    (currentRole === 'Admin' || currentRole === 'Super Admin' || currentRole === 'Developer');
  const isParentRole = currentRole === 'Parent' || currentRole === 'Student';
  const isReadOnlyViewer = Boolean(readOnly) || isParentRole;

  const [showCycleModal, setShowCycleModal] = useState(false);
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [unlockReason, setUnlockReason] = useState('');
  const [unlockingCycle, setUnlockingCycle] = useState(false);

  const availableStreams = useMemo(
    () => getStreamsForGrade(tenant, selectedGrade),
    [tenant, selectedGrade]
  );
  const effectiveStreamFilter =
    selectedStream === 'All' || availableStreams.includes(selectedStream)
      ? selectedStream
      : 'All';

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

  const activeCycleTerm = useMemo(() => {
    const terms = workspace.academicTerms || [];
    if (!activeCycle) {
      return (
        terms.find(
          (t) => t.isCurrent || t.name.toLowerCase() === tenant.currentTerm.toLowerCase()
        ) || null
      );
    }
    return (
      terms.find(
        (t) =>
          (activeCycle.termId && t.id === activeCycle.termId) ||
          t.name.toLowerCase() === activeCycle.term.toLowerCase()
      ) || null
    );
  }, [activeCycle, workspace.academicTerms, tenant.currentTerm]);

  const isCycleTermClosed = activeCycleTerm?.status === 'Closed';

  const previousCycle = useMemo(() => {
    if (!activeCycle) return null;
    const idx = orderedCycles.findIndex((c) => c.id === activeCycle.id);
    return idx > 0 ? orderedCycles[idx - 1] : null;
  }, [orderedCycles, activeCycle]);

  const gradeStudents = useMemo(
    () =>
      students.filter(
        (s) =>
          s.grade === selectedGrade &&
          s.status === 'Active' &&
          (effectiveStreamFilter === 'All' || s.section === effectiveStreamFilter)
      ),
    [students, selectedGrade, effectiveStreamFilter]
  );

  // Build single-subject gradebook rows with CBE / 8-4-4 grades & ranking (never clamps invalid scores)
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
      const existingStatus: ExamResultStatus = existing
        ? existing.resultStatus ||
          (existing.letterGrade === 'ABS'
            ? 'Absent'
            : existing.letterGrade === 'EXM'
            ? 'Exempt'
            : 'Scored')
        : 'Scored';
      const isNonSat = Boolean(existing && isNonSatExamResult(existing));
      const rawInput = draftScores[`${stu.id}:${effectiveSubject}`];

      let numericScore: number | null = null;
      let isInvalid = false;
      if (rawInput !== undefined) {
        const trimmed = rawInput.trim();
        if (trimmed !== '') {
          const parsed = Number(trimmed);
          if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
            isInvalid = true;
          } else {
            numericScore = Math.round(parsed);
          }
        }
      } else if (existing && !isNonSat) {
        numericScore = existing.score;
      }

      const computed =
        !isNonSat && numericScore !== null ? computeClientGrade(numericScore, stu.grade) : null;
      return {
        student: stu,
        existing,
        existingStatus,
        isNonSat,
        isInvalid,
        score: numericScore,
        letterGrade: isNonSat
          ? existingStatus === 'Exempt'
            ? 'EXM'
            : 'ABS'
          : isInvalid
          ? 'ERR'
          : computed?.letterGrade ?? '—',
        gpaPoints: isNonSat ? null : computed?.gpaPoints ?? null,
        remarks: existing?.remarks || '',
      };
    });

    const sortedScores = rows
      .filter((r) => !r.isNonSat && !r.isInvalid && r.score !== null)
      .map((r) => r.score as number)
      .sort((a, b) => b - a);

    return rows.map((row) => ({
      ...row,
      rank: !row.isNonSat && !row.isInvalid && row.score !== null ? sortedScores.indexOf(row.score) + 1 : null,
    }));
  }, [isAllSubjectsMode, gradeStudents, examResults, activeCycle, effectiveSubject, draftScores]);

  // Build All Registered Subjects mark-summation rows (with deviation, KCSE Best-7 & stream ranking)
  const allSubjectsRankedRows = useMemo(() => {
    const cycleId = activeCycle?.id || '';
    const fullGradeStudents = students.filter(
      (s) => s.grade === selectedGrade && s.status === 'Active'
    );
    const broadsheet = buildBroadsheetRows({
      students: fullGradeStudents,
      examResults,
      levelSubjects,
      activeCycleId: cycleId,
      baselineCycleId: previousCycle?.id || null,
      grade: selectedGrade,
    });

    const filtered =
      effectiveStreamFilter === 'All'
        ? broadsheet
        : broadsheet.filter((r) => r.student.section === effectiveStreamFilter);

    const useBest7Ranking = is844 && kcseBest7Mode;
    const ordered = useBest7Ranking
      ? [...filtered].sort((a, b) => {
          if ((a.subjectsSat > 0) !== (b.subjectsSat > 0)) return a.subjectsSat > 0 ? -1 : 1;
          const ptsDiff = (b.kcseBest7?.totalPoints ?? -1) - (a.kcseBest7?.totalPoints ?? -1);
          if (ptsDiff !== 0) return ptsDiff;
          return (b.totalScore ?? 0) - (a.totalScore ?? 0);
        })
      : filtered;

    return ordered.map((row) => ({
      ...row,
      displayRank:
        effectiveStreamFilter !== 'All'
          ? row.streamRank
          : useBest7Ranking
          ? row.best7Rank ?? row.rank
          : row.rank,
    }));
  }, [
    students,
    selectedGrade,
    examResults,
    activeCycle,
    previousCycle,
    levelSubjects,
    effectiveStreamFilter,
    is844,
    kcseBest7Mode,
  ]);

  const gradeAnalyticsSummary = useMemo(
    () =>
      buildGradeAnalyticsReport({
        workspace,
        cycleId: activeCycle?.id || '',
        baselineCycleId: previousCycle?.id || null,
        grade: selectedGrade,
        streamFilter: effectiveStreamFilter,
      }),
    [workspace, activeCycle?.id, previousCycle?.id, selectedGrade, effectiveStreamFilter]
  );

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
        highestLabel:
          is844 && kcseBest7Mode && topStudent.kcseBest7
            ? `${topStudent.kcseBest7.totalPoints}/${topStudent.kcseBest7.maxPoints} pts (${topStudent.kcseBest7.meanGrade})`
            : `${topStudent.totalScore} / ${topStudent.maxPossible} (${topStudent.overallGrade})`,
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
  }, [isAllSubjectsMode, allSubjectsRankedRows, singleSubjectRows, is844, kcseBest7Mode]);

  function handleExportMeritListExcel() {
    if (!activeCycle) return;
    const scopeLabel =
      effectiveStreamFilter === 'All' ? 'All Streams' : `Stream ${effectiveStreamFilter}`;

    const rows = allSubjectsRankedRows.map((row) => {
      const rec: Record<string, string | number> = {
        Rank: row.displayRank ? `#${row.displayRank}` : '—',
        'Adm No': row.student.studentCode,
        'Student Name': row.student.fullName,
        Stream: `Stream ${row.student.section}`,
        'Subjects Sat': `${row.subjectsSat}/${row.registeredCount}`,
        'Total Marks': row.subjectsSat > 0 ? `${row.totalScore}/${row.maxPossible}` : '—',
        'Mean (%)': row.meanScore !== null ? row.meanScore : '—',
        'Mean Grade': row.overallGrade,
        [`Points (/${maxPoints})`]: row.meanPoints !== null ? row.meanPoints : '—',
      };
      if (is844) {
        rec['KCSE Best-7 (/84)'] = row.kcseBest7 ? row.kcseBest7.totalPoints : '—';
        rec['Best-7 Grade'] = row.kcseBest7 ? row.kcseBest7.meanGrade : '—';
      }
      rec['Dev vs Prior (%)'] =
        row.meanDeviation !== null
          ? row.meanDeviation > 0
            ? `+${row.meanDeviation}%`
            : `${row.meanDeviation}%`
          : '—';
      return rec;
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      createBrandedWorksheetFromObjects(
        tenant,
        `${activeCycle.title} — Merit List (${selectedGrade} · ${scopeLabel})`,
        rows
      ),
      'Merit List'
    );
    const safeName = `${tenant.slug}-${activeCycle.title}-${selectedGrade}-${scopeLabel}-merit`
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .toLowerCase();
    XLSX.writeFile(wb, `${safeName}.xlsx`);
    onNotify(`Downloaded branded Merit List for ${selectedGrade} (${scopeLabel}).`);
  }

  async function saveScore(
    studentId: string,
    rawVal: string,
    resultStatus: ExamResultStatus = 'Scored'
  ) {
    if (!activeCycle || isAllSubjectsMode || isReadOnlyViewer) return;
    if (isCycleTermClosed) {
      onNotify(
        `Term "${activeCycleTerm?.name || activeCycle.term}" is Closed. Reopen the term in School Settings before editing marks.`,
        'error'
      );
      return;
    }
    if (activeCycle.status === 'Published') {
      onNotify(
        `Exam cycle "${activeCycle.title}" is Published and locked. An Admin must unlock it first.`,
        'error'
      );
      return;
    }

    let scoreToSend: number | null = null;
    if (resultStatus === 'Scored') {
      const trimmed = rawVal.trim();
      if (trimmed === '') return;
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        onNotify('Invalid mark: enter a numeric score between 0 and 100.', 'error');
        return;
      }
      scoreToSend = Math.round(parsed);
    }

    setSavingStudentId(studentId);
    try {
      await saasApi.upsertExamScore(tenant.id, {
        examCycleId: activeCycle.id,
        studentId,
        subject: effectiveSubject,
        score: scoreToSend,
        resultStatus,
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

  async function handleUnlockCycle(e: React.FormEvent) {
    e.preventDefault();
    if (!activeCycle) return;
    const cleanReason = unlockReason.trim();
    if (!cleanReason) {
      onNotify('Provide an audit reason before unlocking a published exam cycle.', 'error');
      return;
    }
    setUnlockingCycle(true);
    try {
      await saasApi.unlockExamCycle(tenant.id, activeCycle.id, cleanReason);
      await onRefresh();
      setShowUnlockModal(false);
      setUnlockReason('');
      onNotify(`${activeCycle.title} unlocked for editing (audit logged).`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to unlock cycle', 'error');
    } finally {
      setUnlockingCycle(false);
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
      .filter(
        (row) => queueStreamFilter === 'All' || row.student.section === queueStreamFilter
      )
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
        const totalRanked = allSubjectsRankedRows.filter((r) => r.displayRank !== null).length;
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
          overallRank: row.displayRank,
          totalRanked,
        });
        const smsDigest = `${tenant.name}: ${stu.fullName} (${stu.studentCode}, ${stu.grade} ${stu.section}) ${activeCycle.title} - Total ${row.totalScore}/${row.maxPossible} (${row.meanScore ?? 0}%), Grade ${row.overallGrade}, Pos ${row.displayRank ? `#${row.displayRank}/${totalRanked}` : 'Pending'}.`;
        const waUrl = buildWhatsAppUrl(contact.guardianPhone, message);
        const dispatch = reportCardDispatchesByStudent.get(stu.id) || null;
        return {
          row,
          contact,
          resultsCount: results.length,
          message,
          smsDigest,
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
    queueStreamFilter,
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
        const nonSat = isNonSatExamResult(r);
        const status: ExamResultStatus =
          r.resultStatus ||
          (r.letterGrade === 'ABS' ? 'Absent' : r.letterGrade === 'EXM' ? 'Exempt' : 'Scored');
        const graded = nonSat ? null : computeClientGrade(r.score, student.grade);
        const teacherInfo = resolveSubjectTeacher(tenant, timetable, student, r.subject);
        return {
          ...r,
          resultStatus: status,
          isNonSat: nonSat,
          letterGrade: nonSat ? (status === 'Exempt' ? 'EXM' : 'ABS') : graded!.letterGrade,
          gpaPoints: nonSat ? 0 : graded!.gpaPoints,
          teacherName: teacherInfo.name,
          teacherInitials: teacherInfo.initials,
        };
      });
    const scoredResults = results.filter((r) => !r.isNonSat);
    const totalMarks = scoredResults.reduce((sum, r) => sum + r.score, 0);
    const maxPossible = scoredResults.reduce((sum, r) => sum + (r.maxScore || 100), 0);
    const avgScore =
      maxPossible > 0 ? Math.round((totalMarks / maxPossible) * 1000) / 10 : 0;
    const overallGradeInfo =
      scoredResults.length > 0 ? computeClientGrade(avgScore, student.grade) : null;
    const rankRow = allSubjectsRankedRows.find((r) => r.student.id === student.id);
    const totalRanked = allSubjectsRankedRows.filter((r) => r.rank !== null).length;

    // Build chronological progression across exam cycles up to and including the active cycle
    const activeCycleIdx = orderedCycles.findIndex((c) => c.id === activeCycle.id);
    const candidateCycles =
      activeCycleIdx >= 0 ? orderedCycles.slice(0, activeCycleIdx + 1) : orderedCycles;
    const rawProgression = candidateCycles
      .map((cycle) => {
        const cycleResults = examResults.filter(
          (r) => r.examCycleId === cycle.id && r.studentId === student.id && !isNonSatExamResult(r)
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

    const subjectComparison = scoredResults.map((r) => {
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
            Exams &amp; Assessment
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Kenyan CBE (EE1–BE2) &amp; Form 4 8-4-4 KCSE (A–E) grading, stream comparison, grade distribution matrix, value-added deviation tracking, and merit broadsheets.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setActiveTab('results')}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === 'results'
                  ? 'bg-slate-900 text-white dark:bg-blue-600'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Results &amp; Merit List
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('analytics')}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === 'analytics'
                  ? 'bg-slate-900 text-white dark:bg-blue-600'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              Class Analytics
            </button>
            {!isReadOnlyViewer && (
              <button
                type="button"
                onClick={() => setActiveTab('entry')}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === 'entry'
                    ? 'bg-slate-900 text-white dark:bg-blue-600'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Exam Results Entry
              </button>
            )}
          </div>
          {!isReadOnlyViewer && (
            <button
              onClick={() => {
                setQueueStreamFilter(effectiveStreamFilter);
                setQueueSelectedStudentId(gradeStudents[0]?.id || null);
                setShowWhatsAppQueueModal(true);
              }}
              disabled={!activeCycle || gradeStudents.length === 0}
              className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/70"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              WhatsApp &amp; SMS Dispatch
            </button>
          )}
          {!isReadOnlyViewer && (
            <button
              onClick={() => setShowCycleModal(true)}
              className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Plus className="h-3.5 w-3.5" />
              New Exam Cycle
            </button>
          )}
          {activeTab !== 'entry' && activeCycle && isAdminRole && activeCycle.status !== 'Published' && (
            <button
              onClick={handlePublishCycle}
              disabled={isCycleTermClosed}
              title={
                isCycleTermClosed
                  ? `Term ${activeCycleTerm?.name || activeCycle.term} is Closed`
                  : undefined
              }
              className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Publish Results
            </button>
          )}
          {activeTab !== 'entry' && activeCycle && isAdminRole && activeCycle.status === 'Published' && (
            <button
              type="button"
              disabled={isCycleTermClosed}
              title={
                isCycleTermClosed
                  ? `Reopen ${activeCycleTerm?.name || activeCycle.term} in School Settings first`
                  : undefined
              }
              onClick={() => {
                setUnlockReason('');
                setShowUnlockModal(true);
              }}
              className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/70"
            >
              <Unlock className="h-3.5 w-3.5" />
              Unlock Cycle
            </button>
          )}
        </div>
      </div>

      {isCycleTermClosed && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
          <div>
            <strong>
              Term Locked ({activeCycleTerm?.name || activeCycle?.term || tenant.currentTerm} is Closed):
            </strong>{' '}
            Exam score edits, publishing, and cycle unlocks for this term are locked. A School Admin can reopen the term in <strong>School Settings → Academic Calendar</strong>.
          </div>
        </div>
      )}

      {activeTab === 'entry' && !isReadOnlyViewer ? (
        <ExamResultsEntryPanel
          workspace={workspace}
          currentRole={currentRole}
          prefillTarget={entryPrefillTarget}
          onRefresh={onRefresh}
          onNotify={onNotify}
          onViewResults={(cycleId, grade) => {
            setSelectedCycleId(cycleId);
            setSelectedGrade(grade);
            setSelectedStream('All');
            setSelectedSubject(ALL_REGISTERED_SUBJECTS_OPTION);
            setActiveTab('results');
          }}
        />
      ) : activeTab === 'analytics' ? (
        <ZerakiExamAnalyticsPanel
          workspace={workspace}
          selectedCycleId={activeCycle?.id || ''}
          selectedGrade={selectedGrade}
          onChangeCycle={(cid) => setSelectedCycleId(cid)}
          onChangeGrade={(g) => {
            setSelectedGrade(g);
            setSelectedStream('All');
          }}
          onJumpToMarkEntry={(target) => {
            if (isReadOnlyViewer) {
              onNotify('Read-Only access: exam score entry is disabled.', 'error');
              return;
            }
            setEntryPrefillTarget({
              ...target,
              requestKey: Date.now(),
            });
            setActiveTab('entry');
          }}
          onOpenReportCard={(studentId) => openReportCardModal(studentId, false)}
          onNotify={onNotify}
        />
      ) : (
        <>
      {/* Filters & Cycle Summary */}
      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2.5">
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
                setSelectedStream('All');
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
              aria-label="Select stream filter"
              value={effectiveStreamFilter}
              onChange={(e) => setSelectedStream(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="All">All Streams ({availableStreams.join(', ')})</option>
              {availableStreams.map((st) => (
                <option key={st} value={st}>
                  Stream {st}
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
                All Registered Subjects (Mark Summation &amp; Ranking)
              </option>
              {levelSubjects.map((sub) => (
                <option key={sub} value={sub}>
                  {sub}
                </option>
              ))}
            </select>

            {is844 && isAllSubjectsMode && (
              <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => setKcseBest7Mode(true)}
                  className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    kcseBest7Mode
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                  }`}
                >
                  KCSE Best-7 (/84)
                </button>
                <button
                  type="button"
                  onClick={() => setKcseBest7Mode(false)}
                  className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    !kcseBest7Mode
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                  }`}
                >
                  Full Summation
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {isAllSubjectsMode && (
              <button
                type="button"
                onClick={handleExportMeritListExcel}
                disabled={!activeCycle || allSubjectsRankedRows.length === 0}
                className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <Download className="h-3.5 w-3.5" />
                Export Merit (.xlsx)
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveTab('analytics')}
              className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border border-blue-200 bg-blue-50/70 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-800/70 dark:bg-blue-950/40 dark:text-blue-300"
            >
              <BarChart3 className="h-3.5 w-3.5" />
              Grade Matrix &amp; Streams
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 text-xs text-slate-600 tabular-nums dark:border-slate-800 dark:text-slate-400">
          <div className="flex flex-wrap items-center gap-4">
            <span>
              Class Mean:{' '}
              <strong className="font-mono text-slate-900 dark:text-slate-100">
                {classStats.mean}%
              </strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {isAllSubjectsMode ? 'Top Performance:' : 'High Score:'}{' '}
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
            {previousCycle && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  Deviation Δ vs{' '}
                  <strong className="text-slate-800 dark:text-slate-200">
                    {shortenCycleTitle(previousCycle.title)}
                  </strong>
                </span>
              </>
            )}
          </div>

          {gradeAnalyticsSummary.totalMissingCells > 0 && (
            <button
              type="button"
              onClick={() => setActiveTab('analytics')}
              className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold text-amber-700 hover:underline dark:text-amber-400"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {gradeAnalyticsSummary.totalMissingCells} missing score(s) across{' '}
              {gradeAnalyticsSummary.missingMarksByStudent.length} learner(s)
            </button>
          )}
        </div>

        {(activeCycle?.status === 'Published' || (activeCycle?.unlockHistory && activeCycle.unlockHistory.length > 0)) && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5 text-xs dark:border-slate-800">
            {activeCycle.status === 'Published' ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
                <Lock className="h-3.5 w-3.5" />
                Published &amp; Locked — marks cannot be modified unless unlocked by a School Admin.
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
                <Unlock className="h-3.5 w-3.5" />
                Unlocked for editing
              </span>
            )}
            {activeCycle.unlockHistory && activeCycle.unlockHistory.length > 0 && (
              <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                Last unlocked by {activeCycle.unlockHistory[0].unlockedBy} ({formatDateShort(activeCycle.unlockHistory[0].unlockedAt)}): &ldquo;{activeCycle.unlockHistory[0].reason}&rdquo;
              </span>
            )}
          </div>
        )}
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
              ? 'Only Grade 12 (Form 4) uses 8-4-4 KCSE grades & Best-7 points (/84)'
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
                  <th className="px-4 py-3 text-right">Sat</th>
                  <th className="px-4 py-3 text-right">Total Marks</th>
                  <th className="px-4 py-3 text-right">Mean (%)</th>
                  {is844 && <th className="px-4 py-3 text-right">Best-7</th>}
                  <th className="px-4 py-3 text-right">
                    {is844 ? 'Grade' : 'CBE Level'}
                  </th>
                  <th className="px-4 py-3 text-right">Pts (/{maxPoints})</th>
                  <th className="px-4 py-3 text-right">Dev Δ</th>
                  <th className="px-4 py-3 text-right">Transcript</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {allSubjectsRankedRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={is844 ? 11 : 10}
                      className="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400"
                    >
                      No active students enrolled in {selectedGrade}
                      {effectiveStreamFilter !== 'All'
                        ? ` Stream ${effectiveStreamFilter}`
                        : ''}
                      .
                    </td>
                  </tr>
                ) : (
                  allSubjectsRankedRows.map((row) => (
                    <tr key={row.student.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                      <td className="px-4 py-3 font-mono text-xs font-bold text-slate-900 tabular-nums dark:text-slate-100">
                        {row.displayRank ? `#${row.displayRank}` : '—'}
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
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                        <span
                          className={
                            row.missingSubjects.length > 0
                              ? 'font-semibold text-amber-700 dark:text-amber-400'
                              : 'text-slate-600 dark:text-slate-400'
                          }
                          title={
                            row.missingSubjects.length > 0
                              ? `Missing: ${row.missingSubjects.join(', ')}`
                              : 'Complete'
                          }
                        >
                          {row.subjectsSat} / {row.registeredCount}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm font-bold text-slate-900 tabular-nums dark:text-slate-100">
                        {row.subjectsSat > 0 ? `${row.totalScore} / ${row.maxPossible}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs font-medium text-slate-700 tabular-nums dark:text-slate-300">
                        {row.meanScore !== null ? `${row.meanScore}%` : '—'}
                      </td>
                      {is844 && (
                        <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-blue-700 tabular-nums dark:text-blue-400">
                          {row.kcseBest7
                            ? `${row.kcseBest7.totalPoints}/${row.kcseBest7.maxPoints}`
                            : '—'}
                        </td>
                      )}
                      <td className="px-4 py-3 text-right font-mono text-xs font-bold tabular-nums">
                        <span className={getGradeBadgeColor(row.overallGrade, is844)}>
                          {row.overallGrade}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-slate-600 tabular-nums dark:text-slate-400">
                        {row.meanPoints !== null ? `${row.meanPoints.toFixed(1)} / ${maxPoints}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs font-semibold tabular-nums">
                        {row.meanDeviation === null ? (
                          <span className="text-slate-400">—</span>
                        ) : row.meanDeviation > 0 ? (
                          <span className="text-emerald-700 dark:text-emerald-400">
                            +{row.meanDeviation}%
                          </span>
                        ) : row.meanDeviation < 0 ? (
                          <span className="text-rose-600 dark:text-rose-400">
                            {row.meanDeviation}%
                          </span>
                        ) : (
                          <span className="text-slate-500">0.0%</span>
                        )}
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
                          {!isReadOnlyViewer && (
                            <button
                              type="button"
                              onClick={() => openReportCardModal(row.student.id, true)}
                              title={`Send report card via WhatsApp to guardian (${row.student.guardianPhone || 'admissions contact'})`}
                              className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
                            >
                              <MessageCircle className="h-3.5 w-3.5" />
                              {reportCardDispatchesByStudent.has(row.student.id) ? 'Sent ✓' : 'WhatsApp'}
                            </button>
                          )}
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
                    const cycleLocked =
                      activeCycle?.status === 'Published' || isCycleTermClosed || isReadOnlyViewer;
                    const inputVal =
                      draftScores[key] !== undefined
                        ? draftScores[key]
                        : row.existing && !row.isNonSat
                        ? String(row.existing.score)
                        : '';
                    const isDirty =
                      draftScores[key] !== undefined &&
                      draftScores[key].trim() !== '' &&
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
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              disabled={cycleLocked}
                              value={inputVal}
                              onChange={(e) =>
                                setDraftScores((prev) => ({ ...prev, [key]: e.target.value }))
                              }
                              onBlur={() => {
                                if (isDirty && !row.isInvalid) saveScore(row.student.id, inputVal, 'Scored');
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !row.isInvalid) saveScore(row.student.id, inputVal, 'Scored');
                              }}
                              placeholder={row.isNonSat ? row.letterGrade : '—'}
                              className={`w-20 rounded-md border bg-white px-2.5 py-1 font-mono text-sm text-slate-900 tabular-nums focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-60 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-900 ${
                                row.isInvalid
                                  ? 'border-red-500 ring-1 ring-red-500'
                                  : 'border-slate-200 focus:border-blue-600 dark:border-slate-700'
                              }`}
                            />
                            {!cycleLocked && (
                              <select
                                aria-label={`Status for ${row.student.fullName}`}
                                value={row.existingStatus}
                                disabled={savingStudentId === row.student.id}
                                onChange={(e) => {
                                  const nextStatus = e.target.value as ExamResultStatus;
                                  if (nextStatus === 'Absent' || nextStatus === 'Exempt') {
                                    void saveScore(row.student.id, '', nextStatus);
                                  } else if (inputVal.trim() !== '' && !row.isInvalid) {
                                    void saveScore(row.student.id, inputVal, 'Scored');
                                  }
                                }}
                                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                              >
                                <option value="Scored">Scored</option>
                                <option value="Absent">ABS</option>
                                <option value="Exempt">EXM</option>
                              </select>
                            )}
                            {row.isInvalid && (
                              <span className="text-[11px] font-semibold text-red-600 dark:text-red-400">
                                0–100 only
                              </span>
                            )}
                            {isDirty && !row.isInvalid && !cycleLocked && (
                              <button
                                type="button"
                                disabled={savingStudentId === row.student.id}
                                onClick={() => saveScore(row.student.id, inputVal, 'Scored')}
                                className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700"
                              >
                                Save
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold tabular-nums">
                          {row.isNonSat ? (
                            <span className="text-amber-700 dark:text-amber-400">
                              {row.letterGrade}
                            </span>
                          ) : row.isInvalid ? (
                            <span className="text-red-600 dark:text-red-400">Invalid</span>
                          ) : (
                            <span className={getGradeBadgeColor(row.letterGrade, is844)}>
                              {row.letterGrade}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-600 tabular-nums dark:text-slate-400">
                          {row.isNonSat ? 'Excluded' : row.gpaPoints !== null ? `${row.gpaPoints} / ${maxPoints}` : '—'}
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
                            {!isReadOnlyViewer && (
                              <button
                                type="button"
                                onClick={() => openReportCardModal(row.student.id, true)}
                                title={`Send report card via WhatsApp to guardian (${row.student.guardianPhone || 'admissions contact'})`}
                                className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
                              >
                                <MessageCircle className="h-3.5 w-3.5" />
                                {reportCardDispatchesByStudent.has(row.student.id) ? 'Sent ✓' : 'WhatsApp'}
                              </button>
                            )}
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
                          {r.isNonSat ? r.resultStatus : `${r.score} / ${r.maxScore}`}
                        </td>
                        <td className="py-2.5 text-right font-mono font-semibold text-slate-900 dark:text-slate-100">
                          {r.letterGrade}
                        </td>
                        <td className="py-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                          {r.isNonSat ? '—' : `${r.gpaPoints} / ${reportCardData.studentMaxPts}`}
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

      {/* Class WhatsApp & Bulk SMS Report Card Dispatch Queue Modal */}
      {showWhatsAppQueueModal && activeCycle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4">
          <div className="my-6 w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-slate-100">
                  <MessageCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  Send Class Report Cards via WhatsApp &amp; SMS
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {selectedGrade} · {activeCycle.title} · Guardian phone numbers pulled directly from Admissions records
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={classWhatsAppQueue.length === 0}
                  onClick={() => {
                    const text = classWhatsAppQueue
                      .map(
                        (item) =>
                          `${item.contact.guardianPhone || 'NO_PHONE'} | ${item.smsDigest}`
                      )
                      .join('\n');
                    void handleCopyText(text, 'Bulk SMS digest');
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy Bulk SMS List
                </button>
                <button
                  type="button"
                  disabled={classWhatsAppQueue.length === 0}
                  onClick={() => {
                    const rows = classWhatsAppQueue.map((item) => ({
                      'Adm No': item.row.student.studentCode,
                      'Student Name': item.row.student.fullName,
                      Stream: `Stream ${item.row.student.section}`,
                      Guardian: item.contact.guardianName,
                      Phone: item.contact.guardianPhone || 'Missing',
                      Mean: item.row.meanScore !== null ? `${item.row.meanScore}%` : '—',
                      Grade: item.row.overallGrade,
                      Rank: item.row.displayRank ? `#${item.row.displayRank}` : '—',
                      'SMS Digest': item.smsDigest,
                    }));
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(
                      wb,
                      createBrandedWorksheetFromObjects(
                        tenant,
                        `${activeCycle.title} — Guardian SMS/WhatsApp Dispatch (${selectedGrade})`,
                        rows
                      ),
                      'Dispatch List'
                    );
                    XLSX.writeFile(
                      wb,
                      `${tenant.slug}-${selectedGrade.replace(/\s+/g, '_').toLowerCase()}-sms-dispatch.xlsx`
                    );
                    onNotify(`Downloaded SMS/WhatsApp dispatch sheet for ${selectedGrade}.`);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export Dispatch (.xlsx)
                </button>
                <button
                  type="button"
                  onClick={() => setShowWhatsAppQueueModal(false)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 divide-y divide-slate-200 lg:grid-cols-12 lg:divide-x lg:divide-y-0 dark:divide-slate-800">
              {/* Left: Class Roster & Admissions Phone Numbers */}
              <div className="flex max-h-[540px] flex-col lg:col-span-7">
                <div className="flex items-center gap-2 border-b border-slate-200 p-3.5 dark:border-slate-800">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={queueSearch}
                      onChange={(e) => setQueueSearch(e.target.value)}
                      placeholder="Filter by student, code, guardian name, or phone..."
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pr-3 pl-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                  <select
                    aria-label="Filter dispatch queue by stream"
                    value={queueStreamFilter}
                    onChange={(e) => setQueueStreamFilter(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value="All">All Streams</option>
                    {availableStreams.map((st) => (
                      <option key={st} value={st}>
                        Stream {st}
                      </option>
                    ))}
                  </select>
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

      {/* Admin Unlock Published Cycle Modal */}
      {showUnlockModal && activeCycle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-100">
                <Unlock className="h-4 w-4 text-amber-600" />
                Unlock Published Exam Cycle
              </h2>
              <button
                type="button"
                onClick={() => setShowUnlockModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
              Unlocking <strong>{activeCycle.title}</strong> re-opens mark entry and score edits for teachers. This action is recorded in the cycle audit trail.
            </p>
            <form onSubmit={handleUnlockCycle} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Audit Reason (Required)
                </label>
                <textarea
                  rows={3}
                  required
                  value={unlockReason}
                  onChange={(e) => setUnlockReason(e.target.value)}
                  placeholder="e.g. Moderation remark entered for Grade 9 Mathematics Paper 2"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowUnlockModal(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={unlockingCycle || !unlockReason.trim()}
                  className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {unlockingCycle ? 'Unlocking...' : 'Confirm Unlock Cycle'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
