import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Bell,
  CheckCircle2,
  Copy,
  CreditCard,
  Download,
  FileSpreadsheet,
  MessageCircle,
  Pencil,
  PenLine,
  Phone,
  Plus,
  Printer,
  Receipt,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { saasApi } from '../lib/api';
import { formatCurrency, formatDateShort } from '../lib/format';
import {
  buildFeeReminderWhatsAppMessage,
  buildWhatsAppUrl,
  resolveStudentGuardianContact,
} from '../lib/whatsapp';
import {
  MAX_FEE_VOTELINES,
  type CurrencyCode,
  type FeeInvoice,
  type FeeStructure,
  type FeeVoteline,
  type InvoiceStatus,
  type PaymentMethod,
  type TenantWorkspaceData,
  type UserRole,
} from '../shared/types';

interface FeesModuleProps {
  workspace: TenantWorkspaceData;
  currentRole: UserRole;
  embeddedInHub?: boolean;
  onRefresh: () => Promise<void>;
  onNotify: (title: string, tone?: 'success' | 'error') => void;
}

const PAYMENT_METHODS: PaymentMethod[] = ['Mobile Money', 'Bank Transfer', 'Card', 'Cash'];

const COMMON_VOTELINE_NAMES = [
  'Tuition Fee',
  'Boarding & Meals',
  'Examination & Assessment',
  'Laboratory & Practicals',
  'ICT & Technology',
  'Co-Curricular & Activities',
  'Transport & Bus Levy',
  'Development & PTA Levy',
];

function getStructureVotelines(fs: FeeStructure): FeeVoteline[] {
  if (Array.isArray(fs.votelines) && fs.votelines.length > 0) {
    return fs.votelines;
  }
  return [
    { id: 'vl-tuition', name: 'Tuition Fee', amount: fs.tuitionFee || 0 },
    { id: 'vl-lab', name: 'Laboratory Fee', amount: fs.labFee || 0 },
    { id: 'vl-tech', name: 'Technology & ICT', amount: fs.technologyFee || 0 },
    { id: 'vl-act', name: 'Co-Curricular & Activities', amount: fs.activitiesFee || 0 },
  ];
}

/**
 * Largest-remainder proportional apportionment so allocated integer votelines
 * sum exactly to totalAmount with zero rounding drift.
 */
function allocateProportionally(totalAmount: number, weights: number[]): number[] {
  const safeTotal = Math.max(0, Math.round(totalAmount));
  if (weights.length === 0) return [];
  const cleanWeights = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const weightSum = cleanWeights.reduce((sum, w) => sum + w, 0);

  if (weightSum <= 0) {
    const equalBase = Math.floor(safeTotal / cleanWeights.length);
    const rem = safeTotal - equalBase * cleanWeights.length;
    return cleanWeights.map((_, idx) => equalBase + (idx < rem ? 1 : 0));
  }

  const shares = cleanWeights.map((w, idx) => {
    const exact = (safeTotal * w) / weightSum;
    const base = Math.floor(exact);
    return { idx, base, frac: exact - base };
  });

  const allocatedSum = shares.reduce((sum, item) => sum + item.base, 0);
  let remainder = safeTotal - allocatedSum;

  const sortedByFrac = [...shares].sort((a, b) => b.frac - a.frac || a.idx - b.idx);
  const result = shares.map((s) => s.base);
  for (let i = 0; i < remainder && i < sortedByFrac.length; i += 1) {
    result[sortedByFrac[i].idx] += 1;
  }
  return result;
}

function buildDefaultVotelineDrafts(currency: CurrencyCode): Array<{ id: string; name: string; amount: string }> {
  if (currency === 'KES') {
    return [
      { id: 'vl-1', name: 'Tuition Fee', amount: '35000' },
      { id: 'vl-2', name: 'Boarding & Meals', amount: '6500' },
      { id: 'vl-3', name: 'Examination & Assessment', amount: '2000' },
      { id: 'vl-4', name: 'Laboratory & Practicals', amount: '2500' },
    ];
  }
  return [
    { id: 'vl-1', name: 'Tuition Fee', amount: '1100' },
    { id: 'vl-2', name: 'Laboratory & Practicals', amount: '120' },
    { id: 'vl-3', name: 'ICT & Technology', amount: '90' },
    { id: 'vl-4', name: 'Co-Curricular & Activities', amount: '80' },
  ];
}

interface ParsedPaymentRow {
  rowNumber: number;
  invoiceId?: string;
  invoiceNumber: string;
  studentId?: string;
  studentCode: string;
  studentName: string;
  outstandingBalance: number;
  amount: number;
  method: PaymentMethod;
  reference: string;
  paidAt: string;
  include: boolean;
  status: 'valid' | 'skipped' | 'error';
  note: string;
}

function normalizePaymentMethod(raw: string): PaymentMethod {
  const value = raw.trim().toLowerCase();
  if (!value) return 'Bank Transfer';
  if (
    value.includes('mobile') ||
    value.includes('mpesa') ||
    value.includes('m-pesa') ||
    value.includes('airtel') ||
    value.includes('tkash')
  ) {
    return 'Mobile Money';
  }
  if (value.includes('card') || value.includes('visa') || value.includes('master')) {
    return 'Card';
  }
  if (value.includes('cash')) {
    return 'Cash';
  }
  return 'Bank Transfer';
}

function readRowCell(row: Record<string, unknown>, candidates: string[]): string {
  const keys = Object.keys(row);
  for (const candidate of candidates) {
    const target = candidate.toLowerCase();
    const matchedKey = keys.find((k) => k.trim().toLowerCase() === target);
    if (matchedKey !== undefined && row[matchedKey] !== undefined && row[matchedKey] !== null) {
      return String(row[matchedKey]).trim();
    }
  }
  for (const candidate of candidates) {
    const target = candidate.toLowerCase();
    const matchedKey = keys.find((k) => k.trim().toLowerCase().includes(target));
    if (matchedKey !== undefined && row[matchedKey] !== undefined && row[matchedKey] !== null) {
      return String(row[matchedKey]).trim();
    }
  }
  return '';
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function FeesModule({
  workspace,
  currentRole,
  embeddedInHub = false,
  onRefresh,
  onNotify,
}: FeesModuleProps) {
  const { tenant, students, admissions, invoices, feeStructures } = workspace;
  const whatsappDispatches = workspace.whatsappDispatches || [];
  const canSwitchCurrency = currentRole === 'Admin' || currentRole === 'Super Admin';

  const [activeTab, setActiveTab] = useState<'invoices' | 'payments' | 'structures'>('invoices');
  const [entryMode, setEntryMode] = useState<'manual' | 'excel'>('manual');
  const [statusFilter, setStatusFilter] = useState<'All' | InvoiceStatus>('All');
  const [searchQuery, setSearchQuery] = useState('');

  const [paymentModalInvoice, setPaymentModalInvoice] = useState<FeeInvoice | null>(null);
  const [receiptInvoice, setReceiptInvoice] = useState<FeeInvoice | null>(null);
  const [selectedReceiptPaymentId, setSelectedReceiptPaymentId] = useState<string>('LATEST');
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatingCurrency, setUpdatingCurrency] = useState(false);

  // Fee Balance Reminder modal state
  const [reminderModalOpen, setReminderModalOpen] = useState(false);
  const [reminderInvoiceId, setReminderInvoiceId] = useState<string>('');
  const [reminderFilter, setReminderFilter] = useState<'all' | 'overdue'>('all');
  const [reminderSearch, setReminderSearch] = useState('');
  const [reminderPhoneOverride, setReminderPhoneOverride] = useState('');
  const [reminderCustomNote, setReminderCustomNote] = useState('');

  const openInvoices = useMemo(
    () => invoices.filter((inv) => inv.balance > 0),
    [invoices]
  );

  const feeReminderDispatchesByRef = useMemo(() => {
    const map = new Map<string, { sentAt: string; guardianPhone: string }>();
    for (const rec of whatsappDispatches) {
      if (rec.category === 'Fee Balance Reminder') {
        const key = `${rec.studentId}::${rec.referenceLabel}`;
        if (!map.has(key)) {
          map.set(key, { sentAt: rec.sentAt, guardianPhone: rec.guardianPhone });
        }
      }
    }
    return map;
  }, [whatsappDispatches]);

  function resolveInvoiceGuardian(inv: FeeInvoice) {
    const stu = students.find((s) => s.id === inv.studentId);
    if (stu) return resolveStudentGuardianContact(stu, admissions);
    return resolveStudentGuardianContact(
      { fullName: inv.studentName, guardianName: '', guardianPhone: '' },
      admissions
    );
  }

  function openReminderModalForInvoice(inv?: FeeInvoice) {
    const target = inv || openInvoices[0];
    if (!target) {
      onNotify('All student invoices are currently settled — no fee balances to remind.', 'success');
      return;
    }
    const contact = resolveInvoiceGuardian(target);
    setReminderInvoiceId(target.id);
    setReminderPhoneOverride(contact.guardianPhone);
    setReminderCustomNote('');
    setReminderFilter('all');
    setReminderSearch('');
    setReminderModalOpen(true);
  }

  async function recordFeeReminderDispatch(params: {
    invoice: FeeInvoice;
    guardianName: string;
    guardianPhone: string;
    messagePreview: string;
  }) {
    const { invoice, guardianName, guardianPhone, messagePreview } = params;
    try {
      await saasApi.logWhatsAppDispatch(tenant.id, {
        category: 'Fee Balance Reminder',
        studentId: invoice.studentId,
        studentName: invoice.studentName,
        guardianName,
        guardianPhone,
        referenceLabel: `${invoice.invoiceNumber} (Bal: ${formatCurrency(
          invoice.balance,
          tenant.currency
        )})`,
        messagePreview,
        sentBy: `${currentRole} Desk`,
      });
      await onRefresh();
      onNotify(
        `Fee reminder note for ${invoice.studentName} (${formatCurrency(
          invoice.balance,
          tenant.currency
        )}) sent to ${guardianName}.`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to log fee reminder', 'error');
    }
  }

  async function handleCopyReminderNote(text: string, studentName: string) {
    try {
      await navigator.clipboard.writeText(text);
      onNotify(`Fee balance note for ${studentName} copied to clipboard.`);
    } catch {
      onNotify('Unable to copy automatically. Select the preview text to copy.', 'error');
    }
  }

  const reminderList = useMemo(() => {
    const q = reminderSearch.trim().toLowerCase();
    return openInvoices
      .filter((inv) => {
        if (reminderFilter === 'overdue' && inv.status !== 'Overdue') return false;
        const contact = resolveInvoiceGuardian(inv);
        if (!q) return true;
        return (
          inv.studentName.toLowerCase().includes(q) ||
          inv.studentCode.toLowerCase().includes(q) ||
          inv.invoiceNumber.toLowerCase().includes(q) ||
          contact.guardianName.toLowerCase().includes(q) ||
          contact.guardianPhone.toLowerCase().includes(q)
        );
      })
      .map((inv) => {
        const contact = resolveInvoiceGuardian(inv);
        const dispatchKey = `${inv.studentId}::${inv.invoiceNumber} (Bal: ${formatCurrency(
          inv.balance,
          tenant.currency
        )})`;
        const dispatch = feeReminderDispatchesByRef.get(dispatchKey) || null;
        return { inv, contact, dispatch };
      });
  }, [
    openInvoices,
    reminderFilter,
    reminderSearch,
    students,
    admissions,
    tenant.currency,
    feeReminderDispatchesByRef,
  ]);

  const activeReminderEntry = useMemo(() => {
    const selected =
      openInvoices.find((inv) => inv.id === reminderInvoiceId) || reminderList[0]?.inv || null;
    if (!selected) return null;
    const contact = resolveInvoiceGuardian(selected);
    const effectivePhone = reminderPhoneOverride.trim() || contact.guardianPhone;
    const message = buildFeeReminderWhatsAppMessage({
      tenant,
      invoice: selected,
      guardianName: contact.guardianName,
      customNote: reminderCustomNote,
    });
    const waUrl = buildWhatsAppUrl(effectivePhone, message);
    const dispatchKey = `${selected.studentId}::${selected.invoiceNumber} (Bal: ${formatCurrency(
      selected.balance,
      tenant.currency
    )})`;
    const lastDispatch = feeReminderDispatchesByRef.get(dispatchKey) || null;
    return {
      invoice: selected,
      contact,
      effectivePhone,
      message,
      waUrl,
      lastDispatch,
    };
  }, [
    openInvoices,
    reminderList,
    reminderInvoiceId,
    reminderPhoneOverride,
    reminderCustomNote,
    tenant,
    students,
    admissions,
    feeReminderDispatchesByRef,
  ]);

  // Modal single payment form
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    method: 'Mobile Money' as PaymentMethod,
    reference: '',
    paidAt: todayIsoDate(),
  });

  // Dedicated Record Payments -> Manual Entry state
  const [manualPaymentForm, setManualPaymentForm] = useState({
    invoiceId: openInvoices[0]?.id || '',
    amount: openInvoices[0] ? String(openInvoices[0].balance) : '',
    method: 'Mobile Money' as PaymentMethod,
    reference: '',
    paidAt: todayIsoDate(),
  });

  // Dedicated Record Payments -> Excel Upload state
  const excelInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [parsedExcelRows, setParsedExcelRows] = useState<ParsedPaymentRow[]>([]);
  const [postingBatch, setPostingBatch] = useState(false);

  const [invoiceForm, setInvoiceForm] = useState({
    studentId: students[0]?.id || '',
    term: tenant.currentTerm,
    dueDate: '2026-12-05',
    totalAmount: String(feeStructures[0]?.totalFee || (tenant.currency === 'KES' ? 45000 : 1200)),
  });

  const [structureGrade, setStructureGrade] = useState(
    feeStructures[0]?.grade || tenant.grades[0] || 'Grade 9'
  );
  const [structureTerm, setStructureTerm] = useState(
    feeStructures[0]?.term || tenant.currentTerm
  );
  const [votelineDrafts, setVotelineDrafts] = useState<
    Array<{ id: string; name: string; amount: string }>
  >(() => {
    const initialFs = feeStructures[0];
    if (initialFs) {
      return getStructureVotelines(initialFs).map((v) => ({
        id: v.id,
        name: v.name,
        amount: String(v.amount),
      }));
    }
    return buildDefaultVotelineDrafts(tenant.currency);
  });

  // Sync fee structure editor when switching tenants
  useEffect(() => {
    const firstFs = feeStructures[0];
    if (firstFs) {
      setStructureGrade(firstFs.grade);
      setStructureTerm(firstFs.term);
      setVotelineDrafts(
        getStructureVotelines(firstFs).map((v) => ({
          id: v.id,
          name: v.name,
          amount: String(v.amount),
        }))
      );
    } else {
      setStructureGrade(tenant.grades[0] || 'Grade 9');
      setStructureTerm(tenant.currentTerm);
      setVotelineDrafts(buildDefaultVotelineDrafts(tenant.currency));
    }
  }, [tenant.id]);

  // Keep manual invoice selector synchronized when tenant or open invoices change
  useEffect(() => {
    const selectedStillOpen = openInvoices.find((inv) => inv.id === manualPaymentForm.invoiceId);
    if (!selectedStillOpen) {
      const next = openInvoices[0];
      setManualPaymentForm((prev) => ({
        ...prev,
        invoiceId: next?.id || '',
        amount: next ? String(next.balance) : '',
      }));
    }
  }, [openInvoices, manualPaymentForm.invoiceId]);

  const selectedManualInvoice = useMemo(
    () => openInvoices.find((inv) => inv.id === manualPaymentForm.invoiceId) || null,
    [openInvoices, manualPaymentForm.invoiceId]
  );

  const liveStructureTotal = useMemo(
    () =>
      votelineDrafts.reduce((sum, line) => {
        const val = Number(line.amount);
        return sum + (Number.isFinite(val) && val > 0 ? Math.round(val) : 0);
      }, 0),
    [votelineDrafts]
  );

  // Proportional Official Fee Receipt allocation derived from matching Fee Structure votelines
  const receiptBreakdown = useMemo(() => {
    if (!receiptInvoice) return null;
    const matchedStructure =
      feeStructures.find(
        (fs) => fs.grade === receiptInvoice.grade && fs.term === receiptInvoice.term
      ) || feeStructures.find((fs) => fs.grade === receiptInvoice.grade);

    const votelines: FeeVoteline[] = matchedStructure
      ? getStructureVotelines(matchedStructure)
      : [{ id: 'vl-general', name: 'Tuition & School Fees', amount: receiptInvoice.totalAmount }];

    const weights = votelines.map((v) => Math.max(0, v.amount));
    const weightSum = weights.reduce((a, b) => a + b, 0);

    const latestPayment =
      receiptInvoice.payments.length > 0
        ? receiptInvoice.payments[receiptInvoice.payments.length - 1]
        : null;
    const activePayment =
      selectedReceiptPaymentId === 'ALL'
        ? null
        : selectedReceiptPaymentId === 'LATEST'
        ? latestPayment
        : receiptInvoice.payments.find((p) => p.id === selectedReceiptPaymentId) || latestPayment;

    const receiptTargetAmount = activePayment ? activePayment.amount : receiptInvoice.paidAmount;
    const billedAlloc = allocateProportionally(receiptInvoice.totalAmount, weights);
    const receiptAlloc = allocateProportionally(receiptTargetAmount, weights);
    const paidAlloc = allocateProportionally(receiptInvoice.paidAmount, weights);

    const rows = votelines.map((v, idx) => {
      const sharePct =
        weightSum > 0 ? (weights[idx] / weightSum) * 100 : 100 / Math.max(1, votelines.length);
      const billed = billedAlloc[idx] ?? 0;
      const cumulativePaid = paidAlloc[idx] ?? 0;
      const receiptPaid = receiptAlloc[idx] ?? 0;
      const balance = Math.max(0, billed - cumulativePaid);
      return {
        id: v.id,
        name: v.name,
        sharePct,
        billed,
        receiptPaid,
        cumulativePaid,
        balance,
      };
    });

    return {
      matchedStructure,
      activePayment,
      receiptTargetAmount,
      rows,
    };
  }, [receiptInvoice, feeStructures, selectedReceiptPaymentId]);

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

  const excelBatchSummary = useMemo(() => {
    const validSelected = parsedExcelRows.filter((r) => r.include && r.status === 'valid');
    const errorCount = parsedExcelRows.filter((r) => r.status === 'error').length;
    const skippedCount = parsedExcelRows.filter((r) => r.status === 'skipped').length;
    const totalAmount = validSelected.reduce(
      (sum, r) => sum + Math.min(r.outstandingBalance, r.amount),
      0
    );
    return {
      selectedCount: validSelected.length,
      errorCount,
      skippedCount,
      totalAmount,
    };
  }, [parsedExcelRows]);

  async function handleCurrencySwitch(nextCurrency: CurrencyCode) {
    if (nextCurrency === tenant.currency) return;
    if (!canSwitchCurrency) {
      onNotify('Switch Operator Role to Admin or Super Admin to change school currency.', 'error');
      return;
    }
    setUpdatingCurrency(true);
    try {
      await saasApi.updateTenant(tenant.id, { currency: nextCurrency });
      await onRefresh();
      onNotify(
        `Billing currency updated to ${
          nextCurrency === 'KES' ? 'KES (Kenya Shilling)' : 'USD (US Dollar)'
        }.`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to switch currency', 'error');
    } finally {
      setUpdatingCurrency(false);
    }
  }

  function openPaymentModal(inv: FeeInvoice) {
    setPaymentModalInvoice(inv);
    setPaymentForm({
      amount: String(inv.balance),
      method: 'Mobile Money',
      reference: '',
      paidAt: todayIsoDate(),
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
        paidAt: paymentForm.paidAt,
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

  async function handleManualEntrySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedManualInvoice) {
      onNotify('Select an open student invoice to record payment.', 'error');
      return;
    }
    const amount = Number(manualPaymentForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      onNotify('Enter a positive payment amount.', 'error');
      return;
    }
    setSaving(true);
    try {
      const { invoice } = await saasApi.recordPayment(tenant.id, selectedManualInvoice.id, {
        amount,
        method: manualPaymentForm.method,
        reference: manualPaymentForm.reference,
        recordedBy: `${currentRole} Office`,
        paidAt: manualPaymentForm.paidAt,
      });
      await onRefresh();
      setManualPaymentForm((prev) => ({ ...prev, reference: '' }));
      setReceiptInvoice(invoice);
      onNotify(
        `Recorded ${formatCurrency(
          Math.min(amount, selectedManualInvoice.balance),
          tenant.currency
        )} for ${invoice.studentName}.`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Manual payment failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  function handleDownloadTemplate() {
    const sourceRows =
      openInvoices.length > 0
        ? openInvoices.map((inv) => ({
            'Invoice Number': inv.invoiceNumber,
            'Student Code': inv.studentCode,
            'Student Name': inv.studentName,
            Grade: inv.grade,
            Term: inv.term,
            Currency: tenant.currency,
            'Outstanding Balance': inv.balance,
            'Payment Amount': inv.balance,
            'Payment Method': 'Mobile Money',
            'Transaction Reference': '',
            'Paid Date': todayIsoDate(),
          }))
        : students.slice(0, 5).map((st, idx) => ({
            'Invoice Number': `INV-SAMPLE-${idx + 1}`,
            'Student Code': st.studentCode,
            'Student Name': st.fullName,
            Grade: st.grade,
            Term: tenant.currentTerm,
            Currency: tenant.currency,
            'Outstanding Balance': 0,
            'Payment Amount': '',
            'Payment Method': 'Mobile Money',
            'Transaction Reference': '',
            'Paid Date': todayIsoDate(),
          }));

    const sheet = XLSX.utils.json_to_sheet(sourceRows);
    sheet['!cols'] = [
      { wch: 16 },
      { wch: 14 },
      { wch: 24 },
      { wch: 12 },
      { wch: 10 },
      { wch: 10 },
      { wch: 18 },
      { wch: 16 },
      { wch: 16 },
      { wch: 22 },
      { wch: 14 },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Fee Payments');
    XLSX.writeFile(workbook, `${tenant.slug}-fee-payments-template.xlsx`);
    onNotify('Downloaded Excel fee payment template.');
  }

  async function handleExcelFileUpload(file: File | undefined) {
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        onNotify('The uploaded Excel workbook contains no sheets.', 'error');
        return;
      }

      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        workbook.Sheets[firstSheetName],
        { defval: '' }
      );
      if (rawRows.length === 0) {
        onNotify('No payment rows detected in the first sheet.', 'error');
        return;
      }

      const parsed: ParsedPaymentRow[] = rawRows.map((row, idx) => {
        const rowNumber = idx + 2;
        const invoiceNumber = readRowCell(row, ['Invoice Number', 'Invoice No', 'Invoice']);
        const studentCode = readRowCell(row, ['Student Code', 'Adm No', 'Admission No', 'Code']);
        const studentName = readRowCell(row, ['Student Name', 'Student', 'Full Name', 'Name']);
        const rawAmount = readRowCell(row, [
          'Payment Amount',
          'Amount Paid',
          'Amount',
          'Paid',
          'Payment',
        ]);
        const rawMethod = readRowCell(row, ['Payment Method', 'Method', 'Channel', 'Mode']);
        const reference = readRowCell(row, [
          'Transaction Reference',
          'Reference',
          'Ref',
          'Receipt Ref',
          'M-Pesa Code',
        ]);
        const paidDateRaw = readRowCell(row, ['Paid Date', 'Payment Date', 'Date']);
        const paidAt =
          paidDateRaw && !Number.isNaN(Date.parse(paidDateRaw))
            ? new Date(paidDateRaw).toISOString().slice(0, 10)
            : todayIsoDate();

        // Match invoice in this tenant
        let matched: FeeInvoice | undefined;
        if (invoiceNumber) {
          const targetInv = invoiceNumber.toLowerCase();
          matched = invoices.find((i) => i.invoiceNumber.trim().toLowerCase() === targetInv);
        }
        if (!matched && studentCode) {
          const targetCode = studentCode.toLowerCase();
          matched =
            invoices.find(
              (i) => i.studentCode.trim().toLowerCase() === targetCode && i.balance > 0
            ) || invoices.find((i) => i.studentCode.trim().toLowerCase() === targetCode);
        }
        if (!matched && studentName) {
          const targetName = studentName.toLowerCase();
          matched =
            invoices.find(
              (i) => i.studentName.trim().toLowerCase() === targetName && i.balance > 0
            ) || invoices.find((i) => i.studentName.trim().toLowerCase() === targetName);
        }

        const cleanedAmountStr = rawAmount.replace(/[,\s]/g, '');
        const numericAmount = cleanedAmountStr === '' ? 0 : Number(cleanedAmountStr);
        const method = normalizePaymentMethod(rawMethod);

        if (cleanedAmountStr === '' || numericAmount === 0) {
          return {
            rowNumber,
            invoiceId: matched?.id,
            invoiceNumber: matched?.invoiceNumber || invoiceNumber || '—',
            studentId: matched?.studentId,
            studentCode: matched?.studentCode || studentCode || '—',
            studentName: matched?.studentName || studentName || 'Unknown',
            outstandingBalance: matched?.balance ?? 0,
            amount: 0,
            method,
            reference,
            paidAt,
            include: false,
            status: 'skipped',
            note: 'Blank or zero payment amount — skipped',
          };
        }

        if (!Number.isFinite(numericAmount) || numericAmount < 0) {
          return {
            rowNumber,
            invoiceId: matched?.id,
            invoiceNumber: matched?.invoiceNumber || invoiceNumber || '—',
            studentId: matched?.studentId,
            studentCode: matched?.studentCode || studentCode || '—',
            studentName: matched?.studentName || studentName || 'Unknown',
            outstandingBalance: matched?.balance ?? 0,
            amount: 0,
            method,
            reference,
            paidAt,
            include: false,
            status: 'error',
            note: `Invalid amount "${rawAmount}"`,
          };
        }

        if (!matched) {
          return {
            rowNumber,
            invoiceNumber: invoiceNumber || '—',
            studentCode: studentCode || '—',
            studentName: studentName || 'Unknown',
            outstandingBalance: 0,
            amount: Math.round(numericAmount),
            method,
            reference,
            paidAt,
            include: false,
            status: 'error',
            note: 'No matching invoice or student found in active school',
          };
        }

        if (matched.balance <= 0) {
          return {
            rowNumber,
            invoiceId: matched.id,
            invoiceNumber: matched.invoiceNumber,
            studentId: matched.studentId,
            studentCode: matched.studentCode,
            studentName: matched.studentName,
            outstandingBalance: 0,
            amount: Math.round(numericAmount),
            method,
            reference,
            paidAt,
            include: false,
            status: 'error',
            note: 'Invoice is already fully settled',
          };
        }

        const roundedAmount = Math.round(numericAmount);
        const cappedNote =
          roundedAmount > matched.balance
            ? `Capped to balance (${formatCurrency(matched.balance, tenant.currency)})`
            : 'Ready to post';

        return {
          rowNumber,
          invoiceId: matched.id,
          invoiceNumber: matched.invoiceNumber,
          studentId: matched.studentId,
          studentCode: matched.studentCode,
          studentName: matched.studentName,
          outstandingBalance: matched.balance,
          amount: roundedAmount,
          method,
          reference,
          paidAt,
          include: true,
          status: 'valid',
          note: cappedNote,
        };
      });

      setUploadedFileName(file.name);
      setParsedExcelRows(parsed);
      const validCount = parsed.filter((r) => r.status === 'valid').length;
      onNotify(`Parsed ${parsed.length} rows (${validCount} ready to post).`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Unable to read Excel / CSV spreadsheet',
        'error'
      );
    }
  }

  async function handlePostExcelBatch() {
    const readyRows = parsedExcelRows.filter((r) => r.include && r.status === 'valid' && r.invoiceId);
    if (readyRows.length === 0) {
      onNotify('Select at least one valid payment row to post.', 'error');
      return;
    }

    setPostingBatch(true);
    try {
      const result = await saasApi.recordPaymentsBatch(tenant.id, {
        recordedBy: `${currentRole} Excel Import`,
        entries: readyRows.map((row) => ({
          invoiceId: row.invoiceId,
          invoiceNumber: row.invoiceNumber,
          studentId: row.studentId,
          studentCode: row.studentCode,
          amount: row.amount,
          method: row.method,
          reference: row.reference,
          paidAt: row.paidAt,
        })),
      });
      await onRefresh();
      setParsedExcelRows([]);
      setUploadedFileName('');
      onNotify(
        `Posted ${result.processedCount} payments totaling ${formatCurrency(
          result.totalCollected,
          tenant.currency
        )}.`
      );
      setActiveTab('invoices');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Batch payment post failed', 'error');
    } finally {
      setPostingBatch(false);
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

  function handleLoadStructureIntoEditor(fs: FeeStructure) {
    setStructureGrade(fs.grade);
    setStructureTerm(fs.term);
    setVotelineDrafts(
      getStructureVotelines(fs).map((v) => ({
        id: v.id,
        name: v.name,
        amount: String(v.amount),
      }))
    );
  }

  function handleAddVoteline(suggestedName = '') {
    if (votelineDrafts.length >= MAX_FEE_VOTELINES) {
      onNotify(`Fee structures support up to ${MAX_FEE_VOTELINES} votelines maximum.`, 'error');
      return;
    }
    const nextIdx = votelineDrafts.length + 1;
    setVotelineDrafts((prev) => [
      ...prev,
      {
        id: `vl-${Date.now()}-${nextIdx}`,
        name: suggestedName,
        amount: '0',
      },
    ]);
  }

  function handleRemoveVoteline(index: number) {
    if (votelineDrafts.length <= 1) {
      onNotify('Keep at least 1 voteline in the fee structure.', 'error');
      return;
    }
    setVotelineDrafts((prev) => prev.filter((_, idx) => idx !== index));
  }

  function handleLoadAll8Preset() {
    const presetAmountsKes = ['32000', '6500', '2000', '2500', '2000', '1800', '4500', '2500'];
    const presetAmountsUsd = ['950', '220', '75', '95', '80', '70', '140', '90'];
    const amounts = tenant.currency === 'KES' ? presetAmountsKes : presetAmountsUsd;
    setVotelineDrafts(
      COMMON_VOTELINE_NAMES.slice(0, MAX_FEE_VOTELINES).map((name, idx) => ({
        id: `vl-preset-${idx + 1}`,
        name,
        amount: amounts[idx] || '0',
      }))
    );
  }

  async function handleSaveStructure(e: React.FormEvent) {
    e.preventDefault();
    if (votelineDrafts.length === 0 || votelineDrafts.length > MAX_FEE_VOTELINES) {
      onNotify(`Configure between 1 and ${MAX_FEE_VOTELINES} votelines.`, 'error');
      return;
    }

    const cleaned: Array<{ id: string; name: string; amount: number }> = [];
    for (let i = 0; i < votelineDrafts.length; i += 1) {
      const line = votelineDrafts[i];
      const name = line.name.trim();
      if (!name) {
        onNotify(`Enter a name for Voteline #${i + 1}.`, 'error');
        return;
      }
      const amt = Number(line.amount);
      if (!Number.isFinite(amt) || amt < 0) {
        onNotify(`Voteline "${name}" requires a valid non-negative amount.`, 'error');
        return;
      }
      cleaned.push({ id: line.id, name, amount: Math.round(amt) });
    }

    setSaving(true);
    try {
      await saasApi.upsertFeeStructure(tenant.id, {
        grade: structureGrade,
        term: structureTerm,
        votelines: cleaned,
      });
      await onRefresh();
      onNotify(
        `Saved ${structureGrade} (${structureTerm}) with ${cleaned.length} votelines (${formatCurrency(
          cleaned.reduce((s, v) => s + v.amount, 0),
          tenant.currency
        )}).`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to save fee structure', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        {embeddedInHub ? (
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Fees &amp; Billing Operations
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Student invoices, manual &amp; Excel payment capture, 8-voteline fee structures, and proportional receipts.
            </p>
          </div>
        ) : (
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Fee Management & Billing
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Tuition fee structures, KES / USD billing currency, manual payment entry, Excel sheet batch import, and printable receipts.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {/* Currency Selector (KES / USD) */}
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800">
            <span className="px-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Currency
            </span>
            {(['KES', 'USD'] as const).map((code) => {
              const active = tenant.currency === code;
              return (
                <button
                  key={code}
                  type="button"
                  disabled={updatingCurrency || (!canSwitchCurrency && !active)}
                  onClick={() => handleCurrencySwitch(code)}
                  title={
                    canSwitchCurrency
                      ? `Switch billing currency to ${code}`
                      : 'Switch role to Admin or Super Admin to change billing currency'
                  }
                  className={`rounded-md px-2.5 py-1 font-mono text-xs font-semibold transition-colors disabled:opacity-60 ${
                    active
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'
                  }`}
                >
                  {code === 'KES' ? 'KES (KSh)' : 'USD ($)'}
                </button>
              );
            })}
          </div>

          {/* Primary Module Sub-Tabs */}
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            <button
              type="button"
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
              type="button"
              onClick={() => setActiveTab('payments')}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === 'payments'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <CreditCard className="h-3.5 w-3.5" />
              Record Payments
            </button>
            <button
              type="button"
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
            type="button"
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
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Total Billed ({tenant.currency})
          </p>
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

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-64">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search invoice, student..."
                  className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
              <button
                type="button"
                disabled={openInvoices.length === 0}
                onClick={() => openReminderModalForInvoice()}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/70"
              >
                <Bell className="h-3.5 w-3.5" />
                Send Fee Reminders ({openInvoices.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setEntryMode('excel');
                  setActiveTab('payments');
                }}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                Import Excel Payments
              </button>
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
                                type="button"
                                onClick={() => openPaymentModal(inv)}
                                className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                              >
                                <CreditCard className="h-3.5 w-3.5" />
                                Collect
                              </button>
                            )}
                            {inv.balance > 0 && (
                              <button
                                type="button"
                                onClick={() => openReminderModalForInvoice(inv)}
                                title={`Send fee balance reminder for ${inv.studentName} (${formatCurrency(
                                  inv.balance,
                                  tenant.currency
                                )})`}
                                className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
                              >
                                <MessageCircle className="h-3.5 w-3.5" />
                                {feeReminderDispatchesByRef.has(
                                  `${inv.studentId}::${inv.invoiceNumber} (Bal: ${formatCurrency(
                                    inv.balance,
                                    tenant.currency
                                  )})`
                                )
                                  ? 'Reminded ✓'
                                  : 'Remind'}
                              </button>
                            )}
                            {inv.payments.length > 0 && (
                              <button
                                type="button"
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
      ) : activeTab === 'payments' ? (
        <div className="space-y-5">
          {/* Entry Mode Switcher: Manual Entry vs Excel Upload */}
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-900">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Fee Payment Entry ({tenant.currency})
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Enter individual student fee payments manually or upload a filled Excel/CSV sheet to post multiple payments at once.
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => setEntryMode('manual')}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors ${
                  entryMode === 'manual'
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <PenLine className="h-3.5 w-3.5" />
                Manual Entry
              </button>
              <button
                type="button"
                onClick={() => setEntryMode('excel')}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors ${
                  entryMode === 'excel'
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Upload Excel Sheet
              </button>
            </div>
          </div>

          {entryMode === 'manual' ? (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              <form
                onSubmit={handleManualEntrySubmit}
                className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-7 dark:border-slate-800 dark:bg-slate-900"
              >
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Manual Fee Payment Capture
                </h3>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Post full or partial settlement directly against any student&apos;s open invoice.
                </p>

                {openInvoices.length === 0 ? (
                  <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
                    All issued student invoices in {tenant.name} are currently settled. Issue a new invoice to record additional payments.
                  </div>
                ) : (
                  <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Student & Open Invoice
                      </label>
                      <select
                        value={manualPaymentForm.invoiceId}
                        onChange={(e) => {
                          const nextInv = openInvoices.find((i) => i.id === e.target.value);
                          setManualPaymentForm((prev) => ({
                            ...prev,
                            invoiceId: e.target.value,
                            amount: nextInv ? String(nextInv.balance) : '',
                          }));
                        }}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      >
                        {openInvoices.map((inv) => (
                          <option key={inv.id} value={inv.id}>
                            {inv.studentName} ({inv.studentCode}) · {inv.invoiceNumber} — Bal:{' '}
                            {formatCurrency(inv.balance, tenant.currency)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <div className="flex items-center justify-between">
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                          Payment Amount ({tenant.currency})
                        </label>
                        {selectedManualInvoice && (
                          <div className="flex items-center gap-2 text-[11px]">
                            <button
                              type="button"
                              onClick={() =>
                                setManualPaymentForm((prev) => ({
                                  ...prev,
                                  amount: String(Math.round(selectedManualInvoice.balance * 0.5)),
                                }))
                              }
                              className="font-medium text-slate-500 hover:text-blue-600 dark:text-slate-400"
                            >
                              50%
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setManualPaymentForm((prev) => ({
                                  ...prev,
                                  amount: String(selectedManualInvoice.balance),
                                }))
                              }
                              className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                            >
                              Full Balance
                            </button>
                          </div>
                        )}
                      </div>
                      <input
                        required
                        type="number"
                        min={1}
                        max={selectedManualInvoice?.balance || undefined}
                        value={manualPaymentForm.amount}
                        onChange={(e) =>
                          setManualPaymentForm((prev) => ({ ...prev, amount: e.target.value }))
                        }
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Payment Channel / Method
                      </label>
                      <select
                        value={manualPaymentForm.method}
                        onChange={(e) =>
                          setManualPaymentForm((prev) => ({
                            ...prev,
                            method: e.target.value as PaymentMethod,
                          }))
                        }
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
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
                        Transaction Reference (M-Pesa / Bank Slip)
                      </label>
                      <input
                        type="text"
                        value={manualPaymentForm.reference}
                        onChange={(e) =>
                          setManualPaymentForm((prev) => ({ ...prev, reference: e.target.value }))
                        }
                        placeholder="e.g. MPESA-QJK821P or EFT-4490"
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Payment Date
                      </label>
                      <input
                        type="date"
                        value={manualPaymentForm.paidAt}
                        onChange={(e) =>
                          setManualPaymentForm((prev) => ({ ...prev, paidAt: e.target.value }))
                        }
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      />
                    </div>

                    <div className="sm:col-span-2 pt-2">
                      <button
                        type="submit"
                        disabled={saving || !selectedManualInvoice}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        {saving ? 'Recording Payment...' : 'Record Fee Payment & Generate Receipt'}
                      </button>
                    </div>
                  </div>
                )}
              </form>

              {/* Selected Invoice Summary Card */}
              <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-5 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Selected Account Snapshot
                </h3>
                {selectedManualInvoice ? (
                  <div className="mt-4 space-y-3 text-xs">
                    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-800/40">
                      <p className="font-semibold text-slate-900 dark:text-slate-100">
                        {selectedManualInvoice.studentName}
                      </p>
                      <p className="mt-0.5 font-mono text-slate-500 dark:text-slate-400">
                        {selectedManualInvoice.studentCode} · {selectedManualInvoice.grade} ·{' '}
                        {selectedManualInvoice.invoiceNumber}
                      </p>
                    </div>

                    <div className="space-y-2 border-y border-slate-100 py-3 dark:border-slate-800">
                      <div className="flex justify-between">
                        <span className="text-slate-500 dark:text-slate-400">Total Billed</span>
                        <span className="font-mono font-medium text-slate-900 tabular-nums dark:text-slate-100">
                          {formatCurrency(selectedManualInvoice.totalAmount, tenant.currency)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500 dark:text-slate-400">Already Paid</span>
                        <span className="font-mono font-medium text-emerald-700 tabular-nums dark:text-emerald-400">
                          {formatCurrency(selectedManualInvoice.paidAmount, tenant.currency)}
                        </span>
                      </div>
                      <div className="flex justify-between font-semibold">
                        <span className="text-slate-700 dark:text-slate-200">Remaining Balance</span>
                        <span className="font-mono text-amber-700 tabular-nums dark:text-amber-400">
                          {formatCurrency(selectedManualInvoice.balance, tenant.currency)}
                        </span>
                      </div>
                    </div>

                    <div>
                      <p className="font-medium text-slate-700 dark:text-slate-300">
                        Prior Receipts ({selectedManualInvoice.payments.length})
                      </p>
                      {selectedManualInvoice.payments.length === 0 ? (
                        <p className="mt-1 text-slate-500 dark:text-slate-400">
                          No payments recorded yet on this invoice.
                        </p>
                      ) : (
                        <div className="mt-2 space-y-1.5">
                          {selectedManualInvoice.payments.slice(-3).map((p) => (
                            <div
                              key={p.id}
                              className="flex items-center justify-between rounded border border-slate-100 px-2.5 py-1.5 dark:border-slate-800"
                            >
                              <span className="font-mono text-[11px] text-slate-600 dark:text-slate-400">
                                {p.receiptNumber} · {p.method}
                              </span>
                              <span className="font-mono text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                                {formatCurrency(p.amount, tenant.currency)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
                    Select an open invoice to inspect billing totals and prior receipts.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Upload & Template Controls */}
              <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Bulk Fee Payment Import (Excel / CSV)
                    </h3>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Download the pre-filled payment template ({tenant.currency}), update amounts received and M-Pesa / Bank references, then upload `.xlsx`, `.xls`, or `.csv`.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      onClick={handleDownloadTemplate}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download Excel Template
                    </button>
                    <input
                      ref={excelInputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={(e) => {
                        handleExcelFileUpload(e.target.files?.[0]);
                        e.target.value = '';
                      }}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => excelInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-700"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Upload Filled Sheet
                    </button>
                  </div>
                </div>

                <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50/70 p-4 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-300">
                  Supported columns:{' '}
                  <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
                    Invoice Number, Student Code, Student Name, Payment Amount, Payment Method, Transaction Reference, Paid Date
                  </span>
                  . Rows match automatically by Invoice Number, Student Code, or Student Name.
                </div>
              </div>

              {/* Parsed Excel Preview Table */}
              {parsedExcelRows.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        Preview: {uploadedFileName}
                      </h4>
                      <p className="mt-0.5 text-xs text-slate-500 tabular-nums dark:text-slate-400">
                        {excelBatchSummary.selectedCount} ready · {excelBatchSummary.skippedCount} skipped ·{' '}
                        {excelBatchSummary.errorCount} errors · Batch Total:{' '}
                        <strong className="font-mono text-slate-900 dark:text-slate-100">
                          {formatCurrency(excelBatchSummary.totalAmount, tenant.currency)}
                        </strong>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setParsedExcelRows([]);
                          setUploadedFileName('');
                        }}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        Clear Sheet
                      </button>
                      <button
                        type="button"
                        disabled={postingBatch || excelBatchSummary.selectedCount === 0}
                        onClick={handlePostExcelBatch}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {postingBatch
                          ? 'Posting Payments...'
                          : `Post ${excelBatchSummary.selectedCount} Valid Payments`}
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50/70 font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                        <tr>
                          <th className="px-4 py-2.5">Post</th>
                          <th className="px-4 py-2.5">Row</th>
                          <th className="px-4 py-2.5">Student & Invoice</th>
                          <th className="px-4 py-2.5 text-right">Balance</th>
                          <th className="px-4 py-2.5 text-right">Payment</th>
                          <th className="px-4 py-2.5">Method & Ref</th>
                          <th className="px-4 py-2.5">Date</th>
                          <th className="px-4 py-2.5">Validation</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {parsedExcelRows.map((row) => (
                          <tr key={row.rowNumber} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                            <td className="px-4 py-2.5">
                              <input
                                type="checkbox"
                                checked={row.include}
                                disabled={row.status !== 'valid'}
                                onChange={(e) =>
                                  setParsedExcelRows((prev) =>
                                    prev.map((item) =>
                                      item.rowNumber === row.rowNumber
                                        ? { ...item, include: e.target.checked }
                                        : item
                                    )
                                  )
                                }
                                className="h-3.5 w-3.5 rounded accent-emerald-600"
                              />
                            </td>
                            <td className="px-4 py-2.5 font-mono text-slate-500 dark:text-slate-400">
                              #{row.rowNumber}
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="font-medium text-slate-900 dark:text-slate-100">
                                {row.studentName}
                              </div>
                              <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                                {row.studentCode} · {row.invoiceNumber}
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                              {formatCurrency(row.outstandingBalance, tenant.currency)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                              {formatCurrency(row.amount, tenant.currency)}
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="text-slate-800 dark:text-slate-200">{row.method}</div>
                              <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                                {row.reference || 'Auto receipt ref'}
                              </div>
                            </td>
                            <td className="px-4 py-2.5 font-mono text-slate-600 tabular-nums dark:text-slate-400">
                              {row.paidAt}
                            </td>
                            <td className="px-4 py-2.5">
                              <span
                                className={`font-medium ${
                                  row.status === 'valid'
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : row.status === 'error'
                                    ? 'text-red-700 dark:text-red-400'
                                    : 'text-slate-500 dark:text-slate-400'
                                }`}
                              >
                                {row.note}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Existing Configured Fee Templates */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white lg:col-span-6 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Configured Fee Templates ({tenant.currency})
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Each grade supports up to {MAX_FEE_VOTELINES} custom votelines. Click Edit to customize.
                </p>
              </div>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {feeStructures.length === 0 ? (
                <div className="px-5 py-12 text-center text-xs text-slate-500 dark:text-slate-400">
                  No fee templates configured yet. Use the voteline builder to create one.
                </div>
              ) : (
                feeStructures.map((fs) => {
                  const lines = getStructureVotelines(fs);
                  const isEditingThis = fs.grade === structureGrade && fs.term === structureTerm;
                  return (
                    <div
                      key={fs.id}
                      className={`p-4 transition-colors ${
                        isEditingThis
                          ? 'bg-blue-50/60 dark:bg-blue-950/20'
                          : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/30'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {fs.grade}
                            </span>
                            <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                              {lines.length} / {MAX_FEE_VOTELINES} votelines
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{fs.term}</p>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                              Total Term Fee
                            </span>
                            <span className="font-mono text-sm font-bold text-slate-900 tabular-nums dark:text-slate-100">
                              {formatCurrency(fs.totalFee, tenant.currency)}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleLoadStructureIntoEditor(fs)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                          >
                            <Pencil className="h-3 w-3" />
                            Edit
                          </button>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 border-t border-slate-100 pt-2.5 text-xs sm:grid-cols-2 dark:border-slate-800">
                        {lines.map((line, idx) => (
                          <div
                            key={line.id}
                            className="flex items-center justify-between py-0.5 text-slate-600 dark:text-slate-300"
                          >
                            <span className="truncate pr-2">
                              <span className="mr-1 font-mono text-[11px] text-slate-400">
                                {idx + 1}.
                              </span>
                              {line.name}
                            </span>
                            <span className="shrink-0 font-mono text-slate-900 tabular-nums dark:text-slate-100">
                              {formatCurrency(line.amount, tenant.currency)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Customizable Votelines Builder (Up to 8 Votelines) */}
          <form
            onSubmit={handleSaveStructure}
            className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-6 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Customize Fee Structure Votelines ({tenant.currency})
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Define 1 to {MAX_FEE_VOTELINES} custom voteheads (Tuition, Boarding, Exam, Lab, Transport, etc.).
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-xs font-semibold text-slate-700 tabular-nums dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  {votelineDrafts.length} / {MAX_FEE_VOTELINES} Votelines
                </span>
                <button
                  type="button"
                  onClick={handleLoadAll8Preset}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Copy className="h-3 w-3" />
                  Load 8-Line Preset
                </button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Grade / Class Level
                </label>
                <select
                  value={structureGrade}
                  onChange={(e) => {
                    const nextGrade = e.target.value;
                    setStructureGrade(nextGrade);
                    const match = feeStructures.find(
                      (f) => f.grade === nextGrade && f.term === structureTerm
                    );
                    if (match) handleLoadStructureIntoEditor(match);
                  }}
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
                  Academic Term
                </label>
                <input
                  required
                  type="text"
                  value={structureTerm}
                  onChange={(e) => setStructureTerm(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
            </div>

            {/* Voteline Rows */}
            <div className="mt-5 space-y-2.5">
              <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                <span>Voteline Name</span>
                <span className="pr-9">Amount ({tenant.currency})</span>
              </div>

              {votelineDrafts.map((line, index) => (
                <div key={line.id} className="flex items-center gap-2">
                  <span className="w-5 shrink-0 font-mono text-xs text-slate-400 tabular-nums">
                    {index + 1}.
                  </span>
                  <input
                    required
                    type="text"
                    value={line.name}
                    placeholder={`Voteline #${index + 1} (e.g. Tuition Fee)`}
                    onChange={(e) => {
                      const val = e.target.value;
                      setVotelineDrafts((prev) =>
                        prev.map((item, idx) => (idx === index ? { ...item, name: val } : item))
                      );
                    }}
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                  <input
                    required
                    type="number"
                    min={0}
                    value={line.amount}
                    onChange={(e) => {
                      const val = e.target.value;
                      setVotelineDrafts((prev) =>
                        prev.map((item, idx) => (idx === index ? { ...item, amount: val } : item))
                      );
                    }}
                    className="w-32 shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-right font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    disabled={votelineDrafts.length <= 1}
                    onClick={() => handleRemoveVoteline(index)}
                    aria-label={`Remove voteline ${index + 1}`}
                    className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add Voteline & Quick Suggestions */}
            <div className="mt-4 space-y-2.5 border-t border-slate-100 pt-4 dark:border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={votelineDrafts.length >= MAX_FEE_VOTELINES}
                  onClick={() => handleAddVoteline('')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {votelineDrafts.length >= MAX_FEE_VOTELINES
                    ? `Maximum ${MAX_FEE_VOTELINES} Votelines Reached`
                    : `Add Voteline (${MAX_FEE_VOTELINES - votelineDrafts.length} remaining)`}
                </button>

                <div className="text-right">
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    Computed Total:{' '}
                  </span>
                  <span className="font-mono text-sm font-bold text-slate-900 tabular-nums dark:text-slate-100">
                    {formatCurrency(liveStructureTotal, tenant.currency)}
                  </span>
                </div>
              </div>

              {votelineDrafts.length < MAX_FEE_VOTELINES && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Quick add:
                  </span>
                  {COMMON_VOTELINE_NAMES.filter(
                    (presetName) =>
                      !votelineDrafts.some(
                        (v) => v.name.trim().toLowerCase() === presetName.toLowerCase()
                      )
                  )
                    .slice(0, 5)
                    .map((presetName) => (
                      <button
                        key={presetName}
                        type="button"
                        onClick={() => handleAddVoteline(presetName)}
                        className="rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600 hover:border-blue-400 hover:text-blue-600 dark:border-slate-700 dark:text-slate-300 dark:hover:text-blue-400"
                      >
                        + {presetName}
                      </button>
                    ))}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={saving}
              className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving
                ? 'Saving Fee Structure...'
                : `Save ${votelineDrafts.length}-Voteline Fee Structure`}
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

              <div className="grid grid-cols-2 gap-3">
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
                    Payment Date
                  </label>
                  <input
                    type="date"
                    value={paymentForm.paidAt}
                    onChange={(e) => setPaymentForm({ ...paymentForm, paidAt: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Transaction Reference
                </label>
                <input
                  type="text"
                  value={paymentForm.reference}
                  onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })}
                  placeholder="e.g. MPESA-QJK821P or WIRE-88412"
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

      {/* Printable Official Fee Receipt Modal (Proportional Voteline Allocation + Fee Balance) */}
      {receiptInvoice && receiptBreakdown && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            {/* Official School Receipt Header */}
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
              <div>
                <p className="text-[11px] font-semibold tracking-wide text-blue-600 uppercase dark:text-blue-400">
                  Official Fee Receipt
                </p>
                <h2 className="mt-0.5 text-lg font-bold text-slate-900 dark:text-slate-100">
                  {tenant.name}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {tenant.location} · Invoice{' '}
                  <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
                    {receiptInvoice.invoiceNumber}
                  </span>
                  {receiptBreakdown.activePayment && (
                    <>
                      {' '}
                      · Receipt{' '}
                      <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                        {receiptBreakdown.activePayment.receiptNumber}
                      </span>
                    </>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2 no-print">
                {receiptInvoice.balance > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const targetInv = receiptInvoice;
                      setReceiptInvoice(null);
                      setSelectedReceiptPaymentId('LATEST');
                      openReminderModalForInvoice(targetInv);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-300"
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    Remind Balance
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print Receipt
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setReceiptInvoice(null);
                    setSelectedReceiptPaymentId('LATEST');
                  }}
                  aria-label="Close receipt"
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Student & Payment Metadata */}
            <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 text-xs sm:grid-cols-4 dark:border-slate-800 dark:bg-slate-800/40">
              <div>
                <span className="block text-[11px] text-slate-500 dark:text-slate-400">Student</span>
                <strong className="text-slate-900 dark:text-slate-100">
                  {receiptInvoice.studentName}
                </strong>
                <span className="block font-mono text-[11px] text-slate-500 dark:text-slate-400">
                  {receiptInvoice.studentCode}
                </span>
              </div>
              <div>
                <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                  Grade &amp; Term
                </span>
                <strong className="text-slate-900 dark:text-slate-100">{receiptInvoice.grade}</strong>
                <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                  {receiptInvoice.term}
                </span>
              </div>
              <div>
                <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                  Payment Mode
                </span>
                <strong className="text-slate-900 dark:text-slate-100">
                  {receiptBreakdown.activePayment
                    ? receiptBreakdown.activePayment.method
                    : 'All Receipts Combined'}
                </strong>
                <span className="block font-mono text-[11px] text-slate-500 dark:text-slate-400">
                  {receiptBreakdown.activePayment
                    ? `Ref: ${receiptBreakdown.activePayment.reference}`
                    : `${receiptInvoice.payments.length} payment(s)`}
                </span>
              </div>
              <div>
                <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                  Receipt Date
                </span>
                <strong className="font-mono text-slate-900 dark:text-slate-100">
                  {receiptBreakdown.activePayment
                    ? formatDateShort(receiptBreakdown.activePayment.paidAt)
                    : formatDateShort(receiptInvoice.createdAt)}
                </strong>
                <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                  Currency: {tenant.currency}
                </span>
              </div>
            </div>

            {/* Payment Receipt Selector (when multiple transactions exist) */}
            {receiptInvoice.payments.length > 1 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 no-print">
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Allocation View:
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedReceiptPaymentId('ALL')}
                  className={`rounded border px-2 py-0.5 text-[11px] font-medium ${
                    selectedReceiptPaymentId === 'ALL'
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300'
                  }`}
                >
                  All Payments ({formatCurrency(receiptInvoice.paidAmount, tenant.currency)})
                </button>
                {receiptInvoice.payments.map((p, idx) => {
                  const isLatest = idx === receiptInvoice.payments.length - 1;
                  const active =
                    selectedReceiptPaymentId === p.id ||
                    (selectedReceiptPaymentId === 'LATEST' && isLatest);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedReceiptPaymentId(p.id)}
                      className={`rounded border px-2 py-0.5 font-mono text-[11px] ${
                        active
                          ? 'border-blue-600 bg-blue-600 text-white'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {p.receiptNumber} ({formatCurrency(p.amount, tenant.currency)})
                    </button>
                  );
                })}
              </div>
            )}

            {/* Proportional Fee Structure Votelines Table */}
            <div className="mt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Proportional Fee Structure Allocation ({receiptBreakdown.rows.length} Votelines)
                </h3>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  {receiptBreakdown.matchedStructure
                    ? `Schedule: ${receiptBreakdown.matchedStructure.grade} · ${receiptBreakdown.matchedStructure.term}`
                    : 'Default fee allocation'}
                </span>
              </div>

              <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2">Votehead / Voteline</th>
                      <th className="px-3 py-2 text-right">Share</th>
                      <th className="px-3 py-2 text-right">Billed</th>
                      <th className="px-3 py-2 text-right">
                        {receiptBreakdown.activePayment ? 'This Receipt' : 'Paid'}
                      </th>
                      <th className="px-3 py-2 text-right">Total Paid</th>
                      <th className="px-3 py-2 text-right">Voteline Bal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {receiptBreakdown.rows.map((row, idx) => (
                      <tr key={row.id}>
                        <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">
                          <span className="mr-1.5 font-mono text-[11px] text-slate-400">
                            {idx + 1}.
                          </span>
                          {row.name}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-slate-500 tabular-nums dark:text-slate-400">
                          {row.sharePct.toFixed(1)}%
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-slate-700 tabular-nums dark:text-slate-300">
                          {formatCurrency(row.billed, tenant.currency)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold text-emerald-700 tabular-nums dark:text-emerald-400">
                          {formatCurrency(row.receiptPaid, tenant.currency)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-slate-700 tabular-nums dark:text-slate-300">
                          {formatCurrency(row.cumulativePaid, tenant.currency)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-medium text-slate-900 tabular-nums dark:text-slate-100">
                          {formatCurrency(row.balance, tenant.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-slate-200 bg-slate-50/80 font-semibold dark:border-slate-800 dark:bg-slate-800/50">
                    <tr>
                      <td className="px-3 py-2.5 text-slate-900 dark:text-slate-100">Totals</td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-500 tabular-nums dark:text-slate-400">
                        100.0%
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-900 tabular-nums dark:text-slate-100">
                        {formatCurrency(receiptInvoice.totalAmount, tenant.currency)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-emerald-700 tabular-nums dark:text-emerald-400">
                        {formatCurrency(receiptBreakdown.receiptTargetAmount, tenant.currency)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-900 tabular-nums dark:text-slate-100">
                        {formatCurrency(receiptInvoice.paidAmount, tenant.currency)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-amber-700 tabular-nums dark:text-amber-400">
                        {formatCurrency(receiptInvoice.balance, tenant.currency)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Transaction History */}
            <div className="mt-4">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Recorded Payment Transactions ({receiptInvoice.payments.length})
              </p>
              <div className="mt-1.5 divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                {receiptInvoice.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between px-3 py-2 text-xs">
                    <div>
                      <p className="font-mono font-medium text-slate-900 dark:text-slate-100">
                        {p.receiptNumber} · {p.method}
                      </p>
                      <p className="text-slate-500 dark:text-slate-400">
                        Ref: {p.reference} · {formatDateShort(p.paidAt)} · {p.recordedBy}
                      </p>
                    </div>
                    <span className="font-mono font-semibold text-emerald-700 tabular-nums dark:text-emerald-400">
                      {formatCurrency(p.amount, tenant.currency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Prominent Overall Fee Balance Summary */}
            <div className="mt-4 grid grid-cols-3 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-800/70">
              <div>
                <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                  Total Invoice Billed
                </span>
                <span className="font-mono text-sm font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                  {formatCurrency(receiptInvoice.totalAmount, tenant.currency)}
                </span>
              </div>
              <div>
                <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                  Total Fee Paid
                </span>
                <span className="font-mono text-sm font-semibold text-emerald-700 tabular-nums dark:text-emerald-400">
                  {formatCurrency(receiptInvoice.paidAmount, tenant.currency)}
                </span>
              </div>
              <div className="text-right">
                <span className="block text-[11px] font-medium text-slate-600 dark:text-slate-300">
                  Fee Balance
                </span>
                <span
                  className={`font-mono text-base font-bold tabular-nums ${
                    receiptInvoice.balance === 0
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-amber-700 dark:text-amber-400'
                  }`}
                >
                  {receiptInvoice.balance === 0
                    ? `Settled (${formatCurrency(0, tenant.currency)})`
                    : formatCurrency(receiptInvoice.balance, tenant.currency)}
                </span>
              </div>
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
                  onChange={(e) => {
                    const nextStudentId = e.target.value;
                    const stu = students.find((s) => s.id === nextStudentId);
                    const matchedStructure = stu
                      ? feeStructures.find((fs) => fs.grade === stu.grade)
                      : undefined;
                    setInvoiceForm((prev) => ({
                      ...prev,
                      studentId: nextStudentId,
                      totalAmount: matchedStructure
                        ? String(matchedStructure.totalFee)
                        : prev.totalAmount,
                    }));
                  }}
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

      {/* Fee Balance Reminder Center Modal (Student Name & Fee Balance Note via WhatsApp) */}
      {reminderModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4">
          <div className="my-6 w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-slate-100">
                  <Bell className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  Fee Balance Reminders — Send Note to Complete Balances
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Send a personalized WhatsApp reminder note stating the <strong className="text-slate-700 dark:text-slate-200">Student Name</strong> and <strong className="text-slate-700 dark:text-slate-200">Fee Balance</strong> to the guardian phone number recorded during admissions.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReminderModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 divide-y divide-slate-200 lg:grid-cols-12 lg:divide-x lg:divide-y-0 dark:divide-slate-800">
              {/* Left Pane: Outstanding Accounts List */}
              <div className="flex max-h-[560px] flex-col lg:col-span-6">
                <div className="space-y-2.5 border-b border-slate-200 p-3.5 dark:border-slate-800">
                  <div className="flex items-center justify-between gap-2">
                    <div className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
                      <button
                        type="button"
                        onClick={() => setReminderFilter('all')}
                        className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                          reminderFilter === 'all'
                            ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                            : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        All Open ({openInvoices.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setReminderFilter('overdue')}
                        className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                          reminderFilter === 'overdue'
                            ? 'bg-white text-rose-700 shadow-xs dark:bg-slate-700 dark:text-rose-400'
                            : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        Overdue ({openInvoices.filter((i) => i.status === 'Overdue').length})
                      </button>
                    </div>
                    <span className="font-mono text-[11px] font-semibold text-amber-700 tabular-nums dark:text-amber-400">
                      Due: {formatCurrency(metrics.totalOutstanding, tenant.currency)}
                    </span>
                  </div>

                  <div className="relative">
                    <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={reminderSearch}
                      onChange={(e) => setReminderSearch(e.target.value)}
                      placeholder="Search student, invoice #, guardian, or phone..."
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pr-3 pl-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                </div>

                <div className="flex-1 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
                  {reminderList.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                      No open fee accounts match the selected filter.
                    </div>
                  ) : (
                    reminderList.map(({ inv, contact, dispatch }) => {
                      const isSelected = activeReminderEntry?.invoice.id === inv.id;
                      const quickMsg = buildFeeReminderWhatsAppMessage({
                        tenant,
                        invoice: inv,
                        guardianName: contact.guardianName,
                      });
                      const quickUrl = buildWhatsAppUrl(contact.guardianPhone, quickMsg);
                      return (
                        <div
                          key={inv.id}
                          onClick={() => {
                            setReminderInvoiceId(inv.id);
                            setReminderPhoneOverride(contact.guardianPhone);
                            setReminderCustomNote('');
                          }}
                          className={`flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-xs transition-colors ${
                            isSelected
                              ? 'bg-emerald-50/70 dark:bg-emerald-950/25'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-900 dark:text-slate-100">
                                {inv.studentName}
                              </span>
                              <span
                                className={`text-[10px] font-semibold ${
                                  inv.status === 'Overdue'
                                    ? 'text-rose-600 dark:text-rose-400'
                                    : 'text-amber-700 dark:text-amber-400'
                                }`}
                              >
                                {inv.status}
                              </span>
                            </div>
                            <p className="mt-0.5 truncate text-[11px] text-slate-600 dark:text-slate-400">
                              {contact.guardianName} ·{' '}
                              <span className="font-mono">
                                {contact.guardianPhone || 'No admissions phone'}
                              </span>
                            </p>
                            <p className="mt-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                              {inv.invoiceNumber} · Bal:{' '}
                              <strong className="text-slate-900 dark:text-slate-100">
                                {formatCurrency(inv.balance, tenant.currency)}
                              </strong>
                            </p>
                          </div>

                          <div className="flex shrink-0 items-center gap-2">
                            {dispatch && (
                              <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-300">
                                Sent {formatDateShort(dispatch.sentAt)}
                              </span>
                            )}
                            {quickUrl ? (
                              <a
                                href={quickUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void recordFeeReminderDispatch({
                                    invoice: inv,
                                    guardianName: contact.guardianName,
                                    guardianPhone: contact.guardianPhone,
                                    messagePreview: quickMsg,
                                  });
                                }}
                                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-semibold text-white whitespace-nowrap hover:bg-emerald-700"
                              >
                                <MessageCircle className="h-3 w-3" />
                                Send
                              </a>
                            ) : (
                              <span className="text-[11px] text-amber-600 dark:text-amber-400">
                                No Phone
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Right Pane: Fee Balance Reminder Note Composer & Preview */}
              <div className="flex flex-col justify-between bg-slate-50/70 p-5 lg:col-span-6 dark:bg-slate-950/40">
                {activeReminderEntry ? (
                  <div className="flex h-full flex-col justify-between gap-4">
                    <div className="space-y-3.5">
                      {/* Explicit Student Name & Fee Balance Summary Strip */}
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 dark:border-amber-900/60 dark:bg-amber-950/30">
                        <div>
                          <span className="block text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                            Student Name
                          </span>
                          <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                            {activeReminderEntry.invoice.studentName}
                          </span>
                          <span className="ml-2 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                            {activeReminderEntry.invoice.studentCode} ·{' '}
                            {activeReminderEntry.invoice.grade}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="block text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                            Fee Balance
                          </span>
                          <span className="font-mono text-base font-bold text-amber-800 tabular-nums dark:text-amber-300">
                            {formatCurrency(activeReminderEntry.invoice.balance, tenant.currency)}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                            <Phone className="h-3 w-3" />
                            Guardian Phone ({activeReminderEntry.contact.guardianName})
                          </label>
                          <input
                            type="text"
                            value={reminderPhoneOverride}
                            onChange={(e) => setReminderPhoneOverride(e.target.value)}
                            placeholder="+254 712 345 678"
                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                            Deadline / Payment Note (Optional)
                          </label>
                          <input
                            type="text"
                            value={reminderCustomNote}
                            onChange={(e) => setReminderCustomNote(e.target.value)}
                            placeholder="e.g. Kindly clear before end-of-term exams via Paybill 522522."
                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                          />
                        </div>
                      </div>

                      <div>
                        <div className="mb-1 flex items-center justify-between text-[11px]">
                          <span className="font-semibold text-slate-700 dark:text-slate-300">
                            Reminder Note Preview (includes Student Name &amp; Fee Balance)
                          </span>
                          {activeReminderEntry.lastDispatch && (
                            <span className="text-emerald-700 dark:text-emerald-400">
                              Last sent {formatDateShort(activeReminderEntry.lastDispatch.sentAt)}
                            </span>
                          )}
                        </div>
                        <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-white p-3.5 font-sans text-[11px] leading-relaxed text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                          {activeReminderEntry.message}
                        </pre>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() =>
                          handleCopyReminderNote(
                            activeReminderEntry.message,
                            activeReminderEntry.invoice.studentName
                          )
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Copy Reminder Note
                      </button>

                      {activeReminderEntry.waUrl ? (
                        <a
                          href={activeReminderEntry.waUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => {
                            void recordFeeReminderDispatch({
                              invoice: activeReminderEntry.invoice,
                              guardianName: activeReminderEntry.contact.guardianName,
                              guardianPhone: activeReminderEntry.effectivePhone,
                              messagePreview: activeReminderEntry.message,
                            });
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                          Send Fee Reminder via WhatsApp
                        </a>
                      ) : (
                        <span className="text-xs font-medium text-rose-600 dark:text-rose-400">
                          Enter a valid guardian phone number above
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Select a student invoice on the left to compose a fee balance reminder note.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
