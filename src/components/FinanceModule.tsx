import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  Download,
  FileSpreadsheet,
  FileText,
  Landmark,
  Paperclip,
  PiggyBank,
  Plus,
  Receipt,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { saasApi } from '../lib/api';
import { createBrandedWorksheetFromObjects } from '../lib/documentBranding';
import { formatCurrency, formatDateShort } from '../lib/format';
import {
  EXPENSE_ATTACHMENT_TYPES,
  EXPENSE_CATEGORIES,
  type ExpenseAttachment,
  type ExpenseAttachmentType,
  type ExpenseCategory,
  type ExpenseStatus,
  type FinanceAuditEntry,
  type PaymentMethod,
  type SchoolExpense,
  type TenantWorkspaceData,
  type UserRole,
} from '../shared/types';
import { FeesModule } from './FeesModule';
import { FinancialBooksPanel } from './FinancialBooksPanel';
import {
  BudgetTrackingPanel,
  EtimsVerificationPanel,
  PayrollDeductionsPanel,
  ReconciliationPanel,
} from './FinanceControlsPanels';

interface FinanceModuleProps {
  workspace: TenantWorkspaceData;
  currentRole: UserRole;
  readOnly?: boolean;
  onRefresh: () => Promise<void>;
  onNotify: (title: string, tone?: 'success' | 'error') => void;
}

type FinanceSubModule =
  | 'fees'
  | 'expensing'
  | 'etims'
  | 'reconciliation'
  | 'payroll'
  | 'budgets'
  | 'books'
  | 'audit';

interface StagedAttachment {
  localId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  docType: ExpenseAttachmentType;
  dataUrl: string;
}

const PAYMENT_METHODS: PaymentMethod[] = ['Mobile Money', 'Bank Transfer', 'Card', 'Cash'];
const EXPENSE_STATUSES: ExpenseStatus[] = ['Pending Approval', 'Approved', 'Paid'];

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Failed to read file contents'));
    };
    reader.onerror = () => reject(new Error(`Unable to read file "${file.name}"`));
    reader.readAsDataURL(file);
  });
}

function getStatusBadgeClass(status: ExpenseStatus): string {
  switch (status) {
    case 'Paid':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-300';
    case 'Approved':
      return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800/70 dark:bg-blue-950/40 dark:text-blue-300';
    default:
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-300';
  }
}

export function FinanceModule({
  workspace,
  currentRole,
  readOnly = false,
  onRefresh,
  onNotify,
}: FinanceModuleProps) {
  const { tenant, invoices } = workspace;
  const expenses = workspace.expenses || [];

  const [subModule, setSubModule] = useState<FinanceSubModule>(() =>
    currentRole === 'Budget Approver' ? 'budgets' : 'fees'
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');

  // Create expense modal state
  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>(EXPENSE_CATEGORIES[0]);
  const [vendor, setVendor] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Bank Transfer');
  const [reference, setReference] = useState('');
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [newDocType, setNewDocType] = useState<ExpenseAttachmentType>('Official Receipt');
  const [stagedAttachments, setStagedAttachments] = useState<StagedAttachment[]>([]);
  const [saving, setSaving] = useState(false);
  const createFileInputRef = useRef<HTMLInputElement | null>(null);

  // Supporting documents drawer/modal for existing expense
  const [docsModalExpenseId, setDocsModalExpenseId] = useState<string | null>(null);
  const [previewAttachmentId, setPreviewAttachmentId] = useState<string | null>(null);
  const [existingDocType, setExistingDocType] =
    useState<ExpenseAttachmentType>('Signed Payment Voucher');
  const [uploadingExistingDoc, setUploadingExistingDoc] = useState(false);
  const existingFileInputRef = useRef<HTMLInputElement | null>(null);

  // Per-row action state & audit modal state
  const [busyExpenseId, setBusyExpenseId] = useState<string | null>(null);
  const [expenseReasonModal, setExpenseReasonModal] = useState<{
    mode: 'void' | 'reverse';
    expense: SchoolExpense;
  } | null>(null);
  const [expenseReasonText, setExpenseReasonText] = useState('');

  // Admin finance audit trail
  const [auditLogs, setAuditLogs] = useState<FinanceAuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditSearch, setAuditSearch] = useState('');

  const canManageExpenses =
    !readOnly &&
    (currentRole === 'Super Admin' || currentRole === 'Admin' || currentRole === 'Bursar');
  const canApproveBudgets =
    currentRole === 'Budget Approver' ||
    (!readOnly &&
      (currentRole === 'Admin' ||
        currentRole === 'Super Admin' ||
        currentRole === 'Developer' ||
        currentRole === 'Bursar'));
  const canViewAudit =
    currentRole === 'Admin' || currentRole === 'Super Admin' || currentRole === 'Developer';

  const activeExpenses = useMemo(
    () => expenses.filter((e) => !e.voided),
    [expenses]
  );

  useEffect(() => {
    if (subModule !== 'audit' || !canViewAudit) return;
    let cancelled = false;
    setAuditLoading(true);
    saasApi
      .getFinanceAuditLogs(tenant.id, 150)
      .then((res) => {
        if (!cancelled) setAuditLogs(res.logs || []);
      })
      .catch((err) => {
        if (!cancelled) {
          onNotify(err instanceof Error ? err.message : 'Unable to load finance audit log', 'error');
        }
      })
      .finally(() => {
        if (!cancelled) setAuditLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [subModule, canViewAudit, tenant.id, onNotify]);

  const docsModalExpense = useMemo(
    () => activeExpenses.find((e) => e.id === docsModalExpenseId) || null,
    [activeExpenses, docsModalExpenseId]
  );

  const activePreviewAttachment: ExpenseAttachment | null = useMemo(() => {
    if (!docsModalExpense) return null;
    const list = docsModalExpense.attachments || [];
    if (list.length === 0) return null;
    return list.find((a) => a.id === previewAttachmentId) || list[0];
  }, [docsModalExpense, previewAttachmentId]);

  const treasurySummary = useMemo(() => {
    const collectedRevenue = invoices.reduce((sum, inv) => sum + inv.paidAmount, 0);
    const receivables = invoices.reduce((sum, inv) => sum + inv.balance, 0);
    const totalBilled = invoices.reduce((sum, inv) => sum + inv.totalAmount, 0);

    let paidExpenses = 0;
    let committedExpenses = 0;
    for (const exp of activeExpenses) {
      if (exp.reversed) continue;
      if (exp.status === 'Paid') {
        paidExpenses += exp.amount;
      } else {
        committedExpenses += exp.amount;
      }
    }

    const totalExpenses = paidExpenses + committedExpenses;
    const netCashPosition = collectedRevenue - paidExpenses;

    return {
      collectedRevenue,
      receivables,
      totalBilled,
      paidExpenses,
      committedExpenses,
      totalExpenses,
      netCashPosition,
    };
  }, [invoices, activeExpenses]);

  const filteredExpenses = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return activeExpenses
      .filter((exp) => {
        if (categoryFilter !== 'All' && exp.category !== categoryFilter) return false;
        if (statusFilter !== 'All' && exp.status !== statusFilter) return false;
        if (!q) return true;
        return (
          exp.voucherNumber.toLowerCase().includes(q) ||
          exp.title.toLowerCase().includes(q) ||
          exp.vendor.toLowerCase().includes(q) ||
          exp.category.toLowerCase().includes(q) ||
          exp.reference.toLowerCase().includes(q)
        );
      })
      .sort(
        (a, b) =>
          b.expenseDate.localeCompare(a.expenseDate) || b.createdAt.localeCompare(a.createdAt)
      );
  }, [activeExpenses, searchQuery, categoryFilter, statusFilter]);

  const categoryBreakdown = useMemo(() => {
    const map = new Map<
      ExpenseCategory,
      { category: ExpenseCategory; total: number; paid: number; count: number }
    >();
    for (const cat of EXPENSE_CATEGORIES) {
      map.set(cat, { category: cat, total: 0, paid: 0, count: 0 });
    }
    for (const exp of activeExpenses) {
      if (exp.reversed) continue;
      const entry = map.get(exp.category) || {
        category: exp.category,
        total: 0,
        paid: 0,
        count: 0,
      };
      entry.total += exp.amount;
      if (exp.status === 'Paid') entry.paid += exp.amount;
      entry.count += 1;
      map.set(exp.category, entry);
    }
    const grandTotal = Array.from(map.values()).reduce((sum, item) => sum + item.total, 0);
    return Array.from(map.values())
      .filter((item) => item.count > 0)
      .sort((a, b) => b.total - a.total)
      .map((item) => ({
        ...item,
        sharePct: grandTotal > 0 ? Math.round((item.total / grandTotal) * 100) : 0,
      }));
  }, [activeExpenses]);

  function resetExpenseForm() {
    setTitle('');
    setCategory(EXPENSE_CATEGORIES[0]);
    setVendor('');
    setAmount('');
    setPaymentMethod('Bank Transfer');
    setReference('');
    setExpenseDate(new Date().toISOString().slice(0, 10));
    setNotes('');
    setNewDocType('Official Receipt');
    setStagedAttachments([]);
  }

  async function handleStageFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const remainingSlots = 6 - stagedAttachments.length;
    if (remainingSlots <= 0) {
      onNotify('Maximum of 6 supporting documents allowed per expense voucher.', 'error');
      return;
    }

    const picked = Array.from(files).slice(0, remainingSlots);
    const nextList: StagedAttachment[] = [];

    for (const file of picked) {
      if (file.size > 2.4 * 1024 * 1024) {
        onNotify(`"${file.name}" exceeds the 2.4 MB limit per file.`, 'error');
        continue;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        nextList.push({
          localId: `staged-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          fileSize: file.size,
          docType: newDocType,
          dataUrl,
        });
      } catch (err) {
        onNotify(err instanceof Error ? err.message : 'Unable to attach file', 'error');
      }
    }

    if (nextList.length > 0) {
      setStagedAttachments((prev) => [...prev, ...nextList]);
    }
    if (createFileInputRef.current) {
      createFileInputRef.current.value = '';
    }
  }

  async function handleCreateExpense(e: React.FormEvent) {
    e.preventDefault();
    if (!canManageExpenses) {
      onNotify('Switch role to Bursar, Admin, or Super Admin to record expenses.', 'error');
      return;
    }
    const parsedAmount = Number(amount);
    if (!title.trim() || !vendor.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      onNotify('Enter a valid expense description, vendor, and positive amount.', 'error');
      return;
    }

    setSaving(true);
    try {
      const res = await saasApi.createExpense(tenant.id, {
        title: title.trim(),
        category,
        vendor: vendor.trim(),
        amount: Math.round(parsedAmount),
        paymentMethod,
        reference: reference.trim(),
        expenseDate,
        status: 'Pending Approval',
        recordedBy: `${currentRole} Desk`,
        notes: notes.trim() || undefined,
        attachments: stagedAttachments.map((att) => ({
          fileName: att.fileName,
          mimeType: att.mimeType,
          fileSize: att.fileSize,
          docType: att.docType,
          dataUrl: att.dataUrl,
          uploadedBy: `${currentRole} Desk`,
        })),
      });
      await onRefresh();
      setExpenseModalOpen(false);
      resetExpenseForm();
      const docCount = res.expense.attachments?.length || 0;
      onNotify(
        `Expense voucher ${res.expense.voucherNumber} recorded (${res.expense.status})${
          docCount > 0 ? ` with ${docCount} supporting document(s)` : ''
        }.`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to record expense voucher', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleUploadAttachmentToExisting(files: FileList | null) {
    if (!docsModalExpense || !files || files.length === 0) return;
    if (!canManageExpenses) {
      onNotify('Switch role to Bursar, Admin, or Super Admin to upload documents.', 'error');
      return;
    }

    const file = files[0];
    if (file.size > 2.4 * 1024 * 1024) {
      onNotify(`"${file.name}" exceeds the 2.4 MB limit per file.`, 'error');
      return;
    }

    setUploadingExistingDoc(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const res = await saasApi.addExpenseAttachment(tenant.id, docsModalExpense.id, {
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileSize: file.size,
        docType: existingDocType,
        dataUrl,
        uploadedBy: `${currentRole} Desk`,
      });
      await onRefresh();
      const added = res.expense.attachments?.[res.expense.attachments.length - 1];
      if (added) setPreviewAttachmentId(added.id);
      onNotify(`Attached ${existingDocType} (${file.name}) to ${docsModalExpense.voucherNumber}.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to upload supporting document', 'error');
    } finally {
      setUploadingExistingDoc(false);
      if (existingFileInputRef.current) {
        existingFileInputRef.current.value = '';
      }
    }
  }

  async function handleDeleteExistingAttachment(expense: SchoolExpense, attachmentId: string) {
    if (!canManageExpenses) {
      onNotify('Switch role to Bursar, Admin, or Super Admin to remove documents.', 'error');
      return;
    }
    setUploadingExistingDoc(true);
    try {
      await saasApi.deleteExpenseAttachment(tenant.id, expense.id, attachmentId);
      await onRefresh();
      if (previewAttachmentId === attachmentId) {
        setPreviewAttachmentId(null);
      }
      onNotify(`Supporting document removed from ${expense.voucherNumber}.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to remove attachment', 'error');
    } finally {
      setUploadingExistingDoc(false);
    }
  }

  async function handleStatusTransition(expense: SchoolExpense, nextStatus: ExpenseStatus) {
    if (!canManageExpenses) {
      onNotify('Switch role to Bursar, Admin, or Super Admin to update vouchers.', 'error');
      return;
    }
    setBusyExpenseId(expense.id);
    try {
      await saasApi.updateExpenseStatus(tenant.id, expense.id, nextStatus);
      await onRefresh();
      onNotify(`Voucher ${expense.voucherNumber} marked as ${nextStatus}.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to update voucher status', 'error');
    } finally {
      setBusyExpenseId(null);
    }
  }

  async function handleConfirmExpenseReason(e: React.FormEvent) {
    e.preventDefault();
    if (!expenseReasonModal || !canManageExpenses) return;
    if (!expenseReasonText.trim()) {
      onNotify('Please enter an audit reason.', 'error');
      return;
    }
    const target = expenseReasonModal.expense;
    setBusyExpenseId(target.id);
    try {
      if (expenseReasonModal.mode === 'reverse') {
        await saasApi.reverseExpense(tenant.id, target.id, expenseReasonText.trim());
        onNotify(`Expense voucher ${target.voucherNumber} reversed.`);
      } else {
        await saasApi.deleteExpense(tenant.id, target.id, expenseReasonText.trim());
        onNotify(`Expense voucher ${target.voucherNumber} voided.`);
      }
      setExpenseReasonModal(null);
      setExpenseReasonText('');
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to update expense voucher', 'error');
    } finally {
      setBusyExpenseId(null);
    }
  }

  function handleExportExpensesExcel() {
    if (filteredExpenses.length === 0) {
      onNotify('No expense vouchers match the current filter to export.', 'error');
      return;
    }
    const rows = filteredExpenses.map((exp) => ({
      Voucher_Number: exp.voucherNumber,
      Date: exp.expenseDate,
      Description: exp.title,
      Category: exp.category,
      Vendor: exp.vendor,
      Currency: tenant.currency,
      Amount: exp.amount,
      Payment_Method: exp.paymentMethod,
      Reference: exp.reference,
      Status: exp.status,
      Supporting_Docs_Count: (exp.attachments || []).length,
      Supporting_Documents:
        (exp.attachments || []).map((a) => `${a.docType} (${a.fileName})`).join('; ') || 'None',
      Recorded_By: exp.recordedBy,
      Notes: exp.notes || '',
    }));

    const ws = createBrandedWorksheetFromObjects(
      tenant,
      'School Expense Vouchers Register',
      rows,
      {
        subtitle: `${filteredExpenses.length} vouchers | Currency: ${tenant.currency}`,
        colWidths: [16, 12, 32, 24, 24, 10, 14, 16, 18, 18, 14, 36, 18, 28],
      }
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Expense Vouchers');
    const safeSlug = tenant.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    XLSX.writeFile(wb, `${safeSlug}-expenses-${new Date().toISOString().slice(0, 10)}.xlsx`);
    onNotify(`Exported ${filteredExpenses.length} expense vouchers to Excel.`);
  }

  return (
    <div className="space-y-6">
      {/* Unified Finance & Accounting Hub Header */}
      <div className="space-y-4 border-b border-slate-200 pb-5 dark:border-slate-800">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-blue-600 dark:border-slate-800 dark:bg-slate-900 dark:text-blue-400">
            <Landmark className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                Finance &amp; Accounting
              </h1>
              <span className="font-mono text-xs font-medium text-slate-500 dark:text-slate-400">
                · {tenant.currency} Ledger
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Unified school treasury: Fee &amp; Billing, Expensing, KRA eTIMS Verification, M-Pesa/Bank Reconciliation, Statutory Payroll, Budgets &amp; Approvals, and Financial Books.
            </p>
          </div>
        </div>

        {/* Sub-module Navigation Bar */}
        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-slate-100/80 p-1 no-print dark:border-slate-800 dark:bg-slate-900">
          <button
            type="button"
            onClick={() => setSubModule('fees')}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold whitespace-nowrap transition-colors ${
              subModule === 'fees'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            <CreditCard className="h-3.5 w-3.5" />
            Fee &amp; Billing ({invoices.length})
          </button>
          <button
            type="button"
            onClick={() => setSubModule('expensing')}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold whitespace-nowrap transition-colors ${
              subModule === 'expensing'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            <Receipt className="h-3.5 w-3.5" />
            Expensing ({activeExpenses.length})
          </button>
          <button
            type="button"
            onClick={() => setSubModule('etims')}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold whitespace-nowrap transition-colors ${
              subModule === 'etims'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            eTIMS Check ({(workspace.etimsChecks || []).filter((c) => !c.voided).length})
          </button>
          <button
            type="button"
            onClick={() => setSubModule('reconciliation')}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold whitespace-nowrap transition-colors ${
              subModule === 'reconciliation'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
            Bank &amp; M-Pesa ({(workspace.reconciliationLines || []).filter((l) => !l.voided).length})
          </button>
          <button
            type="button"
            onClick={() => setSubModule('payroll')}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold whitespace-nowrap transition-colors ${
              subModule === 'payroll'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            Payroll ({(workspace.payrollEntries || []).filter((p) => !p.voided).length})
          </button>
          <button
            type="button"
            onClick={() => setSubModule('budgets')}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold whitespace-nowrap transition-colors ${
              subModule === 'budgets'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            <PiggyBank className="h-3.5 w-3.5" />
            Budgets
          </button>
          <button
            type="button"
            onClick={() => setSubModule('books')}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold whitespace-nowrap transition-colors ${
              subModule === 'books'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            <BookOpen className="h-3.5 w-3.5" />
            Financial Books
          </button>
          {canViewAudit && (
            <button
              type="button"
              onClick={() => setSubModule('audit')}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold whitespace-nowrap transition-colors ${
                subModule === 'audit'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              <ClipboardList className="h-3.5 w-3.5" />
              Audit Log
            </button>
          )}
        </div>
      </div>

      {/* Executive Treasury & Cashflow Position KPI Strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Collected Fee Revenue</span>
            <ArrowUpRight className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-2 font-mono text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {formatCurrency(treasurySummary.collectedRevenue, tenant.currency)}
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            of {formatCurrency(treasurySummary.totalBilled, tenant.currency)} billed
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Disbursed Expenses</span>
            <ArrowDownRight className="h-4 w-4 text-rose-500" />
          </div>
          <div className="mt-2 font-mono text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {formatCurrency(treasurySummary.paidExpenses, tenant.currency)}
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {activeExpenses.filter((e) => !e.reversed && e.status === 'Paid').length} paid vouchers
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Pending / Approved</span>
            <Receipt className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-2 font-mono text-xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
            {formatCurrency(treasurySummary.committedExpenses, tenant.currency)}
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {activeExpenses.filter((e) => !e.reversed && e.status !== 'Paid').length} awaiting disbursement
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Net Cash Surplus</span>
            <Wallet className="h-4 w-4 text-blue-500" />
          </div>
          <div
            className={`mt-2 font-mono text-xl font-bold tabular-nums ${
              treasurySummary.netCashPosition >= 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {formatCurrency(treasurySummary.netCashPosition, tenant.currency)}
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Fee collections less paid expenses
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Fee Receivables Balance</span>
            <CreditCard className="h-4 w-4 text-slate-400" />
          </div>
          <div className="mt-2 font-mono text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {formatCurrency(treasurySummary.receivables, tenant.currency)}
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Outstanding across student ledger
          </p>
        </div>
      </div>

      {/* Active Sub-Module Content */}
      {subModule === 'fees' && (
        <FeesModule
          workspace={workspace}
          currentRole={currentRole}
          embeddedInHub
          readOnly={readOnly}
          onRefresh={onRefresh}
          onNotify={onNotify}
        />
      )}

      {subModule === 'etims' && (
        <EtimsVerificationPanel
          workspace={workspace}
          canManage={canManageExpenses}
          actorRole={currentRole}
          onRefresh={onRefresh}
          onNotify={onNotify}
        />
      )}

      {subModule === 'reconciliation' && (
        <ReconciliationPanel
          workspace={workspace}
          canManage={canManageExpenses}
          actorRole={currentRole}
          onRefresh={onRefresh}
          onNotify={onNotify}
        />
      )}

      {subModule === 'payroll' && (
        <PayrollDeductionsPanel
          workspace={workspace}
          canManage={canManageExpenses}
          actorRole={currentRole}
          onRefresh={onRefresh}
          onNotify={onNotify}
        />
      )}

      {subModule === 'budgets' && (
        <BudgetTrackingPanel
          workspace={workspace}
          canManage={canManageExpenses}
          canApproveBudgets={canApproveBudgets}
          actorRole={currentRole}
          onRefresh={onRefresh}
          onNotify={onNotify}
        />
      )}

      {subModule === 'books' && (
        <FinancialBooksPanel workspace={workspace} onNotify={onNotify} />
      )}

      {subModule === 'audit' && canViewAudit && (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Read-Only Finance Audit Trail
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Immutable log of payments, voids, reversals, expenses, payroll, budgets, approvals, and M-Pesa config updates.
              </p>
            </div>
            <input
              type="text"
              value={auditSearch}
              onChange={(e) => setAuditSearch(e.target.value)}
              placeholder="Filter actor, action, entity..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-900 sm:w-64 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2.5">Timestamp</th>
                  <th className="px-3 py-2.5">Actor &amp; Role</th>
                  <th className="px-3 py-2.5">Action</th>
                  <th className="px-3 py-2.5">Entity</th>
                  <th className="px-3 py-2.5">Details / Reason</th>
                  <th className="px-3 py-2.5">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {auditLoading ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                      Loading finance audit log...
                    </td>
                  </tr>
                ) : (
                  auditLogs
                    .filter((entry) => {
                      const q = auditSearch.trim().toLowerCase();
                      if (!q) return true;
                      return (
                        entry.who.toLowerCase().includes(q) ||
                        entry.role.toLowerCase().includes(q) ||
                        entry.action.toLowerCase().includes(q) ||
                        entry.entity.toLowerCase().includes(q) ||
                        entry.entityId.toLowerCase().includes(q)
                      );
                    })
                    .map((entry) => (
                      <tr key={entry.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="px-3 py-2 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                          {new Date(entry.timestamp).toLocaleString()}
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {entry.who}
                          </div>
                          <div className="text-[11px] text-slate-500">{entry.role}</div>
                        </td>
                        <td className="px-3 py-2">
                          <span className="inline-block rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                            {entry.action}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-800 dark:text-slate-200">
                            {entry.entity}
                          </div>
                          <div className="font-mono text-[10px] text-slate-400">{entry.entityId}</div>
                        </td>
                        <td className="max-w-xs truncate px-3 py-2 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                          {entry.after ? JSON.stringify(entry.after).slice(0, 110) : '—'}
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px] text-slate-500">
                          {entry.ip || '—'}
                        </td>
                      </tr>
                    ))
                )}
                {!auditLoading && auditLogs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                      No finance audit log entries recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subModule === 'expensing' && (
        <div className="space-y-6">
          {/* Expensing Sub-Module Toolbar */}
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between dark:border-slate-800 dark:bg-slate-900">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                School Expensing &amp; Payment Vouchers
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Record expenditures with attached official receipts or signed vouchers, approve requisitions, and export audit-ready ledgers.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleExportExpensesExcel}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 whitespace-nowrap hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <Download className="h-3.5 w-3.5" />
                Export Excel
              </button>
              <button
                type="button"
                onClick={() => setExpenseModalOpen(true)}
                disabled={!canManageExpenses}
                title={
                  canManageExpenses
                    ? 'Record a new school expense voucher'
                    : 'Switch role to Bursar, Admin, or Super Admin to record expenses'
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white whitespace-nowrap hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                Record Expense Voucher
              </button>
            </div>
          </div>

          {!canManageExpenses && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-xs text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300">
              Viewing in read-only mode as <span className="font-semibold">{currentRole}</span>. Switch role to{' '}
              <span className="font-semibold">Bursar</span>, <span className="font-semibold">Admin</span>, or{' '}
              <span className="font-semibold">Super Admin</span> to create, attach supporting documents, approve, pay, or remove expense vouchers.
            </div>
          )}

          {/* Category Allocation & Filters Grid */}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
            {/* Category Breakdown Panel */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 xl:col-span-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Spend by Category
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Total committed &amp; paid across cost centres
                  </p>
                </div>
                <FileSpreadsheet className="h-4 w-4 text-slate-400" />
              </div>

              {categoryBreakdown.length === 0 ? (
                <div className="mt-6 rounded-lg border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  No expenses recorded yet for this campus.
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  {categoryBreakdown.map((item) => (
                    <div key={item.category} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() =>
                            setCategoryFilter((prev) => (prev === item.category ? 'All' : item.category))
                          }
                          className={`truncate text-left font-medium transition-colors ${
                            categoryFilter === item.category
                              ? 'text-blue-600 dark:text-blue-400'
                              : 'text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                          }`}
                        >
                          {item.category}
                        </button>
                        <span className="shrink-0 font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                          {formatCurrency(item.total, tenant.currency)}
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                        <div
                          className="h-full rounded bg-blue-600 transition-all dark:bg-blue-500"
                          style={{ width: `${Math.max(4, item.sharePct)}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                        <span>
                          {item.count} {item.count === 1 ? 'voucher' : 'vouchers'}
                        </span>
                        <span className="font-mono tabular-nums">{item.sharePct}% share</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Expense Vouchers Ledger */}
            <div className="rounded-xl border border-slate-200 bg-white xl:col-span-8 dark:border-slate-800 dark:bg-slate-900">
              {/* Filter Bar */}
              <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search voucher #, title, vendor, or LPO ref..."
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pr-3 pl-9 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <option value="All">All Categories</option>
                    {EXPENSE_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <option value="All">All Statuses</option>
                    {EXPENSE_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Ledger Table */}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[840px] text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Voucher &amp; Date</th>
                      <th className="px-4 py-3">Description &amp; Category</th>
                      <th className="px-4 py-3">Vendor / Payee</th>
                      <th className="px-4 py-3">Supporting Docs</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Workflow</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {filteredExpenses.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-4 py-10 text-center text-xs text-slate-500 dark:text-slate-400"
                        >
                          No expense vouchers match the selected filters.
                        </td>
                      </tr>
                    ) : (
                      filteredExpenses.map((exp) => {
                        const isBusy = busyExpenseId === exp.id;
                        const docCount = (exp.attachments || []).length;
                        return (
                          <tr
                            key={exp.id}
                            className={`transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40 ${
                              exp.reversed ? 'opacity-65' : ''
                            }`}
                          >
                            <td className="px-4 py-3 align-top">
                              <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                                {exp.voucherNumber}
                              </div>
                              <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                {formatDateShort(exp.expenseDate)}
                              </div>
                            </td>

                            <td className="px-4 py-3 align-top">
                              <div className="font-semibold text-slate-900 dark:text-slate-100">
                                {exp.title}
                              </div>
                              <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                {exp.category}
                                {exp.etimsStatus ? ` · eTIMS: ${exp.etimsStatus}` : ''}
                                {exp.boardApprovalRef ? ` · ${exp.boardApprovalRef}` : ''}
                              </div>
                              {exp.notes && (
                                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                                  {exp.notes}
                                </p>
                              )}
                              {exp.reversed && exp.reversalReason && (
                                <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
                                  Reversed: {exp.reversalReason}
                                </p>
                              )}
                            </td>

                            <td className="px-4 py-3 align-top">
                              <div className="font-medium text-slate-800 dark:text-slate-200">
                                {exp.vendor}
                              </div>
                              <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                {exp.paymentMethod}
                                {exp.reference ? ` · ${exp.reference}` : ''}
                              </div>
                            </td>

                            <td className="px-4 py-3 align-top">
                              <button
                                type="button"
                                onClick={() => {
                                  setDocsModalExpenseId(exp.id);
                                  setPreviewAttachmentId(exp.attachments?.[0]?.id || null);
                                }}
                                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap transition-colors ${
                                  docCount > 0
                                    ? 'border-emerald-200 bg-emerald-50/80 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800/70 dark:bg-emerald-950/30 dark:text-emerald-300'
                                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                }`}
                              >
                                <Paperclip className="h-3 w-3" />
                                {docCount > 0
                                  ? `${docCount} File${docCount === 1 ? '' : 's'}`
                                  : 'Attach Docs'}
                              </button>
                            </td>

                            <td className="px-4 py-3 text-right align-top font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                              {formatCurrency(exp.amount, tenant.currency)}
                            </td>

                            <td className="px-4 py-3 align-top">
                              <span
                                className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${
                                  exp.reversed
                                    ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/70 dark:bg-rose-950/40 dark:text-rose-300'
                                    : getStatusBadgeClass(exp.status)
                                }`}
                              >
                                {exp.reversed ? 'Reversed' : exp.status}
                              </span>
                            </td>

                            <td className="px-4 py-3 text-right align-top">
                              <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                                {!exp.reversed && exp.status === 'Pending Approval' && (
                                  <button
                                    type="button"
                                    disabled={!canManageExpenses || isBusy}
                                    onClick={() => handleStatusTransition(exp, 'Approved')}
                                    className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-800/70 dark:bg-blue-950/40 dark:text-blue-300"
                                  >
                                    Approve
                                  </button>
                                )}
                                {!exp.reversed && exp.status === 'Approved' && (
                                  <button
                                    type="button"
                                    disabled={!canManageExpenses || isBusy}
                                    onClick={() => handleStatusTransition(exp, 'Paid')}
                                    className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-300"
                                  >
                                    <CheckCircle2 className="h-3 w-3" />
                                    Mark Paid
                                  </button>
                                )}

                                {canManageExpenses && !exp.reversed && exp.status === 'Paid' && (
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() => {
                                      setExpenseReasonText('');
                                      setExpenseReasonModal({ mode: 'reverse', expense: exp });
                                    }}
                                    className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50 dark:border-rose-800/70 dark:bg-rose-950/40 dark:text-rose-300"
                                  >
                                    <RotateCcw className="h-3 w-3" />
                                    Reverse
                                  </button>
                                )}

                                {canManageExpenses && !exp.reversed && exp.status !== 'Paid' && (
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() => {
                                      setExpenseReasonText('');
                                      setExpenseReasonModal({ mode: 'void', expense: exp });
                                    }}
                                    title="Void unpaid expense voucher"
                                    className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 dark:border-slate-700 dark:text-slate-400 dark:hover:border-rose-900 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Record Expense Voucher Modal (with Supporting Documents Upload) */}
      {expenseModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4">
          <div className="my-8 w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Record School Expense Voucher
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {tenant.name} · Captured in {tenant.currency} · Attach receipts or signed vouchers for audit
                </p>
              </div>
              <button
                type="button"
                onClick={() => setExpenseModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateExpense} className="space-y-4 p-5">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Expenditure Title / Description *
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Term 1 Kitchen Maize & Beans Supply"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Expense Category *
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {EXPENSE_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Vendor / Payee *
                  </label>
                  <input
                    type="text"
                    required
                    value={vendor}
                    onChange={(e) => setVendor(e.target.value)}
                    placeholder="e.g. Rift Valley Cereals Ltd"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Amount ({tenant.currency}) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={tenant.currency === 'KES' ? '25000' : '450'}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Payment Method
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {PAYMENT_METHODS.map((pm) => (
                      <option key={pm} value={pm}>
                        {pm}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Expense Date
                  </label>
                  <input
                    type="date"
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    LPO / Payment Reference
                  </label>
                  <input
                    type="text"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="e.g. LPO-2025-114 or M-Pesa Ref"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Voucher Workflow Status
                  </label>
                  <div className="rounded-lg border border-blue-200 bg-blue-50/70 px-3 py-2 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
                    Starts as <strong>Pending Approval</strong> (Maker-Checker: requires a different approver).
                  </div>
                </div>
              </div>

              {/* Supporting Documents Section */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-800/40">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Attach Supporting Documents (Receipts, Signed Vouchers, LPOs)
                    </label>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Upload scanned receipts, PDFs, or signed vouchers (max 2.4 MB per file, up to 6 files).
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={newDocType}
                      onChange={(e) => setNewDocType(e.target.value as ExpenseAttachmentType)}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    >
                      {EXPENSE_ATTACHMENT_TYPES.map((dt) => (
                        <option key={dt} value={dt}>
                          {dt}
                        </option>
                      ))}
                    </select>
                    <input
                      ref={createFileInputRef}
                      type="file"
                      multiple
                      accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv"
                      onChange={(e) => handleStageFiles(e.target.files)}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => createFileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 whitespace-nowrap hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Browse Files
                    </button>
                  </div>
                </div>

                {stagedAttachments.length > 0 && (
                  <div className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-900">
                    {stagedAttachments.map((att) => (
                      <div
                        key={att.localId}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <FileText className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-900 dark:text-slate-100">
                              {att.fileName}
                            </p>
                            <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                              {formatFileSize(att.fileSize)}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <select
                            value={att.docType}
                            onChange={(e) => {
                              const nextType = e.target.value as ExpenseAttachmentType;
                              setStagedAttachments((prev) =>
                                prev.map((item) =>
                                  item.localId === att.localId
                                    ? { ...item, docType: nextType }
                                    : item
                                )
                              );
                            }}
                            className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                          >
                            {EXPENSE_ATTACHMENT_TYPES.map((dt) => (
                              <option key={dt} value={dt}>
                                {dt}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() =>
                              setStagedAttachments((prev) =>
                                prev.filter((item) => item.localId !== att.localId)
                              )
                            }
                            className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                            title="Remove attachment"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Notes / Budget Vote Reference
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional justification, delivery note, or departmental vote..."
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setExpenseModalOpen(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {saving ? 'Saving Voucher...' : 'Save Expense Voucher'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Supporting Documents Inspection & Upload Modal */}
      {docsModalExpense && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/55 p-4">
          <div className="my-8 flex w-full max-w-4xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Supporting Documents · {docsModalExpense.voucherNumber}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {docsModalExpense.title} · {docsModalExpense.vendor} ·{' '}
                  {formatCurrency(docsModalExpense.amount, tenant.currency)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDocsModalExpenseId(null);
                  setPreviewAttachmentId(null);
                }}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 divide-y divide-slate-200 lg:grid-cols-12 lg:divide-x lg:divide-y-0 dark:divide-slate-800">
              {/* Left Pane: Attached Files + Upload Control */}
              <div className="flex flex-col justify-between p-5 lg:col-span-5">
                <div>
                  <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide dark:text-slate-300">
                    Attached Documents ({(docsModalExpense.attachments || []).length}/6)
                  </h4>

                  {(docsModalExpense.attachments || []).length === 0 ? (
                    <div className="mt-3 rounded-lg border border-dashed border-slate-300 p-5 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                      No receipts, signed vouchers, or invoices attached yet.
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {(docsModalExpense.attachments || []).map((att) => {
                        const selected = activePreviewAttachment?.id === att.id;
                        return (
                          <div
                            key={att.id}
                            className={`flex items-start justify-between gap-2 rounded-lg border p-2.5 text-xs transition-colors ${
                              selected
                                ? 'border-blue-500 bg-blue-50/70 dark:border-blue-500 dark:bg-blue-950/30'
                                : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => setPreviewAttachmentId(att.id)}
                              className="min-w-0 flex-1 text-left"
                            >
                              <p className="font-semibold text-slate-900 dark:text-slate-100">
                                {att.docType}
                              </p>
                              <p className="truncate text-[11px] text-slate-600 dark:text-slate-300">
                                {att.fileName}
                              </p>
                              <p className="mt-0.5 font-mono text-[10px] text-slate-500 dark:text-slate-400">
                                {formatFileSize(att.fileSize)} · {formatDateShort(att.uploadedAt)}
                              </p>
                            </button>

                            <div className="flex shrink-0 items-center gap-1">
                              <a
                                href={att.dataUrl}
                                download={att.fileName}
                                title="Download document"
                                className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white"
                              >
                                <Download className="h-3.5 w-3.5" />
                              </a>
                              {canManageExpenses &&
                                docsModalExpense.status !== 'Paid' &&
                                !docsModalExpense.reversed && (
                                  <button
                                    type="button"
                                    disabled={uploadingExistingDoc}
                                    onClick={() =>
                                      handleDeleteExistingAttachment(docsModalExpense, att.id)
                                    }
                                    title="Delete document"
                                    className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:hover:bg-rose-950/40"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {canManageExpenses &&
                  (docsModalExpense.status === 'Paid' || docsModalExpense.reversed ? (
                    <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
                      Posted Paid/Reversed vouchers are locked; supporting documents are read-only.
                    </div>
                  ) : (
                    <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
                      <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Attach Additional Receipt or Signed Voucher
                      </label>
                      <div className="flex flex-col gap-2">
                        <select
                          value={existingDocType}
                          onChange={(e) =>
                            setExistingDocType(e.target.value as ExpenseAttachmentType)
                          }
                          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        >
                          {EXPENSE_ATTACHMENT_TYPES.map((dt) => (
                            <option key={dt} value={dt}>
                              {dt}
                            </option>
                          ))}
                        </select>
                        <input
                          ref={existingFileInputRef}
                          type="file"
                          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv"
                          onChange={(e) => handleUploadAttachmentToExisting(e.target.files)}
                          className="hidden"
                        />
                        <button
                          type="button"
                          disabled={
                            uploadingExistingDoc ||
                            (docsModalExpense.attachments || []).length >= 6
                          }
                          onClick={() => existingFileInputRef.current?.click()}
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          <Upload className="h-3.5 w-3.5" />
                          {uploadingExistingDoc ? 'Uploading...' : 'Upload Supporting File'}
                        </button>
                      </div>
                    </div>
                  ))}
              </div>

              {/* Right Pane: Document Viewer */}
              <div className="flex min-h-[360px] flex-col justify-between bg-slate-50/70 p-5 lg:col-span-7 dark:bg-slate-950/40">
                {!activePreviewAttachment ? (
                  <div className="flex flex-1 flex-col items-center justify-center text-center text-xs text-slate-500 dark:text-slate-400">
                    <Paperclip className="mb-2 h-8 w-8 text-slate-300 dark:text-slate-600" />
                    <p className="font-medium text-slate-700 dark:text-slate-300">
                      Select or upload a supporting document to preview
                    </p>
                    <p className="mt-1">
                      Images and PDF vouchers render inline; office spreadsheets download directly.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-1 flex-col">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-slate-900 dark:text-slate-100">
                          {activePreviewAttachment.docType} — {activePreviewAttachment.fileName}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Uploaded by {activePreviewAttachment.uploadedBy} on{' '}
                          {formatDateShort(activePreviewAttachment.uploadedAt)}
                        </p>
                      </div>
                      <a
                        href={activePreviewAttachment.dataUrl}
                        download={activePreviewAttachment.fileName}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download
                      </a>
                    </div>

                    <div className="flex flex-1 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                      {activePreviewAttachment.mimeType.startsWith('image/') ? (
                        <img
                          src={activePreviewAttachment.dataUrl}
                          alt={activePreviewAttachment.fileName}
                          referrerPolicy="no-referrer"
                          className="max-h-[420px] w-auto object-contain p-2"
                        />
                      ) : activePreviewAttachment.mimeType === 'application/pdf' ? (
                        <iframe
                          src={activePreviewAttachment.dataUrl}
                          title={activePreviewAttachment.fileName}
                          className="h-[420px] w-full"
                        />
                      ) : (
                        <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                          <FileText className="mx-auto mb-2 h-9 w-9 text-slate-400" />
                          <p className="font-semibold text-slate-700 dark:text-slate-200">
                            {activePreviewAttachment.fileName}
                          </p>
                          <p className="mt-1">
                            Inline preview is available for images and PDFs. Use Download above to open this file.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {expenseReasonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4">
          <form
            onSubmit={handleConfirmExpenseReason}
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
          >
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              {expenseReasonModal.mode === 'reverse'
                ? 'Reverse Paid Expense Voucher'
                : 'Void Unpaid Expense Voucher'}
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {expenseReasonModal.expense.voucherNumber} · {expenseReasonModal.expense.title} (
              {formatCurrency(expenseReasonModal.expense.amount, tenant.currency)})
            </p>
            <div className="mt-4">
              <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Audit Reason *
              </label>
              <textarea
                rows={3}
                required
                value={expenseReasonText}
                onChange={(e) => setExpenseReasonText(e.target.value)}
                placeholder={
                  expenseReasonModal.mode === 'reverse'
                    ? 'e.g. Supplier refunded payment; reversing voucher in ledger'
                    : 'e.g. Cancelled requisition prior to payment'
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setExpenseReasonModal(null)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busyExpenseId === expenseReasonModal.expense.id}
                className="rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {busyExpenseId === expenseReasonModal.expense.id
                  ? 'Processing...'
                  : expenseReasonModal.mode === 'reverse'
                  ? 'Confirm Reversal'
                  : 'Confirm Void'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
