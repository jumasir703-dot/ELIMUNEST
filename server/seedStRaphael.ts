import {
  buildDefaultLevelSubjectsMap,
  buildDefaultLevelWeeklyLessonsMap,
  CLASS_TEACHER_SUBJECT_TOKEN,
  computeAssessmentGrade,
  DEFAULT_ROLE_MODULES,
  DEFAULT_SUBJECT_WEEKLY_LESSONS,
  EXPENSE_CATEGORIES,
  getClusterForGrade,
  getDefaultModuleAccessForTenantRole,
  type AcademicTerm,
  type AcademicYear,
  type Announcement,
  type ApprovalSignOffRecord,
  type AttendanceRecord,
  type BudgetAllocation,
  type CbcClusterId,
  type DayOfWeek,
  type DirectMessage,
  type EtimsVerificationRecord,
  type ExamCycle,
  type ExamResult,
  type FeeInvoice,
  type FeeStructure,
  type FeeWaiverRecord,
  type IndependentVotelineItem,
  type LeaveOutChit,
  type LessonPlan,
  type MpesaTransactionLog,
  type NonTeachingStaffProfile,
  type NotificationItem,
  type PayrollEntry,
  type PayrollStatutoryRateSchedule,
  type ReconciliationLine,
  type SchemeOfWork,
  type SchoolExpense,
  type Student,
  type TeacherClassAssignment,
  type TeacherProfile,
  type Tenant,
  type TenantUser,
  type TimetableSlot,
} from '../src/shared/types.ts';
import { hashPassword } from './middleware/adminAuth.ts';
import { buildDefaultAcademicsForTenant } from './seedAcademics.ts';

export const ST_RAPHAEL_TENANT_ID = 'tenant-st-raphael-ddd9';

export interface StRaphaelStoredUser extends TenantUser {
  passwordHash: string;
  tokenVersion?: number;
}

export interface StRaphaelCredential {
  email: string;
  role: string;
  password: string;
}

export const ST_RAPHAEL_DEFAULT_PASSWORDS: Record<string, string> = {
  'juma.j@straphael.ac.ke': 'StRaphaelAdmin2026!',
  'grace.wanjiku@straphael.ac.ke': 'StRaphaelReg2026!',
  'bursar@straphael.ac.ke': 'StRaphaelBursar2026!',
  'meshack.kipkoech@straphael.ac.ke': 'StRaphaelBudget2026!',
  'tabitha.wanjala@straphael.ac.ke': 'StRaphaelTeach2026!',
  'john.kiprotich@straphael.ac.ke': 'StRaphaelTeach2026!',
  'parent.kamau@straphael.ac.ke': 'StRaphaelParent2026!',
};

const ST_RAPHAEL_GRADES = [
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
] as const;

const STREAMS = ['A', 'B', 'C', 'D'] as const;

const FIRST_NAMES_FEMALE = [
  'Wanjiku', 'Amina', 'Faith', 'Grace', 'Mercy', 'Njeri', 'Chebet', 'Akinyi',
  'Zawadi', 'Nyambura', 'Achieng', 'Esther', 'Beatrice', 'Wambui', 'Sharon', 'Joy',
  'Purity', 'Naomi', 'Muthoni', 'Brenda', 'Cynthia', 'Lydia', 'Miriam', 'Salma',
];
const FIRST_NAMES_MALE = [
  'Brian', 'Kiprop', 'Kamau', 'David', 'Peter', 'Samuel', 'Kevin', 'Dennis',
  'Collins', 'Daniel', 'Victor', 'Emmanuel', 'John', 'Meshack', 'Caleb', 'Ian',
  'Kelvin', 'Joseph', 'Patrick', 'Stephen', 'Felix', 'George', 'Moses', 'Allan',
];
const SURNAMES = [
  'Kamau', 'Ochieng', 'Wanjala', 'Kipkoech', 'Njoroge', 'Muthomi', 'Odhiambo', 'Mwangi',
  'Mutua', 'Kiprotich', 'Chepkoech', 'Wekesa', 'Kariuki', 'Otieno', 'Barasa', 'Kimani',
  'Hassan', 'Mohamed', 'Omondi', 'Koech', 'Naliaka', 'Gathoni', 'Korir', 'Bett',
];

const TEACHER_FIRST_NAMES = [
  'Alice', 'Beatrice', 'Charles', 'Dorcas', 'Edward', 'Florence', 'Geoffrey', 'Hannah',
  'Isaac', 'Jane', 'Kenneth', 'Lilian', 'Martin', 'Nancy', 'Oscar', 'Patricia',
  'Quincy', 'Rose', 'Simon', 'Teresa', 'Ulysses', 'Veronica', 'Wilfred', 'Yvonne',
  'Tabitha', 'Agnes', 'Bernard', 'Caroline', 'Dominic', 'Eunice', 'Francis', 'Gladys',
  'Harrison', 'Irene', 'Jacob', 'Keziah', 'Lawrence', 'Margaret', 'Nicholas', 'Olive',
  'Paul', 'Rachel', 'Samuel', 'Titus', 'John', 'Vincent', 'Winnie', 'Zablon',
  'Abigail', 'Benson', 'Catherine', 'Daniel', 'Elizabeth', 'Felix', 'Grace', 'Humphrey',
  'Immaculate', 'Joseph', 'Kellen', 'Leonard', 'Miriam', 'Nathan', 'Ophelia', 'Patrick',
];

const NON_TEACHING_ROLES: Array<{ role: string; department: string }> = [
  { role: 'School Bursar', department: 'Finance & Accounts' },
  { role: 'Accounts Assistant', department: 'Finance & Accounts' },
  { role: 'Fee Collections Clerk', department: 'Finance & Accounts' },
  { role: 'Senior Laboratory Technician', department: 'Laboratories' },
  { role: 'Junior Lab Assistant', department: 'Laboratories' },
  { role: 'School Matron', department: 'Welfare & Health' },
  { role: 'School Nurse', department: 'Welfare & Health' },
  { role: 'Guidance & Counselling Aid', department: 'Welfare & Health' },
  { role: 'Chief Security Officer', department: 'Security & Grounds' },
  { role: 'Gate & Patrol Guard', department: 'Security & Grounds' },
  { role: 'Grounds & Landscaping Caretaker', department: 'Security & Grounds' },
  { role: 'ICT Systems Technician', department: 'Library & ICT' },
  { role: 'School Librarian', department: 'Library & ICT' },
  { role: 'Head Caterer', department: 'Catering & Kitchen' },
  { role: 'Senior Cook', department: 'Catering & Kitchen' },
  { role: 'Kitchen & Dining Assistant', department: 'Catering & Kitchen' },
  { role: 'Transport Coordinator', department: 'Transport & Fleet' },
  { role: 'Senior School Bus Driver', department: 'Transport & Fleet' },
  { role: 'Facilities & Plumbing Artisan', department: 'Maintenance & Repairs' },
  { role: 'Front Office Receptionist', department: 'Administration' },
];

export interface StRaphaelSeedHelpers {
  periodTimes: Record<number, { startTime: string; endTime: string }>;
  statutorySchedules: PayrollStatutoryRateSchedule[];
  computeStatutoryDeductions: (
    grossPay: number,
    currency: 'KES' | 'USD',
    schedules?: PayrollStatutoryRateSchedule[],
    payPeriod?: string
  ) => {
    paye: number;
    nssf: number;
    shif: number;
    housingLevy: number;
    employerNssf: number;
    employerHousingLevy: number;
    employerNita: number;
    scheduleId: string;
  };
  hashWebhook: (secret: string) => string;
  webhookSecret: string;
}

export interface StRaphaelSeedBundle {
  tenant: Tenant;
  users: StRaphaelStoredUser[];
  credentials: StRaphaelCredential[];
  academicYears: AcademicYear[];
  academicTerms: AcademicTerm[];
  students: Student[];
  timetable: TimetableSlot[];
  attendance: AttendanceRecord[];
  leaveOutChits: LeaveOutChit[];
  examCycles: ExamCycle[];
  examResults: ExamResult[];
  feeStructures: FeeStructure[];
  invoices: FeeInvoice[];
  feeWaivers: FeeWaiverRecord[];
  independentVotelines: IndependentVotelineItem[];
  expenses: SchoolExpense[];
  etimsChecks: EtimsVerificationRecord[];
  reconciliationLines: ReconciliationLine[];
  payrollEntries: PayrollEntry[];
  budgets: BudgetAllocation[];
  approvalRecords: ApprovalSignOffRecord[];
  announcements: Announcement[];
  messages: DirectMessage[];
  notifications: NotificationItem[];
  schemesOfWork: SchemeOfWork[];
  lessonPlans: LessonPlan[];
  mpesaTransactions: MpesaTransactionLog[];
  webhookHash: string;
  counters: {
    receipt: number;
    student: number;
    invoice: number;
    admission: number;
    voucher: number;
  };
}

export async function buildStRaphaelSeedData(
  helpers: StRaphaelSeedHelpers,
  options?: { mustChangePassword?: boolean }
): Promise<StRaphaelSeedBundle> {
  const tenantId = ST_RAPHAEL_TENANT_ID;
  const levelSubjects = buildDefaultLevelSubjectsMap();
  const levelWeeklyLessons = buildDefaultLevelWeeklyLessonsMap();

  const subjectsUnion = Array.from(
    new Set([
      ...levelSubjects.pre_school,
      ...levelSubjects.lower_primary,
      ...levelSubjects.upper_primary,
      ...levelSubjects.junior_school,
    ])
  );

  const gradeStreams: Record<string, string[]> = Object.fromEntries(
    ST_RAPHAEL_GRADES.map((g) => [g, [...STREAMS]])
  );

  const rooms: string[] = [];
  for (const grade of ST_RAPHAEL_GRADES) {
    for (const sec of STREAMS) {
      rooms.push(`${grade} ${sec}`);
    }
  }
  rooms.push('Integrated Science Lab 1', 'Integrated Science Lab 2', 'ICT & Coding Lab', 'Creative Arts Studio', 'Main Hall');

  // ---------------------------------------------------------------------------
  // 1. Build 65 Teachers with 100% Gap-Free Subject & Class Assignments
  // ---------------------------------------------------------------------------
  const teachers: TeacherProfile[] = [];

  // Teacher 0: Head of Institution (Juma J)
  teachers.push({
    id: 't-straph-admin',
    name: 'Juma J',
    email: 'juma.j@straphael.ac.ke',
    phone: '+254 712 880 100',
    department: 'Administration',
    subjects: ['Mathematics', 'Integrated Science'],
    assignedClasses: [
      { grade: 'Grade 9', section: 'A', subject: 'Mathematics' },
      { grade: 'Grade 9', section: 'B', subject: 'Integrated Science' },
    ],
    maxLessonsPerDay: 3,
  });

  // Teachers 1..12: Pre-School Class Teachers (Playgroup, PP1, PP2 x A, B, C, D)
  let tIdx = 1;
  for (const grade of ['Playgroup', 'PP1', 'PP2']) {
    for (const sec of STREAMS) {
      const first = TEACHER_FIRST_NAMES[(tIdx - 1) % TEACHER_FIRST_NAMES.length];
      const sur = SURNAMES[(tIdx * 3) % SURNAMES.length];
      const fullName = `${first} ${sur}`;
      const emailHandle = `${first}.${sur}.${tIdx}`.toLowerCase();
      teachers.push({
        id: `t-straph-${tIdx}`,
        name: fullName,
        email: `${emailHandle}@straphael.ac.ke`,
        phone: `+254 720 ${String(100 + tIdx).padStart(3, '0')} ${String(200 + tIdx).padStart(3, '0')}`,
        department: 'Early Years (ECDE)',
        subjects: [CLASS_TEACHER_SUBJECT_TOKEN, ...levelSubjects.pre_school],
        assignedClasses: [{ grade, section: sec, subject: CLASS_TEACHER_SUBJECT_TOKEN }],
        maxLessonsPerDay: 6,
      });
      tIdx += 1;
    }
  }

  // Teachers 13..24: Lower Primary Class Teachers (Grade 1, 2, 3 x A, B, C, D)
  for (const grade of ['Grade 1', 'Grade 2', 'Grade 3']) {
    for (const sec of STREAMS) {
      const first = TEACHER_FIRST_NAMES[(tIdx - 1) % TEACHER_FIRST_NAMES.length];
      const sur = SURNAMES[(tIdx * 3) % SURNAMES.length];
      const fullName = `${first} ${sur}`;
      const emailHandle = `${first}.${sur}.${tIdx}`.toLowerCase();
      teachers.push({
        id: `t-straph-${tIdx}`,
        name: fullName,
        email: `${emailHandle}@straphael.ac.ke`,
        phone: `+254 721 ${String(100 + tIdx).padStart(3, '0')} ${String(200 + tIdx).padStart(3, '0')}`,
        department: 'Lower Primary',
        subjects: [CLASS_TEACHER_SUBJECT_TOKEN, ...levelSubjects.lower_primary],
        assignedClasses: [{ grade, section: sec, subject: CLASS_TEACHER_SUBJECT_TOKEN }],
        maxLessonsPerDay: 7,
      });
      tIdx += 1;
    }
  }

  // Helper to build Cohort Specialist Teachers
  const upperClasses: Array<{ grade: string; section: string }> = [];
  for (const g of ['Grade 4', 'Grade 5', 'Grade 6']) {
    for (const s of STREAMS) upperClasses.push({ grade: g, section: s });
  }
  const upperTeams = [
    upperClasses.slice(0, 3),
    upperClasses.slice(3, 6),
    upperClasses.slice(6, 9),
    upperClasses.slice(9, 12),
  ];
  const upperSpecs: Array<{ dept: string; subjects: string[] }> = [
    { dept: 'Languages (Upper Primary)', subjects: ['English', 'Kiswahili'] },
    { dept: 'Mathematics (Upper Primary)', subjects: ['Mathematics'] },
    {
      dept: 'Sciences & Agriculture (Upper Primary)',
      subjects: ['Science & Technology', 'Agriculture & Nutrition'],
    },
    {
      dept: 'Humanities & Religious Education (Upper Primary)',
      subjects: ['Social Studies', 'Religious Education (CRE / IRE / HRE)'],
    },
    { dept: 'Creative Arts (Upper Primary)', subjects: ['Creative Arts'] },
  ];

  // Teachers 25..44: 20 Upper Primary Specialists (4 teams x 5 roles)
  // t-straph-25 is Tabitha Wanjala (links cleanly to portal user tabitha.wanjala@straphael.ac.ke)
  for (let teamIdx = 0; teamIdx < upperTeams.length; teamIdx += 1) {
    const teamClasses = upperTeams[teamIdx];
    for (let specIdx = 0; specIdx < upperSpecs.length; specIdx += 1) {
      const spec = upperSpecs[specIdx];
      const isTabitha = tIdx === 25;
      const first = isTabitha ? 'Tabitha' : TEACHER_FIRST_NAMES[(tIdx - 1) % TEACHER_FIRST_NAMES.length];
      const sur = isTabitha ? 'Wanjala' : SURNAMES[(tIdx * 5) % SURNAMES.length];
      const fullName = `${first} ${sur}`;
      const email = isTabitha
        ? 'tabitha.wanjala@straphael.ac.ke'
        : `${first}.${sur}.${tIdx}`.toLowerCase() + '@straphael.ac.ke';
      const assignedClasses: TeacherClassAssignment[] = [];
      for (const cls of teamClasses) {
        for (const sub of spec.subjects) {
          assignedClasses.push({ grade: cls.grade, section: cls.section, subject: sub });
        }
      }
      teachers.push({
        id: `t-straph-${tIdx}`,
        name: fullName,
        email,
        phone: `+254 722 ${String(100 + tIdx).padStart(3, '0')} ${String(300 + tIdx).padStart(3, '0')}`,
        department: spec.dept,
        subjects: [...spec.subjects],
        assignedClasses,
        maxLessonsPerDay: 7,
      });
      tIdx += 1;
    }
  }

  // Teachers 45..64: 20 Junior School Specialists (4 teams x 5 roles)
  // t-straph-45 is John Kiprotich (links cleanly to portal user john.kiprotich@straphael.ac.ke)
  const juniorClasses: Array<{ grade: string; section: string }> = [];
  for (const g of ['Grade 7', 'Grade 8', 'Grade 9']) {
    for (const s of STREAMS) juniorClasses.push({ grade: g, section: s });
  }
  const juniorTeams = [
    juniorClasses.slice(0, 3),
    juniorClasses.slice(3, 6),
    juniorClasses.slice(6, 9),
    juniorClasses.slice(9, 12),
  ];
  const juniorSpecs: Array<{ dept: string; subjects: string[] }> = [
    { dept: 'Languages (Junior School)', subjects: ['English', 'Kiswahili'] },
    {
      dept: 'Mathematics & Pre-Tech (Junior School)',
      subjects: ['Mathematics', 'Pre-Technical Studies'],
    },
    {
      dept: 'Integrated Science & Agriculture (Junior School)',
      subjects: ['Integrated Science', 'Agriculture & Nutrition'],
    },
    {
      dept: 'Humanities & Religious Education (Junior School)',
      subjects: ['Social Studies', 'Religious Education (CRE / IRE / HRE)'],
    },
    {
      dept: 'Creative Arts & Sports (Junior School)',
      subjects: ['Creative Arts & Sports'],
    },
  ];

  for (let teamIdx = 0; teamIdx < juniorTeams.length; teamIdx += 1) {
    const teamClasses = juniorTeams[teamIdx];
    for (let specIdx = 0; specIdx < juniorSpecs.length; specIdx += 1) {
      const spec = juniorSpecs[specIdx];
      const isJohn = tIdx === 45;
      const first = isJohn ? 'John' : TEACHER_FIRST_NAMES[(tIdx - 1) % TEACHER_FIRST_NAMES.length];
      const sur = isJohn ? 'Kiprotich' : SURNAMES[(tIdx * 7) % SURNAMES.length];
      const fullName = `${first} ${sur}`;
      const email = isJohn
        ? 'john.kiprotich@straphael.ac.ke'
        : `${first}.${sur}.${tIdx}`.toLowerCase() + '@straphael.ac.ke';
      const assignedClasses: TeacherClassAssignment[] = [];
      for (const cls of teamClasses) {
        for (const sub of spec.subjects) {
          assignedClasses.push({ grade: cls.grade, section: cls.section, subject: sub });
        }
      }
      teachers.push({
        id: `t-straph-${tIdx}`,
        name: fullName,
        email,
        phone: `+254 723 ${String(100 + tIdx).padStart(3, '0')} ${String(400 + tIdx).padStart(3, '0')}`,
        department: spec.dept,
        subjects: [...spec.subjects],
        assignedClasses,
        maxLessonsPerDay: 7,
      });
      tIdx += 1;
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Non-Teaching Staff (20 profiles)
  // ---------------------------------------------------------------------------
  const nonTeachingStaff: NonTeachingStaffProfile[] = NON_TEACHING_ROLES.map((item, idx) => {
    const first =
      idx === 0
        ? 'Peter'
        : idx % 2 === 0
        ? FIRST_NAMES_MALE[idx % FIRST_NAMES_MALE.length]
        : FIRST_NAMES_FEMALE[idx % FIRST_NAMES_FEMALE.length];
    const sur = idx === 0 ? 'Kamau' : SURNAMES[(idx * 4 + 1) % SURNAMES.length];
    return {
      id: `nts-straph-${idx + 1}`,
      name: `${first} ${sur}`,
      role: item.role,
      department: item.department,
      phone: `+254 714 ${String(200 + idx).padStart(3, '0')} ${String(500 + idx).padStart(3, '0')}`,
      email: idx === 0 ? 'bursar@straphael.ac.ke' : `staff.${idx + 1}@straphael.ac.ke`,
    };
  });

  // ---------------------------------------------------------------------------
  // 3. Tenant Configuration
  // ---------------------------------------------------------------------------
  const tenant: Tenant = {
    id: tenantId,
    name: 'St. Raphael Academy',
    slug: 'st-raphael',
    emailDomain: 'straphael.ac.ke',
    curriculum: 'Kenyan CBC (Playgroup – Grade 9)',
    academicYear: '2026–2027',
    currentTerm: 'Term 3',
    currency: 'KES',
    plan: 'Enterprise',
    status: 'Active',
    learnerCap: 2500,
    subscriptionCycle: 'Annual',
    renewalDate: '2027-09-01',
    location: 'Nakuru, KE',
    contactEmail: 'info@straphael.ac.ke',
    contactPhone: '+254 712 880 100',
    postalAddress: 'P.O. Box 1420-20100, Nakuru',
    branding: {
      primaryColor: '#1D4ED8',
      accentColor: '#0F766E',
      sidebarColor: '#0F172A',
      logoDataUrl: '',
      tagline: 'Wisdom, Discipline & Holistic CBC Excellence',
    },
    mpesaConfig: {
      enabled: true,
      environment: 'Sandbox',
      paybillNumber: '522588',
      accountName: 'St. Raphael Academy Fees',
      accountReferenceFormat: 'Student Code (e.g. STR-260001)',
      hasWebhookSecret: true,
      callbackUrl: `/api/mpesa/c2b-callback/••••${helpers.webhookSecret.slice(-4)}`,
      settlementBank: 'KCB Nakuru School Collection A/C 1189402210',
      updatedAt: '2026-09-01T08:00:00Z',
      updatedBy: 'Juma J',
    },
    grades: [...ST_RAPHAEL_GRADES],
    sections: [...STREAMS],
    gradeStreams,
    subjects: subjectsUnion,
    subjectWeeklyLessons: { ...DEFAULT_SUBJECT_WEEKLY_LESSONS },
    levelSubjects,
    levelSubjectWeeklyLessons: levelWeeklyLessons,
    rooms,
    teachers,
    nonTeachingStaff,
    customRoles: [
      {
        id: 'role-straph-bom-approver',
        name: 'BOM Budget Approver',
        baseRole: 'Budget Approver',
        defaultModules: ['analytics', 'fees', 'communications'],
        defaultModuleAccess: {
          analytics: 'read',
          fees: 'edit',
          communications: 'read',
        },
        description: 'Board of Management signatory for departmental budget & requisition approvals',
      },
    ],
    studentPortalEnabled: true,
    createdAt: '2024-09-01T08:00:00Z',
  };

  // ---------------------------------------------------------------------------
  // 4. St. Raphael Portal User Accounts (6 accounts with stable dev passwords)
  // ---------------------------------------------------------------------------
  const mustChange = Boolean(options?.mustChangePassword);
  const userSpecs: Array<{
    id: string;
    fullName: string;
    email: string;
    phone: string;
    role: TenantUser['role'];
    customRoleId?: string;
    roleLabel?: string;
  }> = [
    {
      id: 'usr-straph-admin',
      fullName: 'Juma J',
      email: 'juma.j@straphael.ac.ke',
      phone: '+254 712 880 100',
      role: 'Admin',
    },
    {
      id: 'usr-straph-registrar',
      fullName: 'Grace Wanjiku',
      email: 'grace.wanjiku@straphael.ac.ke',
      phone: '+254 712 880 102',
      role: 'Registrar',
    },
    {
      id: 'usr-straph-bursar',
      fullName: 'Peter Kamau',
      email: 'bursar@straphael.ac.ke',
      phone: '+254 714 200 500',
      role: 'Bursar',
    },
    {
      id: 'usr-straph-budget',
      fullName: 'Meshack Kipkoech',
      email: 'meshack.kipkoech@straphael.ac.ke',
      phone: '+254 712 880 104',
      role: 'Budget Approver',
      customRoleId: 'role-straph-bom-approver',
      roleLabel: 'BOM Budget Approver',
    },
    {
      id: 'usr-straph-teacher-1',
      fullName: 'Tabitha Wanjala',
      email: 'tabitha.wanjala@straphael.ac.ke',
      phone: teachers.find((t) => t.id === 't-straph-25')?.phone || '+254 722 125 325',
      role: 'Teacher',
    },
    {
      id: 'usr-straph-teacher-2',
      fullName: 'John Kiprotich',
      email: 'john.kiprotich@straphael.ac.ke',
      phone: teachers.find((t) => t.id === 't-straph-45')?.phone || '+254 723 145 445',
      role: 'Teacher',
    },
    {
      id: 'usr-straph-parent',
      fullName: 'Mary Kamau',
      email: 'parent.kamau@straphael.ac.ke',
      phone: '+254 712 880 199',
      role: 'Parent',
    },
  ];

  const users: StRaphaelStoredUser[] = [];
  const credentials: StRaphaelCredential[] = [];
  for (const spec of userSpecs) {
    const pw = ST_RAPHAEL_DEFAULT_PASSWORDS[spec.email] || 'StRaphaelPass2026!';
    const moduleAccess = getDefaultModuleAccessForTenantRole(tenant, spec.role, spec.customRoleId);
    const allowedModules = [...(DEFAULT_ROLE_MODULES[spec.role] || ['analytics'])];
    users.push({
      id: spec.id,
      tenantId,
      fullName: spec.fullName,
      email: spec.email,
      phone: spec.phone,
      role: spec.role,
      ...(spec.customRoleId ? { customRoleId: spec.customRoleId, roleLabel: spec.roleLabel } : {}),
      passwordHash: await hashPassword(pw),
      status: 'Active',
      mustChangePassword: mustChange,
      tokenVersion: 0,
      allowedModules,
      moduleAccess,
      createdAt: '2024-09-01T08:00:00Z',
    });
    credentials.push({
      email: spec.email,
      role: `${spec.role} (St. Raphael)`,
      password: pw,
    });
  }

  // ---------------------------------------------------------------------------
  // 5. Academic Years & Terms (2-year history: 2024–2025, 2025–2026, 2026–2027)
  // ---------------------------------------------------------------------------
  const academicYears: AcademicYear[] = [
    {
      id: 'ay-straph-2024',
      tenantId,
      name: '2024–2025',
      startDate: '2024-09-02',
      endDate: '2025-07-25',
      status: 'Closed',
      isCurrent: false,
      createdAt: '2024-08-20T08:00:00Z',
      closedAt: '2025-07-26T16:00:00Z',
      closedBy: 'Juma J',
    },
    {
      id: 'ay-straph-2025',
      tenantId,
      name: '2025–2026',
      startDate: '2025-09-01',
      endDate: '2026-07-24',
      status: 'Closed',
      isCurrent: false,
      createdAt: '2025-08-18T08:00:00Z',
      closedAt: '2026-07-25T16:00:00Z',
      closedBy: 'Juma J',
    },
    {
      id: 'ay-straph-2026',
      tenantId,
      name: '2026–2027',
      startDate: '2026-01-05',
      endDate: '2026-11-27',
      status: 'Open',
      isCurrent: true,
      createdAt: '2026-01-02T08:00:00Z',
    },
  ];

  const academicTerms: AcademicTerm[] = [
    {
      id: 'term-straph-2024-1',
      tenantId,
      academicYearId: 'ay-straph-2024',
      name: 'Term 1',
      startDate: '2024-09-02',
      endDate: '2024-12-06',
      status: 'Closed',
      isCurrent: false,
      createdAt: '2024-08-20T08:00:00Z',
      closedAt: '2024-12-07T12:00:00Z',
      closedBy: 'Juma J',
    },
    {
      id: 'term-straph-2025-1',
      tenantId,
      academicYearId: 'ay-straph-2025',
      name: 'Term 1',
      startDate: '2025-09-01',
      endDate: '2025-12-05',
      status: 'Closed',
      isCurrent: false,
      createdAt: '2025-08-18T08:00:00Z',
      closedAt: '2025-12-06T12:00:00Z',
      closedBy: 'Juma J',
    },
    {
      id: 'term-straph-2026-1',
      tenantId,
      academicYearId: 'ay-straph-2026',
      name: 'Term 1',
      startDate: '2026-01-05',
      endDate: '2026-04-03',
      status: 'Closed',
      isCurrent: false,
      createdAt: '2026-01-02T08:00:00Z',
      closedAt: '2026-04-04T12:00:00Z',
      closedBy: 'Juma J',
    },
    {
      id: 'term-straph-2026-2',
      tenantId,
      academicYearId: 'ay-straph-2026',
      name: 'Term 2',
      startDate: '2026-05-04',
      endDate: '2026-08-07',
      status: 'Closed',
      isCurrent: false,
      createdAt: '2026-04-25T08:00:00Z',
      closedAt: '2026-08-08T12:00:00Z',
      closedBy: 'Juma J',
    },
    {
      id: 'term-straph-2026-3',
      tenantId,
      academicYearId: 'ay-straph-2026',
      name: 'Term 3',
      startDate: '2026-09-01',
      endDate: '2026-11-27',
      status: 'Open',
      isCurrent: true,
      createdAt: '2026-08-25T08:00:00Z',
    },
  ];

  // ---------------------------------------------------------------------------
  // 6. Students: 2,000 Active (80% of 2,500) + 16 Alumni = 2,016 Total
  //    Every learner assigned explicit registeredSubjects matching their CBC level
  // ---------------------------------------------------------------------------
  const students: Student[] = [];
  const baseDobYearByGradeIdx = [
    2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013, 2012, 2011,
  ];
  let stuSeq = 1;
  let classCursor = 0;

  for (let gIdx = 0; gIdx < ST_RAPHAEL_GRADES.length; gIdx += 1) {
    const grade = ST_RAPHAEL_GRADES[gIdx];
    const clusterId: CbcClusterId = getClusterForGrade(grade);
    const registeredSubjects = [...levelSubjects[clusterId]];
    const birthYear = baseDobYearByGradeIdx[gIdx];

    for (let sIdx = 0; sIdx < STREAMS.length; sIdx += 1) {
      const section = STREAMS[sIdx];
      // 32 classes x 42 + 16 classes x 41 = 1344 + 656 = 2,000 active learners
      const countInClass = classCursor < 32 ? 42 : 41;
      classCursor += 1;

      for (let i = 0; i < countInClass; i += 1) {
        const isFemale = stuSeq % 2 === 1;
        const first = isFemale
          ? FIRST_NAMES_FEMALE[(stuSeq * 3 + i) % FIRST_NAMES_FEMALE.length]
          : FIRST_NAMES_MALE[(stuSeq * 5 + i) % FIRST_NAMES_MALE.length];
        const mid = SURNAMES[(stuSeq + gIdx) % SURNAMES.length];
        const last = SURNAMES[(stuSeq * 7 + sIdx) % SURNAMES.length];
        const fullName = `${first} ${mid} ${last}`;
        const codeNum = 260000 + stuSeq;
        const studentCode = `STR-${codeNum}`;
        const month = String(((stuSeq + i) % 12) + 1).padStart(2, '0');
        const day = String(((stuSeq * 3 + i) % 28) + 1).padStart(2, '0');
        const guardFirst =
          (stuSeq % 3 === 0 ? FIRST_NAMES_MALE : FIRST_NAMES_FEMALE)[
            (stuSeq + 2) % FIRST_NAMES_FEMALE.length
          ];
        const enrolledYear = gIdx >= 3 ? '2024-09-02' : '2025-09-01';

        students.push({
          id: `stu-straph-${stuSeq}`,
          tenantId,
          studentCode,
          upi: `KEN-STR${codeNum}`,
          fullName,
          grade,
          section,
          guardianName: `${guardFirst} ${last}`,
          guardianEmail: `parent.${studentCode.toLowerCase()}@straphael.ac.ke`,
          guardianPhone: `+2547${String(10 + (stuSeq % 89)).padStart(2, '0')}${String(
            100000 + ((stuSeq * 137) % 899999)
          ).padStart(6, '0')}`,
          gender: isFemale ? 'Female' : 'Male',
          dateOfBirth: `${birthYear}-${month}-${day}`,
          enrolledAt: enrolledYear,
          status: 'Active',
          registeredSubjects,
        });
        stuSeq += 1;
      }
    }
  }

  // 16 Graduated Alumni from 2024–2025 cohort
  for (let a = 1; a <= 16; a += 1) {
    const isFemale = a % 2 === 0;
    const first = isFemale
      ? FIRST_NAMES_FEMALE[a % FIRST_NAMES_FEMALE.length]
      : FIRST_NAMES_MALE[a % FIRST_NAMES_MALE.length];
    const last = SURNAMES[(a * 3) % SURNAMES.length];
    const codeNum = 240000 + a;
    const studentCode = `STR-${codeNum}`;
    students.push({
      id: `stu-straph-alum-${a}`,
      tenantId,
      studentCode,
      upi: `KEN-STR${codeNum}`,
      fullName: `${first} ${last}`,
      grade: 'Grade 9',
      section: STREAMS[a % 4],
      guardianName: `Parent ${last}`,
      guardianEmail: `alumni.${studentCode.toLowerCase()}@straphael.ac.ke`,
      guardianPhone: `+254722${String(300000 + a * 111).padStart(6, '0')}`,
      gender: isFemale ? 'Female' : 'Male',
      dateOfBirth: `2010-${String((a % 12) + 1).padStart(2, '0')}-15`,
      enrolledAt: '2024-01-08',
      status: 'Graduated',
      statusReason: 'Completed KJSEA Grade 9 Cohort 2025',
      statusDate: '2025-12-05',
      registeredSubjects: [...levelSubjects.junior_school],
    });
  }

  // Link one Grade 4 A learner (taught by Tabitha Wanjala) and one Grade 7 A learner
  // (taught by John Kiprotich) to parent.kamau@straphael.ac.ke for parent visibility demos.
  const demoChildG4 = students.find(
    (s) => s.status === 'Active' && s.grade === 'Grade 4' && s.section === 'A'
  );
  if (demoChildG4) {
    demoChildG4.parentUserId = 'usr-straph-parent';
  }
  const demoChildG7 = students.find(
    (s) => s.status === 'Active' && s.grade === 'Grade 7' && s.section === 'A'
  );
  if (demoChildG7) {
    demoChildG7.parentUserId = 'usr-straph-parent';
  }

  // ---------------------------------------------------------------------------
  // 7. Collision-Free Weekly Timetable Slots (480 slots across all 48 classes)
  // ---------------------------------------------------------------------------
  const timetable: TimetableSlot[] = [];
  const days: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  let slotSeq = 1;

  const pushSlot = (
    day: DayOfWeek,
    period: number,
    grade: string,
    section: string,
    subject: string,
    teacher: TeacherProfile,
    room: string
  ) => {
    const pt = helpers.periodTimes[period] || { startTime: '08:00', endTime: '08:40' };
    timetable.push({
      id: `tt-straph-${slotSeq++}`,
      tenantId,
      day,
      period,
      startTime: pt.startTime,
      endTime: pt.endTime,
      grade,
      section,
      subject,
      teacherId: teacher.id,
      teacherName: teacher.name,
      room,
    });
  };

  // Pre-School & Lower Primary: 1 dedicated class teacher per stream (zero overlap possible)
  for (let i = 0; i < 24; i += 1) {
    const tc = teachers[i + 1]; // t-straph-1 .. t-straph-24
    const cls = tc.assignedClasses![0];
    const cluster = getClusterForGrade(cls.grade);
    const subs = levelSubjects[cluster];
    const room = `${cls.grade} ${cls.section}`;
    for (let dIdx = 0; dIdx < days.length; dIdx += 1) {
      for (let p = 1; p <= 2; p += 1) {
        const sub = subs[(dIdx * 2 + (p - 1)) % subs.length];
        pushSlot(days[dIdx], p, cls.grade, cls.section, sub, tc, room);
      }
    }
  }

  // Upper Primary Teams (teachers 25..44) & Junior School Teams (teachers 45..64)
  // Latin-square rotation per 3-class team guarantees zero teacher & room collisions!
  const scheduleCohortTeams = (
    teams: Array<Array<{ grade: string; section: string }>>,
    teacherOffset: number
  ) => {
    for (let teamIdx = 0; teamIdx < teams.length; teamIdx += 1) {
      const teamClasses = teams[teamIdx];
      const teamTeachers = teachers.slice(
        teacherOffset + teamIdx * 5,
        teacherOffset + teamIdx * 5 + 5
      );
      for (let cIdx = 0; cIdx < teamClasses.length; cIdx += 1) {
        const cls = teamClasses[cIdx];
        const room = `${cls.grade} ${cls.section}`;
        for (let dIdx = 0; dIdx < days.length; dIdx += 1) {
          for (let p = 1; p <= 2; p += 1) {
            const specIdx = (dIdx + (p - 1) * 2 + cIdx) % 5;
            const tc = teamTeachers[specIdx];
            const sub = tc.subjects[(dIdx + p) % tc.subjects.length];
            pushSlot(days[dIdx], p, cls.grade, cls.section, sub, tc, room);
          }
        }
      }
    }
  };

  scheduleCohortTeams(upperTeams, 25);
  scheduleCohortTeams(juniorTeams, 45);

  // ---------------------------------------------------------------------------
  // 8. Fee Structures (Term 1, Term 2, Term 3) & 3,984+ Invoices
  // ---------------------------------------------------------------------------
  const feeStructures: FeeStructure[] = [];
  const feeAmountByGrade: Record<string, { tuition: number; lab: number; ict: number; act: number }> = {
    Playgroup: { tuition: 14000, lab: 500, ict: 1000, act: 2500 },
    PP1: { tuition: 15500, lab: 500, ict: 1200, act: 2800 },
    PP2: { tuition: 16500, lab: 500, ict: 1200, act: 2800 },
    'Grade 1': { tuition: 18500, lab: 800, ict: 1500, act: 3200 },
    'Grade 2': { tuition: 19000, lab: 800, ict: 1500, act: 3200 },
    'Grade 3': { tuition: 19500, lab: 1000, ict: 1500, act: 3500 },
    'Grade 4': { tuition: 22000, lab: 1500, ict: 2000, act: 3500 },
    'Grade 5': { tuition: 22500, lab: 1500, ict: 2000, act: 3500 },
    'Grade 6': { tuition: 23500, lab: 1800, ict: 2200, act: 3500 },
    'Grade 7': { tuition: 27000, lab: 2500, ict: 2500, act: 4000 },
    'Grade 8': { tuition: 28000, lab: 2800, ict: 2500, act: 4200 },
    'Grade 9': { tuition: 29500, lab: 3000, ict: 3000, act: 4500 },
  };

  const termDefs = [
    { name: 'Term 1', termId: 'term-straph-2026-1', dueDate: '2026-02-01', created: '2026-01-05T08:00:00Z' },
    { name: 'Term 2', termId: 'term-straph-2026-2', dueDate: '2026-05-25', created: '2026-05-04T08:00:00Z' },
    { name: 'Term 3', termId: 'term-straph-2026-3', dueDate: '2026-09-25', created: '2026-09-01T08:00:00Z' },
  ];

  for (const tDef of termDefs) {
    for (const grade of ST_RAPHAEL_GRADES) {
      const cfg = feeAmountByGrade[grade];
      const total = cfg.tuition + cfg.lab + cfg.ict + cfg.act;
      feeStructures.push({
        id: `fs-straph-${tDef.name.replace(/\s+/g, '').toLowerCase()}-${grade.replace(/\s+/g, '').toLowerCase()}`,
        tenantId,
        termId: tDef.termId,
        grade,
        term: tDef.name,
        votelines: [
          { id: 'vl-tuition', name: 'Tuition & Academics', amount: cfg.tuition },
          { id: 'vl-lab', name: 'Science & Practical Lab', amount: cfg.lab },
          { id: 'vl-tech', name: 'ICT & Digital Learning', amount: cfg.ict },
          { id: 'vl-act', name: 'Catering & Co-Curricular', amount: cfg.act },
        ],
        tuitionFee: cfg.tuition,
        labFee: cfg.lab,
        technologyFee: cfg.ict,
        activitiesFee: cfg.act,
        totalFee: total,
      });
    }
  }

  const invoices: FeeInvoice[] = [];
  let invSeq = 1;
  let rctSeq = 1;
  const activeStudents = students.filter((s) => s.status === 'Active');

  // Term 2 historical invoices (mostly paid) + Term 3 active invoices for all 2,000 active students
  activeStudents.forEach((stu, idx) => {
    const cfg = feeAmountByGrade[stu.grade];
    const total = cfg.tuition + cfg.lab + cfg.ict + cfg.act;

    // Term 2 invoice (for first 1,984 learners to reflect multi-term ledger history)
    if (idx < 1984) {
      const invNum2 = `STR-INV-2026T2-${String(invSeq).padStart(4, '0')}`;
      const rctNum2 = `STR-RCT-${String(rctSeq++).padStart(5, '0')}`;
      invoices.push({
        id: `inv-straph-${invSeq++}`,
        tenantId,
        termId: 'term-straph-2026-2',
        invoiceNumber: invNum2,
        studentId: stu.id,
        studentName: stu.fullName,
        studentCode: stu.studentCode,
        grade: stu.grade,
        term: 'Term 2',
        dueDate: '2026-05-25',
        totalAmount: total,
        paidAmount: total,
        balance: 0,
        status: 'Paid',
        payments: [
          {
            id: `pay-straph-t2-${idx + 1}`,
            receiptNumber: rctNum2,
            amount: total,
            method: idx % 3 === 0 ? 'Bank Transfer' : 'Mobile Money',
            reference: `UJK${String(100000 + idx)}T2`,
            paidAt: '2026-05-14T10:15:00Z',
            recordedBy: 'Peter Kamau',
          },
        ],
        createdAt: '2026-05-04T08:00:00Z',
      });
    }

    // Term 3 invoice for all 2,000 active learners (70% Paid, 20% Partial, 10% Pending)
    const mod = idx % 10;
    const paidAmount = mod < 7 ? total : mod < 9 ? Math.round(total * 0.6) : 0;
    const balance = total - paidAmount;
    const status: FeeInvoice['status'] =
      balance === 0 ? 'Paid' : paidAmount > 0 ? 'Partial' : 'Pending';
    const invNum3 = `STR-INV-2026T3-${String(invSeq).padStart(4, '0')}`;

    invoices.push({
      id: `inv-straph-${invSeq++}`,
      tenantId,
      termId: 'term-straph-2026-3',
      invoiceNumber: invNum3,
      studentId: stu.id,
      studentName: stu.fullName,
      studentCode: stu.studentCode,
      grade: stu.grade,
      term: 'Term 3',
      dueDate: '2026-09-25',
      totalAmount: total,
      paidAmount,
      balance,
      status,
      payments:
        paidAmount > 0
          ? [
              {
                id: `pay-straph-t3-${idx + 1}`,
                receiptNumber: `STR-RCT-${String(rctSeq++).padStart(5, '0')}`,
                amount: paidAmount,
                method: idx % 4 === 0 ? 'Bank Transfer' : 'Mobile Money',
                reference: `UJM${String(200000 + idx)}T3`,
                paidAt: '2026-09-12T09:30:00Z',
                recordedBy: 'Peter Kamau',
              },
            ]
          : [],
      createdAt: '2026-09-01T08:00:00Z',
    });
  });

  const feeWaivers: FeeWaiverRecord[] = [
    {
      id: 'waiv-straph-1',
      tenantId,
      termId: 'term-straph-2026-3',
      studentId: activeStudents[0].id,
      studentName: activeStudents[0].fullName,
      studentCode: activeStudents[0].studentCode,
      grade: activeStudents[0].grade,
      term: 'Term 3',
      kind: 'Scholarship',
      mode: 'Percentage',
      value: 25,
      discountAmount: 4500,
      invoiceId: invoices[1]?.id,
      invoiceNumber: invoices[1]?.invoiceNumber,
      reason: 'Academic Merit & Parish Bursary Support',
      approvedBy: 'Juma J',
      createdAt: '2026-09-05T10:00:00Z',
    },
  ];

  const independentVotelines: IndependentVotelineItem[] = [
    {
      id: 'ivl-straph-1',
      tenantId,
      termId: 'term-straph-2026-3',
      studentId: activeStudents[0].id,
      studentName: activeStudents[0].fullName,
      studentCode: activeStudents[0].studentCode,
      grade: activeStudents[0].grade,
      term: 'Term 3',
      name: 'Transport Fee',
      amount: 6500,
      paidAmount: 6500,
      balance: 0,
      status: 'Paid',
      note: 'Nakuru Milimani Morning & Evening Bus Route',
      payments: [
        {
          id: 'ivlp-straph-1',
          receiptNumber: `STR-RCT-${String(rctSeq++).padStart(5, '0')}`,
          amount: 6500,
          method: 'Mobile Money',
          reference: 'UJM88102TR',
          paidAt: '2026-09-07T08:40:00Z',
          recordedBy: 'Peter Kamau',
        },
      ],
      recordedBy: 'Peter Kamau',
      createdAt: '2026-09-03T08:00:00Z',
    },
  ];

  // ---------------------------------------------------------------------------
  // 9. Exam Cycles & Exam Results (Term 2 End-of-Term + Term 3 Mid-Term)
  // ---------------------------------------------------------------------------
  const examCycles: ExamCycle[] = [
    {
      id: 'exm-straph-2026-t2-end',
      tenantId,
      academicYearId: 'ay-straph-2026',
      termId: 'term-straph-2026-2',
      title: 'Term 2 End of Term Exam',
      term: 'Term 2',
      startDate: '2026-08-03',
      endDate: '2026-08-07',
      status: 'Published',
      createdAt: '2026-07-20T08:00:00Z',
    },
    {
      id: 'exm-straph-2026-t3-mid',
      tenantId,
      academicYearId: 'ay-straph-2026',
      termId: 'term-straph-2026-3',
      title: 'Term 3 Mid-Term Exam',
      term: 'Term 3',
      startDate: '2026-10-12',
      endDate: '2026-10-16',
      status: 'Published',
      createdAt: '2026-10-01T08:00:00Z',
    },
  ];

  const examResults: ExamResult[] = [];
  activeStudents.forEach((stu, idx) => {
    const subs = stu.registeredSubjects || levelSubjects[getClusterForGrade(stu.grade)];
    subs.forEach((subject, sIdx) => {
      const scoreT2 = 52 + ((idx * 7 + sIdx * 11) % 44); // 52..95
      const gT2 = computeAssessmentGrade(scoreT2, stu.grade);
      examResults.push({
        id: `res-straph-t2-${stu.id}-${sIdx}`,
        tenantId,
        examCycleId: 'exm-straph-2026-t2-end',
        studentId: stu.id,
        studentName: stu.fullName,
        studentCode: stu.studentCode,
        grade: stu.grade,
        section: stu.section,
        subject,
        score: scoreT2,
        maxScore: 100,
        letterGrade: gT2.letterGrade,
        gpaPoints: gT2.gpaPoints,
        resultStatus: 'Scored',
        remarks: scoreT2 >= 75 ? 'Exceeding Expectations' : 'Meeting Expectations',
        updatedAt: '2026-08-10T12:00:00Z',
      });

      const scoreT3 = Math.min(99, scoreT2 + ((idx + sIdx) % 5) - 1);
      const gT3 = computeAssessmentGrade(scoreT3, stu.grade);
      examResults.push({
        id: `res-straph-t3-${stu.id}-${sIdx}`,
        tenantId,
        examCycleId: 'exm-straph-2026-t3-mid',
        studentId: stu.id,
        studentName: stu.fullName,
        studentCode: stu.studentCode,
        grade: stu.grade,
        section: stu.section,
        subject,
        score: scoreT3,
        maxScore: 100,
        letterGrade: gT3.letterGrade,
        gpaPoints: gT3.gpaPoints,
        resultStatus: 'Scored',
        remarks: scoreT3 >= 75 ? 'Strong Term 3 CBC mastery' : 'Steady term progress',
        updatedAt: '2026-10-20T14:00:00Z',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 10. Attendance (3 school days x 2,000 active = 6,000 records) + Leave-out Chits
  // ---------------------------------------------------------------------------
  const attendance: AttendanceRecord[] = [];
  const attDates = ['2026-11-12', '2026-11-13', '2026-11-16'];
  attDates.forEach((date, dIdx) => {
    activeStudents.forEach((stu, sIdx) => {
      const code = (sIdx + dIdx * 17) % 50;
      const status: AttendanceRecord['status'] =
        code === 0 ? 'Absent' : code === 1 ? 'Late' : code === 2 ? 'Excused' : 'Present';
      attendance.push({
        id: `att-straph-${date}-${stu.id}`,
        tenantId,
        termId: 'term-straph-2026-3',
        date,
        grade: stu.grade,
        section: stu.section,
        studentId: stu.id,
        studentName: stu.fullName,
        studentCode: stu.studentCode,
        status,
        remarks:
          status === 'Absent'
            ? 'Parent notified morning office'
            : status === 'Late'
            ? 'Arrived 10 mins past assembly'
            : status === 'Excused'
            ? 'Approved medical / co-curricular leave'
            : '',
        recordedBy: 'Class Teacher',
        updatedAt: `${date}T08:30:00Z`,
      });
    });
  });

  const leaveOutChits: LeaveOutChit[] = [
    {
      id: 'loc-straph-1',
      tenantId,
      termId: 'term-straph-2026-3',
      studentId: activeStudents[10].id,
      studentName: activeStudents[10].fullName,
      studentCode: activeStudents[10].studentCode,
      grade: activeStudents[10].grade,
      section: activeStudents[10].section,
      startDate: '2026-11-16',
      days: 2,
      endDate: '2026-11-17',
      reason: 'Scheduled dental review with guardian',
      issuedBy: 'Juma J',
      createdAt: '2026-11-16T07:45:00Z',
    },
  ];

  // ---------------------------------------------------------------------------
  // 11. Payroll (2 months x 85 staff = 170 entries), Budgets (48), Expenses, Approvals
  // ---------------------------------------------------------------------------
  const payrollEntries: PayrollEntry[] = [];
  const payPeriods = ['2026-10', '2026-11'];
  for (const payPeriod of payPeriods) {
    teachers.forEach((tc, idx) => {
      const basicSalary = idx === 0 ? 115000 : 54000 + (idx % 12) * 3200;
      const allowances = idx === 0 ? 18000 : 8500;
      const grossPay = basicSalary + allowances;
      const stat = helpers.computeStatutoryDeductions(
        grossPay,
        'KES',
        helpers.statutorySchedules,
        payPeriod
      );
      const saccoOrLoan = idx % 3 === 0 ? 4000 : 0;
      const totalDeductions = stat.paye + stat.nssf + stat.shif + stat.housingLevy + saccoOrLoan;
      payrollEntries.push({
        id: `payr-straph-${payPeriod}-t-${idx + 1}`,
        tenantId,
        payPeriod,
        staffId: tc.id,
        staffName: tc.name,
        staffCategory: 'Teaching',
        designation: idx === 0 ? 'Head of Institution' : `${tc.department} Teacher`,
        basicSalary,
        allowances,
        grossPay,
        paye: stat.paye,
        nssf: stat.nssf,
        shif: stat.shif,
        housingLevy: stat.housingLevy,
        saccoOrLoan,
        totalDeductions,
        netPay: Math.max(0, grossPay - totalDeductions),
        employerNssf: stat.employerNssf,
        employerHousingLevy: stat.employerHousingLevy,
        employerNita: stat.employerNita,
        totalEmployerCost: grossPay + stat.employerNssf + stat.employerHousingLevy + stat.employerNita,
        statutoryScheduleId: stat.scheduleId,
        status: 'Approved',
        createdByUserId: 'usr-straph-bursar',
        approvedBy: 'Juma J',
        approvedAt: `${payPeriod}-25T10:00:00Z`,
        updatedAt: `${payPeriod}-25T10:00:00Z`,
      });
    });

    nonTeachingStaff.forEach((staff, idx) => {
      const basicSalary = idx === 0 ? 68000 : 28000 + (idx % 8) * 2500;
      const allowances = 4500;
      const grossPay = basicSalary + allowances;
      const stat = helpers.computeStatutoryDeductions(
        grossPay,
        'KES',
        helpers.statutorySchedules,
        payPeriod
      );
      const saccoOrLoan = idx % 4 === 0 ? 2500 : 0;
      const totalDeductions = stat.paye + stat.nssf + stat.shif + stat.housingLevy + saccoOrLoan;
      payrollEntries.push({
        id: `payr-straph-${payPeriod}-n-${idx + 1}`,
        tenantId,
        payPeriod,
        staffId: staff.id,
        staffName: staff.name,
        staffCategory: 'Non-Teaching',
        designation: staff.role,
        basicSalary,
        allowances,
        grossPay,
        paye: stat.paye,
        nssf: stat.nssf,
        shif: stat.shif,
        housingLevy: stat.housingLevy,
        saccoOrLoan,
        totalDeductions,
        netPay: Math.max(0, grossPay - totalDeductions),
        employerNssf: stat.employerNssf,
        employerHousingLevy: stat.employerHousingLevy,
        employerNita: stat.employerNita,
        totalEmployerCost: grossPay + stat.employerNssf + stat.employerHousingLevy + stat.employerNita,
        statutoryScheduleId: stat.scheduleId,
        status: payPeriod === '2026-10' ? 'Approved' : 'Draft',
        createdByUserId: 'usr-straph-bursar',
        approvedBy: 'Juma J',
        approvedAt: `${payPeriod}-25T10:00:00Z`,
        updatedAt: `${payPeriod}-25T10:00:00Z`,
      });
    });
  }

  // 48 Budget Allocations (2-year history across 2024–2025, 2025–2026, 2026–2027)
  const budgets: BudgetAllocation[] = [];
  const budgetConfigs: Array<{ year: string; term: string; pending: boolean }> = [
    { year: '2024–2025', term: 'Term 3', pending: false },
    { year: '2025–2026', term: 'Term 2', pending: false },
    { year: '2025–2026', term: 'Term 3', pending: false },
    { year: '2026–2027', term: 'Term 1', pending: false },
    { year: '2026–2027', term: 'Term 2', pending: false },
    { year: '2026–2027', term: 'Term 3', pending: true },
  ];
  const categoryAmounts: Record<(typeof EXPENSE_CATEGORIES)[number], number> = {
    'Payroll & Allowances': 6200000,
    'Utilities & Water': 480000,
    'Catering & Boarding': 2400000,
    'Teaching & Lab Supplies': 760000,
    'Maintenance & Repairs': 520000,
    'Transport & Fuel': 640000,
    'ICT & Software': 410000,
    'Administration & Statutory': 590000,
  };
  let bdgIdx = 1;
  for (const cfg of budgetConfigs) {
    EXPENSE_CATEGORIES.forEach((category, cIdx) => {
      const isPending = cfg.pending && (cIdx === 5 || cIdx === 6);
      budgets.push({
        id: `bdg-straph-${bdgIdx++}`,
        tenantId,
        fiscalYear: cfg.year,
        term: cfg.term,
        category,
        allocatedAmount: categoryAmounts[category],
        status: isPending ? 'Pending Approval' : 'Approved',
        createdByUserId: 'usr-straph-bursar',
        approvedBy: isPending ? undefined : 'Meshack Kipkoech',
        approvedAt: isPending ? undefined : '2026-09-02T09:00:00Z',
        approvalNotes: isPending
          ? 'Awaiting BOM Budget Approver sign-off for Term 3 adjustment.'
          : `Approved by BOM Finance Committee for ${cfg.year} ${cfg.term}.`,
        notes: `${cfg.year} ${cfg.term} allocation`,
        updatedAt: '2026-09-02T09:00:00Z',
      });
    });
  }

  const expenses: SchoolExpense[] = [
    {
      id: 'exp-straph-1',
      tenantId,
      voucherNumber: 'STR-EXP-202601',
      title: 'Junior School Integrated Science Apparatus',
      category: 'Teaching & Lab Supplies',
      vendor: 'AfriLab Scientific Supplies Ltd',
      amount: 145000,
      paymentMethod: 'Bank Transfer',
      reference: 'EFT-STR-9910',
      expenseDate: '2026-09-18',
      status: 'Paid',
      recordedBy: 'Peter Kamau',
      createdByUserId: 'usr-straph-bursar',
      approvedBy: 'Juma J',
      approvedAt: '2026-09-18T11:00:00Z',
      notes: 'Grade 7-9 laboratory practical apparatus batch.',
      createdAt: '2026-09-18T09:00:00Z',
    },
    {
      id: 'exp-straph-2',
      tenantId,
      voucherNumber: 'STR-EXP-202602',
      title: 'Term 3 School Feeding Program Grain & Produce',
      category: 'Catering & Boarding',
      vendor: 'Rift Valley Cereals & Produce Ltd',
      amount: 420000,
      paymentMethod: 'Bank Transfer',
      reference: 'EFT-STR-9942',
      expenseDate: '2026-10-02',
      status: 'Paid',
      recordedBy: 'Peter Kamau',
      createdByUserId: 'usr-straph-bursar',
      approvedBy: 'Juma J',
      approvedAt: '2026-10-02T14:00:00Z',
      notes: 'Maize, beans, milk and fresh produce supply.',
      createdAt: '2026-10-02T10:00:00Z',
    },
    {
      id: 'exp-straph-3',
      tenantId,
      voucherNumber: 'STR-EXP-202603',
      title: 'Nakuru Campus Electricity & Borehole Power',
      category: 'Utilities & Water',
      vendor: 'Kenya Power & Lighting Co.',
      amount: 96400,
      paymentMethod: 'Mobile Money',
      reference: 'MPESA-KPLC-4481',
      expenseDate: '2026-11-05',
      status: 'Approved',
      recordedBy: 'Peter Kamau',
      createdByUserId: 'usr-straph-bursar',
      approvedBy: 'Juma J',
      approvedAt: '2026-11-05T15:15:00Z',
      notes: 'November campus utility settlement.',
      createdAt: '2026-11-05T11:00:00Z',
    },
  ];

  const etimsChecks: EtimsVerificationRecord[] = [
    {
      id: 'etims-straph-1',
      tenantId,
      expenseId: 'exp-straph-1',
      voucherNumber: 'STR-EXP-202601',
      supplierName: 'AfriLab Scientific Supplies Ltd',
      supplierKraPin: 'P051482910K',
      cuInvoiceNumber: 'KRAMW012026ST0901',
      receiptDate: '2026-09-18',
      taxableAmount: 125000,
      vatAmount: 20000,
      totalAmount: 145000,
      status: 'Checked manually',
      verificationNotes: 'Verified KRA eTIMS CU invoice & supplier PIN.',
      checkedBy: 'Peter Kamau',
      checkedAt: '2026-09-18T12:00:00Z',
    },
  ];

  const reconciliationLines: ReconciliationLine[] = [
    {
      id: 'rec-straph-1',
      tenantId,
      channel: 'M-Pesa',
      accountName: 'Paybill 522588 — St. Raphael Fees',
      transactionDate: '2026-09-12',
      statementRef: 'UJM200000T3',
      narration: 'MPESA FEE COLLECTIONS - TERM 3',
      direction: 'Credit',
      amount: 640000,
      status: 'Matched',
      matchedType: 'Fee Payment',
      matchedLabel: 'Term 3 Tuition Batch Receipt Match',
      importedAt: '2026-09-13T08:00:00Z',
    },
  ];

  const approvalRecords: ApprovalSignOffRecord[] = [
    {
      id: 'apr-straph-1',
      tenantId,
      referenceCode: 'STR-BOM-2026-01',
      committee: 'Board of Management (BOM)',
      subject: 'Term 3 Science Laboratory Apparatus & Feeding Program',
      linkedExpenseId: 'exp-straph-1',
      linkedVoucherNumber: 'STR-EXP-202601',
      amount: 145000,
      meetingDate: '2026-09-15',
      minuteReference: 'MIN/STR/FIN/09/2026',
      chairpersonName: 'Meshack Kipkoech (BOM Finance Chair)',
      secretaryName: 'Juma J (Head of Institution)',
      bursarName: 'Peter Kamau (School Bursar)',
      decision: 'Approved',
      remarks: 'Approved under Term 3 Teaching & Lab Supplies vote.',
      createdByUserId: 'usr-straph-bursar',
      createdAt: '2026-09-15T10:00:00Z',
      signedAt: '2026-09-15T12:30:00Z',
    },
  ];

  const announcements: Announcement[] = [
    {
      id: 'ann-straph-1',
      tenantId,
      title: 'Term 3 Mid-Term Results Published & Academic Clinics',
      body: 'All 48 stream class teachers and Junior School specialists have finalized Term 3 Mid-Term assessments across Playgroup through Grade 9.',
      audience: 'All School',
      priority: 'Normal',
      authorName: 'Juma J',
      authorRole: 'Admin',
      createdAt: '2026-10-21T08:00:00Z',
    },
  ];

  const messages: DirectMessage[] = [
    {
      id: 'msg-straph-1',
      tenantId,
      channel: 'Staff & Faculty',
      senderName: 'John Kiprotich',
      senderRole: 'Teacher',
      body: 'All Junior School Grade 7–9 subject allocations and timetable blocks are verified for Term 3.',
      createdAt: '2026-09-04T09:15:00Z',
    },
  ];

  const notifications: NotificationItem[] = [
    {
      id: 'notif-straph-1',
      tenantId,
      category: 'exam',
      title: 'Term 3 Mid-Term Broadsheets Published',
      description: 'All 2,000 active learners across Playgroup–Grade 9 have published Term 3 assessment records.',
      targetModule: 'exams',
      read: false,
      createdAt: '2026-10-20T15:00:00Z',
    },
  ];

  const mpesaTransactions: MpesaTransactionLog[] = [
    {
      id: 'mpesa-straph-1',
      tenantId,
      paybillNumber: '522588',
      mpesaReceipt: 'UJM200000T3',
      msisdn: '254710100137',
      accountReference: activeStudents[0].studentCode,
      amount: feeAmountByGrade[activeStudents[0].grade].tuition,
      studentId: activeStudents[0].id,
      studentName: activeStudents[0].fullName,
      invoiceNumber: invoices[1]?.invoiceNumber,
      status: 'Settled',
      channel: 'Daraja C2B Webhook',
      note: 'Settled via Paybill 522588',
      receivedAt: '2026-09-12T09:30:00Z',
    },
  ];

  const academicsBuilt = buildDefaultAcademicsForTenant(tenant, {
    maxTeachers: 24,
    timetable,
  });
  tenant.academicSubmissionConfig = academicsBuilt.config;

  return {
    tenant,
    users,
    credentials,
    academicYears,
    academicTerms,
    students,
    timetable,
    attendance,
    leaveOutChits,
    examCycles,
    examResults,
    feeStructures,
    invoices,
    feeWaivers,
    independentVotelines,
    expenses,
    etimsChecks,
    reconciliationLines,
    payrollEntries,
    budgets,
    approvalRecords,
    announcements,
    messages,
    notifications,
    schemesOfWork: academicsBuilt.schemesOfWork,
    lessonPlans: academicsBuilt.lessonPlans,
    mpesaTransactions,
    webhookHash: helpers.hashWebhook(helpers.webhookSecret),
    counters: {
      receipt: rctSeq + 10,
      student: 260000 + stuSeq + 10,
      invoice: invSeq + 10,
      admission: 200,
      voucher: 202620,
    },
  };
}
