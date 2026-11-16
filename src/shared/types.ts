export const KENYAN_CBC_GRADES = [
  'Playgroup',
  'PP1',
  'PP2',
  'Grade 1',
  'Grade 2',
  'Grade 3',
  'Grade 4',
  'Grade 5',
  'Grade 6',
  'Grade 7',
  'Grade 8',
  'Grade 9',
  'Grade 10',
  'Grade 11',
  'Grade 12',
] as const;

export type CbcClusterId =
  | 'pre_school'
  | 'lower_primary'
  | 'upper_primary'
  | 'junior_school'
  | 'senior_school';

export interface CbcClusterDefinition {
  id: CbcClusterId;
  label: string;
  rangeLabel: string;
  grades: string[];
  singleClassTeacher: boolean;
}

export const KENYAN_CBC_CLUSTERS: CbcClusterDefinition[] = [
  {
    id: 'pre_school',
    label: 'Pre-School',
    rangeLabel: 'Playgroup – PP2',
    grades: ['Playgroup', 'PP1', 'PP2'],
    singleClassTeacher: true,
  },
  {
    id: 'lower_primary',
    label: 'Lower Primary',
    rangeLabel: 'Grade 1 – Grade 3',
    grades: ['Grade 1', 'Grade 2', 'Grade 3'],
    singleClassTeacher: true,
  },
  {
    id: 'upper_primary',
    label: 'Upper Primary',
    rangeLabel: 'Grade 4 – Grade 6',
    grades: ['Grade 4', 'Grade 5', 'Grade 6'],
    singleClassTeacher: false,
  },
  {
    id: 'junior_school',
    label: 'Junior School',
    rangeLabel: 'Grade 7 – Grade 9',
    grades: ['Grade 7', 'Grade 8', 'Grade 9'],
    singleClassTeacher: false,
  },
  {
    id: 'senior_school',
    label: 'Senior School',
    rangeLabel: 'Grade 10 – Grade 12',
    grades: ['Grade 10', 'Grade 11', 'Grade 12'],
    singleClassTeacher: false,
  },
];

export const CLASS_TEACHER_SUBJECT_TOKEN = 'All Subjects (Class Teacher)';

export function isSingleTeacherGrade(grade: string): boolean {
  const norm = grade.trim().toLowerCase();
  return (
    norm === 'playgroup' ||
    norm === 'pp1' ||
    norm === 'pp2' ||
    norm === 'grade 1' ||
    norm === 'grade 2' ||
    norm === 'grade 3' ||
    /^pre[- ]?primary/i.test(norm) ||
    /^(nursery|baby class|kg)\b/i.test(norm)
  );
}

export interface KenyanSubjectPreset {
  name: string;
  lessonsPerWeek: number;
}

export const KENYAN_CBC_LEVEL_SUBJECTS: Record<CbcClusterId, KenyanSubjectPreset[]> = {
  pre_school: [
    { name: 'Language Activities', lessonsPerWeek: 5 },
    { name: 'Mathematical Activities', lessonsPerWeek: 5 },
    { name: 'Environmental Activities', lessonsPerWeek: 5 },
    { name: 'Psychomotor & Creative Activities', lessonsPerWeek: 5 },
    { name: 'Religious Education Activities', lessonsPerWeek: 5 },
  ],
  lower_primary: [
    { name: 'English', lessonsPerWeek: 5 },
    { name: 'Kiswahili', lessonsPerWeek: 4 },
    { name: 'Indigenous Language', lessonsPerWeek: 2 },
    { name: 'Mathematics', lessonsPerWeek: 5 },
    { name: 'Environmental Activities', lessonsPerWeek: 4 },
    { name: 'Creative Activities', lessonsPerWeek: 6 },
    { name: 'Religious Education (CRE / IRE / HRE)', lessonsPerWeek: 3 },
  ],
  upper_primary: [
    { name: 'English', lessonsPerWeek: 5 },
    { name: 'Kiswahili', lessonsPerWeek: 4 },
    { name: 'Mathematics', lessonsPerWeek: 5 },
    { name: 'Science & Technology', lessonsPerWeek: 4 },
    { name: 'Agriculture & Nutrition', lessonsPerWeek: 4 },
    { name: 'Social Studies', lessonsPerWeek: 3 },
    { name: 'Creative Arts', lessonsPerWeek: 6 },
    { name: 'Religious Education (CRE / IRE / HRE)', lessonsPerWeek: 3 },
  ],
  junior_school: [
    { name: 'English', lessonsPerWeek: 5 },
    { name: 'Kiswahili', lessonsPerWeek: 4 },
    { name: 'Mathematics', lessonsPerWeek: 5 },
    { name: 'Integrated Science', lessonsPerWeek: 5 },
    { name: 'Social Studies', lessonsPerWeek: 4 },
    { name: 'Agriculture & Nutrition', lessonsPerWeek: 4 },
    { name: 'Pre-Technical Studies', lessonsPerWeek: 4 },
    { name: 'Creative Arts & Sports', lessonsPerWeek: 5 },
    { name: 'Religious Education (CRE / IRE / HRE)', lessonsPerWeek: 3 },
  ],
  senior_school: [
    { name: 'English', lessonsPerWeek: 5 },
    { name: 'Kiswahili', lessonsPerWeek: 4 },
    { name: 'Core Mathematics', lessonsPerWeek: 5 },
    { name: 'Community Service Learning (CSL)', lessonsPerWeek: 2 },
    { name: 'Physical Education (PE)', lessonsPerWeek: 2 },
    { name: 'Biology', lessonsPerWeek: 3 },
    { name: 'Chemistry', lessonsPerWeek: 3 },
    { name: 'Physics', lessonsPerWeek: 3 },
    { name: 'Computer Studies', lessonsPerWeek: 3 },
    { name: 'Business Studies', lessonsPerWeek: 3 },
    { name: 'History & Citizenship', lessonsPerWeek: 3 },
    { name: 'Geography', lessonsPerWeek: 2 },
    { name: 'Religious Education (CRE / IRE / HRE)', lessonsPerWeek: 2 },
  ],
};

export const KENYAN_CBC_SUBJECTS: string[] = Array.from(
  new Set(
    Object.values(KENYAN_CBC_LEVEL_SUBJECTS).flatMap((list) => list.map((s) => s.name))
  )
);

export const DEFAULT_SUBJECT_WEEKLY_LESSONS: Record<string, number> = Object.fromEntries(
  Object.values(KENYAN_CBC_LEVEL_SUBJECTS)
    .flat()
    .map((item) => [item.name, item.lessonsPerWeek])
);

export function buildDefaultLevelSubjectsMap(): Record<CbcClusterId, string[]> {
  return {
    pre_school: KENYAN_CBC_LEVEL_SUBJECTS.pre_school.map((s) => s.name),
    lower_primary: KENYAN_CBC_LEVEL_SUBJECTS.lower_primary.map((s) => s.name),
    upper_primary: KENYAN_CBC_LEVEL_SUBJECTS.upper_primary.map((s) => s.name),
    junior_school: KENYAN_CBC_LEVEL_SUBJECTS.junior_school.map((s) => s.name),
    senior_school: KENYAN_CBC_LEVEL_SUBJECTS.senior_school.map((s) => s.name),
  };
}

export function buildDefaultLevelWeeklyLessonsMap(): Record<CbcClusterId, Record<string, number>> {
  return {
    pre_school: Object.fromEntries(
      KENYAN_CBC_LEVEL_SUBJECTS.pre_school.map((s) => [s.name, s.lessonsPerWeek])
    ),
    lower_primary: Object.fromEntries(
      KENYAN_CBC_LEVEL_SUBJECTS.lower_primary.map((s) => [s.name, s.lessonsPerWeek])
    ),
    upper_primary: Object.fromEntries(
      KENYAN_CBC_LEVEL_SUBJECTS.upper_primary.map((s) => [s.name, s.lessonsPerWeek])
    ),
    junior_school: Object.fromEntries(
      KENYAN_CBC_LEVEL_SUBJECTS.junior_school.map((s) => [s.name, s.lessonsPerWeek])
    ),
    senior_school: Object.fromEntries(
      KENYAN_CBC_LEVEL_SUBJECTS.senior_school.map((s) => [s.name, s.lessonsPerWeek])
    ),
  };
}

export function getClusterForGrade(grade: string): CbcClusterId {
  const norm = grade.trim().toLowerCase();
  if (
    norm === 'playgroup' ||
    norm === 'pp1' ||
    norm === 'pp2' ||
    /^pre[- ]?(primary|school)|^(nursery|baby class|kg)\b/i.test(norm)
  ) {
    return 'pre_school';
  }
  const match = norm.match(/\bgrade\s*(\d+)\b/i);
  if (match) {
    const num = Number(match[1]);
    if (num >= 1 && num <= 3) return 'lower_primary';
    if (num >= 4 && num <= 6) return 'upper_primary';
    if (num >= 7 && num <= 9) return 'junior_school';
    if (num >= 10 && num <= 12) return 'senior_school';
  }
  if (/form\s*[1-4]/i.test(norm)) return 'senior_school';
  return 'junior_school';
}

export const ALL_REGISTERED_SUBJECTS_OPTION = '__ALL_REGISTERED__';

export const STANDARD_ASSESSMENT_TYPES = [
  'Term Opening Exam',
  'Mid-Term Exam',
  'End of Term Exam',
] as const;

export type AssessmentGradingSystem = 'CBE' | '8-4-4';

export interface AssessmentGradeBand {
  grade: string;
  points: number;
  minScore: number;
  maxScore: number;
  label: string;
}

export const CBE_GRADING_SCALE: AssessmentGradeBand[] = [
  { grade: 'EE1', points: 8, minScore: 90, maxScore: 100, label: 'Exceeding Expectations 1' },
  { grade: 'EE2', points: 7, minScore: 75, maxScore: 89, label: 'Exceeding Expectations 2' },
  { grade: 'ME1', points: 6, minScore: 58, maxScore: 74, label: 'Meeting Expectations 1' },
  { grade: 'ME2', points: 5, minScore: 41, maxScore: 57, label: 'Meeting Expectations 2' },
  { grade: 'AE1', points: 4, minScore: 31, maxScore: 40, label: 'Approaching Expectations 1' },
  { grade: 'AE2', points: 3, minScore: 21, maxScore: 30, label: 'Approaching Expectations 2' },
  { grade: 'BE1', points: 2, minScore: 11, maxScore: 20, label: 'Below Expectations 1' },
  { grade: 'BE2', points: 1, minScore: 0, maxScore: 10, label: 'Below Expectations 2' },
];

export const KCSE_844_GRADING_SCALE: AssessmentGradeBand[] = [
  { grade: 'A', points: 12, minScore: 80, maxScore: 100, label: 'Distinction' },
  { grade: 'A-', points: 11, minScore: 75, maxScore: 79, label: 'Distinction' },
  { grade: 'B+', points: 10, minScore: 70, maxScore: 74, label: 'Credit' },
  { grade: 'B', points: 9, minScore: 65, maxScore: 69, label: 'Credit' },
  { grade: 'B-', points: 8, minScore: 60, maxScore: 64, label: 'Credit' },
  { grade: 'C+', points: 7, minScore: 55, maxScore: 59, label: 'Credit' },
  { grade: 'C', points: 6, minScore: 50, maxScore: 54, label: 'Pass' },
  { grade: 'C-', points: 5, minScore: 45, maxScore: 49, label: 'Pass' },
  { grade: 'D+', points: 4, minScore: 40, maxScore: 44, label: 'Pass' },
  { grade: 'D', points: 3, minScore: 35, maxScore: 39, label: 'Pass' },
  { grade: 'D-', points: 2, minScore: 30, maxScore: 34, label: 'Weak Pass' },
  { grade: 'E', points: 1, minScore: 0, maxScore: 29, label: 'Fail' },
];

export function is844FormFourGrade(grade: string): boolean {
  const norm = grade.trim().toLowerCase();
  return /^grade\s*12\b/.test(norm) || /^form\s*(4|four)\b/.test(norm);
}

export function getAssessmentGradingSystem(grade: string): AssessmentGradingSystem {
  return is844FormFourGrade(grade) ? '8-4-4' : 'CBE';
}

export function computeAssessmentGrade(
  score: number,
  grade = ''
): {
  letterGrade: string;
  gpaPoints: number;
  maxPoints: number;
  system: AssessmentGradingSystem;
  label: string;
} {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const system = getAssessmentGradingSystem(grade);
  const scale = system === '8-4-4' ? KCSE_844_GRADING_SCALE : CBE_GRADING_SCALE;
  const maxPoints = system === '8-4-4' ? 12 : 8;
  const band = scale.find((b) => clamped >= b.minScore) || scale[scale.length - 1];
  return {
    letterGrade: band.grade,
    gpaPoints: band.points,
    maxPoints,
    system,
    label: band.label,
  };
}

export function computeMeanGradeFromPoints(
  meanPoints: number,
  grade = ''
): {
  letterGrade: string;
  points: number;
  maxPoints: number;
  system: AssessmentGradingSystem;
} {
  const system = getAssessmentGradingSystem(grade);
  const scale = system === '8-4-4' ? KCSE_844_GRADING_SCALE : CBE_GRADING_SCALE;
  const maxPoints = system === '8-4-4' ? 12 : 8;
  const roundedPts = Math.max(1, Math.min(maxPoints, Math.round(meanPoints)));
  const band = scale.find((b) => b.points === roundedPts) || scale[scale.length - 1];
  return {
    letterGrade: band.grade,
    points: roundedPts,
    maxPoints,
    system,
  };
}

export interface KenyanBellRow {
  kind: 'lesson' | 'break';
  period?: number;
  label: string;
  time: string;
  startTime: string;
  endTime: string;
}

export const KENYAN_BELL_SCHEDULE: KenyanBellRow[] = [
  { kind: 'lesson', period: 1, label: 'Lesson 1', time: '08:00 – 08:40', startTime: '08:00', endTime: '08:40' },
  { kind: 'lesson', period: 2, label: 'Lesson 2', time: '08:40 – 09:20', startTime: '08:40', endTime: '09:20' },
  { kind: 'break', label: 'Short Break', time: '09:20 – 09:30', startTime: '09:20', endTime: '09:30' },
  { kind: 'lesson', period: 3, label: 'Lesson 3', time: '09:30 – 10:10', startTime: '09:30', endTime: '10:10' },
  { kind: 'lesson', period: 4, label: 'Lesson 4', time: '10:10 – 10:50', startTime: '10:10', endTime: '10:50' },
  { kind: 'break', label: 'Tea Break', time: '10:50 – 11:20', startTime: '10:50', endTime: '11:20' },
  { kind: 'lesson', period: 5, label: 'Lesson 5', time: '11:20 – 12:00', startTime: '11:20', endTime: '12:00' },
  { kind: 'lesson', period: 6, label: 'Lesson 6', time: '12:00 – 12:40', startTime: '12:00', endTime: '12:40' },
  { kind: 'break', label: 'Lunch Break', time: '12:40 – 14:00', startTime: '12:40', endTime: '14:00' },
  { kind: 'lesson', period: 7, label: 'Lesson 7', time: '14:00 – 14:40', startTime: '14:00', endTime: '14:40' },
  { kind: 'lesson', period: 8, label: 'Lesson 8', time: '14:40 – 15:20', startTime: '14:40', endTime: '15:20' },
];

export type UserRole =
  | 'Super Admin'
  | 'Admin'
  | 'Registrar'
  | 'Teacher'
  | 'Bursar'
  | 'Parent';

export type TenantStatus = 'Active' | 'Trial' | 'Suspended';

export interface TenantBranding {
  primaryColor: string;
  accentColor: string;
  sidebarColor?: string;
  logoDataUrl?: string;
  tagline?: string;
}

export const DEFAULT_TENANT_BRANDING: TenantBranding = {
  primaryColor: '#2563EB',
  accentColor: '#0F766E',
  sidebarColor: '',
  logoDataUrl: '',
  tagline: '',
};

export interface TenantThemePreset {
  id: string;
  name: string;
  primaryColor: string;
  accentColor: string;
  sidebarColor: string;
}

export const TENANT_THEME_PRESETS: TenantThemePreset[] = [
  {
    id: 'academic-blue',
    name: 'Academic Blue',
    primaryColor: '#2563EB',
    accentColor: '#0284C7',
    sidebarColor: '',
  },
  {
    id: 'botanical-emerald',
    name: 'Forest Emerald',
    primaryColor: '#059669',
    accentColor: '#0D9488',
    sidebarColor: '#062C22',
  },
  {
    id: 'royal-burgundy',
    name: 'Royal Maroon',
    primaryColor: '#9F1239',
    accentColor: '#D97706',
    sidebarColor: '#2A0B14',
  },
  {
    id: 'heritage-indigo',
    name: 'Heritage Navy',
    primaryColor: '#3730A3',
    accentColor: '#0E7490',
    sidebarColor: '#0F172A',
  },
  {
    id: 'savanna-ochre',
    name: 'Savanna Gold',
    primaryColor: '#B45309',
    accentColor: '#047857',
    sidebarColor: '#1F160D',
  },
  {
    id: 'slate-executive',
    name: 'Executive Slate',
    primaryColor: '#0F172A',
    accentColor: '#2563EB',
    sidebarColor: '',
  },
];

export type AdmissionStage =
  | 'Inquiry'
  | 'Submitted'
  | 'Interview'
  | 'Approved'
  | 'Enrolled';

export type AttendanceStatus = 'Present' | 'Absent' | 'Late' | 'Excused';

export type InvoiceStatus = 'Paid' | 'Partial' | 'Pending' | 'Overdue';

export type PaymentMethod = 'Bank Transfer' | 'Card' | 'Mobile Money' | 'Cash';

export type DayOfWeek = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday';

export type NotificationCategory =
  | 'admission'
  | 'attendance'
  | 'exam'
  | 'fee'
  | 'announcement'
  | 'message'
  | 'timetable';

export type CurrencyCode = 'KES' | 'USD';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  curriculum: string;
  academicYear: string;
  currentTerm: string;
  currency: CurrencyCode;
  plan: 'Enterprise' | 'Growth';
  status?: TenantStatus;
  location: string;
  branding?: TenantBranding;
  grades: string[];
  sections: string[];
  gradeStreams?: Record<string, string[]>;
  subjects: string[];
  subjectWeeklyLessons?: Record<string, number>;
  levelSubjects?: Partial<Record<CbcClusterId, string[]>>;
  levelSubjectWeeklyLessons?: Partial<Record<CbcClusterId, Record<string, number>>>;
  rooms: string[];
  teachers: TeacherProfile[];
  nonTeachingStaff?: NonTeachingStaffProfile[];
  createdAt: string;
}

export interface SuperAdminTenantSummary {
  tenant: Tenant;
  studentCount: number;
  teacherCount: number;
  nonTeachingCount: number;
  totalBilled: number;
  totalCollected: number;
  examResultCount: number;
  attendanceCount: number;
}

export type AdminAuditAction =
  | 'PROVISION_TENANT'
  | 'UPDATE_METADATA'
  | 'CHANGE_STATUS'
  | 'UPDATE_BRANDING'
  | 'UPDATE_RESOURCES'
  | 'DEPROVISION_TENANT';

export interface AdminAuditEntry {
  id: string;
  timestamp: string;
  actorRole: UserRole;
  actorEmail: string;
  action: AdminAuditAction;
  tenantId: string;
  tenantName: string;
  summary: string;
}

export interface AdminSessionInfo {
  token: string;
  expiresAt: string;
  actor: {
    id: string;
    role: UserRole;
    email: string;
    name: string;
  };
}

export function getSubjectsForLevel(
  tenant: Pick<Tenant, 'subjects' | 'levelSubjects'>,
  clusterId: CbcClusterId
): string[] {
  const configured = tenant.levelSubjects?.[clusterId];
  if (Array.isArray(configured) && configured.length > 0) {
    return configured;
  }
  return tenant.subjects;
}

export function getSubjectsForGrade(
  tenant: Pick<Tenant, 'subjects' | 'levelSubjects'>,
  grade: string
): string[] {
  return getSubjectsForLevel(tenant, getClusterForGrade(grade));
}

export function getLessonsPerWeekForSubject(
  tenant: Pick<Tenant, 'subjectWeeklyLessons' | 'levelSubjectWeeklyLessons'>,
  subject: string,
  clusterId?: CbcClusterId
): number {
  if (clusterId) {
    const levelVal = tenant.levelSubjectWeeklyLessons?.[clusterId]?.[subject];
    if (typeof levelVal === 'number' && Number.isFinite(levelVal) && levelVal >= 0) {
      return Math.min(10, Math.round(levelVal));
    }
  }
  const configured = tenant.subjectWeeklyLessons?.[subject];
  if (typeof configured === 'number' && Number.isFinite(configured) && configured >= 0) {
    return Math.min(10, Math.round(configured));
  }
  if (clusterId) {
    const presetMatch = KENYAN_CBC_LEVEL_SUBJECTS[clusterId].find(
      (item) => item.name.toLowerCase() === subject.trim().toLowerCase()
    );
    if (presetMatch) return presetMatch.lessonsPerWeek;
  }
  const lower = subject.trim().toLowerCase();
  const match = Object.entries(DEFAULT_SUBJECT_WEEKLY_LESSONS).find(
    ([key]) => key.toLowerCase() === lower
  );
  return match ? match[1] : 3;
}

export function getStreamsForGrade(
  tenant: Pick<Tenant, 'sections' | 'gradeStreams'>,
  grade: string
): string[] {
  const perGrade = tenant.gradeStreams?.[grade];
  if (Array.isArray(perGrade) && perGrade.length > 0) {
    return perGrade;
  }
  return tenant.sections.length > 0 ? tenant.sections : ['A'];
}

export function getTeacherAssignedSubjectsForCohort(
  tenant: Pick<Tenant, 'subjects' | 'levelSubjects'>,
  teacher: TeacherProfile | undefined | null,
  grade: string,
  section: string,
  timetableSlots: Array<Pick<TimetableSlot, 'teacherId' | 'grade' | 'section' | 'subject'>> = []
): string[] {
  if (!teacher) return [];

  const levelSubjects = getSubjectsForGrade(tenant, grade);
  const levelLowerMap = new Map<string, string>();
  levelSubjects.forEach((sub) => levelLowerMap.set(sub.toLowerCase(), sub));
  tenant.subjects.forEach((sub) => {
    if (!levelLowerMap.has(sub.toLowerCase())) {
      levelLowerMap.set(sub.toLowerCase(), sub);
    }
  });

  const teacherSubLower = new Set(teacher.subjects.map((s) => s.trim().toLowerCase()));
  const hasClassTeacherToken = teacher.subjects.includes(CLASS_TEACHER_SUBJECT_TOKEN);
  const allowedLower = new Set<string>();

  // 1. Timetable slots explicitly assigned to this teacher in this (grade, stream)
  timetableSlots.forEach((slot) => {
    if (
      slot.teacherId === teacher.id &&
      slot.grade.toLowerCase() === grade.toLowerCase() &&
      slot.section.toLowerCase() === section.toLowerCase() &&
      slot.subject
    ) {
      allowedLower.add(slot.subject.trim().toLowerCase());
    }
  });

  const classes = Array.isArray(teacher.assignedClasses) ? teacher.assignedClasses : [];
  if (classes.length > 0) {
    // Teacher has explicit Grade/Stream/Subject allocations
    const matching = classes.filter(
      (c) =>
        c.grade.trim().toLowerCase() === grade.trim().toLowerCase() &&
        (c.section.trim().toLowerCase() === section.trim().toLowerCase() ||
          c.section.trim().toLowerCase() === 'all streams')
    );

    matching.forEach((c) => {
      if (!c.subject) {
        if (hasClassTeacherToken) {
          levelSubjects.forEach((sub) => allowedLower.add(sub.toLowerCase()));
        } else {
          levelSubjects.forEach((sub) => {
            if (teacherSubLower.has(sub.toLowerCase())) {
              allowedLower.add(sub.toLowerCase());
            }
          });
        }
      } else if (c.subject === CLASS_TEACHER_SUBJECT_TOKEN) {
        levelSubjects.forEach((sub) => allowedLower.add(sub.toLowerCase()));
      } else {
        allowedLower.add(c.subject.trim().toLowerCase());
      }
    });
  } else {
    // Teacher is configured as Open to All Classes: scoped strictly to their assigned subjects for this level
    if (hasClassTeacherToken) {
      levelSubjects.forEach((sub) => allowedLower.add(sub.toLowerCase()));
    } else {
      levelSubjects.forEach((sub) => {
        if (teacherSubLower.has(sub.toLowerCase())) {
          allowedLower.add(sub.toLowerCase());
        }
      });
    }
  }

  // Order deterministically: levelSubjects order first, then any extra allowed subjects
  const ordered: string[] = [];
  const added = new Set<string>();
  levelSubjects.forEach((sub) => {
    const low = sub.toLowerCase();
    if (allowedLower.has(low) && !added.has(low)) {
      ordered.push(sub);
      added.add(low);
    }
  });
  allowedLower.forEach((low) => {
    if (!added.has(low)) {
      ordered.push(levelLowerMap.get(low) || low);
      added.add(low);
    }
  });

  return ordered;
}

export function isTeacherAssignedToCohort(
  teacher: TeacherProfile | undefined | null,
  grade: string,
  section: string,
  timetableSlots: Array<Pick<TimetableSlot, 'teacherId' | 'grade' | 'section'>> = []
): boolean {
  if (!teacher) return false;
  const gNorm = grade.trim().toLowerCase();
  const sNorm = section.trim().toLowerCase();

  const classes = Array.isArray(teacher.assignedClasses) ? teacher.assignedClasses : [];
  const hasExplicitClass = classes.some(
    (c) =>
      c.grade.trim().toLowerCase() === gNorm &&
      (c.section.trim().toLowerCase() === sNorm ||
        c.section.trim().toLowerCase() === 'all streams')
  );
  if (hasExplicitClass) return true;

  const hasTimetableSlot = timetableSlots.some(
    (slot) =>
      slot.teacherId === teacher.id &&
      slot.grade.trim().toLowerCase() === gNorm &&
      slot.section.trim().toLowerCase() === sNorm
  );
  return hasTimetableSlot;
}

export interface TeacherClassAssignment {
  grade: string;
  section: string;
  subject?: string;
}

export type StaffCategory = 'Teaching' | 'Non-Teaching';

export interface NonTeachingStaffProfile {
  id: string;
  name: string;
  role: string;
  department: string;
  phone: string;
  email: string;
}

export interface TeacherProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  department: string;
  subjects: string[];
  assignedClasses?: TeacherClassAssignment[];
}

export interface Student {
  id: string;
  tenantId: string;
  studentCode: string;
  upi: string;
  fullName: string;
  grade: string;
  section: string;
  guardianName: string;
  guardianEmail: string;
  guardianPhone: string;
  gender: 'Female' | 'Male' | 'Non-binary';
  dateOfBirth: string;
  enrolledAt: string;
  status: 'Active' | 'On Leave' | 'Graduated';
}

export interface OnboardingChecklist {
  birthCertificate: boolean;
  transcripts: boolean;
  medicalClearance: boolean;
  guardianId: boolean;
  depositPaid: boolean;
}

export interface AdmissionApplication {
  id: string;
  tenantId: string;
  applicationCode: string;
  studentName: string;
  dateOfBirth: string;
  gender: 'Female' | 'Male' | 'Non-binary';
  targetGrade: string;
  assignedSection: string;
  guardianName: string;
  guardianEmail: string;
  guardianPhone: string;
  previousSchool: string;
  stage: AdmissionStage;
  checklist: OnboardingChecklist;
  notes: string;
  submittedAt: string;
  updatedAt: string;
}

export interface TimetableSlot {
  id: string;
  tenantId: string;
  day: DayOfWeek;
  period: number; // 1 to 6
  startTime: string;
  endTime: string;
  grade: string;
  section: string;
  subject: string;
  teacherId: string;
  teacherName: string;
  room: string;
}

export interface AttendanceRecord {
  id: string;
  tenantId: string;
  date: string; // YYYY-MM-DD
  grade: string;
  section: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  status: AttendanceStatus;
  remarks: string;
  recordedBy: string;
  updatedAt: string;
}

export interface StaffAttendanceRecord {
  id: string;
  tenantId: string;
  date: string; // YYYY-MM-DD
  staffId: string;
  staffName: string;
  staffCategory?: StaffCategory;
  role?: string;
  department: string;
  phone: string;
  status: AttendanceStatus;
  remarks: string;
  recordedBy: string;
  updatedAt: string;
}

export interface LeaveOutChit {
  id: string;
  tenantId: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  grade: string;
  section: string;
  startDate: string; // YYYY-MM-DD (inclusive)
  days: number;
  endDate: string; // YYYY-MM-DD (inclusive; lapses after this date)
  reason: string;
  issuedBy: string;
  createdAt: string;
}

export function addDaysIso(dateStr: string, offsetDays: number): string {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return dateStr;
  }
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + offsetDays));
  return dt.toISOString().slice(0, 10);
}

export function isDateInLeaveChit(
  chit: Pick<LeaveOutChit, 'startDate' | 'endDate'>,
  date: string
): boolean {
  return date >= chit.startDate && date <= chit.endDate;
}

export interface ExamCycle {
  id: string;
  tenantId: string;
  title: string;
  term: string;
  startDate: string;
  endDate: string;
  status: 'Draft' | 'Grading' | 'Published';
  createdAt: string;
}

export interface ExamResult {
  id: string;
  tenantId: string;
  examCycleId: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  grade: string;
  section: string;
  subject: string;
  score: number; // 0-100
  maxScore: number;
  letterGrade: string;
  gpaPoints: number;
  remarks: string;
  updatedAt: string;
}

export const MAX_FEE_VOTELINES = 8;

export interface FeeVoteline {
  id: string;
  name: string;
  amount: number;
}

export interface FeeStructure {
  id: string;
  tenantId: string;
  grade: string;
  term: string;
  votelines: FeeVoteline[];
  tuitionFee: number;
  labFee: number;
  technologyFee: number;
  activitiesFee: number;
  totalFee: number;
}

export interface PaymentRecord {
  id: string;
  receiptNumber: string;
  amount: number;
  method: PaymentMethod;
  reference: string;
  paidAt: string;
  recordedBy: string;
}

export interface FeeInvoice {
  id: string;
  tenantId: string;
  invoiceNumber: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  grade: string;
  term: string;
  dueDate: string;
  totalAmount: number;
  paidAmount: number;
  balance: number;
  status: InvoiceStatus;
  payments: PaymentRecord[];
  createdAt: string;
}

export const EXPENSE_CATEGORIES = [
  'Payroll & Allowances',
  'Utilities & Water',
  'Catering & Boarding',
  'Teaching & Lab Supplies',
  'Maintenance & Repairs',
  'Transport & Fuel',
  'ICT & Software',
  'Administration & Statutory',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export type ExpenseStatus = 'Pending Approval' | 'Approved' | 'Paid';

export const EXPENSE_ATTACHMENT_TYPES = [
  'Official Receipt',
  'Signed Payment Voucher',
  'Supplier Invoice / LPO',
  'Bank / M-Pesa Slip',
  'Other Supporting Document',
] as const;

export type ExpenseAttachmentType = (typeof EXPENSE_ATTACHMENT_TYPES)[number];

export interface ExpenseAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  docType: ExpenseAttachmentType;
  dataUrl: string;
  uploadedAt: string;
  uploadedBy: string;
}

export type EtimsVerificationStatus = 'Verified' | 'Mismatch' | 'Exempt' | 'Unverified';

export interface EtimsVerificationRecord {
  id: string;
  tenantId: string;
  expenseId?: string;
  voucherNumber?: string;
  supplierName: string;
  supplierKraPin: string;
  cuInvoiceNumber: string;
  receiptDate: string;
  taxableAmount: number;
  vatAmount: number;
  totalAmount: number;
  status: EtimsVerificationStatus;
  verificationNotes: string;
  checkedBy: string;
  checkedAt: string;
}

export type ReconciliationChannel = 'M-Pesa' | 'Bank';
export type ReconciliationStatus = 'Matched' | 'Unmatched' | 'Discrepancy';

export interface ReconciliationLine {
  id: string;
  tenantId: string;
  channel: ReconciliationChannel;
  accountName: string;
  transactionDate: string;
  statementRef: string;
  narration: string;
  direction: 'Credit' | 'Debit';
  amount: number;
  status: ReconciliationStatus;
  matchedType?: 'Fee Payment' | 'Expense Voucher';
  matchedRecordId?: string;
  matchedLabel?: string;
  notes?: string;
  importedAt: string;
}

export type PayrollStatus = 'Draft' | 'Approved' | 'Disbursed';

export interface PayrollEntry {
  id: string;
  tenantId: string;
  payPeriod: string; // e.g. '2026-11'
  staffId: string;
  staffName: string;
  staffCategory: StaffCategory;
  designation: string;
  basicSalary: number;
  allowances: number;
  grossPay: number;
  paye: number;
  nssf: number;
  shif: number;
  housingLevy: number;
  saccoOrLoan: number;
  totalDeductions: number;
  netPay: number;
  status: PayrollStatus;
  updatedAt: string;
}

export interface BudgetAllocation {
  id: string;
  tenantId: string;
  fiscalYear: string;
  term: string;
  category: ExpenseCategory;
  allocatedAmount: number;
  notes?: string;
  updatedAt: string;
}

export const APPROVAL_COMMITTEES = [
  'Board of Management (BOM)',
  'Procurement & Tendering Committee',
  'Finance Sub-Committee',
  'Principal Executive Sign-Off',
] as const;

export type ApprovalCommittee = (typeof APPROVAL_COMMITTEES)[number];
export type ApprovalDecision = 'Pending Sign-Off' | 'Approved' | 'Deferred' | 'Rejected';

export interface ApprovalSignOffRecord {
  id: string;
  tenantId: string;
  referenceCode: string;
  committee: ApprovalCommittee;
  subject: string;
  linkedExpenseId?: string;
  linkedVoucherNumber?: string;
  amount: number;
  meetingDate: string;
  minuteReference: string;
  chairpersonName: string;
  secretaryName: string;
  bursarName: string;
  decision: ApprovalDecision;
  remarks?: string;
  createdAt: string;
  signedAt?: string;
}

export interface SchoolExpense {
  id: string;
  tenantId: string;
  voucherNumber: string;
  title: string;
  category: ExpenseCategory;
  vendor: string;
  amount: number;
  paymentMethod: PaymentMethod;
  reference: string;
  expenseDate: string;
  status: ExpenseStatus;
  recordedBy: string;
  notes?: string;
  attachments?: ExpenseAttachment[];
  etimsCuNumber?: string;
  supplierKraPin?: string;
  etimsStatus?: EtimsVerificationStatus;
  boardApprovalRef?: string;
  createdAt: string;
}

export interface Announcement {
  id: string;
  tenantId: string;
  title: string;
  body: string;
  audience: 'All School' | 'Teachers Only' | 'Parents & Guardians' | 'Students';
  priority: 'Normal' | 'Urgent';
  authorName: string;
  authorRole: UserRole;
  createdAt: string;
}

export interface DirectMessage {
  id: string;
  tenantId: string;
  channel: string;
  senderName: string;
  senderRole: UserRole;
  body: string;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  tenantId: string;
  category: NotificationCategory;
  title: string;
  description: string;
  targetModule: string;
  read: boolean;
  createdAt: string;
}

export type WhatsAppDispatchCategory = 'Report Card' | 'Fee Balance Reminder';

export interface WhatsAppDispatchRecord {
  id: string;
  tenantId: string;
  category: WhatsAppDispatchCategory;
  studentId: string;
  studentName: string;
  guardianName: string;
  guardianPhone: string;
  referenceLabel: string;
  messagePreview: string;
  sentBy: string;
  sentAt: string;
}

export interface TenantWorkspaceData {
  tenant: Tenant;
  tenants: Tenant[];
  students: Student[];
  admissions: AdmissionApplication[];
  timetable: TimetableSlot[];
  attendance: AttendanceRecord[];
  staffAttendance: StaffAttendanceRecord[];
  leaveOutChits: LeaveOutChit[];
  examCycles: ExamCycle[];
  examResults: ExamResult[];
  feeStructures: FeeStructure[];
  invoices: FeeInvoice[];
  expenses: SchoolExpense[];
  etimsChecks: EtimsVerificationRecord[];
  reconciliationLines: ReconciliationLine[];
  payrollEntries: PayrollEntry[];
  budgets: BudgetAllocation[];
  approvalRecords: ApprovalSignOffRecord[];
  announcements: Announcement[];
  messages: DirectMessage[];
  whatsappDispatches: WhatsAppDispatchRecord[];
  notifications: NotificationItem[];
}

export interface WsServerEvent {
  type:
    | 'connected'
    | 'subscribed'
    | 'notification:new'
    | 'workspace:sync'
    | 'message:new'
    | 'announcement:new';
  tenantId?: string;
  payload?: unknown;
}
