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
import { downloadTeacherLeaveChitPdf } from '../lib/pdfDocuments';
import {
  addDaysIso,
  getStreamsForGrade,
  getSubjectsForGrade,
  getTenantLessonRows,
  isDateInLeaveChit,
  isTeacherAssignedToCohort,
  type DayOfWeek,
  type LeaveOutChit,
  type TeacherLeaveOutChit,
  type TeacherLessonAttendanceRecord,
  type TeacherLessonAttendanceStatus,
  type Tenant,
  type TenantWorkspaceData,
  type UserRole,
} from '../shared/types';

interface AttendanceModuleProps {
  workspace: TenantWorkspaceData;
  currentRole: UserRole;
  readOnly?: boolean;
  onRefresh: () => Promise<void>;
  onNotify: (title: string, tone?: 'success' | 'error') => void;
}

type BinaryAttendanceStatus = 'Present' | 'Absent';
type RollCallTarget = 'student' | 'teacher-lesson' | 'teaching' | 'non-teaching';

interface TeacherLessonDraftItem {
  rowKey: string;
  id?: string;
  timetableSlotId?: string;
  periodNumber?: number;
  timeSlot: string;
  grade: string;
  section: string;
  subject: string;
  scheduledTeacherId: string;
  status: TeacherLessonAttendanceStatus;
  delegatedTeacherId: string;
  delegationNotes: string;
  originalMissedDate: string;
  recoveredDate: string;
  recoveredByTeacherId: string;
  topicCovered: string;
  remarks: string;
  isAdHoc?: boolean;
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_NAMES: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const LESSON_STATUS_OPTIONS: TeacherLessonAttendanceStatus[] = [
  'Attended',
  'Delegated',
  'Recovered',
  'Missed',
];

function resolveWeekdayFromIso(isoDate: string): DayOfWeek | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  const utcDay = parsed.getUTCDay(); // 0=Sun .. 6=Sat
  if (utcDay >= 1 && utcDay <= 5) {
    return WEEKDAY_NAMES[utcDay - 1];
  }
  return null;
}

function getPeriodTimeLabel(period?: number, tenant?: Pick<Tenant, 'bellSchedule'> | null): string {
  if (!period) return '';
  return getTenantLessonRows(tenant).find((p) => p.period === period)?.time || '';
}

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
  readOnly = false,
  onRefresh,
  onNotify,
}: AttendanceModuleProps) {
  const {
    tenant,
    students,
    attendance,
    staffAttendance = [],
    teacherLessonAttendance = [],
    leaveOutChits = [],
    teacherLeaveOutChits = [],
    timetable = [],
  } = workspace;

  const isAdmin = !readOnly && (currentRole === 'Admin' || currentRole === 'Super Admin' || currentRole === 'Developer');
  const isTeacherRole = !readOnly && currentRole === 'Teacher';
  const canUseTeacherLessonAttendance = isAdmin || isTeacherRole;
  const isReadOnlyViewer = Boolean(readOnly) || currentRole === 'Parent' || currentRole === 'Student';

  const defaultGrade = tenant.grades.includes('Grade 9')
    ? 'Grade 9'
    : tenant.grades[0] || 'Grade 9';
  const defaultStreams = getStreamsForGrade(tenant, defaultGrade);

  const [rollCallTarget, setRollCallTarget] = useState<RollCallTarget>('student');
  const [activeTab, setActiveTab] = useState<'rollcall' | 'summary'>('rollcall');
  const [date, setDate] = useState('2026-11-16');
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
  const [summaryPage, setSummaryPage] = useState(1);
  const [saving, setSaving] = useState(false);

  // Teacher Lesson Attendance filters & inline Ad-hoc/Make-up form
  const [lessonGradeFilter, setLessonGradeFilter] = useState<string>('All');
  const [lessonStreamFilter, setLessonStreamFilter] = useState<string>('All');
  const [lessonTeacherFilter, setLessonTeacherFilter] = useState<string>('All');
  const [lessonDraftMap, setLessonDraftMap] = useState<Record<string, TeacherLessonDraftItem>>({});
  const [stagedAdHocLessons, setStagedAdHocLessons] = useState<TeacherLessonDraftItem[]>([]);
  const [showAddAdHocLesson, setShowAddAdHocLesson] = useState(false);
  const [adHocGrade, setAdHocGrade] = useState<string>(defaultGrade);
  const [adHocStream, setAdHocStream] = useState<string>(defaultStreams[0] || 'A');
  const [adHocSubject, setAdHocSubject] = useState<string>(
    getSubjectsForGrade(tenant, defaultGrade)[0] || tenant.subjects[0] || 'Mathematics'
  );
  const [adHocPeriod, setAdHocPeriod] = useState<number>(1);
  const [adHocScheduledTeacherId, setAdHocScheduledTeacherId] = useState<string>(
    tenant.teachers[0]?.id || ''
  );
  const [adHocStatus, setAdHocStatus] = useState<TeacherLessonAttendanceStatus>('Recovered');
  const [adHocDelegatedTeacherId, setAdHocDelegatedTeacherId] = useState<string>('');
  const [adHocDelegationNotes, setAdHocDelegationNotes] = useState<string>('');
  const [adHocOriginalMissedDate, setAdHocOriginalMissedDate] = useState<string>('2026-11-12');
  const [adHocRecoveredDate, setAdHocRecoveredDate] = useState<string>('2026-11-16');
  const [adHocRecoveredByTeacherId, setAdHocRecoveredByTeacherId] = useState<string>(
    tenant.teachers[0]?.id || ''
  );
  const [adHocTopicCovered, setAdHocTopicCovered] = useState<string>('');
  const [adHocRemarks, setAdHocRemarks] = useState<string>('');

  // Add Non-Teaching Staff inline form (Admin only)
  const [showAddNonTeaching, setShowAddNonTeaching] = useState(false);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffRole, setNewStaffRole] = useState('');
  const [newStaffDept, setNewStaffDept] = useState('Support Services');
  const [newStaffPhone, setNewStaffPhone] = useState('');
  const [addingStaff, setAddingStaff] = useState(false);

  // Leave Out Chit form state (Student)
  const [chitStudentId, setChitStudentId] = useState('');
  const [chitStartDate, setChitStartDate] = useState('2026-11-16');
  const [chitDays, setChitDays] = useState<number>(1);
  const [chitReason, setChitReason] = useState('');
  const [chitSaving, setChitSaving] = useState(false);
  const [selectedNoteChitId, setSelectedNoteChitId] = useState<string>('');

  // Teacher Leave Out Chit with Duties Delegation state
  const [tChitTeacherId, setTChitTeacherId] = useState<string>(
    tenant.teachers[0]?.id || ''
  );
  const [tChitStartDate, setTChitStartDate] = useState<string>('2026-11-16');
  const [tChitDays, setTChitDays] = useState<number>(1);
  const [tChitReason, setTChitReason] = useState<string>('');
  const [tChitHandoverNotes, setTChitHandoverNotes] = useState<string>('');
  const [tChitEmergencyContact, setTChitEmergencyContact] = useState<string>('');
  const [tChitDelegations, setTChitDelegations] = useState<
    Array<{
      rowId: string;
      dutyTitle: string;
      delegateTeacherId: string;
      grade: string;
      section: string;
      subject: string;
      scheduleOrWindow: string;
      handoverInstructions: string;
    }>
  >(() => [
    {
      rowId: 'tdel-init-1',
      dutyTitle: '',
      delegateTeacherId: tenant.teachers[1]?.id || '',
      grade: '',
      section: '',
      subject: '',
      scheduleOrWindow: '',
      handoverInstructions: '',
    },
  ]);
  const [tChitSaving, setTChitSaving] = useState(false);
  const [selectedTeacherChitId, setSelectedTeacherChitId] = useState<string>('');

  // Enforce Admin-only viewership for Teaching and Non-Teaching Staff attendance, while allowing Teachers Student + Lesson Attendance
  useEffect(() => {
    if (!isAdmin) {
      if (!canUseTeacherLessonAttendance && rollCallTarget !== 'student') {
        setRollCallTarget('student');
      } else if (
        canUseTeacherLessonAttendance &&
        rollCallTarget !== 'student' &&
        rollCallTarget !== 'teacher-lesson'
      ) {
        setRollCallTarget('student');
      }
    }
  }, [isAdmin, canUseTeacherLessonAttendance, rollCallTarget]);

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
    setTChitStartDate(date);
  }, [date]);

  useEffect(() => {
    if (isTeacherRole && selectedTeacher?.id) {
      setTChitTeacherId(selectedTeacher.id);
    } else if (!tenant.teachers.some((t) => t.id === tChitTeacherId)) {
      setTChitTeacherId(tenant.teachers[0]?.id || '');
    }
  }, [isTeacherRole, selectedTeacher?.id, tenant.teachers, tChitTeacherId]);

  const effectiveTChitTeacherId =
    isTeacherRole && selectedTeacher ? selectedTeacher.id : tChitTeacherId;

  const visibleTeacherLeaveChits = useMemo(() => {
    if (isAdmin) return teacherLeaveOutChits;
    if (isTeacherRole && selectedTeacher) {
      return teacherLeaveOutChits.filter(
        (c) =>
          c.teacherId === selectedTeacher.id ||
          c.dutiesDelegations.some((d) => d.delegateTeacherId === selectedTeacher.id)
      );
    }
    return [];
  }, [teacherLeaveOutChits, isAdmin, isTeacherRole, selectedTeacher]);

  useEffect(() => {
    if (visibleTeacherLeaveChits.length === 0) {
      if (selectedTeacherChitId) setSelectedTeacherChitId('');
      return;
    }
    if (!visibleTeacherLeaveChits.some((c) => c.id === selectedTeacherChitId)) {
      setSelectedTeacherChitId(visibleTeacherLeaveChits[0].id);
    }
  }, [visibleTeacherLeaveChits, selectedTeacherChitId]);

  const selectedTeacherLeaveChit = useMemo(
    () =>
      visibleTeacherLeaveChits.find((c) => c.id === selectedTeacherChitId) ||
      visibleTeacherLeaveChits[0] ||
      null,
    [visibleTeacherLeaveChits, selectedTeacherChitId]
  );

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

    const attendanceByStudent = new Map<string, typeof attendance>();
    attendance.forEach((r) => {
      const list = attendanceByStudent.get(r.studentId);
      if (list) list.push(r);
      else attendanceByStudent.set(r.studentId, [r]);
    });

    return scoped.map((stu) => {
      const recs = attendanceByStudent.get(stu.id) || [];
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

  const SUMMARY_PAGE_SIZE = 50;
  const summaryTotalPages = Math.max(1, Math.ceil(filteredStudentSummary.length / SUMMARY_PAGE_SIZE));
  const safeSummaryPage = Math.min(summaryPage, summaryTotalPages);
  const paginatedStudentSummary = useMemo(
    () =>
      filteredStudentSummary.slice(
        (safeSummaryPage - 1) * SUMMARY_PAGE_SIZE,
        safeSummaryPage * SUMMARY_PAGE_SIZE
      ),
    [filteredStudentSummary, safeSummaryPage]
  );

  useEffect(() => {
    setSummaryPage(1);
  }, [tenant.id, summaryGradeFilter, summaryStreamFilter]);

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

  // --- Teacher Lesson Attendance (Scheduled Timetable + Delegation Mandate + Recovery) ---
  const selectedLessonDayOfWeek = useMemo(() => resolveWeekdayFromIso(date), [date]);

  const scheduledLessonsForDate = useMemo(() => {
    if (!selectedLessonDayOfWeek) return [];
    return timetable
      .filter((slot) => slot.day === selectedLessonDayOfWeek)
      .slice()
      .sort((a, b) => {
        if (a.period !== b.period) return a.period - b.period;
        if (a.grade !== b.grade) return a.grade.localeCompare(b.grade);
        return a.section.localeCompare(b.section);
      });
  }, [timetable, selectedLessonDayOfWeek]);

  // Sync Teacher Lesson Attendance draft whenever date, timetable, or saved records change
  useEffect(() => {
    const savedForDate = teacherLessonAttendance.filter((r) => r.date === date);
    const nextMap: Record<string, TeacherLessonDraftItem> = {};
    const matchedSavedIds = new Set<string>();

    scheduledLessonsForDate.forEach((slot) => {
      const existing = savedForDate.find((r) => r.timetableSlotId === slot.id);
      if (existing) matchedSavedIds.add(existing.id);
      const rowKey = `slot:${slot.id}`;
      nextMap[rowKey] = {
        rowKey,
        id: existing?.id,
        timetableSlotId: slot.id,
        periodNumber: existing?.periodNumber ?? slot.period,
        timeSlot: existing?.timeSlot || getPeriodTimeLabel(slot.period),
        grade: slot.grade,
        section: slot.section,
        subject: slot.subject,
        scheduledTeacherId: existing?.scheduledTeacherId || slot.teacherId,
        status: existing?.status || 'Attended',
        delegatedTeacherId: existing?.delegatedTeacherId || '',
        delegationNotes: existing?.delegationNotes || '',
        originalMissedDate: existing?.originalMissedDate || '',
        recoveredDate: existing?.recoveredDate || date,
        recoveredByTeacherId: existing?.recoveredByTeacherId || slot.teacherId,
        topicCovered: existing?.topicCovered || '',
        remarks: existing?.remarks || '',
        isAdHoc: false,
      };
    });

    // Include any saved ad-hoc/recovered records for this date without a matching timetable slot on that weekday
    savedForDate
      .filter((r) => !matchedSavedIds.has(r.id))
      .forEach((rec) => {
        const rowKey = `rec:${rec.id}`;
        nextMap[rowKey] = {
          rowKey,
          id: rec.id,
          timetableSlotId: rec.timetableSlotId,
          periodNumber: rec.periodNumber,
          timeSlot: rec.timeSlot || getPeriodTimeLabel(rec.periodNumber),
          grade: rec.grade,
          section: rec.section,
          subject: rec.subject,
          scheduledTeacherId: rec.scheduledTeacherId,
          status: rec.status,
          delegatedTeacherId: rec.delegatedTeacherId || '',
          delegationNotes: rec.delegationNotes || '',
          originalMissedDate: rec.originalMissedDate || '',
          recoveredDate: rec.recoveredDate || date,
          recoveredByTeacherId: rec.recoveredByTeacherId || rec.scheduledTeacherId,
          topicCovered: rec.topicCovered || '',
          remarks: rec.remarks || '',
          isAdHoc: true,
        };
      });

    // Re-attach unsaved staged ad-hoc items created by the user for this date
    stagedAdHocLessons
      .filter((item) => item.recoveredDate === date || item.isAdHoc)
      .forEach((item) => {
        if (!nextMap[item.rowKey]) {
          nextMap[item.rowKey] = item;
        }
      });

    setLessonDraftMap(nextMap);
    setAdHocRecoveredDate(date);
  }, [date, scheduledLessonsForDate, teacherLessonAttendance]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setStagedAdHocLessons([]);
  }, [date, tenant.id]);

  useEffect(() => {
    if (isTeacherRole && selectedTeacher) {
      setAdHocScheduledTeacherId(selectedTeacher.id);
      setAdHocRecoveredByTeacherId(selectedTeacher.id);
    } else if (!tenant.teachers.some((t) => t.id === adHocScheduledTeacherId)) {
      const firstId = tenant.teachers[0]?.id || '';
      setAdHocScheduledTeacherId(firstId);
      setAdHocRecoveredByTeacherId(firstId);
    }
  }, [isTeacherRole, selectedTeacher, tenant.teachers, adHocScheduledTeacherId]);

  const lessonStreamOptions = useMemo(() => {
    if (lessonGradeFilter === 'All') {
      return Array.from(
        new Set(tenant.grades.flatMap((g) => getStreamsForGrade(tenant, g)))
      );
    }
    return getStreamsForGrade(tenant, lessonGradeFilter);
  }, [tenant, lessonGradeFilter]);

  useEffect(() => {
    if (lessonStreamFilter !== 'All' && !lessonStreamOptions.includes(lessonStreamFilter)) {
      setLessonStreamFilter('All');
    }
  }, [lessonStreamFilter, lessonStreamOptions]);

  const visibleLessonDraftRows = useMemo(() => {
    const rows = Object.values(lessonDraftMap);
    return rows
      .filter((row) => {
        if (isTeacherRole && selectedTeacher) {
          const permitted =
            row.scheduledTeacherId === selectedTeacher.id ||
            row.delegatedTeacherId === selectedTeacher.id ||
            row.recoveredByTeacherId === selectedTeacher.id ||
            isTeacherAssignedToCohort(selectedTeacher, row.grade, row.section, timetable);
          if (!permitted) return false;
        }
        if (lessonGradeFilter !== 'All' && row.grade !== lessonGradeFilter) return false;
        if (lessonStreamFilter !== 'All' && row.section !== lessonStreamFilter) return false;
        if (
          lessonTeacherFilter !== 'All' &&
          row.scheduledTeacherId !== lessonTeacherFilter &&
          row.delegatedTeacherId !== lessonTeacherFilter &&
          row.recoveredByTeacherId !== lessonTeacherFilter
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const pa = a.periodNumber ?? 99;
        const pb = b.periodNumber ?? 99;
        if (pa !== pb) return pa - pb;
        if (a.grade !== b.grade) return a.grade.localeCompare(b.grade);
        return a.section.localeCompare(b.section);
      });
  }, [
    lessonDraftMap,
    isTeacherRole,
    selectedTeacher,
    timetable,
    lessonGradeFilter,
    lessonStreamFilter,
    lessonTeacherFilter,
  ]);

  const lessonMetrics = useMemo(() => {
    let attended = 0;
    let delegated = 0;
    let recovered = 0;
    let missed = 0;
    visibleLessonDraftRows.forEach((row) => {
      if (row.status === 'Attended') attended += 1;
      else if (row.status === 'Delegated') delegated += 1;
      else if (row.status === 'Recovered') recovered += 1;
      else missed += 1;
    });
    return {
      total: visibleLessonDraftRows.length,
      attended,
      delegated,
      recovered,
      missed,
    };
  }, [visibleLessonDraftRows]);

  const teacherLessonSummary = useMemo(() => {
    const teachersToSummarize =
      isTeacherRole && selectedTeacher ? [selectedTeacher] : tenant.teachers;
    return teachersToSummarize.map((member) => {
      const ownRecs = teacherLessonAttendance.filter(
        (r) => r.scheduledTeacherId === member.id
      );
      const mandatesReceived = teacherLessonAttendance.filter(
        (r) => r.status === 'Delegated' && r.delegatedTeacherId === member.id
      ).length;
      const attended = ownRecs.filter((r) => r.status === 'Attended').length;
      const delegated = ownRecs.filter((r) => r.status === 'Delegated').length;
      const recovered = ownRecs.filter((r) => r.status === 'Recovered').length;
      const missed = ownRecs.filter((r) => r.status === 'Missed').length;
      const total = ownRecs.length;
      const delivered = attended + delegated + recovered;
      const deliveryRate = total > 0 ? Math.round((delivered / total) * 1000) / 10 : 100;
      return {
        member,
        total,
        attended,
        delegated,
        mandatesReceived,
        recovered,
        missed,
        deliveryRate,
      };
    });
  }, [tenant.teachers, teacherLessonAttendance, isTeacherRole, selectedTeacher]);

  const lessonAuditLogs = useMemo(() => {
    return teacherLessonAttendance
      .filter((r) => {
        if (isTeacherRole && selectedTeacher) {
          const involves =
            r.scheduledTeacherId === selectedTeacher.id ||
            r.delegatedTeacherId === selectedTeacher.id ||
            r.recoveredByTeacherId === selectedTeacher.id;
          if (!involves) return false;
        }
        return r.status === 'Delegated' || r.status === 'Recovered' || r.status === 'Missed';
      })
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [teacherLessonAttendance, isTeacherRole, selectedTeacher]);

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

  function updateLessonDraft(rowKey: string, patch: Partial<TeacherLessonDraftItem>) {
    setLessonDraftMap((prev) => {
      const current = prev[rowKey];
      if (!current) return prev;
      const updated = { ...current, ...patch };
      if (patch.status === 'Recovered' && !updated.recoveredDate) {
        updated.recoveredDate = date;
      }
      if (patch.status === 'Recovered' && !updated.recoveredByTeacherId) {
        updated.recoveredByTeacherId = updated.scheduledTeacherId;
      }
      return { ...prev, [rowKey]: updated };
    });
  }

  function markVisibleLessonsAttended() {
    if (!canUseTeacherLessonAttendance || isDateTermClosed) return;
    setLessonDraftMap((prev) => {
      const next = { ...prev };
      visibleLessonDraftRows.forEach((row) => {
        next[row.rowKey] = {
          ...row,
          status: 'Attended',
        };
      });
      return next;
    });
  }

  function handleStageAdHocLesson(e: React.FormEvent) {
    e.preventDefault();
    if (!canUseTeacherLessonAttendance) return;
    if (!adHocScheduledTeacherId) {
      onNotify('Select the scheduled teacher for this lesson.', 'error');
      return;
    }
    if (adHocStatus === 'Delegated') {
      if (!adHocDelegatedTeacherId) {
        onNotify('Select the teacher given the mandate for a delegated lesson.', 'error');
        return;
      }
      if (adHocDelegatedTeacherId === adHocScheduledTeacherId) {
        onNotify('Delegated mandate teacher must differ from the scheduled teacher.', 'error');
        return;
      }
    }
    if (adHocStatus === 'Recovered') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(adHocOriginalMissedDate)) {
        onNotify('Enter the Original Missed Date (YYYY-MM-DD) for a recovered lesson.', 'error');
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(adHocRecoveredDate || date)) {
        onNotify('Enter a valid Recovery Date (YYYY-MM-DD).', 'error');
        return;
      }
    }
    const rowKey = `adhoc:${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newItem: TeacherLessonDraftItem = {
      rowKey,
      periodNumber: adHocPeriod,
      timeSlot: getPeriodTimeLabel(adHocPeriod),
      grade: adHocGrade,
      section: adHocStream,
      subject: adHocSubject,
      scheduledTeacherId: adHocScheduledTeacherId,
      status: adHocStatus,
      delegatedTeacherId: adHocStatus === 'Delegated' ? adHocDelegatedTeacherId : '',
      delegationNotes: adHocStatus === 'Delegated' ? adHocDelegationNotes.trim() : '',
      originalMissedDate: adHocStatus === 'Recovered' ? adHocOriginalMissedDate : '',
      recoveredDate: adHocStatus === 'Recovered' ? adHocRecoveredDate || date : '',
      recoveredByTeacherId:
        adHocStatus === 'Recovered'
          ? adHocRecoveredByTeacherId || adHocScheduledTeacherId
          : '',
      topicCovered: adHocTopicCovered.trim(),
      remarks: adHocRemarks.trim(),
      isAdHoc: true,
    };
    setStagedAdHocLessons((prev) => [newItem, ...prev]);
    setLessonDraftMap((prev) => ({ [rowKey]: newItem, ...prev }));
    setShowAddAdHocLesson(false);
    setAdHocDelegationNotes('');
    setAdHocTopicCovered('');
    setAdHocRemarks('');
    onNotify(`Added ${adHocGrade} ${adHocStream} ${adHocSubject} to ${date} register. Click Save Lesson Attendance to persist.`);
  }

  async function handleSaveTeacherLessons() {
    if (!canUseTeacherLessonAttendance || visibleLessonDraftRows.length === 0) return;

    for (const row of visibleLessonDraftRows) {
      if (row.status === 'Delegated') {
        if (!row.delegatedTeacherId) {
          onNotify(
            `Select the teacher given the mandate for ${row.grade} Stream ${row.section} ${row.subject}.`,
            'error'
          );
          return;
        }
        if (row.delegatedTeacherId === row.scheduledTeacherId) {
          onNotify(
            `Mandate teacher for ${row.grade} Stream ${row.section} ${row.subject} must be different from the scheduled teacher.`,
            'error'
          );
          return;
        }
      }
      if (row.status === 'Recovered') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(row.originalMissedDate)) {
          onNotify(
            `Specify the Original Missed Date for recovered lesson ${row.grade} Stream ${row.section} ${row.subject}.`,
            'error'
          );
          return;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(row.recoveredDate || date)) {
          onNotify(
            `Specify a valid Recovery Date for ${row.grade} Stream ${row.section} ${row.subject}.`,
            'error'
          );
          return;
        }
      }
    }

    setSaving(true);
    try {
      await saasApi.saveTeacherLessonAttendanceBatch(tenant.id, {
        date,
        entries: visibleLessonDraftRows.map((row) => ({
          id: row.id,
          timetableSlotId: row.timetableSlotId,
          periodNumber: row.periodNumber,
          timeSlot: row.timeSlot || undefined,
          grade: row.grade,
          section: row.section,
          subject: row.subject,
          scheduledTeacherId: row.scheduledTeacherId,
          status: row.status,
          delegatedTeacherId: row.status === 'Delegated' ? row.delegatedTeacherId : undefined,
          delegationNotes:
            row.status === 'Delegated' && row.delegationNotes.trim()
              ? row.delegationNotes.trim()
              : undefined,
          originalMissedDate: row.status === 'Recovered' ? row.originalMissedDate : undefined,
          recoveredDate: row.status === 'Recovered' ? row.recoveredDate || date : undefined,
          recoveredPeriod: row.status === 'Recovered' ? row.periodNumber : undefined,
          recoveredByTeacherId:
            row.status === 'Recovered'
              ? row.recoveredByTeacherId || row.scheduledTeacherId
              : undefined,
          topicCovered: row.topicCovered.trim() || undefined,
          remarks: row.remarks.trim() || undefined,
        })),
      });
      setStagedAdHocLessons([]);
      await onRefresh();
      onNotify(
        `Saved ${visibleLessonDraftRows.length} teacher lesson attendance record(s) for ${date}.`
      );
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to save teacher lesson attendance',
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

  function handleAddTeacherDutyRow() {
    const defaultDelegate =
      tenant.teachers.find((t) => t.id !== effectiveTChitTeacherId)?.id || '';
    setTChitDelegations((prev) => [
      ...prev,
      {
        rowId: `tdel-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        dutyTitle: '',
        delegateTeacherId: defaultDelegate,
        grade: '',
        section: '',
        subject: '',
        scheduleOrWindow: '',
        handoverInstructions: '',
      },
    ]);
  }

  function handleAutoLoadTeacherDuties() {
    if (!effectiveTChitTeacherId) {
      onNotify('Select a teacher first.', 'error');
      return;
    }
    const targetTeacher = tenant.teachers.find((t) => t.id === effectiveTChitTeacherId);
    const otherTeachers = tenant.teachers.filter((t) => t.id !== effectiveTChitTeacherId);
    const sameDeptDelegate =
      otherTeachers.find((t) => t.department === targetTeacher?.department) ||
      otherTeachers[0];
    const defaultDelegateId = sameDeptDelegate?.id || '';

    const weekdaysInWindow = new Set<DayOfWeek>();
    const safeDays = Math.max(1, Math.min(30, tChitDays || 1));
    for (let i = 0; i < safeDays; i++) {
      const wd = resolveWeekdayFromIso(addDaysIso(tChitStartDate || date, i));
      if (wd) weekdaysInWindow.add(wd);
    }

    const teacherSlots = timetable.filter((s) => s.teacherId === effectiveTChitTeacherId);
    const matchedSlots =
      weekdaysInWindow.size > 0
        ? teacherSlots.filter((s) => weekdaysInWindow.has(s.day))
        : teacherSlots;

    if (matchedSlots.length === 0) {
      onNotify(
        `No scheduled timetable slots found for ${targetTeacher?.name || 'teacher'} in that window. Add duties manually below.`,
        'error'
      );
      return;
    }

    setTChitDelegations(
      matchedSlots.map((slot, idx) => ({
        rowId: `tdel-slot-${slot.id}-${idx}`,
        dutyTitle: `${slot.subject} Lesson (${slot.grade} ${slot.section})`,
        delegateTeacherId: defaultDelegateId,
        grade: slot.grade,
        section: slot.section,
        subject: slot.subject,
        scheduleOrWindow: `${slot.day} P${slot.period}`,
        handoverInstructions: `Cover ${slot.subject} Period ${slot.period} per scheme of work.`,
      }))
    );
    onNotify(
      `Loaded ${matchedSlots.length} scheduled lesson(s) for ${targetTeacher?.name || 'teacher'}. Confirm or adjust covering teachers.`
    );
  }

  async function handleIssueTeacherLeaveChit(e: React.FormEvent) {
    e.preventDefault();
    if (!canUseTeacherLessonAttendance) return;
    if (!effectiveTChitTeacherId) {
      onNotify('Select the teacher taking leave.', 'error');
      return;
    }
    if (!tChitReason.trim()) {
      onNotify('Enter the reason for teacher leave.', 'error');
      return;
    }

    const validDelegations = tChitDelegations
      .map((d) => ({
        dutyTitle: d.dutyTitle.trim(),
        delegateTeacherId: d.delegateTeacherId,
        grade: d.grade.trim() || undefined,
        section: d.section.trim() || undefined,
        subject: d.subject.trim() || undefined,
        scheduleOrWindow: d.scheduleOrWindow.trim() || undefined,
        handoverInstructions: d.handoverInstructions.trim() || undefined,
      }))
      .filter((d) => d.dutyTitle.length > 0 || d.delegateTeacherId.length > 0);

    if (validDelegations.length === 0) {
      onNotify(
        'Include at least one delegated duty and covering teacher before issuing a teacher leave out chit.',
        'error'
      );
      return;
    }

    for (const del of validDelegations) {
      if (!del.dutyTitle) {
        onNotify('Every delegation row must specify the duty or lesson being delegated.', 'error');
        return;
      }
      if (!del.delegateTeacherId) {
        onNotify(`Select a covering teacher for "${del.dutyTitle}".`, 'error');
        return;
      }
      if (del.delegateTeacherId === effectiveTChitTeacherId) {
        onNotify('Covering teacher must be different from the teacher going on leave.', 'error');
        return;
      }
    }

    setTChitSaving(true);
    try {
      const actorLabel =
        isTeacherRole && selectedTeacher ? selectedTeacher.name : `${currentRole} Desk`;
      const { chit } = await saasApi.createTeacherLeaveOutChit(tenant.id, {
        teacherId: effectiveTChitTeacherId,
        startDate: tChitStartDate || date,
        days: Math.max(1, tChitDays || 1),
        reason: tChitReason.trim(),
        handoverNotes: tChitHandoverNotes.trim() || undefined,
        emergencyContact: tChitEmergencyContact.trim() || undefined,
        issuedBy: actorLabel,
        dutiesDelegations: validDelegations,
      });
      await onRefresh();
      setSelectedTeacherChitId(chit.id);
      setTChitReason('');
      setTChitHandoverNotes('');
      setTChitDays(1);
      setTChitDelegations([
        {
          rowId: `tdel-reset-${Date.now()}`,
          dutyTitle: '',
          delegateTeacherId:
            tenant.teachers.find((t) => t.id !== effectiveTChitTeacherId)?.id || '',
          grade: '',
          section: '',
          subject: '',
          scheduleOrWindow: '',
          handoverInstructions: '',
        },
      ]);
      onNotify(
        `Teacher leave out chit issued for ${chit.teacherName} (${chit.dutiesDelegations.length} delegated duty mandate(s) synced).`
      );
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to issue teacher leave out chit',
        'error'
      );
    } finally {
      setTChitSaving(false);
    }
  }

  async function handleDeleteTeacherLeaveChit(chit: TeacherLeaveOutChit) {
    if (!canUseTeacherLessonAttendance) return;
    setTChitSaving(true);
    try {
      await saasApi.deleteTeacherLeaveOutChit(tenant.id, chit.id);
      await onRefresh();
      onNotify(`Revoked teacher leave out chit for ${chit.teacherName}.`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to revoke teacher leave out chit',
        'error'
      );
    } finally {
      setTChitSaving(false);
    }
  }

  async function handleDownloadTeacherLeavePdf(chit: TeacherLeaveOutChit) {
    try {
      const fileName = await downloadTeacherLeaveChitPdf(tenant, chit);
      onNotify(`Downloaded Teacher Leave Out Chit PDF (${fileName}).`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Unable to generate Teacher Leave Chit PDF',
        'error'
      );
    }
  }

  function handlePrintTeacherLeaveChit(chit: TeacherLeaveOutChit) {
    setSelectedTeacherChitId(chit.id);
    setTimeout(() => {
      document.body.classList.add('print-teacher-leave-note-only');
      const cleanup = () => {
        document.body.classList.remove('print-teacher-leave-note-only');
        window.removeEventListener('afterprint', cleanup);
      };
      window.addEventListener('afterprint', cleanup);
      window.print();
      setTimeout(cleanup, 1500);
    }, 40);
  }

  const summaryTabLabel =
    canUseTeacherLessonAttendance && rollCallTarget === 'teacher-lesson'
      ? 'Lesson Delivery Rates'
      : isAdmin && rollCallTarget === 'teaching'
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
              ? 'Student register marking, Teacher Lesson Attendance (with delegation mandates & recovery logs), plus Teaching and Non-Teaching Staff roll calls.'
              : isTeacherRole
              ? 'Student register marking and Teacher Lesson Attendance (attended, delegated mandate, or recovered lessons) for your assigned cohorts.'
              : 'Student register marking is restricted to assigned class/subject teachers and School Admin.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {canUseTeacherLessonAttendance ? (
            <select
              aria-label="Select roll call type"
              value={rollCallTarget}
              onChange={(e) => setRollCallTarget(e.target.value as RollCallTarget)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="student">Student Roll Call</option>
              <option value="teacher-lesson">Teacher Lesson Attendance</option>
              {isAdmin && <option value="teaching">Teaching Staff Roll Call</option>}
              {isAdmin && <option value="non-teaching">Non-Teaching Staff Roll Call</option>}
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
      ) : activeTab === 'rollcall' && canUseTeacherLessonAttendance && rollCallTarget === 'teacher-lesson' ? (
        <>
          {/* Teacher Lesson Attendance Controls Bar */}
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center gap-2.5">
              {isTeacherRole && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Teacher:
                  </span>
                  <select
                    aria-label="Acting teacher profile for lesson attendance"
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

              <div className="flex items-center gap-2">
                <label className="sr-only">Lesson Date</label>
                <input
                  type="date"
                  aria-label="Teacher lesson attendance date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  {selectedLessonDayOfWeek || 'Weekend (Ad-Hoc Only)'}
                </span>
              </div>

              <select
                aria-label="Filter lessons by grade"
                value={lessonGradeFilter}
                onChange={(e) => setLessonGradeFilter(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="All">All Grades</option>
                {tenant.grades.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>

              <select
                aria-label="Filter lessons by stream"
                value={lessonStreamFilter}
                onChange={(e) => setLessonStreamFilter(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="All">All Streams</option>
                {lessonStreamOptions.map((sec) => (
                  <option key={sec} value={sec}>
                    Stream {sec}
                  </option>
                ))}
              </select>

              {isAdmin && (
                <select
                  aria-label="Filter lessons by teacher"
                  value={lessonTeacherFilter}
                  onChange={(e) => setLessonTeacherFilter(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="All">All Teachers</option>
                  {tenant.teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}

              <span className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
                Attended:{' '}
                <strong className="text-emerald-700 dark:text-emerald-400">
                  {lessonMetrics.attended}
                </strong>{' '}
                · Delegated:{' '}
                <strong className="text-blue-700 dark:text-blue-400">
                  {lessonMetrics.delegated}
                </strong>{' '}
                · Recovered:{' '}
                <strong className="text-amber-700 dark:text-amber-400">
                  {lessonMetrics.recovered}
                </strong>{' '}
                · Missed:{' '}
                <strong className="text-red-700 dark:text-red-400">
                  {lessonMetrics.missed}
                </strong>
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={isDateTermClosed}
                onClick={() => setShowAddAdHocLesson((prev) => !prev)}
                className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <Plus className="h-3.5 w-3.5" />
                {showAddAdHocLesson ? 'Close Make-Up Form' : 'Log Make-Up / Ad-Hoc Lesson'}
              </button>
              <button
                type="button"
                onClick={markVisibleLessonsAttended}
                disabled={visibleLessonDraftRows.length === 0 || isDateTermClosed}
                className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark Visible Attended
              </button>
              <button
                type="button"
                onClick={handleSaveTeacherLessons}
                disabled={saving || visibleLessonDraftRows.length === 0 || isDateTermClosed}
                className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? 'Saving...' : 'Save Lesson Attendance'}
              </button>
            </div>
          </div>

          {showAddAdHocLesson && (
            <form
              onSubmit={handleStageAdHocLesson}
              className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5 dark:border-slate-800">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Log Make-Up, Recovered, or Ad-Hoc Lesson ({date})
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Add a recovered lesson for an earlier missed session or an extra remedial period, or delegate a covering teacher.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Grade
                  </label>
                  <select
                    value={adHocGrade}
                    onChange={(e) => {
                      const nextG = e.target.value;
                      const nextStreams = getStreamsForGrade(tenant, nextG);
                      const nextSubs = getSubjectsForGrade(tenant, nextG);
                      setAdHocGrade(nextG);
                      if (!nextStreams.includes(adHocStream)) setAdHocStream(nextStreams[0] || 'A');
                      if (!nextSubs.includes(adHocSubject)) setAdHocSubject(nextSubs[0] || 'Mathematics');
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
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
                    Stream
                  </label>
                  <select
                    value={adHocStream}
                    onChange={(e) => setAdHocStream(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {getStreamsForGrade(tenant, adHocGrade).map((sec) => (
                      <option key={sec} value={sec}>
                        Stream {sec}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Subject
                  </label>
                  <select
                    value={adHocSubject}
                    onChange={(e) => setAdHocSubject(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {getSubjectsForGrade(tenant, adHocGrade).map((sub) => (
                      <option key={sub} value={sub}>
                        {sub}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Period
                  </label>
                  <select
                    value={adHocPeriod}
                    onChange={(e) => setAdHocPeriod(Number(e.target.value) || 1)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 tabular-nums dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {getTenantLessonRows(tenant).map((p) => (
                      <option key={p.period} value={p.period}>
                        P{p.period} ({p.time})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Scheduled Teacher
                  </label>
                  <select
                    disabled={isTeacherRole}
                    value={adHocScheduledTeacherId}
                    onChange={(e) => setAdHocScheduledTeacherId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {tenant.teachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Lesson Status
                  </label>
                  <select
                    value={adHocStatus}
                    onChange={(e) => setAdHocStatus(e.target.value as TeacherLessonAttendanceStatus)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {LESSON_STATUS_OPTIONS.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {adHocStatus === 'Delegated' && (
                <div className="grid grid-cols-1 gap-3 rounded-lg border border-blue-200 bg-blue-50/50 p-3 sm:grid-cols-2 dark:border-blue-900/60 dark:bg-blue-950/20">
                  <div>
                    <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Mandate Given To (Covering Teacher) *
                    </label>
                    <select
                      required
                      value={adHocDelegatedTeacherId}
                      onChange={(e) => setAdHocDelegatedTeacherId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    >
                      <option value="">Select covering teacher...</option>
                      {tenant.teachers
                        .filter((t) => t.id !== adHocScheduledTeacherId)
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.department})
                          </option>
                        ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Delegation Notes / Handover Instructions
                    </label>
                    <input
                      type="text"
                      value={adHocDelegationNotes}
                      onChange={(e) => setAdHocDelegationNotes(e.target.value)}
                      placeholder="e.g. Guided worksheet and class exercise supervised"
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                </div>
              )}

              {adHocStatus === 'Recovered' && (
                <div className="grid grid-cols-1 gap-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3 sm:grid-cols-3 dark:border-amber-900/60 dark:bg-amber-950/20">
                  <div>
                    <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Original Missed Date *
                    </label>
                    <input
                      required
                      type="date"
                      value={adHocOriginalMissedDate}
                      onChange={(e) => setAdHocOriginalMissedDate(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Recovery Date *
                    </label>
                    <input
                      required
                      type="date"
                      value={adHocRecoveredDate}
                      onChange={(e) => setAdHocRecoveredDate(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Recovered By Teacher
                    </label>
                    <select
                      value={adHocRecoveredByTeacherId}
                      onChange={(e) => setAdHocRecoveredByTeacherId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    >
                      {tenant.teachers.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 sm:items-end">
                <div className="sm:col-span-5">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Topic Covered
                  </label>
                  <input
                    type="text"
                    value={adHocTopicCovered}
                    onChange={(e) => setAdHocTopicCovered(e.target.value)}
                    placeholder="e.g. Algebra Make-Up Revision / Linear Graphs"
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div className="sm:col-span-5">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Remarks
                  </label>
                  <input
                    type="text"
                    value={adHocRemarks}
                    onChange={(e) => setAdHocRemarks(e.target.value)}
                    placeholder="Optional delivery or recovery remark..."
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div className="sm:col-span-2 sm:flex sm:justify-end">
                  <button
                    type="submit"
                    className="inline-flex w-full items-center justify-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 sm:w-auto dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add to Register
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* Teacher Lesson Attendance Register Table */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Period &amp; Time</th>
                    <th className="px-4 py-3">Class &amp; Subject</th>
                    <th className="px-4 py-3">Scheduled Teacher</th>
                    <th className="px-4 py-3">Delivery Status</th>
                    <th className="px-4 py-3">Mandate / Recovery &amp; Topic Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {visibleLessonDraftRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400"
                      >
                        {selectedLessonDayOfWeek
                          ? `No timetable lessons match the current filter for ${selectedLessonDayOfWeek} (${date}). Use "Log Make-Up / Ad-Hoc Lesson" above to record an unscheduled or recovered lesson.`
                          : `${date} falls on a weekend. Use "Log Make-Up / Ad-Hoc Lesson" above to record a Saturday/make-up or recovered lesson.`}
                      </td>
                    </tr>
                  ) : (
                    visibleLessonDraftRows.map((row) => {
                      const scheduledTeacher = tenant.teachers.find(
                        (t) => t.id === row.scheduledTeacherId
                      );
                      const coveringCandidates = tenant.teachers.filter(
                        (t) => t.id !== row.scheduledTeacherId
                      );
                      return (
                        <tr
                          key={row.rowKey}
                          className="align-top hover:bg-slate-50/60 dark:hover:bg-slate-800/30"
                        >
                          <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-slate-700 tabular-nums dark:text-slate-300">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              {row.periodNumber ? `Period ${row.periodNumber}` : 'Ad-Hoc'}
                            </div>
                            {row.timeSlot && (
                              <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                {row.timeSlot}
                              </div>
                            )}
                            {row.isAdHoc && (
                              <div className="mt-0.5 text-[11px] font-sans font-medium text-amber-700 dark:text-amber-400">
                                Make-Up / Ad-Hoc
                              </div>
                            )}
                          </td>

                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              {row.subject}
                            </div>
                            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                              {row.grade} · Stream {row.section}
                            </div>
                          </td>

                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="font-medium text-slate-900 dark:text-slate-100">
                              {scheduledTeacher?.name || 'Assigned Teacher'}
                            </div>
                            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                              {scheduledTeacher?.department || 'Faculty'}
                            </div>
                          </td>

                          <td className="px-4 py-3 whitespace-nowrap">
                            <select
                              aria-label={`Lesson delivery status for ${row.grade} ${row.section} ${row.subject}`}
                              disabled={isDateTermClosed}
                              value={row.status}
                              onChange={(e) =>
                                updateLessonDraft(row.rowKey, {
                                  status: e.target.value as TeacherLessonAttendanceStatus,
                                })
                              }
                              className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold focus:outline-none ${
                                row.status === 'Attended'
                                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                                  : row.status === 'Delegated'
                                  ? 'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                                  : row.status === 'Recovered'
                                  ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                                  : 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300'
                              }`}
                            >
                              {LESSON_STATUS_OPTIONS.map((st) => (
                                <option key={st} value={st}>
                                  {st}
                                </option>
                              ))}
                            </select>
                          </td>

                          <td className="px-4 py-3 min-w-[320px] space-y-2">
                            {row.status === 'Delegated' && (
                              <div className="grid grid-cols-1 gap-2 rounded-lg border border-blue-200 bg-blue-50/50 p-2.5 sm:grid-cols-2 dark:border-blue-900/60 dark:bg-blue-950/20">
                                <div>
                                  <label className="block text-[11px] font-semibold text-blue-950 dark:text-blue-200">
                                    Mandate Given To *
                                  </label>
                                  <select
                                    aria-label={`Mandate teacher for ${row.subject} ${row.grade}`}
                                    disabled={isDateTermClosed}
                                    value={row.delegatedTeacherId}
                                    onChange={(e) =>
                                      updateLessonDraft(row.rowKey, {
                                        delegatedTeacherId: e.target.value,
                                      })
                                    }
                                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                  >
                                    <option value="">Select covering teacher...</option>
                                    {coveringCandidates.map((t) => (
                                      <option key={t.id} value={t.id}>
                                        {t.name}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300">
                                    Delegation Notes
                                  </label>
                                  <input
                                    type="text"
                                    disabled={isDateTermClosed}
                                    value={row.delegationNotes}
                                    onChange={(e) =>
                                      updateLessonDraft(row.rowKey, {
                                        delegationNotes: e.target.value,
                                      })
                                    }
                                    placeholder="Handover instructions / task left..."
                                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                  />
                                </div>
                              </div>
                            )}

                            {row.status === 'Recovered' && (
                              <div className="grid grid-cols-1 gap-2 rounded-lg border border-amber-200 bg-amber-50/50 p-2.5 sm:grid-cols-3 dark:border-amber-900/60 dark:bg-amber-950/20">
                                <div>
                                  <label className="block text-[11px] font-semibold text-amber-950 dark:text-amber-200">
                                    Original Missed Date *
                                  </label>
                                  <input
                                    type="date"
                                    aria-label={`Original missed date for ${row.subject}`}
                                    disabled={isDateTermClosed}
                                    value={row.originalMissedDate}
                                    onChange={(e) =>
                                      updateLessonDraft(row.rowKey, {
                                        originalMissedDate: e.target.value,
                                      })
                                    }
                                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                  />
                                </div>
                                <div>
                                  <label className="block text-[11px] font-semibold text-amber-950 dark:text-amber-200">
                                    Recovered Date *
                                  </label>
                                  <input
                                    type="date"
                                    aria-label={`Recovery date for ${row.subject}`}
                                    disabled={isDateTermClosed}
                                    value={row.recoveredDate || date}
                                    onChange={(e) =>
                                      updateLessonDraft(row.rowKey, {
                                        recoveredDate: e.target.value,
                                      })
                                    }
                                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                  />
                                </div>
                                <div>
                                  <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300">
                                    Recovered By
                                  </label>
                                  <select
                                    disabled={isDateTermClosed}
                                    value={row.recoveredByTeacherId || row.scheduledTeacherId}
                                    onChange={(e) =>
                                      updateLessonDraft(row.rowKey, {
                                        recoveredByTeacherId: e.target.value,
                                      })
                                    }
                                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                  >
                                    {tenant.teachers.map((t) => (
                                      <option key={t.id} value={t.id}>
                                        {t.name}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            )}

                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                              <input
                                type="text"
                                disabled={isDateTermClosed}
                                value={row.topicCovered}
                                onChange={(e) =>
                                  updateLessonDraft(row.rowKey, { topicCovered: e.target.value })
                                }
                                placeholder="Topic / sub-strand covered..."
                                className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                              />
                              <input
                                type="text"
                                disabled={isDateTermClosed}
                                value={row.remarks}
                                onChange={(e) =>
                                  updateLessonDraft(row.rowKey, { remarks: e.target.value })
                                }
                                placeholder={
                                  row.status === 'Missed'
                                    ? 'Reason missed & planned recovery slot...'
                                    : 'Optional delivery note...'
                                }
                                className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                              />
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

          {/* Teacher Leave Out Chit & Duties Delegation Panel */}
          {(() => {
            const tChitEndDate = addDaysIso(tChitStartDate || date, Math.max(1, tChitDays) - 1);
            const tOtherCandidates = tenant.teachers.filter(
              (t) => t.id !== effectiveTChitTeacherId
            );
            return (
              <div className="space-y-4">
                <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex flex-col gap-2 border-b border-slate-100 pb-3 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
                    <div className="flex items-start gap-2.5">
                      <CalendarOff className="mt-0.5 h-4 w-4 text-blue-600 dark:text-blue-400" />
                      <div>
                        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          Teacher Leave Out Chit &amp; Duties Delegation
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Issue an official teacher leave out chit with structured duty &amp; lesson delegations. Active leave auto-marks staff roll call Absent and sets scheduled lessons to Delegated.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleAutoLoadTeacherDuties}
                      disabled={isDateTermClosed || !effectiveTChitTeacherId}
                      className="inline-flex items-center gap-1.5 self-start whitespace-nowrap shrink-0 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-40 sm:self-auto dark:border-blue-800/70 dark:bg-blue-950/40 dark:text-blue-300"
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      Auto-Load Timetable Lessons
                    </button>
                  </div>

                  <form onSubmit={handleIssueTeacherLeaveChit} className="mt-4 space-y-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                      <div className="sm:col-span-3">
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                          Teacher Taking Leave *
                        </label>
                        <select
                          aria-label="Teacher taking leave"
                          disabled={isTeacherRole || isDateTermClosed}
                          value={effectiveTChitTeacherId}
                          onChange={(e) => setTChitTeacherId(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 disabled:opacity-70 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        >
                          {tenant.teachers.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name} ({t.department})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                          Start Date *
                        </label>
                        <input
                          required
                          type="date"
                          aria-label="Teacher leave start date"
                          disabled={isDateTermClosed}
                          value={tChitStartDate}
                          onChange={(e) => setTChitStartDate(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                          Days *
                        </label>
                        <input
                          required
                          type="number"
                          min={1}
                          max={90}
                          aria-label="Teacher leave duration days"
                          disabled={isDateTermClosed}
                          value={tChitDays}
                          onChange={(e) => setTChitDays(Math.max(1, Number(e.target.value) || 1))}
                          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono text-xs text-slate-900 tabular-nums dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                          Reason for Leave *
                        </label>
                        <input
                          required
                          type="text"
                          aria-label="Teacher leave reason"
                          disabled={isDateTermClosed}
                          value={tChitReason}
                          onChange={(e) => setTChitReason(e.target.value)}
                          placeholder="e.g. KNEC Workshop, Medical Appointment..."
                          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                          Emergency Phone
                        </label>
                        <input
                          type="text"
                          disabled={isDateTermClosed}
                          value={tChitEmergencyContact}
                          onChange={(e) => setTChitEmergencyContact(e.target.value)}
                          placeholder="+254 7..."
                          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        />
                      </div>
                    </div>

                    {/* Structured Duties Delegation Rows */}
                    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2.5 dark:border-slate-800 dark:bg-slate-950/40">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                            Mandatory Duties &amp; Lesson Delegations ({tChitDelegations.length})
                          </span>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            Assign every class, duty-on-week role, or club/co-curricular responsibility to a covering teacher.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={handleAddTeacherDutyRow}
                          disabled={isDateTermClosed}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                        >
                          <Plus className="h-3 w-3" />
                          Add Duty Row
                        </button>
                      </div>

                      <div className="space-y-2">
                        {tChitDelegations.map((del, idx) => (
                          <div
                            key={del.rowId}
                            className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-white p-2.5 sm:grid-cols-12 sm:items-end dark:border-slate-800 dark:bg-slate-900"
                          >
                            <div className="sm:col-span-3">
                              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                                Duty / Lesson #{idx + 1} *
                              </label>
                              <input
                                type="text"
                                aria-label={`Delegated duty title ${idx + 1}`}
                                disabled={isDateTermClosed}
                                value={del.dutyTitle}
                                onChange={(e) =>
                                  setTChitDelegations((prev) =>
                                    prev.map((row) =>
                                      row.rowId === del.rowId
                                        ? { ...row, dutyTitle: e.target.value }
                                        : row
                                    )
                                  )
                                }
                                placeholder="e.g. Grade 9 Mathematics P2 / Games Duty"
                                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                              />
                            </div>
                            <div className="sm:col-span-3">
                              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                                Covering Mandate Teacher *
                              </label>
                              <select
                                aria-label={`Delegate teacher ${idx + 1}`}
                                disabled={isDateTermClosed}
                                value={del.delegateTeacherId}
                                onChange={(e) =>
                                  setTChitDelegations((prev) =>
                                    prev.map((row) =>
                                      row.rowId === del.rowId
                                        ? { ...row, delegateTeacherId: e.target.value }
                                        : row
                                    )
                                  )
                                }
                                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                              >
                                <option value="">Select covering teacher...</option>
                                {tOtherCandidates.map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.name} ({t.department})
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="sm:col-span-2">
                              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                                Window / Period
                              </label>
                              <input
                                type="text"
                                disabled={isDateTermClosed}
                                value={del.scheduleOrWindow}
                                onChange={(e) =>
                                  setTChitDelegations((prev) =>
                                    prev.map((row) =>
                                      row.rowId === del.rowId
                                        ? { ...row, scheduleOrWindow: e.target.value }
                                        : row
                                    )
                                  )
                                }
                                placeholder="e.g. Mon P2 / Full Week"
                                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                              />
                            </div>
                            <div className="sm:col-span-3">
                              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                                Handover Instructions
                              </label>
                              <input
                                type="text"
                                disabled={isDateTermClosed}
                                value={del.handoverInstructions}
                                onChange={(e) =>
                                  setTChitDelegations((prev) =>
                                    prev.map((row) =>
                                      row.rowId === del.rowId
                                        ? { ...row, handoverInstructions: e.target.value }
                                        : row
                                    )
                                  )
                                }
                                placeholder="Worksheet, exercise book location..."
                                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                              />
                            </div>
                            <div className="sm:col-span-1 sm:flex sm:justify-end">
                              <button
                                type="button"
                                disabled={tChitDelegations.length <= 1 || isDateTermClosed}
                                onClick={() =>
                                  setTChitDelegations((prev) =>
                                    prev.filter((row) => row.rowId !== del.rowId)
                                  )
                                }
                                aria-label={`Remove duty row ${idx + 1}`}
                                className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30 dark:hover:bg-rose-950/30"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                          General Handover &amp; Materials Note (Optional)
                        </label>
                        <input
                          type="text"
                          disabled={isDateTermClosed}
                          value={tChitHandoverNotes}
                          onChange={(e) => setTChitHandoverNotes(e.target.value)}
                          placeholder="e.g. Keys and marked scripts placed in Staffroom Locker 4."
                          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        />
                        <p className="mt-1 font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                          Leave window: {tChitStartDate || date} → {tChitEndDate} ({tChitDays} day
                          {tChitDays === 1 ? '' : 's'})
                        </p>
                      </div>
                      <button
                        type="submit"
                        disabled={tChitSaving || isDateTermClosed}
                        className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-700"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        {tChitSaving ? 'Issuing Chit...' : 'Issue Teacher Leave Chit'}
                      </button>
                    </div>
                  </form>

                  {/* Teacher Leave Out Chits Register Table */}
                  {visibleTeacherLeaveChits.length > 0 && (
                    <div className="mt-5 overflow-x-auto border-t border-slate-100 pt-4 dark:border-slate-800">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="text-[11px] font-medium uppercase text-slate-500 dark:text-slate-400">
                            <th className="py-2 pr-3">Teacher</th>
                            <th className="py-2 pr-3">Window</th>
                            <th className="py-2 pr-3">Reason</th>
                            <th className="py-2 pr-3">Duties Delegated &amp; Mandate Holders</th>
                            <th className="py-2 pr-3">Status ({date})</th>
                            <th className="py-2 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {visibleTeacherLeaveChits.map((chit) => {
                            const activeToday = isDateInLeaveChit(chit, date);
                            const lapsed = date > chit.endDate;
                            const canDelete =
                              isAdmin ||
                              (isTeacherRole &&
                                selectedTeacher &&
                                chit.teacherId === selectedTeacher.id);
                            return (
                              <tr key={chit.id} className="align-top">
                                <td className="py-2.5 pr-3">
                                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                                    {chit.teacherName}
                                  </div>
                                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                    {chit.department}
                                  </div>
                                </td>
                                <td className="py-2.5 pr-3 font-mono text-slate-700 tabular-nums whitespace-nowrap dark:text-slate-300">
                                  {chit.days}d ({chit.startDate} → {chit.endDate})
                                </td>
                                <td className="py-2.5 pr-3 text-slate-700 dark:text-slate-300">
                                  <div>{chit.reason}</div>
                                  {chit.handoverNotes && (
                                    <div className="mt-0.5 text-[11px] text-slate-500">
                                      Handover: {chit.handoverNotes}
                                    </div>
                                  )}
                                </td>
                                <td className="py-2.5 pr-3">
                                  <ul className="space-y-1">
                                    {chit.dutiesDelegations.map((del) => (
                                      <li
                                        key={del.id}
                                        className="rounded border border-blue-200/80 bg-blue-50/50 px-2 py-1 text-[11px] dark:border-blue-900/60 dark:bg-blue-950/20"
                                      >
                                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                                          {del.dutyTitle}
                                        </span>{' '}
                                        →{' '}
                                        <span className="font-semibold text-blue-700 dark:text-blue-300">
                                          {del.delegateTeacherName}
                                        </span>
                                        {del.scheduleOrWindow && (
                                          <span className="ml-1 font-mono text-slate-500">
                                            ({del.scheduleOrWindow})
                                          </span>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                </td>
                                <td className="py-2.5 pr-3 whitespace-nowrap">
                                  <span
                                    className={`inline-block rounded border px-2 py-0.5 text-[11px] font-medium ${
                                      activeToday
                                        ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300'
                                        : lapsed
                                        ? 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
                                        : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300'
                                    }`}
                                  >
                                    {activeToday
                                      ? 'Active · Lessons Delegated'
                                      : lapsed
                                      ? 'Lapsed'
                                      : `Starts ${chit.startDate}`}
                                  </span>
                                </td>
                                <td className="py-2.5 text-right whitespace-nowrap">
                                  <div className="inline-flex items-center gap-2.5">
                                    <button
                                      type="button"
                                      onClick={() => void handleDownloadTeacherLeavePdf(chit)}
                                      className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:underline dark:text-rose-400"
                                    >
                                      <Download className="h-3.5 w-3.5" />
                                      PDF
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handlePrintTeacherLeaveChit(chit)}
                                      className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400"
                                    >
                                      <Printer className="h-3.5 w-3.5" />
                                      Print
                                    </button>
                                    {canDelete && (
                                      <button
                                        type="button"
                                        disabled={tChitSaving || isDateTermClosed}
                                        onClick={() => void handleDeleteTeacherLeaveChit(chit)}
                                        className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-red-600 disabled:opacity-40 dark:text-slate-400 dark:hover:text-red-400"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                        Revoke
                                      </button>
                                    )}
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

                {/* Official Printable Teacher Leave Out Chit & Delegation Slip */}
                {selectedTeacherLeaveChit && (
                  <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between no-print">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        <div>
                          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            Official Teacher Leave Out Chit &amp; Delegation Slip
                          </h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Includes full duty &amp; lesson mandate schedule and handover sign-off.
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          aria-label="Select teacher leave chit for PDF or print"
                          value={selectedTeacherLeaveChit.id}
                          onChange={(e) => setSelectedTeacherChitId(e.target.value)}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        >
                          {visibleTeacherLeaveChits.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.teacherName} · {c.startDate} ({c.dutiesDelegations.length} duties)
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() =>
                            void handleDownloadTeacherLeavePdf(selectedTeacherLeaveChit)
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Download PDF
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePrintTeacherLeaveChit(selectedTeacherLeaveChit)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <Printer className="h-3.5 w-3.5" />
                          Print Chit
                        </button>
                      </div>
                    </div>

                    <div
                      id="teacher-leave-official-note-print"
                      className="hidden mx-auto max-w-3xl rounded-lg border border-slate-300 bg-white p-6 text-slate-900"
                    >
                      <TenantDocumentHeader
                        tenant={tenant}
                        documentTitle="Official Teacher Leave Out Chit & Duties Delegation"
                        subtitle={`Issued: ${formatOfficialDate(
                          selectedTeacherLeaveChit.createdAt.slice(0, 10)
                        )} · Department: ${selectedTeacherLeaveChit.department}`}
                        rightMeta={[
                          { label: 'Chit Ref', value: selectedTeacherLeaveChit.id.toUpperCase() },
                          {
                            label: 'Duration',
                            value: `${selectedTeacherLeaveChit.days} Day${
                              selectedTeacherLeaveChit.days === 1 ? '' : 's'
                            }`,
                          },
                        ]}
                        compact
                      />
                      <div className="mt-3 grid grid-cols-2 gap-3 border-b border-slate-200 pb-3 text-xs sm:grid-cols-3">
                        <div>
                          <span className="text-slate-500">Teacher on Leave:</span>{' '}
                          <strong>{selectedTeacherLeaveChit.teacherName}</strong>
                        </div>
                        <div>
                          <span className="text-slate-500">Leave Window:</span>{' '}
                          <strong className="font-mono">
                            {formatOfficialDate(selectedTeacherLeaveChit.startDate)} →{' '}
                            {formatOfficialDate(selectedTeacherLeaveChit.endDate)}
                          </strong>
                        </div>
                        <div>
                          <span className="text-slate-500">Authorized By:</span>{' '}
                          <strong>{selectedTeacherLeaveChit.issuedBy}</strong>
                        </div>
                        <div className="col-span-2 sm:col-span-3">
                          <span className="text-slate-500">Reason:</span>{' '}
                          <span>{selectedTeacherLeaveChit.reason}</span>
                        </div>
                      </div>
                      <table className="mt-3 w-full text-left text-xs border border-slate-200">
                        <thead className="bg-slate-50 text-[11px] uppercase text-slate-600">
                          <tr>
                            <th className="px-2.5 py-2">#</th>
                            <th className="px-2.5 py-2">Duty / Lesson Delegated</th>
                            <th className="px-2.5 py-2">Mandate Holder</th>
                            <th className="px-2.5 py-2">Schedule</th>
                            <th className="px-2.5 py-2">Handover Instructions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {selectedTeacherLeaveChit.dutiesDelegations.map((del, idx) => (
                            <tr key={del.id}>
                              <td className="px-2.5 py-1.5 font-mono">{idx + 1}</td>
                              <td className="px-2.5 py-1.5 font-semibold">{del.dutyTitle}</td>
                              <td className="px-2.5 py-1.5">{del.delegateTeacherName}</td>
                              <td className="px-2.5 py-1.5 font-mono">
                                {del.scheduleOrWindow || 'Full Leave Period'}
                              </td>
                              <td className="px-2.5 py-1.5">
                                {del.handoverInstructions || 'Follow scheme of work.'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="mt-5 grid grid-cols-2 gap-4 border-t border-dashed border-slate-300 pt-3 text-[11px] text-slate-600">
                        <span>Applicant Teacher Signature: ____________________</span>
                        <span>Delegate Acceptance: ____________________</span>
                        <span>Authorized By ({selectedTeacherLeaveChit.issuedBy}): ____________________</span>
                        <span>Official Stamp: ____________________</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
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

          {visibleTeacherLeaveChits.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Teacher Leave Out Chits &amp; Duties Delegation ({visibleTeacherLeaveChits.length})
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Teachers with active leave chits are automatically marked Absent above; manage delegations or download official chits in Teacher Lesson Attendance.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setRollCallTarget('teacher-lesson')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-800/70 dark:bg-blue-950/40 dark:text-blue-300"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Issue / Manage Leave Chits
                </button>
              </div>
            </div>
          )}
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
      ) : canUseTeacherLessonAttendance && rollCallTarget === 'teacher-lesson' ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Logged Lessons
              </p>
              <p className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
                {teacherLessonSummary.reduce((sum, r) => sum + r.total, 0)}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Across {teacherLessonSummary.length} teaching staff profile(s)
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Direct Attendance
              </p>
              <p className="mt-2 font-mono text-2xl font-bold text-emerald-700 tabular-nums dark:text-emerald-400">
                {teacherLessonSummary.reduce((sum, r) => sum + r.attended, 0)}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Delivered by scheduled teacher
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Delegated (Mandate)
              </p>
              <p className="mt-2 font-mono text-2xl font-bold text-blue-700 tabular-nums dark:text-blue-400">
                {teacherLessonSummary.reduce((sum, r) => sum + r.delegated, 0)}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Covered via signed teacher mandate
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Recovered / Missed
              </p>
              <p className="mt-2 font-mono text-2xl font-bold text-amber-700 tabular-nums dark:text-amber-400">
                {teacherLessonSummary.reduce((sum, r) => sum + r.recovered, 0)}
                <span className="ml-2 text-sm font-semibold text-red-700 dark:text-red-400">
                  / {teacherLessonSummary.reduce((sum, r) => sum + r.missed, 0)} missed
                </span>
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Make-up sessions logged vs unrecovered
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Teacher Lesson Delivery Compliance
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Tracks scheduled lessons delivered directly, delegated to a covering teacher, recovered on a make-up date, or missed.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Teacher</th>
                    <th className="px-4 py-3">Department</th>
                    <th className="px-4 py-3 text-right">Logged</th>
                    <th className="px-4 py-3 text-right">Attended</th>
                    <th className="px-4 py-3 text-right">Delegated Out</th>
                    <th className="px-4 py-3 text-right">Mandates Covered</th>
                    <th className="px-4 py-3 text-right">Recovered</th>
                    <th className="px-4 py-3 text-right">Missed</th>
                    <th className="px-4 py-3 text-right">Delivery Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {teacherLessonSummary.map((row) => (
                    <tr
                      key={row.member.id}
                      className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30"
                    >
                      <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                        {row.member.name}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-600 dark:text-slate-400">
                        {row.member.department}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-700 tabular-nums dark:text-slate-300">
                        {row.total}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-emerald-700 tabular-nums dark:text-emerald-400">
                        {row.attended}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-blue-700 tabular-nums dark:text-blue-400">
                        {row.delegated}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-700 tabular-nums dark:text-slate-300">
                        {row.mandatesReceived}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-amber-700 tabular-nums dark:text-amber-400">
                        {row.recovered}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-red-700 tabular-nums dark:text-red-400">
                        {row.missed}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold tabular-nums">
                        <span
                          className={
                            row.deliveryRate < 85
                              ? 'text-red-700 dark:text-red-400'
                              : row.deliveryRate < 94
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-emerald-700 dark:text-emerald-400'
                          }
                        >
                          {row.deliveryRate}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Delegation Mandate &amp; Lesson Recovery Audit Log
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {lessonAuditLogs.length} delegated, recovered, or missed lesson record(s)
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Date &amp; Period</th>
                    <th className="px-4 py-3">Class &amp; Subject</th>
                    <th className="px-4 py-3">Scheduled Teacher</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Mandate / Recovery Record</th>
                    <th className="px-4 py-3">Topic &amp; Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {lessonAuditLogs.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-10 text-center text-xs text-slate-500 dark:text-slate-400"
                      >
                        No delegated, recovered, or missed lessons recorded yet.
                      </td>
                    </tr>
                  ) : (
                    lessonAuditLogs.map((rec: TeacherLessonAttendanceRecord) => (
                      <tr
                        key={rec.id}
                        className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30"
                      >
                        <td className="px-4 py-2.5 whitespace-nowrap font-mono text-xs text-slate-700 tabular-nums dark:text-slate-300">
                          <div>{rec.date}</div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {rec.periodNumber ? `Period ${rec.periodNumber}` : 'Ad-Hoc'}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {rec.subject}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {rec.grade} · Stream {rec.section}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-xs font-medium text-slate-800 dark:text-slate-200">
                          {rec.scheduledTeacherName}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-xs font-semibold">
                          <span
                            className={
                              rec.status === 'Delegated'
                                ? 'text-blue-700 dark:text-blue-400'
                                : rec.status === 'Recovered'
                                ? 'text-amber-700 dark:text-amber-400'
                                : 'text-red-700 dark:text-red-400'
                            }
                          >
                            {rec.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-700 dark:text-slate-300">
                          {rec.status === 'Delegated' ? (
                            <div>
                              <span className="font-semibold text-blue-800 dark:text-blue-300">
                                Mandate → {rec.delegatedTeacherName}
                              </span>
                              {rec.delegationNotes && (
                                <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                  {rec.delegationNotes}
                                </div>
                              )}
                            </div>
                          ) : rec.status === 'Recovered' ? (
                            <div>
                              <span className="font-mono text-[11px] tabular-nums">
                                Missed {rec.originalMissedDate} → Recovered {rec.recoveredDate || rec.date}
                              </span>
                              {rec.recoveredByTeacherName && (
                                <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                  Recovered by: {rec.recoveredByTeacherName}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-red-700 dark:text-red-400">
                              Awaiting recovery slot
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-600 dark:text-slate-400">
                          <div>{rec.topicCovered || '—'}</div>
                          {rec.remarks && (
                            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                              {rec.remarks}
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
        </div>
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
                  paginatedStudentSummary.map(({ student, total, absent, rate, activeChit }) => (
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
          {filteredStudentSummary.length > SUMMARY_PAGE_SIZE && (
            <div className="flex flex-col gap-2 border-t border-slate-200 px-5 py-3 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:text-slate-400">
              <span className="font-mono tabular-nums">
                Showing {(safeSummaryPage - 1) * SUMMARY_PAGE_SIZE + 1}–
                {Math.min(safeSummaryPage * SUMMARY_PAGE_SIZE, filteredStudentSummary.length)} of{' '}
                {filteredStudentSummary.length} students
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={safeSummaryPage <= 1}
                  onClick={() => setSummaryPage((p) => Math.max(1, p - 1))}
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  Previous
                </button>
                <span className="font-mono tabular-nums">
                  Page {safeSummaryPage} / {summaryTotalPages}
                </span>
                <button
                  type="button"
                  disabled={safeSummaryPage >= summaryTotalPages}
                  onClick={() => setSummaryPage((p) => Math.min(summaryTotalPages, p + 1))}
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
