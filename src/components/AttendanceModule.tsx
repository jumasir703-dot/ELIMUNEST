import { useEffect, useMemo, useState } from 'react';
import {
  CalendarOff,
  CheckCheck,
  Download,
  FileText,
  Lock,
  Plus,
  Printer,
  Save,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { TenantDocumentHeader } from './TenantDocumentHeader';
import {
  loadLogoPngDataUrl,
  resolveTenantDocumentMeta,
} from '../lib/documentBranding';
import { saasApi } from '../lib/api';
import {
  addDaysIso,
  getStreamsForGrade,
  isDateInLeaveChit,
  isTeacherAssignedToCohort,
  type LeaveOutChit,
  type TenantWorkspaceData,
  type UserRole,
} from '../shared/types';

interface AttendanceModuleProps {
  workspace: TenantWorkspaceData;
  currentRole: UserRole;
  onRefresh: () => Promise<void>;
  onNotify: (title: string, tone?: 'success' | 'error') => void;
}

type BinaryAttendanceStatus = 'Present' | 'Absent';
type RollCallTarget = 'student' | 'teaching' | 'non-teaching';

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function getLocalTodayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatOfficialDate(isoDate: string): string {
  const parts = isoDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return isoDate;
  const [y, m, d] = parts;
  const monthName = MONTH_ABBR[(m || 1) - 1] || 'Jan';
  return `${String(d).padStart(2, '0')} ${monthName} ${y}`;
}

export function AttendanceModule({
  workspace,
  currentRole,
  onRefresh,
  onNotify,
}: AttendanceModuleProps) {
  const {
    tenant,
    students,
    attendance,
    staffAttendance = [],
    leaveOutChits = [],
    timetable = [],
  } = workspace;

  const isAdmin = currentRole === 'Admin' || currentRole === 'Super Admin';
  const isTeacherRole = currentRole === 'Teacher';
  const isReadOnlyViewer = currentRole === 'Parent' || currentRole === 'Student';

  const defaultGrade = tenant.grades.includes('Grade 9')
    ? 'Grade 9'
    : tenant.grades[0] || 'Grade 9';
  const defaultStreams = getStreamsForGrade(tenant, defaultGrade);

  const [rollCallTarget, setRollCallTarget] = useState<RollCallTarget>('student');
  const [activeTab, setActiveTab] = useState<'rollcall' | 'summary'>('rollcall');
  const [date, setDate] = useState('2026-11-14');
  const [grade, setGrade] = useState(defaultGrade);
  const [section, setSection] = useState(defaultStreams[0] || 'A');
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>(
    tenant.teachers[0]?.id || ''
  );

  // Separate department filters for Teaching vs Non-Teaching staff
  const [teachingDept, setTeachingDept] = useState<string>('All');
  const [nonTeachingDept, setNonTeachingDept] = useState<string>('All');
  const [summaryGradeFilter, setSummaryGradeFilter] = useState<string>('All');
  const [summaryStreamFilter, setSummaryStreamFilter] = useState<string>('All');
  const [saving, setSaving] = useState(false);

  // Add Non-Teaching Staff inline form (Admin only)
  const [showAddNonTeaching, setShowAddNonTeaching] = useState(false);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffRole, setNewStaffRole] = useState('');
  const [newStaffDept, setNewStaffDept] = useState('Support Services');
  const [newStaffPhone, setNewStaffPhone] = useState('');
  const [addingStaff, setAddingStaff] = useState(false);

  // Leave Out Chit form state
  const [chitStudentId, setChitStudentId] = useState('');
  const [chitStartDate, setChitStartDate] = useState('2026-11-14');
  const [chitDays, setChitDays] = useState<number>(1);
  const [chitReason, setChitReason] = useState('');
  const [chitSaving, setChitSaving] = useState(false);
  const [selectedNoteChitId, setSelectedNoteChitId] = useState<string>('');

  // Enforce Admin-only viewership for Teaching and Non-Teaching Staff attendance
  useEffect(() => {
    if (!isAdmin && rollCallTarget !== 'student') {
      setRollCallTarget('student');
    }
  }, [isAdmin, rollCallTarget]);

  // Keep selected teacher valid when tenant switches
  useEffect(() => {
    if (!tenant.teachers.some((t) => t.id === selectedTeacherId)) {
      setSelectedTeacherId(tenant.teachers[0]?.id || '');
    }
  }, [tenant.teachers, selectedTeacherId]);

  const selectedTeacher = useMemo(
    () => tenant.teachers.find((t) => t.id === selectedTeacherId) || tenant.teachers[0],
    [tenant.teachers, selectedTeacherId]
  );

  // Cohorts assigned to the active teacher (via class allocation or timetable slots)
  const assignedCohortsForTeacher = useMemo(() => {
    if (!selectedTeacher) return [] as Array<{ grade: string; section: string }>;
    const list: Array<{ grade: string; section: string }> = [];
    tenant.grades.forEach((g) => {
      getStreamsForGrade(tenant, g).forEach((sec) => {
        if (isTeacherAssignedToCohort(selectedTeacher, g, sec, timetable)) {
          list.push({ grade: g, section: sec });
        }
      });
    });
    return list;
  }, [selectedTeacher, tenant, timetable]);

  // When entering Teacher role or switching teacher, jump to their first assigned cohort if current isn't assigned
  useEffect(() => {
    if (!isTeacherRole || !selectedTeacher) return;
    const currentlyAssigned = isTeacherAssignedToCohort(
      selectedTeacher,
      grade,
      section,
      timetable
    );
    if (!currentlyAssigned && assignedCohortsForTeacher.length > 0) {
      setGrade(assignedCohortsForTeacher[0].grade);
      setSection(assignedCohortsForTeacher[0].section);
    }
  }, [isTeacherRole, selectedTeacherId, assignedCohortsForTeacher]); // eslint-disable-line react-hooks/exhaustive-deps

  const isSelectedTeacherAssignedHere = useMemo(() => {
    if (!isTeacherRole) return false;
    return isTeacherAssignedToCohort(selectedTeacher, grade, section, timetable);
  }, [isTeacherRole, selectedTeacher, grade, section, timetable]);

  const selectedTermForDate = useMemo(() => {
    const terms = workspace.academicTerms || [];
    return (
      terms.find((t) => t.startDate <= date && date <= t.endDate) ||
      terms.find(
        (t) => t.isCurrent || t.name.toLowerCase() === tenant.currentTerm.toLowerCase()
      ) ||
      null
    );
  }, [workspace.academicTerms, date, tenant.currentTerm]);

  const isDateTermClosed = selectedTermForDate?.status === 'Closed';

  // Student register marking & viewing permission: ONLY assigned Teachers and Admin
  const canViewAndMarkStudentRegister = isAdmin || isSelectedTeacherAssignedHere;
  const canViewAnyStudentSummary =
    isAdmin || isReadOnlyViewer || (isTeacherRole && assignedCohortsForTeacher.length > 0);

  const availableStreams = useMemo(
    () => getStreamsForGrade(tenant, grade),
    [tenant, grade]
  );

  const activeSchoolStudents = useMemo(
    () => students.filter((s) => s.status === 'Active'),
    [students]
  );

  const visibleStudentsForActor = useMemo(() => {
    if (isAdmin || isReadOnlyViewer) return activeSchoolStudents;
    if (isTeacherRole && selectedTeacher) {
      return activeSchoolStudents.filter((stu) =>
        isTeacherAssignedToCohort(selectedTeacher, stu.grade, stu.section, timetable)
      );
    }
    return [];
  }, [activeSchoolStudents, isAdmin, isReadOnlyViewer, isTeacherRole, selectedTeacher, timetable]);

  const cohortStudents = useMemo(
    () =>
      canViewAndMarkStudentRegister
        ? activeSchoolStudents.filter(
            (s) => s.grade === grade && s.section === section
          )
        : [],
    [activeSchoolStudents, grade, section, canViewAndMarkStudentRegister]
  );

  const otherVisibleStudents = useMemo(
    () =>
      visibleStudentsForActor.filter(
        (s) => !(s.grade === grade && s.section === section)
      ),
    [visibleStudentsForActor, grade, section]
  );

  // Default selected student for leave chit when cohort changes
  useEffect(() => {
    if (!chitStudentId || !visibleStudentsForActor.some((s) => s.id === chitStudentId)) {
      setChitStudentId(cohortStudents[0]?.id || visibleStudentsForActor[0]?.id || '');
    }
  }, [chitStudentId, cohortStudents, visibleStudentsForActor]);

  // Keep leave chit start date aligned when user switches roll-call date
  useEffect(() => {
    setChitStartDate(date);
  }, [date]);

  const visibleLeaveOutChits = useMemo(() => {
    if (isAdmin || isReadOnlyViewer) return leaveOutChits;
    if (isTeacherRole && selectedTeacher) {
      return leaveOutChits.filter((c) =>
        isTeacherAssignedToCohort(selectedTeacher, c.grade, c.section, timetable)
      );
    }
    return [];
  }, [leaveOutChits, isAdmin, isReadOnlyViewer, isTeacherRole, selectedTeacher, timetable]);

  // Keep selected note chit in sync when issued chits change
  useEffect(() => {
    if (visibleLeaveOutChits.length === 0) {
      if (selectedNoteChitId && selectedNoteChitId !== 'draft') setSelectedNoteChitId('');
      return;
    }
    if (selectedNoteChitId === 'draft') return;
    if (!selectedNoteChitId || !visibleLeaveOutChits.some((c) => c.id === selectedNoteChitId)) {
      setSelectedNoteChitId(visibleLeaveOutChits[0].id);
    }
  }, [visibleLeaveOutChits, selectedNoteChitId]);

  // Active leave-out chits on selected roll-call date (studentId -> LeaveOutChit)
  const activeChitByStudent = useMemo(() => {
    const map = new Map<string, LeaveOutChit>();
    leaveOutChits.forEach((chit) => {
      if (isDateInLeaveChit(chit, date)) {
        map.set(chit.studentId, chit);
      }
    });
    return map;
  }, [leaveOutChits, date]);

  const [draft, setDraft] = useState<
    Record<string, { status: BinaryAttendanceStatus; remarks: string }>
  >({});

  // Sync student draft whenever cohort, date, attendance, or active leave-out chits update
  useEffect(() => {
    const next: Record<string, { status: BinaryAttendanceStatus; remarks: string }> = {};
    cohortStudents.forEach((stu) => {
      const activeChit = activeChitByStudent.get(stu.id);
      const existing = attendance.find(
        (r) => r.date === date && r.studentId === stu.id
      );
      if (activeChit) {
        next[stu.id] = {
          status: 'Absent',
          remarks:
            existing?.remarks ||
            `Leave Out Chit (${activeChit.days}d: ${activeChit.startDate} to ${activeChit.endDate}): ${activeChit.reason}`,
        };
      } else {
        const mappedStatus: BinaryAttendanceStatus =
          existing?.status === 'Absent' || existing?.status === 'Excused'
            ? 'Absent'
            : 'Present';
        next[stu.id] = {
          status: mappedStatus,
          remarks: existing?.remarks || '',
        };
      }
    });
    setDraft(next);
  }, [cohortStudents, attendance, date, activeChitByStudent]);

  const rollCallMetrics = useMemo(() => {
    let present = 0;
    let absent = 0;
    let onLeaveChit = 0;
    cohortStudents.forEach((stu) => {
      const hasChit = activeChitByStudent.has(stu.id);
      if (hasChit) onLeaveChit += 1;
      const st = hasChit ? 'Absent' : draft[stu.id]?.status || 'Present';
      if (st === 'Absent') absent += 1;
      else present += 1;
    });
    return {
      total: cohortStudents.length,
      present,
      absent,
      onLeaveChit,
    };
  }, [cohortStudents, draft, activeChitByStudent]);

  const studentSummary = useMemo(() => {
    const scoped = isAdmin
      ? students
      : isTeacherRole && selectedTeacher
      ? students.filter((stu) =>
          isTeacherAssignedToCohort(selectedTeacher, stu.grade, stu.section, timetable)
        )
      : [];

    return scoped.map((stu) => {
      const recs = attendance.filter((r) => r.studentId === stu.id);
      const total = recs.length;
      const present = recs.filter(
        (r) => r.status === 'Present' || r.status === 'Late'
      ).length;
      const absent = recs.filter((r) => r.status === 'Absent').length;
      const rate = total > 0 ? Math.round((present / total) * 1000) / 10 : 100;
      const activeChit = activeChitByStudent.get(stu.id);
      return { student: stu, total, present, absent, rate, activeChit };
    });
  }, [
    students,
    attendance,
    activeChitByStudent,
    isAdmin,
    isTeacherRole,
    selectedTeacher,
    timetable,
  ]);

  const summaryGradeOptions = useMemo(() => {
    const presentGrades = new Set(studentSummary.map((row) => row.student.grade));
    const ordered = tenant.grades.filter((g) => presentGrades.has(g));
    presentGrades.forEach((g) => {
      if (!ordered.includes(g)) ordered.push(g);
    });
    return ordered;
  }, [studentSummary, tenant.grades]);

  const summaryStreamOptions = useMemo(() => {
    const relevantRows =
      summaryGradeFilter === 'All'
        ? studentSummary
        : studentSummary.filter((row) => row.student.grade === summaryGradeFilter);
    const configured =
      summaryGradeFilter === 'All'
        ? summaryGradeOptions.flatMap((g) => getStreamsForGrade(tenant, g))
        : getStreamsForGrade(tenant, summaryGradeFilter);
    const set = new Set<string>(configured);
    relevantRows.forEach((row) => {
      if (row.student.section) set.add(row.student.section);
    });
    return Array.from(set);
  }, [studentSummary, summaryGradeFilter, summaryGradeOptions, tenant]);

  useEffect(() => {
    if (summaryStreamFilter !== 'All' && !summaryStreamOptions.includes(summaryStreamFilter)) {
      setSummaryStreamFilter('All');
    }
  }, [summaryStreamFilter, summaryStreamOptions]);

  const filteredStudentSummary = useMemo(() => {
    return studentSummary.filter(({ student }) => {
      if (summaryGradeFilter !== 'All' && student.grade !== summaryGradeFilter) return false;
      if (summaryStreamFilter !== 'All' && student.section !== summaryStreamFilter) return false;
      return true;
    });
  }, [studentSummary, summaryGradeFilter, summaryStreamFilter]);

  const summaryAverageRate = useMemo(() => {
    if (filteredStudentSummary.length === 0) return 100;
    const sum = filteredStudentSummary.reduce((acc, row) => acc + row.rate, 0);
    return Math.round((sum / filteredStudentSummary.length) * 10) / 10;
  }, [filteredStudentSummary]);

  // --- Teaching Staff Roll Call (Admin Only) ---
  const teachingDepartments = useMemo(() => {
    return Array.from(
      new Set(tenant.teachers.map((t) => t.department).filter(Boolean))
    );
  }, [tenant.teachers]);

  const filteredTeachingStaff = useMemo(() => {
    if (teachingDept === 'All') return tenant.teachers;
    return tenant.teachers.filter((t) => t.department === teachingDept);
  }, [tenant.teachers, teachingDept]);

  const teachingRecords = useMemo(
    () =>
      staffAttendance.filter(
        (r) => (r.staffCategory || 'Teaching') === 'Teaching'
      ),
    [staffAttendance]
  );

  const [teachingDraft, setTeachingDraft] = useState<
    Record<string, { status: BinaryAttendanceStatus; remarks: string }>
  >({});

  useEffect(() => {
    const next: Record<string, { status: BinaryAttendanceStatus; remarks: string }> = {};
    tenant.teachers.forEach((member) => {
      const existing = teachingRecords.find(
        (r) => r.date === date && r.staffId === member.id
      );
      const mappedStatus: BinaryAttendanceStatus =
        existing?.status === 'Absent' || existing?.status === 'Excused'
          ? 'Absent'
          : 'Present';
      next[member.id] = {
        status: mappedStatus,
        remarks: existing?.remarks || '',
      };
    });
    setTeachingDraft(next);
  }, [tenant.teachers, teachingRecords, date]);

  const teachingMetrics = useMemo(() => {
    let present = 0;
    let absent = 0;
    filteredTeachingStaff.forEach((member) => {
      const st = teachingDraft[member.id]?.status || 'Present';
      if (st === 'Absent') absent += 1;
      else present += 1;
    });
    return {
      total: filteredTeachingStaff.length,
      present,
      absent,
    };
  }, [filteredTeachingStaff, teachingDraft]);

  const teachingSummary = useMemo(() => {
    return tenant.teachers.map((member) => {
      const recs = teachingRecords.filter((r) => r.staffId === member.id);
      const total = recs.length;
      const present = recs.filter(
        (r) => r.status === 'Present' || r.status === 'Late'
      ).length;
      const absent = recs.filter((r) => r.status === 'Absent').length;
      const rate = total > 0 ? Math.round((present / total) * 1000) / 10 : 100;
      return { member, total, present, absent, rate };
    });
  }, [tenant.teachers, teachingRecords]);

  // --- Non-Teaching Staff Roll Call (Admin Only) ---
  const nonTeachingRoster = useMemo(
    () => tenant.nonTeachingStaff || [],
    [tenant.nonTeachingStaff]
  );

  const nonTeachingDepartments = useMemo(() => {
    return Array.from(
      new Set(nonTeachingRoster.map((n) => n.department).filter(Boolean))
    );
  }, [nonTeachingRoster]);

  const filteredNonTeachingStaff = useMemo(() => {
    if (nonTeachingDept === 'All') return nonTeachingRoster;
    return nonTeachingRoster.filter((n) => n.department === nonTeachingDept);
  }, [nonTeachingRoster, nonTeachingDept]);

  const nonTeachingRecords = useMemo(
    () => staffAttendance.filter((r) => r.staffCategory === 'Non-Teaching'),
    [staffAttendance]
  );

  const [nonTeachingDraft, setNonTeachingDraft] = useState<
    Record<string, { status: BinaryAttendanceStatus; remarks: string }>
  >({});

  useEffect(() => {
    const next: Record<string, { status: BinaryAttendanceStatus; remarks: string }> = {};
    nonTeachingRoster.forEach((member) => {
      const existing = nonTeachingRecords.find(
        (r) => r.date === date && r.staffId === member.id
      );
      const mappedStatus: BinaryAttendanceStatus =
        existing?.status === 'Absent' || existing?.status === 'Excused'
          ? 'Absent'
          : 'Present';
      next[member.id] = {
        status: mappedStatus,
        remarks: existing?.remarks || '',
      };
    });
    setNonTeachingDraft(next);
  }, [nonTeachingRoster, nonTeachingRecords, date]);

  const nonTeachingMetrics = useMemo(() => {
    let present = 0;
    let absent = 0;
    filteredNonTeachingStaff.forEach((member) => {
      const st = nonTeachingDraft[member.id]?.status || 'Present';
      if (st === 'Absent') absent += 1;
      else present += 1;
    });
    return {
      total: filteredNonTeachingStaff.length,
      present,
      absent,
    };
  }, [filteredNonTeachingStaff, nonTeachingDraft]);

  const nonTeachingSummary = useMemo(() => {
    return nonTeachingRoster.map((member) => {
      const recs = nonTeachingRecords.filter((r) => r.staffId === member.id);
      const total = recs.length;
      const present = recs.filter(
        (r) => r.status === 'Present' || r.status === 'Late'
      ).length;
      const absent = recs.filter((r) => r.status === 'Absent').length;
      const rate = total > 0 ? Math.round((present / total) * 1000) / 10 : 100;
      return { member, total, present, absent, rate };
    });
  }, [nonTeachingRoster, nonTeachingRecords]);

  // --- Handlers ---
  function markAllPresent() {
    if (!canViewAndMarkStudentRegister) return;
    const next: Record<string, { status: BinaryAttendanceStatus; remarks: string }> = {};
    let lockedCount = 0;
    cohortStudents.forEach((stu) => {
      const activeChit = activeChitByStudent.get(stu.id);
      if (activeChit) {
        lockedCount += 1;
        next[stu.id] = {
          status: 'Absent',
          remarks:
            draft[stu.id]?.remarks ||
            `Leave Out Chit (${activeChit.days}d: ${activeChit.startDate} to ${activeChit.endDate}): ${activeChit.reason}`,
        };
      } else {
        next[stu.id] = { status: 'Present', remarks: draft[stu.id]?.remarks || '' };
      }
    });
    setDraft(next);
    if (lockedCount > 0) {
      onNotify(
        `Marked available students Present; ${lockedCount} student(s) with an active Leave Out Chit remain Absent.`
      );
    }
  }

  async function handleIssueLeaveChit(e: React.FormEvent) {
    e.preventDefault();
    if (!canViewAndMarkStudentRegister) return;
    if (!chitStudentId) {
      onNotify('Select a student for the leave out chit.', 'error');
      return;
    }
    if (!chitReason.trim()) {
      onNotify('Enter a reason for the leave out chit.', 'error');
      return;
    }
    setChitSaving(true);
    try {
      const actorLabel = isTeacherRole && selectedTeacher
        ? selectedTeacher.name
        : `${currentRole} Desk`;
      const { chit } = await saasApi.createLeaveOutChit(tenant.id, {
        studentId: chitStudentId,
        startDate: chitStartDate || date,
        days: chitDays,
        reason: chitReason.trim(),
        issuedBy: actorLabel,
      });
      await onRefresh();
      setSelectedNoteChitId(chit.id);
      setChitReason('');
      setChitDays(1);
      onNotify(
        `Leave out chit issued for ${chit.studentName} (${chit.days} day${
          chit.days === 1 ? '' : 's'
        }: ${chit.startDate} to ${chit.endDate}). Marked Absent until it lapses.`
      );
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to issue leave out chit',
        'error'
      );
    } finally {
      setChitSaving(false);
    }
  }

  async function handleDeleteLeaveChit(chit: LeaveOutChit) {
    if (!canViewAndMarkStudentRegister) return;
    setChitSaving(true);
    try {
      await saasApi.deleteLeaveOutChit(tenant.id, chit.id);
      await onRefresh();
      onNotify(`Leave out chit revoked for ${chit.studentName}.`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to revoke leave out chit',
        'error'
      );
    } finally {
      setChitSaving(false);
    }
  }

  async function handleSaveRollCall() {
    if (!canViewAndMarkStudentRegister || cohortStudents.length === 0) return;
    setSaving(true);
    try {
      await saasApi.saveAttendanceBatch(tenant.id, {
        date,
        grade,
        section,
        recordedBy:
          isTeacherRole && selectedTeacher ? selectedTeacher.name : `${currentRole} Desk`,
        actorRole: currentRole,
        teacherId: isTeacherRole ? selectedTeacher?.id : undefined,
        entries: cohortStudents.map((stu) => {
          const activeChit = activeChitByStudent.get(stu.id);
          return {
            studentId: stu.id,
            status: activeChit ? 'Absent' : draft[stu.id]?.status || 'Present',
            remarks: draft[stu.id]?.remarks || '',
          };
        }),
      });
      await onRefresh();
      onNotify(`Roll call saved for ${grade} Stream ${section} (${date}).`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to save attendance', 'error');
    } finally {
      setSaving(false);
    }
  }

  function markAllTeachingPresent() {
    if (!isAdmin) return;
    setTeachingDraft((prev) => {
      const next = { ...prev };
      filteredTeachingStaff.forEach((member) => {
        next[member.id] = {
          status: 'Present',
          remarks: prev[member.id]?.remarks || '',
        };
      });
      return next;
    });
  }

  async function handleSaveTeachingRollCall() {
    if (!isAdmin || filteredTeachingStaff.length === 0) return;
    setSaving(true);
    try {
      await saasApi.saveStaffAttendanceBatch(tenant.id, {
        date,
        recordedBy: `${currentRole} Desk`,
        staffCategory: 'Teaching',
        actorRole: currentRole,
        entries: filteredTeachingStaff.map((member) => ({
          staffId: member.id,
          status: teachingDraft[member.id]?.status || 'Present',
          remarks: teachingDraft[member.id]?.remarks || '',
        })),
      });
      await onRefresh();
      onNotify(`Teaching staff roll call saved for ${date}.`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to save teaching staff roll call',
        'error'
      );
    } finally {
      setSaving(false);
    }
  }

  function markAllNonTeachingPresent() {
    if (!isAdmin) return;
    setNonTeachingDraft((prev) => {
      const next = { ...prev };
      filteredNonTeachingStaff.forEach((member) => {
        next[member.id] = {
          status: 'Present',
          remarks: prev[member.id]?.remarks || '',
        };
      });
      return next;
    });
  }

  async function handleSaveNonTeachingRollCall() {
    if (!isAdmin || filteredNonTeachingStaff.length === 0) return;
    setSaving(true);
    try {
      await saasApi.saveStaffAttendanceBatch(tenant.id, {
        date,
        recordedBy: `${currentRole} Desk`,
        staffCategory: 'Non-Teaching',
        actorRole: currentRole,
        entries: filteredNonTeachingStaff.map((member) => ({
          staffId: member.id,
          status: nonTeachingDraft[member.id]?.status || 'Present',
          remarks: nonTeachingDraft[member.id]?.remarks || '',
        })),
      });
      await onRefresh();
      onNotify(`Non-teaching staff roll call saved for ${date}.`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to save non-teaching staff roll call',
        'error'
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleAddNonTeachingStaff(e: React.FormEvent) {
    e.preventDefault();
    if (!isAdmin) return;
    if (!newStaffName.trim() || !newStaffRole.trim()) {
      onNotify('Enter staff full name and role/designation.', 'error');
      return;
    }
    setAddingStaff(true);
    try {
      const { staff } = await saasApi.addNonTeachingStaff(tenant.id, {
        name: newStaffName.trim(),
        role: newStaffRole.trim(),
        department: newStaffDept.trim() || 'Support Services',
        phone: newStaffPhone.trim(),
        actorRole: currentRole,
      });
      await onRefresh();
      setNewStaffName('');
      setNewStaffRole('');
      setNewStaffPhone('');
      setShowAddNonTeaching(false);
      onNotify(`${staff.name} (${staff.role}) added to Non-Teaching Staff.`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to add non-teaching staff',
        'error'
      );
    } finally {
      setAddingStaff(false);
    }
  }

  const computedEndDate = addDaysIso(chitStartDate || date, Math.max(1, chitDays) - 1);

  const noteSource = useMemo(() => {
    const selectedIssued =
      selectedNoteChitId !== 'draft'
        ? visibleLeaveOutChits.find((c) => c.id === selectedNoteChitId) ||
          visibleLeaveOutChits[0] ||
          null
        : null;
    if (selectedIssued) {
      return {
        isIssued: true,
        chitId: selectedIssued.id,
        studentName: selectedIssued.studentName,
        studentCode: selectedIssued.studentCode,
        grade: selectedIssued.grade,
        section: selectedIssued.section,
        startDate: selectedIssued.startDate,
        days: selectedIssued.days,
        reason: selectedIssued.reason,
        issuedBy: selectedIssued.issuedBy || `${currentRole} Desk`,
      };
    }

    const draftStudent =
      visibleStudentsForActor.find((s) => s.id === chitStudentId) ||
      cohortStudents[0] ||
      visibleStudentsForActor[0] ||
      null;
    if (!draftStudent) return null;

    return {
      isIssued: false,
      chitId: 'draft',
      studentName: draftStudent.fullName,
      studentCode: draftStudent.studentCode,
      grade: draftStudent.grade,
      section: draftStudent.section,
      startDate: chitStartDate || date,
      days: Math.max(1, chitDays),
      reason: chitReason.trim(),
      issuedBy:
        isTeacherRole && selectedTeacher ? selectedTeacher.name : `${currentRole} Desk`,
    };
  }, [
    selectedNoteChitId,
    visibleLeaveOutChits,
    visibleStudentsForActor,
    cohortStudents,
    chitStudentId,
    chitStartDate,
    date,
    chitDays,
    chitReason,
    currentRole,
    isTeacherRole,
    selectedTeacher,
  ]);

  const officialNoteDetails = useMemo(() => {
    if (!noteSource) return null;
    const currentDateIso = getLocalTodayIso();
    const currentDateLabel = formatOfficialDate(currentDateIso);
    const startDateLabel = formatOfficialDate(noteSource.startDate);
    const expectedBackIso = addDaysIso(noteSource.startDate, Math.max(1, noteSource.days));
    const expectedBackLabel = formatOfficialDate(expectedBackIso);
    const reasonText = noteSource.reason
      ? noteSource.reason.replace(/\.+$/, '')
      : 'official family/medical reason';
    const dayUnit = noteSource.days === 1 ? 'day' : 'days';
    const bodyText = `Dated ${currentDateLabel}. ${noteSource.studentName} (Adm No. ${noteSource.studentCode}, ${noteSource.grade} ${noteSource.section}) is granted ${noteSource.days} ${dayUnit} official leave out effective ${startDateLabel} due to ${reasonText}. The student is expected back in school on ${expectedBackLabel}. Authorized by ${noteSource.issuedBy}.`;
    const fullWordCount = `${tenant.name} Official Leave Out Note ${bodyText}`
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;

    return {
      ...noteSource,
      currentDateIso,
      currentDateLabel,
      startDateLabel,
      expectedBackIso,
      expectedBackLabel,
      reasonDisplay: noteSource.reason || 'Pending reason input',
      hasReason: Boolean(noteSource.reason),
      bodyText,
      wordCount: fullWordCount,
    };
  }, [noteSource, tenant.name]);

  async function handleDownloadOfficialNote() {
    if (!officialNoteDetails) return;
    if (!officialNoteDetails.hasReason) {
      onNotify(
        'Enter a reason in the Leave Out Chit form or select an issued chit first.',
        'error'
      );
      return;
    }

    const meta = resolveTenantDocumentMeta(tenant);
    const logoPng = await loadLogoPngDataUrl(meta.logoUrl, 128);

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const centerX = pageWidth / 2;
    const cardWidth = 156;
    const cardX = (pageWidth - cardWidth) / 2;
    const cardTop = 20;
    const innerWidth = cardWidth - 20;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    const bodyLines = doc.splitTextToSize(officialNoteDetails.bodyText, innerWidth) as string[];

    doc.setFontSize(9.5);
    const reasonLines = doc.splitTextToSize(
      `Reason: ${officialNoteDetails.reasonDisplay}`,
      innerWidth
    ) as string[];

    const logoBlockHeight = logoPng ? 18 : 0;
    const bodyLineHeight = 5.4;
    const reasonLineHeight = 4.8;
    const cardHeight =
      46 +
      logoBlockHeight +
      bodyLines.length * bodyLineHeight +
      28 +
      reasonLines.length * reasonLineHeight +
      26;

    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(cardX, cardTop, cardWidth, cardHeight, 3, 3, 'FD');

    let y = cardTop + 10;

    if (logoPng) {
      try {
        doc.addImage(logoPng, 'PNG', centerX - 8, y, 16, 16);
        y += 20;
      } catch {
        // continue without image if canvas conversion failed
      }
    }

    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13.5);
    doc.text(meta.schoolName, centerX, y, { align: 'center' });

    y += 4.8;
    doc.setTextColor(71, 85, 105);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(
      `${meta.location} | ${meta.postalAddress} | Tel: ${meta.contactPhone} | ${meta.contactEmail}`,
      centerX,
      y,
      { align: 'center', maxWidth: innerWidth }
    );

    y += 5.5;
    doc.setTextColor(37, 99, 235);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('OFFICIAL LEAVE OUT NOTE', centerX, y, { align: 'center' });

    y += 4.8;
    doc.setTextColor(71, 85, 105);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Date: ${officialNoteDetails.currentDateLabel}`, centerX, y, {
      align: 'center',
    });

    y += 4.5;
    doc.setDrawColor(226, 232, 240);
    doc.line(cardX + 10, y, cardX + cardWidth - 10, y);

    y += 8;
    doc.setTextColor(30, 41, 59);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    bodyLines.forEach((line, idx) => {
      doc.text(line, centerX, y + idx * bodyLineHeight, { align: 'center' });
    });

    y += bodyLines.length * bodyLineHeight + 4;
    doc.setDrawColor(226, 232, 240);
    doc.line(cardX + 10, y, cardX + cardWidth - 10, y);

    y += 7;
    doc.setTextColor(51, 65, 85);
    doc.setFontSize(9.5);
    doc.text(
      `Student: ${officialNoteDetails.studentName}   |   Adm No.: ${officialNoteDetails.studentCode}`,
      centerX,
      y,
      { align: 'center' }
    );

    y += 5.5;
    doc.text(
      `No. of Days: ${officialNoteDetails.days} ${
        officialNoteDetails.days === 1 ? 'day' : 'days'
      }   |   Expected Back: ${officialNoteDetails.expectedBackLabel}`,
      centerX,
      y,
      { align: 'center' }
    );

    y += 5.5;
    reasonLines.forEach((line, idx) => {
      doc.text(line, centerX, y + idx * reasonLineHeight, { align: 'center' });
    });

    y += reasonLines.length * reasonLineHeight + 4.5;
    doc.setDrawColor(203, 213, 225);
    doc.line(cardX + 14, y, cardX + cardWidth - 14, y);

    y += 7;
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(8.5);
    doc.text(`Authorized by: ${officialNoteDetails.issuedBy}`, centerX, y, {
      align: 'center',
    });

    y += 6;
    doc.text('Official Stamp / Signature: ___________________________', centerX, y, {
      align: 'center',
    });

    doc.save(
      `leave-out-note-${officialNoteDetails.studentCode}-${officialNoteDetails.startDate}.pdf`
    );
    onNotify(`Downloaded official leave out PDF for ${officialNoteDetails.studentName}.`);
  }

  function handlePrintOfficialNote() {
    if (!officialNoteDetails) return;
    if (!officialNoteDetails.hasReason) {
      onNotify(
        'Enter a reason in the Leave Out Chit form or select an issued chit first.',
        'error'
      );
      return;
    }

    document.body.classList.add('print-leave-note-only');
    const cleanup = () => {
      document.body.classList.remove('print-leave-note-only');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
    setTimeout(cleanup, 1500);
  }

  const summaryTabLabel =
    isAdmin && rollCallTarget === 'teaching'
      ? 'Teaching Staff Rates'
      : isAdmin && rollCallTarget === 'non-teaching'
      ? 'Non-Teaching Staff Rates'
      : 'Student Attendance Rates';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Attendance Tracking
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {isAdmin
              ? 'Student register marking (assigned teachers & Admin), plus Teaching Staff and Non-Teaching Staff roll call (Admin only).'
              : isTeacherRole
              ? 'Student register marking for classes and streams assigned to you.'
              : 'Student register marking is restricted to assigned class/subject teachers and School Admin.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {isAdmin ? (
            <select
              aria-label="Select roll call type"
              value={rollCallTarget}
              onChange={(e) => setRollCallTarget(e.target.value as RollCallTarget)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="student">Student Roll Call</option>
              <option value="teaching">Teaching Staff Roll Call</option>
              <option value="non-teaching">Non-Teaching Staff Roll Call</option>
            </select>
          ) : (
            <span className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
              Student Roll Call
            </span>
          )}

          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            <button
              onClick={() => setActiveTab('rollcall')}
              className={`whitespace-nowrap shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === 'rollcall'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {isReadOnlyViewer ? 'My Attendance Log' : 'Daily Roll Call'}
            </button>
            <button
              onClick={() => setActiveTab('summary')}
              className={`whitespace-nowrap shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === 'summary'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {summaryTabLabel}
            </button>
          </div>
        </div>
      </div>

      {isDateTermClosed && !isReadOnlyViewer && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
          <div>
            <strong>
              Term Locked ({selectedTermForDate?.name} is Closed for {date}):
            </strong>{' '}
            Roll-call updates and leave out chits are locked for closed terms. Select an open term date or have a School Admin reopen the term in <strong>School Settings</strong>.
          </div>
        </div>
      )}

      {activeTab === 'rollcall' && rollCallTarget === 'student' ? (
        <>
          {/* Student Controls Bar */}
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center gap-3">
              {isTeacherRole && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Teacher:
                  </span>
                  <select
                    aria-label="Acting teacher profile"
                    value={selectedTeacher?.id || ''}
                    onChange={(e) => setSelectedTeacherId(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {tenant.teachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="sr-only">Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <select
                aria-label="Select grade"
                value={grade}
                onChange={(e) => {
                  const nextGrade = e.target.value;
                  const nextStreams = getStreamsForGrade(tenant, nextGrade);
                  setGrade(nextGrade);
                  if (!nextStreams.includes(section)) {
                    setSection(nextStreams[0] || 'A');
                  }
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                {tenant.grades.map((g) => {
                  const hasAssignedStream =
                    isTeacherRole &&
                    getStreamsForGrade(tenant, g).some((sec) =>
                      isTeacherAssignedToCohort(selectedTeacher, g, sec, timetable)
                    );
                  return (
                    <option key={g} value={g}>
                      {g}
                      {hasAssignedStream ? ' (Assigned)' : ''}
                    </option>
                  );
                })}
              </select>

              <select
                aria-label="Select stream"
                value={section}
                onChange={(e) => setSection(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                {availableStreams.map((sec) => {
                  const assignedHere =
                    isTeacherRole &&
                    isTeacherAssignedToCohort(selectedTeacher, grade, sec, timetable);
                  return (
                    <option key={sec} value={sec}>
                      Stream {sec}
                      {assignedHere ? ' (Assigned)' : ''}
                    </option>
                  );
                })}
              </select>

              {canViewAndMarkStudentRegister && (
                <span className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
                  Present:{' '}
                  <strong className="text-emerald-700 dark:text-emerald-400">
                    {rollCallMetrics.present}
                  </strong>{' '}
                  · Absent:{' '}
                  <strong className="text-red-700 dark:text-red-400">
                    {rollCallMetrics.absent}
                  </strong>
                  {rollCallMetrics.onLeaveChit > 0 && (
                    <>
                      {' '}
                      · Leave Out Chit:{' '}
                      <strong className="text-amber-700 dark:text-amber-400">
                        {rollCallMetrics.onLeaveChit}
                      </strong>
                    </>
                  )}
                </span>
              )}
            </div>

            {canViewAndMarkStudentRegister && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={markAllPresent}
                  disabled={cohortStudents.length === 0 || isDateTermClosed}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Mark All Present
                </button>
                <button
                  type="button"
                  onClick={handleSaveRollCall}
                  disabled={saving || cohortStudents.length === 0 || isDateTermClosed}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" />
                  {saving ? 'Saving...' : 'Save Roll Call'}
                </button>
              </div>
            )}
          </div>

          {isReadOnlyViewer ? (
            <div className="space-y-4">
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Attendance History ({attendance.length} record{attendance.length === 1 ? '' : 's'})
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Read-only attendance log for your account.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-2.5">Date</th>
                        <th className="px-4 py-2.5">Student</th>
                        <th className="px-4 py-2.5">Class</th>
                        <th className="px-4 py-2.5">Status</th>
                        <th className="px-4 py-2.5">Remarks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {attendance.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                            No roll-call records logged yet.
                          </td>
                        </tr>
                      ) : (
                        attendance
                          .slice()
                          .sort((a, b) => b.date.localeCompare(a.date))
                          .slice(0, 40)
                          .map((rec) => (
                            <tr key={rec.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                              <td className="px-4 py-2.5 font-mono text-xs text-slate-700 tabular-nums dark:text-slate-300">
                                {rec.date}
                              </td>
                              <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                                {rec.studentName}
                              </td>
                              <td className="px-4 py-2.5 text-xs text-slate-600 dark:text-slate-400">
                                {rec.grade} · {rec.section}
                              </td>
                              <td className="px-4 py-2.5 text-xs font-semibold">
                                <span
                                  className={
                                    rec.status === 'Present'
                                      ? 'text-emerald-700 dark:text-emerald-400'
                                      : rec.status === 'Absent'
                                      ? 'text-red-700 dark:text-red-400'
                                      : 'text-amber-700 dark:text-amber-400'
                                  }
                                >
                                  {rec.status}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400">
                                {rec.remarks || '—'}
                              </td>
                            </tr>
                          ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : !canViewAndMarkStudentRegister ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-6 dark:border-amber-900/60 dark:bg-amber-950/20">
              <div className="flex items-start gap-3">
                <Lock className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" />
                <div className="space-y-2">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Register Access Restricted
                  </h2>
                  <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    {isTeacherRole ? (
                      <>
                        <strong>{selectedTeacher?.name || 'Selected teacher'}</strong> is not
                        assigned to <strong>{grade} Stream {section}</strong>. Marking the
                        student register is only visible to teachers assigned to that class/stream
                        and the School Admin.
                      </>
                    ) : (
                      <>
                        Your active role (<strong>{currentRole}</strong>) does not have register
                        marking permissions. Student attendance marking is visible only to teachers
                        assigned to the class/stream and School Admin.
                      </>
                    )}
                  </p>
                  {isTeacherRole && assignedCohortsForTeacher.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                        Jump to assigned class:
                      </span>
                      {assignedCohortsForTeacher.map((c) => (
                        <button
                          key={`${c.grade}-${c.section}`}
                          type="button"
                          onClick={() => {
                            setGrade(c.grade);
                            setSection(c.section);
                          }}
                          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                        >
                          {c.grade} · Stream {c.section}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Leave Out Chits Provision (Above the Roll Call Table) */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <CalendarOff className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <div>
                      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        Leave Out Chits
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Issue an official leave out chit with student, duration (days), and reason.
                        Any student with an active leave chit is automatically marked Absent until
                        the leave period lapses.
                      </p>
                    </div>
                  </div>
                  <span className="font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
                    {visibleLeaveOutChits.filter((c) => isDateInLeaveChit(c, date)).length} active on{' '}
                    {date}
                  </span>
                </div>

                <form
                  onSubmit={handleIssueLeaveChit}
                  className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-12 sm:items-end"
                >
                  <div className="sm:col-span-4">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Student
                    </label>
                    <select
                      required
                      aria-label="Leave out chit student"
                      value={chitStudentId}
                      onChange={(e) => setChitStudentId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    >
                      {cohortStudents.length > 0 && (
                        <optgroup label={`${grade} · Stream ${section}`}>
                          {cohortStudents.map((stu) => (
                            <option key={stu.id} value={stu.id}>
                              {stu.fullName} ({stu.studentCode})
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {otherVisibleStudents.length > 0 && (
                        <optgroup
                          label={isAdmin ? 'Other Active Students' : 'Other Assigned Students'}
                        >
                          {otherVisibleStudents.map((stu) => (
                            <option key={stu.id} value={stu.id}>
                              {stu.fullName} ({stu.grade} · {stu.section})
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Start Date
                    </label>
                    <input
                      required
                      type="date"
                      aria-label="Leave start date"
                      value={chitStartDate}
                      onChange={(e) => setChitStartDate(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Number of Days
                    </label>
                    <input
                      required
                      type="number"
                      min={1}
                      max={90}
                      aria-label="Number of days"
                      value={chitDays}
                      onChange={(e) => setChitDays(Math.max(1, Number(e.target.value) || 1))}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Reason
                    </label>
                    <input
                      required
                      type="text"
                      aria-label="Leave reason"
                      value={chitReason}
                      onChange={(e) => setChitReason(e.target.value)}
                      placeholder="e.g. Medical checkup, Family leave..."
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>

                  <div className="sm:col-span-1 sm:flex sm:justify-end">
                    <button
                      type="submit"
                      disabled={chitSaving || isDateTermClosed || visibleStudentsForActor.length === 0}
                      className="inline-flex w-full items-center justify-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 sm:w-auto dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {chitSaving ? 'Issuing...' : 'Issue Chit'}
                    </button>
                  </div>
                </form>

                <p className="mt-2 font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                  Leave window: {chitStartDate || date} through {computedEndDate} ({chitDays} day
                  {chitDays === 1 ? '' : 's'}) · Automatically resumes normal roll call after{' '}
                  {computedEndDate}.
                </p>

                {visibleLeaveOutChits.length > 0 && (
                  <div className="mt-4 overflow-x-auto border-t border-slate-100 pt-3 dark:border-slate-800">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="text-[11px] font-medium text-slate-500 uppercase dark:text-slate-400">
                          <th className="py-1.5 pr-3">Student</th>
                          <th className="py-1.5 pr-3">Class</th>
                          <th className="py-1.5 pr-3">Leave Duration</th>
                          <th className="py-1.5 pr-3">Reason</th>
                          <th className="py-1.5 pr-3">Status ({date})</th>
                          <th className="py-1.5 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {visibleLeaveOutChits.map((chit) => {
                          const activeToday = isDateInLeaveChit(chit, date);
                          const lapsed = date > chit.endDate;
                          return (
                            <tr key={chit.id}>
                              <td className="py-2 pr-3 font-medium text-slate-900 dark:text-slate-100">
                                {chit.studentName}{' '}
                                <span className="font-mono text-[11px] font-normal text-slate-500 dark:text-slate-400">
                                  ({chit.studentCode})
                                </span>
                              </td>
                              <td className="py-2 pr-3 text-slate-600 dark:text-slate-400">
                                {chit.grade} · {chit.section}
                              </td>
                              <td className="py-2 pr-3 font-mono text-slate-700 tabular-nums dark:text-slate-300">
                                {chit.days}d ({chit.startDate} → {chit.endDate})
                              </td>
                              <td className="py-2 pr-3 text-slate-700 dark:text-slate-300">
                                {chit.reason}
                              </td>
                              <td className="py-2 pr-3">
                                <span
                                  className={`inline-block rounded border px-2 py-0.5 font-medium ${
                                    activeToday
                                      ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300'
                                      : lapsed
                                      ? 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
                                      : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300'
                                  }`}
                                >
                                  {activeToday
                                    ? 'Active · Marked Absent'
                                    : lapsed
                                    ? 'Lapsed'
                                    : `Starts ${chit.startDate}`}
                                </span>
                              </td>
                              <td className="py-2 text-right">
                                <div className="inline-flex items-center gap-3">
                                  <button
                                    type="button"
                                    onClick={() => setSelectedNoteChitId(chit.id)}
                                    className={`inline-flex items-center gap-1 text-xs font-medium ${
                                      officialNoteDetails?.chitId === chit.id
                                        ? 'text-blue-600 dark:text-blue-400'
                                        : 'text-slate-600 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400'
                                    }`}
                                  >
                                    <FileText className="h-3.5 w-3.5" />
                                    Note
                                  </button>
                                  <button
                                    type="button"
                                    disabled={chitSaving || isDateTermClosed}
                                    onClick={() => handleDeleteLeaveChit(chit)}
                                    aria-label={`Revoke leave chit for ${chit.studentName}`}
                                    className="inline-flex items-center gap-1 text-slate-500 hover:text-red-600 disabled:opacity-40 dark:text-slate-400 dark:hover:text-red-400"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    Revoke
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Official Leave Out Note Actions (Note itself is only viewed as downloaded PDF or on print) */}
              {officialNoteDetails && (
                <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between no-print">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          Official Leave Out Note
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Download as a PDF or print the centered official slip (
                          {officialNoteDetails.wordCount} words).
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {visibleLeaveOutChits.length > 0 && (
                        <select
                          aria-label="Select leave out chit for official note"
                          value={officialNoteDetails.chitId}
                          onChange={(e) => setSelectedNoteChitId(e.target.value)}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        >
                          {visibleLeaveOutChits.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.studentName} ({c.studentCode}) · {c.startDate}
                            </option>
                          ))}
                          <option value="draft">Current Form Draft</option>
                        </select>
                      )}

                      <button
                        type="button"
                        onClick={handleDownloadOfficialNote}
                        disabled={!officialNoteDetails.hasReason}
                        className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download PDF
                      </button>

                      <button
                        type="button"
                        onClick={handlePrintOfficialNote}
                        disabled={!officialNoteDetails.hasReason}
                        className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
                      >
                        <Printer className="h-3.5 w-3.5" />
                        Print Note
                      </button>
                    </div>
                  </div>

                  <div
                    id="leave-out-official-note-print"
                    className="hidden mx-auto max-w-2xl rounded-lg border border-slate-300 bg-white p-6 text-slate-900"
                  >
                    <TenantDocumentHeader
                      tenant={tenant}
                      documentTitle="Official Leave Out Note"
                      subtitle={`Issued: ${officialNoteDetails.currentDateLabel}`}
                      compact
                    />

                    <p className="mx-auto mt-3 max-w-xl text-center text-sm leading-relaxed text-slate-800">
                      {officialNoteDetails.bodyText}
                    </p>

                    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-slate-200 pt-3 text-center text-xs sm:grid-cols-4">
                      <div>
                        <span className="text-slate-500">Student: </span>
                        <span className="font-semibold text-slate-900">
                          {officialNoteDetails.studentName}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500">Adm No.: </span>
                        <span className="font-mono font-semibold text-slate-900 tabular-nums">
                          {officialNoteDetails.studentCode}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500">No. of Days: </span>
                        <span className="font-mono font-semibold text-slate-900 tabular-nums">
                          {officialNoteDetails.days} day{officialNoteDetails.days === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500">Expected Back: </span>
                        <span className="font-mono font-semibold text-slate-900 tabular-nums">
                          {officialNoteDetails.expectedBackLabel}
                        </span>
                      </div>
                      <div className="col-span-2 sm:col-span-4">
                        <span className="text-slate-500">Reason: </span>
                        <span className="font-medium text-slate-900">
                          {officialNoteDetails.reasonDisplay}
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-col items-center justify-center gap-1 border-t border-dashed border-slate-300 pt-3 text-center text-[11px] text-slate-600">
                      <span>Authorized by: {officialNoteDetails.issuedBy}</span>
                      <span>Official Stamp / Signature: _______________________</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Student Roll Call Table */}
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-3">Student ID</th>
                        <th className="px-4 py-3">Student Name</th>
                        <th className="px-4 py-3">Roll-Call Status</th>
                        <th className="px-4 py-3">Reason / Remarks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {cohortStudents.length === 0 ? (
                        <tr>
                          <td
                            colSpan={4}
                            className="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400"
                          >
                            No enrolled students found in {grade} Stream {section}. Enroll learners
                            or switch stream.
                          </td>
                        </tr>
                      ) : (
                        cohortStudents.map((stu) => {
                          const activeChit = activeChitByStudent.get(stu.id);
                          const entry = draft[stu.id] || {
                            status: activeChit ? 'Absent' : 'Present',
                            remarks: '',
                          };
                          const effectiveStatus: BinaryAttendanceStatus = activeChit
                            ? 'Absent'
                            : entry.status;

                          return (
                            <tr
                              key={stu.id}
                              className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30"
                            >
                              <td className="px-4 py-2.5 font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
                                {stu.studentCode}
                              </td>
                              <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                                <div>{stu.fullName}</div>
                                {activeChit && (
                                  <p className="mt-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                                    Leave Out Chit until {activeChit.endDate} ({activeChit.reason})
                                  </p>
                                )}
                              </td>
                              <td className="px-4 py-2.5">
                                <div
                                  role="radiogroup"
                                  aria-label={`Roll call status for ${stu.fullName}`}
                                  className="flex items-center gap-4"
                                >
                                  <label
                                    className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                                      activeChit
                                        ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 opacity-60 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-500'
                                        : effectiveStatus === 'Present'
                                        ? 'cursor-pointer border-emerald-600 bg-emerald-50 text-emerald-800 dark:border-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-300'
                                        : 'cursor-pointer border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                    }`}
                                  >
                                    <input
                                      type="radio"
                                      name={`rollcall-status-${stu.id}`}
                                      value="Present"
                                      disabled={Boolean(activeChit)}
                                      checked={effectiveStatus === 'Present'}
                                      onChange={() =>
                                        setDraft((prev) => ({
                                          ...prev,
                                          [stu.id]: { ...entry, status: 'Present' },
                                        }))
                                      }
                                      className="h-3.5 w-3.5 accent-emerald-600"
                                    />
                                    <span>Present</span>
                                  </label>

                                  <label
                                    className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                                      effectiveStatus === 'Absent'
                                        ? 'cursor-pointer border-red-600 bg-red-50 text-red-800 dark:border-red-500 dark:bg-red-950/40 dark:text-red-300'
                                        : 'cursor-pointer border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                    }`}
                                  >
                                    <input
                                      type="radio"
                                      name={`rollcall-status-${stu.id}`}
                                      value="Absent"
                                      disabled={Boolean(activeChit)}
                                      checked={effectiveStatus === 'Absent'}
                                      onChange={() =>
                                        setDraft((prev) => ({
                                          ...prev,
                                          [stu.id]: { ...entry, status: 'Absent' },
                                        }))
                                      }
                                      className="h-3.5 w-3.5 accent-red-600"
                                    />
                                    <span>Absent</span>
                                  </label>
                                </div>
                              </td>
                              <td className="px-4 py-2.5">
                                <input
                                  type="text"
                                  value={entry.remarks}
                                  onChange={(e) =>
                                    setDraft((prev) => ({
                                      ...prev,
                                      [stu.id]: { ...entry, remarks: e.target.value },
                                    }))
                                  }
                                  placeholder={
                                    effectiveStatus === 'Absent'
                                      ? 'Leave blank for unexcused alert...'
                                      : 'Optional note...'
                                  }
                                  className="w-full min-w-[200px] rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                />
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      ) : activeTab === 'rollcall' && isAdmin && rollCallTarget === 'teaching' ? (
        <>
          {/* Teaching Staff Roll Call Controls Bar (Admin Only) */}
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <label className="sr-only">Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <select
                aria-label="Filter teaching staff by department"
                value={teachingDept}
                onChange={(e) => setTeachingDept(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="All">All Teaching Departments</option>
                {teachingDepartments.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
              <span className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
                Present:{' '}
                <strong className="text-emerald-700 dark:text-emerald-400">
                  {teachingMetrics.present}
                </strong>{' '}
                · Absent:{' '}
                <strong className="text-red-700 dark:text-red-400">
                  {teachingMetrics.absent}
                </strong>{' '}
                · Teaching Staff:{' '}
                <strong className="text-slate-800 dark:text-slate-200">
                  {teachingMetrics.total}
                </strong>
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={markAllTeachingPresent}
                disabled={filteredTeachingStaff.length === 0}
                className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark All Present
              </button>
              <button
                type="button"
                onClick={handleSaveTeachingRollCall}
                disabled={saving || filteredTeachingStaff.length === 0}
                className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? 'Saving...' : 'Save Teaching Roll Call'}
              </button>
            </div>
          </div>

          {/* Teaching Staff Roll Call Table */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Department</th>
                    <th className="px-4 py-3">Teaching Staff Name</th>
                    <th className="px-4 py-3">Roll-Call Status</th>
                    <th className="px-4 py-3">Reason / Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredTeachingStaff.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400"
                      >
                        No teaching staff members found in{' '}
                        {teachingDept === 'All' ? 'this school' : `${teachingDept} department`}.
                      </td>
                    </tr>
                  ) : (
                    filteredTeachingStaff.map((member) => {
                      const entry = teachingDraft[member.id] || {
                        status: 'Present' as BinaryAttendanceStatus,
                        remarks: '',
                      };

                      return (
                        <tr
                          key={member.id}
                          className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30"
                        >
                          <td className="px-4 py-2.5 text-xs font-medium text-slate-600 dark:text-slate-400">
                            {member.department || 'Faculty'}
                          </td>
                          <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                            <div>{member.name}</div>
                            {(member.phone || member.email) && (
                              <p className="mt-0.5 font-mono text-[11px] font-normal text-slate-500 dark:text-slate-400">
                                {[member.phone, member.email].filter(Boolean).join(' · ')}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <div
                              role="radiogroup"
                              aria-label={`Roll call status for ${member.name}`}
                              className="flex items-center gap-4"
                            >
                              <label
                                className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                                  entry.status === 'Present'
                                    ? 'border-emerald-600 bg-emerald-50 text-emerald-800 dark:border-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-300'
                                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                }`}
                              >
                                <input
                                  type="radio"
                                  name={`teaching-rollcall-status-${member.id}`}
                                  value="Present"
                                  checked={entry.status === 'Present'}
                                  onChange={() =>
                                    setTeachingDraft((prev) => ({
                                      ...prev,
                                      [member.id]: { ...entry, status: 'Present' },
                                    }))
                                  }
                                  className="h-3.5 w-3.5 accent-emerald-600"
                                />
                                <span>Present</span>
                              </label>

                              <label
                                className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                                  entry.status === 'Absent'
                                    ? 'border-red-600 bg-red-50 text-red-800 dark:border-red-500 dark:bg-red-950/40 dark:text-red-300'
                                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                }`}
                              >
                                <input
                                  type="radio"
                                  name={`teaching-rollcall-status-${member.id}`}
                                  value="Absent"
                                  checked={entry.status === 'Absent'}
                                  onChange={() =>
                                    setTeachingDraft((prev) => ({
                                      ...prev,
                                      [member.id]: { ...entry, status: 'Absent' },
                                    }))
                                  }
                                  className="h-3.5 w-3.5 accent-red-600"
                                />
                                <span>Absent</span>
                              </label>
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <input
                              type="text"
                              value={entry.remarks}
                              onChange={(e) =>
                                setTeachingDraft((prev) => ({
                                  ...prev,
                                  [member.id]: { ...entry, remarks: e.target.value },
                                }))
                              }
                              placeholder={
                                entry.status === 'Absent'
                                  ? 'Reason for absence / lesson cover...'
                                  : 'Optional note...'
                              }
                              className="w-full min-w-[200px] rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                            />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : activeTab === 'rollcall' && isAdmin && rollCallTarget === 'non-teaching' ? (
        <>
          {/* Non-Teaching Staff Roll Call Controls Bar (Admin Only) */}
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <label className="sr-only">Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <select
                aria-label="Filter non-teaching staff by department"
                value={nonTeachingDept}
                onChange={(e) => setNonTeachingDept(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="All">All Support Departments</option>
                {nonTeachingDepartments.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
              <span className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
                Present:{' '}
                <strong className="text-emerald-700 dark:text-emerald-400">
                  {nonTeachingMetrics.present}
                </strong>{' '}
                · Absent:{' '}
                <strong className="text-red-700 dark:text-red-400">
                  {nonTeachingMetrics.absent}
                </strong>{' '}
                · Non-Teaching Staff:{' '}
                <strong className="text-slate-800 dark:text-slate-200">
                  {nonTeachingMetrics.total}
                </strong>
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAddNonTeaching((prev) => !prev)}
                className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <UserPlus className="h-3.5 w-3.5" />
                {showAddNonTeaching ? 'Close Form' : 'Add Support Staff'}
              </button>
              <button
                type="button"
                onClick={markAllNonTeachingPresent}
                disabled={filteredNonTeachingStaff.length === 0}
                className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark All Present
              </button>
              <button
                type="button"
                onClick={handleSaveNonTeachingRollCall}
                disabled={saving || filteredNonTeachingStaff.length === 0}
                className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? 'Saving...' : 'Save Non-Teaching Roll Call'}
              </button>
            </div>
          </div>

          {showAddNonTeaching && (
            <form
              onSubmit={handleAddNonTeachingStaff}
              className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-12 sm:items-end dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="sm:col-span-3">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Full Name
                </label>
                <input
                  required
                  type="text"
                  value={newStaffName}
                  onChange={(e) => setNewStaffName(e.target.value)}
                  placeholder="e.g. Samuel Njoroge"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Role / Designation
                </label>
                <input
                  required
                  type="text"
                  value={newStaffRole}
                  onChange={(e) => setNewStaffRole(e.target.value)}
                  placeholder="e.g. School Bursar, Matron, Driver"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Department
                </label>
                <input
                  type="text"
                  value={newStaffDept}
                  onChange={(e) => setNewStaffDept(e.target.value)}
                  placeholder="Support Services"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Phone
                </label>
                <input
                  type="text"
                  value={newStaffPhone}
                  onChange={(e) => setNewStaffPhone(e.target.value)}
                  placeholder="+254 7..."
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div className="sm:col-span-2 sm:flex sm:justify-end">
                <button
                  type="submit"
                  disabled={addingStaff}
                  className="inline-flex w-full items-center justify-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 sm:w-auto dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {addingStaff ? 'Adding...' : 'Add Staff'}
                </button>
              </div>
            </form>
          )}

          {/* Non-Teaching Staff Roll Call Table */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Department</th>
                    <th className="px-4 py-3">Role / Designation</th>
                    <th className="px-4 py-3">Non-Teaching Staff Name</th>
                    <th className="px-4 py-3">Roll-Call Status</th>
                    <th className="px-4 py-3">Reason / Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredNonTeachingStaff.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400"
                      >
                        No non-teaching staff members found in{' '}
                        {nonTeachingDept === 'All'
                          ? 'this school'
                          : `${nonTeachingDept} department`}
                        .
                      </td>
                    </tr>
                  ) : (
                    filteredNonTeachingStaff.map((member) => {
                      const entry = nonTeachingDraft[member.id] || {
                        status: 'Present' as BinaryAttendanceStatus,
                        remarks: '',
                      };

                      return (
                        <tr
                          key={member.id}
                          className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30"
                        >
                          <td className="px-4 py-2.5 text-xs font-medium text-slate-600 dark:text-slate-400">
                            {member.department || 'Support Services'}
                          </td>
                          <td className="px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                            {member.role}
                          </td>
                          <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                            <div>{member.name}</div>
                            {(member.phone || member.email) && (
                              <p className="mt-0.5 font-mono text-[11px] font-normal text-slate-500 dark:text-slate-400">
                                {[member.phone, member.email].filter(Boolean).join(' · ')}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <div
                              role="radiogroup"
                              aria-label={`Roll call status for ${member.name}`}
                              className="flex items-center gap-4"
                            >
                              <label
                                className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                                  entry.status === 'Present'
                                    ? 'border-emerald-600 bg-emerald-50 text-emerald-800 dark:border-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-300'
                                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                }`}
                              >
                                <input
                                  type="radio"
                                  name={`nonteaching-rollcall-status-${member.id}`}
                                  value="Present"
                                  checked={entry.status === 'Present'}
                                  onChange={() =>
                                    setNonTeachingDraft((prev) => ({
                                      ...prev,
                                      [member.id]: { ...entry, status: 'Present' },
                                    }))
                                  }
                                  className="h-3.5 w-3.5 accent-emerald-600"
                                />
                                <span>Present</span>
                              </label>

                              <label
                                className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                                  entry.status === 'Absent'
                                    ? 'border-red-600 bg-red-50 text-red-800 dark:border-red-500 dark:bg-red-950/40 dark:text-red-300'
                                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                }`}
                              >
                                <input
                                  type="radio"
                                  name={`nonteaching-rollcall-status-${member.id}`}
                                  value="Absent"
                                  checked={entry.status === 'Absent'}
                                  onChange={() =>
                                    setNonTeachingDraft((prev) => ({
                                      ...prev,
                                      [member.id]: { ...entry, status: 'Absent' },
                                    }))
                                  }
                                  className="h-3.5 w-3.5 accent-red-600"
                                />
                                <span>Absent</span>
                              </label>
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <input
                              type="text"
                              value={entry.remarks}
                              onChange={(e) =>
                                setNonTeachingDraft((prev) => ({
                                  ...prev,
                                  [member.id]: { ...entry, remarks: e.target.value },
                                }))
                              }
                              placeholder={
                                entry.status === 'Absent'
                                  ? 'Reason for absence / shift cover...'
                                  : 'Optional note...'
                              }
                              className="w-full min-w-[200px] rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                            />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : isAdmin && rollCallTarget === 'teaching' ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Teaching Staff Name</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3 text-right">Sessions Logged</th>
                  <th className="px-4 py-3 text-right">Absences</th>
                  <th className="px-4 py-3 text-right">Attendance Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {teachingSummary.map(({ member, total, absent, rate }) => (
                  <tr
                    key={member.id}
                    className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30"
                  >
                    <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                      {member.name}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">
                      {member.department}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
                      {member.phone || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-700 tabular-nums dark:text-slate-300">
                      {total}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-700 tabular-nums dark:text-slate-300">
                      {absent}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold tabular-nums">
                      <span
                        className={
                          rate < 85
                            ? 'text-red-700 dark:text-red-400'
                            : rate < 92
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-emerald-700 dark:text-emerald-400'
                        }
                      >
                        {rate}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : isAdmin && rollCallTarget === 'non-teaching' ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Non-Teaching Staff Name</th>
                  <th className="px-4 py-3">Role / Designation</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3 text-right">Sessions Logged</th>
                  <th className="px-4 py-3 text-right">Absences</th>
                  <th className="px-4 py-3 text-right">Attendance Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {nonTeachingSummary.map(({ member, total, absent, rate }) => (
                  <tr
                    key={member.id}
                    className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30"
                  >
                    <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                      {member.name}
                    </td>
                    <td className="px-4 py-2.5 text-xs font-medium text-slate-700 dark:text-slate-300">
                      {member.role}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">
                      {member.department}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
                      {member.phone || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-700 tabular-nums dark:text-slate-300">
                      {total}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-700 tabular-nums dark:text-slate-300">
                      {absent}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold tabular-nums">
                      <span
                        className={
                          rate < 85
                            ? 'text-red-700 dark:text-red-400'
                            : rate < 92
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-emerald-700 dark:text-emerald-400'
                        }
                      >
                        {rate}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : !canViewAnyStudentSummary ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-6 dark:border-amber-900/60 dark:bg-amber-950/20">
          <div className="flex items-start gap-3">
            <Lock className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" />
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Attendance Register Summary Restricted
              </h2>
              <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                {isTeacherRole
                  ? `${selectedTeacher?.name || 'This teacher'} does not currently have any assigned classes or streams.`
                  : `Student attendance registers and analytics are only visible to teachers assigned to each stream and School Admin.`}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Student Attendance Rates
              </h2>
              <p className="mt-0.5 font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
                Showing {filteredStudentSummary.length} of {studentSummary.length} student(s) · Avg Rate:{' '}
                <strong className="text-slate-800 dark:text-slate-200">{summaryAverageRate}%</strong>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5">
                <label
                  htmlFor="attendance-summary-grade"
                  className="text-xs font-medium text-slate-600 dark:text-slate-400"
                >
                  Grade
                </label>
                <select
                  id="attendance-summary-grade"
                  value={summaryGradeFilter}
                  onChange={(e) => setSummaryGradeFilter(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="All">All Grades</option>
                  {summaryGradeOptions.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <label
                  htmlFor="attendance-summary-stream"
                  className="text-xs font-medium text-slate-600 dark:text-slate-400"
                >
                  Stream
                </label>
                <select
                  id="attendance-summary-stream"
                  value={summaryStreamFilter}
                  onChange={(e) => setSummaryStreamFilter(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="All">All Streams</option>
                  {summaryStreamOptions.map((sec) => (
                    <option key={sec} value={sec}>
                      Stream {sec}
                    </option>
                  ))}
                </select>
              </div>
              {(summaryGradeFilter !== 'All' || summaryStreamFilter !== 'All') && (
                <button
                  type="button"
                  onClick={() => {
                    setSummaryGradeFilter('All');
                    setSummaryStreamFilter('All');
                  }}
                  className="whitespace-nowrap rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Student ID</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Grade &amp; Stream</th>
                  <th className="px-4 py-3 text-right">Sessions Logged</th>
                  <th className="px-4 py-3 text-right">Absences</th>
                  <th className="px-4 py-3 text-right">Attendance Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredStudentSummary.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-10 text-center text-xs text-slate-500 dark:text-slate-400"
                    >
                      No students match the selected Grade / Stream filter.
                    </td>
                  </tr>
                ) : (
                  filteredStudentSummary.map(({ student, total, absent, rate, activeChit }) => (
                    <tr
                      key={student.id}
                      className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30"
                    >
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
                        {student.studentCode}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                        <div>{student.fullName}</div>
                        {activeChit && (
                          <p className="mt-0.5 text-[11px] font-normal text-amber-700 dark:text-amber-400">
                            Leave Out Chit ({activeChit.startDate} → {activeChit.endDate})
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">
                        {student.grade} · Stream {student.section}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-700 tabular-nums dark:text-slate-300">
                        {total}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-700 tabular-nums dark:text-slate-300">
                        {absent}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold tabular-nums">
                        <span
                          className={
                            rate < 85
                              ? 'text-red-700 dark:text-red-400'
                              : rate < 92
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-emerald-700 dark:text-emerald-400'
                          }
                        >
                          {rate}%
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
