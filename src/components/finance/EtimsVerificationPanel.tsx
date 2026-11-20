import { useState } from 'react';
import * as XLSX from 'xlsx';
import { Download, ShieldCheck, Trash2 } from 'lucide-react';
import { createBrandedWorksheetFromObjects } from '../../lib/documentBranding';
import { saasApi } from '../../lib/api';
import { formatCurrency, formatDateShort } from '../../lib/format';
import type { FinanceControlPanelProps } from './types';

export function EtimsVerificationPanel({
  workspace,
  canManage,
  actorRole,
  onRefresh,
  onNotify,
}: FinanceControlPanelProps) {
  const { tenant } = workspace;
  const expenses = (workspace.expenses || []).filter((e) => !e.voided);
  const etimsChecks = (workspace.etimsChecks || []).filter((c) => !c.voided);

  const [expenseId, setExpenseId] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [supplierKraPin, setSupplierKraPin] = useState('');
  const [cuInvoiceNumber, setCuInvoiceNumber] = useState('');
  const [receiptDate, setReceiptDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [totalAmount, setTotalAmount] = useState('');
  const [exemptVat, setExemptVat] = useState(false);
  const [qrInput, setQrInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [voidTarget, setVoidTarget] = useState<{ id: string; label: string } | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidSubmitting, setVoidSubmitting] = useState(false);

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
      <div className="rounded-xl border border-slate-200 bg-white p-5 xl:col-span-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 pb-3 dark:border-slate-800">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Manual KRA eTIMS Format &amp; VAT Check
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Validate supplier KRA PIN format, CU invoice structure, and 16% VAT breakdown against school expense vouchers.
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
            {submitting ? 'Checking Receipt...' : 'Check Format & Record eTIMS Entry'}
          </button>
        </form>
      </div>

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
                          chk.status === 'Checked manually'
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
                          onClick={() => {
                            setVoidReason('');
                            setVoidTarget({ id: chk.id, label: `${chk.cuInvoiceNumber} (${chk.supplierName})` });
                          }}
                          className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                          title="Void eTIMS check"
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

      {voidTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!voidReason.trim()) {
                onNotify('Please provide a reason for voiding this eTIMS entry.', 'error');
                return;
              }
              setVoidSubmitting(true);
              try {
                await saasApi.deleteEtimsCheck(tenant.id, voidTarget.id, voidReason.trim());
                await onRefresh();
                onNotify('Voided eTIMS check record.');
                setVoidTarget(null);
              } catch (err) {
                onNotify(err instanceof Error ? err.message : 'Unable to void eTIMS entry', 'error');
              } finally {
                setVoidSubmitting(false);
              }
            }}
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
          >
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Void eTIMS Check Record
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Entry: {voidTarget.label}
            </p>
            <div className="mt-4">
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Reason for Voiding *
              </label>
              <textarea
                rows={3}
                required
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="e.g. Duplicate CU entry or cancelled supplier invoice"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setVoidTarget(null)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={voidSubmitting}
                className="rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {voidSubmitting ? 'Voiding...' : 'Confirm Void'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
