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

export interface BellScheduleRow {
  id?: string;
  kind: 'lesson' | 'break';
  period?: number;
  label: string;
  time: string;
  startTime: string;
  endTime: string;
}

export type KenyanBellRow = BellScheduleRow;

export const DEFAULT_DAY_OPENING_NOTE = '07:30 – 08:00 Morning Assembly / Pre-Lesson Prep';
export const DEFAULT_DAY_CLOSING_NOTE = '15:20 – 16:00 Co-Curricular Activities, Games, Clubs & Remedial Study';

export const KENYAN_BELL_SCHEDULE: BellScheduleRow[] = [
  { id: 'row-1', kind: 'lesson', period: 1, label: 'Lesson 1', time: '08:00 – 08:40', startTime: '08:00', endTime: '08:40' },
  { id: 'row-2', kind: 'lesson', period: 2, label: 'Lesson 2', time: '08:40 – 09:20', startTime: '08:40', endTime: '09:20' },
  { id: 'row-b1', kind: 'break', label: 'Short Break', time: '09:20 – 09:30', startTime: '09:20', endTime: '09:30' },
  { id: 'row-3', kind: 'lesson', period: 3, label: 'Lesson 3', time: '09:30 – 10:10', startTime: '09:30', endTime: '10:10' },
  { id: 'row-4', kind: 'lesson', period: 4, label: 'Lesson 4', time: '10:10 – 10:50', startTime: '10:10', endTime: '10:50' },
  { id: 'row-b2', kind: 'break', label: 'Tea Break', time: '10:50 – 11:20', startTime: '10:50', endTime: '11:20' },
  { id: 'row-5', kind: 'lesson', period: 5, label: 'Lesson 5', time: '11:20 – 12:00', startTime: '11:20', endTime: '12:00' },
  { id: 'row-6', kind: 'lesson', period: 6, label: 'Lesson 6', time: '12:00 – 12:40', startTime: '12:00', endTime: '12:40' },
  { id: 'row-b3', kind: 'break', label: 'Lunch Break', time: '12:40 – 14:00', startTime: '12:40', endTime: '14:00' },
  { id: 'row-7', kind: 'lesson', period: 7, label: 'Lesson 7', time: '14:00 – 14:40', startTime: '14:00', endTime: '14:40' },
  { id: 'row-8', kind: 'lesson', period: 8, label: 'Lesson 8', time: '14:40 – 15:20', startTime: '14:40', endTime: '15:20' },
];

export function normalizeBellSchedule(rows?: BellScheduleRow[] | null): BellScheduleRow[] {
  if (!Array.isArray(rows) || rows.length === 0) {
    return KENYAN_BELL_SCHEDULE.map((r) => ({ ...r }));
  }
  let nextPeriod = 1;
  return rows.map((row, idx) => {
    const startTime = (row.startTime || '08:00').trim();
    const endTime = (row.endTime || '08:40').trim();
    const kind: 'lesson' | 'break' = row.kind === 'break' ? 'break' : 'lesson';
    const period = kind === 'lesson' ? nextPeriod++ : undefined;
    const defaultLabel = kind === 'lesson' ? `Lesson ${period}` : 'Break';
    return {
      id: row.id || `bell-${idx + 1}`,
      kind,
      ...(period !== undefined ? { period } : {}),
      label: (row.label || '').trim() || defaultLabel,
      startTime,
      endTime,
      time: `${startTime} – ${endTime}`,
    };
  });
}

export function getTenantBellSchedule(
  tenant?: Pick<Tenant, 'bellSchedule'> | null
): BellScheduleRow[] {
  if (tenant?.bellSchedule && tenant.bellSchedule.length > 0) {
    return normalizeBellSchedule(tenant.bellSchedule);
  }
  return normalizeBellSchedule(KENYAN_BELL_SCHEDULE);
}

export function getTenantLessonRows(
  tenant?: Pick<Tenant, 'bellSchedule'> | null
): BellScheduleRow[] {
  return getTenantBellSchedule(tenant).filter(
    (r) => r.kind === 'lesson' && r.period !== undefined
  );
}

export function getTenantPeriodTimes(
  tenant?: Pick<Tenant, 'bellSchedule'> | null
): Record<number, { startTime: string; endTime: string; label: string; time: string }> {
  return Object.fromEntries(
    getTenantLessonRows(tenant).map((r) => [
      r.period as number,
      {
        startTime: r.startTime,
        endTime: r.endTime,
        label: r.label,
        time: r.time,
      },
    ])
  );
}

export function getDoubleStartPeriodsFromSchedule(schedule: BellScheduleRow[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < schedule.length - 1; i += 1) {
    const cur = schedule[i];
    const nxt = schedule[i + 1];
    if (cur.kind === 'lesson' && cur.period !== undefined && nxt.kind === 'lesson') {
      out.push(cur.period);
    }
  }
  return out;
}

export type UserRole =
  | 'Developer'
  | 'Super Admin'
  | 'Admin'
  | 'Registrar'
  | 'Teacher'
  | 'Bursar'
  | 'Budget Approver'
  | 'Parent'
  | 'Student';

export type TenantModulePermission =
  | 'analytics'
  | 'admissions'
  | 'academics'
  | 'timetable'
  | 'attendance'
  | 'exams'
  | 'fees'
  | 'communications'
  | 'settings';

export type ModuleAccessLevel = 'none' | 'read' | 'edit';
export type TenantModuleAccessMap = Partial<Record<TenantModulePermission, 'read' | 'edit'>>;

export const ALL_TENANT_MODULES: Array<{
  id: TenantModulePermission;
  label: string;
}> = [
  { id: 'analytics', label: 'Analytics' },
  { id: 'admissions', label: 'Admissions' },
  { id: 'academics', label: 'Teacher Academics' },
  { id: 'timetable', label: 'Timetable' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'exams', label: 'Exams & Grades' },
  { id: 'fees', label: 'Finance & Accounting' },
  { id: 'communications', label: 'Communications' },
  { id: 'settings', label: 'School Settings' },
];

const ALL_MODULE_IDS: TenantModulePermission[] = ALL_TENANT_MODULES.map((m) => m.id);
const ALL_MODULE_SET = new Set<TenantModulePermission>(ALL_MODULE_IDS);

export const DEFAULT_ROLE_MODULES: Record<UserRole, TenantModulePermission[]> = {
  Developer: [...ALL_MODULE_IDS],
  'Super Admin': [...ALL_MODULE_IDS],
  Admin: [...ALL_MODULE_IDS],
  Registrar: ['analytics', 'admissions', 'academics', 'attendance', 'communications'],
  Teacher: ['analytics', 'academics', 'timetable', 'attendance', 'exams', 'communications'],
  Bursar: ['analytics', 'fees', 'communications'],
  'Budget Approver': ['analytics', 'fees', 'communications'],
  Parent: ['analytics', 'academics', 'exams', 'fees', 'communications'],
  Student: ['analytics', 'academics', 'timetable', 'attendance', 'exams', 'communications'],
};

export const DEFAULT_ROLE_MODULE_ACCESS: Record<UserRole, TenantModuleAccessMap> = {
  Developer: Object.fromEntries(ALL_MODULE_IDS.map((m) => [m, 'edit'])) as TenantModuleAccessMap,
  'Super Admin': Object.fromEntries(ALL_MODULE_IDS.map((m) => [m, 'edit'])) as TenantModuleAccessMap,
  Admin: Object.fromEntries(ALL_MODULE_IDS.map((m) => [m, 'edit'])) as TenantModuleAccessMap,
  Registrar: {
    analytics: 'read',
    admissions: 'edit',
    academics: 'read',
    attendance: 'edit',
    communications: 'edit',
  },
  Teacher: {
    analytics: 'read',
    academics: 'edit',
    timetable: 'edit',
    attendance: 'edit',
    exams: 'edit',
    communications: 'edit',
  },
  Bursar: { analytics: 'read', fees: 'edit', communications: 'edit' },
  'Budget Approver': { analytics: 'read', fees: 'read', communications: 'read' },
  Parent: { analytics: 'read', academics: 'read', exams: 'read', fees: 'read', communications: 'read' },
  Student: {
    analytics: 'read',
    academics: 'read',
    timetable: 'read',
    attendance: 'read',
    exams: 'read',
    communications: 'read',
  },
};

export interface CustomRoleDefinition {
  id: string;
  name: string;
  baseRole: UserRole;
  defaultModules: TenantModulePermission[];
  defaultModuleAccess?: TenantModuleAccessMap;
  description?: string;
}

export function normalizeModuleAccessMap(
  role: UserRole,
  rawAccess?: unknown,
  fallbackModules?: TenantModulePermission[]
): TenantModuleAccessMap {
  if (role === 'Developer' || role === 'Super Admin') {
    return Object.fromEntries(ALL_MODULE_IDS.map((m) => [m, 'edit'])) as TenantModuleAccessMap;
  }

  const defaults = DEFAULT_ROLE_MODULE_ACCESS[role] || { analytics: 'read' as const };
  const result: TenantModuleAccessMap = {};

  if (rawAccess && typeof rawAccess === 'object' && !Array.isArray(rawAccess)) {
    for (const modId of ALL_MODULE_IDS) {
      const level = (rawAccess as Record<string, unknown>)[modId];
      if (level === 'read' || level === 'edit') {
        result[modId] = role === 'Parent' || role === 'Student' ? 'read' : level;
      }
    }
  } else if (Array.isArray(fallbackModules)) {
    for (const modId of fallbackModules) {
      if (!ALL_MODULE_SET.has(modId)) continue;
      if (role === 'Parent' || role === 'Student') {
        result[modId] = 'read';
      } else {
        result[modId] = defaults[modId] || 'edit';
      }
    }
  } else {
    for (const modId of ALL_MODULE_IDS) {
      const lvl = defaults[modId];
      if (lvl === 'read' || lvl === 'edit') {
        result[modId] = lvl;
      }
    }
  }

  if (role === 'Admin') {
    result.settings = 'edit';
  }
  return result;
}

export function getDefaultModuleAccessForTenantRole(
  tenant:
    | Pick<Tenant, 'customRoles' | 'roleModuleOverrides' | 'roleModuleAccessOverrides'>
    | undefined
    | null,
  role: UserRole,
  customRoleId?: string
): TenantModuleAccessMap {
  if (customRoleId && tenant?.customRoles) {
    const custom = tenant.customRoles.find((r) => r.id === customRoleId);
    if (custom) {
      return normalizeModuleAccessMap(
        custom.baseRole,
        custom.defaultModuleAccess,
        custom.defaultModules
      );
    }
  }
  const accessOverride = tenant?.roleModuleAccessOverrides?.[role];
  if (accessOverride && typeof accessOverride === 'object') {
    return normalizeModuleAccessMap(role, accessOverride);
  }
  const moduleOverride = tenant?.roleModuleOverrides?.[role];
  if (Array.isArray(moduleOverride)) {
    return normalizeModuleAccessMap(role, undefined, moduleOverride);
  }
  return normalizeModuleAccessMap(role);
}

export function getDefaultModulesForTenantRole(
  tenant:
    | Pick<Tenant, 'customRoles' | 'roleModuleOverrides' | 'roleModuleAccessOverrides'>
    | undefined
    | null,
  role: UserRole,
  customRoleId?: string
): TenantModulePermission[] {
  const accessMap = getDefaultModuleAccessForTenantRole(tenant, role, customRoleId);
  const enabled = ALL_MODULE_IDS.filter((id) => accessMap[id] === 'read' || accessMap[id] === 'edit');
  if (customRoleId && tenant?.customRoles) {
    const custom = tenant.customRoles.find((r) => r.id === customRoleId);
    if (custom && Array.isArray(custom.defaultModules)) {
      const enabledSet = new Set(enabled);
      const preserved = custom.defaultModules.filter((id) => enabledSet.has(id));
      const preservedSet = new Set(preserved);
      for (const id of enabled) {
        if (!preservedSet.has(id)) preserved.push(id);
      }
      return preserved;
    }
  }
  return enabled;
}

export function getEffectiveUserModuleAccess(
  user?: Pick<TenantUser, 'role' | 'allowedModules' | 'moduleAccess'> | null
): TenantModuleAccessMap {
  if (!user) return {};
  if (user.role === 'Developer' || user.role === 'Super Admin') {
    return Object.fromEntries(ALL_MODULE_IDS.map((m) => [m, 'edit'])) as TenantModuleAccessMap;
  }

  const defaults = DEFAULT_ROLE_MODULE_ACCESS[user.role] || { analytics: 'read' as const };
  const result: TenantModuleAccessMap = {};

  if (user.moduleAccess && typeof user.moduleAccess === 'object') {
    const allowedSet = Array.isArray(user.allowedModules) ? new Set(user.allowedModules) : null;
    for (const modId of ALL_MODULE_IDS) {
      if (allowedSet && !allowedSet.has(modId)) continue;
      const lvl = user.moduleAccess[modId];
      if (lvl === 'read' || lvl === 'edit') {
        result[modId] = user.role === 'Parent' || user.role === 'Student' ? 'read' : lvl;
      }
    }
    if (allowedSet) {
      for (const modId of allowedSet) {
        if (ALL_MODULE_SET.has(modId) && !result[modId]) {
          result[modId] =
            user.role === 'Parent' || user.role === 'Student' ? 'read' : defaults[modId] || 'edit';
        }
      }
    }
  } else if (Array.isArray(user.allowedModules)) {
    for (const modId of user.allowedModules) {
      if (!ALL_MODULE_SET.has(modId)) continue;
      result[modId] =
        user.role === 'Parent' || user.role === 'Student' ? 'read' : defaults[modId] || 'edit';
    }
  } else {
    for (const modId of ALL_MODULE_IDS) {
      const lvl = defaults[modId];
      if (lvl === 'read' || lvl === 'edit') {
        result[modId] = lvl;
      }
    }
  }

  if (user.role === 'Admin') {
    result.settings = 'edit';
  }
  return result;
}

export function getModuleAccessLevel(
  user: Pick<TenantUser, 'role' | 'allowedModules' | 'moduleAccess'> | undefined | null,
  moduleId: TenantModulePermission
): ModuleAccessLevel {
  const map = getEffectiveUserModuleAccess(user);
  const lvl = map[moduleId];
  return lvl === 'read' || lvl === 'edit' ? lvl : 'none';
}

export function canEditModule(
  user: Pick<TenantUser, 'role' | 'allowedModules' | 'moduleAccess'> | undefined | null,
  moduleId: TenantModulePermission
): boolean {
  return getModuleAccessLevel(user, moduleId) === 'edit';
}

export function getEffectiveUserModules(
  user?: Pick<TenantUser, 'role' | 'allowedModules' | 'moduleAccess'> | null
): TenantModulePermission[] {
  if (!user) return [];
  const accessMap = getEffectiveUserModuleAccess(user);
  const enabled = ALL_MODULE_IDS.filter((id) => accessMap[id] === 'read' || accessMap[id] === 'edit');
  if (Array.isArray(user.allowedModules) && user.allowedModules.length > 0) {
    const enabledSet = new Set(enabled);
    const preserved = user.allowedModules.filter((id) => enabledSet.has(id));
    const preservedSet = new Set(preserved);
    for (const id of enabled) {
      if (!preservedSet.has(id)) preserved.push(id);
    }
    return preserved;
  }
  return enabled;
}

export type TenantStatus = 'Active' | 'Trial' | 'Suspended';
export type TenantPlan = 'Starter' | 'Growth' | 'Enterprise';
export type SubscriptionCycle = 'Monthly' | 'Annual';

export const DEFAULT_TIER_LEARNER_CAPS: Record<TenantPlan, number> = {
  Starter: 150,
  Growth: 600,
  Enterprise: 2500,
};

export const TIER_SUBSCRIPTION_CATALOG: Record<
  TenantPlan,
  {
    audience: string;
    defaultCap: number;
    monthlyKes: number;
    annualKes: number;
    monthlyUsd: number;
    annualUsd: number;
  }
> = {
  Starter: {
    audience: 'Early-stage academies & single-stream campuses',
    defaultCap: 150,
    monthlyKes: 12000,
    annualKes: 120000,
    monthlyUsd: 95,
    annualUsd: 950,
  },
  Growth: {
    audience: 'Scaling CBC & secondary schools',
    defaultCap: 600,
    monthlyKes: 32000,
    annualKes: 320000,
    monthlyUsd: 250,
    annualUsd: 2500,
  },
  Enterprise: {
    audience: 'Multi-stream & international school networks',
    defaultCap: 2500,
    monthlyKes: 75000,
    annualKes: 750000,
    monthlyUsd: 590,
    annualUsd: 5900,
  },
};

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
  | 'academics'
  | 'attendance'
  | 'exam'
  | 'fee'
  | 'announcement'
  | 'message'
  | 'timetable';

export type CurrencyCode = 'KES' | 'USD';

export const DEFAULT_CURRENCY: CurrencyCode = 'KES';

export const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
]);

export function sanitizeSchoolEmailDomain(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/[^a-z0-9.-]+/g, '');
  return cleaned.replace(/^[.-]+|[.-]+$/g, '');
}

export function deriveSchoolEmailDomain(nameOrSlug: string): string {
  const base = nameOrSlug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 24);
  const safeBase = base || 'school';
  return `${safeBase}.ac.ke`;
}

export function suggestNameEmailLocalPart(fullName: string): string {
  const tokens = fullName
    .trim()
    .toLowerCase()
    .replace(/\b(dr|prof|mr|mrs|ms|miss|sir|madam)\.?\s+/gi, '')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return '';
  if (tokens.length === 1) return tokens[0].slice(0, 32);
  return `${tokens[0]}.${tokens[tokens.length - 1]}`.slice(0, 48);
}

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_POLICY_MESSAGE =
  'Password must be at least 10 characters long and contain at least one letter and one number.';

export function validatePasswordStrength(password: string): string | null {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return PASSWORD_POLICY_MESSAGE;
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return PASSWORD_POLICY_MESSAGE;
  }
  return null;
}

export type MpesaEnvironment = 'Sandbox' | 'Production';

export interface TenantMpesaConfig {
  enabled: boolean;
  environment: MpesaEnvironment;
  paybillNumber: string;
  accountName: string;
  accountReferenceFormat: string;
  hasWebhookSecret?: boolean;
  callbackUrl?: string;
  settlementBank?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface MpesaTransactionLog {
  id: string;
  tenantId: string;
  paybillNumber: string;
  mpesaReceipt: string;
  msisdn: string;
  accountReference: string;
  amount: number;
  studentId?: string;
  studentName?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  status: 'Settled' | 'Rejected' | 'Duplicate' | 'Unverified';
  channel: 'Daraja C2B Webhook' | 'STK / Paybill Terminal' | 'Manual Entry';
  note?: string;
  receivedAt: string;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  emailDomain?: string;
  curriculum: string;
  academicYear: string;
  currentTerm: string;
  currency: CurrencyCode;
  plan: TenantPlan;
  status?: TenantStatus;
  learnerCap?: number;
  subscriptionCycle?: SubscriptionCycle;
  renewalDate?: string;
  suspensionReason?: string;
  suspendedAt?: string;
  suspendedBy?: string;
  location: string;
  contactEmail?: string;
  contactPhone?: string;
  postalAddress?: string;
  branding?: TenantBranding;
  mpesaConfig?: TenantMpesaConfig;
  grades: string[];
  sections: string[];
  gradeStreams?: Record<string, string[]>;
  subjects: string[];
  subjectWeeklyLessons?: Record<string, number>;
  levelSubjects?: Partial<Record<CbcClusterId, string[]>>;
  levelSubjectWeeklyLessons?: Partial<Record<CbcClusterId, Record<string, number>>>;
  /** Lesson cards: who teaches what to which class, how many periods a week. */
  timetableLessons?: TimetableLesson[];
  /** Custom daily bell schedule (lesson periods and breaks) configured by the school. */
  bellSchedule?: BellScheduleRow[];
  /** Optional morning assembly / prep banner displayed above the timetable grid. */
  dayOpeningNote?: string;
  /** Optional afternoon / co-curricular banner displayed below the timetable grid. */
  dayClosingNote?: string;
  /** Subject-level scheduling rules (double allocations, not-before/not-after times, rooms). */
  subjectConstraints?: SubjectTimetableConstraint[];
  /** Parallel optional/elective subject groups taught simultaneously for a class. */
  optionalSubjectGroups?: OptionalSubjectGroup[];
  rooms: string[];
  teachers: TeacherProfile[];
  nonTeachingStaff?: NonTeachingStaffProfile[];
  siblingDiscountConfig?: {
    enabled: boolean;
    percentage: number;
    minSiblings?: number;
  };
  /** Optional per-tenant toggle allowing read-only Student portal logins. */
  studentPortalEnabled?: boolean;
  /** Tenant-defined custom roles mapped onto foundational capability tiers. */
  customRoles?: CustomRoleDefinition[];
  /** Per-tenant module permission template overrides for built-in roles. */
  roleModuleOverrides?: Partial<Record<UserRole, TenantModulePermission[]>>;
  /** Per-tenant Read Only / Read & Edit access template overrides for built-in roles. */
  roleModuleAccessOverrides?: Partial<Record<UserRole, TenantModuleAccessMap>>;
  /** Teacher Academics submission deadlines & parent-visibility governance settings. */
  academicSubmissionConfig?: AcademicSubmissionDeadlineConfig;
  createdAt: string;
}

export type AcademicDocumentStatus =
  | 'Draft'
  | 'Submitted'
  | 'Revision Requested'
  | 'Approved';

export interface AcademicSubmissionDeadlineConfig {
  schemeDueDate?: string; // YYYY-MM-DD
  lessonPlanLeadDays?: number;
  lessonPlanCadence?: 'Weekly' | 'Daily';
  currentWeekNumber?: number;
  requireApprovalForParentVisibility?: boolean;
}

export interface SchemeOfWorkWeek {
  weekNumber: number;
  strand: string;
  subStrand: string;
  learningOutcomes: string;
  keyInquiryQuestion?: string;
  learningActivities: string;
  resources: string;
  assessmentMethod: string;
  remarks?: string;
}

export interface SchemeOfWork {
  id: string;
  tenantId: string;
  academicYear: string;
  termId?: string;
  term: string;
  grade: string;
  section: string;
  subject: string;
  teacherId: string;
  teacherName: string;
  createdByUserId?: string;
  title: string;
  referenceBook?: string;
  weeksCount: number;
  weeks: SchemeOfWorkWeek[];
  status: AcademicDocumentStatus;
  parentVisible: boolean;
  parentSummary?: string;
  dueDate?: string;
  submittedAt?: string;
  reviewedByUserId?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  reviewFeedback?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LessonPlan {
  id: string;
  tenantId: string;
  schemeOfWorkId?: string;
  academicYear: string;
  termId?: string;
  term: string;
  weekNumber: number;
  lessonDate: string; // YYYY-MM-DD
  periodNumber?: number;
  durationMinutes: number;
  grade: string;
  section: string;
  subject: string;
  teacherId: string;
  teacherName: string;
  createdByUserId?: string;
  strand: string;
  subStrand: string;
  lessonTitle: string;
  learningOutcomes: string;
  learningResources: string;
  introductionActivity: string;
  lessonDevelopment: string;
  conclusionActivity: string;
  extendedHomework?: string;
  teacherReflection?: string;
  status: AcademicDocumentStatus;
  parentVisible: boolean;
  dueDate?: string;
  submittedAt?: string;
  reviewedByUserId?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  reviewFeedback?: string;
  createdAt: string;
  updatedAt: string;
}

export type RecordOfWorkCoverageStatus =
  | 'Completed'
  | 'Partially Covered'
  | 'Carried Forward';

export type CbcLearnerMasteryLevel =
  | 'Exceeding Expectations'
  | 'Meeting Expectations'
  | 'Approaching Expectations'
  | 'Below Expectations';

export interface RecordOfWork {
  id: string;
  tenantId: string;
  schemeOfWorkId?: string;
  lessonPlanId?: string;
  academicYear: string;
  termId?: string;
  term: string;
  weekNumber: number;
  dateCovered: string; // YYYY-MM-DD
  grade: string;
  section: string;
  subject: string;
  teacherId: string;
  teacherName: string;
  createdByUserId?: string;
  strand: string;
  subStrand: string;
  workCovered: string;
  lessonsTaughtCount: number;
  lessonsPlannedCount?: number;
  learnerMastery: CbcLearnerMasteryLevel;
  coverageStatus: RecordOfWorkCoverageStatus;
  challengesAndRemediation?: string;
  remarks?: string;
  parentSummary?: string;
  status: AcademicDocumentStatus;
  parentVisible: boolean;
  dueDate?: string;
  submittedAt?: string;
  reviewedByUserId?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  reviewFeedback?: string;
  createdAt: string;
  updatedAt: string;
}

export type LessonNoteSubmissionStatus = 'Submitted' | 'Not Submitted';

export interface LessonNote {
  id: string;
  tenantId: string;
  schemeOfWorkId?: string;
  lessonPlanId?: string;
  academicYear: string;
  termId?: string;
  term: string;
  weekNumber: number;
  lessonDate: string; // YYYY-MM-DD
  grade: string;
  section: string;
  subject: string;
  teacherId: string;
  teacherName: string;
  createdByUserId?: string;
  submissionStatus: LessonNoteSubmissionStatus;
  remarks?: string;
  strand?: string;
  subStrand?: string;
  topicTitle?: string;
  noteSummary?: string;
  detailedNotes?: string;
  keyVocabulary?: string;
  workedExamples?: string;
  learnerExercises?: string;
  referenceMaterials?: string;
  internalTeacherGuide?: string;
  status: AcademicDocumentStatus;
  parentVisible: boolean;
  dueDate?: string;
  submittedAt?: string;
  reviewedByUserId?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  reviewFeedback?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TenantUser {
  id: string;
  tenantId: string;
  fullName: string;
  email: string;
  phone?: string;
  role: UserRole;
  customRoleId?: string;
  roleLabel?: string;
  status: 'Active' | 'Disabled';
  /** Links a Student-role account directly to a Student record in the tenant. */
  studentId?: string;
  mustChangePassword?: boolean;
  tokenVersion?: number;
  allowedModules?: TenantModulePermission[];
  /** Granular per-module permission ('read' = Read Only, 'edit' = Read & Edit). */
  moduleAccess?: TenantModuleAccessMap;
  createdAt: string;
  lastLoginAt?: string;
}

export interface ImpersonatorMeta {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  readOnly: boolean;
  startedAt: string;
}

export interface AuthSessionInfo {
  token: string;
  expiresAt: string;
  user: TenantUser;
  tenantName?: string;
  emailDomain?: string;
  impersonator?: ImpersonatorMeta;
}

export interface PublicSchoolDirectoryItem {
  id: string;
  name: string;
  slug: string;
  emailDomain: string;
  location: string;
  curriculum: string;
  status: TenantStatus;
  branding?: TenantBranding;
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
  | 'DEPROVISION_TENANT'
  | 'UPDATE_SUBSCRIPTION'
  | 'KILL_SWITCH_SUSPEND'
  | 'KILL_SWITCH_RESTORE'
  | 'IMPERSONATE_START'
  | 'IMPERSONATE_END'
  | 'RESTORE_DATABASE'
  | 'UPDATE_STATUTORY_RATES'
  | 'MANAGE_TENANT_ACCOUNT';

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

export interface DevCollectionStorageStat {
  collection: string;
  records: number;
  bytes: number;
}

export interface DevTenantTelemetryRow {
  tenant: Tenant;
  totalLearners: number;
  activeLearners: number;
  learnerCap: number;
  utilizationPct: number;
  staffUsersCount: number;
  teachersCount: number;
  nonTeachingCount: number;
  admissionsPending: number;
  invoiceCount: number;
  totalBilled: number;
  totalCollected: number;
  estimatedDataBytes: number;
}

export interface DevPlatformTelemetry {
  generatedAt: string;
  tenants: {
    total: number;
    active: number;
    trial: number;
    suspended: number;
    byPlan: Record<TenantPlan, number>;
  };
  learners: {
    totalEnrolled: number;
    activeLearners: number;
    totalCapacity: number;
    globalUtilizationPct: number;
    pendingAdmissions: number;
    totalStaffAccounts: number;
    totalTeachers: number;
  };
  database: {
    engine: string;
    filePathName: string;
    diskBytes: number;
    serializedBytes: number;
    totalRecords: number;
    storageMode?: 'Persistent Disk' | 'KV Durable Sync' | 'Ephemeral (/tmp)' | 'Local JSON Store';
    persistentStorage?: boolean;
    kvConfigured?: boolean;
    sessionSecretConfigured?: boolean;
    collections: DevCollectionStorageStat[];
  };
  runtime: {
    nodeVersion: string;
    uptimeSeconds: number;
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    wsConnectedClients: number;
  };
  tenantRows: DevTenantTelemetryRow[];
}

export interface DevImpersonationTarget {
  tenantId: string;
  tenantName: string;
  emailDomain: string;
  status: TenantStatus;
  plan: TenantPlan;
  location: string;
  users: TenantUser[];
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

export function getStudentRegisteredSubjects(
  tenant: Pick<Tenant, 'subjects' | 'levelSubjects'>,
  student: Pick<Student, 'grade' | 'registeredSubjects'>
): string[] {
  if (Array.isArray(student.registeredSubjects) && student.registeredSubjects.length > 0) {
    return student.registeredSubjects;
  }
  return getSubjectsForGrade(tenant, student.grade);
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
  /** Slots this teacher cannot be scheduled in (timetable constraint). */
  unavailable?: Array<{ day: DayOfWeek; period: number }>;
  /** Maximum lessons this teacher may be scheduled per day (timetable constraint). */
  maxLessonsPerDay?: number;
}

export type CalendarEntityStatus = 'Open' | 'Closed';

export interface AcademicYear {
  id: string;
  tenantId: string;
  name: string; // e.g. '2026' or '2026–2027'
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  status: CalendarEntityStatus;
  isCurrent: boolean;
  createdAt: string;
  closedAt?: string;
  closedBy?: string;
}

export interface AcademicTerm {
  id: string;
  tenantId: string;
  academicYearId: string;
  name: string; // e.g. 'Term 1'
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  status: CalendarEntityStatus;
  isCurrent: boolean;
  createdAt: string;
  closedAt?: string;
  closedBy?: string;
  reopenedAt?: string;
  reopenedBy?: string;
  reopenReason?: string;
}

export type StudentStatus = 'Active' | 'On Leave' | 'Graduated' | 'Transferred' | 'Withdrawn';

export interface Student {
  id: string;
  tenantId: string;
  studentCode: string;
  upi: string;
  fullName: string;
  grade: string;
  section: string;
  parentUserId?: string;
  studentUserId?: string;
  guardianName: string;
  guardianEmail: string;
  guardianPhone: string;
  gender: 'Female' | 'Male' | 'Non-binary';
  dateOfBirth: string;
  enrolledAt: string;
  status: StudentStatus;
  statusReason?: string;
  statusDate?: string;
  deleted?: boolean;
  deletedAt?: string;
  deletedBy?: string;
  deleteReason?: string;
  creditBalance?: number;
  registeredSubjects?: string[];
}

export type LifecycleAuditAction =
  | 'STUDENT_ENROLLED'
  | 'STUDENT_EDITED'
  | 'STUDENT_SUBJECTS_ASSIGNED'
  | 'STUDENT_TRANSFERRED'
  | 'STUDENT_WITHDRAWN'
  | 'STUDENT_GRADUATED'
  | 'STUDENT_REACTIVATED'
  | 'STUDENT_SOFT_DELETED'
  | 'STUDENT_BULK_IMPORT'
  | 'YEAR_END_PROMOTION'
  | 'STUDENT_PORTAL_PROVISIONED'
  | 'ACADEMIC_YEAR_CREATED'
  | 'ACADEMIC_TERM_CREATED'
  | 'TERM_CLOSED'
  | 'TERM_REOPENED'
  | 'TERM_SET_CURRENT';

export interface LifecycleAuditEntry {
  id: string;
  tenantId: string;
  timestamp: string;
  actorUserId: string;
  who: string;
  role: UserRole;
  action: LifecycleAuditAction;
  entity: 'Student' | 'AcademicYear' | 'AcademicTerm' | 'PromotionBatch' | 'StudentImportBatch';
  entityId: string;
  summary: string;
  reason?: string;
  before?: unknown;
  after?: unknown;
}

export type PromotionAction = 'Promote' | 'Hold Back' | 'Graduate';

export interface PromotionPreviewRow {
  studentId: string;
  studentCode: string;
  fullName: string;
  currentGrade: string;
  currentSection: string;
  defaultAction: PromotionAction;
  nextGrade: string;
  outstandingFeeBalance: number;
  creditBalance: number;
}

export interface PromotionExecuteItem {
  studentId: string;
  action: PromotionAction;
  targetGrade?: string;
  targetSection?: string;
  reason?: string;
}

export interface PromotionExecuteResult {
  promotedCount: number;
  heldBackCount: number;
  graduatedCount: number;
  carriedForwardCount: number;
  carriedForwardAmount: number;
  skippedCount: number;
}

export interface StudentImportRowValidation {
  rowNumber: number;
  raw: Record<string, string>;
  valid: boolean;
  errors: string[];
  normalized?: {
    fullName: string;
    grade: string;
    section: string;
    gender: 'Female' | 'Male' | 'Non-binary';
    dateOfBirth: string;
    studentCode: string;
    upi: string;
    guardianName: string;
    guardianEmail: string;
    guardianPhone: string;
    enrolledAt: string;
  };
}

export interface StudentImportResult {
  dryRun: boolean;
  totalRows: number;
  validCount: number;
  errorCount: number;
  importedCount: number;
  currentActiveCount: number;
  learnerCap: number;
  remainingCapacity: number;
  capExceeded: boolean;
  rows: StudentImportRowValidation[];
  createdStudents: Student[];
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
  /** Lesson card this slot was generated from (if any). */
  lessonId?: string;
  /** Locked slots are never moved or removed by the solver. */
  locked?: boolean;
}

/** Subject-level timetable constraint (double allocations, time bounds, daily limits). */
export interface SubjectTimetableConstraint {
  id: string;
  subject: string;
  /** 'All Grades' (or omitted) applies school-wide unless overridden for a specific grade. */
  grade?: string;
  /** Number of 2-period blocks per week for this subject. */
  doubleLessons?: number;
  /** Earliest allowed start time (HH:MM). Slot startTime must be >= notBeforeTime. */
  notBeforeTime?: string;
  /** Latest allowed end time (HH:MM). Slot endTime must be <= notAfterTime. */
  notAfterTime?: string;
  /** Max periods of this subject per day for a class. */
  maxPerDay?: number;
  /** Preferred or dedicated room for this subject. */
  preferredRoom?: string;
}

/** Optional / elective subject block: subjects scheduled simultaneously in parallel for a class. */
export interface OptionalSubjectGroup {
  id: string;
  name: string;
  /** 'All Grades' (or omitted) applies school-wide, or restrict to one grade. */
  grade?: string;
  /** Parallel subjects taught during the same periods (e.g. ['CRE', 'IRE', 'HRE']). */
  subjects: string[];
}

export function resolveSubjectConstraint(
  tenant: Pick<Tenant, 'subjectConstraints'> | null | undefined,
  grade: string,
  subject: string
): SubjectTimetableConstraint | undefined {
  const list = tenant?.subjectConstraints || [];
  const subNorm = subject.trim().toLowerCase();
  const gradeNorm = grade.trim().toLowerCase();
  const exact = list.find(
    (c) =>
      c.subject.trim().toLowerCase() === subNorm &&
      Boolean(c.grade) &&
      c.grade!.trim().toLowerCase() !== 'all grades' &&
      c.grade!.trim().toLowerCase() === gradeNorm
  );
  if (exact) return exact;
  return list.find(
    (c) =>
      c.subject.trim().toLowerCase() === subNorm &&
      (!c.grade || c.grade.trim().toLowerCase() === 'all grades')
  );
}

export function findOptionalGroupForSubject(
  tenant: Pick<Tenant, 'optionalSubjectGroups'> | null | undefined,
  grade: string,
  subject: string
): OptionalSubjectGroup | undefined {
  const groups = tenant?.optionalSubjectGroups || [];
  const subNorm = subject.trim().toLowerCase();
  const gradeNorm = grade.trim().toLowerCase();
  const exact = groups.find(
    (g) =>
      Boolean(g.grade) &&
      g.grade!.trim().toLowerCase() !== 'all grades' &&
      g.grade!.trim().toLowerCase() === gradeNorm &&
      g.subjects.some((s) => s.trim().toLowerCase() === subNorm)
  );
  if (exact) return exact;
  return groups.find(
    (g) =>
      (!g.grade || g.grade.trim().toLowerCase() === 'all grades') &&
      g.subjects.some((s) => s.trim().toLowerCase() === subNorm)
  );
}

export function areSubjectsInSameOptionalGroup(
  tenant: Pick<Tenant, 'optionalSubjectGroups'> | null | undefined,
  grade: string,
  subjectA: string,
  subjectB: string
): boolean {
  const a = subjectA.trim().toLowerCase();
  const b = subjectB.trim().toLowerCase();
  if (!a || !b || a === b) return false;
  const grpA = findOptionalGroupForSubject(tenant, grade, subjectA);
  const grpB = findOptionalGroupForSubject(tenant, grade, subjectB);
  return Boolean(grpA && grpB && grpA.id === grpB.id);
}

export function isSlotWithinSubjectTimeWindow(
  slot: { startTime: string; endTime: string },
  constraint?: { notBeforeTime?: string; notAfterTime?: string } | null
): { ok: boolean; reason?: string } {
  if (!constraint) return { ok: true };
  if (constraint.notBeforeTime && slot.startTime < constraint.notBeforeTime) {
    return {
      ok: false,
      reason: `Cannot appear before ${constraint.notBeforeTime} (slot starts at ${slot.startTime}).`,
    };
  }
  if (constraint.notAfterTime && slot.endTime > constraint.notAfterTime) {
    return {
      ok: false,
      reason: `Cannot appear after ${constraint.notAfterTime} (slot ends at ${slot.endTime}).`,
    };
  }
  return { ok: true };
}

/** A lesson card: one subject taught to one class by one teacher, N periods a week. */
export interface TimetableLesson {
  id: string;
  grade: string;
  section: string;
  subject: string;
  teacherId: string;
  periodsPerWeek: number;
  /** How many of the weekly periods are taught as 2-period blocks. */
  doubleLessons?: number;
  /** Fixed room (optional). */
  room?: string;
  /** Max periods of this subject per day for this class (optional). */
  maxPerDay?: number;
  /** Earliest allowed start time (HH:MM, optional). */
  notBeforeTime?: string;
  /** Latest allowed end time (HH:MM, optional). */
  notAfterTime?: string;
  /** Optional parallel group ID (optional). */
  optionalGroupId?: string;
}

export interface TimetableSolveResult {
  placedPeriods: number;
  totalPeriods: number;
  createdSlots: number;
  attemptsRun: number;
  warnings: string[];
  unplaced: Array<{
    lessonId: string;
    grade: string;
    section: string;
    subject: string;
    teacherName: string;
    missingPeriods: number;
    reason: string;
  }>;
}

export interface AttendanceRecord {
  id: string;
  tenantId: string;
  termId?: string;
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

export type TeacherLessonAttendanceStatus =
  | 'Attended'
  | 'Delegated'
  | 'Recovered'
  | 'Missed';

export interface TeacherLessonAttendanceRecord {
  id: string;
  tenantId: string;
  termId?: string;
  date: string; // YYYY-MM-DD
  dayOfWeek: DayOfWeek | string;
  timetableSlotId?: string;
  periodNumber?: number;
  timeSlot?: string;
  grade: string;
  section: string;
  subject: string;
  scheduledTeacherId: string;
  scheduledTeacherName: string;
  status: TeacherLessonAttendanceStatus;
  delegatedTeacherId?: string;
  delegatedTeacherName?: string;
  delegationNotes?: string;
  originalMissedDate?: string;
  recoveredDate?: string;
  recoveredPeriod?: number;
  recoveredByTeacherId?: string;
  recoveredByTeacherName?: string;
  topicCovered?: string;
  remarks?: string;
  recordedBy: string;
  recordedByUserId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LeaveOutChit {
  id: string;
  tenantId: string;
  termId?: string;
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

export interface TeacherLeaveDutyDelegation {
  id: string;
  dutyTitle: string;
  delegateTeacherId: string;
  delegateTeacherName: string;
  delegateDepartment?: string;
  grade?: string;
  section?: string;
  subject?: string;
  scheduleOrWindow?: string;
  handoverInstructions?: string;
}

export interface TeacherLeaveOutChit {
  id: string;
  tenantId: string;
  termId?: string;
  teacherId: string;
  teacherName: string;
  department: string;
  startDate: string; // YYYY-MM-DD (inclusive)
  days: number;
  endDate: string; // YYYY-MM-DD (inclusive)
  reason: string;
  dutiesDelegations: TeacherLeaveDutyDelegation[];
  handoverNotes?: string;
  emergencyContact?: string;
  issuedBy: string;
  issuedByUserId?: string;
  createdAt: string;
}

export interface ExamCycle {
  id: string;
  tenantId: string;
  academicYearId?: string;
  termId?: string;
  title: string;
  term: string;
  startDate: string;
  endDate: string;
  status: 'Draft' | 'Grading' | 'Published';
  unlockHistory?: Array<{
    unlockedAt: string;
    unlockedBy: string;
    reason: string;
  }>;
  createdAt: string;
}

export type ExamResultStatus = 'Scored' | 'Absent' | 'Exempt';

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
  resultStatus?: ExamResultStatus;
  remarks: string;
  updatedAt: string;
}

export interface ProgressiveReportSubjectScore {
  subject: string;
  score: number | null;
  maxScore: number;
  resultStatus?: ExamResultStatus;
  letterGrade?: string;
  gpaPoints?: number;
  masteryLevel?: CbcLearnerMasteryLevel;
  remarks?: string;
}

export interface LearnerProgressiveEntry {
  id: string;
  tenantId: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  grade: string;
  section: string;
  academicYear: string;
  term: string;
  assessmentLabel: string;
  assessmentDate: string; // YYYY-MM-DD
  sequenceOrder?: number;
  subjects: ProgressiveReportSubjectScore[];
  totalScore: number;
  maxPossible: number;
  meanScore: number;
  meanGrade: string;
  classTeacherRemarks?: string;
  source: 'manual' | 'import';
  recordedByName?: string;
  recordedByUserId?: string;
  createdAt: string;
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
  termId?: string;
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
  appliedAmount?: number;
  creditedExcess?: number;
  method: PaymentMethod;
  reference: string;
  paidAt: string;
  recordedBy: string;
  voided?: boolean;
  voidReason?: string;
  voidedBy?: string;
  voidedAt?: string;
  isReversalEntry?: boolean;
  reversedPaymentId?: string;
}

export interface FeeInvoice {
  id: string;
  tenantId: string;
  termId?: string;
  invoiceNumber: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  grade: string;
  term: string;
  dueDate: string;
  totalAmount: number;
  creditNotesTotal?: number;
  waiverTotal?: number;
  siblingDiscountApplied?: number;
  carriedForwardFromAmount?: number;
  carriedForwardToTerm?: string;
  paidAmount: number;
  balance: number;
  status: InvoiceStatus;
  payments: PaymentRecord[];
  createdAt: string;
}

export interface CreditNoteRecord {
  id: string;
  tenantId: string;
  creditNoteNumber: string;
  invoiceId: string;
  invoiceNumber: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  amount: number;
  reason: string;
  createdBy: string;
  createdAt: string;
}

export type FeeWaiverKind = 'Waiver' | 'Bursary' | 'Scholarship' | 'Sibling Discount';
export type FeeWaiverMode = 'Percentage' | 'Fixed';

export interface FeeWaiverRecord {
  id: string;
  tenantId: string;
  termId?: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  grade: string;
  term: string;
  kind: FeeWaiverKind;
  mode: FeeWaiverMode;
  value: number;
  discountAmount: number;
  invoiceId?: string;
  invoiceNumber?: string;
  reason: string;
  approvedBy: string;
  createdAt: string;
}

export const INDEPENDENT_VOTELINE_PRESETS = [
  'Transport Fee',
  'Academic Trip Fee',
  'School Uniform & Sportswear',
  'Swimming & Club Levy',
  'Remedial / Holiday Tuition',
  'Graduation & Prize Day Fee',
] as const;

export interface IndependentVotelinePayment {
  id: string;
  receiptNumber: string;
  amount: number;
  method: PaymentMethod;
  reference: string;
  paidAt: string;
  recordedBy: string;
}

export interface IndependentVotelineItem {
  id: string;
  tenantId: string;
  termId?: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  grade: string;
  invoiceId?: string;
  invoiceNumber?: string;
  term: string;
  name: string;
  amount: number;
  paidAmount: number;
  balance: number;
  status: InvoiceStatus;
  note?: string;
  payments: IndependentVotelinePayment[];
  recordedBy: string;
  createdAt: string;
  voided?: boolean;
  voidReason?: string;
  voidedBy?: string;
  voidedAt?: string;
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

export type EtimsVerificationStatus = 'Checked manually' | 'Mismatch' | 'Exempt' | 'Unverified';

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
  voided?: boolean;
  voidReason?: string;
  voidedBy?: string;
  voidedAt?: string;
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
  voided?: boolean;
  voidReason?: string;
  voidedBy?: string;
  voidedAt?: string;
}

export type PayrollStatus = 'Draft' | 'Approved' | 'Disbursed';

export interface PayeBand {
  limit: number | null;
  rate: number;
}

export interface PayrollStatutoryRateSchedule {
  id: string;
  effectiveFrom: string; // YYYY-MM-DD
  label: string;
  currency: CurrencyCode;
  nssfLowerLimit: number;
  nssfUpperLimit: number;
  nssfRate: number;
  nssfMaxEmployee: number;
  shifRate: number;
  shifMin: number;
  housingLevyRate: number;
  nitaLevy: number;
  personalRelief: number;
  payeBands: PayeBand[];
  updatedBy?: string;
  updatedAt: string;
}

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
  employerNssf?: number;
  employerHousingLevy?: number;
  employerNita?: number;
  totalEmployerCost?: number;
  statutoryScheduleId?: string;
  status: PayrollStatus;
  createdByUserId?: string;
  approvedByUserId?: string;
  approvedBy?: string;
  approvedAt?: string;
  voided?: boolean;
  voidReason?: string;
  voidedBy?: string;
  voidedAt?: string;
  reversed?: boolean;
  reversalReason?: string;
  reversedBy?: string;
  reversedAt?: string;
  updatedAt: string;
}

export type BudgetApprovalStatus = 'Draft' | 'Pending Approval' | 'Approved' | 'Rejected';

export interface BudgetAllocation {
  id: string;
  tenantId: string;
  fiscalYear: string;
  term: string;
  category: string;
  allocatedAmount: number;
  status?: BudgetApprovalStatus;
  createdByUserId?: string;
  createdByName?: string;
  approvedBy?: string;
  approvedAt?: string;
  approvalNotes?: string;
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
  createdByUserId?: string;
  createdAt: string;
  signedAt?: string;
  voided?: boolean;
  voidReason?: string;
  voidedBy?: string;
  voidedAt?: string;
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
  createdByUserId?: string;
  approvedByUserId?: string;
  approvedBy?: string;
  approvedAt?: string;
  notes?: string;
  attachments?: ExpenseAttachment[];
  etimsCuNumber?: string;
  supplierKraPin?: string;
  etimsStatus?: EtimsVerificationStatus;
  boardApprovalRef?: string;
  createdAt: string;
  voided?: boolean;
  voidReason?: string;
  voidedBy?: string;
  voidedAt?: string;
  reversed?: boolean;
  reversalReason?: string;
  reversedBy?: string;
  reversedAt?: string;
}

export interface FinanceAuditEntry {
  id: string;
  tenantId: string;
  timestamp: string;
  actorUserId: string;
  who: string;
  role: UserRole;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
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
  academicYears?: AcademicYear[];
  academicTerms?: AcademicTerm[];
  students: Student[];
  archivedStudentsCount?: number;
  lifecycleAuditLogs?: LifecycleAuditEntry[];
  admissions: AdmissionApplication[];
  schemesOfWork?: SchemeOfWork[];
  lessonPlans?: LessonPlan[];
  recordsOfWork?: RecordOfWork[];
  lessonNotes?: LessonNote[];
  timetable: TimetableSlot[];
  attendance: AttendanceRecord[];
  staffAttendance: StaffAttendanceRecord[];
  teacherLessonAttendance?: TeacherLessonAttendanceRecord[];
  leaveOutChits: LeaveOutChit[];
  teacherLeaveOutChits?: TeacherLeaveOutChit[];
  examCycles: ExamCycle[];
  examResults: ExamResult[];
  progressiveReports?: LearnerProgressiveEntry[];
  feeStructures: FeeStructure[];
  invoices: FeeInvoice[];
  creditNotes?: CreditNoteRecord[];
  feeWaivers?: FeeWaiverRecord[];
  independentVotelines?: IndependentVotelineItem[];
  mpesaTransactions?: MpesaTransactionLog[];
  expenses: SchoolExpense[];
  etimsChecks: EtimsVerificationRecord[];
  reconciliationLines: ReconciliationLine[];
  payrollEntries: PayrollEntry[];
  budgets: BudgetAllocation[];
  approvalRecords: ApprovalSignOffRecord[];
  financeAuditLogs?: FinanceAuditEntry[];
  statutoryRateSchedules?: PayrollStatutoryRateSchedule[];
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
