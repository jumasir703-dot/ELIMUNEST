import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { CheckCircle2, Download, FileText, Plus, Printer, X, XCircle } from 'lucide-react';
import { TenantDocumentHeader } from '../TenantDocumentHeader';
import { createBrandedWorksheetFromObjects } from '../../lib/documentBranding';
import { downloadBudgetReportPdf } from '../../lib/pdfDocuments';
import { saasApi } from '../../lib/api';
import { formatCurrency, formatDateShort } from '../../lib/format';
import {
  EXPENSE_CATEGORIES,
  type BudgetAllocation,
  type BudgetApprovalStatus,
} from '../../shared/types';
import type { FinanceControlPanelProps } from './types';

const CUSTOM_CATEGORY_SENTINEL = '__custom__';
const STANDARD_TERM_OPTIONS = ['Term 1', 'Term 2', 'Term 3', 'Annual'] as const;

interface BudgetRowView {
  rowKey: string;
  id?: string;
  category: string;
  fiscalYear: string;
  term: string;
  allocated: number;
  paid: number;
  committed: number;
  utilized: number;
  remaining: number;
  utilPct: number;
  status: BudgetApprovalStatus;
  notes?: string;
  createdByName?: string;
  approvedBy?: string;
  approvedAt?: string;
  approvalNotes?: string;
}

export function BudgetTrackingPanel({
  workspace,
  canManage,
  canApproveBudgets,
  actorRole,
  onRefresh,
  onNotify,
}: FinanceControlPanelProps) {
  const { tenant } = workspace;
  const canApprove = canApproveBudgets ?? canManage;
  const budgets = workspace.budgets || [];
  const academicYears = workspace.academicYears || [];
  const academicTerms = workspace.academicTerms || [];
  const expenses = useMemo(
    () => (workspace.expenses || []).filter((e) => !e.voided && !e.reversed),
    [workspace.expenses]
  );
  const payrollEntries = useMemo(
    () => (workspace.payrollEntries || []).filter((p) => !p.voided && !p.reversed),
    [workspace.payrollEntries]
  );

  const fiscalYearOptions = useMemo(() => {
    const set = new Set<string>();
    if (tenant.academicYear) set.add(tenant.academicYear);
    for (const ay of academicYears) {
      if (ay.name) set.add(ay.name);
    }
    for (const b of budgets) {
      if (b.fiscalYear) set.add(b.fiscalYear);
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [tenant.academicYear, academicYears, budgets]);

  const termFilterOptions = useMemo(() => {
    const set = new Set<string>(STANDARD_TERM_OPTIONS);
    if (tenant.currentTerm) set.add(tenant.currentTerm);
    for (const b of budgets) {
      if (b.term) set.add(b.term);
    }
    return Array.from(set);
  }, [tenant.currentTerm, budgets]);

  const [selectedFiscalYear, setSelectedFiscalYear] = useState<string>(
    tenant.academicYear || fiscalYearOptions[0] || String(new Date().getFullYear())
  );
  const [selectedTerm, setSelectedTerm] = useState<string>(
    tenant.currentTerm || 'Term 1'
  );

  const [editingRowKey, setEditingRowKey] = useState<string | null>(null);
  const [draftBudget, setDraftBudget] = useState('');
  const [saving, setSaving] = useState(false);

  // Create Budget Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createCategoryChoice, setCreateCategoryChoice] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [createCustomCategory, setCreateCustomCategory] = useState('');
  const [createFiscalYear, setCreateFiscalYear] = useState<string>(
    tenant.academicYear || String(new Date().getFullYear())
  );
  const [createTerm, setCreateTerm] = useState<string>(tenant.currentTerm || 'Term 1');
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

  const matchesFiscalScope = useMemo(() => {
    const yearEntity = academicYears.find(
      (ay) => ay.name.toLowerCase() === selectedFiscalYear.toLowerCase()
    );
    const yearPrefixMatch = selectedFiscalYear.match(/\d{4}/)?.[0] || '';
    const termEntity =
      selectedTerm === 'All Terms' || selectedTerm === 'Annual'
        ? null
        : academicTerms.find((t) => {
            const nameMatches = t.name.toLowerCase() === selectedTerm.toLowerCase();
            if (!nameMatches) return false;
            if (yearEntity) return t.academicYearId === yearEntity.id;
            return yearPrefixMatch ? t.startDate.startsWith(yearPrefixMatch) : true;
          }) || null;

    return (isoDate: string, payPeriod?: string) => {
      if (termEntity) {
        return isoDate >= termEntity.startDate && isoDate <= termEntity.endDate;
      }
      if (yearEntity) {
        return isoDate >= yearEntity.startDate && isoDate <= yearEntity.endDate;
      }
      if (yearPrefixMatch) {
        return (
          isoDate.startsWith(yearPrefixMatch) ||
          Boolean(payPeriod && payPeriod.startsWith(yearPrefixMatch))
        );
      }
      return true;
    };
  }, [academicYears, academicTerms, selectedFiscalYear, selectedTerm]);

  const rows: BudgetRowView[] = useMemo(() => {
    const yearBudgets = budgets.filter(
      (b) => (b.fiscalYear || tenant.academicYear).toLowerCase() === selectedFiscalYear.toLowerCase()
    );
    const scopedExpenses = expenses.filter((e) => matchesFiscalScope(e.expenseDate));
    const scopedPayroll = payrollEntries.filter((p) =>
      matchesFiscalScope(
        p.approvedAt?.slice(0, 10) || p.updatedAt?.slice(0, 10) || `${p.payPeriod}-28`,
        p.payPeriod
      )
    );

    const payrollDisbursed = scopedPayroll
      .filter((p) => p.status === 'Disbursed')
      .reduce((s, p) => s + (p.totalEmployerCost ?? p.grossPay), 0);
    const payrollCommitted = scopedPayroll
      .filter((p) => p.status !== 'Disbursed')
      .reduce((s, p) => s + (p.totalEmployerCost ?? p.grossPay), 0);

    const computeCategorySpend = (cat: string) => {
      const catExpenses = scopedExpenses.filter(
        (e) => e.category.toLowerCase() === cat.toLowerCase()
      );
      let paid = catExpenses
        .filter((e) => e.status === 'Paid')
        .reduce((s, e) => s + e.amount, 0);
      let committed = catExpenses
        .filter((e) => e.status !== 'Paid')
        .reduce((s, e) => s + e.amount, 0);
      if (cat === 'Payroll & Allowances' && paid === 0 && committed === 0) {
        paid = payrollDisbursed;
        committed = payrollCommitted;
      }
      return { paid, committed };
    };

    if (selectedTerm === 'All Terms') {
      const seenCategories = new Set<string>();
      const out: BudgetRowView[] = [];
      const allCats = Array.from(
        new Set<string>([
          ...EXPENSE_CATEGORIES,
          ...yearBudgets.map((b) => b.category),
          ...scopedExpenses.map((e) => e.category),
        ])
      );
      for (const category of allCats) {
        if (seenCategories.has(category.toLowerCase())) continue;
        seenCategories.add(category.toLowerCase());
        const matching = yearBudgets.filter(
          (b) => b.category.toLowerCase() === category.toLowerCase()
        );
        const { paid, committed } = computeCategorySpend(category);
        if (matching.length === 0) {
          const utilized = paid + committed;
          out.push({
            rowKey: `${selectedFiscalYear}::All::${category}`,
            category,
            fiscalYear: selectedFiscalYear,
            term: tenant.currentTerm,
            allocated: 0,
            paid,
            committed,
            utilized,
            remaining: -utilized,
            utilPct: utilized > 0 ? 100 : 0,
            status: 'Draft',
          });
        } else if (matching.length === 1) {
          const alloc = matching[0];
          const allocated = alloc.allocatedAmount;
          const utilized = paid + committed;
          const remaining = allocated - utilized;
          out.push({
            rowKey: alloc.id,
            id: alloc.id,
            category: alloc.category,
            fiscalYear: alloc.fiscalYear,
            term: alloc.term || tenant.currentTerm,
            allocated,
            paid,
            committed,
            utilized,
            remaining,
            utilPct: allocated > 0 ? (utilized / allocated) * 100 : utilized > 0 ? 100 : 0,
            status: alloc.status || 'Approved',
            notes: alloc.notes,
            createdByName: alloc.createdByName,
            approvedBy: alloc.approvedBy,
            approvedAt: alloc.approvedAt,
            approvalNotes: alloc.approvalNotes,
          });
        } else {
          for (const alloc of matching) {
            out.push({
              rowKey: alloc.id,
              id: alloc.id,
              category: alloc.category,
              fiscalYear: alloc.fiscalYear,
              term: alloc.term || tenant.currentTerm,
              allocated: alloc.allocatedAmount,
              paid,
              committed,
              utilized: paid + committed,
              remaining: alloc.allocatedAmount - (paid + committed),
              utilPct:
                alloc.allocatedAmount > 0
                  ? ((paid + committed) / alloc.allocatedAmount) * 100
                  : 0,
              status: alloc.status || 'Approved',
              notes: alloc.notes,
              createdByName: alloc.createdByName,
              approvedBy: alloc.approvedBy,
              approvedAt: alloc.approvedAt,
              approvalNotes: alloc.approvalNotes,
            });
          }
        }
      }
      return out;
    }

    const termBudgets = yearBudgets.filter(
      (b) => (b.term || tenant.currentTerm).toLowerCase() === selectedTerm.toLowerCase()
    );
    const categoriesOrder = Array.from(
      new Set<string>([
        ...EXPENSE_CATEGORIES,
        ...termBudgets.map((b) => b.category),
      ])
    );

    const seen = new Set<string>();
    const result: BudgetRowView[] = [];
    for (const category of categoriesOrder) {
      const lower = category.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);

      const alloc: BudgetAllocation | undefined = termBudgets.find(
        (b) => b.category.toLowerCase() === lower
      );
      const allocated = alloc?.allocatedAmount ?? 0;
      const status: BudgetApprovalStatus =
        alloc?.status || (allocated > 0 ? 'Pending Approval' : 'Draft');
      const { paid, committed } = computeCategorySpend(category);
      const utilized = paid + committed;
      const remaining = allocated - utilized;
      const utilPct = allocated > 0 ? (utilized / allocated) * 100 : utilized > 0 ? 100 : 0;

      result.push({
        rowKey: alloc?.id || `${selectedFiscalYear}::${selectedTerm}::${category}`,
        id: alloc?.id,
        category: alloc?.category || category,
        fiscalYear: alloc?.fiscalYear || selectedFiscalYear,
        term: alloc?.term || selectedTerm,
        allocated,
        paid,
        committed,
        utilized,
        remaining,
        utilPct,
        status,
        notes: alloc?.notes,
        createdByName: alloc?.createdByName,
        approvedBy: alloc?.approvedBy,
        approvedAt: alloc?.approvedAt,
        approvalNotes: alloc?.approvalNotes,
      });
    }
    return result;
  }, [budgets, expenses, payrollEntries, selectedFiscalYear, selectedTerm, tenant.academicYear, tenant.currentTerm, matchesFiscalScope]);

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
    setCreateCategoryChoice(EXPENSE_CATEGORIES[0]);
    setCreateCustomCategory('');
    setCreateFiscalYear(selectedFiscalYear || tenant.academicYear || String(new Date().getFullYear()));
    setCreateTerm(selectedTerm === 'All Terms' ? tenant.currentTerm : selectedTerm);
    setCreateAmount('');
    setCreateNotes('');
    setShowCreateModal(true);
  }

  async function handleCreateBudgetSubmit(e: React.FormEvent) {
    e.preventDefault();
    const resolvedCategory =
      createCategoryChoice === CUSTOM_CATEGORY_SENTINEL
        ? createCustomCategory.trim()
        : createCategoryChoice;
    if (resolvedCategory.length < 2) {
      onNotify('Enter a budget category or department name (min 2 characters).', 'error');
      return;
    }
    const parsedAmount = Number(createAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      onNotify('Enter a valid non-negative budget amount.', 'error');
      return;
    }
    setCreatingBudget(true);
    try {
      await saasApi.upsertBudgetAllocation(tenant.id, {
        category: resolvedCategory,
        allocatedAmount: Math.round(parsedAmount),
        fiscalYear: createFiscalYear.trim() || tenant.academicYear,
        term: createTerm.trim() || tenant.currentTerm,
        notes: createNotes.trim() || undefined,
      });
      await onRefresh();
      setSelectedFiscalYear(createFiscalYear.trim() || tenant.academicYear);
      setSelectedTerm(createTerm.trim() || tenant.currentTerm);
      setShowCreateModal(false);
      onNotify(
        `Created budget "${resolvedCategory}" (${createFiscalYear} · ${createTerm}) for ${formatCurrency(
          Math.round(parsedAmount),
          tenant.currency
        )}.`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to create budget', 'error');
    } finally {
      setCreatingBudget(false);
    }
  }

  function handleExportBudgetExcel() {
    const sheetRows = rows.map((r) => ({
      Category: r.category,
      Fiscal_Year: r.fiscalYear,
      Term: r.term,
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
      `Departmental Budget Tracking & Approvals (${selectedFiscalYear} · ${selectedTerm})`,
      sheetRows
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Budget Variance');
    XLSX.writeFile(wb, `${tenant.slug}-budget-tracking-${new Date().toISOString().slice(0, 10)}.xlsx`);
    onNotify('Exported Budget vs Actuals Variance report to Excel.');
  }

  async function handleDownloadBudgetPdf() {
    try {
      const fileName = await downloadBudgetReportPdf({
        tenant,
        fiscalYear: selectedFiscalYear,
        term: selectedTerm,
        totals,
        rows,
      });
      onNotify(`Downloaded Budget Tracking PDF (${fileName}).`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to generate Budget PDF', 'error');
    }
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
          subtitle={`${selectedFiscalYear} · ${selectedTerm} · Per-votehead ceilings &amp; sign-off register`}
          rightMeta={[
            { label: 'Currency', value: tenant.currency },
            { label: 'Approved Lines', value: `${totals.approvedCount} / ${rows.length}` },
          ]}
          compact
        />
        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2.5 no-print">
            <div>
              <label
                htmlFor="budget-year-filter"
                className="mr-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-400"
              >
                Fiscal Year
              </label>
              <select
                id="budget-year-filter"
                value={selectedFiscalYear}
                onChange={(e) => setSelectedFiscalYear(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                {fiscalYearOptions.map((yr) => (
                  <option key={yr} value={yr}>
                    {yr}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="budget-term-filter"
                className="mr-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-400"
              >
                Term
              </label>
              <select
                id="budget-term-filter"
                value={selectedTerm}
                onChange={(e) => setSelectedTerm(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="All Terms">All Terms</option>
                {termFilterOptions.map((tm) => (
                  <option key={tm} value={tm}>
                    {tm}
                  </option>
                ))}
              </select>
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {canApprove && !canManage
                ? 'Budget Approver mode: review ceilings and sign off pending lines below.'
                : 'Create custom department budgets or revise ceilings; approvals follow maker-checker sign-off.'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 no-print">
            {canManage && (
              <button
                type="button"
                onClick={openCreateBudgetModal}
                className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700"
              >
                <Plus className="h-3.5 w-3.5" />
                Create Budget
              </button>
            )}
            <button
              type="button"
              onClick={handleDownloadBudgetPdf}
              className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <FileText className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
              Download PDF
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <Printer className="h-3.5 w-3.5" />
              Print Report
            </button>
            <button
              type="button"
              onClick={handleExportBudgetExcel}
              className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
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
                      <p className="font-semibold text-slate-900 dark:text-slate-100">
                        {r.category}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] text-slate-500 dark:text-slate-400">
                        {r.fiscalYear} · {r.term}
                        {r.createdByName ? ` · Prepared by ${r.createdByName}` : ''}
                      </p>
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
                      {canManage && isEditing ? (
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            disabled={saving}
                            onClick={async () => {
                              setSaving(true);
                              try {
                                await saasApi.upsertBudgetAllocation(tenant.id, {
                                  id: r.id,
                                  category: r.category,
                                  allocatedAmount: Number(draftBudget),
                                  fiscalYear: r.fiscalYear,
                                  term: r.term,
                                });
                                await onRefresh();
                                setEditingRowKey(null);
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
                            onClick={() => setEditingRowKey(null)}
                            className="rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 dark:border-slate-700 dark:text-slate-300"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (canManage || canApprove) ? (
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
                                  budgetId: r.id,
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
                                  budgetId: r.id,
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
                      ) : (
                        <span className="font-mono text-[11px] text-slate-400">Read Only</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Budget Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <form
            onSubmit={handleCreateBudgetSubmit}
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Create Departmental Budget
                </h3>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Define a new budget ceiling for a standard votehead or custom department. Submitted ceilings require sign-off by a Budget Approver or Admin.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Budget Category / Cost Centre *
                </label>
                <select
                  value={createCategoryChoice}
                  onChange={(e) => setCreateCategoryChoice(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  {EXPENSE_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                  <option value={CUSTOM_CATEGORY_SENTINEL}>
                    Custom Department / Budget Line...
                  </option>
                </select>
                {createCategoryChoice === CUSTOM_CATEGORY_SENTINEL && (
                  <input
                    type="text"
                    required
                    value={createCustomCategory}
                    onChange={(e) => setCreateCustomCategory(e.target.value)}
                    placeholder="e.g. Co-Curricular & Sports, Science Lab Upgrade"
                    className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Fiscal Year *
                  </label>
                  <select
                    value={createFiscalYear}
                    onChange={(e) => setCreateFiscalYear(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {fiscalYearOptions.map((yr) => (
                      <option key={yr} value={yr}>
                        {yr}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Academic Term *
                  </label>
                  <select
                    value={createTerm}
                    onChange={(e) => setCreateTerm(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {STANDARD_TERM_OPTIONS.map((tm) => (
                      <option key={tm} value={tm}>
                        {tm}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Allocated Budget Ceiling ({tenant.currency}) *
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={createAmount}
                  onChange={(e) => setCreateAmount(e.target.value)}
                  placeholder={tenant.currency === 'KES' ? '350000' : '5000'}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Budget Scope / Justification Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  value={createNotes}
                  onChange={(e) => setCreateNotes(e.target.value)}
                  placeholder="e.g. Termly allocation for lab reagents, athletics travel, or ICT maintenance"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creatingBudget}
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {creatingBudget ? 'Creating...' : 'Save Budget Line'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Budget Approval Decision Modal */}
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
