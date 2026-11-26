import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Bell,
  CheckCircle2,
  Copy,
  CreditCard,
  Download,
  FileSpreadsheet,
  Gift,
  Lock,
  MessageCircle,
  Pencil,
  PenLine,
  Percent,
  Phone,
  Plus,
  Printer,
  Receipt,
  RotateCcw,
  Search,
  Share2,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { TenantDocumentHeader } from './TenantDocumentHeader';
import {
  createBrandedAoaWorksheet,
  createBrandedWorksheetFromObjects,
  parseExcelSheetRowsSmart,
  resolveTenantDocumentMeta,
} from '../lib/documentBranding';
import { PrintableFeeStructureModal } from './fees/PrintableFeeStructureModal';
import { FeeAdjustmentsModals } from './fees/FeeAdjustmentsModals';
import {
  COMMON_VOTELINE_NAMES,
  PAYMENT_METHODS,
  allocateProportionally,
  buildDefaultVotelineDrafts,
  getStructureVotelines,
  normalizePaymentMethod,
  readRowCell,
  summarizeIndependentVotelinesForStructure,
  todayIsoDate,
  type ParsedPaymentRow,
} from '../lib/feesHelpers';
import { saasApi } from '../lib/api';
import {
  downloadFeeStructurePdf,
  downloadOfficialFeeReceiptPdf,
} from '../lib/pdfDocuments';
import { formatCurrency, formatDateShort } from '../lib/format';
import {
  buildFeeReminderWhatsAppMessage,
  buildWhatsAppUrl,
  resolveStudentGuardianContact,
} from '../lib/whatsapp';
import type { SystemNavigationTarget } from '../lib/globalSearch';
import {
  getStreamsForGrade,
  INDEPENDENT_VOTELINE_PRESETS,
  MAX_FEE_VOTELINES,
  type CurrencyCode,
  type FeeInvoice,
  type FeeStructure,
  type FeeVoteline,
  type FeeWaiverKind,
  type FeeWaiverMode,
  type IndependentVotelineItem,
  type InvoiceStatus,
  type PaymentMethod,
  type PaymentRecord,
  type Student,
  type TenantWorkspaceData,
  type UserRole,
} from '../shared/types';

interface FeesModuleProps {
  workspace: TenantWorkspaceData;
  currentRole: UserRole;
  embeddedInHub?: boolean;
  readOnly?: boolean;
  navigationTarget?: SystemNavigationTarget | null;
  onRefresh: () => Promise<void>;
  onNotify: (title: string, tone?: 'success' | 'error') => void;
}

export function FeesModule({
  workspace,
  currentRole,
  embeddedInHub = false,
  readOnly = false,
  navigationTarget,
  onRefresh,
  onNotify,
}: FeesModuleProps) {
  const { tenant, students, admissions, invoices, feeStructures } = workspace;
  const independentVotelines = useMemo(
    () => (workspace.independentVotelines || []).filter((v) => !v.voided),
    [workspace.independentVotelines]
  );
  const whatsappDispatches = workspace.whatsappDispatches || [];
  const canManageFees =
    !readOnly &&
    (currentRole === 'Admin' ||
      currentRole === 'Bursar' ||
      currentRole === 'Super Admin' ||
      currentRole === 'Developer');
  const canSwitchCurrency = !readOnly && (currentRole === 'Admin' || currentRole === 'Super Admin');
  const currentTermEntity = useMemo(() => {
    const terms = workspace.academicTerms || [];
    return (
      terms.find((t) => t.name.toLowerCase() === tenant.currentTerm.toLowerCase()) ||
      terms.find((t) => t.isCurrent) ||
      null
    );
  }, [workspace.academicTerms, tenant.currentTerm]);
  const isCurrentTermClosed = currentTermEntity?.status === 'Closed';

  const [activeTab, setActiveTab] = useState<'invoices' | 'payments' | 'structures' | 'independent'>(
    'invoices'
  );
  const [entryMode, setEntryMode] = useState<'manual' | 'excel'>('manual');
  const [statusFilter, setStatusFilter] = useState<'All' | InvoiceStatus>('All');
  const [invoiceGradeFilter, setInvoiceGradeFilter] = useState<string>('All');
  const [invoiceStreamFilter, setInvoiceStreamFilter] = useState<string>('All');
  const [manualGradeFilter, setManualGradeFilter] = useState<string>('All');
  const [manualStreamFilter, setManualStreamFilter] = useState<string>('All');
  const [issueGradeFilter, setIssueGradeFilter] = useState<string>('All');
  const [issueStreamFilter, setIssueStreamFilter] = useState<string>('All');
  const [ivlFormGradeFilter, setIvlFormGradeFilter] = useState<string>('All');
  const [ivlFormStreamFilter, setIvlFormStreamFilter] = useState<string>('All');
  const [ivlGradeFilter, setIvlGradeFilter] = useState<string>('All');
  const [ivlStreamFilter, setIvlStreamFilter] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [invoicePage, setInvoicePage] = useState(1);

  useEffect(() => {
    if (!navigationTarget || navigationTarget.module !== 'fees') return;
    if (navigationTarget.subTab && navigationTarget.subTab !== 'fees') return;
    const sec = navigationTarget.subSection;
    if (sec === 'invoices' || sec === 'payments' || sec === 'structures' || sec === 'independent') {
      setActiveTab(sec);
    }
    if (navigationTarget.searchQuery !== undefined) {
      setSearchQuery(navigationTarget.searchQuery);
      setStatusFilter('All');
      setInvoiceGradeFilter('All');
      setInvoiceStreamFilter('All');
      setInvoicePage(1);
    }
    if (navigationTarget.action === 'open-receipt' && navigationTarget.entityId) {
      const inv = invoices.find((i) => i.id === navigationTarget.entityId);
      if (inv) {
        setReceiptInvoice(inv);
        setSelectedReceiptPaymentId('LATEST');
      }
    }
  }, [navigationTarget, invoices]);

  const [paymentModalInvoice, setPaymentModalInvoice] = useState<FeeInvoice | null>(null);
  const [receiptInvoice, setReceiptInvoice] = useState<FeeInvoice | null>(null);
  const [selectedReceiptPaymentId, setSelectedReceiptPaymentId] = useState<string>('LATEST');
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatingCurrency, setUpdatingCurrency] = useState(false);
  const [lastSavedStructureKey, setLastSavedStructureKey] = useState<string | null>(null);
  const [shareStructureModal, setShareStructureModal] = useState<FeeStructure | null>(null);
  const [copiedStructureId, setCopiedStructureId] = useState<string | null>(null);

  // Phase 2 Fee Adjustments, Voiding, Waivers, Sibling Discount & Carry-Forward
  const [voidPaymentTarget, setVoidPaymentTarget] = useState<{
    invoice: FeeInvoice;
    payment: PaymentRecord;
  } | null>(null);
  const [voidPaymentReason, setVoidPaymentReason] = useState('');
  const [creditNoteModalInvoice, setCreditNoteModalInvoice] = useState<FeeInvoice | null>(null);
  const [creditNoteAmount, setCreditNoteAmount] = useState('');
  const [creditNoteReason, setCreditNoteReason] = useState('');
  const [waiverModalOpen, setWaiverModalOpen] = useState(false);
  const [waiverForm, setWaiverForm] = useState<{
    studentId: string;
    invoiceId: string;
    term: string;
    kind: FeeWaiverKind;
    mode: FeeWaiverMode;
    value: string;
    reason: string;
  }>({
    studentId: students[0]?.id || '',
    invoiceId: '',
    term: tenant.currentTerm,
    kind: 'Bursary',
    mode: 'Percentage',
    value: '25',
    reason: '',
  });
  const [siblingModalOpen, setSiblingModalOpen] = useState(false);
  const [siblingForm, setSiblingForm] = useState({
    enabled: Boolean(tenant.siblingDiscountConfig?.enabled),
    percentage: String(tenant.siblingDiscountConfig?.percentage ?? 10),
    minSiblings: String(tenant.siblingDiscountConfig?.minSiblings ?? 2),
  });
  const [carryForwardModalOpen, setCarryForwardModalOpen] = useState(false);
  const [carryForwardForm, setCarryForwardForm] = useState({
    fromTerm: tenant.currentTerm,
    toTerm: tenant.currentTerm === 'Term 1' ? 'Term 2' : tenant.currentTerm === 'Term 2' ? 'Term 3' : 'Term 1',
    dueDate: '2027-01-15',
  });
  const [ivlVoidTarget, setIvlVoidTarget] = useState<IndependentVotelineItem | null>(null);
  const [ivlVoidReason, setIvlVoidReason] = useState('');

  // Independent Votelines (alongside fee, never alters Fee Structure or Invoice Totals)
  const [ivlName, setIvlName] = useState('Transport Fee');
  const [ivlAmount, setIvlAmount] = useState(tenant.currency === 'KES' ? '8500' : '150');
  const [ivlTerm, setIvlTerm] = useState(tenant.currentTerm);
  const [ivlScope, setIvlScope] = useState<'student' | 'grade' | 'all'>('student');
  const [ivlStudentId, setIvlStudentId] = useState(students[0]?.id || '');
  const [ivlGrade, setIvlGrade] = useState(tenant.grades[0] || '');
  const [ivlNote, setIvlNote] = useState('');
  const [ivlSearch, setIvlSearch] = useState('');
  const [ivlStatusFilter, setIvlStatusFilter] = useState<'All' | InvoiceStatus>('All');
  const [ivlPayModalItem, setIvlPayModalItem] = useState<IndependentVotelineItem | null>(null);
  const [ivlPayForm, setIvlPayForm] = useState({
    amount: '',
    method: 'Mobile Money' as PaymentMethod,
    reference: '',
    paidAt: todayIsoDate(),
  });

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
    setIvlTerm(tenant.currentTerm);
    setIvlStudentId(students[0]?.id || '');
    setIvlGrade(tenant.grades[0] || '');
    setIvlAmount(tenant.currency === 'KES' ? '8500' : '150');
  }, [tenant.id]);

  const studentById = useMemo(() => {
    const map = new Map<string, Student>();
    students.forEach((s) => map.set(s.id, s));
    return map;
  }, [students]);

  const gradeFilterOptions = useMemo(() => {
    const present = new Set<string>();
    students.forEach((s) => {
      if (s.grade) present.add(s.grade);
    });
    invoices.forEach((inv) => {
      if (inv.grade) present.add(inv.grade);
    });
    const ordered = tenant.grades.filter((g) => present.has(g));
    present.forEach((g) => {
      if (!ordered.includes(g)) ordered.push(g);
    });
    return ordered.length > 0 ? ordered : tenant.grades;
  }, [students, invoices, tenant.grades]);

  function resolveStreamsForGradeFilter(selectedGrade: string): string[] {
    const configured =
      selectedGrade === 'All'
        ? gradeFilterOptions.flatMap((g) => getStreamsForGrade(tenant, g))
        : getStreamsForGrade(tenant, selectedGrade);
    const set = new Set<string>(configured);
    students.forEach((s) => {
      if ((selectedGrade === 'All' || s.grade === selectedGrade) && s.section) {
        set.add(s.section);
      }
    });
    return Array.from(set);
  }

  const invoiceStreamOptions = useMemo(
    () => resolveStreamsForGradeFilter(invoiceGradeFilter),
    [invoiceGradeFilter, gradeFilterOptions, students, tenant]
  );
  const manualStreamOptions = useMemo(
    () => resolveStreamsForGradeFilter(manualGradeFilter),
    [manualGradeFilter, gradeFilterOptions, students, tenant]
  );
  const issueStreamOptions = useMemo(
    () => resolveStreamsForGradeFilter(issueGradeFilter),
    [issueGradeFilter, gradeFilterOptions, students, tenant]
  );
  const ivlFormStreamOptions = useMemo(
    () => resolveStreamsForGradeFilter(ivlFormGradeFilter),
    [ivlFormGradeFilter, gradeFilterOptions, students, tenant]
  );
  const ivlLedgerStreamOptions = useMemo(
    () => resolveStreamsForGradeFilter(ivlGradeFilter),
    [ivlGradeFilter, gradeFilterOptions, students, tenant]
  );

  useEffect(() => {
    if (invoiceStreamFilter !== 'All' && !invoiceStreamOptions.includes(invoiceStreamFilter)) {
      setInvoiceStreamFilter('All');
    }
  }, [invoiceStreamFilter, invoiceStreamOptions]);

  useEffect(() => {
    if (manualStreamFilter !== 'All' && !manualStreamOptions.includes(manualStreamFilter)) {
      setManualStreamFilter('All');
    }
  }, [manualStreamFilter, manualStreamOptions]);

  useEffect(() => {
    if (issueStreamFilter !== 'All' && !issueStreamOptions.includes(issueStreamFilter)) {
      setIssueStreamFilter('All');
    }
  }, [issueStreamFilter, issueStreamOptions]);

  useEffect(() => {
    if (ivlFormStreamFilter !== 'All' && !ivlFormStreamOptions.includes(ivlFormStreamFilter)) {
      setIvlFormStreamFilter('All');
    }
  }, [ivlFormStreamFilter, ivlFormStreamOptions]);

  useEffect(() => {
    if (ivlStreamFilter !== 'All' && !ivlLedgerStreamOptions.includes(ivlStreamFilter)) {
      setIvlStreamFilter('All');
    }
  }, [ivlStreamFilter, ivlLedgerStreamOptions]);

  const filteredManualOpenInvoices = useMemo(() => {
    return openInvoices.filter((inv) => {
      const stu = studentById.get(inv.studentId);
      const effectiveGrade = inv.grade || stu?.grade || '';
      const effectiveStream = stu?.section || '';
      if (manualGradeFilter !== 'All' && effectiveGrade !== manualGradeFilter) return false;
      if (manualStreamFilter !== 'All' && effectiveStream !== manualStreamFilter) return false;
      return true;
    });
  }, [openInvoices, studentById, manualGradeFilter, manualStreamFilter]);

  const filteredIssueStudents = useMemo(() => {
    return students.filter((s) => {
      if (issueGradeFilter !== 'All' && s.grade !== issueGradeFilter) return false;
      if (issueStreamFilter !== 'All' && s.section !== issueStreamFilter) return false;
      return true;
    });
  }, [students, issueGradeFilter, issueStreamFilter]);

  const filteredIvlFormStudents = useMemo(() => {
    return students.filter((s) => {
      if (ivlFormGradeFilter !== 'All' && s.grade !== ivlFormGradeFilter) return false;
      if (ivlFormStreamFilter !== 'All' && s.section !== ivlFormStreamFilter) return false;
      return true;
    });
  }, [students, ivlFormGradeFilter, ivlFormStreamFilter]);

  // Keep manual invoice selector synchronized when tenant, filter, or open invoices change
  useEffect(() => {
    const selectedStillVisible = filteredManualOpenInvoices.find(
      (inv) => inv.id === manualPaymentForm.invoiceId
    );
    if (!selectedStillVisible) {
      const next = filteredManualOpenInvoices[0];
      setManualPaymentForm((prev) => ({
        ...prev,
        invoiceId: next?.id || '',
        amount: next ? String(next.balance) : '',
      }));
    }
  }, [filteredManualOpenInvoices, manualPaymentForm.invoiceId]);

  useEffect(() => {
    if (!showInvoiceModal) return;
    if (
      filteredIssueStudents.length > 0 &&
      !filteredIssueStudents.some((s) => s.id === invoiceForm.studentId)
    ) {
      const nextStu = filteredIssueStudents[0];
      const matchedStructure = feeStructures.find((fs) => fs.grade === nextStu.grade);
      setInvoiceForm((prev) => ({
        ...prev,
        studentId: nextStu.id,
        totalAmount: matchedStructure ? String(matchedStructure.totalFee) : prev.totalAmount,
      }));
    }
  }, [showInvoiceModal, filteredIssueStudents, invoiceForm.studentId, feeStructures]);

  useEffect(() => {
    if (ivlScope !== 'student') return;
    if (
      filteredIvlFormStudents.length > 0 &&
      !filteredIvlFormStudents.some((s) => s.id === ivlStudentId)
    ) {
      setIvlStudentId(filteredIvlFormStudents[0].id);
    }
  }, [ivlScope, filteredIvlFormStudents, ivlStudentId]);

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

  function buildInvoiceBreakdown(inv: FeeInvoice, paymentSelector = 'LATEST') {
    const matchedStructure =
      feeStructures.find(
        (fs) => fs.grade === inv.grade && fs.term === inv.term
      ) || feeStructures.find((fs) => fs.grade === inv.grade);

    const votelines: FeeVoteline[] = matchedStructure
      ? getStructureVotelines(matchedStructure)
      : [{ id: 'vl-general', name: 'Tuition & School Fees', amount: inv.totalAmount }];

    const weights = votelines.map((v) => Math.max(0, v.amount));
    const weightSum = weights.reduce((a, b) => a + b, 0);

    const latestPayment =
      inv.payments.length > 0 ? inv.payments[inv.payments.length - 1] : null;
    const activePayment =
      paymentSelector === 'ALL'
        ? null
        : paymentSelector === 'LATEST'
        ? latestPayment
        : inv.payments.find((p) => p.id === paymentSelector) || latestPayment;

    const receiptTargetAmount = activePayment
      ? Math.max(0, activePayment.appliedAmount ?? activePayment.amount)
      : inv.paidAmount;
    const billedAlloc = allocateProportionally(inv.totalAmount, weights);
    const receiptAlloc = allocateProportionally(receiptTargetAmount, weights);
    const paidAlloc = allocateProportionally(inv.paidAmount, weights);

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
  }

  // Proportional Official Fee Receipt allocation derived from matching Fee Structure votelines
  const receiptBreakdown = useMemo(() => {
    if (!receiptInvoice) return null;
    return buildInvoiceBreakdown(receiptInvoice, selectedReceiptPaymentId);
  }, [receiptInvoice, feeStructures, selectedReceiptPaymentId]);

  async function handleDownloadInvoicePdf(inv: FeeInvoice, paymentSelector = 'LATEST') {
    try {
      const breakdown = buildInvoiceBreakdown(inv, paymentSelector);
      const fileName = await downloadOfficialFeeReceiptPdf({
        tenant,
        invoice: inv,
        activePayment: breakdown.activePayment,
        receiptTargetAmount: breakdown.receiptTargetAmount,
        matchedStructureLabel: breakdown.matchedStructure
          ? `${breakdown.matchedStructure.grade} - ${breakdown.matchedStructure.term}`
          : undefined,
        rows: breakdown.rows,
        independentVotelines: getInvoiceIndependentVotelines(inv),
      });
      onNotify(
        `Downloaded ${inv.payments.length > 0 ? 'Official Fee Receipt' : 'Fee Statement'} PDF (${fileName}).`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to generate PDF', 'error');
    }
  }

  async function handleDownloadStructurePdf(fs: FeeStructure) {
    try {
      const fileName = await downloadFeeStructurePdf(
        tenant,
        fs,
        independentVotelines
      );
      onNotify(`Downloaded Fee Structure PDF (${fileName}).`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Unable to generate Fee Structure PDF',
        'error'
      );
    }
  }

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
      const stu = studentById.get(inv.studentId);
      const effectiveGrade = inv.grade || stu?.grade || '';
      const effectiveStream = stu?.section || '';
      if (statusFilter !== 'All' && inv.status !== statusFilter) return false;
      if (invoiceGradeFilter !== 'All' && effectiveGrade !== invoiceGradeFilter) return false;
      if (invoiceStreamFilter !== 'All' && effectiveStream !== invoiceStreamFilter) return false;
      if (!q) return true;
      return (
        inv.studentName.toLowerCase().includes(q) ||
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.studentCode.toLowerCase().includes(q)
      );
    });
  }, [
    invoices,
    studentById,
    statusFilter,
    invoiceGradeFilter,
    invoiceStreamFilter,
    searchQuery,
  ]);

  const INVOICES_PAGE_SIZE = 50;
  const invoiceTotalPages = Math.max(1, Math.ceil(filteredInvoices.length / INVOICES_PAGE_SIZE));
  const safeInvoicePage = Math.min(invoicePage, invoiceTotalPages);
  const paginatedInvoices = useMemo(
    () =>
      filteredInvoices.slice(
        (safeInvoicePage - 1) * INVOICES_PAGE_SIZE,
        safeInvoicePage * INVOICES_PAGE_SIZE
      ),
    [filteredInvoices, safeInvoicePage]
  );

  useEffect(() => {
    setInvoicePage(1);
  }, [tenant.id, statusFilter, invoiceGradeFilter, invoiceStreamFilter, searchQuery]);

  const independentMetrics = useMemo(() => {
    const totalCharged = independentVotelines.reduce((sum, v) => sum + v.amount, 0);
    const totalPaid = independentVotelines.reduce((sum, v) => sum + v.paidAmount, 0);
    const totalBalance = independentVotelines.reduce((sum, v) => sum + v.balance, 0);
    return {
      count: independentVotelines.length,
      totalCharged,
      totalPaid,
      totalBalance,
    };
  }, [independentVotelines]);

  const filteredIndependentVotelines = useMemo(() => {
    const q = ivlSearch.trim().toLowerCase();
    return independentVotelines.filter((item) => {
      const stu = studentById.get(item.studentId);
      const effectiveGrade = item.grade || stu?.grade || '';
      const effectiveStream = stu?.section || '';
      if (ivlStatusFilter !== 'All' && item.status !== ivlStatusFilter) return false;
      if (ivlGradeFilter !== 'All' && effectiveGrade !== ivlGradeFilter) return false;
      if (ivlStreamFilter !== 'All' && effectiveStream !== ivlStreamFilter) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.studentName.toLowerCase().includes(q) ||
        item.studentCode.toLowerCase().includes(q) ||
        item.grade.toLowerCase().includes(q) ||
        (item.note || '').toLowerCase().includes(q)
      );
    });
  }, [
    independentVotelines,
    studentById,
    ivlSearch,
    ivlStatusFilter,
    ivlGradeFilter,
    ivlStreamFilter,
  ]);

  function getInvoiceIndependentVotelines(inv: FeeInvoice): IndependentVotelineItem[] {
    return independentVotelines.filter((v) =>
      v.invoiceId ? v.invoiceId === inv.id : v.studentId === inv.studentId && v.term === inv.term
    );
  }

  function jumpToAddIndependentForInvoice(inv: FeeInvoice) {
    setIvlScope('student');
    setIvlStudentId(inv.studentId);
    setIvlTerm(inv.term || tenant.currentTerm);
    setActiveTab('independent');
  }

  const excelBatchSummary = useMemo(() => {
    const validSelected = parsedExcelRows.filter((r) => r.include && r.status === 'valid');
    const errorCount = parsedExcelRows.filter((r) => r.status === 'error').length;
    const skippedCount = parsedExcelRows.filter((r) => r.status === 'skipped').length;
    const totalAmount = validSelected.reduce((sum, r) => sum + r.amount, 0);
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
    if (!Number.isFinite(amount) || amount <= 0) {
      onNotify('Enter a valid positive payment amount.', 'error');
      return;
    }
    const prevBal = paymentModalInvoice.balance;
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
      const excess = Math.max(0, Math.round(amount) - prevBal);
      onNotify(
        excess > 0
          ? `Recorded ${formatCurrency(amount, tenant.currency)} (${formatCurrency(
              excess,
              tenant.currency
            )} stored on student credit balance).`
          : `Payment of ${formatCurrency(amount, tenant.currency)} recorded.`
      );
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
    const prevBal = selectedManualInvoice.balance;
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
      const excess = Math.max(0, Math.round(amount) - prevBal);
      onNotify(
        excess > 0
          ? `Recorded ${formatCurrency(amount, tenant.currency)} for ${invoice.studentName} (${formatCurrency(
              excess,
              tenant.currency
            )} credited).`
          : `Recorded ${formatCurrency(amount, tenant.currency)} for ${invoice.studentName}.`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Manual payment failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  function handleDownloadTemplate() {
    const sourceRows: Array<Record<string, string | number>> =
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

    const sheet = createBrandedWorksheetFromObjects(
      tenant,
      `Fee Payments Import Template (${tenant.academicYear} ${tenant.currentTerm})`,
      sourceRows,
      [
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
      ]
    );
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Fee Payments');
    XLSX.writeFile(workbook, `${tenant.slug}-fee-payments-template.xlsx`);
    onNotify('Downloaded branded Excel fee payment template.');
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

      const rawRows = parseExcelSheetRowsSmart(workbook.Sheets[firstSheetName], [
        'invoice',
        'student',
        'code',
        'name',
        'amount',
        'method',
        'reference',
      ]);
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

        const roundedAmount = Math.round(numericAmount);
        const excess = Math.max(0, roundedAmount - matched.balance);
        const creditNote =
          excess > 0
            ? `Excess ${formatCurrency(excess, tenant.currency)} -> Student Credit Balance`
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
          note: creditNote,
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

  function buildFeeStructureShareText(fs: FeeStructure): string {
    const meta = resolveTenantDocumentMeta(tenant);
    const lines = getStructureVotelines(fs);
    const independentSummary = summarizeIndependentVotelinesForStructure(
      fs,
      independentVotelines
    );
    const headerLines = [
      `*${meta.schoolName}*`,
      `${meta.location} | ${meta.postalAddress}`,
      `Tel: ${meta.contactPhone} | Email: ${meta.contactEmail}`,
      ``,
      `*OFFICIAL FEE STRUCTURE — ${fs.grade.toUpperCase()} (${fs.term})*`,
      `Academic Year: ${tenant.academicYear} | Currency: ${tenant.currency}`,
      ``,
      ...lines.map(
        (line, idx) =>
          `${idx + 1}. ${line.name}: ${formatCurrency(line.amount, tenant.currency)}`
      ),
      ``,
      `*TOTAL TERM FEE (MAIN STRUCTURE): ${formatCurrency(fs.totalFee, tenant.currency)}*`,
    ];

    if (independentSummary.lines.length > 0) {
      headerLines.push(
        ``,
        `*INDEPENDENT VOTELINES (SEPARATE FROM MAIN FEE STRUCTURE):*`,
        ...independentSummary.lines.map(
          (item, idx) =>
            `${idx + 1}. ${item.name}${item.note ? ` (${item.note})` : ''}: ${formatCurrency(
              item.unitAmount,
              tenant.currency
            )}`
        ),
        `*INDEPENDENT VOTELINES TOTAL (SEPARATE): ${formatCurrency(
          independentSummary.separateScheduleTotal,
          tenant.currency
        )}*`
      );
    }

    if (tenant.mpesaConfig?.enabled) {
      headerLines.push(
        ``,
        `M-Pesa Paybill: ${tenant.mpesaConfig.paybillNumber} (${tenant.mpesaConfig.accountName})`,
        `Account No.: Learner Admission Code`
      );
    }
    return headerLines.join('\n');
  }

  function buildFeeStructureWhatsAppHref(fs: FeeStructure): string {
    return `https://wa.me/?text=${encodeURIComponent(buildFeeStructureShareText(fs))}`;
  }

  async function handleCopyFeeStructureText(fs: FeeStructure) {
    try {
      await navigator.clipboard?.writeText(buildFeeStructureShareText(fs));
      setCopiedStructureId(fs.id);
      onNotify(`Copied ${fs.grade} (${fs.term}) fee structure summary.`);
      setTimeout(() => setCopiedStructureId(null), 2500);
    } catch {
      onNotify('Copy the fee structure details manually from the preview box.', 'error');
    }
  }

  function handleExportStructureExcel(fs: FeeStructure) {
    const lines = getStructureVotelines(fs);
    const independentSummary = summarizeIndependentVotelinesForStructure(
      fs,
      independentVotelines
    );
    const bodyAoa: Array<Array<string | number>> = [
      ['#', 'Votehead / Voteline', `Amount (${tenant.currency})`],
      ...lines.map((line, idx) => [idx + 1, line.name, line.amount]),
      ['', `TOTAL TERM FEE (${fs.grade} · ${fs.term})`, fs.totalFee],
      [],
      ['', 'INDEPENDENT VOTELINES (SEPARATE FROM MAIN FEE STRUCTURE)', '', ''],
      ['#', 'Independent Voteline', `Amount (${tenant.currency})`, 'Scope / Notes'],
      ...(independentSummary.lines.length > 0
        ? independentSummary.lines.map((item, idx) => [
            idx + 1,
            item.name,
            item.unitAmount,
            item.note || `${item.learnerCount} learner(s) assigned`,
          ])
        : [['—', 'No independent votelines assigned for this grade & term', 0, 'Optional / Separate']]),
      [
        '',
        `INDEPENDENT VOTELINES TOTAL (SEPARATE · ${fs.grade})`,
        independentSummary.separateScheduleTotal,
        'Not added to Main Fee Total',
      ],
    ];
    const ws = createBrandedAoaWorksheet(
      tenant,
      `Official Fee Structure — ${fs.grade} (${fs.term})`,
      bodyAoa,
      [{ wch: 8 }, { wch: 42 }, { wch: 22 }, { wch: 28 }],
      [`Academic Year: ${tenant.academicYear}`]
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${fs.grade}`.slice(0, 31));
    const safeGrade = fs.grade.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    XLSX.writeFile(wb, `${tenant.slug}-${safeGrade}-fee-structure.xlsx`);
    onNotify(`Downloaded branded Excel fee structure for ${fs.grade} (${fs.term}).`);
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
      setLastSavedStructureKey(`${structureGrade}::${structureTerm}`);
      onNotify(
        `Saved ${structureGrade} (${structureTerm}) with ${cleaned.length} votelines (${formatCurrency(
          cleaned.reduce((s, v) => s + v.amount, 0),
          tenant.currency
        )}). Ready to download or share.`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to save fee structure', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateIndependentVoteline(e: React.FormEvent) {
    e.preventDefault();
    const cleanName = ivlName.trim();
    const numericAmt = Math.round(Number(ivlAmount));
    if (!cleanName) {
      onNotify('Enter an independent voteline name (e.g. Transport Fee or Academic Trip Fee).', 'error');
      return;
    }
    if (!Number.isFinite(numericAmt) || numericAmt <= 0) {
      onNotify('Enter a valid positive amount for the independent voteline.', 'error');
      return;
    }
    if (ivlScope === 'student' && !ivlStudentId) {
      onNotify('Select a learner to assign the independent voteline alongside their fee.', 'error');
      return;
    }
    if (ivlScope === 'grade' && !ivlGrade) {
      onNotify('Select a target grade/class.', 'error');
      return;
    }

    setSaving(true);
    try {
      const res = await saasApi.createIndependentVoteline(tenant.id, {
        name: cleanName,
        amount: numericAmt,
        term: ivlTerm.trim() || tenant.currentTerm,
        note: ivlNote.trim() || undefined,
        targetScope: ivlScope,
        studentId: ivlScope === 'student' ? ivlStudentId : undefined,
        grade: ivlScope === 'grade' ? ivlGrade : undefined,
        recordedBy: `${currentRole} Office`,
      });
      await onRefresh();
      setIvlNote('');
      onNotify(
        `Added ${cleanName} (${formatCurrency(numericAmt, tenant.currency)}) for ${res.items.length} learner(s) alongside fees — Core Fee Total unchanged.`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to add independent voteline', 'error');
    } finally {
      setSaving(false);
    }
  }

  function openIndependentPayModal(item: IndependentVotelineItem) {
    setIvlPayModalItem(item);
    setIvlPayForm({
      amount: String(item.balance),
      method: 'Mobile Money',
      reference: '',
      paidAt: todayIsoDate(),
    });
  }

  async function handleRecordIndependentPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!ivlPayModalItem) return;
    const amt = Math.round(Number(ivlPayForm.amount));
    if (!Number.isFinite(amt) || amt <= 0) {
      onNotify('Enter a positive payment amount.', 'error');
      return;
    }
    setSaving(true);
    try {
      await saasApi.recordIndependentVotelinePayment(tenant.id, ivlPayModalItem.id, {
        amount: amt,
        method: ivlPayForm.method,
        reference: ivlPayForm.reference,
        recordedBy: `${currentRole} Office`,
        paidAt: ivlPayForm.paidAt,
      });
      await onRefresh();
      setIvlPayModalItem(null);
      onNotify(
        `Recorded ${formatCurrency(Math.min(amt, ivlPayModalItem.balance), tenant.currency)} toward ${ivlPayModalItem.name} (${ivlPayModalItem.studentName}).`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to record payment', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmDeleteIndependentVoteline(e: React.FormEvent) {
    e.preventDefault();
    if (!ivlVoidTarget) return;
    if (!ivlVoidReason.trim()) {
      onNotify('Provide a reason for voiding this independent voteline.', 'error');
      return;
    }
    setSaving(true);
    try {
      await saasApi.deleteIndependentVoteline(tenant.id, ivlVoidTarget.id, ivlVoidReason.trim());
      await onRefresh();
      onNotify(`Voided ${ivlVoidTarget.name} (${ivlVoidTarget.studentName}).`);
      setIvlVoidTarget(null);
      setIvlVoidReason('');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to void independent voteline', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleVoidPaymentSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!voidPaymentTarget) return;
    if (!voidPaymentReason.trim()) {
      onNotify('A reason is required to void a payment.', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await saasApi.voidPayment(
        tenant.id,
        voidPaymentTarget.invoice.id,
        voidPaymentTarget.payment.id,
        voidPaymentReason.trim()
      );
      await onRefresh();
      setReceiptInvoice(res.invoice);
      setVoidPaymentTarget(null);
      setVoidPaymentReason('');
      onNotify(`Voided receipt ${voidPaymentTarget.payment.receiptNumber} and created reversing entry.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to void payment', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateCreditNoteSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!creditNoteModalInvoice) return;
    const amt = Number(creditNoteAmount);
    if (!Number.isFinite(amt) || amt <= 0 || !creditNoteReason.trim()) {
      onNotify('Enter a positive credit note amount and reason.', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await saasApi.createCreditNote(tenant.id, {
        invoiceId: creditNoteModalInvoice.id,
        amount: amt,
        reason: creditNoteReason.trim(),
      });
      await onRefresh();
      setCreditNoteModalInvoice(null);
      setCreditNoteAmount('');
      setCreditNoteReason('');
      onNotify(
        `Issued credit note ${res.creditNote.creditNoteNumber} (${formatCurrency(
          res.creditNote.amount,
          tenant.currency
        )}).`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to issue credit note', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateWaiverSubmit(e: React.FormEvent) {
    e.preventDefault();
    const val = Number(waiverForm.value);
    if (!waiverForm.studentId || !Number.isFinite(val) || val <= 0 || !waiverForm.reason.trim()) {
      onNotify('Select a student and enter a positive waiver/bursary value and reason.', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await saasApi.createFeeWaiver(tenant.id, {
        studentId: waiverForm.studentId,
        invoiceId: waiverForm.invoiceId || undefined,
        term: waiverForm.term || undefined,
        kind: waiverForm.kind,
        mode: waiverForm.mode,
        value: val,
        reason: waiverForm.reason.trim(),
      });
      await onRefresh();
      setWaiverModalOpen(false);
      onNotify(
        `Applied ${res.waiver.kind} (${formatCurrency(
          res.waiver.discountAmount,
          tenant.currency
        )}) for ${res.waiver.studentName}.`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to apply fee waiver', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveSiblingDiscountSubmit(e: React.FormEvent) {
    e.preventDefault();
    const pct = Number(siblingForm.percentage);
    const minSibs = Number(siblingForm.minSiblings);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      onNotify('Enter a sibling discount percentage between 0 and 100.', 'error');
      return;
    }
    setSaving(true);
    try {
      await saasApi.updateSiblingDiscountConfig(tenant.id, {
        enabled: siblingForm.enabled,
        percentage: pct,
        minSiblings: Number.isFinite(minSibs) && minSibs >= 2 ? minSibs : 2,
      });
      await onRefresh();
      setSiblingModalOpen(false);
      onNotify(
        siblingForm.enabled
          ? `Sibling discount enabled (${pct}% from sibling #${minSibs || 2}).`
          : 'Sibling discount rule disabled.'
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to update sibling discount', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleCarryForwardSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!carryForwardForm.toTerm.trim()) {
      onNotify('Specify the destination term.', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await saasApi.carryForwardTermBalances(tenant.id, {
        fromTerm: carryForwardForm.fromTerm.trim() || undefined,
        toTerm: carryForwardForm.toTerm.trim(),
        dueDate: carryForwardForm.dueDate || undefined,
      });
      await onRefresh();
      setCarryForwardModalOpen(false);
      onNotify(
        `Carried forward balances for ${res.carriedStudentsCount} student(s) into ${res.updatedTerm} (${res.createdInvoices.length} invoices generated).`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to carry forward balances', 'error');
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
            {canManageFees && (
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
            )}
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
            <button
              type="button"
              onClick={() => setActiveTab('independent')}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === 'independent'
                  ? 'bg-white text-blue-700 shadow-sm dark:bg-slate-700 dark:text-blue-300'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Plus className="h-3.5 w-3.5" />
              Independent Votelines
              <span className="font-mono text-[10px] font-semibold text-slate-500 dark:text-slate-300">
                ({independentVotelines.length})
              </span>
            </button>
          </div>

          {canManageFees && (
            <button
              type="button"
              onClick={() => setShowInvoiceModal(true)}
              disabled={students.length === 0 || isCurrentTermClosed}
              title={
                isCurrentTermClosed
                  ? `Term ${currentTermEntity?.name || tenant.currentTerm} is Closed`
                  : undefined
              }
              className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Issue Invoice
            </button>
          )}
        </div>
      </div>

      {isCurrentTermClosed && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
          <div>
            <strong>
              Term Locked ({currentTermEntity?.name || tenant.currentTerm} is Closed):
            </strong>{' '}
            New invoices, payments, waivers, credit notes, and fee adjustments for this term are locked. An Admin can reopen the term in <strong>School Settings</strong>, or use <strong>Carry-Forward Term</strong> to roll balances into a new Open term.
          </div>
        </div>
      )}

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
              <select
                aria-label="Filter invoices by grade"
                value={invoiceGradeFilter}
                onChange={(e) => setInvoiceGradeFilter(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <option value="All">All Grades</option>
                {gradeFilterOptions.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter invoices by stream"
                value={invoiceStreamFilter}
                onChange={(e) => setInvoiceStreamFilter(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <option value="All">All Streams</option>
                {invoiceStreamOptions.map((sec) => (
                  <option key={sec} value={sec}>
                    Stream {sec}
                  </option>
                ))}
              </select>
              <div className="relative w-full sm:w-56">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search invoice, student..."
                  className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
              {canManageFees && (
                <>
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
                      setWaiverForm((prev) => ({
                        ...prev,
                        studentId: students[0]?.id || '',
                        term: tenant.currentTerm,
                        reason: '',
                      }));
                      setWaiverModalOpen(true);
                    }}
                    disabled={students.length === 0 || isCurrentTermClosed}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <Gift className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                    Waiver / Bursary
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSiblingForm({
                        enabled: Boolean(tenant.siblingDiscountConfig?.enabled),
                        percentage: String(tenant.siblingDiscountConfig?.percentage ?? 10),
                        minSiblings: String(tenant.siblingDiscountConfig?.minSiblings ?? 2),
                      });
                      setSiblingModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <Percent className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    Sibling Rule{tenant.siblingDiscountConfig?.enabled ? ` (${tenant.siblingDiscountConfig.percentage}%)` : ''}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCarryForwardModalOpen(true)}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <RotateCcw className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                    Carry-Forward Term
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
                </>
              )}
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
                    <th className="px-4 py-3">Alongside Fee (Independent)</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                        No invoices match your filter.
                      </td>
                    </tr>
                  ) : (
                    paginatedInvoices.map((inv) => {
                      const rowIndependent = getInvoiceIndependentVotelines(inv);
                      const studentRecord = studentById.get(inv.studentId);
                      const creditBal = studentRecord?.creditBalance || 0;
                      return (
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
                            {studentRecord?.section ? ` · Stream ${studentRecord.section}` : ''}
                          </p>
                          {creditBal > 0 && (
                            <p className="mt-0.5 font-mono text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                              Credit Balance: {formatCurrency(creditBal, tenant.currency)}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600 tabular-nums dark:text-slate-400">
                          {formatDateShort(inv.dueDate)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-slate-700 tabular-nums dark:text-slate-300">
                          <div>{formatCurrency(inv.totalAmount, tenant.currency)}</div>
                          {(inv.waiverTotal || 0) > 0 && (
                            <div className="text-[10px] text-emerald-700 dark:text-emerald-400">
                              Waiver -{formatCurrency(inv.waiverTotal || 0, tenant.currency)}
                            </div>
                          )}
                          {(inv.creditNotesTotal || 0) > 0 && (
                            <div className="text-[10px] text-blue-700 dark:text-blue-400">
                              Cr Note -{formatCurrency(inv.creditNotesTotal || 0, tenant.currency)}
                            </div>
                          )}
                          {(inv.carriedForwardFromAmount || 0) > 0 && (
                            <div className="text-[10px] text-amber-700 dark:text-amber-400">
                              Arrears +{formatCurrency(inv.carriedForwardFromAmount || 0, tenant.currency)}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-emerald-700 tabular-nums dark:text-emerald-400">
                          {formatCurrency(inv.paidAmount, tenant.currency)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                          {formatCurrency(inv.balance, tenant.currency)}
                        </td>
                        <td className="px-4 py-3 align-top">
                          {rowIndependent.length === 0 ? (
                            canManageFees ? (
                              <button
                                type="button"
                                onClick={() => jumpToAddIndependentForInvoice(inv)}
                                className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-500 hover:border-blue-400 hover:text-blue-600 dark:border-slate-700 dark:text-slate-400 dark:hover:text-blue-400"
                              >
                                <Plus className="h-3 w-3" />
                                Add Optional
                              </button>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )
                          ) : (
                            <div className="space-y-1">
                              {rowIndependent.map((ivl) => (
                                <div
                                  key={ivl.id}
                                  className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50/70 px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-800/60"
                                >
                                  <span className="truncate font-medium text-slate-800 dark:text-slate-200">
                                    {ivl.name}
                                  </span>
                                  <div className="flex shrink-0 items-center gap-1.5">
                                    <span
                                      className={`font-mono tabular-nums font-semibold ${
                                        ivl.balance === 0
                                          ? 'text-emerald-700 dark:text-emerald-400'
                                          : 'text-slate-900 dark:text-slate-100'
                                      }`}
                                    >
                                      {formatCurrency(ivl.amount, tenant.currency)}
                                      {ivl.balance > 0 && ivl.paidAmount > 0
                                        ? ` (Bal ${formatCurrency(ivl.balance, tenant.currency)})`
                                        : ivl.balance === 0
                                        ? ' · Paid'
                                        : ''}
                                    </span>
                                    {canManageFees && ivl.balance > 0 && (
                                      <button
                                        type="button"
                                        onClick={() => openIndependentPayModal(ivl)}
                                        className="font-semibold text-blue-600 hover:underline dark:text-blue-400"
                                      >
                                        Pay
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                              {canManageFees && (
                                <button
                                  type="button"
                                  onClick={() => jumpToAddIndependentForInvoice(inv)}
                                  className="inline-flex items-center gap-0.5 text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
                                >
                                  <Plus className="h-3 w-3" />
                                  Add Another
                                </button>
                              )}
                            </div>
                          )}
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
                          <div className="inline-flex items-center gap-2.5">
                            {canManageFees && inv.balance > 0 && !isCurrentTermClosed && (
                              <button
                                type="button"
                                onClick={() => openPaymentModal(inv)}
                                className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                              >
                                <CreditCard className="h-3.5 w-3.5" />
                                Collect
                              </button>
                            )}
                            {canManageFees && inv.balance > 0 && !isCurrentTermClosed && (
                              <button
                                type="button"
                                onClick={() => {
                                  setCreditNoteModalInvoice(inv);
                                  setCreditNoteAmount('');
                                  setCreditNoteReason('');
                                }}
                                className="whitespace-nowrap text-xs font-medium text-slate-600 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400"
                              >
                                Cr Note
                              </button>
                            )}
                            {canManageFees && inv.balance > 0 && (
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
                            <button
                              type="button"
                              onClick={() => void handleDownloadInvoicePdf(inv)}
                              title={
                                inv.payments.length > 0
                                  ? `Download Official Receipt PDF for ${inv.studentName}`
                                  : `Download Fee Statement PDF for ${inv.studentName}`
                              }
                              className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-rose-600 hover:underline dark:text-rose-400"
                            >
                              <Download className="h-3.5 w-3.5" />
                              PDF
                            </button>
                          </div>
                        </td>
                      </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {filteredInvoices.length > INVOICES_PAGE_SIZE && (
              <div className="flex flex-col gap-2 border-t border-slate-200 px-5 py-3 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:text-slate-400">
                <span className="font-mono tabular-nums">
                  Showing {(safeInvoicePage - 1) * INVOICES_PAGE_SIZE + 1}–
                  {Math.min(safeInvoicePage * INVOICES_PAGE_SIZE, filteredInvoices.length)} of{' '}
                  {filteredInvoices.length} invoices
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={safeInvoicePage <= 1}
                    onClick={() => setInvoicePage((p) => Math.max(1, p - 1))}
                    className="rounded-md border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    Previous
                  </button>
                  <span className="font-mono tabular-nums">
                    Page {safeInvoicePage} / {invoiceTotalPages}
                  </span>
                  <button
                    type="button"
                    disabled={safeInvoicePage >= invoiceTotalPages}
                    onClick={() => setInvoicePage((p) => Math.min(invoiceTotalPages, p + 1))}
                    className="rounded-md border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
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
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Filter by Grade
                      </label>
                      <select
                        value={manualGradeFilter}
                        onChange={(e) => setManualGradeFilter(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      >
                        <option value="All">All Grades</option>
                        {gradeFilterOptions.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Filter by Stream
                      </label>
                      <select
                        value={manualStreamFilter}
                        onChange={(e) => setManualStreamFilter(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      >
                        <option value="All">All Streams</option>
                        {manualStreamOptions.map((sec) => (
                          <option key={sec} value={sec}>
                            Stream {sec}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Student & Open Invoice ({filteredManualOpenInvoices.length} matching)
                      </label>
                      <select
                        value={manualPaymentForm.invoiceId}
                        onChange={(e) => {
                          const nextInv = filteredManualOpenInvoices.find(
                            (i) => i.id === e.target.value
                          );
                          setManualPaymentForm((prev) => ({
                            ...prev,
                            invoiceId: e.target.value,
                            amount: nextInv ? String(nextInv.balance) : '',
                          }));
                        }}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      >
                        {filteredManualOpenInvoices.length === 0 ? (
                          <option value="">No open invoices match selected Grade / Stream</option>
                        ) : (
                          filteredManualOpenInvoices.map((inv) => {
                            const stuSec = studentById.get(inv.studentId)?.section;
                            return (
                              <option key={inv.id} value={inv.id}>
                                {inv.studentName} ({inv.studentCode} · {inv.grade}
                                {stuSec ? ` · ${stuSec}` : ''}) · {inv.invoiceNumber} — Bal:{' '}
                                {formatCurrency(inv.balance, tenant.currency)}
                              </option>
                            );
                          })
                        )}
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
                        value={manualPaymentForm.amount}
                        onChange={(e) =>
                          setManualPaymentForm((prev) => ({ ...prev, amount: e.target.value }))
                        }
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      />
                      {selectedManualInvoice &&
                        Number(manualPaymentForm.amount) > selectedManualInvoice.balance && (
                          <p className="mt-1 text-[11px] font-medium text-blue-700 dark:text-blue-400">
                            Excess of{' '}
                            {formatCurrency(
                              Math.round(Number(manualPaymentForm.amount)) -
                                selectedManualInvoice.balance,
                              tenant.currency
                            )}{' '}
                            will be stored on the student&apos;s credit balance.
                          </p>
                        )}
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
                        disabled={saving || !selectedManualInvoice || isCurrentTermClosed}
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
      ) : activeTab === 'structures' ? (
        <div className="space-y-5">
          {lastSavedStructureKey &&
            (() => {
              const savedFs = feeStructures.find(
                (f) => `${f.grade}::${f.term}` === lastSavedStructureKey
              );
              if (!savedFs) return null;
              return (
                <div className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between dark:border-emerald-900/60 dark:bg-emerald-950/30">
                  <div className="flex items-start gap-2.5 text-xs">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
                    <div>
                      <p className="font-semibold text-emerald-950 dark:text-emerald-200">
                        Fee structure saved for {savedFs.grade} ({savedFs.term}) —{' '}
                        <span className="font-mono">
                          {formatCurrency(savedFs.totalFee, tenant.currency)}
                        </span>
                      </p>
                      <p className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80">
                        Download the branded PDF/Excel schedule or share it with parents &amp; staff.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleDownloadStructurePdf(savedFs)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => setShareStructureModal(savedFs)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-50 dark:border-emerald-800 dark:bg-slate-900 dark:text-emerald-300"
                    >
                      <Printer className="h-3.5 w-3.5" />
                      Preview / Print
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExportStructureExcel(savedFs)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-50 dark:border-emerald-800 dark:bg-slate-900 dark:text-emerald-300"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5" />
                      Excel (.xlsx)
                    </button>
                    <a
                      href={buildFeeStructureWhatsAppHref(savedFs)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-50 dark:border-emerald-800 dark:bg-slate-900 dark:text-emerald-300"
                    >
                      <Share2 className="h-3.5 w-3.5" />
                      Share WhatsApp
                    </a>
                    <button
                      type="button"
                      onClick={() => setLastSavedStructureKey(null)}
                      aria-label="Dismiss saved fee structure banner"
                      className="rounded p-1 text-emerald-700 hover:bg-emerald-100 dark:text-emerald-400 dark:hover:bg-emerald-900/50"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })()}
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs text-slate-600 dark:text-slate-300">
              <strong className="text-slate-900 dark:text-slate-100">
                Optional / Auxiliary Votelines (e.g. Transport Fee, Academic Trip Fee):
              </strong>{' '}
              Enter them under <strong className="text-blue-700 dark:text-blue-400">Independent Votelines</strong> so they appear alongside student fees without changing any Grade Fee Structure Total.
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('independent')}
              className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 whitespace-nowrap hover:bg-blue-100 sm:self-auto dark:border-blue-800/70 dark:bg-blue-950/40 dark:text-blue-300"
            >
              <Plus className="h-3.5 w-3.5" />
              Manage Independent Votelines ({independentVotelines.length})
            </button>
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Existing Configured Fee Templates */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white lg:col-span-6 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Configured Fee Templates ({tenant.currency})
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Each grade supports up to {MAX_FEE_VOTELINES} custom votelines. Edit, download, or share any saved template.
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
                  const indSummary = summarizeIndependentVotelinesForStructure(
                    fs,
                    independentVotelines
                  );
                  return (
                    <div
                      key={fs.id}
                      className={`p-4 transition-colors ${
                        isEditingThis
                          ? 'bg-blue-50/60 dark:bg-blue-950/20'
                          : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/30'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
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

                        <div className="flex flex-wrap items-center gap-2">
                          <div className="mr-1 text-right">
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
                          <button
                            type="button"
                            onClick={() => void handleDownloadStructurePdf(fs)}
                            title="Download Fee Structure PDF"
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-800/70 dark:bg-rose-950/40 dark:text-rose-300"
                          >
                            <Download className="h-3 w-3" />
                            PDF
                          </button>
                          <button
                            type="button"
                            onClick={() => setShareStructureModal(fs)}
                            title="Preview / Print Fee Structure with School Logo & Contacts"
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                          >
                            <Printer className="h-3 w-3" />
                            Preview
                          </button>
                          <button
                            type="button"
                            onClick={() => handleExportStructureExcel(fs)}
                            title="Export Fee Structure to Excel (.xlsx)"
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                          >
                            <FileSpreadsheet className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                            Excel
                          </button>
                          <button
                            type="button"
                            onClick={() => setShareStructureModal(fs)}
                            title="Share Fee Structure via WhatsApp or Copy Text"
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-300"
                          >
                            <Share2 className="h-3 w-3" />
                            Share
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

                      {indSummary.lines.length > 0 && (
                        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200/80 bg-slate-50/70 px-3 py-1.5 text-[11px] dark:border-slate-800 dark:bg-slate-800/40">
                          <span className="truncate text-slate-600 dark:text-slate-300">
                            <strong className="text-slate-800 dark:text-slate-100">
                              Independent (Separate):
                            </strong>{' '}
                            {indSummary.lines.map((l) => l.name).join(', ')}
                          </span>
                          <span className="shrink-0 font-mono font-semibold text-slate-800 tabular-nums dark:text-slate-200">
                            {formatCurrency(indSummary.separateScheduleTotal, tenant.currency)}
                          </span>
                        </div>
                      )}
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
        </div>
      ) : (
        <div className="space-y-6">
          {/* Independent Votelines KPI Summary Strip */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Independent Votelines Charged
              </p>
              <p className="mt-1.5 font-mono text-xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
                {formatCurrency(independentMetrics.totalCharged, tenant.currency)}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                {independentMetrics.count} item(s) · Excluded from Fee Total
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Independent Collections
              </p>
              <p className="mt-1.5 font-mono text-xl font-bold text-emerald-700 tabular-nums dark:text-emerald-400">
                {formatCurrency(independentMetrics.totalPaid, tenant.currency)}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                Tracked separately from tuition invoices
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Independent Balance
              </p>
              <p className="mt-1.5 font-mono text-xl font-bold text-amber-700 tabular-nums dark:text-amber-400">
                {formatCurrency(independentMetrics.totalBalance, tenant.currency)}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                Appears alongside fees on ledger &amp; receipts
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
            {/* Left: Create Independent Voteline Form */}
            <form
              onSubmit={handleCreateIndependentVoteline}
              className="rounded-xl border border-slate-200 bg-white p-5 xl:col-span-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Add Independent Voteline
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Add charges such as Transport Fee or Academic Trip Fee. They never alter Fee Structure totals and appear alongside the learner&apos;s fee.
              </p>

              {/* Quick Preset Chips */}
              <div className="mt-3">
                <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Quick Presets
                </span>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {INDEPENDENT_VOTELINE_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setIvlName(preset)}
                      className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                        ivlName.trim().toLowerCase() === preset.toLowerCase()
                          ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/50 dark:text-blue-300'
                          : 'border-slate-200 text-slate-600 hover:border-blue-400 hover:text-blue-600 dark:border-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Voteline Name *
                  </label>
                  <input
                    required
                    type="text"
                    value={ivlName}
                    onChange={(e) => setIvlName(e.target.value)}
                    placeholder="e.g. Transport Fee or Academic Trip Fee"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Amount ({tenant.currency}) *
                    </label>
                    <input
                      required
                      type="number"
                      min={1}
                      value={ivlAmount}
                      onChange={(e) => setIvlAmount(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Academic Term
                    </label>
                    <input
                      type="text"
                      value={ivlTerm}
                      onChange={(e) => setIvlTerm(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Assign To
                  </label>
                  <select
                    value={ivlScope}
                    onChange={(e) =>
                      setIvlScope(e.target.value as 'student' | 'grade' | 'all')
                    }
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value="student">Specific Learner</option>
                    <option value="grade">Whole Grade / Class</option>
                    <option value="all">All Active Learners ({students.filter((s) => s.status === 'Active').length})</option>
                  </select>
                </div>

                {ivlScope === 'student' && (
                  <div className="space-y-2.5">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                          Filter Grade
                        </label>
                        <select
                          value={ivlFormGradeFilter}
                          onChange={(e) => setIvlFormGradeFilter(e.target.value)}
                          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        >
                          <option value="All">All Grades</option>
                          {gradeFilterOptions.map((g) => (
                            <option key={g} value={g}>
                              {g}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                          Filter Stream
                        </label>
                        <select
                          value={ivlFormStreamFilter}
                          onChange={(e) => setIvlFormStreamFilter(e.target.value)}
                          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        >
                          <option value="All">All Streams</option>
                          {ivlFormStreamOptions.map((sec) => (
                            <option key={sec} value={sec}>
                              Stream {sec}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Learner * ({filteredIvlFormStudents.length} matching)
                      </label>
                      <select
                        value={ivlStudentId}
                        onChange={(e) => setIvlStudentId(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      >
                        {filteredIvlFormStudents.length === 0 ? (
                          <option value="">No learners match selected Grade / Stream</option>
                        ) : (
                          filteredIvlFormStudents.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.fullName} ({s.studentCode} · {s.grade} · Stream {s.section})
                            </option>
                          ))
                        )}
                      </select>
                    </div>
                  </div>
                )}

                {ivlScope === 'grade' && (
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Target Grade *
                    </label>
                    <select
                      value={ivlGrade}
                      onChange={(e) => setIvlGrade(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    >
                      {tenant.grades.map((g) => (
                        <option key={g} value={g}>
                          {g} ({students.filter((s) => s.grade === g).length} learners)
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Description / Route / Trip Note (Optional)
                  </label>
                  <input
                    type="text"
                    value={ivlNote}
                    onChange={(e) => setIvlNote(e.target.value)}
                    placeholder="e.g. Route B — Kilimani or Naivasha Science Trip"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
                  Core Tuition / Grade Fee Total remains strictly unaffected.
                </div>

                <button
                  type="submit"
                  disabled={saving || students.length === 0}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {saving ? 'Adding...' : 'Add Independent Voteline'}
                </button>
              </div>
            </form>

            {/* Right: Independent Votelines Ledger */}
            <div className="rounded-xl border border-slate-200 bg-white xl:col-span-8 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Independent Votelines Alongside Fees ({filteredIndependentVotelines.length})
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Billed and collected alongside student fees without altering Grade Fee Totals.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Filter independent votelines by grade"
                    value={ivlGradeFilter}
                    onChange={(e) => setIvlGradeFilter(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <option value="All">All Grades</option>
                    {gradeFilterOptions.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Filter independent votelines by stream"
                    value={ivlStreamFilter}
                    onChange={(e) => setIvlStreamFilter(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <option value="All">All Streams</option>
                    {ivlLedgerStreamOptions.map((sec) => (
                      <option key={sec} value={sec}>
                        Stream {sec}
                      </option>
                    ))}
                  </select>
                  <div className="relative w-full sm:w-44">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={ivlSearch}
                      onChange={(e) => setIvlSearch(e.target.value)}
                      placeholder="Filter learner or voteline..."
                      className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pr-2.5 pl-8 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                  <select
                    value={ivlStatusFilter}
                    onChange={(e) => setIvlStatusFilter(e.target.value as 'All' | InvoiceStatus)}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <option value="All">All Statuses</option>
                    <option value="Pending">Pending</option>
                    <option value="Partial">Partial</option>
                    <option value="Paid">Paid</option>
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Learner</th>
                      <th className="px-4 py-3">Independent Voteline</th>
                      <th className="px-4 py-3 text-right">Charged</th>
                      <th className="px-4 py-3 text-right">Paid</th>
                      <th className="px-4 py-3 text-right">Balance</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredIndependentVotelines.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                          No independent votelines match your filters. Add Transport Fee, Academic Trip Fee, or optional levies on the left.
                        </td>
                      </tr>
                    ) : (
                      filteredIndependentVotelines.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                          <td className="px-4 py-3 align-top">
                            <p className="font-semibold text-slate-900 dark:text-slate-100">
                              {item.studentName}
                            </p>
                            <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                              {item.studentCode} · {item.grade}
                              {studentById.get(item.studentId)?.section
                                ? ` · Stream ${studentById.get(item.studentId)?.section}`
                                : ''}
                            </p>
                          </td>
                          <td className="px-4 py-3 align-top">
                            <p className="font-semibold text-slate-900 dark:text-slate-100">
                              {item.name}
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              {item.term}
                              {item.invoiceNumber ? ` · Alongside ${item.invoiceNumber}` : ''}
                            </p>
                            {item.note && (
                              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                {item.note}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right align-top font-mono text-slate-700 tabular-nums dark:text-slate-300">
                            {formatCurrency(item.amount, tenant.currency)}
                          </td>
                          <td className="px-4 py-3 text-right align-top font-mono text-emerald-700 tabular-nums dark:text-emerald-400">
                            {formatCurrency(item.paidAmount, tenant.currency)}
                          </td>
                          <td className="px-4 py-3 text-right align-top font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
                            {formatCurrency(item.balance, tenant.currency)}
                          </td>
                          <td className="px-4 py-3 align-top">
                            <span
                              className={`inline-block rounded border px-2 py-0.5 text-[11px] font-semibold ${
                                item.status === 'Paid'
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                                  : item.status === 'Partial'
                                  ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                                  : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                              }`}
                            >
                              {item.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right align-top">
                            <div className="inline-flex items-center gap-2">
                              {item.balance > 0 && (
                                <button
                                  type="button"
                                  onClick={() => openIndependentPayModal(item)}
                                  className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400"
                                >
                                  <CreditCard className="h-3.5 w-3.5" />
                                  Collect
                                </button>
                              )}
                              {canManageFees && (
                                <button
                                  type="button"
                                  disabled={saving}
                                  onClick={() => {
                                    setIvlVoidReason('');
                                    setIvlVoidTarget(item);
                                  }}
                                  aria-label={`Void ${item.name}`}
                                  className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
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
          </div>
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
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
                {Number(paymentForm.amount) > paymentModalInvoice.balance && (
                  <p className="mt-1 text-[11px] font-medium text-blue-700 dark:text-blue-400">
                    Excess of{' '}
                    {formatCurrency(
                      Math.round(Number(paymentForm.amount)) - paymentModalInvoice.balance,
                      tenant.currency
                    )}{' '}
                    will be saved as credit on {paymentModalInvoice.studentName}&apos;s account.
                  </p>
                )}
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
        <div className="print-modal-root fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="print-modal-sheet max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex flex-wrap items-center justify-end gap-2 no-print">
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
                onClick={() =>
                  void handleDownloadInvoicePdf(receiptInvoice, selectedReceiptPaymentId)
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
              >
                <Download className="h-3.5 w-3.5" />
                Download PDF
              </button>
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

            <TenantDocumentHeader
              tenant={tenant}
              documentTitle="Official Fee Receipt"
              subtitle={`${tenant.academicYear} · ${receiptInvoice.term}`}
              rightMeta={[
                { label: 'Invoice', value: receiptInvoice.invoiceNumber },
                ...(receiptBreakdown.activePayment
                  ? [{ label: 'Receipt', value: receiptBreakdown.activePayment.receiptNumber }]
                  : []),
              ]}
              compact
            />

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
                  <div
                    key={p.id}
                    className={`flex items-center justify-between gap-2 px-3 py-2 text-xs ${
                      p.voided || p.isReversalEntry ? 'bg-rose-50/40 dark:bg-rose-950/20' : ''
                    }`}
                  >
                    <div>
                      <p className="font-mono font-medium text-slate-900 dark:text-slate-100">
                        {p.receiptNumber} · {p.method}
                        {p.voided && (
                          <span className="ml-2 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-900/50 dark:text-rose-300">
                            VOIDED
                          </span>
                        )}
                        {p.isReversalEntry && (
                          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
                            REVERSAL
                          </span>
                        )}
                      </p>
                      <p className="text-slate-500 dark:text-slate-400">
                        Ref: {p.reference} · {formatDateShort(p.paidAt)} · {p.recordedBy}
                      </p>
                      {p.voidReason && (
                        <p className="text-[11px] text-rose-600 dark:text-rose-400">
                          Reason: {p.voidReason}
                        </p>
                      )}
                      {(p.creditedExcess || 0) > 0 && (
                        <p className="text-[11px] text-blue-600 dark:text-blue-400">
                          Includes {formatCurrency(p.creditedExcess || 0, tenant.currency)} excess credited to student
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`font-mono font-semibold tabular-nums ${
                          p.amount < 0 || p.voided
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-emerald-700 dark:text-emerald-400'
                        }`}
                      >
                        {formatCurrency(p.amount, tenant.currency)}
                      </span>
                      {canManageFees && !p.voided && !p.isReversalEntry && p.amount > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setVoidPaymentReason('');
                            setVoidPaymentTarget({ invoice: receiptInvoice, payment: p });
                          }}
                          className="no-print rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                        >
                          Void
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Prominent Overall Fee Balance Summary */}
            <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3.5 sm:grid-cols-4 dark:border-slate-700 dark:bg-slate-800/70">
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
                  Waivers &amp; Credit Notes
                </span>
                <span className="font-mono text-sm font-semibold text-blue-700 tabular-nums dark:text-blue-400">
                  {formatCurrency(
                    (receiptInvoice.waiverTotal || 0) + (receiptInvoice.creditNotesTotal || 0),
                    tenant.currency
                  )}
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

            {/* Independent Votelines Appearing Alongside Fee (Excluded from Fee Total) */}
            {(() => {
              const receiptIndependent = getInvoiceIndependentVotelines(receiptInvoice);
              if (receiptIndependent.length === 0) return null;
              return (
                <div className="mt-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Independent Votelines (Alongside Fee · Excluded from Fee Total)
                    </h3>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      Does not alter Tuition / Fee Total
                    </span>
                  </div>
                  <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
                        <tr>
                          <th className="px-3 py-2">Independent Voteline</th>
                          <th className="px-3 py-2">Notes</th>
                          <th className="px-3 py-2 text-right">Charged</th>
                          <th className="px-3 py-2 text-right">Paid</th>
                          <th className="px-3 py-2 text-right">Balance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {receiptIndependent.map((ivl) => (
                          <tr key={ivl.id}>
                            <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">
                              {ivl.name}
                            </td>
                            <td className="px-3 py-2 text-slate-500 dark:text-slate-400">
                              {ivl.note || ivl.term}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                              {formatCurrency(ivl.amount, tenant.currency)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                              {formatCurrency(ivl.paidAmount, tenant.currency)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                              {formatCurrency(ivl.balance, tenant.currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}

            {tenant.mpesaConfig?.enabled && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">
                <span>
                  M-Pesa Paybill:{' '}
                  <strong className="font-mono text-slate-900 dark:text-slate-100">
                    {tenant.mpesaConfig.paybillNumber}
                  </strong>{' '}
                  ({tenant.mpesaConfig.accountName})
                </span>
                <span>
                  Account No:{' '}
                  <strong className="font-mono text-slate-900 dark:text-slate-100">
                    {receiptInvoice.studentCode}
                  </strong>
                </span>
              </div>
            )}
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Filter by Grade
                  </label>
                  <select
                    value={issueGradeFilter}
                    onChange={(e) => setIssueGradeFilter(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value="All">All Grades</option>
                    {gradeFilterOptions.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Filter by Stream
                  </label>
                  <select
                    value={issueStreamFilter}
                    onChange={(e) => setIssueStreamFilter(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value="All">All Streams</option>
                    {issueStreamOptions.map((sec) => (
                      <option key={sec} value={sec}>
                        Stream {sec}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Student ({filteredIssueStudents.length} matching)
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
                  {filteredIssueStudents.length === 0 ? (
                    <option value="">No students match selected Grade / Stream</option>
                  ) : (
                    filteredIssueStudents.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.fullName} ({s.studentCode} · {s.grade} · Stream {s.section})
                      </option>
                    ))
                  )}
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
                            placeholder={`e.g. Kindly clear before end-of-term exams via Paybill ${
                              tenant.mpesaConfig?.paybillNumber || '522522'
                            }.`}
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

      {/* Record Independent Voteline Payment Modal */}
      {ivlPayModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  Collect Independent Voteline
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {ivlPayModalItem.name} · {ivlPayModalItem.studentName} ({ivlPayModalItem.studentCode})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIvlPayModalItem(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleRecordIndependentPayment} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Payment Amount (Balance: {formatCurrency(ivlPayModalItem.balance, tenant.currency)})
                </label>
                <input
                  required
                  type="number"
                  min={1}
                  max={ivlPayModalItem.balance}
                  value={ivlPayForm.amount}
                  onChange={(e) => setIvlPayForm({ ...ivlPayForm, amount: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Payment Method
                  </label>
                  <select
                    value={ivlPayForm.method}
                    onChange={(e) =>
                      setIvlPayForm({ ...ivlPayForm, method: e.target.value as PaymentMethod })
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
                    value={ivlPayForm.paidAt}
                    onChange={(e) => setIvlPayForm({ ...ivlPayForm, paidAt: e.target.value })}
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
                  value={ivlPayForm.reference}
                  onChange={(e) => setIvlPayForm({ ...ivlPayForm, reference: e.target.value })}
                  placeholder="e.g. MPESA-TRN882 or CASH-102"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Settles this independent voteline only — core Tuition Fee Invoice Totals remain unchanged.
              </p>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIvlPayModalItem(null)}
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

      {shareStructureModal && (
        <PrintableFeeStructureModal
          tenant={tenant}
          structure={shareStructureModal}
          independentVotelines={independentVotelines}
          copiedStructureId={copiedStructureId}
          onClose={() => setShareStructureModal(null)}
          onExportExcel={handleExportStructureExcel}
          onCopyText={handleCopyFeeStructureText}
          buildWhatsAppHref={buildFeeStructureWhatsAppHref}
          onAddIndependentVoteline={(fs) => {
            setIvlScope('grade');
            setIvlGrade(fs.grade);
            setIvlTerm(fs.term);
            setShareStructureModal(null);
            setActiveTab('independent');
          }}
          onNotify={onNotify}
        />
      )}

      <FeeAdjustmentsModals
        currency={tenant.currency}
        tenant={tenant}
        students={students}
        saving={saving}
        voidPaymentTarget={voidPaymentTarget}
        voidPaymentReason={voidPaymentReason}
        setVoidPaymentReason={setVoidPaymentReason}
        onCloseVoidPayment={() => setVoidPaymentTarget(null)}
        onSubmitVoidPayment={handleVoidPaymentSubmit}
        creditNoteModalInvoice={creditNoteModalInvoice}
        creditNoteAmount={creditNoteAmount}
        setCreditNoteAmount={setCreditNoteAmount}
        creditNoteReason={creditNoteReason}
        setCreditNoteReason={setCreditNoteReason}
        onCloseCreditNote={() => setCreditNoteModalInvoice(null)}
        onSubmitCreditNote={handleCreateCreditNoteSubmit}
        waiverModalOpen={waiverModalOpen}
        waiverForm={waiverForm}
        setWaiverForm={setWaiverForm}
        onCloseWaiver={() => setWaiverModalOpen(false)}
        onSubmitWaiver={handleCreateWaiverSubmit}
        siblingModalOpen={siblingModalOpen}
        siblingForm={siblingForm}
        setSiblingForm={setSiblingForm}
        onCloseSibling={() => setSiblingModalOpen(false)}
        onSubmitSibling={handleSaveSiblingDiscountSubmit}
        carryForwardModalOpen={carryForwardModalOpen}
        carryForwardForm={carryForwardForm}
        setCarryForwardForm={setCarryForwardForm}
        onCloseCarryForward={() => setCarryForwardModalOpen(false)}
        onSubmitCarryForward={handleCarryForwardSubmit}
        ivlVoidTarget={ivlVoidTarget}
        ivlVoidReason={ivlVoidReason}
        setIvlVoidReason={setIvlVoidReason}
        onCloseIvlVoid={() => setIvlVoidTarget(null)}
        onSubmitIvlVoid={handleConfirmDeleteIndependentVoteline}
      />
    </div>
  );
}
