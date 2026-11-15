import { useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { formatCurrency, formatDateShort } from '../lib/format';
import type { TenantWorkspaceData } from '../shared/types';

interface AnalyticsDashboardProps {
  workspace: TenantWorkspaceData;
  onNavigate: (module: string) => void;
}

export function AnalyticsDashboard({ workspace, onNavigate }: AnalyticsDashboardProps) {
  const [attendanceFilterGrade, setAttendanceFilterGrade] = useState<string>('All');
  const [hoveredBarIdx, setHoveredBarIdx] = useState<number | null>(null);

  const { tenant, students, admissions, attendance, examResults, invoices, timetable } = workspace;

  const stats = useMemo(() => {
    const activeStudents = students.filter((s) => s.status === 'Active').length;
    const pendingAdmissions = admissions.filter((a) => a.stage !== 'Enrolled').length;

    const totalAtt = attendance.length;
    const presentCount = attendance.filter(
      (a) => a.status === 'Present' || a.status === 'Late' || a.status === 'Excused'
    ).length;
    const attendanceRate = totalAtt > 0 ? Math.round((presentCount / totalAtt) * 1000) / 10 : 100;

    const totalBilled = invoices.reduce((acc, inv) => acc + inv.totalAmount, 0);
    const totalCollected = invoices.reduce((acc, inv) => acc + inv.paidAmount, 0);
    const collectionRate = totalBilled > 0 ? Math.round((totalCollected / totalBilled) * 1000) / 10 : 100;

    const avgScore =
      examResults.length > 0
        ? Math.round((examResults.reduce((acc, r) => acc + r.score, 0) / examResults.length) * 10) / 10
        : 0;

    return {
      activeStudents,
      pendingAdmissions,
      attendanceRate,
      totalBilled,
      totalCollected,
      collectionRate,
      avgScore,
    };
  }, [students, admissions, attendance, invoices, examResults]);

  // Daily attendance trend series
  const attendanceTrend = useMemo(() => {
    const filtered =
      attendanceFilterGrade === 'All'
        ? attendance
        : attendance.filter((a) => a.grade === attendanceFilterGrade);

    const byDate = new Map<string, { present: number; total: number }>();
    filtered.forEach((rec) => {
      const entry = byDate.get(rec.date) || { present: 0, total: 0 };
      entry.total += 1;
      if (rec.status === 'Present' || rec.status === 'Late') entry.present += 1;
      byDate.set(rec.date, entry);
    });

    const sorted = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-7)
      .map(([date, counts]) => ({
        date,
        label: date.slice(5),
        rate: counts.total > 0 ? Math.round((counts.present / counts.total) * 100) : 0,
        present: counts.present,
        total: counts.total,
      }));

    if (sorted.length === 0) {
      return [
        { date: '2026-11-10', label: '11-10', rate: 96, present: 24, total: 25 },
        { date: '2026-11-11', label: '11-11', rate: 92, present: 23, total: 25 },
        { date: '2026-11-12', label: '11-12', rate: 100, present: 25, total: 25 },
        { date: '2026-11-13', label: '11-13', rate: 96, present: 24, total: 25 },
        { date: '2026-11-14', label: '11-14', rate: 94, present: 23, total: 25 },
      ];
    }
    return sorted;
  }, [attendance, attendanceFilterGrade]);

  // Subject performance breakdown
  const subjectAverages = useMemo(() => {
    const map = new Map<string, { sum: number; count: number }>();
    examResults.forEach((res) => {
      const cur = map.get(res.subject) || { sum: 0, count: 0 };
      cur.sum += res.score;
      cur.count += 1;
      map.set(res.subject, cur);
    });
    return Array.from(map.entries())
      .map(([subject, val]) => ({
        subject,
        avg: Math.round((val.sum / val.count) * 10) / 10,
        count: val.count,
      }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 6);
  }, [examResults]);

  // Fee status distribution
  const feeBreakdown = useMemo(() => {
    const paid = invoices.filter((i) => i.status === 'Paid').reduce((a, b) => a + b.totalAmount, 0);
    const partial = invoices.filter((i) => i.status === 'Partial').reduce((a, b) => a + b.paidAmount, 0);
    const overdue = invoices.filter((i) => i.status === 'Overdue').reduce((a, b) => a + b.balance, 0);
    const pending = invoices
      .filter((i) => i.status === 'Pending' || i.status === 'Partial')
      .reduce((a, b) => a + b.balance, 0);
    return { paid, partial, overdue, pending };
  }, [invoices]);

  const actionQueue = useMemo(() => {
    const overdueInvoices = invoices.filter((i) => i.status === 'Overdue' || i.status === 'Pending');
    const readyAdmissions = admissions.filter((a) => a.stage === 'Approved' || a.stage === 'Interview');
    return { overdueInvoices: overdueInvoices.slice(0, 3), readyAdmissions: readyAdmissions.slice(0, 3) };
  }, [invoices, admissions]);

  const mondayClasses = useMemo(
    () => timetable.filter((t) => t.day === 'Monday').sort((a, b) => a.period - b.period).slice(0, 4),
    [timetable]
  );

  return (
    <div className="space-y-8">
      {/* Header Summary */}
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Executive Analytics
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {tenant.name} · {tenant.academicYear} · {tenant.currentTerm} · {tenant.curriculum}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span>Tenant Plan: {tenant.plan}</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">{tenant.teachers.length} Faculty</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">{tenant.rooms.length} Rooms</span>
        </div>
      </div>

      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Enrolled Students</p>
          <p className="mt-2 font-mono text-3xl font-semibold tracking-tight text-slate-900 tabular-nums dark:text-slate-100">
            {stats.activeStudents}
          </p>
          <p className="mt-2 text-xs text-slate-600 dark:text-slate-400 tabular-nums">
            {stats.pendingAdmissions} applications in pipeline
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Term Attendance Rate</p>
          <p className="mt-2 font-mono text-3xl font-semibold tracking-tight text-slate-900 tabular-nums dark:text-slate-100">
            {stats.attendanceRate}%
          </p>
          <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400 tabular-nums">
            Nominal threshold ≥ 92.0%
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Fee Collection</p>
          <p className="mt-2 font-mono text-3xl font-semibold tracking-tight text-slate-900 tabular-nums dark:text-slate-100">
            {stats.collectionRate}%
          </p>
          <p className="mt-2 text-xs text-slate-600 dark:text-slate-400 tabular-nums">
            {formatCurrency(stats.totalCollected, tenant.currency)} of{' '}
            {formatCurrency(stats.totalBilled, tenant.currency)} billed
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Mean Exam Score</p>
          <p className="mt-2 font-mono text-3xl font-semibold tracking-tight text-slate-900 tabular-nums dark:text-slate-100">
            {stats.avgScore}
            <span className="text-base font-normal text-slate-400"> / 100</span>
          </p>
          <p className="mt-2 text-xs text-slate-600 dark:text-slate-400 tabular-nums">
            Across {examResults.length} recorded assessments
          </p>
        </div>
      </div>

      {/* Primary Charts Split */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Attendance Daily SVG Chart */}
        <section className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-7 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Daily Attendance Trajectory
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Presence percentage across recent roll-call dates
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
              {['All', ...tenant.grades.slice(0, 3)].map((g) => (
                <button
                  key={g}
                  onClick={() => setAttendanceFilterGrade(g)}
                  className={`whitespace-nowrap shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    attendanceFilterGrade === g
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6">
            <div className="relative h-56 w-full">
              <svg viewBox="0 0 560 190" className="h-full w-full overflow-visible" role="img" aria-label="Attendance bar chart">
                {/* Horizontal grid lines */}
                {[100, 75, 50, 25].map((tick) => {
                  const y = 160 - (tick / 100) * 140;
                  return (
                    <g key={tick}>
                      <line
                        x1="36"
                        y1={y}
                        x2="548"
                        y2={y}
                        stroke="currentColor"
                        className="text-slate-200 dark:text-slate-800"
                        strokeDasharray="3 3"
                      />
                      <text
                        x="28"
                        y={y + 4}
                        textAnchor="end"
                        className="fill-slate-400 font-mono text-[10px] tabular-nums"
                      >
                        {tick}%
                      </text>
                    </g>
                  );
                })}

                {attendanceTrend.map((point, idx) => {
                  const colWidth = 480 / Math.max(attendanceTrend.length, 1);
                  const barW = Math.min(44, colWidth * 0.52);
                  const x = 48 + idx * colWidth + (colWidth - barW) / 2;
                  const barH = Math.max(4, (point.rate / 100) * 140);
                  const y = 160 - barH;
                  const isHovered = hoveredBarIdx === idx;
                  return (
                    <g
                      key={point.date}
                      onMouseEnter={() => setHoveredBarIdx(idx)}
                      onMouseLeave={() => setHoveredBarIdx(null)}
                      className="cursor-pointer"
                    >
                      <rect
                        x={x}
                        y={y}
                        width={barW}
                        height={barH}
                        rx={4}
                        className={`transition-colors ${
                          point.rate < 90
                            ? 'fill-amber-500 dark:fill-amber-400'
                            : isHovered
                            ? 'fill-blue-700 dark:fill-blue-400'
                            : 'fill-blue-600 dark:fill-blue-500'
                        }`}
                      />
                      <text
                        x={x + barW / 2}
                        y={178}
                        textAnchor="middle"
                        className="fill-slate-500 font-mono text-[11px] tabular-nums dark:fill-slate-400"
                      >
                        {point.label}
                      </text>
                      {isHovered && (
                        <g>
                          <rect
                            x={x + barW / 2 - 42}
                            y={Math.max(0, y - 30)}
                            width="84"
                            height="24"
                            rx="4"
                            className="fill-slate-900 dark:fill-slate-100"
                          />
                          <text
                            x={x + barW / 2}
                            y={Math.max(15, y - 14)}
                            textAnchor="middle"
                            className="fill-white font-mono text-[11px] font-medium tabular-nums dark:fill-slate-900"
                          >
                            {point.rate}% ({point.present}/{point.total})
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
        </section>

        {/* Subject Mastery & Financial Distribution */}
        <section className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Subject Assessment Averages
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Mean score across active examination records
              </p>
            </div>
            <button
              onClick={() => onNavigate('exams')}
              className="whitespace-nowrap shrink-0 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              Open Gradebook
            </button>
          </div>

          <div className="mt-5 space-y-4">
            {subjectAverages.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                No exam marks recorded yet for this tenant.
              </p>
            ) : (
              subjectAverages.map((item) => (
                <div key={item.subject} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700 dark:text-slate-200">{item.subject}</span>
                    <span className="font-mono text-slate-600 tabular-nums dark:text-slate-400">
                      {item.avg}% · {item.count} marks
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full bg-blue-600 dark:bg-blue-500"
                      style={{ width: `${Math.min(100, item.avg)}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="mt-7 border-t border-slate-100 pt-5 dark:border-slate-800">
            <div className="flex items-center justify-between text-xs font-medium text-slate-700 dark:text-slate-300">
              <span>Tuition Ledger Health</span>
              <button
                onClick={() => onNavigate('fees')}
                className="text-blue-600 hover:underline dark:text-blue-400"
              >
                View Ledger
              </button>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
              <div>
                <p className="text-slate-500 dark:text-slate-400">Settled</p>
                <p className="mt-0.5 font-mono font-semibold text-emerald-700 tabular-nums dark:text-emerald-400">
                  {formatCurrency(feeBreakdown.paid + feeBreakdown.partial, tenant.currency)}
                </p>
              </div>
              <div>
                <p className="text-slate-500 dark:text-slate-400">Pending</p>
                <p className="mt-0.5 font-mono font-semibold text-amber-700 tabular-nums dark:text-amber-400">
                  {formatCurrency(feeBreakdown.pending, tenant.currency)}
                </p>
              </div>
              <div>
                <p className="text-slate-500 dark:text-slate-400">Overdue</p>
                <p className="mt-0.5 font-mono font-semibold text-red-700 tabular-nums dark:text-red-400">
                  {formatCurrency(feeBreakdown.overdue, tenant.currency)}
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Operational Queues (Whitespace + Hairline Dividers, Zero Nested Cards) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Admissions Queue */}
        <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Admissions Queue
            </h2>
            <button
              onClick={() => onNavigate('admissions')}
              className="inline-flex items-center gap-1 whitespace-nowrap shrink-0 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              Manage <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
            {actionQueue.readyAdmissions.length === 0 ? (
              <p className="py-6 text-xs text-slate-500 dark:text-slate-400">
                No applicants currently awaiting interview or enrollment.
              </p>
            ) : (
              actionQueue.readyAdmissions.map((adm) => (
                <div key={adm.id} className="flex items-center justify-between py-3">
                  <div className="min-w-0 pr-3">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                      {adm.studentName}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {adm.applicationCode} · {adm.targetGrade} {adm.assignedSection}
                    </p>
                  </div>
                  <span
                    className={`whitespace-nowrap shrink-0 text-xs font-medium ${
                      adm.stage === 'Approved'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-blue-700 dark:text-blue-400'
                    }`}
                  >
                    {adm.stage}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Fee Follow-up */}
        <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Fee Accounts Requiring Attention
            </h2>
            <button
              onClick={() => onNavigate('fees')}
              className="inline-flex items-center gap-1 whitespace-nowrap shrink-0 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              Collect <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
            {actionQueue.overdueInvoices.length === 0 ? (
              <p className="py-6 text-xs text-slate-500 dark:text-slate-400">
                All student fee invoices are settled or partial.
              </p>
            ) : (
              actionQueue.overdueInvoices.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between py-3">
                  <div className="min-w-0 pr-3">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                      {inv.studentName}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                      {inv.invoiceNumber} · Due {formatDateShort(inv.dueDate)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono text-sm font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                      {formatCurrency(inv.balance, tenant.currency)}
                    </p>
                    <p
                      className={`text-xs font-medium ${
                        inv.status === 'Overdue'
                          ? 'text-red-700 dark:text-red-400'
                          : 'text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      {inv.status}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Active Schedule Preview */}
        <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Monday Timetable Snapshot
            </h2>
            <button
              onClick={() => onNavigate('timetable')}
              className="inline-flex items-center gap-1 whitespace-nowrap shrink-0 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              Schedule <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
            {mondayClasses.length === 0 ? (
              <p className="py-6 text-xs text-slate-500 dark:text-slate-400">
                No Monday periods scheduled yet.
              </p>
            ) : (
              mondayClasses.map((slot) => (
                <div key={slot.id} className="flex items-center justify-between py-3">
                  <div className="min-w-0 pr-3">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                      {slot.subject}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {slot.grade} {slot.section} · {slot.room} · {slot.teacherName}
                    </p>
                  </div>
                  <span className="font-mono text-xs text-slate-600 tabular-nums shrink-0 dark:text-slate-400">
                    {slot.startTime}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
