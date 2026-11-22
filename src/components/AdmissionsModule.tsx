import { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRightLeft,
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileSpreadsheet,
  GraduationCap,
  History,
  Link2,
  KeyRound,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { saasApi } from '../lib/api';
import { ParentLinksModal } from './ParentLinksModal';
import {
  getStreamsForGrade,
  KENYAN_CBC_GRADES,
  type PromotionAction,
  type PromotionPreviewRow,
  type Student,
  type StudentImportResult,
  type StudentStatus,
  type TenantWorkspaceData,
} from '../shared/types';

interface AdmissionsModuleProps {
  workspace: TenantWorkspaceData;
  onRefresh: () => Promise<void>;
  onNotify: (title: string, tone?: 'success' | 'error') => void;
}

interface EditableStreamItem {
  original: string | null;
  value: string;
}

interface EditableGradeRow {
  id: string;
  originalGrade: string | null;
  grade: string;
  streams: EditableStreamItem[];
  newStreamDraft: string;
}

const STATUS_BADGE_CLASS: Record<StudentStatus, string> = {
  Active: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900',
  'On Leave': 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
  Graduated: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900',
  Transferred: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
  Withdrawn: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900',
};

export function AdmissionsModule({ workspace, onRefresh, onNotify }: AdmissionsModuleProps) {
  const { tenant, students } = workspace;
  const academicTerms = workspace.academicTerms || [];
  const lifecycleAuditLogs = workspace.lifecycleAuditLogs || [];
  const archivedCount = workspace.archivedStudentsCount ?? 0;

  const availableGrades = useMemo(
    () => (tenant.grades.length > 0 ? tenant.grades : [...KENYAN_CBC_GRADES]),
    [tenant.grades]
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [gradeStreamFilter, setGradeStreamFilter] = useState<string>('All');
  const [yearFilter, setYearFilter] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | StudentStatus>('All');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showStreamsModal, setShowStreamsModal] = useState(false);
  const [saving, setSaving] = useState(false);

  const [gradeRows, setGradeRows] = useState<EditableGradeRow[]>([]);
  const [newGradeName, setNewGradeName] = useState('');
  const [newGradeStreamsText, setNewGradeStreamsText] = useState('A, B');

  const initialGrade = availableGrades[0] || 'Playgroup';
  const initialStreams = getStreamsForGrade(tenant, initialGrade);

  const [formState, setFormState] = useState({
    fullName: '',
    studentCode: '',
    upi: '',
    dateOfBirth: '2012-05-14',
    gender: 'Female' as 'Female' | 'Male' | 'Non-binary',
    grade: initialGrade,
    section: initialStreams[0] || 'A',
    guardianName: '',
    guardianEmail: '',
    guardianPhone: '+254 7',
    enrolledAt: new Date().toISOString().slice(0, 10),
  });

  // Student Edit / Lifecycle / Soft Delete / Portal State
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [editForm, setEditForm] = useState({
    fullName: '',
    studentCode: '',
    upi: '',
    dateOfBirth: '',
    gender: 'Female' as 'Female' | 'Male' | 'Non-binary',
    grade: initialGrade,
    section: 'A',
    guardianName: '',
    guardianEmail: '',
    guardianPhone: '',
    enrolledAt: '',
  });

  const [lifecycleStudent, setLifecycleStudent] = useState<Student | null>(null);
  const [lifecycleStatus, setLifecycleStatus] = useState<StudentStatus>('Transferred');
  const [lifecycleDate, setLifecycleDate] = useState(new Date().toISOString().slice(0, 10));
  const [lifecycleReason, setLifecycleReason] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<Student | null>(null);
  const [deleteReason, setDeleteReason] = useState('');

  const [issuedStudentPortalCreds, setIssuedStudentPortalCreds] = useState<{
    studentName: string;
    email: string;
    oneTimePassword?: string;
  } | null>(null);
  const [copiedStudentOtp, setCopiedStudentOtp] = useState(false);

  // Bulk CSV / Excel Import Modal State
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFileName, setImportFileName] = useState('');
  const [importFilePayload, setImportFilePayload] = useState<{
    csvText?: string;
    fileBase64?: string;
  } | null>(null);
  const [importPreview, setImportPreview] = useState<StudentImportResult | null>(null);
  const [importSkipInvalid, setImportSkipInvalid] = useState(false);
  const [importBusy, setImportBusy] = useState(false);

  // Year-End Promotion Wizard State
  const [showPromoModal, setShowPromoModal] = useState(false);
  const [promoGrade, setPromoGrade] = useState(availableGrades[0] || 'Grade 1');
  const [promoSection, setPromoSection] = useState('All');
  const [promoRows, setPromoRows] = useState<
    Array<
      PromotionPreviewRow & {
        action: PromotionAction;
        targetSection: string;
        reason: string;
      }
    >
  >([]);
  const [promoNextGrade, setPromoNextGrade] = useState<string | null>(null);
  const [promoCarryForward, setPromoCarryForward] = useState(false);
  const [promoToTerm, setPromoToTerm] = useState('');
  const [promoToTermId, setPromoToTermId] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);

  // Lifecycle Audit Trail Drawer/Modal
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [showParentLinks, setShowParentLinks] = useState(false);

  const modalGradeStreams = useMemo(
    () => getStreamsForGrade(tenant, formState.grade),
    [tenant, formState.grade]
  );

  const editGradeStreams = useMemo(
    () => getStreamsForGrade(tenant, editForm.grade),
    [tenant, editForm.grade]
  );

  // Unique Grade & Stream combinations using per-grade uneven streams
  const gradeStreamOptions = useMemo(() => {
    const options: Array<{ value: string; label: string }> = [];
    availableGrades.forEach((g) => {
      const streams = getStreamsForGrade(tenant, g);
      options.push({ value: `grade:${g}`, label: `${g} (All Streams)` });
      streams.forEach((sec) => {
        options.push({ value: `${g}::${sec}`, label: `${g} · Stream ${sec}` });
      });
    });
    return options;
  }, [availableGrades, tenant]);

  // Unique Enrollment Years for dropdown filter
  const enrollmentYears = useMemo(() => {
    const years = new Set<string>();
    students.forEach((stu) => {
      const yr = stu.enrolledAt?.slice(0, 4);
      if (yr && /^\d{4}$/.test(yr)) {
        years.add(yr);
      }
    });
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [students]);

  const statusCounts = useMemo(() => {
    const counts: Record<'All' | StudentStatus, number> = {
      All: students.length,
      Active: 0,
      'On Leave': 0,
      Graduated: 0,
      Transferred: 0,
      Withdrawn: 0,
    };
    students.forEach((s) => {
      counts[s.status] = (counts[s.status] || 0) + 1;
    });
    return counts;
  }, [students]);

  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return students.filter((stu) => {
      if (statusFilter !== 'All' && stu.status !== statusFilter) return false;

      if (gradeStreamFilter !== 'All') {
        if (gradeStreamFilter.startsWith('grade:')) {
          const g = gradeStreamFilter.slice(6);
          if (stu.grade !== g) return false;
        } else {
          const [g, sec] = gradeStreamFilter.split('::');
          if (stu.grade !== g || stu.section !== sec) return false;
        }
      }

      if (yearFilter !== 'All') {
        if (!stu.enrolledAt.startsWith(yearFilter)) return false;
      }

      if (!q) return true;
      return (
        stu.fullName.toLowerCase().includes(q) ||
        stu.studentCode.toLowerCase().includes(q) ||
        (stu.upi || '').toLowerCase().includes(q) ||
        stu.guardianName.toLowerCase().includes(q) ||
        stu.guardianPhone.toLowerCase().includes(q)
      );
    });
  }, [students, statusFilter, gradeStreamFilter, yearFilter, searchQuery]);

  function openGradesStreamsEditor() {
    const rows: EditableGradeRow[] = availableGrades.map((g, idx) => ({
      id: `grade-row-${idx}-${g}`,
      originalGrade: g,
      grade: g,
      streams: getStreamsForGrade(tenant, g).map((sec) => ({
        original: sec,
        value: sec,
      })),
      newStreamDraft: '',
    }));
    setGradeRows(rows);
    setNewGradeName('');
    setNewGradeStreamsText('A, B');
    setShowStreamsModal(true);
  }

  function handleCreateGradeRow() {
    const trimmedGrade = newGradeName.trim();
    if (!trimmedGrade) {
      onNotify('Enter a grade or class name first.', 'error');
      return;
    }
    if (gradeRows.some((r) => r.grade.trim().toLowerCase() === trimmedGrade.toLowerCase())) {
      onNotify(`Grade "${trimmedGrade}" already exists.`, 'error');
      return;
    }

    const parsedStreams = Array.from(
      new Set(
        newGradeStreamsText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      )
    );
    const streamsToUse = parsedStreams.length > 0 ? parsedStreams : ['A'];

    setGradeRows((prev) => [
      ...prev,
      {
        id: `grade-row-new-${Date.now()}`,
        originalGrade: null,
        grade: trimmedGrade,
        streams: streamsToUse.map((s) => ({ original: null, value: s })),
        newStreamDraft: '',
      },
    ]);
    setNewGradeName('');
  }

  function handleAddStreamToGrade(gradeRowId: string) {
    setGradeRows((prev) =>
      prev.map((row) => {
        if (row.id !== gradeRowId) return row;
        const candidate = row.newStreamDraft.trim();
        if (!candidate) return row;
        if (row.streams.some((st) => st.value.trim().toLowerCase() === candidate.toLowerCase())) {
          onNotify(`Stream "${candidate}" already exists in ${row.grade}.`, 'error');
          return row;
        }
        return {
          ...row,
          streams: [...row.streams, { original: null, value: candidate }],
          newStreamDraft: '',
        };
      })
    );
  }

  async function handleSaveGradesAndStreams(e: React.FormEvent) {
    e.preventDefault();
    if (gradeRows.length === 0) {
      onNotify('Keep at least one grade configured.', 'error');
      return;
    }

    const seenGrades = new Set<string>();
    const payloadConfigs: Array<{
      originalGrade?: string | null;
      grade: string;
      streams: string[];
      streamRenames?: Record<string, string>;
    }> = [];

    for (const row of gradeRows) {
      const gradeName = row.grade.trim();
      if (!gradeName) {
        onNotify('Grade names cannot be left blank.', 'error');
        return;
      }
      const key = gradeName.toLowerCase();
      if (seenGrades.has(key)) {
        onNotify(`Duplicate grade name "${gradeName}".`, 'error');
        return;
      }
      seenGrades.add(key);

      const cleanedStreams = row.streams.map((s) => s.value.trim()).filter(Boolean);
      if (cleanedStreams.length === 0) {
        onNotify(`Add at least one stream for ${gradeName}.`, 'error');
        return;
      }
      const uniqueStreams = Array.from(new Set(cleanedStreams));
      if (uniqueStreams.length !== cleanedStreams.length) {
        onNotify(`Stream names inside ${gradeName} must be unique.`, 'error');
        return;
      }

      const streamRenames: Record<string, string> = {};
      row.streams.forEach((st) => {
        const nextVal = st.value.trim();
        if (st.original && nextVal && st.original !== nextVal) {
          streamRenames[st.original] = nextVal;
        }
      });

      payloadConfigs.push({
        originalGrade: row.originalGrade,
        grade: gradeName,
        streams: uniqueStreams,
        streamRenames,
      });
    }

    setSaving(true);
    try {
      const { tenant: updatedTenant } = await saasApi.updateStreams(tenant.id, {
        gradeConfigs: payloadConfigs,
      });
      await onRefresh();
      setGradeStreamFilter('All');
      const nextDefaultGrade = updatedTenant.grades.includes(formState.grade)
        ? formState.grade
        : updatedTenant.grades[0] || 'Playgroup';
      const nextStreams = getStreamsForGrade(updatedTenant, nextDefaultGrade);
      setFormState((prev) => ({
        ...prev,
        grade: nextDefaultGrade,
        section: nextStreams.includes(prev.section) ? prev.section : nextStreams[0] || 'A',
      }));
      setShowStreamsModal(false);
      onNotify(`Saved ${updatedTenant.grades.length} grades and their stream assignments.`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to update grades & streams',
        'error'
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleEnrollStudent(e: React.FormEvent) {
    e.preventDefault();
    if (!formState.fullName.trim() || !formState.guardianName.trim() || !formState.guardianPhone.trim()) {
      onNotify('Student name, guardian name, and phone number are required.', 'error');
      return;
    }
    setSaving(true);
    try {
      const { student } = await saasApi.enrollStudent(tenant.id, formState);
      await onRefresh();
      setShowCreateModal(false);
      const resetGrade = availableGrades[0] || 'Playgroup';
      const resetStreams = getStreamsForGrade(tenant, resetGrade);
      setFormState({
        fullName: '',
        studentCode: '',
        upi: '',
        dateOfBirth: '2012-05-14',
        gender: 'Female',
        grade: resetGrade,
        section: resetStreams[0] || 'A',
        guardianName: '',
        guardianEmail: '',
        guardianPhone: '+254 7',
        enrolledAt: new Date().toISOString().slice(0, 10),
      });
      onNotify(`${student.fullName} enrolled (${student.studentCode} · UPI ${student.upi}).`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to enroll student', 'error');
    } finally {
      setSaving(false);
    }
  }

  function openEditStudentModal(stu: Student) {
    setEditingStudent(stu);
    setEditForm({
      fullName: stu.fullName,
      studentCode: stu.studentCode,
      upi: stu.upi,
      dateOfBirth: stu.dateOfBirth,
      gender: stu.gender,
      grade: stu.grade,
      section: stu.section,
      guardianName: stu.guardianName,
      guardianEmail: stu.guardianEmail || '',
      guardianPhone: stu.guardianPhone,
      enrolledAt: stu.enrolledAt,
    });
  }

  async function handleSaveStudentEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingStudent) return;
    setSaving(true);
    try {
      const { student } = await saasApi.updateStudentDetails(tenant.id, editingStudent.id, editForm);
      await onRefresh();
      setEditingStudent(null);
      onNotify(`Updated learner details for ${student.fullName}.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to update student.', 'error');
    } finally {
      setSaving(false);
    }
  }

  function openLifecycleModal(stu: Student) {
    setLifecycleStudent(stu);
    setLifecycleStatus(
      stu.status === 'Active' || stu.status === 'On Leave' ? 'Transferred' : 'Active'
    );
    setLifecycleDate(new Date().toISOString().slice(0, 10));
    setLifecycleReason('');
  }

  async function handleConfirmLifecycleChange(e: React.FormEvent) {
    e.preventDefault();
    if (!lifecycleStudent) return;
    setSaving(true);
    try {
      const { student } = await saasApi.transitionStudentStatus(tenant.id, lifecycleStudent.id, {
        status: lifecycleStatus,
        statusDate: lifecycleDate,
        reason: lifecycleReason,
      });
      await onRefresh();
      setLifecycleStudent(null);
      onNotify(`${student.fullName} marked as ${student.status}.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to update student status.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmSoftDelete(e: React.FormEvent) {
    e.preventDefault();
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await saasApi.softDeleteStudent(tenant.id, deleteTarget.id, deleteReason);
      await onRefresh();
      onNotify(
        `${deleteTarget.fullName} archived (soft-deleted). Audit trail and financial/exam history preserved.`
      );
      setDeleteTarget(null);
      setDeleteReason('');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to archive student.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleIssueStudentPortalLogin(stu: Student) {
    setSaving(true);
    setCopiedStudentOtp(false);
    try {
      const res = await saasApi.provisionStudentPortalAccount(tenant.id, stu.id, {
        resetOneTimePassword: Boolean(stu.studentUserId),
      });
      await onRefresh();
      setIssuedStudentPortalCreds({
        studentName: stu.fullName,
        email: res.user.email,
        oneTimePassword: res.oneTimePassword,
      });
      onNotify(`Student portal login ready for ${stu.fullName}.`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Unable to provision student portal account.',
        'error'
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleCopyStudentOtp(val: string) {
    try {
      await navigator.clipboard?.writeText(val);
      setCopiedStudentOtp(true);
      onNotify('Copied student 1-time password.');
      setTimeout(() => setCopiedStudentOtp(false), 2500);
    } catch {
      onNotify('Copy the generated 1-time password manually.', 'error');
    }
  }

  // Bulk CSV/Excel Import Handlers
  function handleDownloadCsvTemplate() {
    const sampleGrade = availableGrades[0] || 'Grade 6';
    const sampleStream = getStreamsForGrade(tenant, sampleGrade)[0] || 'A';
    const csv = [
      'fullName,grade,section,gender,dateOfBirth,studentCode,upi,guardianName,guardianPhone,guardianEmail',
      `Faith Wambui,${sampleGrade},${sampleStream},Female,2014-03-12,,,Peter Kamau,+254712345678,peter.kamau@example.com`,
      `Brian Kiprop,${sampleGrade},${sampleStream},Male,2014-07-22,,,Grace Chebet,0722987654,grace.chebet@example.com`,
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${tenant.slug || 'school'}-students-template.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function handleImportFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    setImportPreview(null);
    setImportBusy(true);
    try {
      const isCsv = file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv';
      let payload: { csvText?: string; fileBase64?: string };
      if (isCsv) {
        const csvText = await file.text();
        payload = { csvText };
      } else {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i += 1) {
          binary += String.fromCharCode(bytes[i]);
        }
        payload = { fileBase64: btoa(binary) };
      }
      setImportFilePayload(payload);
      const preview = await saasApi.importStudentsBulk(tenant.id, {
        ...payload,
        fileName: file.name,
        dryRun: true,
      });
      setImportPreview(preview);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to parse uploaded file.', 'error');
    } finally {
      setImportBusy(false);
    }
  }

  async function handleCommitImport() {
    if (!importFilePayload) return;
    setImportBusy(true);
    try {
      const res = await saasApi.importStudentsBulk(tenant.id, {
        ...importFilePayload,
        fileName: importFileName,
        dryRun: false,
        skipInvalid: importSkipInvalid,
      });
      await onRefresh();
      setShowImportModal(false);
      setImportFileName('');
      setImportFilePayload(null);
      setImportPreview(null);
      onNotify(`Imported ${res.importedCount} student(s) successfully.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Bulk import failed.', 'error');
    } finally {
      setImportBusy(false);
    }
  }

  // Year-End Promotion Wizard Handlers
  async function loadPromotionPreview(gradeToLoad: string, sectionToLoad: string) {
    setPromoLoading(true);
    try {
      const preview = await saasApi.previewYearEndPromotion(tenant.id, {
        grade: gradeToLoad,
        section: sectionToLoad === 'All' ? undefined : sectionToLoad,
      });
      setPromoNextGrade(preview.nextGrade);
      setPromoRows(
        preview.rows.map((r) => ({
          ...r,
          action: r.defaultAction,
          targetSection: r.currentSection,
          reason: '',
        }))
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to load promotion preview.', 'error');
    } finally {
      setPromoLoading(false);
    }
  }

  function openPromotionWizard() {
    const startGrade = availableGrades[0] || 'Grade 1';
    setPromoGrade(startGrade);
    setPromoSection('All');
    const openOtherTerms = academicTerms.filter(
      (t) => t.status === 'Open' && t.name.toLowerCase() !== tenant.currentTerm.toLowerCase()
    );
    const defaultTarget = openOtherTerms[0];
    setPromoToTermId(defaultTarget?.id || '');
    setPromoToTerm(defaultTarget?.name || '');
    setPromoCarryForward(false);
    setShowPromoModal(true);
    loadPromotionPreview(startGrade, 'All');
  }

  async function handleExecutePromotions(e: React.FormEvent) {
    e.preventDefault();
    if (promoRows.length === 0) return;
    setPromoLoading(true);
    try {
      const res = await saasApi.executeYearEndPromotion(tenant.id, {
        fromGrade: promoGrade,
        items: promoRows.map((r) => ({
          studentId: r.studentId,
          action: r.action,
          targetSection: r.targetSection,
          reason: r.reason || undefined,
        })),
        carryForwardFees: promoCarryForward,
        fromTerm: tenant.currentTerm,
        toTerm: promoToTerm || undefined,
        toTermId: promoToTermId || undefined,
      });
      await onRefresh();
      setShowPromoModal(false);
      onNotify(
        `Promotion complete: ${res.promotedCount} promoted, ${res.heldBackCount} held back, ${res.graduatedCount} graduated.`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Promotion execution failed.', 'error');
    } finally {
      setPromoLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Student Admission &amp; Lifecycle
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Kenyan CBC student registry with Admin No., UPI, bulk CSV/Excel import, transfers/graduation, year-end promotion &amp; audit trail.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowParentLinks(true)}
            className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Link2 className="h-3.5 w-3.5" />
            Parent Links
          </button>
          <button
            type="button"
            onClick={() => setShowAuditModal(true)}
            className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <History className="h-3.5 w-3.5" />
            Lifecycle Audit ({lifecycleAuditLogs.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setImportPreview(null);
              setImportFileName('');
              setImportFilePayload(null);
              setShowImportModal(true);
            }}
            className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Upload className="h-3.5 w-3.5" />
            Bulk Import CSV/Excel
          </button>
          <button
            type="button"
            onClick={openPromotionWizard}
            className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <GraduationCap className="h-3.5 w-3.5" />
            Promotion Wizard
          </button>
          <button
            type="button"
            onClick={openGradesStreamsEditor}
            className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Grades &amp; Streams
          </button>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-blue-600"
          >
            <Plus className="h-4 w-4" />
            New Enrollment
          </button>
        </div>
      </div>

      {/* Issued Student Portal Credentials Banner */}
      {issuedStudentPortalCreds && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50/70 p-4 text-xs dark:border-emerald-800 dark:bg-emerald-950/30">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold text-emerald-950 dark:text-emerald-200">
              Student Portal Account Ready — {issuedStudentPortalCreds.studentName}
            </div>
            <button
              type="button"
              onClick={() => setIssuedStudentPortalCreds(null)}
              className="text-[11px] font-medium text-emerald-800 hover:underline dark:text-emerald-300"
            >
              Dismiss
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="font-mono text-slate-800 dark:text-slate-200">
              {issuedStudentPortalCreds.email}
            </span>
            {issuedStudentPortalCreds.oneTimePassword ? (
              <>
                <span className="text-slate-400">·</span>
                <span className="rounded border border-emerald-300 bg-white px-2 py-0.5 font-mono font-bold text-emerald-700 dark:border-emerald-700 dark:bg-slate-900 dark:text-emerald-300">
                  {issuedStudentPortalCreds.oneTimePassword}
                </span>
                <button
                  type="button"
                  onClick={() => handleCopyStudentOtp(issuedStudentPortalCreds.oneTimePassword!)}
                  className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  {copiedStudentOtp ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copiedStudentOtp ? 'Copied' : 'Copy OTP'}
                </button>
              </>
            ) : (
              <span className="text-slate-600 dark:text-slate-300">
                (Account already active — click Portal button again to reset OTP)
              </span>
            )}
          </div>
        </div>
      )}

      {/* Status Filter Tabs & Filter Toolbar */}
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-1.5">
            {(['All', 'Active', 'Graduated', 'Transferred', 'Withdrawn'] as const).map((tab) => {
              const active = statusFilter === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setStatusFilter(tab)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                    active
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                  }`}
                >
                  {tab} ({statusCounts[tab] || 0})
                </button>
              );
            })}
          </div>
          {archivedCount > 0 && (
            <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
              {archivedCount} soft-deleted learner record(s) retained for audit
            </span>
          )}
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Admin No., UPI, name, phone..."
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label
                htmlFor="grade-stream-filter"
                className="whitespace-nowrap text-xs font-medium text-slate-500 dark:text-slate-400"
              >
                Grade &amp; Stream
              </label>
              <select
                id="grade-stream-filter"
                value={gradeStreamFilter}
                onChange={(e) => setGradeStreamFilter(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="All">All Grades &amp; Streams</option>
                {gradeStreamOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label
                htmlFor="enrollment-year-filter"
                className="whitespace-nowrap text-xs font-medium text-slate-500 dark:text-slate-400"
              >
                Enrollment Year
              </label>
              <select
                id="enrollment-year-filter"
                value={yearFilter}
                onChange={(e) => setYearFilter(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-800 tabular-nums focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="All">All Years</option>
                {enrollmentYears.map((yr) => (
                  <option key={yr} value={yr}>
                    {yr}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Student Directory */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-2 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Enrolled Students Roster
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              Showing {filteredStudents.length} of {students.length} students · {statusCounts.Active} Active /{' '}
              {tenant.learnerCap || 400} Learner Cap
            </p>
          </div>
          <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
            Student Portal: {tenant.studentPortalEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Admin No. / UPI</th>
                <th className="px-4 py-3">Learner Name</th>
                <th className="px-4 py-3">Grade &amp; Stream</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Guardian Contact</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredStudents.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                    No students match the selected filters.
                  </td>
                </tr>
              ) : (
                filteredStudents.map((stu) => (
                  <tr key={stu.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs font-semibold text-slate-800 tabular-nums dark:text-slate-200">
                        {stu.studentCode}
                      </div>
                      <div className="font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                        {stu.upi}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {stu.fullName}
                      </div>
                      <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                        DOB {stu.dateOfBirth} · Enrolled {stu.enrolledAt}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                      {stu.grade} · Stream {stu.section}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded border px-2 py-0.5 text-[11px] font-semibold ${
                          STATUS_BADGE_CLASS[stu.status]
                        }`}
                      >
                        {stu.status}
                      </span>
                      {stu.statusReason && (
                        <div className="mt-0.5 max-w-[180px] truncate text-[11px] text-slate-500 dark:text-slate-400" title={stu.statusReason}>
                          {stu.statusDate ? `${stu.statusDate} · ` : ''}
                          {stu.statusReason}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700 dark:text-slate-300">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {stu.guardianName}
                      </div>
                      <div className="font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                        {stu.guardianPhone}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex flex-wrap items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEditStudentModal(stu)}
                          title="Edit student details"
                          className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <Pencil className="h-3 w-3" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => openLifecycleModal(stu)}
                          title="Transfer, Withdraw, Graduate, or Reactivate"
                          className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <ArrowRightLeft className="h-3 w-3" />
                          Status
                        </button>
                        {tenant.studentPortalEnabled &&
                          stu.status !== 'Transferred' &&
                          stu.status !== 'Withdrawn' && (
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => handleIssueStudentPortalLogin(stu)}
                              title="Issue or reset Student Portal OTP"
                              className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300"
                            >
                              <KeyRound className="h-3 w-3" />
                              {stu.studentUserId ? 'Reset Portal' : 'Portal Login'}
                            </button>
                          )}
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteTarget(stu);
                            setDeleteReason('');
                          }}
                          title="Soft-delete / Archive student"
                          className="inline-flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Edit Student Details Modal */}
      {editingStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                Edit Student — {editingStudent.studentCode}
              </h2>
              <button
                type="button"
                onClick={() => setEditingStudent(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSaveStudentEdit} className="mt-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Full Name
                </label>
                <input
                  required
                  type="text"
                  value={editForm.fullName}
                  onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Admin No.
                </label>
                <input
                  required
                  type="text"
                  value={editForm.studentCode}
                  onChange={(e) => setEditForm({ ...editForm, studentCode: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  NEMIS / UPI
                </label>
                <input
                  required
                  type="text"
                  value={editForm.upi}
                  onChange={(e) => setEditForm({ ...editForm, upi: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Date of Birth
                </label>
                <input
                  required
                  type="date"
                  value={editForm.dateOfBirth}
                  onChange={(e) => setEditForm({ ...editForm, dateOfBirth: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Grade &amp; Stream
                </label>
                <div className="mt-1 flex gap-2">
                  <select
                    value={editForm.grade}
                    onChange={(e) => {
                      const nextGrade = e.target.value;
                      const nextStreams = getStreamsForGrade(tenant, nextGrade);
                      setEditForm({
                        ...editForm,
                        grade: nextGrade,
                        section: nextStreams.includes(editForm.section)
                          ? editForm.section
                          : nextStreams[0] || 'A',
                      });
                    }}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {availableGrades.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                  <select
                    value={editForm.section}
                    onChange={(e) => setEditForm({ ...editForm, section: e.target.value })}
                    className="w-28 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {(editGradeStreams.includes(editForm.section)
                      ? editGradeStreams
                      : [editForm.section, ...editGradeStreams]
                    ).map((sec) => (
                      <option key={sec} value={sec}>
                        {sec}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Guardian Name
                </label>
                <input
                  required
                  type="text"
                  value={editForm.guardianName}
                  onChange={(e) => setEditForm({ ...editForm, guardianName: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Guardian Phone
                </label>
                <input
                  required
                  type="tel"
                  value={editForm.guardianPhone}
                  onChange={(e) => setEditForm({ ...editForm, guardianPhone: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Guardian Email (Parent Portal Match)
                </label>
                <input
                  type="email"
                  value={editForm.guardianEmail}
                  onChange={(e) => setEditForm({ ...editForm, guardianEmail: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Gender
                </label>
                <select
                  value={editForm.gender}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      gender: e.target.value as 'Female' | 'Male' | 'Non-binary',
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="Female">Female</option>
                  <option value="Male">Male</option>
                  <option value="Non-binary">Non-binary</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2 sm:col-span-2">
                <button
                  type="button"
                  onClick={() => setEditingStudent(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Lifecycle Transition Modal (Transfer / Withdraw / Graduate / Reactivate) */}
      {lifecycleStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Lifecycle Transition — {lifecycleStudent.fullName}
              </h2>
              <button
                type="button"
                onClick={() => setLifecycleStudent(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Current status: <strong>{lifecycleStudent.status}</strong> · {lifecycleStudent.grade} {lifecycleStudent.section}
            </p>
            <form onSubmit={handleConfirmLifecycleChange} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  New Lifecycle Status
                </label>
                <select
                  value={lifecycleStatus}
                  onChange={(e) => setLifecycleStatus(e.target.value as StudentStatus)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="Transferred">Transferred Out</option>
                  <option value="Withdrawn">Withdrawn</option>
                  <option value="Graduated">Graduated</option>
                  <option value="On Leave">On Leave</option>
                  <option value="Active">Reactivate (Active)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Effective Date
                </label>
                <input
                  required
                  type="date"
                  value={lifecycleDate}
                  onChange={(e) => setLifecycleDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Reason / Destination School{' '}
                  {['Transferred', 'Withdrawn', 'Graduated'].includes(lifecycleStatus)
                    ? '(Required)'
                    : '(Optional)'}
                </label>
                <textarea
                  rows={2}
                  required={['Transferred', 'Withdrawn', 'Graduated'].includes(lifecycleStatus)}
                  value={lifecycleReason}
                  onChange={(e) => setLifecycleReason(e.target.value)}
                  placeholder="e.g. Transferred to Alliance High School — clearance issued"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setLifecycleStudent(null)}
                  className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? 'Updating...' : 'Apply Status'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Soft Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-red-700 dark:text-red-400">
                Archive / Soft Delete Learner
              </h2>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              Archiving <strong>{deleteTarget.fullName}</strong> ({deleteTarget.studentCode}) removes them from active class rosters and frees a learner seat. Historical invoices, fee receipts, exam marks, and attendance logs remain intact for audit compliance.
            </p>
            <form onSubmit={handleConfirmSoftDelete} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Audit Reason (Required)
                </label>
                <textarea
                  required
                  minLength={3}
                  rows={2}
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  placeholder="e.g. Duplicate test registration entry"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDeleteTarget(null)}
                  className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || deleteReason.trim().length < 3}
                  className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {saving ? 'Archiving...' : 'Confirm Soft Delete'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk CSV / Excel Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <div>
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    Bulk Student Import (CSV / Excel)
                  </h2>
                </div>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Dry-run validation verifies Kenyan phone numbers, grade/DOB fit, duplicate codes/UPIs, and tenant learner cap before enrolling.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-950/40">
                <div>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900">
                    <Upload className="h-3.5 w-3.5" />
                    Choose CSV or Excel (.xlsx)
                    <input
                      type="file"
                      accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                      onChange={handleImportFileSelected}
                      className="hidden"
                    />
                  </label>
                  {importFileName && (
                    <span className="ml-3 font-mono text-xs text-slate-700 dark:text-slate-300">
                      {importFileName}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleDownloadCsvTemplate}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download CSV Template
                </button>
              </div>

              {importBusy && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                  Running dry-run validation &amp; learner cap check...
                </div>
              )}

              {importPreview && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                      <div className="text-[11px] text-slate-500">Total Rows</div>
                      <div className="font-mono text-lg font-bold text-slate-900 dark:text-slate-100">
                        {importPreview.totalRows}
                      </div>
                    </div>
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/20">
                      <div className="text-[11px] text-emerald-700 dark:text-emerald-300">Valid Rows</div>
                      <div className="font-mono text-lg font-bold text-emerald-700 dark:text-emerald-300">
                        {importPreview.validCount}
                      </div>
                    </div>
                    <div className="rounded-lg border border-red-200 bg-red-50/40 p-3 dark:border-red-900/60 dark:bg-red-950/20">
                      <div className="text-[11px] text-red-700 dark:text-red-300">Row Errors</div>
                      <div className="font-mono text-lg font-bold text-red-700 dark:text-red-300">
                        {importPreview.errorCount}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                      <div className="text-[11px] text-slate-500">Cap Remaining</div>
                      <div
                        className={`font-mono text-lg font-bold ${
                          importPreview.capExceeded
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {importPreview.remainingCapacity} / {importPreview.learnerCap}
                      </div>
                    </div>
                  </div>

                  {importPreview.capExceeded && (
                    <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <span>
                        Learner cap exceeded: importing {importPreview.validCount} learner(s) requires more than {importPreview.remainingCapacity} remaining seat(s).
                      </span>
                    </div>
                  )}

                  <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                        <tr>
                          <th className="px-3 py-2">#</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Full Name</th>
                          <th className="px-3 py-2">Grade / Stream</th>
                          <th className="px-3 py-2">Guardian Phone</th>
                          <th className="px-3 py-2">Validation Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {importPreview.rows.slice(0, 100).map((row) => (
                          <tr key={row.rowNumber}>
                            <td className="px-3 py-2 font-mono">{row.rowNumber}</td>
                            <td className="px-3 py-2">
                              {row.valid ? (
                                <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-300">
                                  <CheckCircle2 className="h-3.5 w-3.5" /> Valid
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 font-semibold text-red-600 dark:text-red-400">
                                  <AlertCircle className="h-3.5 w-3.5" /> Error
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">
                              {row.normalized?.fullName || row.raw.fullName || row.raw['Full Name'] || '—'}
                            </td>
                            <td className="px-3 py-2">
                              {row.normalized
                                ? `${row.normalized.grade} ${row.normalized.section}`
                                : row.raw.grade || row.raw.Grade || '—'}
                            </td>
                            <td className="px-3 py-2 font-mono">
                              {row.normalized?.guardianPhone || row.raw.guardianPhone || '—'}
                            </td>
                            <td className="px-3 py-2 text-red-600 dark:text-red-400">
                              {row.errors.length > 0 ? row.errors.join(' · ') : 'Ready'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {importPreview.errorCount > 0 && importPreview.validCount > 0 && (
                    <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={importSkipInvalid}
                        onChange={(e) => setImportSkipInvalid(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                      />
                      Skip {importPreview.errorCount} invalid row(s) and enroll the {importPreview.validCount} valid row(s)
                    </label>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
              >
                Close
              </button>
              <button
                type="button"
                disabled={
                  importBusy ||
                  !importPreview ||
                  importPreview.validCount === 0 ||
                  importPreview.capExceeded ||
                  (importPreview.errorCount > 0 && !importSkipInvalid)
                }
                onClick={handleCommitImport}
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {importBusy
                  ? 'Importing...'
                  : `Confirm Import (${importPreview?.validCount || 0} Learners)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Year-End Promotion Wizard Modal */}
      {showPromoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  Year-End Student Promotion Wizard
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Select a class cohort, review individual Promote / Hold Back / Graduate decisions, and optionally carry arrears &amp; credit balances forward.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPromoModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleExecutePromotions} className="flex min-h-0 flex-1 flex-col">
              <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 bg-slate-50/70 px-6 py-3.5 dark:border-slate-800 dark:bg-slate-950/40">
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    Source Grade
                  </label>
                  <select
                    value={promoGrade}
                    onChange={(e) => {
                      const g = e.target.value;
                      setPromoGrade(g);
                      setPromoSection('All');
                      loadPromotionPreview(g, 'All');
                    }}
                    className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    {availableGrades.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    Stream Filter
                  </label>
                  <select
                    value={promoSection}
                    onChange={(e) => {
                      const sec = e.target.value;
                      setPromoSection(sec);
                      loadPromotionPreview(promoGrade, sec);
                    }}
                    className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="All">All Streams</option>
                    {getStreamsForGrade(tenant, promoGrade).map((s) => (
                      <option key={s} value={s}>
                        Stream {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="ml-auto text-xs text-slate-600 dark:text-slate-300">
                  Target Transition:{' '}
                  <strong className="font-semibold text-blue-600 dark:text-blue-400">
                    {promoNextGrade || 'Final Cohort (Graduate)'}
                  </strong>
                </div>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
                {promoLoading && promoRows.length === 0 ? (
                  <p className="py-8 text-center text-xs text-slate-500">Loading class roster...</p>
                ) : promoRows.length === 0 ? (
                  <p className="py-8 text-center text-xs text-slate-500">
                    No active learners found in {promoGrade} ({promoSection}).
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                        <tr>
                          <th className="px-3 py-2">Student</th>
                          <th className="px-3 py-2">Current Class</th>
                          <th className="px-3 py-2">Action</th>
                          <th className="px-3 py-2">Target Stream</th>
                          <th className="px-3 py-2 text-right">Fee Arrears</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {promoRows.map((row) => {
                          const targetGradeForStreams =
                            row.action === 'Promote' && promoNextGrade
                              ? promoNextGrade
                              : row.currentGrade;
                          const targetStreams = getStreamsForGrade(tenant, targetGradeForStreams);
                          return (
                            <tr key={row.studentId}>
                              <td className="px-3 py-2">
                                <div className="font-medium text-slate-900 dark:text-slate-100">
                                  {row.fullName}
                                </div>
                                <div className="font-mono text-[11px] text-slate-500">
                                  {row.studentCode}
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                {row.currentGrade} · {row.currentSection}
                              </td>
                              <td className="px-3 py-2">
                                <select
                                  value={row.action}
                                  onChange={(e) => {
                                    const val = e.target.value as PromotionAction;
                                    setPromoRows((prev) =>
                                      prev.map((item) =>
                                        item.studentId === row.studentId
                                          ? { ...item, action: val }
                                          : item
                                      )
                                    );
                                  }}
                                  className="rounded border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                >
                                  {promoNextGrade && <option value="Promote">Promote → {promoNextGrade}</option>}
                                  <option value="Hold Back">Hold Back ({row.currentGrade})</option>
                                  <option value="Graduate">Graduate</option>
                                </select>
                              </td>
                              <td className="px-3 py-2">
                                {row.action !== 'Graduate' ? (
                                  <select
                                    value={row.targetSection}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setPromoRows((prev) =>
                                        prev.map((item) =>
                                          item.studentId === row.studentId
                                            ? { ...item, targetSection: val }
                                            : item
                                        )
                                      );
                                    }}
                                    className="rounded border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                  >
                                    {(targetStreams.includes(row.targetSection)
                                      ? targetStreams
                                      : [row.targetSection, ...targetStreams]
                                    ).map((s) => (
                                      <option key={s} value={s}>
                                        Stream {s}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <span className="text-slate-400">Alumni</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right font-mono tabular-nums">
                                {row.outstandingFeeBalance > 0
                                  ? `${tenant.currency} ${row.outstandingFeeBalance.toLocaleString()}`
                                  : 'Cleared'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-950/40">
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                    <input
                      type="checkbox"
                      checked={promoCarryForward}
                      onChange={(e) => setPromoCarryForward(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                    />
                    Carry unpaid fee balances &amp; credit balances forward to new term invoice
                  </label>
                  {promoCarryForward && (
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                          Target Open Term
                        </label>
                        <select
                          value={promoToTermId}
                          onChange={(e) => {
                            const tid = e.target.value;
                            setPromoToTermId(tid);
                            const matched = academicTerms.find((t) => t.id === tid);
                            if (matched) setPromoToTerm(matched.name);
                          }}
                          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        >
                          <option value="">-- Enter custom term name --</option>
                          {academicTerms
                            .filter((t) => t.status === 'Open')
                            .map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name} ({t.startDate})
                              </option>
                            ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                          Target Term Name
                        </label>
                        <input
                          type="text"
                          required
                          value={promoToTerm}
                          onChange={(e) => {
                            setPromoToTerm(e.target.value);
                            setPromoToTermId('');
                          }}
                          placeholder="e.g. Term 1 2027"
                          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4 dark:border-slate-800">
                <span className="text-xs text-slate-500 tabular-nums">
                  {promoRows.length} learner(s) staged
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowPromoModal(false)}
                    className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={promoLoading || promoRows.length === 0}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {promoLoading ? 'Processing...' : 'Execute Promotions'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Lifecycle Audit Trail Modal */}
      {showParentLinks && (
        <ParentLinksModal
          workspace={workspace}
          onClose={() => setShowParentLinks(false)}
          onRefresh={onRefresh}
          onNotify={onNotify}
        />
      )}

      {showAuditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Student Lifecycle &amp; Calendar Audit Trail
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowAuditModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 divide-y divide-slate-100 overflow-y-auto px-6 py-3 dark:divide-slate-800">
              {lifecycleAuditLogs.length === 0 ? (
                <p className="py-10 text-center text-xs text-slate-500">
                  No student lifecycle or calendar audit entries recorded yet.
                </p>
              ) : (
                lifecycleAuditLogs.map((log) => (
                  <div key={log.id} className="py-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono font-semibold text-blue-700 dark:text-blue-300">
                        {log.action}
                      </span>
                      <span className="font-mono text-[11px] text-slate-500">
                        {log.timestamp.slice(0, 19).replace('T', ' ')} · {log.who} ({log.role})
                      </span>
                    </div>
                    <p className="mt-1 text-slate-800 dark:text-slate-200">{log.summary}</p>
                    {log.reason && (
                      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        Reason: {log.reason}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Customize Grades & Uneven Streams Modal */}
      {showStreamsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  Customize Grades &amp; Per-Class Streams
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Create, rename, or remove grades and assign independent streams per class (e.g. Playgroup: 1 stream, Grade 9: 3 streams).
                </p>
              </div>
              <button
                onClick={() => setShowStreamsModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveGradesAndStreams} className="flex min-h-0 flex-1 flex-col">
              {/* Add New Grade Bar */}
              <div className="border-b border-slate-100 bg-slate-50/70 px-6 py-3.5 dark:border-slate-800 dark:bg-slate-900/50">
                <p className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Create New Grade / Class
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={newGradeName}
                    onChange={(e) => setNewGradeName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCreateGradeRow();
                      }
                    }}
                    placeholder="Grade name (e.g. Daycare, Form 4, Grade 13)"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                  <input
                    type="text"
                    value={newGradeStreamsText}
                    onChange={(e) => setNewGradeStreamsText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCreateGradeRow();
                      }
                    }}
                    placeholder="Initial streams (e.g. East, West)"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none sm:w-56 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={handleCreateGradeRow}
                    className="inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Grade
                  </button>
                </div>
              </div>

              {/* Per-Grade Rows */}
              <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
                {gradeRows.map((row) => (
                  <div
                    key={row.id}
                    className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-1 items-center gap-2">
                        <input
                          type="text"
                          required
                          value={row.grade}
                          onChange={(e) =>
                            setGradeRows((prev) =>
                              prev.map((item) =>
                                item.id === row.id ? { ...item, grade: e.target.value } : item
                              )
                            )
                          }
                          aria-label="Grade name"
                          className="w-full max-w-xs rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        />
                        <span className="font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
                          {row.streams.length} {row.streams.length === 1 ? 'stream' : 'streams'}
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={gradeRows.length <= 1}
                        onClick={() =>
                          setGradeRows((prev) => prev.filter((item) => item.id !== row.id))
                        }
                        className="inline-flex items-center gap-1 self-start text-xs font-medium text-slate-500 hover:text-red-600 disabled:opacity-30 sm:self-auto dark:text-slate-400 dark:hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove Grade
                      </button>
                    </div>

                    {/* Streams list for this specific grade */}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {row.streams.map((st, sIdx) => (
                        <div
                          key={sIdx}
                          className="flex items-center rounded-lg border border-slate-200 bg-slate-50/70 pl-2.5 pr-1 py-1 dark:border-slate-700 dark:bg-slate-800"
                        >
                          <input
                            type="text"
                            required
                            value={st.value}
                            onChange={(e) =>
                              setGradeRows((prev) =>
                                prev.map((item) =>
                                  item.id === row.id
                                    ? {
                                        ...item,
                                        streams: item.streams.map((sItem, i) =>
                                          i === sIdx ? { ...sItem, value: e.target.value } : sItem
                                        ),
                                      }
                                    : item
                                )
                              )
                            }
                            aria-label={`Stream ${sIdx + 1} for ${row.grade}`}
                            className="w-24 bg-transparent text-xs font-medium text-slate-800 focus:outline-none dark:text-slate-100"
                          />
                          <button
                            type="button"
                            disabled={row.streams.length <= 1}
                            onClick={() =>
                              setGradeRows((prev) =>
                                prev.map((item) =>
                                  item.id === row.id
                                    ? {
                                        ...item,
                                        streams: item.streams.filter((_, i) => i !== sIdx),
                                      }
                                    : item
                                )
                              )
                            }
                            aria-label="Remove stream"
                            className="rounded p-1 text-slate-400 hover:text-red-600 disabled:opacity-25 dark:hover:text-red-400"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}

                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={row.newStreamDraft}
                          onChange={(e) =>
                            setGradeRows((prev) =>
                              prev.map((item) =>
                                item.id === row.id
                                  ? { ...item, newStreamDraft: e.target.value }
                                  : item
                              )
                            )
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddStreamToGrade(row.id);
                            }
                          }}
                          placeholder="New stream..."
                          className="w-28 rounded-lg border border-dashed border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        />
                        <button
                          type="button"
                          onClick={() => handleAddStreamToGrade(row.id)}
                          className="whitespace-nowrap rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          + Stream
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4 dark:border-slate-800">
                <p className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
                  {gradeRows.length} grades ·{' '}
                  {gradeRows.reduce((acc, r) => acc + r.streams.length, 0)} total streams
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowStreamsModal(false)}
                    className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save Grades & Streams'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Enrollment Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                New Student Enrollment
              </h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleEnrollStudent} className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Student Full Name
                </label>
                <input
                  required
                  type="text"
                  value={formState.fullName}
                  onChange={(e) => setFormState({ ...formState, fullName: e.target.value })}
                  placeholder="e.g. Muthoni Njeri"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Admin No. (auto if blank)
                </label>
                <input
                  type="text"
                  value={formState.studentCode}
                  onChange={(e) => setFormState({ ...formState, studentCode: e.target.value })}
                  placeholder="e.g. ADM-2615"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  UPI (auto if blank)
                </label>
                <input
                  type="text"
                  value={formState.upi}
                  onChange={(e) => setFormState({ ...formState, upi: e.target.value })}
                  placeholder="e.g. KE-8841099P"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Date of Birth
                </label>
                <input
                  required
                  type="date"
                  value={formState.dateOfBirth}
                  onChange={(e) => setFormState({ ...formState, dateOfBirth: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Grade &amp; Stream
                </label>
                <div className="mt-1 flex gap-2">
                  <select
                    value={formState.grade}
                    onChange={(e) => {
                      const nextGrade = e.target.value;
                      const nextStreams = getStreamsForGrade(tenant, nextGrade);
                      setFormState({
                        ...formState,
                        grade: nextGrade,
                        section: nextStreams.includes(formState.section)
                          ? formState.section
                          : nextStreams[0] || 'A',
                      });
                    }}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {availableGrades.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                  <select
                    value={formState.section}
                    onChange={(e) => setFormState({ ...formState, section: e.target.value })}
                    className="w-36 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {modalGradeStreams.map((sec) => (
                      <option key={sec} value={sec}>
                        Stream {sec}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Guardian / Parent Name
                </label>
                <input
                  required
                  type="text"
                  value={formState.guardianName}
                  onChange={(e) => setFormState({ ...formState, guardianName: e.target.value })}
                  placeholder="e.g. Mary Wanjiku"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Guardian Phone No. (Kenyan)
                </label>
                <input
                  required
                  type="tel"
                  value={formState.guardianPhone}
                  onChange={(e) => setFormState({ ...formState, guardianPhone: e.target.value })}
                  placeholder="+254 712 345 678"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Guardian Email (Optional)
                </label>
                <input
                  type="email"
                  value={formState.guardianEmail}
                  onChange={(e) => setFormState({ ...formState, guardianEmail: e.target.value })}
                  placeholder="parent@example.com"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Gender
                </label>
                <select
                  value={formState.gender}
                  onChange={(e) =>
                    setFormState({
                      ...formState,
                      gender: e.target.value as 'Female' | 'Male' | 'Non-binary',
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="Female">Female</option>
                  <option value="Male">Male</option>
                  <option value="Non-binary">Non-binary</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Enrollment Date
                </label>
                <input
                  required
                  type="date"
                  value={formState.enrolledAt}
                  onChange={(e) => setFormState({ ...formState, enrolledAt: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2 sm:col-span-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? 'Enrolling...' : 'Enroll Student'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
