import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { CheckCircle2, Download, Plus, Printer, ShieldCheck, X, XCircle } from 'lucide-react';
import { TenantDocumentHeader } from '../TenantDocumentHeader';
import { createBrandedWorksheetFromObjects } from '../../lib/documentBranding';
import { saasApi } from '../../lib/api';
import { formatCurrency, formatDateShort } from '../../lib/format';
import {
  EXPENSE_CATEGORIES,
  type BudgetApprovalStatus,
} from '../../shared/types';
import type { FinanceControlPanelProps } from './types';

interface BudgetDisplayRow {
  rowKey: string;
  budgetId?: string;
  category: string;
  fiscalYear: string;
  term: string;
  isCustom: boolean;
  allocated: number;
  paid: number;
  committed: number;
  utilized: number;
  remaining: number;
  utilPct: number;
  status: BudgetApprovalStatus;
  notes?: string;
  approvedBy?: string;
  approvedAt?: string;
  approvalNotes?: string;
}

const STANDARD_TERM_OPTIONS = ['Term 1', 'Term 2', 'Term 3', 'Annual'];

export function BudgetTrackingPanel({
  workspace,
  canManage,
  canApprove = canManage,
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

  const fiscalYearOptions = useMemo(() => {
    const years = new Set<string>();
    if (tenant.academicYear) years.add(tenant.academicYear);
    budgets.forEach((b) => {
      if (b.fiscalYear) years.add(b.fiscalYear);
    });
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [budgets, tenant.academicYear]);

  const [selectedFiscalYear, setSelectedFiscalYear] = useState<string>(
    () => tenant.academicYear || fiscalYearOptions[0] || '2026–2027'
  );

  const [editingRowKey, setEditingRowKey] = useState<string | null>(null);
  const [draftBudget, setDraftBudget] = useState('');
  const [saving, setSaving] = useState(false);

  // Create Budget Modal state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createCategoryMode, setCreateCategoryMode] = useState<'standard' | 'custom'>('standard');
  const [createStandardCategory, setCreateStandardCategory] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [createCustomCategory, setCreateCustomCategory] = useState('');
  const [createFiscalYear, setCreateFiscalYear] = useState(
    () => tenant.academicYear || fiscalYearOptions[0] || '2026–2027'
  );
  const [createTerm, setCreateTerm] = useState(() => tenant.currentTerm || 'Term 1');
  const [createAmount, setCreateAmount] = useState('');
  const [createNotes, setCreateNotes] = useState('');
  const [creatingBudget, setCreatingBudget] = useState(false);

  const [approvalTarget, setApprovalTarget] = useState<{
    budgetId?: string;
    category: string;
    fiscalYear: string;
    term: string;
    allocated: number;
    decision: 'Approved' | 'Rejected';
  } | null>(null);
  const [approvalNotes, setApprovalNotes] = useState('');
  const [submittingApproval, setSubmittingApproval] = useState(false);

  const fiscalDateWindow = useMemo(() => {
    const match = /(\d{4})\D+(\d{4})/.exec(selectedFiscalYear);
    if (match) {
      const startYr = match[1];
      const endYr = match[2];
      return {
        startDate: `${startYr}-08-01`,
        endDate: `${endYr}-07-31`,
        startMonth: `${startYr}-08`,
        endMonth: `${endYr}-07`,
      };
    }
    const singleYr = /(\d{4})/.exec(selectedFiscalYear);
    if (singleYr) {
      return {
        startDate: `${singleYr[1]}-01-01`,
        endDate: `${singleYr[1]}-12-31`,
        startMonth: `${singleYr[1]}-01`,
        endMonth: `${singleYr[1]}-12`,
      };
    }
    return null;
  }, [selectedFiscalYear]);

  const rows: BudgetDisplayRow[] = useMemo(() => {
    const scopedBudgets = budgets.filter(
      (b) => !b.fiscalYear || b.fiscalYear === selectedFiscalYear
    );
    const scopedExpenses = fiscalDateWindow
      ? expenses.filter(
          (e) =>
            e.expenseDate >= fiscalDateWindow.startDate &&
            e.expenseDate <= fiscalDateWindow.endDate
        )
      : expenses;
    const scopedPayroll = fiscalDateWindow
      ? payrollEntries.filter(
          (p) =>
            p.payPeriod >= fiscalDateWindow.startMonth &&
            p.payPeriod <= fiscalDateWindow.endMonth
        )
      : payrollEntries;

    const payrollDisbursed = scopedPayroll
      .filter((p) => p.status === 'Disbursed')
      .reduce((s, p) => s + (p.totalEmployerCost ?? p.grossPay), 0);
    const payrollCommitted = scopedPayroll
      .filter((p) => p.status !== 'Disbursed')
      .reduce((s, p) => s + (p.totalEmployerCost ?? p.grossPay), 0);

    const standardCategorySet = new Set<string>(EXPENSE_CATEGORIES);
    const usedBudgetIds = new Set<string>();

    const buildRow = (
      category: string,
      alloc: (typeof budgets)[number] | undefined,
      isCustom: boolean,
      includeSpendMetrics: boolean
    ): BudgetDisplayRow => {
      const allocated = alloc?.allocatedAmount ?? 0;
      const status: BudgetApprovalStatus =
        alloc?.status || (allocated > 0 ? 'Pending Approval' : 'Draft');
      const fiscalYear = alloc?.fiscalYear || selectedFiscalYear;
      const term = alloc?.term || tenant.currentTerm || 'Term 1';

      let paid = 0;
      let committed = 0;
      if (includeSpendMetrics) {
        const catExpenses = scopedExpenses.filter(
          (e) => e.category.trim().toLowerCase() === category.trim().toLowerCase()
        );
        paid = catExpenses
          .filter((e) => e.status === 'Paid')
          .reduce((s, e) => s + e.amount, 0);
        committed = catExpenses
          .filter((e) => e.status !== 'Paid')
          .reduce((s, e) => s + e.amount, 0);

        if (category === 'Payroll & Allowances' && paid === 0 && committed === 0) {
          paid = payrollDisbursed;
          committed = payrollCommitted;
        }
      }

      const utilized = paid + committed;
      const remaining = allocated - utilized;
      const utilPct = allocated > 0 ? (utilized / allocated) * 100 : utilized > 0 ? 100 : 0;

      return {
        rowKey: alloc?.id ? `bdg:${alloc.id}` : `cat:${category}:${fiscalYear}:${term}`,
        budgetId: alloc?.id,
        category,
        fiscalYear,
        term,
        isCustom,
        allocated,
        paid,
        committed,
        utilized,
        remaining,
        utilPct,
        status,
        notes: alloc?.notes,
        approvedBy: alloc?.approvedBy,
        approvedAt: alloc?.approvedAt,
        approvalNotes: alloc?.approvalNotes,
      };
    };

    const result: BudgetDisplayRow[] = [];

    for (const category of EXPENSE_CATEGORIES) {
      const matches = scopedBudgets.filter(
        (b) => b.category.trim().toLowerCase() === category.toLowerCase()
      );
      if (matches.length > 0) {
        matches.forEach((alloc, idx) => {
          usedBudgetIds.add(alloc.id);
          result.push(buildRow(category, alloc, false, idx === 0));
        });
      } else {
        result.push(buildRow(category, undefined, false, true));
      }
    }

    // Include custom / additional budget lines created outside standard expense categories
    const customBudgets = scopedBudgets.filter(
      (b) => !usedBudgetIds.has(b.id) && !standardCategorySet.has(b.category)
    );
    const seenCustomSpend = new Set<string>();
    for (const alloc of customBudgets) {
      const key = alloc.category.trim().toLowerCase();
      const showSpend = !seenCustomSpend.has(key);
      seenCustomSpend.add(key);
      result.push(buildRow(alloc.category, alloc, true, showSpend));
    }

    return result;
  }, [budgets, expenses, payrollEntries, selectedFiscalYear, fiscalDateWindow, tenant.currentTerm]);

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

  function openCreateBudgetModal() {
    setCreateCategoryMode('standard');
    setCreateStandardCategory(EXPENSE_CATEGORIES[0]);
    setCreateCustomCategory('');
    setCreateFiscalYear(selectedFiscalYear || tenant.academicYear || '2026–2027');
    setCreateTerm(tenant.currentTerm || 'Term 1');
    setCreateAmount('');
    setCreateNotes('');
    setCreateModalOpen(true);
  }

  async function handleCreateBudgetSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    const categoryName =
      createCategoryMode === 'custom' ? createCustomCategory.trim() : createStandardCategory.trim();
    const parsedAmount = Number(createAmount);
    if (categoryName.length < 2) {
      onNotify('Enter a budget line or cost centre name (at least 2 characters).', 'error');
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      onNotify('Enter a positive budget ceiling amount.', 'error');
      return;
    }
    const targetYear = createFiscalYear.trim() || selectedFiscalYear;
    const targetTerm = createTerm.trim() || tenant.currentTerm || 'Term 1';

    setCreatingBudget(true);
    try {
      await saasApi.upsertBudgetAllocation(tenant.id, {
        category: categoryName,
        fiscalYear: targetYear,
        term: targetTerm,
        allocatedAmount: Math.round(parsedAmount),
        notes: createNotes.trim() || undefined,
      });
      if (targetYear && targetYear !== selectedFiscalYear) {
        setSelectedFiscalYear(targetYear);
      }
      await onRefresh();
      setCreateModalOpen(false);
      onNotify(
        `Budget line "${categoryName}" (${targetYear} · ${targetTerm}) saved as Pending Approval.`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to create budget line', 'error');
    } finally {
      setCreatingBudget(false);
    }
  }

  function handleExportBudgetExcel() {
    const sheetRows = rows.map((r) => ({
      Category: r.category,
      Fiscal_Year: r.fiscalYear,
      Term: r.term,
      Type: r.isCustom ? 'Custom Line' : 'Standard Votehead',
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
      `Departmental Budget Tracking & Approvals (${selectedFiscalYear})`,
      sheetRows
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Budget Variance');
    XLSX.writeFile(
      wb,
      `${tenant.slug}-budget-tracking-${new Date().toISOString().slice(0, 10)}.xlsx`
    );
    onNotify('Exported Budget vs Actuals Variance report to Excel.');
  }

  async function handleConfirmBudgetDecision(e: React.FormEvent) {
    e.preventDefault();
    if (!approvalTarget) return;
    setSubmittingApproval(true);
    try {
      await saasApi.approveBudgetAllocation(tenant.id, {
        budgetId: approvalTarget.budgetId,
        category: approvalTarget.category,
        fiscalYear: approvalTarget.fiscalYear,
        term: approvalTarget.term,
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
          subtitle={`${selectedFiscalYear} · ${tenant.currentTerm} · Per-votehead ceilings &amp; sign-off register`}
          rightMeta={[
            { label: 'Currency', value: tenant.currency },
            { label: 'Approved Lines', value: `${totals.approvedCount} / ${rows.length}` },
          ]}
          compact
        />
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Create departmental or project budgets, adjust ceilings, and route voteheads for independent sign-off by a designated Budget Approver, Admin, or separate Bursar.
          </p>
          <div className="flex flex-wrap items-center gap-2 no-print">
            {fiscalYearOptions.length > 0 && (
              <select
                aria-label="Filter by Fiscal Year"
                value={selectedFiscalYear}
                onChange={(e) => setSelectedFiscalYear(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                {fiscalYearOptions.map((fy) => (
                  <option key={fy} value={fy}>
                    FY {fy}
                  </option>
                ))}
              </select>
            )}
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
            {canManage && (
              <button
                type="button"
                onClick={openCreateBudgetModal}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700"
              >
                <Plus className="h-3.5 w-3.5" />
                Create Budget
              </button>
            )}
          </div>
        </div>
      </div>

      {canApprove && !canManage && (
        <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-xs text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-200">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
          <div>
            <strong>Budget Approver Authority Active:</strong> You can inspect all budget lines in read-only ledger mode and execute independent <strong>Approve</strong> or <strong>Reject</strong> sign-offs on pending departmental voteheads.
          </div>
        </div>
      )}

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
          <table className="w-full min-w-[980px] text-left text-xs">
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
                const isEditing = editingRowKey === r.rowKey;
                const overBudget = r.remaining < 0;
                const nearLimit = !overBudget && r.utilPct >= 85;
                return (
                  <tr key={r.rowKey} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="font-semibold text-slate-900 dark:text-slate-100">
                          {r.category}
                        </p>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {r.term}
                        </span>
                        {r.isCustom && (
                          <span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
                            Custom
                          </span>
                        )}
                      </div>
                      {r.notes && (
                        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          {r.notes}
                        </p>
                      )}
                      {r.approvedBy && (
                        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          {r.status} by {r.approvedBy}
                          {r.approvedAt ? ` · ${formatDateShort(r.approvedAt)}` : ''}
                        </p>
                      )}
                      {r.approvalNotes && (
                        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          Sign-off note: {r.approvalNotes}
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
                      {(canManage || canApprove) ? (
                        isEditing && canManage ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              disabled={saving}
                              onClick={async () => {
                                setSaving(true);
                                try {
                                  await saasApi.upsertBudgetAllocation(tenant.id, {
                                    id: r.budgetId,
                                    category: r.category,
                                    fiscalYear: r.fiscalYear,
                                    term: r.term,
                                    allocatedAmount: Number(draftBudget),
                                  });
                                  await onRefresh();
                                  setEditingRowKey(null);
                                  onNotify(
                                    `Updated ${r.category} ceiling (${
                                      Number(draftBudget) > 0 ? 'Pending Approval' : 'Draft'
                                    }).`
                                  );
                                } catch (err) {
                                  onNotify(
                                    err instanceof Error
                                      ? err.message
                                      : 'Unable to save budget ceiling',
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
                              onClick={() => setEditingRowKey(null)}
                              className="rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 dark:border-slate-700 dark:text-slate-300"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                            {canManage && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingRowKey(r.rowKey);
                                  setDraftBudget(String(r.allocated));
                                }}
                                className="rounded border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                              >
                                Set Limit
                              </button>
                            )}
                            {canApprove && r.allocated > 0 && r.status !== 'Approved' && (
                              <button
                                type="button"
                                onClick={() => {
                                  setApprovalNotes('');
                                  setApprovalTarget({
                                    budgetId: r.budgetId,
                                    category: r.category,
                                    fiscalYear: r.fiscalYear,
                                    term: r.term,
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
                            {canApprove && r.allocated > 0 && r.status !== 'Rejected' && (
                              <button
                                type="button"
                                onClick={() => {
                                  setApprovalNotes('');
                                  setApprovalTarget({
                                    budgetId: r.budgetId,
                                    category: r.category,
                                    fiscalYear: r.fiscalYear,
                                    term: r.term,
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
                        )
                      ) : (
                        <span className="text-[11px] text-slate-400">Read-only</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Budget Line Modal */}
      {createModalOpen && canManage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <form
            onSubmit={handleCreateBudgetSubmit}
            className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Create Budget Allocation
                </h3>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Define a new departmental votehead or custom cost-centre budget for approval.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreateModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="mb-1.5 block font-semibold text-slate-700 dark:text-slate-300">
                  Budget Line Type
                </label>
                <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800">
                  <button
                    type="button"
                    onClick={() => setCreateCategoryMode('standard')}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                      createCategoryMode === 'standard'
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Standard Votehead
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreateCategoryMode('custom')}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                      createCategoryMode === 'custom'
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Custom Cost Centre
                  </button>
                </div>
              </div>

              {createCategoryMode === 'standard' ? (
                <div>
                  <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">
                    Votehead / Expense Category
                  </label>
                  <select
                    value={createStandardCategory}
                    onChange={(e) => setCreateStandardCategory(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {EXPENSE_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">
                    Custom Budget Line Name
                  </label>
                  <input
                    type="text"
                    required
                    minLength={2}
                    maxLength={80}
                    value={createCustomCategory}
                    onChange={(e) => setCreateCustomCategory(e.target.value)}
                    placeholder="e.g. Science Lab Equipment Fund, Sports Tournament"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">
                    Fiscal Year
                  </label>
                  <input
                    type="text"
                    required
                    list="budget-fiscal-year-options"
                    value={createFiscalYear}
                    onChange={(e) => setCreateFiscalYear(e.target.value)}
                    placeholder="e.g. 2026–2027"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                  <datalist id="budget-fiscal-year-options">
                    {fiscalYearOptions.map((fy) => (
                      <option key={fy} value={fy} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">
                    Term / Cycle
                  </label>
                  <select
                    value={createTerm}
                    onChange={(e) => setCreateTerm(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {Array.from(
                      new Set([tenant.currentTerm || 'Term 1', ...STANDARD_TERM_OPTIONS])
                    ).map((tm) => (
                      <option key={tm} value={tm}>
                        {tm}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">
                  Allocated Budget Ceiling ({tenant.currency})
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  step="1"
                  value={createAmount}
                  onChange={(e) => setCreateAmount(e.target.value)}
                  placeholder="e.g. 450000"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">
                  Justification / Scope Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  value={createNotes}
                  onChange={(e) => setCreateNotes(e.target.value)}
                  placeholder="Optional breakdown or Board minute reference..."
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreateModalOpen(false)}
                className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creatingBudget}
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {creatingBudget ? 'Saving Budget...' : 'Save Budget Line'}
              </button>
            </div>
          </form>
        </div>
      )}

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
                  {approvalTarget.category} ({approvalTarget.fiscalYear} · {approvalTarget.term}) ·{' '}
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
