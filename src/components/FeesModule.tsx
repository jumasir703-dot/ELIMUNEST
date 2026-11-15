import { useMemo, useState } from 'react';
import { CreditCard, Plus, Printer, Receipt, Search, X } from 'lucide-react';
import { saasApi } from '../lib/api';
import { formatCurrency, formatDateShort } from '../lib/format';
import type {
  FeeInvoice,
  InvoiceStatus,
  PaymentMethod,
  TenantWorkspaceData,
  UserRole,
} from '../shared/types';

interface FeesModuleProps {
  workspace: TenantWorkspaceData;
  currentRole: UserRole;
  onRefresh: () => Promise<void>;
  onNotify: (title: string, tone?: 'success' | 'error') => void;
}

const PAYMENT_METHODS: PaymentMethod[] = ['Bank Transfer', 'Card', 'Mobile Money', 'Cash'];

export function FeesModule({ workspace, currentRole, onRefresh, onNotify }: FeesModuleProps) {
  const { tenant, students, invoices, feeStructures } = workspace;

  const [activeTab, setActiveTab] = useState<'invoices' | 'structures'>('invoices');
  const [statusFilter, setStatusFilter] = useState<'All' | InvoiceStatus>('All');
  const [searchQuery, setSearchQuery] = useState('');

  const [paymentModalInvoice, setPaymentModalInvoice] = useState<FeeInvoice | null>(null);
  const [receiptInvoice, setReceiptInvoice] = useState<FeeInvoice | null>(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [saving, setSaving] = useState(false);

  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    method: 'Bank Transfer' as PaymentMethod,
    reference: '',
  });

  const [invoiceForm, setInvoiceForm] = useState({
    studentId: students[0]?.id || '',
    term: tenant.currentTerm,
    dueDate: '2026-12-05',
    totalAmount: String(feeStructures[0]?.totalFee || 5000),
  });

  const [structureForm, setStructureForm] = useState({
    grade: tenant.grades[0] || 'Grade 9',
    term: tenant.currentTerm,
    tuitionFee: '4200',
    labFee: '350',
    technologyFee: '250',
    activitiesFee: '200',
  });

  const metrics = useMemo(() => {
    const totalBilled = invoices.reduce((a, i) => a + i.totalAmount, 0);
    const totalCollected = invoices.reduce((a, i) => a + i.paidAmount, 0);
    const totalOutstanding = invoices.reduce((a, i) => a + i.balance, 0);
    const overdueCount = invoices.filter((i) => i.status === 'Overdue').length;
    return { totalBilled, totalCollected, totalOutstanding, overdueCount };
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return invoices.filter((inv) => {
      if (statusFilter !== 'All' && inv.status !== statusFilter) return false;
      if (!q) return true;
      return (
        inv.studentName.toLowerCase().includes(q) ||
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.studentCode.toLowerCase().includes(q)
      );
    });
  }, [invoices, statusFilter, searchQuery]);

  function openPaymentModal(inv: FeeInvoice) {
    setPaymentModalInvoice(inv);
    setPaymentForm({
      amount: String(inv.balance),
      method: 'Bank Transfer',
      reference: '',
    });
  }

  async function handleRecordPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!paymentModalInvoice) return;
    const amount = Number(paymentForm.amount);
    if (!amount || amount <= 0) {
      onNotify('Enter a valid payment amount.', 'error');
      return;
    }
    setSaving(true);
    try {
      const { invoice } = await saasApi.recordPayment(tenant.id, paymentModalInvoice.id, {
        amount,
        method: paymentForm.method,
        reference: paymentForm.reference,
        recordedBy: `${currentRole} Office`,
      });
      await onRefresh();
      setPaymentModalInvoice(null);
      setReceiptInvoice(invoice);
      onNotify(`Payment of ${formatCurrency(amount, tenant.currency)} recorded.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Payment failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateInvoice(e: React.FormEvent) {
    e.preventDefault();
    if (!invoiceForm.studentId) return;
    setSaving(true);
    try {
      const { invoice } = await saasApi.createInvoice(tenant.id, {
        studentId: invoiceForm.studentId,
        term: invoiceForm.term,
        dueDate: invoiceForm.dueDate,
        totalAmount: Number(invoiceForm.totalAmount),
      });
      await onRefresh();
      setShowInvoiceModal(false);
      onNotify(`Invoice ${invoice.invoiceNumber} issued.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to issue invoice', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveStructure(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await saasApi.upsertFeeStructure(tenant.id, {
        grade: structureForm.grade,
        term: structureForm.term,
        tuitionFee: Number(structureForm.tuitionFee),
        labFee: Number(structureForm.labFee),
        technologyFee: Number(structureForm.technologyFee),
        activitiesFee: Number(structureForm.activitiesFee),
      });
      await onRefresh();
      onNotify(`Fee schedule saved for ${structureForm.grade}.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to save fee structure', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Fee Management & Billing
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Tuition fee structures, student invoice ledger, partial/full payment capture, and printable receipts.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            <button
              onClick={() => setActiveTab('invoices')}
              className={`whitespace-nowrap shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === 'invoices'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Invoices Ledger
            </button>
            <button
              onClick={() => setActiveTab('structures')}
              className={`whitespace-nowrap shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === 'structures'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Fee Structures
            </button>
          </div>
          <button
            onClick={() => setShowInvoiceModal(true)}
            disabled={students.length === 0}
            className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Issue Invoice
          </button>
        </div>
      </div>

      {/* 4 Financial KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Billed</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums dark:text-slate-100">
            {formatCurrency(metrics.totalBilled, tenant.currency)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Collected Revenue</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-emerald-700 tabular-nums dark:text-emerald-400">
            {formatCurrency(metrics.totalCollected, tenant.currency)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Outstanding Receivables</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-amber-700 tabular-nums dark:text-amber-400">
            {formatCurrency(metrics.totalOutstanding, tenant.currency)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Overdue Accounts</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-red-700 tabular-nums dark:text-red-400">
            {metrics.overdueCount}
          </p>
        </div>
      </div>

      {activeTab === 'invoices' ? (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
              {(['All', 'Paid', 'Partial', 'Pending', 'Overdue'] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`whitespace-nowrap shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    statusFilter === status
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search invoice, student..."
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Invoice</th>
                    <th className="px-4 py-3">Student</th>
                    <th className="px-4 py-3">Due Date</th>
                    <th className="px-4 py-3 text-right">Billed</th>
                    <th className="px-4 py-3 text-right">Paid</th>
                    <th className="px-4 py-3 text-right">Balance</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                        No invoices match your filter.
                      </td>
                    </tr>
                  ) : (
                    filteredInvoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-3">
                          <p className="font-mono text-xs font-medium text-slate-900 tabular-nums dark:text-slate-100">
                            {inv.invoiceNumber}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{inv.term}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-900 dark:text-slate-100">{inv.studentName}</p>
                          <p className="font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
                            {inv.studentCode} · {inv.grade}
                          </p>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600 tabular-nums dark:text-slate-400">
                          {formatDateShort(inv.dueDate)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-slate-700 tabular-nums dark:text-slate-300">
                          {formatCurrency(inv.totalAmount, tenant.currency)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-emerald-700 tabular-nums dark:text-emerald-400">
                          {formatCurrency(inv.paidAmount, tenant.currency)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                          {formatCurrency(inv.balance, tenant.currency)}
                        </td>
                        <td className="px-4 py-3 text-xs font-semibold">
                          <span
                            className={
                              inv.status === 'Paid'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : inv.status === 'Overdue'
                                ? 'text-red-700 dark:text-red-400'
                                : inv.status === 'Partial'
                                ? 'text-blue-700 dark:text-blue-400'
                                : 'text-amber-700 dark:text-amber-400'
                            }
                          >
                            {inv.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-3">
                            {inv.balance > 0 && (
                              <button
                                onClick={() => openPaymentModal(inv)}
                                className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                              >
                                <CreditCard className="h-3.5 w-3.5" />
                                Collect
                              </button>
                            )}
                            {inv.payments.length > 0 && (
                              <button
                                onClick={() => setReceiptInvoice(inv)}
                                className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                              >
                                <Receipt className="h-3.5 w-3.5" />
                                Receipt
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white lg:col-span-7 dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Configured Fee Templates
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50/70 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-2.5">Grade</th>
                    <th className="px-4 py-2.5 text-right">Tuition</th>
                    <th className="px-4 py-2.5 text-right">Lab</th>
                    <th className="px-4 py-2.5 text-right">Tech</th>
                    <th className="px-4 py-2.5 text-right">Activities</th>
                    <th className="px-4 py-2.5 text-right">Total Term Fee</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {feeStructures.map((fs) => (
                    <tr key={fs.id}>
                      <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                        {fs.grade}
                        <span className="block text-xs font-normal text-slate-500">{fs.term}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                        {formatCurrency(fs.tuitionFee, tenant.currency)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                        {formatCurrency(fs.labFee, tenant.currency)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                        {formatCurrency(fs.technologyFee, tenant.currency)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                        {formatCurrency(fs.activitiesFee, tenant.currency)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                        {formatCurrency(fs.totalFee, tenant.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <form
            onSubmit={handleSaveStructure}
            className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-5 dark:border-slate-800 dark:bg-slate-900"
          >
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Add / Update Grade Fee Structure
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Grade
                </label>
                <select
                  value={structureForm.grade}
                  onChange={(e) => setStructureForm({ ...structureForm, grade: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  {tenant.grades.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Term
                </label>
                <input
                  type="text"
                  value={structureForm.term}
                  onChange={(e) => setStructureForm({ ...structureForm, term: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Tuition Fee
                </label>
                <input
                  type="number"
                  min={0}
                  value={structureForm.tuitionFee}
                  onChange={(e) => setStructureForm({ ...structureForm, tuitionFee: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Laboratory Fee
                </label>
                <input
                  type="number"
                  min={0}
                  value={structureForm.labFee}
                  onChange={(e) => setStructureForm({ ...structureForm, labFee: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Technology Fee
                </label>
                <input
                  type="number"
                  min={0}
                  value={structureForm.technologyFee}
                  onChange={(e) =>
                    setStructureForm({ ...structureForm, technologyFee: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Activities Fee
                </label>
                <input
                  type="number"
                  min={0}
                  value={structureForm.activitiesFee}
                  onChange={(e) =>
                    setStructureForm({ ...structureForm, activitiesFee: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Fee Structure'}
            </button>
          </form>
        </div>
      )}

      {/* Record Payment Modal */}
      {paymentModalInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  Record Fee Payment
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {paymentModalInvoice.invoiceNumber} · {paymentModalInvoice.studentName}
                </p>
              </div>
              <button
                onClick={() => setPaymentModalInvoice(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleRecordPayment} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Payment Amount (Balance: {formatCurrency(paymentModalInvoice.balance, tenant.currency)})
                </label>
                <input
                  required
                  type="number"
                  min={1}
                  max={paymentModalInvoice.balance}
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Payment Method
                </label>
                <select
                  value={paymentForm.method}
                  onChange={(e) =>
                    setPaymentForm({ ...paymentForm, method: e.target.value as PaymentMethod })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Transaction Reference
                </label>
                <input
                  type="text"
                  value={paymentForm.reference}
                  onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })}
                  placeholder="e.g. WIRE-88412"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPaymentModalInvoice(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {saving ? 'Recording...' : 'Confirm Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Printable Receipt Modal */}
      {receiptInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  {tenant.name} · Official Fee Receipt
                </p>
                <h2 className="mt-1 font-mono text-lg font-bold text-slate-900 dark:text-slate-100">
                  {receiptInvoice.invoiceNumber}
                </h2>
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
                  onClick={() => setReceiptInvoice(null)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-2 text-xs">
              <p className="text-slate-600 dark:text-slate-400">
                Student: <strong className="text-slate-900 dark:text-slate-100">{receiptInvoice.studentName}</strong> ({receiptInvoice.studentCode})
              </p>
              <p className="text-slate-600 dark:text-slate-400">
                Term: <strong className="text-slate-900 dark:text-slate-100">{receiptInvoice.term}</strong> · Grade: {receiptInvoice.grade}
              </p>
            </div>

            <div className="mt-4 divide-y divide-slate-100 border-y border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              {receiptInvoice.payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2.5 text-xs">
                  <div>
                    <p className="font-mono font-medium text-slate-900 dark:text-slate-100">
                      {p.receiptNumber} · {p.method}
                    </p>
                    <p className="text-slate-500 dark:text-slate-400">
                      Ref: {p.reference} · {formatDateShort(p.paidAt)}
                    </p>
                  </div>
                  <span className="font-mono font-semibold text-emerald-700 tabular-nums dark:text-emerald-400">
                    {formatCurrency(p.amount, tenant.currency)}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between text-sm font-semibold">
              <span className="text-slate-700 dark:text-slate-300">Remaining Balance</span>
              <span className="font-mono text-slate-900 tabular-nums dark:text-slate-100">
                {formatCurrency(receiptInvoice.balance, tenant.currency)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Issue Invoice Modal */}
      {showInvoiceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                Issue Student Fee Invoice
              </h2>
              <button
                onClick={() => setShowInvoiceModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreateInvoice} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Student
                </label>
                <select
                  value={invoiceForm.studentId}
                  onChange={(e) => setInvoiceForm({ ...invoiceForm, studentId: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fullName} ({s.studentCode} · {s.grade})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Term
                </label>
                <input
                  required
                  type="text"
                  value={invoiceForm.term}
                  onChange={(e) => setInvoiceForm({ ...invoiceForm, term: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Due Date
                  </label>
                  <input
                    required
                    type="date"
                    value={invoiceForm.dueDate}
                    onChange={(e) => setInvoiceForm({ ...invoiceForm, dueDate: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Amount ({tenant.currency})
                  </label>
                  <input
                    required
                    type="number"
                    min={1}
                    value={invoiceForm.totalAmount}
                    onChange={(e) => setInvoiceForm({ ...invoiceForm, totalAmount: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowInvoiceModal(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? 'Issuing...' : 'Issue Invoice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
