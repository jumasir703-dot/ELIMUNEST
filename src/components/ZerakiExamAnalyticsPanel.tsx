import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Award,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileSpreadsheet,
  GraduationCap,
  Layers,
  Printer,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';
import { createBrandedWorksheetFromObjects } from '../lib/documentBranding';
import {
  buildGradeAnalyticsReport,
  sortExamCyclesChronologically,
  type BroadsheetStudentRow,
} from '../lib/examAnalytics';
import {
  getStreamsForGrade,
  is844FormFourGrade,
  type ExamCycle,
  type TenantWorkspaceData,
} from '../shared/types';
import { TenantDocumentHeader } from './TenantDocumentHeader';

interface ZerakiExamAnalyticsPanelProps {
  workspace: TenantWorkspaceData;
  selectedCycleId: string;
  selectedGrade: string;
  onChangeCycle: (cycleId: string) => void;
  onChangeGrade: (grade: string) => void;
  onJumpToMarkEntry: (target: {
    cycleId: string;
    examTitle: string;
    grade: string;
    stream: string;
    subject: string;
  }) => void;
  onOpenReportCard: (studentId: string) => void;
  onNotify: (title: string, tone?: 'success' | 'error') => void;
}

type AnalyticsSubView = 'overview' | 'matrix' | 'teachers' | 'missing';

function getGradeTextColor(letterGrade: string, is844: boolean): string {
  if (letterGrade === '—') return 'text-slate-400 dark:text-slate-500';
  if (is844) {
    if (letterGrade === 'A' || letterGrade === 'A-') {
      return 'text-emerald-700 dark:text-emerald-400';
    }
    if (letterGrade.startsWith('B')) return 'text-blue-700 dark:text-blue-400';
    if (letterGrade.startsWith('D') || letterGrade === 'E') {
      return 'text-rose-600 dark:text-rose-400';
    }
    return 'text-slate-800 dark:text-slate-200';
  }
  if (letterGrade.startsWith('EE')) return 'text-emerald-700 dark:text-emerald-400';
  if (letterGrade.startsWith('ME')) return 'text-blue-700 dark:text-blue-400';
  if (letterGrade.startsWith('AE')) return 'text-amber-700 dark:text-amber-400';
  if (letterGrade.startsWith('BE')) return 'text-rose-600 dark:text-rose-400';
  return 'text-slate-800 dark:text-slate-200';
}

function formatDeviation(val: number | null, suffix = '%'): string {
  if (val === null) return '—';
  if (val > 0) return `+${val}${suffix}`;
  return `${val}${suffix}`;
}

function DeviationInline({
  value,
  suffix = '%',
}: {
  value: number | null;
  suffix?: string;
}) {
  if (value === null) {
    return <span className="font-mono text-xs text-slate-400 tabular-nums">—</span>;
  }
  if (value > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 font-mono text-xs font-semibold text-emerald-700 tabular-nums dark:text-emerald-400">
        <ArrowUpRight className="h-3 w-3 shrink-0" />
        +{value}
        {suffix}
      </span>
    );
  }
  if (value < 0) {
    return (
      <span className="inline-flex items-center gap-0.5 font-mono text-xs font-semibold text-rose-600 tabular-nums dark:text-rose-400">
        <ArrowDownRight className="h-3 w-3 shrink-0" />
        {value}
        {suffix}
      </span>
    );
  }
  return (
    <span className="font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
      0.0{suffix}
    </span>
  );
}

export function ZerakiExamAnalyticsPanel({
  workspace,
  selectedCycleId,
  selectedGrade,
  onChangeCycle,
  onChangeGrade,
  onJumpToMarkEntry,
  onOpenReportCard,
  onNotify,
}: ZerakiExamAnalyticsPanelProps) {
  const { tenant, examCycles } = workspace;
  const orderedCycles = useMemo(
    () => sortExamCyclesChronologically(examCycles),
    [examCycles]
  );

  const activeCycle = useMemo(
    () => orderedCycles.find((c) => c.id === selectedCycleId) || orderedCycles[0] || null,
    [orderedCycles, selectedCycleId]
  );

  const defaultBaselineId = useMemo(() => {
    if (!activeCycle) return '';
    const idx = orderedCycles.findIndex((c) => c.id === activeCycle.id);
    return idx > 0 ? orderedCycles[idx - 1].id : '';
  }, [orderedCycles, activeCycle]);

  const [baselineSelection, setBaselineSelection] = useState<string>('__AUTO__');
  const [streamFilter, setStreamFilter] = useState<string>('All');
  const [subView, setSubView] = useState<AnalyticsSubView>('overview');
  const [matrixMode, setMatrixMode] = useState<'subject' | 'stream'>('subject');
  const [useBest7ForForm4, setUseBest7ForForm4] = useState<boolean>(true);
  const [showPrintModal, setShowPrintModal] = useState<boolean>(false);

  const availableStreams = useMemo(
    () => getStreamsForGrade(tenant, selectedGrade),
    [tenant, selectedGrade]
  );
  const effectiveStreamFilter =
    streamFilter === 'All' || availableStreams.includes(streamFilter) ? streamFilter : 'All';

  const effectiveBaselineId = useMemo(() => {
    if (baselineSelection === '__NONE__') return null;
    if (baselineSelection === '__AUTO__') return defaultBaselineId || null;
    if (baselineSelection === activeCycle?.id) return null;
    return baselineSelection;
  }, [baselineSelection, defaultBaselineId, activeCycle?.id]);

  const baselineCycle: ExamCycle | null = useMemo(
    () => orderedCycles.find((c) => c.id === effectiveBaselineId) || null,
    [orderedCycles, effectiveBaselineId]
  );

  const report = useMemo(
    () =>
      buildGradeAnalyticsReport({
        workspace,
        cycleId: activeCycle?.id || '',
        baselineCycleId: effectiveBaselineId,
        grade: selectedGrade,
        streamFilter: effectiveStreamFilter,
      }),
    [workspace, activeCycle?.id, effectiveBaselineId, selectedGrade, effectiveStreamFilter]
  );

  // Scoped cohort summary KPIs (respects streamFilter)
  const cohortSummary = useMemo(() => {
    const sat = report.broadsheetRows.filter((r) => r.subjectsSat > 0 && r.meanScore !== null);
    const enrolled = report.broadsheetRows.length;
    if (sat.length === 0) {
      return {
        enrolled,
        sat: 0,
        meanScore: null as number | null,
        meanPoints: null as number | null,
        meanGrade: '—',
        passRate: null as number | null,
        qualityPassRate: null as number | null,
        deviation: null as number | null,
        best7AvgPoints: null as number | null,
      };
    }

    const activeStreamRow =
      effectiveStreamFilter === 'All'
        ? report.overallStreamSummary
        : report.streamComparisons.find((s) => s.stream === effectiveStreamFilter);

    const best7Rows = sat.filter((r) => r.kcseBest7 !== null);
    const best7AvgPoints =
      best7Rows.length > 0
        ? Math.round(
            (best7Rows.reduce((sum, r) => sum + (r.kcseBest7?.totalPoints || 0), 0) /
              best7Rows.length) *
              10
          ) / 10
        : null;

    return {
      enrolled,
      sat: sat.length,
      meanScore: activeStreamRow?.meanScore ?? null,
      meanPoints: activeStreamRow?.meanPoints ?? null,
      meanGrade: activeStreamRow?.meanGrade ?? '—',
      passRate: activeStreamRow?.passRate ?? null,
      qualityPassRate: activeStreamRow?.qualityPassRate ?? null,
      deviation: activeStreamRow?.deviation ?? null,
      best7AvgPoints,
    };
  }, [report, effectiveStreamFilter]);

  function handleExportAnalyticsPack() {
    if (!activeCycle) {
      onNotify('Create or select an exam cycle first.', 'error');
      return;
    }

    const wb = XLSX.utils.book_new();
    const scopeLabel =
      effectiveStreamFilter === 'All' ? 'All Streams' : `Stream ${effectiveStreamFilter}`;
    const baselineLabel = baselineCycle ? `vs ${baselineCycle.title}` : 'No baseline comparison';

    // Sheet 1: Merit List & Broadsheet
    const meritRows = report.broadsheetRows.map((row) => {
      const base: Record<string, string | number> = {
        Rank: row.rank ? `#${row.rank}` : '—',
        'Adm No': row.student.studentCode,
        'Student Name': row.student.fullName,
        Stream: row.student.section,
      };
      for (const sub of report.registeredSubjects) {
        const hit = row.subjectMap[sub];
        base[sub] = hit ? `${hit.score} (${hit.letterGrade})` : '—';
      }
      base['Sat'] = `${row.subjectsSat}/${row.registeredCount}`;
      base['Total Marks'] = row.subjectsSat > 0 ? `${row.totalScore}/${row.maxPossible}` : '—';
      base['Mean (%)'] = row.meanScore !== null ? row.meanScore : '—';
      base[`Mean Pts (/${report.maxPoints})`] = row.meanPoints !== null ? row.meanPoints : '—';
      base['Mean Grade'] = row.overallGrade;
      if (report.is844) {
        base['KCSE Best-7 Pts (/84)'] = row.kcseBest7 ? row.kcseBest7.totalPoints : '—';
        base['KCSE Best-7 Grade'] = row.kcseBest7 ? row.kcseBest7.meanGrade : '—';
      }
      base['Dev vs Prior (%)'] = formatDeviation(row.meanDeviation);
      return base;
    });

    XLSX.utils.book_append_sheet(
      wb,
      createBrandedWorksheetFromObjects(
        tenant,
        `${activeCycle.title} — Merit Broadsheet (${selectedGrade} · ${scopeLabel})`,
        meritRows,
        { extraMeta: [baselineLabel] }
      ),
      'Merit List'
    );

    // Sheet 2: Subject x Grade Distribution Matrix
    const matrixRows = report.subjectMatrix.map((row) => {
      const rec: Record<string, string | number> = {
        Rank: row.rank ? `#${row.rank}` : '—',
        Subject: row.subject,
        Entries: `${row.entries}/${row.expectedEntries}`,
      };
      for (const band of report.scale) {
        rec[band.grade] = row.gradeCounts[band.grade] ?? 0;
      }
      rec['Mean (%)'] = row.meanScore !== null ? row.meanScore : '—';
      rec[`Mean Pts (/${report.maxPoints})`] = row.meanPoints !== null ? row.meanPoints : '—';
      rec['Mean Grade'] = row.meanGrade;
      rec['Pass/ME+ (%)'] = row.passRate !== null ? `${row.passRate}%` : '—';
      rec['Dev (%)'] = formatDeviation(row.deviation);
      return rec;
    });

    XLSX.utils.book_append_sheet(
      wb,
      createBrandedWorksheetFromObjects(
        tenant,
        `${activeCycle.title} — Subject Grade Distribution (${selectedGrade} · ${scopeLabel})`,
        matrixRows,
        { extraMeta: [baselineLabel] }
      ),
      'Grade Matrix'
    );

    // Sheet 3: Stream Comparison
    const streamRows = [...report.streamComparisons, report.overallStreamSummary].map((s) => ({
      Rank: s.rank ? `#${s.rank}` : s.stream === 'All Streams' ? 'ALL' : '—',
      Stream: s.stream === 'All Streams' ? 'Overall Grade' : `Stream ${s.stream}`,
      Enrolled: s.enrolledCount,
      Sat: s.candidatesSat,
      'Mean (%)': s.meanScore !== null ? s.meanScore : '—',
      [`Mean Pts (/${report.maxPoints})`]: s.meanPoints !== null ? s.meanPoints : '—',
      'Mean Grade': s.meanGrade,
      [report.is844 ? 'Pass D+ & Above (%)' : 'Meeting+ ME2 (% )']:
        s.passRate !== null ? `${s.passRate}%` : '—',
      [report.is844 ? 'Uni Entry C+ & Above (%)' : 'Exceeding EE (% )']:
        s.qualityPassRate !== null ? `${s.qualityPassRate}%` : '—',
      'Dev vs Prior (%)': formatDeviation(s.deviation),
    }));

    XLSX.utils.book_append_sheet(
      wb,
      createBrandedWorksheetFromObjects(
        tenant,
        `${activeCycle.title} — Stream Comparison (${selectedGrade})`,
        streamRows
      ),
      'Stream Comparison'
    );

    // Sheet 4: Teacher & Department Analysis
    const teacherRows = report.teacherAnalysis.map((t) => ({
      Rank: `#${t.rank}`,
      Teacher: t.teacherName,
      Initials: t.teacherInitials,
      Department: t.department,
      Subject: t.subject,
      Stream: `Stream ${t.stream}`,
      Sat: t.candidatesSat,
      'Mean (%)': t.meanScore,
      [`Mean Pts (/${report.maxPoints})`]: t.meanPoints,
      'Mean Grade': t.meanGrade,
      'Pass/ME+ (%)': `${t.passRate}%`,
      'Dev (%)': formatDeviation(t.deviation),
    }));

    XLSX.utils.book_append_sheet(
      wb,
      createBrandedWorksheetFromObjects(
        tenant,
        `${activeCycle.title} — Teacher & Subject Accountability (${selectedGrade})`,
        teacherRows
      ),
      'Teacher Analysis'
    );

    // Sheet 5: Missing Marks Audit
    const missingRows: Array<Record<string, string | number>> =
      report.missingMarksByStudent.length > 0
        ? report.missingMarksByStudent.map((m) => ({
            'Adm No': m.student.studentCode,
            'Student Name': m.student.fullName,
            Stream: m.student.section,
            'Marks Entered': `${m.enteredCount}/${m.expectedCount}`,
            'Missing Count': m.missingSubjects.length,
            'Missing Subjects': m.missingSubjects.join(', '),
          }))
        : [
            {
              'Adm No': '—',
              'Student Name': `100% Complete — No missing marks in ${selectedGrade}`,
              Stream: scopeLabel,
              'Marks Entered': `${report.totalExpectedCells}/${report.totalExpectedCells}`,
              'Missing Count': 0,
              'Missing Subjects': 'None',
            },
          ];

    XLSX.utils.book_append_sheet(
      wb,
      createBrandedWorksheetFromObjects(
        tenant,
        `${activeCycle.title} — Missing Marks Audit (${selectedGrade} · ${scopeLabel})`,
        missingRows
      ),
      'Missing Marks Audit'
    );

    const safeFile = `${tenant.slug}-${activeCycle.title}-${selectedGrade}-zeraki-analytics`
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .toLowerCase();
    XLSX.writeFile(wb, `${safeFile}.xlsx`);
    onNotify(
      `Exported 5-sheet branded Zeraki Analytics workbook for ${selectedGrade} (${scopeLabel}).`
    );
  }

  const maxSubjectMean = Math.max(
    100,
    ...report.subjectMatrix.map((s) => s.meanScore || 0)
  );

  return (
    <div className="space-y-5">
      {/* Control Ribbon */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end">
            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Target Exam Cycle
              </label>
              <select
                aria-label="Analytics exam cycle"
                value={activeCycle?.id || ''}
                onChange={(e) => onChangeCycle(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                {orderedCycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} ({c.status})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Compare Baseline (Value-Added Δ)
              </label>
              <select
                aria-label="Analytics comparison cycle"
                value={baselineSelection}
                onChange={(e) => setBaselineSelection(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="__AUTO__">
                  {defaultBaselineId
                    ? `Auto Prior (${orderedCycles.find((c) => c.id === defaultBaselineId)?.title})`
                    : 'Auto Prior (None earlier)'}
                </option>
                {orderedCycles
                  .filter((c) => c.id !== activeCycle?.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                <option value="__NONE__">No Comparison</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Grade / Form
              </label>
              <select
                aria-label="Analytics grade level"
                value={selectedGrade}
                onChange={(e) => {
                  onChangeGrade(e.target.value);
                  setStreamFilter('All');
                }}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                {tenant.grades.map((g) => (
                  <option key={g} value={g}>
                    {is844FormFourGrade(g) ? `${g} (Form 4 · 8-4-4)` : g}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Stream Scope
              </label>
              <select
                aria-label="Analytics stream filter"
                value={effectiveStreamFilter}
                onChange={(e) => setStreamFilter(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="All">All Streams ({availableStreams.join(', ')})</option>
                {availableStreams.map((st) => (
                  <option key={st} value={st}>
                    Stream {st}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowPrintModal(true)}
              disabled={!activeCycle || report.broadsheetRows.length === 0}
              className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <Printer className="h-3.5 w-3.5" />
              Print Broadsheet &amp; Analysis
            </button>
            <button
              type="button"
              onClick={handleExportAnalyticsPack}
              disabled={!activeCycle || report.broadsheetRows.length === 0}
              className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-700"
            >
              <Download className="h-3.5 w-3.5" />
              Export Analysis Pack (.xlsx)
            </button>
          </div>
        </div>

        {/* Sub-view Switcher */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            {(
              [
                { id: 'overview', label: 'Streams & Progress', icon: BarChart3 },
                { id: 'matrix', label: 'Grade Distribution Matrix', icon: Layers },
                { id: 'teachers', label: 'Teacher & Subject Analysis', icon: Users },
                {
                  id: 'missing',
                  label: `Missing Marks Audit (${report.totalMissingCells})`,
                  icon: ClipboardCheck,
                },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSubView(tab.id)}
                  className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    subView === tab.id
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3 font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
            <span>
              Scale: <strong className="text-slate-800 dark:text-slate-200">{report.is844 ? '8-4-4 KCSE (/12)' : 'KNEC CBE (/8)'}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Completeness:{' '}
              <strong
                className={
                  report.completenessPct === 100
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-amber-700 dark:text-amber-400'
                }
              >
                {report.completenessPct}%
              </strong>
            </span>
          </div>
        </div>
      </div>

      {/* 4-Column KPI Summary Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Class / Stream Mean Score
          </p>
          <div className="mt-1.5 flex items-baseline justify-between gap-2">
            <p className="font-mono text-2xl font-bold tracking-tight text-slate-900 tabular-nums dark:text-slate-100">
              {cohortSummary.meanScore !== null ? `${cohortSummary.meanScore}%` : '—'}
              <span
                className={`ml-2 text-lg ${getGradeTextColor(cohortSummary.meanGrade, report.is844)}`}
              >
                {cohortSummary.meanGrade}
              </span>
            </p>
            <DeviationInline value={cohortSummary.deviation} />
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            {baselineCycle ? `Compared vs ${baselineCycle.title}` : 'No prior baseline selected'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {report.is844 ? 'Mean Points & KCSE Best-7' : 'CBE Mean Points'}
          </p>
          <p className="mt-1.5 font-mono text-2xl font-bold tracking-tight text-slate-900 tabular-nums dark:text-slate-100">
            {cohortSummary.meanPoints !== null ? cohortSummary.meanPoints.toFixed(2) : '—'}
            <span className="text-sm font-normal text-slate-400"> / {report.maxPoints}</span>
          </p>
          <p className="mt-1.5 font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
            {report.is844 && cohortSummary.best7AvgPoints !== null
              ? `Best-7 Avg: ${cohortSummary.best7AvgPoints} / 84 pts`
              : `${report.registeredSubjects.length} registered learning areas`}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {report.is844 ? 'Pass (D+ & Above) / C+ Uni Entry' : 'Meeting+ (ME2+) / Exceeding (EE)'}
          </p>
          <p className="mt-1.5 font-mono text-2xl font-bold tracking-tight text-emerald-700 tabular-nums dark:text-emerald-400">
            {cohortSummary.passRate !== null ? `${cohortSummary.passRate}%` : '—'}
            <span className="ml-2 font-mono text-sm font-semibold text-blue-700 dark:text-blue-400">
              / {cohortSummary.qualityPassRate !== null ? `${cohortSummary.qualityPassRate}%` : '—'}
            </span>
          </p>
          <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            {report.is844
              ? 'D+ (40%+) minimum pass vs C+ (55%+) degree cutoff'
              : 'ME2 (41%+) mastery vs EE2 (75%+) distinction'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Candidates &amp; Mark Entry Coverage
          </p>
          <p className="mt-1.5 font-mono text-2xl font-bold tracking-tight text-slate-900 tabular-nums dark:text-slate-100">
            {cohortSummary.sat}
            <span className="text-sm font-normal text-slate-400"> / {cohortSummary.enrolled} sat</span>
          </p>
          <p className="mt-1.5 font-mono text-[11px] tabular-nums">
            {report.totalMissingCells === 0 ? (
              <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                100% marks submitted
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setSubView('missing')}
                className="font-semibold text-amber-700 hover:underline dark:text-amber-400"
              >
                {report.totalMissingCells} missing score cell(s) — inspect
              </button>
            )}
          </p>
        </div>
      </div>

      {/* Sub-view 1: Overview, Stream Ranking & Value-Added Progress */}
      {subView === 'overview' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            {/* Stream-vs-Stream Comparison */}
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white lg:col-span-7 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Stream-vs-Stream Ranking ({selectedGrade})
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Side-by-side cohort mean, points, pass rate &amp; cycle deviation
                  </p>
                </div>
                <span className="font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                  {report.streamComparisons.length} stream(s)
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-2.5">Pos</th>
                      <th className="px-4 py-2.5">Stream</th>
                      <th className="px-3 py-2.5 text-right">Sat / Enr</th>
                      <th className="px-3 py-2.5 text-right">Mean %</th>
                      <th className="px-3 py-2.5 text-right">Mean Pts</th>
                      <th className="px-3 py-2.5 text-right">Grade</th>
                      <th className="px-3 py-2.5 text-right">
                        {report.is844 ? 'Pass %' : 'ME+ %'}
                      </th>
                      <th className="px-4 py-2.5 text-right">Dev Δ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {report.streamComparisons.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                          No streams configured for {selectedGrade}.
                        </td>
                      </tr>
                    ) : (
                      report.streamComparisons.map((row) => (
                        <tr
                          key={row.stream}
                          className={
                            effectiveStreamFilter === row.stream
                              ? 'bg-blue-50/50 dark:bg-blue-950/20'
                              : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/30'
                          }
                        >
                          <td className="px-4 py-2.5 font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
                            {row.rank ? `#${row.rank}` : '—'}
                          </td>
                          <td className="px-4 py-2.5 font-semibold text-slate-900 dark:text-slate-100">
                            <button
                              type="button"
                              onClick={() =>
                                setStreamFilter(
                                  effectiveStreamFilter === row.stream ? 'All' : row.stream
                                )
                              }
                              className="hover:text-blue-600 hover:underline dark:hover:text-blue-400"
                            >
                              Stream {row.stream}
                            </button>
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-slate-600 tabular-nums dark:text-slate-400">
                            {row.candidatesSat} / {row.enrolledCount}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
                            {row.meanScore !== null ? `${row.meanScore}%` : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-slate-700 tabular-nums dark:text-slate-300">
                            {row.meanPoints !== null
                              ? `${row.meanPoints.toFixed(2)}/${report.maxPoints}`
                              : '—'}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-right font-mono font-bold tabular-nums ${getGradeTextColor(
                              row.meanGrade,
                              report.is844
                            )}`}
                          >
                            {row.meanGrade}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-slate-700 tabular-nums dark:text-slate-300">
                            {row.passRate !== null ? `${row.passRate}%` : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <DeviationInline value={row.deviation} />
                          </td>
                        </tr>
                      ))
                    )}
                    <tr className="border-t-2 border-slate-200 bg-slate-50/70 font-semibold dark:border-slate-700 dark:bg-slate-800/40">
                      <td className="px-4 py-2.5 font-mono text-slate-500">ALL</td>
                      <td className="px-4 py-2.5 text-slate-900 dark:text-slate-100">
                        Grade Overall
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-700 tabular-nums dark:text-slate-300">
                        {report.overallStreamSummary.candidatesSat} /{' '}
                        {report.overallStreamSummary.enrolledCount}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-900 tabular-nums dark:text-slate-100">
                        {report.overallStreamSummary.meanScore !== null
                          ? `${report.overallStreamSummary.meanScore}%`
                          : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-700 tabular-nums dark:text-slate-300">
                        {report.overallStreamSummary.meanPoints !== null
                          ? `${report.overallStreamSummary.meanPoints.toFixed(2)}/${report.maxPoints}`
                          : '—'}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-mono font-bold tabular-nums ${getGradeTextColor(
                          report.overallStreamSummary.meanGrade,
                          report.is844
                        )}`}
                      >
                        {report.overallStreamSummary.meanGrade}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-700 tabular-nums dark:text-slate-300">
                        {report.overallStreamSummary.passRate !== null
                          ? `${report.overallStreamSummary.passRate}%`
                          : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <DeviationInline value={report.overallStreamSummary.deviation} />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* Subject Mean Performance Horizontal Chart */}
            <section className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Subject Mean Ranking
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Ranked by mean score (%) in {effectiveStreamFilter === 'All' ? selectedGrade : `${selectedGrade} Stream ${effectiveStreamFilter}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSubView('matrix')}
                  className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                >
                  Full Matrix
                </button>
              </div>

              <div className="mt-3 space-y-2.5">
                {report.subjectMatrix.filter((s) => s.entries > 0).length === 0 ? (
                  <p className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                    No subject marks recorded yet for this selection.
                  </p>
                ) : (
                  report.subjectMatrix
                    .filter((s) => s.entries > 0)
                    .slice(0, 8)
                    .map((sub) => {
                      const pct = sub.meanScore ?? 0;
                      const widthPct = Math.max(4, Math.round((pct / maxSubjectMean) * 100));
                      return (
                        <div key={sub.subject} className="space-y-1">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="truncate font-medium text-slate-800 dark:text-slate-200">
                              <span className="mr-1.5 font-mono text-[11px] text-slate-400 tabular-nums">
                                #{sub.rank}
                              </span>
                              {sub.subject}
                            </span>
                            <span className="flex shrink-0 items-center gap-2 font-mono text-[11px] tabular-nums">
                              <strong className="text-slate-900 dark:text-slate-100">
                                {pct}%
                              </strong>
                              <span className={`font-bold ${getGradeTextColor(sub.meanGrade, report.is844)}`}>
                                {sub.meanGrade}
                              </span>
                              <DeviationInline value={sub.deviation} />
                            </span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-sm bg-slate-100 dark:bg-slate-800">
                            <div
                              className="h-full bg-blue-600 dark:bg-blue-500"
                              style={{ width: `${widthPct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            </section>
          </div>

          {/* 3-Column Leaderboards: Top Performers, Most Improved (Value-Added), Attention Watchlist */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {/* Top Performers */}
            <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
                <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-slate-100">
                  <Award className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  Top Performers
                </h3>
                {report.is844 && (
                  <button
                    type="button"
                    onClick={() => setUseBest7ForForm4((v) => !v)}
                    className="font-mono text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {useBest7ForForm4 ? 'KCSE Best-7' : 'Full Total'}
                  </button>
                )}
              </div>
              <div className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
                {report.topPerformers.length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-500">
                    No ranked learners available yet.
                  </p>
                ) : (
                  report.topPerformers.map((row) => (
                    <div
                      key={row.student.id}
                      className="flex items-center justify-between gap-2 py-2.5 text-xs"
                    >
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => onOpenReportCard(row.student.id)}
                          className="truncate text-left font-semibold text-slate-900 hover:text-blue-600 hover:underline dark:text-slate-100 dark:hover:text-blue-400"
                        >
                          <span className="mr-1.5 font-mono text-blue-700 tabular-nums dark:text-blue-400">
                            #{row.rank}
                          </span>
                          {row.student.fullName}
                        </button>
                        <p className="font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                          {row.student.studentCode} · Stream {row.student.section}
                          {report.is844 && useBest7ForForm4 && row.kcseBest7
                            ? ` · Best-7: ${row.kcseBest7.totalPoints}/${row.kcseBest7.maxPoints}`
                            : ''}
                        </p>
                      </div>
                      <div className="shrink-0 text-right font-mono tabular-nums">
                        <p className="font-bold text-slate-900 dark:text-slate-100">
                          {row.meanScore}%
                        </p>
                        <p
                          className={`text-[11px] font-bold ${getGradeTextColor(
                            row.overallGrade,
                            report.is844
                          )}`}
                        >
                          {row.overallGrade}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* Most Improved (Value-Added) */}
            <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
                <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-slate-100">
                  <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  Most Improved (Value-Added)
                </h3>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  {baselineCycle ? `vs ${baselineCycle.title}` : 'Needs prior exam'}
                </span>
              </div>
              <div className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
                {report.mostImproved.length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                    {baselineCycle
                      ? `No positive mean gains recorded compared to ${baselineCycle.title}.`
                      : 'Select a baseline exam cycle above to measure student value-added progress.'}
                  </p>
                ) : (
                  report.mostImproved.map((row, idx) => (
                    <div
                      key={row.student.id}
                      className="flex items-center justify-between gap-2 py-2.5 text-xs"
                    >
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => onOpenReportCard(row.student.id)}
                          className="truncate text-left font-semibold text-slate-900 hover:text-blue-600 hover:underline dark:text-slate-100 dark:hover:text-blue-400"
                        >
                          <span className="mr-1.5 font-mono text-emerald-700 tabular-nums dark:text-emerald-400">
                            #{idx + 1}
                          </span>
                          {row.student.fullName}
                        </button>
                        <p className="font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                          {row.prevMeanScore}% → {row.meanScore}% · Stream {row.student.section}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <DeviationInline value={row.meanDeviation} />
                        {row.pointsDeviation !== null && (
                          <p className="font-mono text-[10px] text-slate-500 tabular-nums dark:text-slate-400">
                            {row.pointsDeviation > 0
                              ? `+${row.pointsDeviation} pts`
                              : `${row.pointsDeviation} pts`}
                          </p>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* Academic Intervention Watchlist */}
            <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
                <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-slate-100">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  Academic Watchlist
                </h3>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Below pass or -5%+ drop
                </span>
              </div>
              <div className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
                {report.needsAttention.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-6 text-center text-xs text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="mb-1.5 h-5 w-5" />
                    All sat candidates meet proficiency with no steep drops.
                  </div>
                ) : (
                  report.needsAttention.map((row) => (
                    <div
                      key={row.student.id}
                      className="flex items-center justify-between gap-2 py-2.5 text-xs"
                    >
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => onOpenReportCard(row.student.id)}
                          className="truncate text-left font-semibold text-slate-900 hover:text-blue-600 hover:underline dark:text-slate-100 dark:hover:text-blue-400"
                        >
                          {row.student.fullName}
                        </button>
                        <p className="font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                          {row.student.studentCode} · Stream {row.student.section} ·{' '}
                          {row.meanScore}% ({row.overallGrade})
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <DeviationInline value={row.meanDeviation} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>
      )}

      {/* Sub-view 2: Subject x Grade & Stream x Grade Distribution Matrix */}
      {subView === 'matrix' && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {matrixMode === 'subject'
                  ? 'Subject × Grade Distribution Matrix'
                  : 'Stream × Overall Grade Distribution Matrix'}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Exact candidate counts per grade band ({report.scale.map((b) => b.grade).join(' · ')})
              </p>
            </div>

            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => setMatrixMode('subject')}
                className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  matrixMode === 'subject'
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                }`}
              >
                By Subject
              </button>
              <button
                type="button"
                onClick={() => setMatrixMode('stream')}
                className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  matrixMode === 'stream'
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                }`}
              >
                By Stream
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            {matrixMode === 'subject' ? (
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2.5">Pos</th>
                    <th className="px-3 py-2.5">Subject</th>
                    <th className="px-2 py-2.5 text-right">Sat</th>
                    {report.scale.map((band) => (
                      <th
                        key={band.grade}
                        className={`px-2 py-2.5 text-right font-mono ${getGradeTextColor(
                          band.grade,
                          report.is844
                        )}`}
                      >
                        {band.grade}
                      </th>
                    ))}
                    <th className="px-3 py-2.5 text-right">Mean %</th>
                    <th className="px-3 py-2.5 text-right">Mean Pts</th>
                    <th className="px-3 py-2.5 text-right">Grade</th>
                    <th className="px-3 py-2.5 text-right">Dev Δ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {report.subjectMatrix.map((row) => (
                    <tr
                      key={row.subject}
                      className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30"
                    >
                      <td className="px-3 py-2.5 font-mono font-bold text-slate-800 tabular-nums dark:text-slate-200">
                        {row.rank ? `#${row.rank}` : '—'}
                      </td>
                      <td className="px-3 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                        {row.subject}
                      </td>
                      <td className="px-2 py-2.5 text-right font-mono text-slate-600 tabular-nums dark:text-slate-400">
                        {row.entries}/{row.expectedEntries}
                      </td>
                      {report.scale.map((band) => {
                        const cnt = row.gradeCounts[band.grade] ?? 0;
                        return (
                          <td
                            key={band.grade}
                            className={`px-2 py-2.5 text-right font-mono tabular-nums ${
                              cnt > 0
                                ? 'font-semibold text-slate-900 dark:text-slate-100'
                                : 'text-slate-300 dark:text-slate-700'
                            }`}
                          >
                            {cnt}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
                        {row.meanScore !== null ? `${row.meanScore}%` : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-700 tabular-nums dark:text-slate-300">
                        {row.meanPoints !== null ? row.meanPoints.toFixed(2) : '—'}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-mono font-bold tabular-nums ${getGradeTextColor(
                          row.meanGrade,
                          report.is844
                        )}`}
                      >
                        {row.meanGrade}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <DeviationInline value={row.deviation} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2.5">Pos</th>
                    <th className="px-3 py-2.5">Stream</th>
                    <th className="px-2 py-2.5 text-right">Sat</th>
                    {report.scale.map((band) => (
                      <th
                        key={band.grade}
                        className={`px-2 py-2.5 text-right font-mono ${getGradeTextColor(
                          band.grade,
                          report.is844
                        )}`}
                      >
                        {band.grade}
                      </th>
                    ))}
                    <th className="px-3 py-2.5 text-right">Mean %</th>
                    <th className="px-3 py-2.5 text-right">Mean Pts</th>
                    <th className="px-3 py-2.5 text-right">Grade</th>
                    <th className="px-3 py-2.5 text-right">Dev Δ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {[...report.streamComparisons, report.overallStreamSummary].map((row) => (
                    <tr
                      key={row.stream}
                      className={
                        row.stream === 'All Streams'
                          ? 'border-t-2 border-slate-200 bg-slate-50/70 font-semibold dark:border-slate-700 dark:bg-slate-800/40'
                          : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/30'
                      }
                    >
                      <td className="px-3 py-2.5 font-mono font-bold text-slate-800 tabular-nums dark:text-slate-200">
                        {row.rank ? `#${row.rank}` : row.stream === 'All Streams' ? 'ALL' : '—'}
                      </td>
                      <td className="px-3 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                        {row.stream === 'All Streams' ? 'Overall Grade' : `Stream ${row.stream}`}
                      </td>
                      <td className="px-2 py-2.5 text-right font-mono text-slate-600 tabular-nums dark:text-slate-400">
                        {row.candidatesSat}/{row.enrolledCount}
                      </td>
                      {report.scale.map((band) => {
                        const cnt = row.gradeCounts[band.grade] ?? 0;
                        return (
                          <td
                            key={band.grade}
                            className={`px-2 py-2.5 text-right font-mono tabular-nums ${
                              cnt > 0
                                ? 'font-semibold text-slate-900 dark:text-slate-100'
                                : 'text-slate-300 dark:text-slate-700'
                            }`}
                          >
                            {cnt}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
                        {row.meanScore !== null ? `${row.meanScore}%` : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-700 tabular-nums dark:text-slate-300">
                        {row.meanPoints !== null ? row.meanPoints.toFixed(2) : '—'}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-mono font-bold tabular-nums ${getGradeTextColor(
                          row.meanGrade,
                          report.is844
                        )}`}
                      >
                        {row.meanGrade}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <DeviationInline value={row.deviation} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}

      {/* Sub-view 3: Teacher & Department Subject Performance Comparison */}
      {subView === 'teachers' && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Subject Teacher &amp; Department Performance
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Maps each stream &amp; subject to its assigned instructor from Timetable and Staff Directory
              </p>
            </div>
            <span className="font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
              {report.teacherAnalysis.length} subject-stream assignment(s)
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2.5">Rank</th>
                  <th className="px-4 py-2.5">Instructor</th>
                  <th className="px-3 py-2.5">Initials</th>
                  <th className="px-3 py-2.5">Department</th>
                  <th className="px-3 py-2.5">Subject</th>
                  <th className="px-3 py-2.5">Stream</th>
                  <th className="px-3 py-2.5 text-right">Sat</th>
                  <th className="px-3 py-2.5 text-right">Mean %</th>
                  <th className="px-3 py-2.5 text-right">Mean Pts</th>
                  <th className="px-3 py-2.5 text-right">Grade</th>
                  <th className="px-3 py-2.5 text-right">Pass %</th>
                  <th className="px-4 py-2.5 text-right">Dev Δ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {report.teacherAnalysis.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-4 py-10 text-center text-slate-500">
                      No subject marks recorded in {activeCycle?.title} for {selectedGrade}.
                    </td>
                  </tr>
                ) : (
                  report.teacherAnalysis.map((row) => (
                    <tr key={row.key} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                      <td className="px-4 py-2.5 font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
                        #{row.rank}
                      </td>
                      <td className="px-4 py-2.5 font-semibold text-slate-900 dark:text-slate-100">
                        {row.teacherName}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-slate-600 dark:text-slate-400">
                        {row.teacherInitials}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400">
                        {row.department}
                      </td>
                      <td className="px-3 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                        {row.subject}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-slate-600 dark:text-slate-400">
                        Stream {row.stream}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-600 tabular-nums dark:text-slate-400">
                        {row.candidatesSat}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
                        {row.meanScore}%
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-700 tabular-nums dark:text-slate-300">
                        {row.meanPoints.toFixed(2)}/{report.maxPoints}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-mono font-bold tabular-nums ${getGradeTextColor(
                          row.meanGrade,
                          report.is844
                        )}`}
                      >
                        {row.meanGrade}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-700 tabular-nums dark:text-slate-300">
                        {row.passRate}%
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <DeviationInline value={row.deviation} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Sub-view 4: Missing Marks Completeness Audit */}
      {subView === 'missing' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          {/* Subject Entry Coverage */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-100 pb-2.5 dark:border-slate-800">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Subject Mark Entry Completeness
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Click any incomplete stream to jump directly to Exam Results Entry
              </p>
            </div>

            <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
              {report.missingMarksBySubject.map((sub) => (
                <div key={sub.subject} className="py-2.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {sub.subject}
                    </span>
                    <span className="font-mono text-[11px] tabular-nums">
                      <span
                        className={
                          sub.missingCount === 0
                            ? 'font-semibold text-emerald-700 dark:text-emerald-400'
                            : 'font-semibold text-amber-700 dark:text-amber-400'
                        }
                      >
                        {sub.entered}/{sub.expected} ({sub.completionPct}%)
                      </span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-sm bg-slate-100 dark:bg-slate-800">
                    <div
                      className={`h-full ${
                        sub.missingCount === 0
                          ? 'bg-emerald-600 dark:bg-emerald-500'
                          : 'bg-amber-500 dark:bg-amber-400'
                      }`}
                      style={{ width: `${sub.completionPct}%` }}
                    />
                  </div>
                  {sub.streamsMissing.length > 0 && activeCycle && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {sub.streamsMissing.map((st) => (
                        <button
                          key={st.stream}
                          type="button"
                          onClick={() =>
                            onJumpToMarkEntry({
                              cycleId: activeCycle.id,
                              examTitle: activeCycle.title,
                              grade: selectedGrade,
                              stream: st.stream,
                              subject: sub.subject,
                            })
                          }
                          className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 font-mono text-[11px] font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-300"
                        >
                          Enter Stream {st.stream} ({st.missingCount} missing)
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Student-by-Student Missing Marks Roster */}
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white lg:col-span-7 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Learners with Unrecorded Subject Scores
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Students missing at least one registered subject in {activeCycle?.title}
                </p>
              </div>
              <span className="font-mono text-xs font-semibold text-slate-700 tabular-nums dark:text-slate-300">
                {report.missingMarksByStudent.length} learner(s)
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-2.5">Adm No</th>
                    <th className="px-4 py-2.5">Student Name</th>
                    <th className="px-3 py-2.5 text-right">Entered</th>
                    <th className="px-4 py-2.5">Missing Subjects</th>
                    <th className="px-4 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {report.missingMarksByStudent.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-10 text-center text-emerald-700 dark:text-emerald-400"
                      >
                        All {report.broadsheetRows.length} active learners have complete marks across all{' '}
                        {report.registeredSubjects.length} registered subjects.
                      </td>
                    </tr>
                  ) : (
                    report.missingMarksByStudent.map((item) => (
                      <tr
                        key={item.student.id}
                        className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30"
                      >
                        <td className="px-4 py-2.5 font-mono text-slate-500 tabular-nums dark:text-slate-400">
                          {item.student.studentCode}
                        </td>
                        <td className="px-4 py-2.5 font-semibold text-slate-900 dark:text-slate-100">
                          {item.student.fullName}
                          <span className="ml-1.5 font-normal text-slate-400">
                            Stream {item.student.section}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-slate-700 tabular-nums dark:text-slate-300">
                          {item.enteredCount}/{item.expectedCount}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                          {item.missingSubjects.join(', ')}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {activeCycle && (
                            <button
                              type="button"
                              onClick={() =>
                                onJumpToMarkEntry({
                                  cycleId: activeCycle.id,
                                  examTitle: activeCycle.title,
                                  grade: selectedGrade,
                                  stream: item.student.section,
                                  subject: item.missingSubjects[0],
                                })
                              }
                              className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-blue-600 hover:underline dark:text-blue-400"
                            >
                              <FileSpreadsheet className="h-3.5 w-3.5" />
                              Enter {item.missingSubjects[0]}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* Printable Official Broadsheet & Class Analysis Modal */}
      {showPrintModal && activeCycle && (
        <div className="print-modal-root fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4">
          <div className="print-modal-sheet my-6 max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between gap-3 no-print">
              <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                <GraduationCap className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span>
                  Official Printable Academic Analysis &amp; Merit Broadsheet
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportAnalyticsPack}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Download className="h-3.5 w-3.5" />
                  Excel Pack
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print / Save PDF
                </button>
                <button
                  type="button"
                  onClick={() => setShowPrintModal(false)}
                  aria-label="Close broadsheet preview"
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <TenantDocumentHeader
              tenant={tenant}
              documentTitle="Academic Performance Analysis & Merit Broadsheet"
              subtitle={`${activeCycle.title} · ${selectedGrade} (${
                effectiveStreamFilter === 'All'
                  ? 'All Streams'
                  : `Stream ${effectiveStreamFilter}`
              })`}
              rightMeta={[
                { label: 'Scale', value: report.is844 ? '8-4-4 KCSE' : 'KNEC CBE' },
                {
                  label: 'Cohort Mean',
                  value:
                    cohortSummary.meanScore !== null
                      ? `${cohortSummary.meanScore}% (${cohortSummary.meanGrade})`
                      : '—',
                },
                {
                  label: 'Candidates',
                  value: `${cohortSummary.sat}/${cohortSummary.enrolled}`,
                },
              ]}
              compact
            />

            {/* Print Section A: Stream Comparison */}
            <div className="mt-4">
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                1. Stream Performance Summary
              </h4>
              <table className="w-full border border-slate-200 text-left text-[11px] dark:border-slate-700">
                <thead className="bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  <tr>
                    <th className="border-b border-slate-200 px-2.5 py-1.5 dark:border-slate-700">Pos</th>
                    <th className="border-b border-slate-200 px-2.5 py-1.5 dark:border-slate-700">Stream</th>
                    <th className="border-b border-slate-200 px-2.5 py-1.5 text-right dark:border-slate-700">Sat/Enr</th>
                    <th className="border-b border-slate-200 px-2.5 py-1.5 text-right dark:border-slate-700">Mean %</th>
                    <th className="border-b border-slate-200 px-2.5 py-1.5 text-right dark:border-slate-700">Mean Pts</th>
                    <th className="border-b border-slate-200 px-2.5 py-1.5 text-right dark:border-slate-700">Grade</th>
                    <th className="border-b border-slate-200 px-2.5 py-1.5 text-right dark:border-slate-700">Pass %</th>
                    <th className="border-b border-slate-200 px-2.5 py-1.5 text-right dark:border-slate-700">Dev Δ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {[...report.streamComparisons, report.overallStreamSummary].map((s) => (
                    <tr key={s.stream}>
                      <td className="px-2.5 py-1.5 font-mono font-semibold">
                        {s.rank ? `#${s.rank}` : s.stream === 'All Streams' ? 'ALL' : '—'}
                      </td>
                      <td className="px-2.5 py-1.5 font-semibold">
                        {s.stream === 'All Streams' ? 'Overall Grade' : `Stream ${s.stream}`}
                      </td>
                      <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">
                        {s.candidatesSat}/{s.enrolledCount}
                      </td>
                      <td className="px-2.5 py-1.5 text-right font-mono font-bold tabular-nums">
                        {s.meanScore !== null ? `${s.meanScore}%` : '—'}
                      </td>
                      <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">
                        {s.meanPoints !== null ? s.meanPoints.toFixed(2) : '—'}
                      </td>
                      <td className="px-2.5 py-1.5 text-right font-mono font-bold">
                        {s.meanGrade}
                      </td>
                      <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">
                        {s.passRate !== null ? `${s.passRate}%` : '—'}
                      </td>
                      <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">
                        {formatDeviation(s.deviation)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Print Section B: Subject x Grade Matrix */}
            <div className="mt-4 break-inside-avoid">
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                2. Subject × Grade Distribution Matrix
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full border border-slate-200 text-left text-[11px] dark:border-slate-700">
                  <thead className="bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    <tr>
                      <th className="border-b border-slate-200 px-2 py-1.5 dark:border-slate-700">Subject</th>
                      {report.scale.map((b) => (
                        <th
                          key={b.grade}
                          className="border-b border-slate-200 px-1.5 py-1.5 text-right font-mono dark:border-slate-700"
                        >
                          {b.grade}
                        </th>
                      ))}
                      <th className="border-b border-slate-200 px-2 py-1.5 text-right dark:border-slate-700">Mean %</th>
                      <th className="border-b border-slate-200 px-2 py-1.5 text-right dark:border-slate-700">Grade</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {report.subjectMatrix.map((row) => (
                      <tr key={row.subject}>
                        <td className="px-2 py-1.5 font-medium">{row.subject}</td>
                        {report.scale.map((b) => (
                          <td key={b.grade} className="px-1.5 py-1.5 text-right font-mono tabular-nums">
                            {row.gradeCounts[b.grade] ?? 0}
                          </td>
                        ))}
                        <td className="px-2 py-1.5 text-right font-mono font-bold tabular-nums">
                          {row.meanScore !== null ? `${row.meanScore}%` : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono font-bold">
                          {row.meanGrade}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Print Section C: Student Merit Broadsheet */}
            <div className="mt-4">
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                3. Class Merit Broadsheet ({report.broadsheetRows.length} Candidates)
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full border border-slate-200 text-left text-[11px] dark:border-slate-700">
                  <thead className="bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    <tr>
                      <th className="border-b border-slate-200 px-2 py-1.5 dark:border-slate-700">Rank</th>
                      <th className="border-b border-slate-200 px-2 py-1.5 dark:border-slate-700">Adm No</th>
                      <th className="border-b border-slate-200 px-2 py-1.5 dark:border-slate-700">Learner</th>
                      <th className="border-b border-slate-200 px-2 py-1.5 dark:border-slate-700">Str</th>
                      {report.registeredSubjects.map((sub) => (
                        <th
                          key={sub}
                          className="border-b border-slate-200 px-1.5 py-1.5 text-right dark:border-slate-700"
                          title={sub}
                        >
                          {sub.length > 7 ? `${sub.slice(0, 6)}.` : sub}
                        </th>
                      ))}
                      <th className="border-b border-slate-200 px-2 py-1.5 text-right dark:border-slate-700">Total</th>
                      <th className="border-b border-slate-200 px-2 py-1.5 text-right dark:border-slate-700">Mean</th>
                      <th className="border-b border-slate-200 px-2 py-1.5 text-right dark:border-slate-700">Grd</th>
                      <th className="border-b border-slate-200 px-2 py-1.5 text-right dark:border-slate-700">Dev</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {report.broadsheetRows.map((row: BroadsheetStudentRow) => (
                      <tr key={row.student.id}>
                        <td className="px-2 py-1 font-mono font-bold tabular-nums">
                          {row.rank ? `#${row.rank}` : '—'}
                        </td>
                        <td className="px-2 py-1 font-mono tabular-nums">{row.student.studentCode}</td>
                        <td className="px-2 py-1 font-medium">{row.student.fullName}</td>
                        <td className="px-2 py-1 font-mono">{row.student.section}</td>
                        {report.registeredSubjects.map((sub) => {
                          const hit = row.subjectMap[sub];
                          return (
                            <td key={sub} className="px-1.5 py-1 text-right font-mono tabular-nums">
                              {hit ? hit.score : '—'}
                            </td>
                          );
                        })}
                        <td className="px-2 py-1 text-right font-mono font-semibold tabular-nums">
                          {row.subjectsSat > 0 ? row.totalScore : '—'}
                        </td>
                        <td className="px-2 py-1 text-right font-mono font-bold tabular-nums">
                          {row.meanScore !== null ? `${row.meanScore}%` : '—'}
                        </td>
                        <td className="px-2 py-1 text-right font-mono font-bold">{row.overallGrade}</td>
                        <td className="px-2 py-1 text-right font-mono tabular-nums">
                          {formatDeviation(row.meanDeviation)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
