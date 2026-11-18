import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Landmark,
  Paperclip,
  PiggyBank,
  Plus,
  Printer,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
  Upload,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { MpesaIntegrationPanel } from './MpesaIntegrationPanel';
import { TenantDocumentHeader } from './TenantDocumentHeader';
import {
  createBrandedWorksheetFromObjects,
  parseExcelSheetRowsSmart,
} from '../lib/documentBranding';
import { saasApi } from '../lib/api';
import { formatCurrency, formatDateShort } from '../lib/format';
import {
  EXPENSE_CATEGORIES,
  type BudgetApprovalStatus,
  type ExpenseCategory,
  type PaymentMethod,
  type PayrollEntry,
  type PayrollStatus,
  type ReconciliationChannel,
  type ReconciliationLine,
  type ReconciliationStatus,
  type TenantWorkspaceData,
  type UserRole,
} from '../shared/types';

interface PanelProps {
  workspace: TenantWorkspaceData;
  canManage: boolean;
  actorRole: string;
  onRefresh: () => Promise<void>;
  onNotify: (title: string, tone?: 'success' | 'error') => void;
}

// ============================================================================
// 1. KRA ETIMS RECEIPT CHECK PANEL
// ============================================================================
export function EtimsVerificationPanel({
  workspace,
  canManage,
  actorRole,
  onRefresh,
  onNotify,
}: PanelProps) {
  const { tenant } = workspace;
  const expenses = workspace.expenses || [];
  const etimsChecks = workspace.etimsChecks || [];

  const [expenseId, setExpenseId] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [supplierKraPin, setSupplierKraPin] = useState('');
  const [cuInvoiceNumber, setCuInvoiceNumber] = useState('');
  const [receiptDate, setReceiptDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [totalAmount, setTotalAmount] = useState('');
  const [exemptVat, setExemptVat] = useState(false);
  const [qrInput, setQrInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function handleSelectExpense(nextId: string) {
    setExpenseId(nextId);
    const found = expenses.find((e) => e.id === nextId);
    if (found) {
      setSupplierName(found.vendor);
      setTotalAmount(String(found.amount));
      setReceiptDate(found.expenseDate);
      if (found.supplierKraPin) setSupplierKraPin(found.supplierKraPin);
      if (found.etimsCuNumber) setCuInvoiceNumber(found.etimsCuNumber);
    }
  }

  function handleParseQrPayload() {
    const raw = qrInput.trim();
    if (!raw) {
      onNotify('Paste an eTIMS QR link or KRA receipt text snippet first.', 'error');
      return;
    }
    const pinMatch = raw.match(/\b([AP]\d{9}[A-Z])\b/i);
    const cuMatch = raw.match(/\b(KRAMW[A-Z0-9]{6,}|0\d{10,}|\d{3}-\d{7,})\b/i);
    const amtMatch = raw.match(/(?:total|amt|kes|ksh)[=:\s]*([\d,]+(?:\.\d+)?)/i);
    if (pinMatch) setSupplierKraPin(pinMatch[1].toUpperCase());
    if (cuMatch) setCuInvoiceNumber(cuMatch[1].toUpperCase());
    if (amtMatch) setTotalAmount(String(Math.round(Number(amtMatch[1].replace(/,/g, '')))));
    onNotify('Parsed KRA eTIMS fields from QR / text payload.');
  }

  async function handleVerifyEtims(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) {
      onNotify('Switch role to Bursar, Admin, or Super Admin to verify eTIMS receipts.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await saasApi.verifyEtimsReceipt(tenant.id, {
        expenseId: expenseId || undefined,
        supplierName: supplierName.trim(),
        supplierKraPin: supplierKraPin.trim(),
        cuInvoiceNumber: cuInvoiceNumber.trim(),
        receiptDate,
        totalAmount: Number(totalAmount),
        exemptVat,
        checkedBy: `${actorRole} Compliance`,
      });
      await onRefresh();
      onNotify(`eTIMS check ${res.record.cuInvoiceNumber}: ${res.record.status}.`);
      setExpenseId('');
      setSupplierName('');
      setSupplierKraPin('');
      setCuInvoiceNumber('');
      setTotalAmount('');
      setQrInput('');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'eTIMS verification failed', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  function handleExportEtimsExcel() {
    if (etimsChecks.length === 0) {
      onNotify('No eTIMS verification records to export.', 'error');
      return;
    }
    const rows = etimsChecks.map((c) => ({
      Voucher_No: c.voucherNumber || 'Standalone',
      Supplier: c.supplierName,
      Supplier_KRA_PIN: c.supplierKraPin,
      CU_Invoice_Number: c.cuInvoiceNumber,
      Receipt_Date: c.receiptDate,
      Taxable_Amount: c.taxableAmount,
      VAT_Amount: c.vatAmount,
      Total_Amount: c.totalAmount,
      Compliance_Status: c.status,
      Notes: c.verificationNotes,
      Checked_By: c.checkedBy,
    }));
    const ws = createBrandedWorksheetFromObjects(
      tenant,
      'KRA eTIMS Tax Invoice Verification Register',
      rows,
      {
        subtitle: `${etimsChecks.length} eTIMS verification records | Currency: ${tenant.currency}`,
        colWidths: [18, 28, 16, 22, 14, 16, 14, 16, 18, 34, 20],
      }
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'eTIMS Verification');
    XLSX.writeFile(wb, `${tenant.slug}-etims-checks-${new Date().toISOString().slice(0, 10)}.xlsx`);
    onNotify(`Exported ${etimsChecks.length} eTIMS records to Excel.`);
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
      {/* Left Verification Form */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 xl:col-span-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 pb-3 dark:border-slate-800">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            KRA eTIMS Tax Invoice Verification
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Validate supplier KRA PIN, CU serial number, and VAT compliance against school expense vouchers.
          </p>
        </div>

        <form onSubmit={handleVerifyEtims} className="mt-4 space-y-3.5">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Paste eTIMS QR Code URL / Text (Optional Auto-Fill)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={qrInput}
                onChange={(e) => setQrInput(e.target.value)}
                placeholder="e.g. https://etims.kra.go.ke/... pin=P051482910K cu=KRAMW012026991"
                className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
              <button
                type="button"
                onClick={handleParseQrPayload}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                Parse
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Link to Expense Voucher (Optional)
            </label>
            <select
              value={expenseId}
              onChange={(e) => handleSelectExpense(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="">Standalone / Unlinked Receipt Check</option>
              {expenses.map((exp) => (
                <option key={exp.id} value={exp.id}>
                  {exp.voucherNumber} · {exp.vendor} ({formatCurrency(exp.amount, tenant.currency)})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Supplier Name *
              </label>
              <input
                type="text"
                required
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder="Registered supplier name"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Supplier KRA PIN *
              </label>
              <input
                type="text"
                required
                value={supplierKraPin}
                onChange={(e) => setSupplierKraPin(e.target.value.toUpperCase())}
                placeholder="P051482910K"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs uppercase text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                CU Invoice No. *
              </label>
              <input
                type="text"
                required
                value={cuInvoiceNumber}
                onChange={(e) => setCuInvoiceNumber(e.target.value.toUpperCase())}
                placeholder="KRAMW012026..."
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs uppercase text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Total ({tenant.currency}) *
              </label>
              <input
                type="number"
                min="1"
                required
                value={totalAmount}
                onChange={(e) => setTotalAmount(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Receipt Date
              </label>
              <input
                type="date"
                value={receiptDate}
                onChange={(e) => setReceiptDate(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
          </div>

          <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={exemptVat}
              onChange={(e) => setExemptVat(e.target.checked)}
              className="rounded border-slate-300 text-blue-600"
            />
            Zero-rated / VAT-exempt tax supply (0% VAT)
          </label>

          <button
            type="submit"
            disabled={!canManage || submitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <ShieldCheck className="h-4 w-4" />
            {submitting ? 'Verifying Receipt...' : 'Verify & Record eTIMS Check'}
          </button>
        </form>
      </div>

      {/* Right Verification Register */}
      <div className="rounded-xl border border-slate-200 bg-white xl:col-span-7 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              eTIMS Compliance Register ({etimsChecks.length})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Verified CU tax invoices &amp; VAT breakdown
            </p>
          </div>
          <button
            type="button"
            onClick={handleExportEtimsExcel}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <Download className="h-3.5 w-3.5" />
            Export Excel
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">CU Invoice &amp; PIN</th>
                <th className="px-4 py-3">Supplier &amp; Voucher</th>
                <th className="px-4 py-3 text-right">VAT</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Result</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {etimsChecks.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">
                    No eTIMS receipt checks recorded yet.
                  </td>
                </tr>
              ) : (
                etimsChecks.map((chk) => (
                  <tr key={chk.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 align-top">
                      <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                        {chk.cuInvoiceNumber}
                      </div>
                      <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                        PIN: {chk.supplierKraPin}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {chk.supplierName}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {chk.voucherNumber ? `Linked: ${chk.voucherNumber}` : 'Standalone check'} ·{' '}
                        {formatDateShort(chk.receiptDate)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right align-top font-mono tabular-nums text-slate-600 dark:text-slate-400">
                      {formatCurrency(chk.vatAmount, tenant.currency)}
                    </td>
                    <td className="px-4 py-3 text-right align-top font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                      {formatCurrency(chk.totalAmount, tenant.currency)}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span
                        className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                          chk.status === 'Verified'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                            : chk.status === 'Exempt'
                            ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                            : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
                        }`}
                      >
                        {chk.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right align-top">
                      {canManage && (
                        <button
                          type="button"
                          onClick={async () => {
                            await saasApi.deleteEtimsCheck(tenant.id, chk.id);
                            await onRefresh();
                            onNotify('Removed eTIMS check record.');
                          }}
                          className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 3. M-PESA & BANK STATEMENT RECONCILIATION PANEL
// ============================================================================
export function ReconciliationPanel({
  workspace,
  canManage,
  actorRole,
  onRefresh,
  onNotify,
}: PanelProps) {
  const { tenant } = workspace;
  const lines = workspace.reconciliationLines || [];

  const [activeSection, setActiveSection] = useState<'reconciliation' | 'mpesa'>('reconciliation');
  const [channelFilter, setChannelFilter] = useState<'All' | ReconciliationChannel>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | ReconciliationStatus>('All');
  const [channel, setChannel] = useState<ReconciliationChannel>('M-Pesa');
  const [accountName, setAccountName] = useState('Paybill 522533 — School Fees');
  const [txDate, setTxDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [statementRef, setStatementRef] = useState('');
  const [narration, setNarration] = useState('');
  const [direction, setDirection] = useState<'Credit' | 'Debit'>('Credit');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const excelInputRef = useRef<HTMLInputElement | null>(null);

  const summary = useMemo(() => {
    let matchedCount = 0;
    let unmatchedCount = 0;
    let discrepancyCount = 0;
    let credits = 0;
    let debits = 0;
    for (const l of lines) {
      if (l.direction === 'Credit') credits += l.amount;
      else debits += l.amount;
      if (l.status === 'Matched') matchedCount += 1;
      else if (l.status === 'Discrepancy') discrepancyCount += 1;
      else unmatchedCount += 1;
    }
    return { matchedCount, unmatchedCount, discrepancyCount, credits, debits };
  }, [lines]);

  const filteredLines = useMemo(
    () =>
      lines.filter(
        (l) =>
          (channelFilter === 'All' || l.channel === channelFilter) &&
          (statusFilter === 'All' || l.status === statusFilter)
      ),
    [lines, channelFilter, statusFilter]
  );

  async function handleAddLine(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setBusy(true);
    try {
      const res = await saasApi.importReconciliationLines(tenant.id, [
        {
          channel,
          accountName: accountName.trim(),
          transactionDate: txDate,
          statementRef: statementRef.trim(),
          narration: narration.trim(),
          direction,
          amount: Number(amount),
        },
      ]);
      await onRefresh();
      setStatementRef('');
      setNarration('');
      setAmount('');
      onNotify(
        `Imported statement line (${res.matchedCount > 0 ? 'Matched automatically' : 'Unmatched'}).`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to add statement line', 'error');
    } finally {
      setBusy(false);
    }
  }

  function handleDownloadTemplate() {
    const sample = [
      {
        Channel: 'M-Pesa',
        Account: `Paybill ${tenant.mpesaConfig?.paybillNumber || '522533'}`,
        Date: new Date().toISOString().slice(0, 10),
        Reference: 'UBC99MP01A',
        Narration: 'TERM 1 FEE DEPOSIT',
        Direction: 'Credit',
        Amount: tenant.currency === 'KES' ? 15000 : 250,
      },
      {
        Channel: 'Bank',
        Account: tenant.mpesaConfig?.settlementBank || 'KCB Operating A/C',
        Date: new Date().toISOString().slice(0, 10),
        Reference: 'EFT-CAT-4410',
        Narration: 'HIGHLAND FRESH PRODUCE CO',
        Direction: 'Debit',
        Amount: tenant.currency === 'KES' ? 144000 : 1200,
      },
    ];
    const ws = createBrandedWorksheetFromObjects(
      tenant,
      'M-Pesa & Bank Statement Import Template',
      sample,
      {
        subtitle: `Keep column headers intact when uploading statements | Currency: ${tenant.currency}`,
        colWidths: [14, 24, 14, 18, 30, 12, 16],
      }
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Statement');
    XLSX.writeFile(wb, `${tenant.slug}-bank-mpesa-statement-template.xlsx`);
    onNotify('Downloaded M-Pesa / Bank statement Excel template.');
  }

  async function handleImportExcel(file: File | undefined) {
    if (!file || !canManage) return;
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = parseExcelSheetRowsSmart(ws, ['Reference', 'Amount', 'Channel', 'StatementRef']);
      const parsed = rows
        .map((r) => {
          const chRaw = String(r.Channel || r.channel || 'Bank');
          const dirRaw = String(r.Direction || r.direction || 'Credit');
          return {
            channel: (/mpesa|m-pesa/i.test(chRaw) ? 'M-Pesa' : 'Bank') as ReconciliationChannel,
            accountName: String(r.Account || r.accountName || ''),
            transactionDate: String(r.Date || r.transactionDate || ''),
            statementRef: String(r.Reference || r.statementRef || r.Ref || '').trim(),
            narration: String(r.Narration || r.narration || r.Description || '').trim(),
            direction: (/debit|dr|out/i.test(dirRaw) ? 'Debit' : 'Credit') as 'Credit' | 'Debit',
            amount: Number(String(r.Amount || r.amount || '0').replace(/,/g, '')),
          };
        })
        .filter((x) => x.statementRef && Number.isFinite(x.amount) && x.amount > 0);

      if (parsed.length === 0) {
        onNotify('No valid statement rows with Reference and Amount found.', 'error');
        return;
      }
      const res = await saasApi.importReconciliationLines(tenant.id, parsed);
      await onRefresh();
      onNotify(
        `Imported ${res.imported.length} statement lines (${res.matchedCount} matched, ${res.unmatchedCount} unmatched).`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Statement import failed', 'error');
    } finally {
      setBusy(false);
      if (excelInputRef.current) excelInputRef.current.value = '';
    }
  }

  function handleExportReconExcel() {
    if (lines.length === 0) {
      onNotify('No reconciliation lines to export.', 'error');
      return;
    }
    const rows = lines.map((l) => ({
      Channel: l.channel,
      Account: l.accountName,
      Date: l.transactionDate,
      Reference: l.statementRef,
      Narration: l.narration,
      Direction: l.direction,
      Amount: l.amount,
      Status: l.status,
      Matched_Ledger_Record: l.matchedLabel || '',
      Notes: l.notes || '',
    }));
    const ws = createBrandedWorksheetFromObjects(
      tenant,
      'Bank & M-Pesa Reconciliation Statement',
      rows,
      {
        subtitle: `${lines.length} statement lines | Currency: ${tenant.currency}`,
        colWidths: [14, 24, 14, 18, 30, 12, 16, 16, 28, 28],
      }
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Reconciliation');
    XLSX.writeFile(wb, `${tenant.slug}-reconciliation-${new Date().toISOString().slice(0, 10)}.xlsx`);
    onNotify('Exported M-Pesa & Bank Reconciliation to Excel.');
  }

  return (
    <div className="space-y-6">
      {/* Bank & M-Pesa Section Switcher + Paybill Status Strip */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2.5 text-xs">
          <Smartphone
            className={`h-4 w-4 shrink-0 ${
              tenant.mpesaConfig?.enabled
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-amber-600 dark:text-amber-400'
            }`}
          />
          {tenant.mpesaConfig?.enabled ? (
            <span className="text-slate-700 dark:text-slate-300">
              <strong className="text-slate-900 dark:text-slate-100">M-Pesa Paybill Active:</strong>{' '}
              <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                {tenant.mpesaConfig.paybillNumber}
              </span>{' '}
              ({tenant.mpesaConfig.accountName} · {tenant.mpesaConfig.environment}) — Payments isolated to {tenant.name}.
            </span>
          ) : (
            <span className="text-slate-700 dark:text-slate-300">
              <strong className="text-slate-900 dark:text-slate-100">M-Pesa Paybill Not Configured:</strong>{' '}
              Connect {tenant.name}&apos;s unique Paybill &amp; Daraja API credentials under Bank &amp; M-Pesa.
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 self-start rounded-lg bg-slate-100 p-1 sm:self-auto dark:bg-slate-800">
          <button
            type="button"
            onClick={() => setActiveSection('reconciliation')}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              activeSection === 'reconciliation'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
            Statement Reconciliation
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('mpesa')}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              activeSection === 'mpesa'
                ? 'bg-white text-emerald-700 shadow-xs dark:bg-slate-700 dark:text-emerald-300'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Smartphone className="h-3.5 w-3.5" />
            M-Pesa Integration
            {tenant.mpesaConfig?.enabled && (
              <span className="font-mono text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                ({tenant.mpesaConfig.paybillNumber})
              </span>
            )}
          </button>
        </div>
      </div>

      {activeSection === 'mpesa' ? (
        <MpesaIntegrationPanel
          workspace={workspace}
          currentRole={actorRole as UserRole}
          onRefresh={onRefresh}
          onNotify={onNotify}
        />
      ) : (
        <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Statement Credits</p>
          <p className="mt-1 font-mono text-lg font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
            {formatCurrency(summary.credits, tenant.currency)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Statement Debits</p>
          <p className="mt-1 font-mono text-lg font-bold tabular-nums text-rose-700 dark:text-rose-400">
            {formatCurrency(summary.debits, tenant.currency)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Matched Transactions</p>
          <p className="mt-1 font-mono text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {summary.matchedCount} / {lines.length}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Unmatched / Variance</p>
          <p className="mt-1 font-mono text-lg font-bold tabular-nums text-amber-600 dark:text-amber-400">
            {summary.unmatchedCount + summary.discrepancyCount}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Left: Add / Import Statement Lines */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 xl:col-span-4 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            Import M-Pesa / Bank Statement
          </h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Upload Excel statements or capture single lines for automatic matching against Fee Receipts &amp; Expenses.
          </p>

          <div className="mt-3 flex flex-wrap gap-2 border-b border-slate-200 pb-4 dark:border-slate-800">
            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
            >
              <Download className="h-3.5 w-3.5" />
              Template (.xlsx)
            </button>
            <input
              ref={excelInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => handleImportExcel(e.target.files?.[0])}
              className="hidden"
            />
            <button
              type="button"
              disabled={!canManage || busy}
              onClick={() => excelInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Upload className="h-3.5 w-3.5" />
              Upload Statement
            </button>
          </div>

          <form onSubmit={handleAddLine} className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Channel
                </label>
                <select
                  value={channel}
                  onChange={(e) => {
                    const ch = e.target.value as ReconciliationChannel;
                    setChannel(ch);
                    setAccountName(
                      ch === 'M-Pesa' ? 'Paybill 522533 — School Fees' : 'KCB Main Operating A/C'
                    );
                  }}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="M-Pesa">M-Pesa</option>
                  <option value="Bank">Bank</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Direction
                </label>
                <select
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as 'Credit' | 'Debit')}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="Credit">Credit (Inflow)</option>
                  <option value="Debit">Debit (Outflow)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Statement Ref *
                </label>
                <input
                  type="text"
                  required
                  value={statementRef}
                  onChange={(e) => setStatementRef(e.target.value)}
                  placeholder="UBC48KX91P"
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Amount ({tenant.currency}) *
                </label>
                <input
                  type="number"
                  min="1"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Narration / Description *
              </label>
              <input
                type="text"
                required
                value={narration}
                onChange={(e) => setNarration(e.target.value)}
                placeholder="e.g. MPESA FEE DEPOSIT ADM-2601"
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Transaction Date
              </label>
              <input
                type="date"
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>

            <button
              type="submit"
              disabled={!canManage || busy}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-700"
            >
              <Plus className="h-3.5 w-3.5" />
              Add &amp; Auto-Match Line
            </button>
          </form>
        </div>

        {/* Right: Statement Reconciliation Table */}
        <div className="rounded-xl border border-slate-200 bg-white xl:col-span-8 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={channelFilter}
                onChange={(e) => setChannelFilter(e.target.value as 'All' | ReconciliationChannel)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <option value="All">All Channels</option>
                <option value="M-Pesa">M-Pesa</option>
                <option value="Bank">Bank</option>
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'All' | ReconciliationStatus)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <option value="All">All Statuses</option>
                <option value="Matched">Matched</option>
                <option value="Unmatched">Unmatched</option>
                <option value="Discrepancy">Discrepancy</option>
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!canManage || busy}
                onClick={async () => {
                  const res = await saasApi.autoMatchReconciliation(tenant.id);
                  await onRefresh();
                  onNotify(`Auto-matched ${res.matchedCount} additional statement line(s).`);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Auto-Match Ledger
              </button>
              <button
                type="button"
                onClick={handleExportReconExcel}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <Download className="h-3.5 w-3.5" />
                Export Excel
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[740px] text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Date &amp; Channel</th>
                  <th className="px-4 py-3">Ref &amp; Narration</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Ledger Match</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredLines.map((line: ReconciliationLine) => (
                  <tr key={line.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 align-top">
                      <div className="font-mono text-slate-800 dark:text-slate-200">
                        {formatDateShort(line.transactionDate)}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {line.channel} · {line.direction}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                        {line.statementRef}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {line.narration}
                      </div>
                    </td>
                    <td
                      className={`px-4 py-3 text-right align-top font-mono font-bold tabular-nums ${
                        line.direction === 'Credit'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-rose-700 dark:text-rose-400'
                      }`}
                    >
                      {line.direction === 'Credit' ? '+' : '-'}
                      {formatCurrency(line.amount, tenant.currency)}
                    </td>
                    <td className="px-4 py-3 align-top text-[11px] text-slate-600 dark:text-slate-300">
                      {line.matchedLabel || line.notes || 'Awaiting match'}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span
                        className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                          line.status === 'Matched'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                            : line.status === 'Discrepancy'
                            ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
                            : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                        }`}
                      >
                        {line.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right align-top">
                      {canManage && (
                        <div className="inline-flex items-center gap-1">
                          {line.status !== 'Matched' && (
                            <button
                              type="button"
                              onClick={async () => {
                                await saasApi.updateReconciliationLine(tenant.id, line.id, {
                                  status: 'Matched',
                                  matchedLabel: 'Manually verified against cashbook',
                                });
                                await onRefresh();
                                onNotify(`Marked ${line.statementRef} as Matched.`);
                              }}
                              className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                            >
                              Reconcile
                            </button>
                          )}
                          {line.status !== 'Discrepancy' && (
                            <button
                              type="button"
                              onClick={async () => {
                                await saasApi.updateReconciliationLine(tenant.id, line.id, {
                                  status: 'Discrepancy',
                                  notes: 'Flagged for bank/M-Pesa investigation',
                                });
                                await onRefresh();
                                onNotify(`Flagged ${line.statementRef} as Discrepancy.`);
                              }}
                              className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                            >
                              Flag
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={async () => {
                              await saasApi.deleteReconciliationLine(tenant.id, line.id);
                              await onRefresh();
                            }}
                            className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
        </>
      )}
    </div>
  );
}

// ============================================================================
// 4. PAYROLL & STATUTORY DEDUCTIONS PANEL
// ============================================================================
export function PayrollDeductionsPanel({
  workspace,
  canManage,
  onRefresh,
  onNotify,
}: PanelProps) {
  const { tenant } = workspace;
  const payrollEntries = workspace.payrollEntries || [];

  const [payPeriod, setPayPeriod] = useState('2026-11');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [staffName, setStaffName] = useState('');
  const [staffCategory, setStaffCategory] = useState<'Teaching' | 'Non-Teaching'>('Teaching');
  const [designation, setDesignation] = useState('');
  const [basicSalary, setBasicSalary] = useState('');
  const [allowances, setAllowances] = useState('0');
  const [saccoOrLoan, setSaccoOrLoan] = useState('0');
  const [status, setStatus] = useState<PayrollStatus>('Draft');
  const [saving, setSaving] = useState(false);

  const scopedEntries = useMemo(
    () => payrollEntries.filter((p) => p.payPeriod === payPeriod),
    [payrollEntries, payPeriod]
  );

  const totals = useMemo(
    () =>
      scopedEntries.reduce(
        (acc, p) => {
          acc.gross += p.grossPay;
          acc.paye += p.paye;
          acc.nssf += p.nssf;
          acc.shif += p.shif;
          acc.housing += p.housingLevy;
          acc.sacco += p.saccoOrLoan;
          acc.deductions += p.totalDeductions;
          acc.net += p.netPay;
          return acc;
        },
        { gross: 0, paye: 0, nssf: 0, shif: 0, housing: 0, sacco: 0, deductions: 0, net: 0 }
      ),
    [scopedEntries]
  );

  function openEditModal(entry?: PayrollEntry) {
    if (entry) {
      setEditingId(entry.id);
      setStaffName(entry.staffName);
      setStaffCategory(entry.staffCategory);
      setDesignation(entry.designation);
      setBasicSalary(String(entry.basicSalary));
      setAllowances(String(entry.allowances));
      setSaccoOrLoan(String(entry.saccoOrLoan));
      setStatus(entry.status);
    } else {
      setEditingId(undefined);
      setStaffName('');
      setStaffCategory('Teaching');
      setDesignation('');
      setBasicSalary('');
      setAllowances('0');
      setSaccoOrLoan('0');
      setStatus('Draft');
    }
    setModalOpen(true);
  }

  async function handleSaveEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setSaving(true);
    try {
      await saasApi.upsertPayrollEntry(tenant.id, {
        id: editingId,
        payPeriod,
        staffName: staffName.trim(),
        staffCategory,
        designation: designation.trim() || 'Staff',
        basicSalary: Number(basicSalary),
        allowances: Number(allowances || 0),
        saccoOrLoan: Number(saccoOrLoan || 0),
        autoComputeStatutory: true,
        status,
      });
      await onRefresh();
      setModalOpen(false);
      onNotify(`Saved payroll & statutory deductions for ${staffName.trim()}.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to save payroll entry', 'error');
    } finally {
      setSaving(false);
    }
  }

  function handleExportPayrollExcel() {
    if (scopedEntries.length === 0) {
      onNotify('No payroll entries in this period to export.', 'error');
      return;
    }
    const wb = XLSX.utils.book_new();
    const masterRows = scopedEntries.map((p) => ({
      Period: p.payPeriod,
      Staff_Name: p.staffName,
      Category: p.staffCategory,
      Designation: p.designation,
      Basic_Salary: p.basicSalary,
      Allowances: p.allowances,
      Gross_Pay: p.grossPay,
      PAYE: p.paye,
      NSSF: p.nssf,
      SHIF: p.shif,
      Housing_Levy: p.housingLevy,
      SACCO_Loan: p.saccoOrLoan,
      Total_Deductions: p.totalDeductions,
      Net_Pay: p.netPay,
      Status: p.status,
    }));
    const statutoryRows = scopedEntries.map((p) => ({
      Period: p.payPeriod,
      Staff_Name: p.staffName,
      Gross_Pay: p.grossPay,
      PAYE_KRA: p.paye,
      NSSF_Contribution: p.nssf,
      SHIF_Deduction: p.shif,
      Affordable_Housing_Levy: p.housingLevy,
      Total_Statutory_Remittance: p.paye + p.nssf + p.shif + p.housingLevy,
    }));

    const masterWs = createBrandedWorksheetFromObjects(
      tenant,
      `Staff Payroll Master Schedule (${payPeriod})`,
      masterRows,
      {
        subtitle: `Pay Period: ${payPeriod} | ${scopedEntries.length} staff | Currency: ${tenant.currency}`,
        colWidths: [12, 24, 14, 22, 14, 14, 14, 12, 12, 12, 14, 14, 16, 14, 14],
      }
    );
    const statutoryWs = createBrandedWorksheetFromObjects(
      tenant,
      `Statutory Deductions Schedule — PAYE, NSSF, SHIF & Housing Levy (${payPeriod})`,
      statutoryRows,
      {
        subtitle: `Pay Period: ${payPeriod} | Currency: ${tenant.currency}`,
        colWidths: [12, 24, 14, 14, 16, 14, 22, 22],
      }
    );

    XLSX.utils.book_append_sheet(wb, masterWs, 'Payroll Master');
    XLSX.utils.book_append_sheet(wb, statutoryWs, 'Statutory Returns');
    XLSX.writeFile(wb, `${tenant.slug}-payroll-statutory-${payPeriod}.xlsx`);
    onNotify(`Exported Payroll & Statutory Returns (${payPeriod}) to Excel.`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between dark:border-slate-800 dark:bg-slate-900">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Payroll &amp; Statutory Deductions
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Automated PAYE, NSSF, SHIF, Affordable Housing Levy, and SACCO / Staff Loan deductions for Teaching &amp; Non-Teaching staff.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="month"
            value={payPeriod}
            onChange={(e) => setPayPeriod(e.target.value)}
            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
          <button
            type="button"
            disabled={!canManage}
            onClick={async () => {
              await saasApi.generatePayrollRun(tenant.id, payPeriod);
              await onRefresh();
              onNotify(`Synced all active Teaching & Non-Teaching staff into ${payPeriod} payroll.`);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
          >
            <Users className="h-3.5 w-3.5" />
            Sync Staff Roster
          </button>
          <button
            type="button"
            onClick={handleExportPayrollExcel}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <Download className="h-3.5 w-3.5" />
            Statutory Excel
          </button>
          <button
            type="button"
            disabled={!canManage}
            onClick={() => openEditModal()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Staff Pay
          </button>
        </div>
      </div>

      {/* Statutory Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Total Gross Pay</p>
          <p className="mt-1 font-mono text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {formatCurrency(totals.gross, tenant.currency)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">PAYE Tax</p>
          <p className="mt-1 font-mono text-base font-bold tabular-nums text-rose-700 dark:text-rose-400">
            {formatCurrency(totals.paye, tenant.currency)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">NSSF</p>
          <p className="mt-1 font-mono text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {formatCurrency(totals.nssf, tenant.currency)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">SHIF (2.75%)</p>
          <p className="mt-1 font-mono text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {formatCurrency(totals.shif, tenant.currency)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Housing Levy (1.5%)</p>
          <p className="mt-1 font-mono text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {formatCurrency(totals.housing, tenant.currency)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Total Net Pay</p>
          <p className="mt-1 font-mono text-base font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
            {formatCurrency(totals.net, tenant.currency)}
          </p>
        </div>
      </div>

      {/* Payroll Table */}
      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Staff Member</th>
                <th className="px-3 py-3 text-right">Gross Pay</th>
                <th className="px-3 py-3 text-right">PAYE</th>
                <th className="px-3 py-3 text-right">NSSF</th>
                <th className="px-3 py-3 text-right">SHIF</th>
                <th className="px-3 py-3 text-right">Housing</th>
                <th className="px-3 py-3 text-right">SACCO</th>
                <th className="px-3 py-3 text-right">Net Pay</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {scopedEntries.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">
                    No payroll entries for {payPeriod}. Click Sync Staff Roster above to generate payroll.
                  </td>
                </tr>
              ) : (
                scopedEntries.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {p.staffName}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {p.staffCategory} · {p.designation}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {formatCurrency(p.grossPay, tenant.currency)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-rose-700 dark:text-rose-400">
                      {formatCurrency(p.paye, tenant.currency)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {formatCurrency(p.nssf, tenant.currency)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {formatCurrency(p.shif, tenant.currency)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {formatCurrency(p.housingLevy, tenant.currency)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                      {formatCurrency(p.saccoOrLoan, tenant.currency)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                      {formatCurrency(p.netPay, tenant.currency)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                          p.status === 'Disbursed'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                            : p.status === 'Approved'
                            ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                            : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {canManage && (
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditModal(p)}
                            className="rounded border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
                          >
                            Edit
                          </button>
                          {p.status !== 'Disbursed' && (
                            <button
                              type="button"
                              onClick={async () => {
                                const next: PayrollStatus =
                                  p.status === 'Draft' ? 'Approved' : 'Disbursed';
                                await saasApi.updatePayrollStatus(tenant.id, p.id, next);
                                await onRefresh();
                                onNotify(`${p.staffName} payroll marked ${next}.`);
                              }}
                              className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                            >
                              {p.status === 'Draft' ? 'Approve' : 'Pay'}
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {editingId ? 'Edit Staff Payroll & Deductions' : 'Add Staff Payroll Entry'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSaveEntry} className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Staff Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={staffName}
                    onChange={(e) => setStaffName(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Staff Category
                  </label>
                  <select
                    value={staffCategory}
                    onChange={(e) =>
                      setStaffCategory(e.target.value as 'Teaching' | 'Non-Teaching')
                    }
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value="Teaching">Teaching</option>
                    <option value="Non-Teaching">Non-Teaching</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Designation
                  </label>
                  <input
                    type="text"
                    value={designation}
                    onChange={(e) => setDesignation(e.target.value)}
                    placeholder="e.g. Senior Teacher"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Basic Salary ({tenant.currency}) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={basicSalary}
                    onChange={(e) => setBasicSalary(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Allowances
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={allowances}
                    onChange={(e) => setAllowances(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    SACCO / Loan
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={saccoOrLoan}
                    onChange={(e) => setSaccoOrLoan(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Status
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as PayrollStatus)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value="Draft">Draft</option>
                    <option value="Approved">Approved</option>
                    <option value="Disbursed">Disbursed</option>
                  </select>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                PAYE, NSSF, SHIF, and Housing Levy are computed automatically from Gross Pay on save.
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Payroll'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 4. BUDGET TRACKING & SPECIFIC BUDGET APPROVAL PANEL
// ============================================================================
export function BudgetTrackingPanel({
  workspace,
  canManage,
  actorRole,
  onRefresh,
  onNotify,
}: PanelProps) {
  const { tenant } = workspace;
  const budgets = workspace.budgets || [];
  const expenses = workspace.expenses || [];
  const payrollEntries = workspace.payrollEntries || [];

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
      .reduce((s, p) => s + p.grossPay, 0);
    const payrollCommitted = payrollEntries
      .filter((p) => p.status !== 'Disbursed')
      .reduce((s, p) => s + p.grossPay, 0);

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

      {/* Budget Line Approval Confirmation Modal */}
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
