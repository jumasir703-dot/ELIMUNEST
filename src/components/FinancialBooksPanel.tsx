import { useMemo, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Printer,
  Scale,
} from 'lucide-react';
import {
  buildFinancialBooksReport,
  downloadFinancialBooksExcel,
  type AccountingExportBook,
} from '../lib/accounting';
import { formatCurrency, formatDateShort } from '../lib/format';
import type { TenantWorkspaceData } from '../shared/types';

interface FinancialBooksPanelProps {
  workspace: TenantWorkspaceData;
  onNotify: (title: string, tone?: 'success' | 'error') => void;
}

type BookStatementView =
  | 'pl'
  | 'balance-sheet'
  | 'trial-balance'
  | 'cash-flow'
  | 'cashbook'
  | 'schedules';

export function FinancialBooksPanel({ workspace, onNotify }: FinancialBooksPanelProps) {
  const { tenant, feeStructures, invoices } = workspace;
  const expenses = workspace.expenses || [];

  const [activeBook, setActiveBook] = useState<BookStatementView>('pl');
  const [asOfDate, setAsOfDate] = useState<string>('');
  const [scheduleTab, setScheduleTab] = useState<'debtors' | 'payables'>('debtors');

  const report = useMemo(
    () =>
      buildFinancialBooksReport({
        tenant,
        feeStructures,
        invoices,
        expenses,
        asOfDate: asOfDate || undefined,
      }),
    [tenant, feeStructures, invoices, expenses, asOfDate]
  );

  function handleDownload(book: AccountingExportBook, label: string) {
    try {
      const fileName = downloadFinancialBooksExcel(report, book);
      onNotify(`Downloaded ${label} (${fileName}).`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Excel export failed', 'error');
    }
  }

  return (
    <div className="space-y-6">
      {/* Financial Books Control Bar */}
      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 lg:flex-row lg:items-center lg:justify-between dark:border-slate-800 dark:bg-slate-900">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
            <BookOpen className="h-4 w-4 text-slate-500 dark:text-slate-400" />
            <span>Statutory &amp; Management Accounting</span>
            <span aria-hidden="true">·</span>
            <span>{tenant.currency}</span>
            <span aria-hidden="true">·</span>
            <span>As of {formatDateShort(report.asOfDate)}</span>
          </div>
          <h2 className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
            Financial Books &amp; Accounting Statements
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Reconciled P&amp;L Statement, Balance Sheet, Trial Balance, Cash Flow Statement, General Cashbook, and Audit Schedules.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 no-print">
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-800">
            <label
              htmlFor="books-as-of-date"
              className="text-[11px] font-medium text-slate-600 whitespace-nowrap dark:text-slate-300"
            >
              Cutoff Date
            </label>
            <input
              id="books-as-of-date"
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="bg-transparent font-mono text-xs text-slate-900 focus:outline-none dark:text-slate-100"
            />
            {asOfDate && (
              <button
                type="button"
                onClick={() => setAsOfDate('')}
                className="text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                Reset
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 whitespace-nowrap shrink-0 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <Printer className="h-3.5 w-3.5" />
            Print Statement
          </button>

          <button
            type="button"
            onClick={() => handleDownload('ALL_BOOKS', 'Complete Financial Books Pack')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white whitespace-nowrap shrink-0 hover:bg-blue-700"
          >
            <Download className="h-3.5 w-3.5" />
            Download Complete Books (.xlsx)
          </button>
        </div>
      </div>

      {/* Accounting Health & Reconciliation Bar */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Net Operating Surplus (P&amp;L)
          </p>
          <p
            className={`mt-1.5 font-mono text-xl font-bold tabular-nums ${
              report.netOperatingSurplus >= 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {formatCurrency(report.netOperatingSurplus, tenant.currency)}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Expense ratio {report.expenseToRevenuePct.toFixed(1)}% of billed income
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Total Assets (Balance Sheet)
          </p>
          <p className="mt-1.5 font-mono text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {formatCurrency(report.totalCurrentAssets, tenant.currency)}
          </p>
          <p className="mt-1 flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-3 w-3 shrink-0" />
            {report.balanceSheetBalanced
              ? 'Assets = Liabilities + Equity'
              : 'Reconciliation check needed'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Trial Balance Control Total
          </p>
          <p className="mt-1.5 font-mono text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {formatCurrency(report.trialBalanceTotalDebits, tenant.currency)}
          </p>
          <p className="mt-1 flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
            <Scale className="h-3 w-3 shrink-0" />
            {report.trialBalanceBalanced
              ? 'Dr = Cr Reconciled'
              : 'Dr / Cr Variance'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Voucher Document Audit
          </p>
          <p className="mt-1.5 font-mono text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {report.vouchersWithDocsCount} / {report.totalVouchersCount}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {report.supportingDocCoveragePct.toFixed(0)}% vouchers with supporting receipts
          </p>
        </div>
      </div>

      {/* Statement Tabs + Quick Individual Downloads */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between no-print">
        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-slate-100/80 p-1 dark:border-slate-800 dark:bg-slate-900">
          {(
            [
              { id: 'pl', label: 'Profit & Loss (P&L)' },
              { id: 'balance-sheet', label: 'Balance Sheet' },
              { id: 'trial-balance', label: 'Trial Balance' },
              { id: 'cash-flow', label: 'Cash Flow' },
              { id: 'cashbook', label: 'General Cashbook' },
              { id: 'schedules', label: 'Debtors & Payables' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveBook(tab.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                activeBook === tab.id
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {activeBook === 'pl' && (
            <button
              type="button"
              onClick={() => handleDownload('PL_STATEMENT', 'Profit & Loss Statement')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
              Download P&amp;L (.xlsx)
            </button>
          )}
          {activeBook === 'balance-sheet' && (
            <button
              type="button"
              onClick={() => handleDownload('BALANCE_SHEET', 'Balance Sheet')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
              Download Balance Sheet (.xlsx)
            </button>
          )}
          {activeBook === 'trial-balance' && (
            <button
              type="button"
              onClick={() => handleDownload('TRIAL_BALANCE', 'Trial Balance')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
              Download Trial Balance (.xlsx)
            </button>
          )}
          {activeBook === 'cash-flow' && (
            <button
              type="button"
              onClick={() => handleDownload('CASH_FLOW', 'Cash Flow Statement')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
              Download Cash Flow (.xlsx)
            </button>
          )}
          {activeBook === 'cashbook' && (
            <button
              type="button"
              onClick={() => handleDownload('CASHBOOK', 'General Cashbook')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
              Download Cashbook (.xlsx)
            </button>
          )}
          {activeBook === 'schedules' && (
            <button
              type="button"
              onClick={() =>
                handleDownload('DEBTORS_PAYABLES', 'Debtors & Payables Schedules')
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
              Download Schedules (.xlsx)
            </button>
          )}
        </div>
      </div>

      {/* 1. Statement of Profit & Loss */}
      {activeBook === 'pl' && (
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col gap-1 border-b border-slate-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Statement of Profit &amp; Loss (Income &amp; Expenditure)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {tenant.name} · Period ended {formatDateShort(report.asOfDate)} · Fee income apportioned by votelines
              </p>
            </div>
            <span className="font-mono text-xs font-semibold text-slate-600 dark:text-slate-300">
              Currency: {tenant.currency}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                <tr>
                  <th className="px-6 py-3">Account / Votehead</th>
                  <th className="px-4 py-3 text-right">Billed / Incurred</th>
                  <th className="px-4 py-3 text-right">Cash Settled</th>
                  <th className="px-4 py-3 text-right">Receivable / Accrued</th>
                  <th className="px-6 py-3 text-right">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                <tr className="bg-slate-50/70 dark:bg-slate-800/30">
                  <td colSpan={5} className="px-6 py-2 font-semibold text-slate-800 dark:text-slate-200">
                    Operating Income (Fee Structure Voteheads)
                  </td>
                </tr>
                {report.revenueLines.map((line) => (
                  <tr key={line.votehead} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                    <td className="px-6 py-2.5 font-medium text-slate-800 dark:text-slate-200">
                      {line.votehead}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {formatCurrency(line.billedAmount, tenant.currency)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                      {formatCurrency(line.collectedAmount, tenant.currency)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                      {formatCurrency(line.receivableAmount, tenant.currency)}
                    </td>
                    <td className="px-6 py-2.5 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {line.sharePct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-slate-200 bg-slate-50/90 font-bold dark:border-slate-700 dark:bg-slate-800/60">
                  <td className="px-6 py-3 text-slate-900 dark:text-slate-100">
                    Total Operating Revenue
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {formatCurrency(report.totalRevenueBilled, tenant.currency)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                    {formatCurrency(report.totalCashCollected, tenant.currency)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-amber-700 dark:text-amber-400">
                    {formatCurrency(report.accountsReceivable, tenant.currency)}
                  </td>
                  <td className="px-6 py-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                    100.0%
                  </td>
                </tr>

                <tr className="bg-slate-50/70 dark:bg-slate-800/30">
                  <td colSpan={5} className="px-6 py-2 font-semibold text-slate-800 dark:text-slate-200">
                    Less: Operating Expenditure
                  </td>
                </tr>
                {report.expenseLines.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-4 text-center text-slate-500 dark:text-slate-400">
                      No operating expenses recorded in this period.
                    </td>
                  </tr>
                ) : (
                  report.expenseLines.map((line) => (
                    <tr key={line.category} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                      <td className="px-6 py-2.5 font-medium text-slate-800 dark:text-slate-200">
                        {line.category}
                        <span className="ml-2 text-[11px] font-normal text-slate-500 dark:text-slate-400">
                          · {line.voucherCount} voucher{line.voucherCount === 1 ? '' : 's'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {formatCurrency(line.totalAmount, tenant.currency)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-rose-700 dark:text-rose-400">
                        {formatCurrency(line.paidAmount, tenant.currency)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                        {formatCurrency(line.accruedAmount, tenant.currency)}
                      </td>
                      <td className="px-6 py-2.5 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        {line.sharePct.toFixed(1)}%
                      </td>
                    </tr>
                  ))
                )}
                <tr className="border-t border-slate-200 bg-slate-50/90 font-bold dark:border-slate-700 dark:bg-slate-800/60">
                  <td className="px-6 py-3 text-slate-900 dark:text-slate-100">
                    Total Operating Expenditure
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {formatCurrency(report.totalOperatingExpenses, tenant.currency)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-rose-700 dark:text-rose-400">
                    {formatCurrency(report.totalPaidExpenses, tenant.currency)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-amber-700 dark:text-amber-400">
                    {formatCurrency(report.totalAccruedExpenses, tenant.currency)}
                  </td>
                  <td className="px-6 py-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                    100.0%
                  </td>
                </tr>

                <tr className="border-t-2 border-slate-300 bg-slate-100/70 font-bold dark:border-slate-700 dark:bg-slate-800">
                  <td className="px-6 py-3.5 text-sm text-slate-900 dark:text-slate-100">
                    Net Operating Surplus / (Deficit)
                  </td>
                  <td
                    className={`px-4 py-3.5 text-right font-mono text-sm tabular-nums ${
                      report.netOperatingSurplus >= 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-rose-700 dark:text-rose-400'
                    }`}
                  >
                    {formatCurrency(report.netOperatingSurplus, tenant.currency)}
                  </td>
                  <td
                    className={`px-4 py-3.5 text-right font-mono text-sm tabular-nums ${
                      report.netCashOperatingSurplus >= 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-rose-700 dark:text-rose-400'
                    }`}
                  >
                    {formatCurrency(report.netCashOperatingSurplus, tenant.currency)}
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono text-xs text-slate-500 dark:text-slate-400">
                    Accrual vs Cash
                  </td>
                  <td className="px-6 py-3.5 text-right font-mono text-xs text-slate-500 dark:text-slate-400">
                    —
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 2. Balance Sheet */}
      {activeBook === 'balance-sheet' && (
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col gap-1 border-b border-slate-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Statement of Financial Position (Balance Sheet)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {tenant.name} · As at {formatDateShort(report.asOfDate)} · Double-entry reconciled
              </p>
            </div>
            <span className="font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              {report.balanceSheetBalanced ? 'Balanced · Assets = Liabilities + Equity' : 'Check Variance'}
            </span>
          </div>

          <div className="grid grid-cols-1 divide-y divide-slate-200 lg:grid-cols-2 lg:divide-x lg:divide-y-0 dark:divide-slate-800">
            {/* Assets Column */}
            <div className="p-6">
              <h4 className="text-xs font-bold tracking-wide text-slate-500 uppercase dark:text-slate-400">
                Assets
              </h4>
              <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
                <div className="flex items-center justify-between py-2.5 text-xs">
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-slate-100">
                      Cash &amp; Bank Equivalents
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Net treasury funds across Bank, Mobile Money, Card &amp; Cash
                    </p>
                  </div>
                  <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                    {formatCurrency(report.cashAssetBalance, tenant.currency)}
                  </span>
                </div>

                <div className="flex items-center justify-between py-2.5 text-xs">
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-slate-100">
                      Accounts Receivable (Student Fee Debtors)
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {report.debtorsSchedule.length} open student invoice balances
                    </p>
                  </div>
                  <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                    {formatCurrency(report.accountsReceivable, tenant.currency)}
                  </span>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t-2 border-slate-200 pt-3 text-sm font-bold dark:border-slate-700">
                <span className="text-slate-900 dark:text-slate-100">Total Assets</span>
                <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {formatCurrency(report.totalCurrentAssets, tenant.currency)}
                </span>
              </div>
            </div>

            {/* Liabilities & Equity Column */}
            <div className="p-6">
              <h4 className="text-xs font-bold tracking-wide text-slate-500 uppercase dark:text-slate-400">
                Liabilities &amp; Accumulated School Equity
              </h4>
              <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
                <div className="flex items-center justify-between py-2.5 text-xs">
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-slate-100">
                      Accounts Payable (Unpaid Vouchers)
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Pending Approval &amp; Approved vouchers awaiting disbursement
                    </p>
                  </div>
                  <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                    {formatCurrency(report.accountsPayable, tenant.currency)}
                  </span>
                </div>

                {report.bankOverdraftLiability > 0 && (
                  <div className="flex items-center justify-between py-2.5 text-xs">
                    <div>
                      <p className="font-semibold text-rose-700 dark:text-rose-400">
                        Treasury / Bank Overdraft
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Paid disbursements exceeding cash fee collections
                      </p>
                    </div>
                    <span className="font-mono font-semibold tabular-nums text-rose-700 dark:text-rose-400">
                      {formatCurrency(report.bankOverdraftLiability, tenant.currency)}
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between py-2.5 text-xs">
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-slate-100">
                      Accumulated Operating Surplus / (Deficit)
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Carried from Statement of Profit &amp; Loss
                    </p>
                  </div>
                  <span
                    className={`font-mono font-semibold tabular-nums ${
                      report.accumulatedSurplusEquity >= 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-rose-700 dark:text-rose-400'
                    }`}
                  >
                    {formatCurrency(report.accumulatedSurplusEquity, tenant.currency)}
                  </span>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t-2 border-slate-200 pt-3 text-sm font-bold dark:border-slate-700">
                <span className="text-slate-900 dark:text-slate-100">
                  Total Liabilities &amp; Net Equity
                </span>
                <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {formatCurrency(report.totalLiabilitiesAndEquity, tenant.currency)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. Trial Balance */}
      {activeBook === 'trial-balance' && (
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col gap-1 border-b border-slate-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                General Ledger Trial Balance
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {tenant.name} · As at {formatDateShort(report.asOfDate)}
              </p>
            </div>
            <span className="font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              {report.trialBalanceBalanced ? 'Debits = Credits Reconciled' : 'Check Variance'}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                <tr>
                  <th className="px-6 py-3">Account Code</th>
                  <th className="px-4 py-3">Ledger Account Name</th>
                  <th className="px-4 py-3">Class</th>
                  <th className="px-4 py-3 text-right">Debit ({tenant.currency})</th>
                  <th className="px-6 py-3 text-right">Credit ({tenant.currency})</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {report.trialBalanceRows.map((row) => (
                  <tr key={row.accountCode} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="px-6 py-2.5 font-mono font-semibold text-slate-700 dark:text-slate-300">
                      {row.accountCode}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                      {row.accountName}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">
                      {row.accountType}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {row.debit > 0 ? formatCurrency(row.debit, tenant.currency) : '—'}
                    </td>
                    <td className="px-6 py-2.5 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {row.credit > 0 ? formatCurrency(row.credit, tenant.currency) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-bold dark:border-slate-700 dark:bg-slate-800/70">
                <tr>
                  <td colSpan={3} className="px-6 py-3 text-sm text-slate-900 dark:text-slate-100">
                    Trial Balance Control Totals
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-slate-900 dark:text-slate-100">
                    {formatCurrency(report.trialBalanceTotalDebits, tenant.currency)}
                  </td>
                  <td className="px-6 py-3 text-right font-mono text-sm tabular-nums text-slate-900 dark:text-slate-100">
                    {formatCurrency(report.trialBalanceTotalCredits, tenant.currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* 4. Cash Flow Statement */}
      {activeBook === 'cash-flow' && (
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-800">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Statement of Cash Flows (By Settlement Channel)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Reconciles student fee collections and paid supplier vouchers across Bank, Mobile Money, Card, and Cash
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                <tr>
                  <th className="px-6 py-3">Settlement Channel</th>
                  <th className="px-4 py-3 text-right">Fee Cash Inflows</th>
                  <th className="px-4 py-3 text-right">Expense Cash Outflows</th>
                  <th className="px-6 py-3 text-right">Net Channel Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {report.cashChannelLines.map((ch) => (
                  <tr key={ch.method} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="px-6 py-3 font-semibold text-slate-900 dark:text-slate-100">
                      {ch.method}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                      {formatCurrency(ch.inflows, tenant.currency)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-rose-700 dark:text-rose-400">
                      {formatCurrency(ch.outflows, tenant.currency)}
                    </td>
                    <td
                      className={`px-6 py-3 text-right font-mono font-semibold tabular-nums ${
                        ch.netBalance >= 0
                          ? 'text-slate-900 dark:text-slate-100'
                          : 'text-rose-700 dark:text-rose-400'
                      }`}
                    >
                      {formatCurrency(ch.netBalance, tenant.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-bold dark:border-slate-700 dark:bg-slate-800/70">
                <tr>
                  <td className="px-6 py-3 text-sm text-slate-900 dark:text-slate-100">
                    Net Operating Cash Position
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-emerald-700 dark:text-emerald-400">
                    {formatCurrency(report.totalCashCollected, tenant.currency)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-rose-700 dark:text-rose-400">
                    {formatCurrency(report.totalPaidExpenses, tenant.currency)}
                  </td>
                  <td
                    className={`px-6 py-3 text-right font-mono text-sm tabular-nums ${
                      report.netCashPosition >= 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-rose-700 dark:text-rose-400'
                    }`}
                  >
                    {formatCurrency(report.netCashPosition, tenant.currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* 5. Chronological General Cashbook */}
      {activeBook === 'cashbook' && (
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-800">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              General Cashbook &amp; Transaction Journal ({report.cashbookEntries.length})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Chronological register of every fee receipt, paid expense voucher, and accrued liability with document audit trail
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Receipt / Voucher</th>
                  <th className="px-4 py-3">Counterparty &amp; Account</th>
                  <th className="px-4 py-3">Supporting Docs</th>
                  <th className="px-4 py-3 text-right">Cash In</th>
                  <th className="px-4 py-3 text-right">Cash Out</th>
                  <th className="px-4 py-3 text-right">Running Cash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {report.cashbookEntries.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">
                      No cashbook transactions recorded up to {formatDateShort(report.asOfDate)}.
                    </td>
                  </tr>
                ) : (
                  report.cashbookEntries.map((entry, idx) => (
                    <tr
                      key={`${entry.voucherOrReceipt}-${idx}`}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                    >
                      <td className="px-4 py-2.5 font-mono text-slate-600 whitespace-nowrap dark:text-slate-400">
                        {formatDateShort(entry.entryDate)}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                          {entry.voucherOrReceipt}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {entry.entryType} · {entry.status}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {entry.counterparty}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {entry.account} · {entry.method}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-[11px]">
                        <span
                          className={
                            entry.supportingDocsCount > 0
                              ? 'font-medium text-emerald-700 dark:text-emerald-400'
                              : 'font-medium text-amber-700 dark:text-amber-400'
                          }
                        >
                          {entry.supportingDocsLabel}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                        {entry.cashIn > 0 ? formatCurrency(entry.cashIn, tenant.currency) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-rose-700 dark:text-rose-400">
                        {entry.cashOut > 0 ? formatCurrency(entry.cashOut, tenant.currency) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                        {formatCurrency(entry.runningCashBalance, tenant.currency)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 6. Supporting Schedules: Aged Student Debtors & Creditors / Document Audit */}
      {activeBook === 'schedules' && (
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Sub-Ledger Schedules &amp; Document Audit
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Aged student fee debtors and supplier voucher supporting document verification
              </p>
            </div>
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => setScheduleTab('debtors')}
                className={`rounded-md px-3 py-1 text-xs font-semibold ${
                  scheduleTab === 'debtors'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Fee Debtors ({report.debtorsSchedule.length})
              </button>
              <button
                type="button"
                onClick={() => setScheduleTab('payables')}
                className={`rounded-md px-3 py-1 text-xs font-semibold ${
                  scheduleTab === 'payables'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Vouchers &amp; Audit ({report.payablesAndAuditSchedule.length})
              </button>
            </div>
          </div>

          {scheduleTab === 'debtors' ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Invoice</th>
                    <th className="px-4 py-3">Student</th>
                    <th className="px-4 py-3">Due Date &amp; Aging</th>
                    <th className="px-4 py-3 text-right">Billed</th>
                    <th className="px-4 py-3 text-right">Paid</th>
                    <th className="px-4 py-3 text-right">Balance Due</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {report.debtorsSchedule.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">
                        All student fee accounts are settled with zero outstanding balances.
                      </td>
                    </tr>
                  ) : (
                    report.debtorsSchedule.map((row) => (
                      <tr key={row.invoiceNumber} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-2.5 font-mono font-semibold text-slate-900 dark:text-slate-100">
                          {row.invoiceNumber}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {row.studentName}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {row.studentCode} · {row.grade} · {row.term}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="font-mono text-slate-700 dark:text-slate-300">
                            {formatDateShort(row.dueDate)}
                          </div>
                          <div
                            className={`text-[11px] font-medium ${
                              row.agingBucket === 'Current'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-amber-700 dark:text-amber-400'
                            }`}
                          >
                            {row.agingBucket}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                          {formatCurrency(row.totalBilled, tenant.currency)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                          {formatCurrency(row.paidAmount, tenant.currency)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-bold tabular-nums text-amber-700 dark:text-amber-400">
                          {formatCurrency(row.balanceDue, tenant.currency)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Voucher &amp; Date</th>
                    <th className="px-4 py-3">Vendor &amp; Description</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Supporting Document Audit</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {report.payablesAndAuditSchedule.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">
                        No expense vouchers recorded for audit.
                      </td>
                    </tr>
                  ) : (
                    report.payablesAndAuditSchedule.map((row) => (
                      <tr key={row.voucherNumber} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-2.5">
                          <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                            {row.voucherNumber}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {formatDateShort(row.expenseDate)}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {row.title}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {row.vendor} · {row.category}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 font-medium text-slate-700 dark:text-slate-300">
                          {row.status}
                        </td>
                        <td className="px-4 py-2.5 text-[11px]">
                          <span
                            className={
                              row.attachmentsCount > 0
                                ? 'font-medium text-emerald-700 dark:text-emerald-400'
                                : 'font-medium text-amber-700 dark:text-amber-400'
                            }
                          >
                            {row.attachmentsCount > 0
                              ? `${row.attachmentsCount} attached · ${row.attachmentNames}`
                              : 'Missing supporting receipt / signed voucher'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                          {formatCurrency(row.amount, tenant.currency)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
