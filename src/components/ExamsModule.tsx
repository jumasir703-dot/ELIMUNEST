import { useMemo, useState } from 'react';
import { Award, CheckCircle2, FileSpreadsheet, FileText, Plus, Printer, Trophy, X } from 'lucide-react';
import { saasApi } from '../lib/api';
import { computeClientGrade } from '../lib/format';
import {
  ALL_REGISTERED_SUBJECTS_OPTION,
  CBE_GRADING_SCALE,
  getAssessmentGradingSystem,
  getClusterForGrade,
  getSubjectsForGrade,
  is844FormFourGrade,
  KCSE_844_GRADING_SCALE,
  KENYAN_CBC_CLUSTERS,
  STANDARD_ASSESSMENT_TYPES,
  type TenantWorkspaceData,
  type UserRole,
} from '../shared/types';
import { ExamResultsEntryPanel } from './ExamResultsEntryPanel';

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
  const { tenant, students, examCycles, examResults } = workspace;
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
        return {
          ...r,
          letterGrade: graded.letterGrade,
          gpaPoints: graded.gpaPoints,
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
    };
  }, [reportCardStudentId, activeCycle, students, examResults, allSubjectsRankedRows]);

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
                        <button
                          onClick={() => setReportCardStudentId(row.student.id)}
                          className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                        >
                          <FileText className="h-3.5 w-3.5" />
                          Report Card
                        </button>
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
                          <button
                            onClick={() => setReportCardStudentId(row.student.id)}
                            className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                          >
                            <FileText className="h-3.5 w-3.5" />
                            Report Card
                          </button>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  {tenant.name} · {activeCycle.title} · {reportCardData.studentSystemLabel}
                </p>
                <h2 className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-100">
                  Academic Report Card — {reportCardData.student.fullName}
                </h2>
                <p className="mt-0.5 font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
                  {reportCardData.student.studentCode} · {reportCardData.student.grade} Stream{' '}
                  {reportCardData.student.section}
                </p>
              </div>
              <div className="flex items-center gap-2 no-print">
                <button
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print
                </button>
                <button
                  onClick={() => setReportCardStudentId(null)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

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
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {reportCardData.results.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-xs text-slate-500">
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
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
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
