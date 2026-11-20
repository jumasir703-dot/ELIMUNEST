import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { CheckCircle2, Download, Printer, X, XCircle } from 'lucide-react';
import { TenantDocumentHeader } from '../TenantDocumentHeader';
import { createBrandedWorksheetFromObjects } from '../../lib/documentBranding';
import { saasApi } from '../../lib/api';
import { formatCurrency, formatDateShort } from '../../lib/format';
import {
  EXPENSE_CATEGORIES,
  type BudgetApprovalStatus,
  type ExpenseCategory,
} from '../../shared/types';
import type { FinanceControlPanelProps } from './types';

export function BudgetTrackingPanel({
  workspace,
  canManage,
  actorRole,
  onRefresh,
  onNotify,
}: FinanceControlPanelProps) {
  const { tenant } = workspace;
  const budgets = workspace.budgets || [];
  const expenses = useMemo(
    () => (workspace.expenses || []).filter((e) => !e.voided && !e.reversed),
    [workspace.expenses]
  );
  const payrollEntries = useMemo(
    () => (workspace.payrollEntries || []).filter((p) => !p.voided && !p.reversed),
    [workspace.payrollEntries]
  );

  const [editingCategory, setEditingCategory] = useState<ExpenseCategory | null>(null);
  const [draftBudget, setDraftBudget] = useState('');
  const [saving, setSaving] = useState(false);

  const [approvalTarget, setApprovalTarget] = useState<{
    category: ExpenseCategory;
    allocated: number;
    decision: 'Approved' | 'Rejected';
  } | null>(null);
  const [approvalNotes, setApprovalNotes] = useState('');
  const [submittingApproval, setSubmittingApproval] = useState(false);

  const rows = useMemo(() => {
    const payrollDisbursed = payrollEntries
      .filter((p) => p.status === 'Disbursed')
      .reduce((s, p) => s + (p.totalEmployerCost ?? p.grossPay), 0);
    const payrollCommitted = payrollEntries
      .filter((p) => p.status !== 'Disbursed')
      .reduce((s, p) => s + (p.totalEmployerCost ?? p.grossPay), 0);

    return EXPENSE_CATEGORIES.map((category) => {
      const alloc = budgets.find((b) => b.category === category);
      const allocated = alloc?.allocatedAmount ?? 0;
      const status: BudgetApprovalStatus =
        alloc?.status || (allocated > 0 ? 'Pending Approval' : 'Draft');

      const catExpenses = expenses.filter((e) => e.category === category);
      let paid = catExpenses
        .filter((e) => e.status === 'Paid')
        .reduce((s, e) => s + e.amount, 0);
      let committed = catExpenses
        .filter((e) => e.status !== 'Paid')
        .reduce((s, e) => s + e.amount, 0);

      if (category === 'Payroll & Allowances' && paid === 0 && committed === 0) {
        paid = payrollDisbursed;
        committed = payrollCommitted;
      }

      const utilized = paid + committed;
      const remaining = allocated - utilized;
      const utilPct = allocated > 0 ? (utilized / allocated) * 100 : utilized > 0 ? 100 : 0;

      return {
        category,
        allocated,
        paid,
        committed,
        utilized,
        remaining,
        utilPct,
        status,
        approvedBy: alloc?.approvedBy,
        approvedAt: alloc?.approvedAt,
        approvalNotes: alloc?.approvalNotes,
      };
    });
  }, [budgets, expenses, payrollEntries]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => {
          acc.allocated += r.allocated;
          if (r.status === 'Approved') {
            acc.approvedAllocated += r.allocated;
            acc.approvedCount += 1;
          } else if (r.status === 'Pending Approval' && r.allocated > 0) {
            acc.pendingAllocated += r.allocated;
            acc.pendingCount += 1;
          }
          acc.paid += r.paid;
          acc.committed += r.committed;
          acc.remaining += r.remaining;
          return acc;
        },
        {
          allocated: 0,
          approvedAllocated: 0,
          approvedCount: 0,
          pendingAllocated: 0,
          pendingCount: 0,
          paid: 0,
          committed: 0,
          remaining: 0,
        }
      ),
    [rows]
  );

  function handleExportBudgetExcel() {
    const sheetRows = rows.map((r) => ({
      Category: r.category,
      Approval_Status: r.status,
      Allocated_Budget: r.allocated,
      Disbursed_Actual: r.paid,
      Committed_Pending: r.committed,
      Total_Utilized: r.utilized,
      Remaining_Variance: r.remaining,
      Utilization_Pct: Number(r.utilPct.toFixed(1)),
      Approved_By: r.approvedBy || '',
      Approval_Notes: r.approvalNotes || '',
    }));
    const ws = createBrandedWorksheetFromObjects(
      tenant,
      `Departmental Budget Tracking & Approvals (${tenant.academicYear} ${tenant.currentTerm})`,
      sheetRows
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Budget Variance');
    XLSX.writeFile(wb, `${tenant.slug}-budget-tracking-${new Date().toISOString().slice(0, 10)}.xlsx`);
    onNotify('Exported Budget vs Actuals Variance report to Excel.');
  }

  async function handleConfirmBudgetDecision(e: React.FormEvent) {
    e.preventDefault();
    if (!approvalTarget) return;
    setSubmittingApproval(true);
    try {
      await saasApi.approveBudgetAllocation(tenant.id, {
        category: approvalTarget.category,
        status: approvalTarget.decision,
        approvedBy: `${actorRole} Office`,
        approvalNotes: approvalNotes.trim() || undefined,
      });
      await onRefresh();
      onNotify(
        `${approvalTarget.decision} budget line "${approvalTarget.category}" (${formatCurrency(
          approvalTarget.allocated,
          tenant.currency
        )}).`
      );
      setApprovalTarget(null);
      setApprovalNotes('');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to update budget approval', 'error');
    } finally {
      setSubmittingApproval(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <TenantDocumentHeader
          tenant={tenant}
          documentTitle="Departmental Budget Tracking &amp; Approval Schedule"
          subtitle={`${tenant.academicYear} · ${tenant.currentTerm} · Per-votehead ceilings &amp; sign-off register`}
          rightMeta={[
            { label: 'Currency', value: tenant.currency },
            { label: 'Approved Lines', value: `${totals.approvedCount} / ${rows.length}` },
          ]}
          compact
        />
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Adjust any department ceiling and approve or reject individual budget voteheads directly below.
          </p>
          <div className="flex flex-wrap items-center gap-2 no-print">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <Printer className="h-3.5 w-3.5" />
              Print Report
            </button>
            <button
              type="button"
              onClick={handleExportBudgetExcel}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <Download className="h-3.5 w-3.5" />
              Export Variance (.xlsx)
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Approved Budget ({totals.approvedCount})
          </p>
          <p className="mt-1 font-mono text-lg font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
            {formatCurrency(totals.approvedAllocated, tenant.currency)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Pending Budget Approval ({totals.pendingCount})
          </p>
          <p className="mt-1 font-mono text-lg font-bold tabular-nums text-amber-600 dark:text-amber-400">
            {formatCurrency(totals.pendingAllocated, tenant.currency)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Disbursed + Committed</p>
          <p className="mt-1 font-mono text-lg font-bold tabular-nums text-rose-700 dark:text-rose-400">
            {formatCurrency(totals.paid + totals.committed, tenant.currency)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Available Budget Headroom</p>
          <p
            className={`mt-1 font-mono text-lg font-bold tabular-nums ${
              totals.remaining >= 0
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-rose-700 dark:text-rose-400'
            }`}
          >
            {formatCurrency(totals.remaining, tenant.currency)}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Cost Centre / Budget Line</th>
                <th className="px-4 py-3 text-right">Budget Ceiling</th>
                <th className="px-4 py-3">Approval Status</th>
                <th className="px-4 py-3 text-right">Paid Actual</th>
                <th className="px-4 py-3 text-right">Committed</th>
                <th className="px-4 py-3 text-right">Available</th>
                <th className="px-4 py-3">Utilization</th>
                <th className="px-4 py-3 text-right no-print">Ceiling &amp; Approval Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((r) => {
                const isEditing = editingCategory === r.category;
                const overBudget = r.remaining < 0;
                const nearLimit = !overBudget && r.utilPct >= 85;
                return (
                  <tr key={r.category} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 align-top">
                      <p className="font-semibold text-slate-900 dark:text-slate-100">
                        {r.category}
                      </p>
                      {r.approvedBy && (
                        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          {r.status} by {r.approvedBy}
                          {r.approvedAt ? ` · ${formatDateShort(r.approvedAt)}` : ''}
                        </p>
                      )}
                      {r.approvalNotes && (
                        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          Note: {r.approvalNotes}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right align-top font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {isEditing ? (
                        <input
                          type="number"
                          min="0"
                          value={draftBudget}
                          onChange={(e) => setDraftBudget(e.target.value)}
                          className="w-28 rounded border border-blue-400 bg-white px-2 py-1 text-right font-mono text-xs dark:bg-slate-800 dark:text-slate-100"
                        />
                      ) : (
                        formatCurrency(r.allocated, tenant.currency)
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span
                        className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                          r.status === 'Approved'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                            : r.status === 'Rejected'
                            ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
                            : r.status === 'Pending Approval'
                            ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                            : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right align-top font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {formatCurrency(r.paid, tenant.currency)}
                    </td>
                    <td className="px-4 py-3 text-right align-top font-mono tabular-nums text-amber-700 dark:text-amber-400">
                      {formatCurrency(r.committed, tenant.currency)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right align-top font-mono font-bold tabular-nums ${
                        overBudget
                          ? 'text-rose-700 dark:text-rose-400'
                          : 'text-emerald-700 dark:text-emerald-400'
                      }`}
                    >
                      {formatCurrency(r.remaining, tenant.currency)}
                    </td>
                    <td className="w-40 px-4 py-3 align-top">
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                          <div
                            className={`h-full rounded ${
                              overBudget
                                ? 'bg-rose-600'
                                : nearLimit
                                ? 'bg-amber-500'
                                : 'bg-blue-600'
                            }`}
                            style={{ width: `${Math.min(100, Math.max(2, r.utilPct))}%` }}
                          />
                        </div>
                        <span className="w-10 text-right font-mono text-[11px] tabular-nums text-slate-600 dark:text-slate-300">
                          {r.utilPct.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right align-top no-print">
                      {canManage &&
                        (isEditing ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              disabled={saving}
                              onClick={async () => {
                                setSaving(true);
                                try {
                                  await saasApi.upsertBudgetAllocation(tenant.id, {
                                    category: r.category,
                                    allocatedAmount: Number(draftBudget),
                                  });
                                  await onRefresh();
                                  setEditingCategory(null);
                                  onNotify(
                                    `Updated ${r.category} ceiling (${Number(draftBudget) > 0 ? 'Pending Approval' : 'Draft'}).`
                                  );
                                } catch (err) {
                                  onNotify(
                                    err instanceof Error ? err.message : 'Unable to save budget ceiling',
                                    'error'
                                  );
                                } finally {
                                  setSaving(false);
                                }
                              }}
                              className="rounded bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingCategory(null)}
                              className="rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 dark:border-slate-700 dark:text-slate-300"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingCategory(r.category);
                                setDraftBudget(String(r.allocated));
                              }}
                              className="rounded border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                            >
                              Set Limit
                            </button>
                            {r.allocated > 0 && r.status !== 'Approved' && (
                              <button
                                type="button"
                                onClick={() => {
                                  setApprovalNotes('');
                                  setApprovalTarget({
                                    category: r.category,
                                    allocated: r.allocated,
                                    decision: 'Approved',
                                  });
                                }}
                                className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                              >
                                <CheckCircle2 className="h-3 w-3" />
                                Approve
                              </button>
                            )}
                            {r.allocated > 0 && r.status !== 'Rejected' && (
                              <button
                                type="button"
                                onClick={() => {
                                  setApprovalNotes('');
                                  setApprovalTarget({
                                    category: r.category,
                                    allocated: r.allocated,
                                    decision: 'Rejected',
                                  });
                                }}
                                className="inline-flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                              >
                                <XCircle className="h-3 w-3" />
                                Reject
                              </button>
                            )}
                          </div>
                        ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {approvalTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <form
            onSubmit={handleConfirmBudgetDecision}
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  {approvalTarget.decision === 'Approved'
                    ? 'Approve Specific Budget Line'
                    : 'Reject Budget Line'}
                </h3>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {approvalTarget.category} ·{' '}
                  <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                    {formatCurrency(approvalTarget.allocated, tenant.currency)}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setApprovalTarget(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4">
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Sign-Off Remarks / Minute Reference (Optional)
              </label>
              <textarea
                rows={3}
                value={approvalNotes}
                onChange={(e) => setApprovalNotes(e.target.value)}
                placeholder={
                  approvalTarget.decision === 'Approved'
                    ? 'e.g. Approved under Term Budget Review — MIN/FIN/04'
                    : 'e.g. Revise ceiling downwards before resubmission'
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setApprovalTarget(null)}
                className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submittingApproval}
                className={`rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 ${
                  approvalTarget.decision === 'Approved'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                {submittingApproval
                  ? 'Saving...'
                  : approvalTarget.decision === 'Approved'
                  ? 'Confirm Budget Approval'
                  : 'Confirm Rejection'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
