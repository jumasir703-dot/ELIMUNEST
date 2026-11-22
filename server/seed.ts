import { createHash, randomBytes } from 'node:crypto';
import {
  buildDefaultLevelSubjectsMap,
  buildDefaultLevelWeeklyLessonsMap,
  computeAssessmentGrade,
  DEFAULT_SUBJECT_WEEKLY_LESSONS,
  EXPENSE_CATEGORIES,
  KENYAN_BELL_SCHEDULE,
  KENYAN_CBC_GRADES,
  KENYAN_CBC_SUBJECTS,
  type AcademicTerm,
  type AcademicYear,
  type AdminAuditEntry,
  type AdmissionApplication,
  type Announcement,
  type ApprovalSignOffRecord,
  type AttendanceRecord,
  type BudgetAllocation,
  type CreditNoteRecord,
  type DayOfWeek,
  type DirectMessage,
  type EtimsVerificationRecord,
  type ExamCycle,
  type ExamResult,
  type FeeInvoice,
  type FeeStructure,
  type FeeVoteline,
  type FeeWaiverRecord,
  type FinanceAuditEntry,
  type IndependentVotelineItem,
  type LeaveOutChit,
  type LifecycleAuditEntry,
  type MpesaTransactionLog,
  type NonTeachingStaffProfile,
  type NotificationItem,
  type PayrollEntry,
  type PayrollStatutoryRateSchedule,
  type ReconciliationLine,
  type SchoolExpense,
  type StaffAttendanceRecord,
  type Student,
  type Tenant,
  type TenantUser,
  type TimetableSlot,
  type WhatsAppDispatchRecord,
} from '../src/shared/types.ts';
import {
  generateOneTimePassword,
  hashPassword,
  resolveDeveloperBootstrapPassword,
  resolveSeedDemoPassword,
} from './middleware/adminAuth.ts';

export function buildDefaultNonTeachingStaff(
  slug: string,
  idPrefix = slug.slice(0, 4),
  targetCount = 6
): NonTeachingStaffProfile[] {
  const base: NonTeachingStaffProfile[] = [
    {
      id: `nts-${idPrefix}-1`,
      name: 'Mary Wanjiru',
      role: 'School Bursar',
      department: 'Finance & Accounts',
      phone: '+254 711 504 210',
      email: `bursar@${slug}.ac.ke`,
    },
    {
      id: `nts-${idPrefix}-2`,
      name: 'Samuel Kiprop',
      role: 'Laboratory Technician',
      department: 'Laboratories',
      phone: '+254 722 814 309',
      email: `lab@${slug}.ac.ke`,
    },
    {
      id: `nts-${idPrefix}-3`,
      name: 'Grace Muthoni',
      role: 'School Matron',
      department: 'Welfare & Health',
      phone: '+254 733 290 411',
      email: `matron@${slug}.ac.ke`,
    },
    {
      id: `nts-${idPrefix}-4`,
      name: 'Peter Otieno',
      role: 'Head of Security',
      department: 'Security & Grounds',
      phone: '+254 714 662 180',
      email: `security@${slug}.ac.ke`,
    },
    {
      id: `nts-${idPrefix}-5`,
      name: 'Beatrice Chepkoech',
      role: 'ICT & Library Assistant',
      department: 'Library & ICT',
      phone: '+254 720 918 542',
      email: `library@${slug}.ac.ke`,
    },
    {
      id: `nts-${idPrefix}-6`,
      name: 'Josephat Mwema',
      role: 'School Caterer',
      department: 'Catering & Kitchen',
      phone: '+254 718 403 775',
      email: `catering@${slug}.ac.ke`,
    },
  ];
  if (targetCount <= base.length) return base;

  const extraNames = [
    'Rosemary Achieng', 'Duncan Kamau', 'Esther Naliaka', 'Martin Karanja',
    'Lilian Cherono', 'Patrick Oduor', 'Agnes Nduta', 'Benson Korir',
    'Mercyline Adhiambo', 'Collins Mutiso', 'Florence Nyambura', 'Kelvin Kipchoge',
    'Sylvia Moraa', 'Dennis Barasa', 'Caroline Wambua', 'erick Kiplagat',
    'Nancy Akinyi', 'Isaac Mwangi', 'Faith Nekesa', 'Victor Omondi',
  ];
  const extraRoles: Array<{ role: string; department: string }> = [
    { role: 'Assistant Bursar', department: 'Finance & Accounts' },
    { role: 'Fee Billing & M-Pesa Clerk', department: 'Finance & Accounts' },
    { role: 'Accounts Payable Clerk', department: 'Finance & Accounts' },
    { role: 'Admissions & Registry Clerk', department: 'Administration' },
    { role: 'Biology & Chemistry Lab Tech', department: 'Laboratories' },
    { role: 'Physics & Maker Lab Tech', department: 'Laboratories' },
    { role: 'Systems & Network Administrator', department: 'Library & ICT' },
    { role: 'Senior Librarian', department: 'Library & ICT' },
    { role: 'School Registered Nurse', department: 'Welfare & Health' },
    { role: 'Assistant Boarding Matron', department: 'Welfare & Health' },
    { role: 'Kitchen & Dining Supervisor', department: 'Catering & Kitchen' },
    { role: 'Assistant School Chef', department: 'Catering & Kitchen' },
    { role: 'Dining Hall Steward', department: 'Catering & Kitchen' },
    { role: 'Day Security Supervisor', department: 'Security & Grounds' },
    { role: 'Night Security Officer', department: 'Security & Grounds' },
    { role: 'Grounds & Maintenance Lead', department: 'Security & Grounds' },
    { role: 'Campus Electrician & Plumber', department: 'Security & Grounds' },
    { role: 'Senior School Bus Driver', department: 'Transport & Fleet' },
    { role: 'Transport & Fleet Coordinator', department: 'Transport & Fleet' },
    { role: 'Campus Stores & Procurement Clerk', department: 'Administration' },
  ];

  const out = [...base];
  for (let i = base.length; i < targetCount; i++) {
    const eIdx = i - base.length;
    const rawName = extraNames[eIdx % extraNames.length];
    const name = rawName.charAt(0).toUpperCase() + rawName.slice(1);
    const meta = extraRoles[eIdx % extraRoles.length];
    out.push({
      id: `nts-${idPrefix}-${i + 1}`,
      name,
      role: meta.role,
      department: meta.department,
      phone: `+254 7${String(20 + (eIdx % 19)).padStart(2, '0')} ${String(310 + eIdx * 17).padStart(3, '0')} ${String(100 + ((eIdx * 43) % 899)).padStart(3, '0')}`,
      email: `staff${i + 1}.${idPrefix}@${slug}.ac.ke`,
    });
  }
  return out;
}

export interface StoredTenantUser extends TenantUser {
  passwordHash: string;
  tokenVersion?: number;
}

export interface DevSeedCredential {
  email: string;
  role: string;
  password: string;
}

export async function buildSeedUsers(): Promise<{
  users: StoredTenantUser[];
  devCredentials: DevSeedCredential[];
}> {
  const now = '2024-08-15T08:00:00Z';
  const specs: Array<
    Omit<
      StoredTenantUser,
      'passwordHash' | 'status' | 'mustChangePassword' | 'tokenVersion' | 'createdAt'
    >
  > = [
    {
      id: 'usr-platform-dev',
      tenantId: 'platform',
      fullName: 'Lead Platform Engineer',
      email: 'developer@elimunest.platform',
      phone: '+254 700 100 001',
      role: 'Developer',
    },
    {
      id: 'usr-platform-super',
      tenantId: 'tenant-oakridge',
      fullName: 'Oakridge Super Admin',
      email: 'super.admin@elimunest.platform',
      phone: '+254 700 100 002',
      role: 'Super Admin',
    },
    {
      id: 'usr-oak-admin',
      tenantId: 'tenant-oakridge',
      fullName: 'Dr. Helena Vance',
      email: 'helena.vance@oakridge.ac.ke',
      phone: '+254 712 408 100',
      role: 'Admin',
    },
    {
      id: 'usr-oak-bursar',
      tenantId: 'tenant-oakridge',
      fullName: 'Mary Wanjiru',
      email: 'mary.wanjiru@oakridge.ac.ke',
      phone: '+254 722 408 101',
      role: 'Bursar',
    },
    {
      id: 'usr-oak-teacher',
      tenantId: 'tenant-oakridge',
      fullName: 'Kamau Njoroge',
      email: 'kamau.njoroge@oakridge.ac.ke',
      phone: '+254 712 408 112',
      role: 'Teacher',
    },
    {
      id: 'usr-oak-registrar',
      tenantId: 'tenant-oakridge',
      fullName: 'Grace Admissions',
      email: 'grace.admissions@oakridge.ac.ke',
      phone: '+254 733 408 103',
      role: 'Registrar',
    },
    {
      id: 'usr-west-admin',
      tenantId: 'tenant-westfield',
      fullName: 'David Chen',
      email: 'david.chen@westfield.ac.ke',
      phone: '+254 711 204 510',
      role: 'Admin',
    },
    {
      id: 'usr-west-bursar',
      tenantId: 'tenant-westfield',
      fullName: 'Elena Morales',
      email: 'elena.morales@westfield.ac.ke',
      phone: '+254 722 308 614',
      role: 'Bursar',
    },
    {
      id: 'usr-west-teacher',
      tenantId: 'tenant-westfield',
      fullName: 'Rachel Foster',
      email: 'rachel.foster@westfield.ac.ke',
      phone: '+254 733 419 725',
      role: 'Teacher',
    },
    {
      id: 'usr-west-registrar',
      tenantId: 'tenant-westfield',
      fullName: 'Mercy Baraka',
      email: 'mercy.baraka@westfield.ac.ke',
      phone: '+254 718 527 840',
      role: 'Registrar',
    },
    {
      id: 'usr-sj-admin',
      tenantId: 'tenant-stjude',
      fullName: 'Arthur Pendelton',
      email: 'arthur.pendelton@stjude.ac.ke',
      phone: '+254 715 630 142',
      role: 'Admin',
    },
    {
      id: 'usr-sj-teacher',
      tenantId: 'tenant-stjude',
      fullName: 'Priya Nair',
      email: 'priya.nair@stjude.ac.ke',
      phone: '+254 726 741 253',
      role: 'Teacher',
    },
    {
      id: 'usr-sj-bursar',
      tenantId: 'tenant-stjude',
      fullName: 'Beatrice Anyango',
      email: 'beatrice.anyango@stjude.ac.ke',
      phone: '+254 720 611 490',
      role: 'Bursar',
    },
    {
      id: 'usr-sj-registrar',
      tenantId: 'tenant-stjude',
      fullName: 'Caleb Omondi',
      email: 'caleb.omondi@stjude.ac.ke',
      phone: '+254 714 823 115',
      role: 'Registrar',
    },
  ];

  const devCredentials: DevSeedCredential[] = [];
  const users: StoredTenantUser[] = [];
  const fixedDemoPassword = resolveSeedDemoPassword();
  for (const spec of specs) {
    const pw =
      spec.role === 'Developer'
        ? resolveDeveloperBootstrapPassword().password
        : fixedDemoPassword ?? generateOneTimePassword();
    const passwordHash = await hashPassword(pw);
    devCredentials.push({ email: spec.email, role: spec.role, password: pw });
    users.push({
      ...spec,
      passwordHash,
      status: 'Active',
      mustChangePassword: true,
      tokenVersion: 0,
      createdAt: now,
    });
  }
  return { users, devCredentials };
}

export interface DatabaseState {
  tenants: Tenant[];
  users: StoredTenantUser[];
  academicYears?: AcademicYear[];
  academicTerms?: AcademicTerm[];
  mpesaWebhookHashes?: Record<string, string>;
  mpesaTransactions?: MpesaTransactionLog[];
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
  creditNotes?: CreditNoteRecord[];
  feeWaivers?: FeeWaiverRecord[];
  independentVotelines?: IndependentVotelineItem[];
  expenses: SchoolExpense[];
  etimsChecks: EtimsVerificationRecord[];
  reconciliationLines: ReconciliationLine[];
  payrollEntries: PayrollEntry[];
  budgets: BudgetAllocation[];
  approvalRecords: ApprovalSignOffRecord[];
  financeAuditLogs?: FinanceAuditEntry[];
  statutoryRateSchedules?: PayrollStatutoryRateSchedule[];
  receiptCounters?: Record<string, number>;
  studentCounters?: Record<string, number>;
  invoiceCounters?: Record<string, number>;
  admissionCounters?: Record<string, number>;
  voucherCounters?: Record<string, number>;
  creditNoteCounters?: Record<string, number>;
  announcements: Announcement[];
  messages: DirectMessage[];
  whatsappDispatches: WhatsAppDispatchRecord[];
  notifications: NotificationItem[];
  adminAuditLogs: AdminAuditEntry[];
  lifecycleAuditLogs?: LifecycleAuditEntry[];
}

export const DEFAULT_STATUTORY_RATE_SCHEDULES: PayrollStatutoryRateSchedule[] = [
  {
    id: 'stat-ke-2026-02',
    effectiveFrom: '2026-02-01',
    label: 'Kenya Statutory Schedule (Feb 2026 NSSF/SHIF/PAYE)',
    currency: 'KES',
    nssfLowerLimit: 9000,
    nssfUpperLimit: 108000,
    nssfRate: 0.06,
    nssfMaxEmployee: 6480,
    shifRate: 0.0275,
    shifMin: 300,
    housingLevyRate: 0.015,
    nitaLevy: 50,
    personalRelief: 2400,
    payeBands: [
      { limit: 24000, rate: 0.1 },
      { limit: 8333, rate: 0.25 },
      { limit: 467667, rate: 0.3 },
      { limit: 300000, rate: 0.325 },
      { limit: null, rate: 0.35 },
    ],
    updatedBy: 'System Default (Kenya Feb 2026)',
    updatedAt: '2026-02-01T00:00:00Z',
  },
  {
    id: 'stat-ke-2024-01',
    effectiveFrom: '2024-01-01',
    label: 'Kenya Historical Statutory Schedule (2024–2025 Tier I/II NSSF)',
    currency: 'KES',
    nssfLowerLimit: 7000,
    nssfUpperLimit: 36000,
    nssfRate: 0.06,
    nssfMaxEmployee: 2160,
    shifRate: 0.0275,
    shifMin: 300,
    housingLevyRate: 0.015,
    nitaLevy: 50,
    personalRelief: 2400,
    payeBands: [
      { limit: 24000, rate: 0.1 },
      { limit: 8333, rate: 0.25 },
      { limit: 467667, rate: 0.3 },
      { limit: 300000, rate: 0.325 },
      { limit: null, rate: 0.35 },
    ],
    updatedBy: 'Historical Statutory Schedule (2024–2025)',
    updatedAt: '2024-01-01T00:00:00Z',
  },
];

export function buildDefaultExpensesForTenant(
  tenantId: string,
  currency: 'KES' | 'USD',
  prefix: string,
  scaleFactor = 1
): SchoolExpense[] {
  const isKes = currency === 'KES';
  const mult = Math.round((isKes ? 120 : 1) * scaleFactor);
  return [
    // Current Year (2026-2027 Term 1)
    {
      id: `exp-${tenantId}-1`,
      tenantId,
      voucherNumber: `${prefix}-EXP-202601`,
      title: 'Science Laboratory Reagents & Apparatus',
      category: 'Teaching & Lab Supplies',
      vendor: 'AfriLab Scientific Supplies Ltd',
      amount: 650 * mult,
      paymentMethod: 'Bank Transfer',
      reference: 'EFT-LAB-8821',
      expenseDate: '2026-11-04',
      status: 'Paid',
      recordedBy: 'Bursar Office',
      createdByUserId: `usr-${tenantId}-bursar`,
      approvedBy: 'School Admin',
      approvedAt: '2026-11-04T09:15:00Z',
      notes: 'Chemistry & Biology Grade 9-12 practical consumables.',
      etimsStatus: 'Checked manually',
      createdAt: '2026-11-04T09:15:00Z',
    },
    {
      id: `exp-${tenantId}-2`,
      tenantId,
      voucherNumber: `${prefix}-EXP-202602`,
      title: 'Term 1 Catering & Kitchen Provisions',
      category: 'Catering & Boarding',
      vendor: 'Highland Fresh Produce Co.',
      amount: 1200 * mult,
      paymentMethod: 'Bank Transfer',
      reference: 'EFT-CAT-4410',
      expenseDate: '2026-11-08',
      status: 'Paid',
      recordedBy: 'Bursar Office',
      createdByUserId: `usr-${tenantId}-bursar`,
      approvedBy: 'School Admin',
      approvedAt: '2026-11-08T11:30:00Z',
      notes: 'Dry grains, dairy, and produce batch delivery.',
      etimsStatus: 'Checked manually',
      createdAt: '2026-11-08T11:30:00Z',
    },
    {
      id: `exp-${tenantId}-3`,
      tenantId,
      voucherNumber: `${prefix}-EXP-202603`,
      title: 'Electricity & Water Utility Settlement',
      category: 'Utilities & Water',
      vendor: 'Kenya Power & Water Services',
      amount: 420 * mult,
      paymentMethod: 'Mobile Money',
      reference: 'MPESA-UTL-9034',
      expenseDate: '2026-11-11',
      status: 'Approved',
      recordedBy: 'Accounts Office',
      createdByUserId: `usr-${tenantId}-bursar`,
      approvedBy: 'School Admin',
      approvedAt: '2026-11-11T14:20:00Z',
      notes: 'Monthly campus electricity and borehole pump billing.',
      createdAt: '2026-11-11T14:20:00Z',
    },
    {
      id: `exp-${tenantId}-4`,
      tenantId,
      voucherNumber: `${prefix}-EXP-202604`,
      title: 'School Bus Diesel & Routine Servicing',
      category: 'Transport & Fuel',
      vendor: 'Metro Fleet Energy Station',
      amount: 310 * mult,
      paymentMethod: 'Card',
      reference: 'FLT-2026-19',
      expenseDate: '2026-11-14',
      status: 'Pending Approval',
      recordedBy: 'Transport Coordinator',
      createdByUserId: `usr-${tenantId}-bursar`,
      notes: 'Scheduled 15,000 km brake & oil service plus diesel refill.',
      etimsStatus: 'Unverified',
      createdAt: '2026-11-14T08:45:00Z',
    },
    {
      id: `exp-${tenantId}-5`,
      tenantId,
      voucherNumber: `${prefix}-EXP-202605`,
      title: 'Campus Fiber Internet & LMS Licensing (Term 1)',
      category: 'ICT & Software',
      vendor: 'Safaricom Business Fiber',
      amount: 380 * mult,
      paymentMethod: 'Bank Transfer',
      reference: 'EFT-ICT-2609',
      expenseDate: '2026-09-18',
      status: 'Paid',
      recordedBy: 'Bursar Office',
      createdByUserId: `usr-${tenantId}-bursar`,
      approvedBy: 'School Admin',
      approvedAt: '2026-09-18T10:00:00Z',
      notes: 'Term 1 dedicated campus bandwidth and computer lab firewall.',
      etimsStatus: 'Checked manually',
      createdAt: '2026-09-18T10:00:00Z',
    },
    {
      id: `exp-${tenantId}-6`,
      tenantId,
      voucherNumber: `${prefix}-EXP-202606`,
      title: 'Tuition Block Roof & Classroom Repainting',
      category: 'Maintenance & Repairs',
      vendor: 'Rift Valley Builders Ltd',
      amount: 540 * mult,
      paymentMethod: 'Bank Transfer',
      reference: 'EFT-MNT-2610',
      expenseDate: '2026-10-05',
      status: 'Paid',
      recordedBy: 'Bursar Office',
      createdByUserId: `usr-${tenantId}-bursar`,
      approvedBy: 'School Admin',
      approvedAt: '2026-10-05T11:15:00Z',
      notes: 'Waterproofing and classroom acoustic repairs.',
      etimsStatus: 'Checked manually',
      createdAt: '2026-10-05T11:15:00Z',
    },
    // Previous Year 1 (2025-2026)
    {
      id: `exp-${tenantId}-2025-1`,
      tenantId,
      voucherNumber: `${prefix}-EXP-202501`,
      title: '2025 Term 1 CBC Textbooks & Revision Workbooks',
      category: 'Teaching & Lab Supplies',
      vendor: 'Longhorn Educational Publishers',
      amount: 820 * mult,
      paymentMethod: 'Bank Transfer',
      reference: 'EFT-BK-2509',
      expenseDate: '2025-09-22',
      status: 'Paid',
      recordedBy: 'Bursar Office',
      createdByUserId: `usr-${tenantId}-bursar`,
      approvedBy: 'School Admin',
      approvedAt: '2025-09-22T10:00:00Z',
      notes: 'Grade 7-12 CBC core learner books and teacher guides.',
      etimsStatus: 'Checked manually',
      createdAt: '2025-09-22T10:00:00Z',
    },
    {
      id: `exp-${tenantId}-2025-2`,
      tenantId,
      voucherNumber: `${prefix}-EXP-202502`,
      title: '2025 Term 1 Boarding & Dining Food Supplies',
      category: 'Catering & Boarding',
      vendor: 'Highland Fresh Produce Co.',
      amount: 1450 * mult,
      paymentMethod: 'Bank Transfer',
      reference: 'EFT-CAT-2511',
      expenseDate: '2025-11-10',
      status: 'Paid',
      recordedBy: 'Bursar Office',
      createdByUserId: `usr-${tenantId}-bursar`,
      approvedBy: 'School Admin',
      approvedAt: '2025-11-10T12:00:00Z',
      notes: 'Full term dry foodstuffs and fresh produce contract.',
      etimsStatus: 'Checked manually',
      createdAt: '2025-11-10T12:00:00Z',
    },
    {
      id: `exp-${tenantId}-2025-3`,
      tenantId,
      voucherNumber: `${prefix}-EXP-202503`,
      title: '2025/26 Term 2 Electricity, Water & Generator Fuel',
      category: 'Utilities & Water',
      vendor: 'Kenya Power & Water Services',
      amount: 510 * mult,
      paymentMethod: 'Mobile Money',
      reference: 'MPESA-UTL-2602',
      expenseDate: '2026-02-14',
      status: 'Paid',
      recordedBy: 'Accounts Office',
      createdByUserId: `usr-${tenantId}-bursar`,
      approvedBy: 'School Admin',
      approvedAt: '2026-02-14T15:00:00Z',
      notes: 'Term 2 campus power and backup generator diesel.',
      etimsStatus: 'Checked manually',
      createdAt: '2026-02-14T15:00:00Z',
    },
    {
      id: `exp-${tenantId}-2025-4`,
      tenantId,
      voucherNumber: `${prefix}-EXP-202504`,
      title: '2025/26 Term 2 School Bus Insurance & PSV Inspection',
      category: 'Transport & Fuel',
      vendor: 'Jubilee General Insurance & Fleet Care',
      amount: 640 * mult,
      paymentMethod: 'Bank Transfer',
      reference: 'EFT-INS-2603',
      expenseDate: '2026-03-09',
      status: 'Paid',
      recordedBy: 'Bursar Office',
      createdByUserId: `usr-${tenantId}-bursar`,
      approvedBy: 'School Admin',
      approvedAt: '2026-03-09T09:30:00Z',
      notes: 'Annual comprehensive bus fleet cover and NTSA inspection.',
      etimsStatus: 'Checked manually',
      createdAt: '2026-03-09T09:30:00Z',
    },
    {
      id: `exp-${tenantId}-2025-5`,
      tenantId,
      voucherNumber: `${prefix}-EXP-202505`,
      title: '2025/26 Term 3 Annual Audit, KRA & Statutory Filing',
      category: 'Administration & Statutory',
      vendor: 'Mwangi & Associates CPA (K)',
      amount: 490 * mult,
      paymentMethod: 'Bank Transfer',
      reference: 'EFT-AUD-2606',
      expenseDate: '2026-06-18',
      status: 'Paid',
      recordedBy: 'Bursar Office',
      createdByUserId: `usr-${tenantId}-bursar`,
      approvedBy: 'School Admin',
      approvedAt: '2026-06-18T14:15:00Z',
      notes: 'FY 2025–2026 statutory financial audit and BOM governance pack.',
      etimsStatus: 'Checked manually',
      createdAt: '2026-06-18T14:15:00Z',
    },
    // Previous Year 2 (2024-2025)
    {
      id: `exp-${tenantId}-2024-1`,
      tenantId,
      voucherNumber: `${prefix}-EXP-202401`,
      title: '2024 Term 1 ICT Lab Workstations & Networking Upgrade',
      category: 'ICT & Software',
      vendor: 'Savanna Tech Systems Ltd',
      amount: 950 * mult,
      paymentMethod: 'Bank Transfer',
      reference: 'EFT-ICT-2409',
      expenseDate: '2024-09-25',
      status: 'Paid',
      recordedBy: 'Bursar Office',
      createdByUserId: `usr-${tenantId}-bursar`,
      approvedBy: 'School Admin',
      approvedAt: '2024-09-25T11:00:00Z',
      notes: '12 desktop terminals and structured LAN cabling for Computer Studies.',
      etimsStatus: 'Checked manually',
      createdAt: '2024-09-25T11:00:00Z',
    },
    {
      id: `exp-${tenantId}-2024-2`,
      tenantId,
      voucherNumber: `${prefix}-EXP-202402`,
      title: '2024 Term 1 Dining & Kitchen Provisions',
      category: 'Catering & Boarding',
      vendor: 'Highland Fresh Produce Co.',
      amount: 1320 * mult,
      paymentMethod: 'Bank Transfer',
      reference: 'EFT-CAT-2411',
      expenseDate: '2024-11-06',
      status: 'Paid',
      recordedBy: 'Bursar Office',
      createdByUserId: `usr-${tenantId}-bursar`,
      approvedBy: 'School Admin',
      approvedAt: '2024-11-06T10:30:00Z',
      notes: 'Term 1 maize, beans, rice, cooking oil, and milk supply.',
      etimsStatus: 'Checked manually',
      createdAt: '2024-11-06T10:30:00Z',
    },
    {
      id: `exp-${tenantId}-2024-3`,
      tenantId,
      voucherNumber: `${prefix}-EXP-202403`,
      title: '2024/25 Term 2 Science Lab Bench & Fume Hood Refit',
      category: 'Maintenance & Repairs',
      vendor: 'Rift Valley Builders Ltd',
      amount: 780 * mult,
      paymentMethod: 'Bank Transfer',
      reference: 'EFT-MNT-2502',
      expenseDate: '2025-02-19',
      status: 'Paid',
      recordedBy: 'Bursar Office',
      createdByUserId: `usr-${tenantId}-bursar`,
      approvedBy: 'School Admin',
      approvedAt: '2025-02-19T13:20:00Z',
      notes: 'CBC Junior & Senior Secondary laboratory plumbing and gas lines.',
      etimsStatus: 'Checked manually',
      createdAt: '2025-02-19T13:20:00Z',
    },
    {
      id: `exp-${tenantId}-2024-4`,
      tenantId,
      voucherNumber: `${prefix}-EXP-202404`,
      title: '2024/25 Term 3 Utilities & Solar Borehole Maintenance',
      category: 'Utilities & Water',
      vendor: 'Kenya Power & Water Services',
      amount: 460 * mult,
      paymentMethod: 'Mobile Money',
      reference: 'MPESA-UTL-2506',
      expenseDate: '2025-06-12',
      status: 'Paid',
      recordedBy: 'Accounts Office',
      createdByUserId: `usr-${tenantId}-bursar`,
      approvedBy: 'School Admin',
      approvedAt: '2025-06-12T09:45:00Z',
      notes: 'Term 3 power bills and solar pump inverter servicing.',
      etimsStatus: 'Checked manually',
      createdAt: '2025-06-12T09:45:00Z',
    },
  ];
}

export function selectActiveStatutorySchedule(
  currency: 'KES' | 'USD',
  schedules: PayrollStatutoryRateSchedule[] = DEFAULT_STATUTORY_RATE_SCHEDULES,
  payPeriod?: string
): PayrollStatutoryRateSchedule | null {
  const effectiveDate =
    payPeriod && /^\d{4}-\d{2}/.test(payPeriod)
      ? `${payPeriod.slice(0, 7)}-01`
      : new Date().toISOString().slice(0, 10);
  const matching = schedules
    .filter((s) => s.currency === currency && s.effectiveFrom <= effectiveDate)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  if (matching.length > 0) return matching[0];
  const fallback = schedules
    .filter((s) => s.currency === currency)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  return fallback[0] || (currency === 'KES' ? DEFAULT_STATUTORY_RATE_SCHEDULES[0] : null);
}

export function computeStatutoryDeductions(
  grossPay: number,
  currency: 'KES' | 'USD',
  schedules: PayrollStatutoryRateSchedule[] = DEFAULT_STATUTORY_RATE_SCHEDULES,
  payPeriod?: string
) {
  const gross = Math.max(0, Math.round(grossPay));
  const schedule = selectActiveStatutorySchedule(currency, schedules, payPeriod);

  if (!schedule && currency === 'USD') {
    const paye = Math.round(gross * 0.14);
    const nssf = Math.round(gross * 0.04);
    const shif = Math.round(gross * 0.025);
    const housingLevy = Math.round(gross * 0.015);
    return {
      paye,
      nssf,
      shif,
      housingLevy,
      employerNssf: nssf,
      employerHousingLevy: housingLevy,
      employerNita: 0,
      scheduleId: 'usd-default',
    };
  }

  const active = schedule || DEFAULT_STATUTORY_RATE_SCHEDULES[0];
  const pensionablePay = Math.min(gross, active.nssfUpperLimit);
  const nssf =
    gross > 0
      ? Math.min(active.nssfMaxEmployee, Math.round(pensionablePay * active.nssfRate))
      : 0;
  const employerNssf = nssf;

  const shif = gross > 0 ? Math.max(active.shifMin, Math.round(gross * active.shifRate)) : 0;
  const housingLevy = Math.round(gross * active.housingLevyRate);
  const employerHousingLevy = housingLevy;
  const employerNita = gross > 0 ? active.nitaLevy : 0;

  const taxable = Math.max(0, gross - nssf - shif - housingLevy);

  let tax = 0;
  let rem = taxable;
  for (const band of active.payeBands) {
    if (rem <= 0) break;
    if (band.limit === null || !Number.isFinite(band.limit)) {
      tax += rem * band.rate;
      rem = 0;
    } else {
      const slice = Math.min(rem, band.limit);
      tax += slice * band.rate;
      rem -= slice;
    }
  }
  const paye = gross > 0 ? Math.max(0, Math.round(tax - active.personalRelief)) : 0;
  return {
    paye,
    nssf,
    shif,
    housingLevy,
    employerNssf,
    employerHousingLevy,
    employerNita,
    scheduleId: active.id,
  };
}

export function buildDefaultEtimsChecksForTenant(
  tenantId: string,
  currency: 'KES' | 'USD',
  prefix: string
): EtimsVerificationRecord[] {
  const isKes = currency === 'KES';
  const mult = isKes ? 120 : 1;
  const buildRow = (
    suffix: string,
    expenseId: string,
    voucherNumber: string,
    supplierName: string,
    supplierKraPin: string,
    cuInvoiceNumber: string,
    receiptDate: string,
    totalAmount: number,
    notes: string
  ): EtimsVerificationRecord => {
    const taxableAmount = Math.round(totalAmount / 1.16);
    return {
      id: `etims-${tenantId}-${suffix}`,
      tenantId,
      expenseId,
      voucherNumber,
      supplierName,
      supplierKraPin,
      cuInvoiceNumber,
      receiptDate,
      taxableAmount,
      vatAmount: totalAmount - taxableAmount,
      totalAmount,
      status: 'Checked manually',
      verificationNotes: notes,
      checkedBy: 'Bursar Office',
      checkedAt: `${receiptDate}T11:30:00Z`,
    };
  };

  return [
    buildRow(
      '1',
      `exp-${tenantId}-1`,
      `${prefix}-EXP-202601`,
      'AfriLab Scientific Supplies Ltd',
      'P051482910K',
      `KRAMW012026${prefix.slice(0, 2)}0184`,
      '2026-11-04',
      650 * mult,
      'CU serial & supplier KRA PIN format checked manually against KRA eTIMS rules.'
    ),
    buildRow(
      '2',
      `exp-${tenantId}-2`,
      `${prefix}-EXP-202602`,
      'Highland Fresh Produce Co.',
      'P051993044M',
      `KRAMW012026${prefix.slice(0, 2)}0299`,
      '2026-11-08',
      1200 * mult,
      'Farm produce tax invoice format & totals checked manually.'
    ),
    buildRow(
      '2025-1',
      `exp-${tenantId}-2025-1`,
      `${prefix}-EXP-202501`,
      'Longhorn Educational Publishers',
      'P051112840Q',
      `KRAMW012025${prefix.slice(0, 2)}0712`,
      '2025-09-22',
      820 * mult,
      '2025 textbook procurement CU invoice verified.'
    ),
    buildRow(
      '2024-1',
      `exp-${tenantId}-2024-1`,
      `${prefix}-EXP-202401`,
      'Savanna Tech Systems Ltd',
      'P051660912B',
      `KRAMW012024${prefix.slice(0, 2)}0405`,
      '2024-09-25',
      950 * mult,
      '2024 ICT hardware purchase CU serial verified.'
    ),
  ];
}

export function buildDefaultReconciliationForTenant(
  tenantId: string,
  currency: 'KES' | 'USD',
  prefix: string
): ReconciliationLine[] {
  const isKes = currency === 'KES';
  const mult = isKes ? 120 : 1;
  return [
    {
      id: `rec-${tenantId}-1`,
      tenantId,
      channel: 'M-Pesa',
      accountName: 'Paybill 522533 — School Fees',
      transactionDate: '2026-11-04',
      statementRef: `UBC48KX${prefix.slice(0, 2)}1`,
      narration: 'MPESA FEE COLLECTION - 2026 TERM 1',
      direction: 'Credit',
      amount: 1850 * mult,
      status: 'Matched',
      matchedType: 'Fee Payment',
      matchedLabel: 'Tuition Fee Receipt Match',
      importedAt: '2026-11-12T08:00:00Z',
    },
    {
      id: `rec-${tenantId}-2`,
      tenantId,
      channel: 'Bank',
      accountName: 'KCB Main Operating A/C',
      transactionDate: '2026-11-04',
      statementRef: 'EFT-LAB-8821',
      narration: 'RTGS TO AFRILAB SCIENTIFIC SUPPLIES',
      direction: 'Debit',
      amount: 650 * mult,
      status: 'Matched',
      matchedType: 'Expense Voucher',
      matchedRecordId: `exp-${tenantId}-1`,
      matchedLabel: `${prefix}-EXP-202601 · AfriLab Scientific Supplies Ltd`,
      importedAt: '2026-11-12T08:00:00Z',
    },
    {
      id: `rec-${tenantId}-3`,
      tenantId,
      channel: 'Bank',
      accountName: 'KCB Main Operating A/C',
      transactionDate: '2026-11-13',
      statementRef: `BNKCHG-${prefix}-11`,
      narration: 'MONTHLY BANK LEDGER & RTGS COMMISSION',
      direction: 'Debit',
      amount: isKes ? 2450 : 25,
      status: 'Unmatched',
      notes: 'Pending expense voucher capture for monthly bank charge.',
      importedAt: '2026-11-14T09:00:00Z',
    },
    {
      id: `rec-${tenantId}-2025-1`,
      tenantId,
      channel: 'Bank',
      accountName: 'KCB Main Operating A/C',
      transactionDate: '2025-09-22',
      statementRef: 'EFT-BK-2509',
      narration: 'RTGS TO LONGHORN EDUCATIONAL PUBLISHERS',
      direction: 'Debit',
      amount: 820 * mult,
      status: 'Matched',
      matchedType: 'Expense Voucher',
      matchedRecordId: `exp-${tenantId}-2025-1`,
      matchedLabel: `${prefix}-EXP-202501 · Longhorn Educational Publishers`,
      importedAt: '2025-09-28T08:00:00Z',
    },
    {
      id: `rec-${tenantId}-2024-1`,
      tenantId,
      channel: 'Bank',
      accountName: 'KCB Main Operating A/C',
      transactionDate: '2024-09-25',
      statementRef: 'EFT-ICT-2409',
      narration: 'RTGS TO SAVANNA TECH SYSTEMS LTD',
      direction: 'Debit',
      amount: 950 * mult,
      status: 'Matched',
      matchedType: 'Expense Voucher',
      matchedRecordId: `exp-${tenantId}-2024-1`,
      matchedLabel: `${prefix}-EXP-202401 · Savanna Tech Systems Ltd`,
      importedAt: '2024-09-30T08:00:00Z',
    },
  ];
}

export function buildDefaultPayrollForTenant(
  tenant: Tenant,
  payPeriod = '2026-11',
  schedules: PayrollStatutoryRateSchedule[] = DEFAULT_STATUTORY_RATE_SCHEDULES
): PayrollEntry[] {
  const isKes = tenant.currency === 'KES';
  const entries: PayrollEntry[] = [];
  const isHistorical = payPeriod < '2026-11';
  const salaryScale = payPeriod.startsWith('2024')
    ? 0.9
    : payPeriod.startsWith('2025')
    ? 0.95
    : 1;

  tenant.teachers.forEach((teacher, idx) => {
    const bandOffset = (idx % 10) * 3500 + Math.floor(idx / 25) * 4000;
    const basicSalary = Math.round((isKes ? 58000 + bandOffset : 1800 + (idx % 10) * 120) * salaryScale);
    const allowances = Math.round((isKes ? 9500 + (idx % 3) * 1500 : 280) * salaryScale);
    const grossPay = basicSalary + allowances;
    const {
      paye,
      nssf,
      shif,
      housingLevy,
      employerNssf,
      employerHousingLevy,
      employerNita,
      scheduleId,
    } = computeStatutoryDeductions(grossPay, tenant.currency, schedules, payPeriod);
    const saccoOrLoan = isKes ? (idx % 3 === 0 ? 3500 : 0) : idx % 3 === 0 ? 80 : 0;
    const totalDeductions = paye + nssf + shif + housingLevy + saccoOrLoan;
    entries.push({
      id: `payr-${tenant.id}-${payPeriod}-t-${idx + 1}`,
      tenantId: tenant.id,
      payPeriod,
      staffId: teacher.id,
      staffName: teacher.name,
      staffCategory: 'Teaching',
      designation: `${teacher.department} Teacher`,
      basicSalary,
      allowances,
      grossPay,
      paye,
      nssf,
      shif,
      housingLevy,
      saccoOrLoan,
      totalDeductions,
      netPay: Math.max(0, grossPay - totalDeductions),
      employerNssf,
      employerHousingLevy,
      employerNita,
      totalEmployerCost: grossPay + employerNssf + employerHousingLevy + employerNita,
      statutoryScheduleId: scheduleId,
      status: isHistorical ? 'Disbursed' : 'Approved',
      createdByUserId: `usr-${tenant.id}-bursar`,
      approvedBy: 'School Admin',
      approvedAt: `${payPeriod}-24T10:00:00Z`,
      updatedAt: `${payPeriod}-25T10:00:00Z`,
    });
  });

  (tenant.nonTeachingStaff || []).forEach((staff, idx) => {
    const bandOffset = (idx % 8) * 3000;
    const basicSalary = Math.round((isKes ? 34000 + bandOffset : 1050 + (idx % 8) * 85) * salaryScale);
    const allowances = Math.round((isKes ? 5000 + (idx % 2) * 1000 : 150) * salaryScale);
    const grossPay = basicSalary + allowances;
    const {
      paye,
      nssf,
      shif,
      housingLevy,
      employerNssf,
      employerHousingLevy,
      employerNita,
      scheduleId,
    } = computeStatutoryDeductions(grossPay, tenant.currency, schedules, payPeriod);
    const saccoOrLoan = isKes && idx === 0 ? 2500 : 0;
    const totalDeductions = paye + nssf + shif + housingLevy + saccoOrLoan;
    entries.push({
      id: `payr-${tenant.id}-${payPeriod}-n-${idx + 1}`,
      tenantId: tenant.id,
      payPeriod,
      staffId: staff.id,
      staffName: staff.name,
      staffCategory: 'Non-Teaching',
      designation: staff.role,
      basicSalary,
      allowances,
      grossPay,
      paye,
      nssf,
      shif,
      housingLevy,
      saccoOrLoan,
      totalDeductions,
      netPay: Math.max(0, grossPay - totalDeductions),
      employerNssf,
      employerHousingLevy,
      employerNita,
      totalEmployerCost: grossPay + employerNssf + employerHousingLevy + employerNita,
      statutoryScheduleId: scheduleId,
      status: isHistorical ? 'Disbursed' : 'Draft',
      createdByUserId: `usr-${tenant.id}-bursar`,
      ...(isHistorical
        ? {
            approvedBy: 'School Admin',
            approvedAt: `${payPeriod}-24T10:00:00Z`,
          }
        : {}),
      updatedAt: `${payPeriod}-25T10:00:00Z`,
    });
  });

  return entries;
}

export function buildDefaultBudgetsForTenant(tenant: Tenant): BudgetAllocation[] {
  const isKes = (tenant.currency || 'KES') === 'KES';
  const totalStaff = (tenant.teachers?.length || 0) + (tenant.nonTeachingStaff?.length || 0);
  const headcountScale = Math.max(1, totalStaff / 10);
  const scale = (isKes ? 1 : 0.008) * headcountScale;
  const baseAmounts: Record<(typeof EXPENSE_CATEGORIES)[number], number> = {
    'Payroll & Allowances': Math.round(780000 * scale * 2.5),
    'Utilities & Water': Math.round(95000 * scale),
    'Catering & Boarding': Math.round(280000 * scale * 1.4),
    'Teaching & Lab Supplies': Math.round(140000 * scale),
    'Maintenance & Repairs': Math.round(110000 * scale),
    'Transport & Fuel': Math.round(90000 * scale),
    'ICT & Software': Math.round(75000 * scale),
    'Administration & Statutory': Math.round(85000 * scale),
  };

  const pendingCategories = new Set<string>(['Transport & Fuel', 'ICT & Software']);
  const approverName = tenant.teachers?.[0]?.name || 'School Principal / BOM';

  const years = [
    {
      fiscalYear: tenant.academicYear || '2026–2027',
      term: tenant.currentTerm || 'Term 1',
      multiplier: 1,
      isCurrent: true,
      updatedAt: '2026-11-01T08:00:00Z',
    },
    {
      fiscalYear: '2025–2026',
      term: 'Annual (Terms 1–3)',
      multiplier: 2.85,
      isCurrent: false,
      updatedAt: '2025-09-01T08:00:00Z',
    },
    {
      fiscalYear: '2024–2025',
      term: 'Annual (Terms 1–3)',
      multiplier: 2.6,
      isCurrent: false,
      updatedAt: '2024-09-01T08:00:00Z',
    },
  ];

  const rows: BudgetAllocation[] = [];
  for (const yr of years) {
    EXPENSE_CATEGORIES.forEach((category, idx) => {
      const isPending = yr.isCurrent && pendingCategories.has(category);
      const idSuffix = yr.isCurrent ? `${idx + 1}` : `${yr.fiscalYear.slice(0, 4)}-${idx + 1}`;
      rows.push({
        id: `bdg-${tenant.id}-${idSuffix}`,
        tenantId: tenant.id,
        fiscalYear: yr.fiscalYear,
        term: yr.term,
        category,
        allocatedAmount: Math.max(100, Math.round(baseAmounts[category] * yr.multiplier)),
        status: isPending ? 'Pending Approval' : 'Approved',
        createdByUserId: `usr-${tenant.id}-bursar`,
        approvedBy: isPending ? undefined : approverName,
        approvedAt: isPending ? undefined : yr.updatedAt,
        approvalNotes: isPending
          ? 'Awaiting specific departmental budget approval.'
          : yr.isCurrent
          ? 'Approved for current term operations.'
          : `Approved by BOM for FY ${yr.fiscalYear}.`,
        notes: `${yr.term} departmental ceiling`,
        updatedAt: yr.updatedAt,
      });
    });
  }
  return rows;
}

export function buildDefaultApprovalsForTenant(
  tenantId: string,
  currency: 'KES' | 'USD',
  prefix: string
): ApprovalSignOffRecord[] {
  const mult = currency === 'KES' ? 120 : 1;
  return [
    {
      id: `apr-${tenantId}-1`,
      tenantId,
      referenceCode: `${prefix}-BOM-2026-01`,
      committee: 'Procurement & Tendering Committee',
      subject: 'Term 1 Science Laboratory Apparatus & Reagents Tender',
      linkedExpenseId: `exp-${tenantId}-1`,
      linkedVoucherNumber: `${prefix}-EXP-202601`,
      amount: 650 * mult,
      meetingDate: '2026-11-02',
      minuteReference: 'MIN/PROC/04/2026',
      chairpersonName: 'Dr. Margaret Kariuki (BOM Chair)',
      secretaryName: 'School Principal',
      bursarName: 'School Bursar',
      decision: 'Approved',
      remarks: 'Awarded to lowest evaluated compliant bidder AfriLab Scientific.',
      createdByUserId: `usr-${tenantId}-bursar`,
      createdAt: '2026-11-02T14:00:00Z',
      signedAt: '2026-11-02T16:15:00Z',
    },
    {
      id: `apr-${tenantId}-2`,
      tenantId,
      referenceCode: `${prefix}-BOM-2026-02`,
      committee: 'Board of Management (BOM)',
      subject: 'School Bus Major Service & Term 1 Fleet Fuel Requisition',
      linkedExpenseId: `exp-${tenantId}-4`,
      linkedVoucherNumber: `${prefix}-EXP-202604`,
      amount: 310 * mult,
      meetingDate: '2026-11-15',
      minuteReference: 'MIN/FIN/11/2026',
      chairpersonName: 'Dr. Margaret Kariuki (BOM Chair)',
      secretaryName: 'School Principal',
      bursarName: 'School Bursar',
      decision: 'Pending Sign-Off',
      remarks: 'Awaiting Finance Sub-Committee counter-signature before disbursement.',
      createdByUserId: `usr-${tenantId}-bursar`,
      createdAt: '2026-11-15T09:00:00Z',
    },
    {
      id: `apr-${tenantId}-2025-1`,
      tenantId,
      referenceCode: `${prefix}-BOM-2025-03`,
      committee: 'Procurement & Tendering Committee',
      subject: 'FY 2025–2026 CBC Textbook & Library Resupply Tender',
      linkedExpenseId: `exp-${tenantId}-2025-1`,
      linkedVoucherNumber: `${prefix}-EXP-202501`,
      amount: 820 * mult,
      meetingDate: '2025-09-15',
      minuteReference: 'MIN/PROC/09/2025',
      chairpersonName: 'Dr. Margaret Kariuki (BOM Chair)',
      secretaryName: 'School Principal',
      bursarName: 'School Bursar',
      decision: 'Approved',
      remarks: 'Approved for Longhorn Educational Publishers delivery.',
      createdByUserId: `usr-${tenantId}-bursar`,
      createdAt: '2025-09-15T10:00:00Z',
      signedAt: '2025-09-15T12:30:00Z',
    },
    {
      id: `apr-${tenantId}-2024-1`,
      tenantId,
      referenceCode: `${prefix}-BOM-2024-02`,
      committee: 'Board of Management (BOM)',
      subject: 'FY 2024–2025 ICT Computer Lab Infrastructure Upgrade',
      linkedExpenseId: `exp-${tenantId}-2024-1`,
      linkedVoucherNumber: `${prefix}-EXP-202401`,
      amount: 950 * mult,
      meetingDate: '2024-09-12',
      minuteReference: 'MIN/BOM/03/2024',
      chairpersonName: 'Dr. Margaret Kariuki (BOM Chair)',
      secretaryName: 'School Principal',
      bursarName: 'School Bursar',
      decision: 'Approved',
      remarks: 'Capital expenditure approved by full BOM plenary.',
      createdByUserId: `usr-${tenantId}-bursar`,
      createdAt: '2024-09-12T10:00:00Z',
      signedAt: '2024-09-12T15:00:00Z',
    },
  ];
}

export function computeLetterGrade(
  score: number,
  grade = ''
): { letterGrade: string; gpaPoints: number } {
  const res = computeAssessmentGrade(score, grade);
  return { letterGrade: res.letterGrade, gpaPoints: res.gpaPoints };
}

export const PERIOD_TIMES: Record<number, { startTime: string; endTime: string }> = Object.fromEntries(
  KENYAN_BELL_SCHEDULE.filter((row) => row.kind === 'lesson' && row.period !== undefined).map(
    (row) => [row.period as number, { startTime: row.startTime, endTime: row.endTime }]
  )
);

function buildSeedGradeStreams(
  overrides: Record<string, string[]> = {}
): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const grade of KENYAN_CBC_GRADES) {
    map[grade] = overrides[grade] ? [...overrides[grade]] : ['A', 'B'];
  }
  return map;
}

export function createEmptyDatabase(): DatabaseState {
  return {
    tenants: [],
    users: [],
    academicYears: [],
    academicTerms: [],
    mpesaWebhookHashes: {},
    mpesaTransactions: [],
    students: [],
    admissions: [],
    timetable: [],
    attendance: [],
    staffAttendance: [],
    leaveOutChits: [],
    examCycles: [],
    examResults: [],
    feeStructures: [],
    invoices: [],
    creditNotes: [],
    feeWaivers: [],
    independentVotelines: [],
    expenses: [],
    etimsChecks: [],
    reconciliationLines: [],
    payrollEntries: [],
    budgets: [],
    approvalRecords: [],
    financeAuditLogs: [],
    statutoryRateSchedules: DEFAULT_STATUTORY_RATE_SCHEDULES.map((s) => ({
      ...s,
      payeBands: s.payeBands.map((b) => ({ ...b })),
    })),
    receiptCounters: {},
    studentCounters: {},
    invoiceCounters: {},
    admissionCounters: {},
    voucherCounters: {},
    creditNoteCounters: {},
    announcements: [],
    messages: [],
    whatsappDispatches: [],
    notifications: [],
    adminAuditLogs: [],
    lifecycleAuditLogs: [],
  };
}

export async function createSeedDatabase(options?: {
  empty?: boolean;
}): Promise<{ state: DatabaseState; devCredentials: DevSeedCredential[] }> {
  if (options?.empty) {
    return { state: createEmptyDatabase(), devCredentials: [] };
  }

  const oakWebhookSecret = randomBytes(24).toString('hex');
  const westWebhookSecret = randomBytes(24).toString('hex');
  const sjWebhookSecret = randomBytes(24).toString('hex');
  const hashWebhook = (s: string) => createHash('sha256').update(s).digest('hex');

  const tenants: Tenant[] = [
    {
      id: 'tenant-oakridge',
      name: 'Oakridge Preparatory Academy',
      slug: 'oakridge-prep',
      emailDomain: 'oakridge.ac.ke',
      curriculum: 'Kenyan CBC (Playgroup – Grade 12)',
      academicYear: '2026–2027',
      currentTerm: 'Term 1',
      currency: 'KES',
      plan: 'Enterprise',
      status: 'Active',
      learnerCap: 2500,
      subscriptionCycle: 'Annual',
      renewalDate: '2027-08-12',
      location: 'Nairobi, KE',
      contactEmail: 'info@oakridge.ac.ke',
      contactPhone: '+254 712 408 100',
      postalAddress: 'P.O. Box 45812-00100, Nairobi',
      branding: {
        primaryColor: '#2563EB',
        accentColor: '#0284C7',
        sidebarColor: '',
        logoDataUrl: '',
        tagline: 'Excellence & Integrity in CBC Learning',
      },
      mpesaConfig: {
        enabled: true,
        environment: 'Sandbox',
        paybillNumber: '522522',
        accountName: 'Oakridge Preparatory Academy Fees',
        accountReferenceFormat: 'Student Code (e.g. ADM-2601)',
        hasWebhookSecret: true,
        callbackUrl: `/api/mpesa/c2b-callback/••••${oakWebhookSecret.slice(-4)}`,
        settlementBank: 'KCB School Collection A/C 1104829104',
        updatedAt: '2026-09-01T08:00:00Z',
        updatedBy: 'Dr. Helena Vance',
      },
      grades: [...KENYAN_CBC_GRADES],
      sections: ['A', 'B', 'C', 'D'],
      gradeStreams: buildSeedGradeStreams({
        Playgroup: ['A', 'B', 'C'],
        PP1: ['A', 'B', 'C'],
        PP2: ['A', 'B', 'C'],
        'Grade 1': ['A', 'B', 'C'],
        'Grade 2': ['A', 'B', 'C'],
        'Grade 3': ['A', 'B', 'C'],
        'Grade 4': ['A', 'B', 'C'],
        'Grade 5': ['A', 'B', 'C'],
        'Grade 6': ['A', 'B', 'C', 'D'],
        'Grade 7': ['A', 'B', 'C', 'D'],
        'Grade 8': ['A', 'B', 'C', 'D'],
        'Grade 9': ['A', 'B', 'C', 'D'],
        'Grade 10': ['A', 'B', 'C', 'D'],
        'Grade 11': ['A', 'B', 'C'],
        'Grade 12': ['A', 'B', 'C'],
      }),
      subjects: [...KENYAN_CBC_SUBJECTS],
      subjectWeeklyLessons: { ...DEFAULT_SUBJECT_WEEKLY_LESSONS },
      levelSubjects: buildDefaultLevelSubjectsMap(),
      levelSubjectWeeklyLessons: buildDefaultLevelWeeklyLessonsMap(),
      rooms: [
        'Room 101', 'Room 102', 'Room 104', 'Room 106', 'Science Lab 1', 'ICT Lab', 'Hall 202', 'Field & Studio',
        ...Array.from({ length: 20 }, (_, i) => `Room ${110 + i}`),
        ...Array.from({ length: 16 }, (_, i) => `Room ${210 + i}`),
        'Science Lab 2', 'Science Lab 3', 'ICT Lab 2', 'Library Commons',
      ],
      teachers: [
        {
          id: 't-oak-1',
          name: 'Mr. Kamau Njoroge',
          email: 'k.njoroge@oakridge.ac.ke',
          phone: '+254 712 408 112',
          department: 'Mathematics & Tech',
          subjects: ['Mathematics', 'Core Mathematics', 'Pre-Technical Studies', 'Physics', 'Business Studies'],
          assignedClasses: [],
        },
        {
          id: 't-oak-2',
          name: 'Mrs. Achieng Odhiambo',
          email: 'a.odhiambo@oakridge.ac.ke',
          phone: '+254 722 619 304',
          department: 'Sciences & Agriculture',
          subjects: ['Integrated Science', 'Science & Technology', 'Agriculture & Nutrition', 'Biology', 'Chemistry'],
          assignedClasses: [],
        },
        {
          id: 't-oak-3',
          name: 'Ms. Chebet Kiprono',
          email: 'c.kiprono@oakridge.ac.ke',
          phone: '+254 733 845 219',
          department: 'Languages & Arts',
          subjects: ['English', 'Creative Arts', 'Creative Arts & Sports', 'Physical Education (PE)'],
          assignedClasses: [],
        },
        {
          id: 't-oak-4',
          name: 'Mr. Mutua Musyoka',
          email: 'm.musyoka@oakridge.ac.ke',
          phone: '+254 714 902 551',
          department: 'Languages & CRE',
          subjects: ['Kiswahili', 'Religious Education (CRE / IRE / HRE)', 'Community Service Learning (CSL)'],
          assignedClasses: [],
        },
        {
          id: 't-oak-5',
          name: 'Mrs. Wambui Mwangi',
          email: 'w.mwangi@oakridge.ac.ke',
          phone: '+254 720 337 489',
          department: 'Humanities & ICT',
          subjects: ['Social Studies', 'Computer Studies', 'History & Citizenship', 'Geography'],
          assignedClasses: [],
        },
        {
          id: 't-oak-6',
          name: 'Mr. Brian Kiptoo',
          email: 'b.kiptoo@oakridge.ac.ke',
          phone: '+254 726 514 820',
          department: 'Mathematics & Sciences',
          subjects: ['Mathematics', 'Integrated Science', 'Physics', 'Computer Studies'],
          assignedClasses: [],
        },
        {
          id: 't-oak-7',
          name: 'Mrs. Zainab Hassan',
          email: 'z.hassan@oakridge.ac.ke',
          phone: '+254 717 943 210',
          department: 'Languages & Humanities',
          subjects: ['English', 'Kiswahili', 'Social Studies', 'Religious Education (CRE / IRE / HRE)'],
          assignedClasses: [],
        },
      ],
      nonTeachingStaff: buildDefaultNonTeachingStaff('oakridge', 'oak', 25),
      createdAt: '2024-08-12T09:00:00Z',
    },
    {
      id: 'tenant-westfield',
      name: 'Westfield STEM High',
      slug: 'westfield-stem',
      emailDomain: 'westfield.ac.ke',
      curriculum: 'Kenyan CBC STEM Track',
      academicYear: '2026–2027',
      currentTerm: 'Term 1',
      currency: 'KES',
      plan: 'Growth',
      status: 'Active',
      learnerCap: 600,
      subscriptionCycle: 'Annual',
      renewalDate: '2027-01-18',
      location: 'Mombasa, KE',
      contactEmail: 'admissions@westfield.ac.ke',
      contactPhone: '+254 711 204 510',
      postalAddress: 'P.O. Box 81204-80100, Mombasa',
      branding: {
        primaryColor: '#059669',
        accentColor: '#0D9488',
        sidebarColor: '#062C22',
        logoDataUrl: '',
        tagline: 'STEM Innovation & Coastal Leadership',
      },
      mpesaConfig: {
        enabled: true,
        environment: 'Sandbox',
        paybillNumber: '522544',
        accountName: 'Westfield STEM High School Fees',
        accountReferenceFormat: 'Student Code (e.g. ADM-2601)',
        hasWebhookSecret: true,
        callbackUrl: `/api/mpesa/c2b-callback/••••${westWebhookSecret.slice(-4)}`,
        settlementBank: 'Equity Bank Mombasa Collection A/C',
        updatedAt: '2026-09-01T08:00:00Z',
        updatedBy: 'David Chen',
      },
      grades: [...KENYAN_CBC_GRADES],
      sections: ['A', 'B'],
      gradeStreams: buildSeedGradeStreams(),
      subjects: [...KENYAN_CBC_SUBJECTS],
      subjectWeeklyLessons: { ...DEFAULT_SUBJECT_WEEKLY_LESSONS },
      levelSubjects: buildDefaultLevelSubjectsMap(),
      levelSubjectWeeklyLessons: buildDefaultLevelWeeklyLessonsMap(),
      rooms: [
        'STEM 101', 'STEM 102', 'Bio Lab 1', 'Chem Lab 2', 'Maker Studio', 'Room 210', 'ICT Studio',
        'STEM 103', 'STEM 104', 'STEM 105', 'STEM 106', 'Physics Lab', 'Room 211', 'Room 212', 'Room 214', 'Robotics Bay',
      ],
      teachers: [
        {
          id: 't-west-1',
          name: 'David Chen',
          email: 'd.chen@westfield.ac.ke',
          phone: '+254 711 204 510',
          department: 'Mathematics',
          subjects: ['Mathematics', 'Core Mathematics', 'Physics'],
          assignedClasses: [],
        },
        {
          id: 't-west-2',
          name: 'Elena Morales',
          email: 'e.morales@westfield.ac.ke',
          phone: '+254 722 308 614',
          department: 'Engineering & Tech',
          subjects: ['Pre-Technical Studies', 'Computer Studies', 'Mathematics'],
          assignedClasses: [],
        },
        {
          id: 't-west-3',
          name: 'Rachel Foster',
          email: 'r.foster@westfield.ac.ke',
          phone: '+254 733 419 725',
          department: 'Sciences',
          subjects: ['Integrated Science', 'Biology', 'Chemistry', 'Agriculture & Nutrition'],
          assignedClasses: [],
        },
        {
          id: 't-west-4',
          name: 'Trevor Brooks',
          email: 't.brooks@westfield.ac.ke',
          phone: '+254 718 527 836',
          department: 'Humanities & English',
          subjects: ['English', 'Social Studies', 'History & Citizenship', 'Geography'],
          assignedClasses: [],
        },
        {
          id: 't-west-5',
          name: 'Salma Abdalla',
          email: 's.abdalla@westfield.ac.ke',
          phone: '+254 724 812 904',
          department: 'Kiswahili & CRE',
          subjects: ['Kiswahili', 'Religious Education (CRE / IRE / HRE)', 'Community Service Learning (CSL)'],
          assignedClasses: [],
        },
        {
          id: 't-west-6',
          name: 'Kelvin Mwamburi',
          email: 'k.mwamburi@westfield.ac.ke',
          phone: '+254 715 449 321',
          department: 'STEM & Sports',
          subjects: ['Integrated Science', 'Creative Arts & Sports', 'Physical Education (PE)'],
          assignedClasses: [],
        },
      ],
      nonTeachingStaff: buildDefaultNonTeachingStaff('westfield', 'west', 10),
      createdAt: '2024-08-18T11:30:00Z',
    },
    {
      id: 'tenant-stjude',
      name: 'St. Jude International School',
      slug: 'st-jude-intl',
      emailDomain: 'stjude.ac.ke',
      curriculum: 'Cambridge & CBC Hybrid',
      academicYear: '2026–2027',
      currentTerm: 'Term 1',
      currency: 'KES',
      plan: 'Enterprise',
      status: 'Active',
      learnerCap: 2500,
      subscriptionCycle: 'Monthly',
      renewalDate: '2026-12-15',
      location: 'Kisumu, KE',
      contactEmail: 'office@stjude.ac.ke',
      contactPhone: '+254 715 630 142',
      postalAddress: 'P.O. Box 1924-40100, Kisumu',
      branding: {
        primaryColor: '#9F1239',
        accentColor: '#D97706',
        sidebarColor: '#2A0B14',
        logoDataUrl: '',
        tagline: 'Global Perspectives, Rooted Values',
      },
      mpesaConfig: {
        enabled: true,
        environment: 'Sandbox',
        paybillNumber: '522566',
        accountName: 'St. Jude International Fees',
        accountReferenceFormat: 'Student Code (e.g. ADM-2601)',
        hasWebhookSecret: true,
        callbackUrl: `/api/mpesa/c2b-callback/••••${sjWebhookSecret.slice(-4)}`,
        settlementBank: 'Stanbic Bank Kisumu KES Fee A/C',
        updatedAt: '2026-09-01T08:00:00Z',
        updatedBy: 'Arthur Pendelton',
      },
      grades: [...KENYAN_CBC_GRADES],
      sections: ['A', 'B', 'C', 'D'],
      gradeStreams: buildSeedGradeStreams({
        Playgroup: ['A', 'B', 'C'],
        PP1: ['A', 'B', 'C'],
        PP2: ['A', 'B', 'C'],
        'Grade 1': ['A', 'B', 'C'],
        'Grade 2': ['A', 'B', 'C'],
        'Grade 3': ['A', 'B', 'C'],
        'Grade 4': ['A', 'B', 'C'],
        'Grade 5': ['A', 'B', 'C'],
        'Grade 6': ['A', 'B', 'C', 'D'],
        'Grade 7': ['A', 'B', 'C', 'D'],
        'Grade 8': ['A', 'B', 'C', 'D'],
        'Grade 9': ['A', 'B', 'C', 'D'],
        'Grade 10': ['A', 'B', 'C', 'D'],
        'Grade 11': ['A', 'B', 'C'],
        'Grade 12': ['A', 'B', 'C'],
      }),
      subjects: [...KENYAN_CBC_SUBJECTS],
      subjectWeeklyLessons: { ...DEFAULT_SUBJECT_WEEKLY_LESSONS },
      levelSubjects: buildDefaultLevelSubjectsMap(),
      levelSubjectWeeklyLessons: buildDefaultLevelWeeklyLessonsMap(),
      rooms: [
        'North Wing 1', 'North Wing 2', 'North Wing 3', 'Science Block 3', 'ICT Wing', 'Lecture Hall',
        ...Array.from({ length: 15 }, (_, i) => `North Wing ${i + 4}`),
        ...Array.from({ length: 14 }, (_, i) => `South Wing ${i + 1}`),
        ...Array.from({ length: 8 }, (_, i) => `East Wing ${i + 1}`),
        'Science Block 1', 'Science Block 2', 'ICT Wing 2', 'Art Studio', 'Sports Pavilion',
      ],
      teachers: [
        {
          id: 't-sj-1',
          name: 'Arthur Pendelton',
          email: 'a.pendelton@stjude.ac.ke',
          phone: '+254 715 630 142',
          department: 'Mathematics',
          subjects: ['Mathematics', 'Core Mathematics', 'Pre-Technical Studies'],
          assignedClasses: [],
        },
        {
          id: 't-sj-2',
          name: 'Priya Nair',
          email: 'p.nair@stjude.ac.ke',
          phone: '+254 726 741 253',
          department: 'Languages & Economics',
          subjects: ['English', 'Business Studies', 'Social Studies', 'History & Citizenship'],
          assignedClasses: [],
        },
        {
          id: 't-sj-3',
          name: 'Oliver Grant',
          email: 'o.grant@stjude.ac.ke',
          phone: '+254 737 852 364',
          department: 'Sciences',
          subjects: ['Integrated Science', 'Physics', 'Chemistry', 'Biology'],
          assignedClasses: [],
        },
        {
          id: 't-sj-4',
          name: 'Millicent Atieno',
          email: 'm.atieno@stjude.ac.ke',
          phone: '+254 722 910 518',
          department: 'Kiswahili & Humanities',
          subjects: ['Kiswahili', 'Religious Education (CRE / IRE / HRE)', 'Geography'],
          assignedClasses: [],
        },
        {
          id: 't-sj-5',
          name: 'Victor Ouma',
          email: 'v.ouma@stjude.ac.ke',
          phone: '+254 713 782 490',
          department: 'ICT & Creative Arts',
          subjects: ['Computer Studies', 'Creative Arts & Sports', 'Agriculture & Nutrition'],
          assignedClasses: [],
        },
      ],
      nonTeachingStaff: buildDefaultNonTeachingStaff('stjude', 'sj', 24),
      createdAt: '2024-08-20T08:15:00Z',
    },
  ];

  // Expand teaching faculty per school to realistic teacher-to-learner ratios (~1:22–1:25)
  const expandTeachersForTenant = (
    tenant: Tenant,
    idPrefix: string,
    targetCount: number
  ) => {
    const firstNames = [
      'Alice', 'Benjamin', 'Catherine', 'Daniel', 'Elizabeth', 'Francis', 'Grace', 'Henry',
      'Irene', 'Joseph', 'Kendra', 'Leonard', 'Miriam', 'Nicholas', 'Olivia', 'Patrick',
      'Queenie', 'Robert', 'Sophia', 'Thomas', 'Ursula', 'Vincent', 'Winnie', 'Xavier',
      'Yvonne', 'Zachary', 'Beatrice', 'Charles', 'Dorothy', 'Emmanuel', 'Florence', 'George',
    ];
    const lastNames = [
      'Kariuki', 'Ochieng', 'Wambui', 'Mutiso', 'Chepkoech', 'Omondi', 'Njoroge', 'Akinyi',
      'Kiprop', 'Muthoni', 'Barasa', 'Cherono', 'Karanja', 'Wekesa', 'Kosgei', 'Nyambura',
      'Mwenda', 'Auma', 'Gacheru', 'Otieno', 'Moraa', 'Kipchoge', 'Chebet', 'Naliaka',
      'Oduor', 'Kamau', 'Ndungu', 'Wafula', 'Rotich', 'Muriithi', 'Korir', 'Abdi',
    ];
    const deptSpecs: Array<{ dept: string; subjects: string[] }> = [
      { dept: 'Mathematics & Tech', subjects: ['Mathematics', 'Core Mathematics', 'Pre-Technical Studies', 'Business Studies'] },
      { dept: 'Sciences & Agriculture', subjects: ['Integrated Science', 'Science & Technology', 'Biology', 'Chemistry', 'Agriculture & Nutrition'] },
      { dept: 'Physics & ICT', subjects: ['Physics', 'Computer Studies', 'Mathematics', 'Science & Technology'] },
      { dept: 'Languages & Literature', subjects: ['English', 'Kiswahili', 'Language Activities'] },
      { dept: 'Humanities & CRE', subjects: ['Social Studies', 'History & Citizenship', 'Geography', 'Religious Education (CRE / IRE / HRE)'] },
      { dept: 'Creative Arts & PE', subjects: ['Creative Arts', 'Creative Arts & Sports', 'Physical Education (PE)', 'Community Service Learning (CSL)'] },
      { dept: 'Early Years & Lower Primary', subjects: ['Language Activities', 'Mathematical Activities', 'Environmental Activities', 'Psychomotor & Creative Activities', 'Religious Education Activities', 'Indigenous Language'] },
    ];
    const existing = tenant.teachers.length;
    for (let i = existing; i < targetCount; i++) {
      const idx = i - existing;
      const fn = firstNames[(idx * 3 + (idPrefix === 'west' ? 5 : idPrefix === 'sj' ? 11 : 0)) % firstNames.length];
      const ln = lastNames[(idx * 5 + Math.floor(idx / firstNames.length) * 7 + (idPrefix === 'sj' ? 3 : 0)) % lastNames.length];
      const titlePrefix = idx % 2 === 0 ? 'Mr.' : 'Ms.';
      const spec = deptSpecs[i % deptSpecs.length];
      tenant.teachers.push({
        id: `t-${idPrefix}-${i + 1}`,
        name: `${titlePrefix} ${fn} ${ln}`,
        email: `faculty.${idPrefix}${i + 1}@${tenant.emailDomain}`,
        phone: `+254 7${String(10 + (i % 29)).padStart(2, '0')} ${String(200 + i * 11).padStart(3, '0')} ${String(100 + ((i * 37) % 899)).padStart(3, '0')}`,
        department: spec.dept,
        subjects: [...spec.subjects],
        assignedClasses: [],
      });
    }
  };
  expandTeachersForTenant(tenants[0], 'oak', 75);
  expandTeachersForTenant(tenants[1], 'west', 20);
  expandTeachersForTenant(tenants[2], 'sj', 72);

  const makeStudent = (
    id: string,
    tenantId: string,
    studentCode: string,
    upi: string,
    fullName: string,
    grade: string,
    section: string,
    guardianName: string,
    guardianEmail: string,
    guardianPhone: string,
    gender: 'Male' | 'Female',
    dateOfBirth: string,
    enrolledAt: string,
    status: Student['status'] = 'Active',
    extra?: Partial<Student>
  ): Student => ({
    id,
    tenantId,
    studentCode,
    upi,
    fullName,
    grade,
    section,
    guardianName,
    guardianEmail,
    guardianPhone,
    gender,
    dateOfBirth,
    enrolledAt,
    status,
    ...extra,
  });

  const students: Student[] = [
    // =========================================================================
    // 1. OAKRIDGE PREPARATORY ACADEMY (28 Learners: 24 Active + 4 Graduated Alumni)
    // =========================================================================
    // Grade 9 A
    makeStudent('stu-oak-1', 'tenant-oakridge', 'ADM-2601', 'KE-8841029A', 'Wanjiku Kamau', 'Grade 9', 'A', 'Grace Kamau', 'grace.kamau@example.co.ke', '+254 712 345 678', 'Female', '2012-03-14', '2024-09-02'),
    makeStudent('stu-oak-2', 'tenant-oakridge', 'ADM-2602', 'KE-8841030B', 'Brian Ochieng', 'Grade 9', 'A', 'Charles Ochieng', 'c.ochieng@example.co.ke', '+254 722 891 045', 'Male', '2012-07-22', '2024-09-02'),
    makeStudent('stu-oak-3', 'tenant-oakridge', 'ADM-2603', 'KE-8841031C', 'Amina Mohamed', 'Grade 9', 'A', 'Hassan Mohamed', 'h.mohamed@example.co.ke', '+254 733 412 908', 'Female', '2012-01-09', '2024-09-03'),
    makeStudent('stu-oak-4', 'tenant-oakridge', 'ADM-2604', 'KE-8841032D', 'Kiprop Chebet', 'Grade 9', 'A', 'Peter Chebet', 'p.chebet@example.co.ke', '+254 714 550 219', 'Male', '2011-11-30', '2025-09-01'),
    // Grade 9 B
    makeStudent('stu-oak-14', 'tenant-oakridge', 'ADM-2607', 'KE-8841041P', 'Neema Wekesa', 'Grade 9', 'B', 'Moses Wekesa', 'm.wekesa@example.co.ke', '+254 721 634 890', 'Female', '2012-04-06', '2024-09-04'),
    makeStudent('stu-oak-15', 'tenant-oakridge', 'ADM-2608', 'KE-8841042Q', 'Trevor Muriithi', 'Grade 9', 'B', 'Jane Muriithi', 'j.muriithi@example.co.ke', '+254 715 782 104', 'Male', '2012-09-18', '2025-09-01'),
    makeStudent('stu-oak-16', 'tenant-oakridge', 'ADM-2609', 'KE-8841043R', 'Halima Abdi', 'Grade 9', 'B', 'Yusuf Abdi', 'y.abdi@example.co.ke', '+254 734 119 672', 'Female', '2012-05-23', '2026-08-25'),
    // Grade 10 A & B
    makeStudent('stu-oak-5', 'tenant-oakridge', 'ADM-2501', 'KE-7732011E', 'Faith Muthoni', 'Grade 10', 'A', 'Margaret Muthoni', 'm.muthoni@example.co.ke', '+254 720 678 134', 'Female', '2011-05-19', '2024-09-01'),
    makeStudent('stu-oak-6', 'tenant-oakridge', 'ADM-2502', 'KE-7732012F', 'Kevin Otieno', 'Grade 10', 'A', 'George Otieno', 'g.otieno@example.co.ke', '+254 718 902 411', 'Male', '2011-02-04', '2024-09-01'),
    makeStudent('stu-oak-7', 'tenant-oakridge', 'ADM-2503', 'KE-7732013G', 'Chepkoech Kosgei', 'Grade 10', 'A', 'Sarah Kosgei', 's.kosgei@example.co.ke', '+254 725 334 890', 'Female', '2011-08-12', '2025-09-02'),
    makeStudent('stu-oak-8', 'tenant-oakridge', 'ADM-2504', 'KE-7732014H', 'David Njoroge', 'Grade 10', 'B', 'Paul Njoroge', 'p.njoroge@example.co.ke', '+254 711 774 502', 'Male', '2011-06-27', '2025-09-02'),
    makeStudent('stu-oak-17', 'tenant-oakridge', 'ADM-2505', 'KE-7732015S', 'Cynthia Moraa', 'Grade 10', 'B', 'Jared Ondiek', 'j.ondiek@example.co.ke', '+254 728 402 719', 'Female', '2011-03-11', '2024-09-03'),
    // Grade 11 A
    makeStudent('stu-oak-9', 'tenant-oakridge', 'ADM-2401', 'KE-6621094J', 'Mercy Akinyi', 'Grade 11', 'A', 'Beatrice Akinyi', 'b.akinyi@example.co.ke', '+254 728 456 912', 'Female', '2010-04-11', '2024-09-01'),
    makeStudent('stu-oak-10', 'tenant-oakridge', 'ADM-2402', 'KE-6621095K', 'Samuel Kipchoge', 'Grade 11', 'A', 'Daniel Kipchoge', 'd.kipchoge@example.co.ke', '+254 716 203 785', 'Male', '2010-09-03', '2024-09-01'),
    makeStudent('stu-oak-18', 'tenant-oakridge', 'ADM-2403', 'KE-6621096T', 'Allan Gacheru', 'Grade 11', 'A', 'Ruth Gacheru', 'r.gacheru@example.co.ke', '+254 712 910 344', 'Male', '2010-07-15', '2024-09-01'),
    // Grade 12 A
    makeStudent('stu-oak-13', 'tenant-oakridge', 'ADM-2301', 'KE-5519022N', 'Imani Nyambura', 'Grade 12', 'A', 'Catherine Nyambura', 'c.nyambura@example.co.ke', '+254 729 551 034', 'Female', '2009-02-28', '2024-01-15'),
    makeStudent('stu-oak-19', 'tenant-oakridge', 'ADM-2302', 'KE-5519023U', 'Collins Karanja', 'Grade 12', 'A', 'Samuel Karanja', 's.karanja@example.co.ke', '+254 719 334 812', 'Male', '2009-06-14', '2024-01-15'),
    // Early Years & Primary & Grade 7-8
    makeStudent('stu-oak-11', 'tenant-oakridge', 'ADM-2605', 'KE-8841039L', 'Zawadi Wambua', 'Playgroup', 'A', 'Joyce Wambua', 'j.wambua@example.co.ke', '+254 724 118 902', 'Female', '2022-04-12', '2026-01-12'),
    makeStudent('stu-oak-12', 'tenant-oakridge', 'ADM-2606', 'KE-8841040M', 'Baraka Mutiso', 'PP1', 'B', 'Stephen Mutiso', 's.mutiso@example.co.ke', '+254 713 908 441', 'Male', '2021-08-19', '2026-01-14'),
    makeStudent('stu-oak-20', 'tenant-oakridge', 'ADM-2506', 'KE-7732016V', 'Linet Cherono', 'Grade 4', 'A', 'Eunice Cherono', 'e.cherono@example.co.ke', '+254 723 804 519', 'Female', '2017-02-20', '2024-09-02'),
    makeStudent('stu-oak-21', 'tenant-oakridge', 'ADM-2507', 'KE-7732017W', 'Ian Mwenda', 'Grade 6', 'A', 'Martin Mwenda', 'm.mwenda@example.co.ke', '+254 714 228 609', 'Male', '2015-05-10', '2024-09-02'),
    makeStudent('stu-oak-22', 'tenant-oakridge', 'ADM-2610', 'KE-8841044X', 'Amani Barasa', 'Grade 7', 'A', 'Violet Barasa', 'v.barasa@example.co.ke', '+254 720 412 885', 'Female', '2014-01-27', '2025-09-02'),
    makeStudent('stu-oak-23', 'tenant-oakridge', 'ADM-2508', 'KE-7732018Y', 'Nathan Kiplagat', 'Grade 8', 'A', 'Joseph Kiplagat', 'j.kiplagat@example.co.ke', '+254 731 609 224', 'Male', '2013-08-03', '2024-09-02'),
    makeStudent('stu-oak-24', 'tenant-oakridge', 'ADM-2509', 'KE-7732019Z', 'Stacy Mutheu', 'Grade 8', 'B', 'Agnes Mutheu', 'a.mutheu@example.co.ke', '+254 711 945 771', 'Female', '2013-11-12', '2025-09-01'),
    // Oakridge Alumni (Graduated 2024 & 2025)
    makeStudent('stu-oak-25', 'tenant-oakridge', 'ADM-2201', 'KE-4410011A', 'Grace Wairimu', 'Grade 12', 'A', 'Esther Wairimu', 'e.wairimu@example.co.ke', '+254 722 104 900', 'Female', '2007-04-02', '2024-01-10', 'Graduated', { statusReason: 'Completed 2024–2025 Senior Cohort', statusDate: '2025-07-25T12:00:00Z' }),
    makeStudent('stu-oak-26', 'tenant-oakridge', 'ADM-2202', 'KE-4410012B', 'Mark Ndungu', 'Grade 12', 'A', 'Peter Ndungu', 'p.ndungu@example.co.ke', '+254 712 840 311', 'Male', '2007-09-19', '2024-01-10', 'Graduated', { statusReason: 'Completed 2024–2025 Senior Cohort', statusDate: '2025-07-25T12:00:00Z' }),
    makeStudent('stu-oak-27', 'tenant-oakridge', 'ADM-2303', 'KE-5519024C', 'Sharon Chepngeno', 'Grade 12', 'A', 'Philip Rotich', 'p.rotich@example.co.ke', '+254 733 509 418', 'Female', '2008-01-25', '2024-09-01', 'Graduated', { statusReason: 'Completed 2025–2026 Senior Cohort', statusDate: '2026-07-24T12:00:00Z' }),
    makeStudent('stu-oak-28', 'tenant-oakridge', 'ADM-2304', 'KE-5519025D', 'Eric Wafula', 'Grade 12', 'A', 'John Wafula', 'j.wafula@example.co.ke', '+254 718 661 203', 'Male', '2008-05-08', '2024-09-01', 'Graduated', { statusReason: 'Completed 2025–2026 Senior Cohort', statusDate: '2026-07-24T12:00:00Z' }),

    // =========================================================================
    // 2. WESTFIELD STEM HIGH (22 Learners: 19 Active + 3 Graduated Alumni)
    // =========================================================================
    // Grade 9 A
    makeStudent('stu-west-1', 'tenant-westfield', 'ADM-2601', 'KE-9910421M', 'Dennis Mwangi', 'Grade 9', 'A', 'James Mwangi', 'j.mwangi@example.co.ke', '+254 721 319 408', 'Male', '2012-02-15', '2024-09-02'),
    makeStudent('stu-west-2', 'tenant-westfield', 'ADM-2602', 'KE-9910422N', 'Esther Wambui', 'Grade 9', 'A', 'Lucy Wambui', 'l.wambui@example.co.ke', '+254 734 610 227', 'Female', '2012-06-08', '2024-09-02'),
    makeStudent('stu-west-4', 'tenant-westfield', 'ADM-2603', 'KE-9910423P', 'Rashid Bakari', 'Grade 9', 'A', 'Omar Bakari', 'o.bakari@example.co.ke', '+254 711 890 342', 'Male', '2012-08-24', '2024-09-03'),
    makeStudent('stu-west-5', 'tenant-westfield', 'ADM-2604', 'KE-9910424Q', 'Rehema Swaleh', 'Grade 9', 'A', 'Fatma Swaleh', 'f.swaleh@example.co.ke', '+254 722 714 559', 'Female', '2012-04-17', '2025-09-01'),
    // Grade 9 B
    makeStudent('stu-west-6', 'tenant-westfield', 'ADM-2605', 'KE-9910425R', 'Kelvin Mcharo', 'Grade 9', 'B', 'Patrick Mcharo', 'p.mcharo@example.co.ke', '+254 714 398 112', 'Male', '2012-10-05', '2025-09-02'),
    makeStudent('stu-west-7', 'tenant-westfield', 'ADM-2606', 'KE-9910426S', 'Brenda Kazungu', 'Grade 9', 'B', 'Joyce Kazungu', 'j.kazungu@example.co.ke', '+254 726 551 983', 'Female', '2012-01-30', '2026-08-25'),
    // Grade 10 A & B
    makeStudent('stu-west-3', 'tenant-westfield', 'ADM-2501', 'KE-9910308P', 'Victor Mutua', 'Grade 10', 'A', 'Joseph Mutua', 'j.mutua@example.co.ke', '+254 719 882 154', 'Male', '2011-03-21', '2024-09-01'),
    makeStudent('stu-west-8', 'tenant-westfield', 'ADM-2502', 'KE-9910309T', 'Aisha Salim', 'Grade 10', 'A', 'Salim Hassan', 's.hassan@example.co.ke', '+254 720 944 610', 'Female', '2011-07-11', '2024-09-01'),
    makeStudent('stu-west-9', 'tenant-westfield', 'ADM-2503', 'KE-9910310U', 'Gideon Charo', 'Grade 10', 'A', 'Harrison Charo', 'h.charo@example.co.ke', '+254 713 622 405', 'Male', '2011-05-03', '2024-09-02'),
    makeStudent('stu-west-10', 'tenant-westfield', 'ADM-2504', 'KE-9910311V', 'Nadia Kombo', 'Grade 10', 'B', 'Amina Kombo', 'a.kombo@example.co.ke', '+254 735 208 774', 'Female', '2011-09-14', '2025-09-01'),
    makeStudent('stu-west-11', 'tenant-westfield', 'ADM-2505', 'KE-9910312W', 'Felix Mwazighe', 'Grade 10', 'B', 'Edward Mwazighe', 'e.mwazighe@example.co.ke', '+254 717 831 209', 'Male', '2011-12-01', '2025-09-03'),
    // Grade 11 & 12
    makeStudent('stu-west-12', 'tenant-westfield', 'ADM-2401', 'KE-9910201X', 'Diana Katana', 'Grade 11', 'A', 'Beatrice Katana', 'b.katana@example.co.ke', '+254 725 490 813', 'Female', '2010-02-27', '2024-09-01'),
    makeStudent('stu-west-13', 'tenant-westfield', 'ADM-2402', 'KE-9910202Y', 'Caleb Tuva', 'Grade 11', 'A', 'Samuel Tuva', 's.tuva@example.co.ke', '+254 716 309 542', 'Male', '2010-06-19', '2024-09-01'),
    makeStudent('stu-west-14', 'tenant-westfield', 'ADM-2403', 'KE-9910203Z', 'Zahara Omar', 'Grade 11', 'A', 'Ali Omar', 'a.omar@example.co.ke', '+254 729 773 108', 'Female', '2010-10-22', '2024-09-01'),
    makeStudent('stu-west-15', 'tenant-westfield', 'ADM-2301', 'KE-9910101A', 'Hamisi Karisa', 'Grade 12', 'A', 'Benson Karisa', 'b.karisa@example.co.ke', '+254 710 554 902', 'Male', '2009-03-08', '2024-08-28'),
    makeStudent('stu-west-16', 'tenant-westfield', 'ADM-2302', 'KE-9910102B', 'Mariam Juma', 'Grade 12', 'A', 'Halima Juma', 'h.juma@example.co.ke', '+254 723 818 446', 'Female', '2009-08-15', '2024-08-28'),
    // Grade 7 & 8
    makeStudent('stu-west-17', 'tenant-westfield', 'ADM-2607', 'KE-9910427C', 'Titus Fondo', 'Grade 7', 'A', 'Grace Fondo', 'g.fondo@example.co.ke', '+254 731 440 218', 'Male', '2014-04-10', '2025-09-01'),
    makeStudent('stu-west-18', 'tenant-westfield', 'ADM-2506', 'KE-9910313D', 'Sonia Chengo', 'Grade 8', 'A', 'Mary Chengo', 'm.chengo@example.co.ke', '+254 712 607 395', 'Female', '2013-07-04', '2024-09-02'),
    makeStudent('stu-west-19', 'tenant-westfield', 'ADM-2507', 'KE-9910314E', 'Brian Kenga', 'Grade 8', 'B', 'Thomas Kenga', 't.kenga@example.co.ke', '+254 728 912 640', 'Male', '2013-11-28', '2025-09-02'),
    // Westfield Alumni
    makeStudent('stu-west-20', 'tenant-westfield', 'ADM-2201', 'KE-9910001F', 'Farida Said', 'Grade 12', 'A', 'Said Mbarak', 's.mbarak@example.co.ke', '+254 720 112 908', 'Female', '2007-05-12', '2024-08-20', 'Graduated', { statusReason: 'Completed 2024–2025 Senior STEM Cohort', statusDate: '2025-07-24T12:00:00Z' }),
    makeStudent('stu-west-21', 'tenant-westfield', 'ADM-2303', 'KE-9910103G', 'Arnold Mwakio', 'Grade 12', 'A', 'Doris Mwakio', 'd.mwakio@example.co.ke', '+254 711 402 889', 'Male', '2008-02-19', '2024-08-20', 'Graduated', { statusReason: 'Completed 2025–2026 Senior STEM Cohort', statusDate: '2026-07-24T12:00:00Z' }),
    makeStudent('stu-west-22', 'tenant-westfield', 'ADM-2304', 'KE-9910104H', 'Beatrice Kadzo', 'Grade 12', 'A', 'Khamisi Kadzo', 'k.kadzo@example.co.ke', '+254 733 789 014', 'Female', '2008-09-07', '2024-08-20', 'Graduated', { statusReason: 'Completed 2025–2026 Senior STEM Cohort', statusDate: '2026-07-24T12:00:00Z' }),

    // =========================================================================
    // 3. ST. JUDE INTERNATIONAL SCHOOL (20 Learners: 17 Active + 3 Graduated Alumni)
    // =========================================================================
    // Grade 9 A & B
    makeStudent('stu-sj-1', 'tenant-stjude', 'ADM-2601', 'KE-5501920R', 'Sharon Njeri', 'Grade 9', 'A', 'Rose Njeri', 'r.njeri@example.co.ke', '+254 723 445 810', 'Female', '2012-05-11', '2024-09-02'),
    makeStudent('stu-sj-3', 'tenant-stjude', 'ADM-2603', 'KE-5501922T', 'Maxwell Omondi', 'Grade 9', 'A', 'Walter Omondi', 'w.omondi@example.co.ke', '+254 714 220 918', 'Male', '2012-01-19', '2024-09-02'),
    makeStudent('stu-sj-4', 'tenant-stjude', 'ADM-2604', 'KE-5501923U', 'Valerie Adhiambo', 'Grade 9', 'A', 'Pamela Adhiambo', 'p.adhiambo@example.co.ke', '+254 727 608 441', 'Female', '2012-09-28', '2025-09-01'),
    makeStudent('stu-sj-5', 'tenant-stjude', 'ADM-2605', 'KE-5501924V', 'Eugene Onyango', 'Grade 9', 'B', 'Maurice Onyango', 'm.onyango@example.co.ke', '+254 712 883 502', 'Male', '2012-03-04', '2025-09-03'),
    makeStudent('stu-sj-6', 'tenant-stjude', 'ADM-2606', 'KE-5501925W', 'Clarice Auma', 'Grade 9', 'B', 'Lilian Auma', 'l.auma@example.co.ke', '+254 734 190 726', 'Female', '2012-11-15', '2026-08-26'),
    // Grade 10 A & B
    makeStudent('stu-sj-2', 'tenant-stjude', 'ADM-2602', 'KE-5501921S', 'Collins Barasa', 'Grade 10', 'A', 'Patrick Barasa', 'p.barasa@example.co.ke', '+254 710 924 361', 'Male', '2011-10-04', '2024-09-04'),
    makeStudent('stu-sj-7', 'tenant-stjude', 'ADM-2501', 'KE-5501820X', 'Daphne Awuor', 'Grade 10', 'A', 'Susan Awuor', 's.awuor@example.co.ke', '+254 721 503 884', 'Female', '2011-04-22', '2024-09-02'),
    makeStudent('stu-sj-8', 'tenant-stjude', 'ADM-2502', 'KE-5501821Y', 'Ryan Oduor', 'Grade 10', 'A', 'Kennedy Oduor', 'k.oduor@example.co.ke', '+254 718 772 309', 'Male', '2011-07-09', '2024-09-02'),
    makeStudent('stu-sj-9', 'tenant-stjude', 'ADM-2503', 'KE-5501822Z', 'Tessa Nasimiyu', 'Grade 10', 'B', 'Florence Nasimiyu', 'f.nasimiyu@example.co.ke', '+254 729 314 662', 'Female', '2011-02-13', '2025-09-02'),
    // Grade 11 & 12
    makeStudent('stu-sj-10', 'tenant-stjude', 'ADM-2401', 'KE-5501720A', 'Joshua Okoth', 'Grade 11', 'A', 'Charles Okoth', 'c.okoth@example.co.ke', '+254 725 894 110', 'Male', '2010-05-16', '2024-09-02'),
    makeStudent('stu-sj-11', 'tenant-stjude', 'ADM-2402', 'KE-5501721B', 'Abigail Akoth', 'Grade 11', 'A', 'Christine Akoth', 'c.akoth@example.co.ke', '+254 716 441 903', 'Female', '2010-08-29', '2024-09-02'),
    makeStudent('stu-sj-12', 'tenant-stjude', 'ADM-2301', 'KE-5501620C', 'Nathaniel Otieno', 'Grade 12', 'A', 'George Otieno', 'g.otieno.sj@example.co.ke', '+254 722 618 774', 'Male', '2009-01-21', '2024-08-25'),
    makeStudent('stu-sj-13', 'tenant-stjude', 'ADM-2302', 'KE-5501621D', 'Serena Nyaboke', 'Grade 12', 'A', 'Damaris Nyaboke', 'd.nyaboke@example.co.ke', '+254 733 905 217', 'Female', '2009-04-07', '2024-08-25'),
    // Primary & Grade 7-8
    makeStudent('stu-sj-14', 'tenant-stjude', 'ADM-2607', 'KE-5501926E', 'Liam Odongo', 'PP1', 'A', 'Mercy Odongo', 'm.odongo@example.co.ke', '+254 719 204 511', 'Male', '2021-06-14', '2026-01-12'),
    makeStudent('stu-sj-15', 'tenant-stjude', 'ADM-2504', 'KE-5501823F', 'Chloe Nekesa', 'Grade 4', 'A', 'David Nekesa', 'd.nekesa@example.co.ke', '+254 724 778 302', 'Female', '2017-03-19', '2024-09-02'),
    makeStudent('stu-sj-16', 'tenant-stjude', 'ADM-2608', 'KE-5501927G', 'Ethan Kipkemoi', 'Grade 7', 'A', 'Paul Kipkemoi', 'p.kipkemoi@example.co.ke', '+254 715 330 894', 'Male', '2014-09-02', '2025-09-02'),
    makeStudent('stu-sj-17', 'tenant-stjude', 'ADM-2505', 'KE-5501824H', 'Natalie Chebet', 'Grade 8', 'A', 'Joyce Chebet', 'j.chebet@example.co.ke', '+254 720 662 419', 'Female', '2013-06-25', '2024-09-02'),
    // St. Jude Alumni
    makeStudent('stu-sj-18', 'tenant-stjude', 'ADM-2201', 'KE-5501520J', 'Brenda Aloo', 'Grade 12', 'A', 'Mary Aloo', 'm.aloo@example.co.ke', '+254 711 903 442', 'Female', '2007-07-18', '2024-08-20', 'Graduated', { statusReason: 'Completed 2024–2025 Hybrid Senior Cohort', statusDate: '2025-07-24T12:00:00Z' }),
    makeStudent('stu-sj-19', 'tenant-stjude', 'ADM-2303', 'KE-5501622K', 'Kevin Odhiambo', 'Grade 12', 'A', 'Simon Odhiambo', 's.odhiambo@example.co.ke', '+254 726 410 885', 'Male', '2008-03-10', '2024-08-20', 'Graduated', { statusReason: 'Completed 2025–2026 Hybrid Senior Cohort', statusDate: '2026-07-24T12:00:00Z' }),
    makeStudent('stu-sj-20', 'tenant-stjude', 'ADM-2304', 'KE-5501623L', 'Faith Moraa', 'Grade 12', 'A', 'Zipporah Moraa', 'z.moraa@example.co.ke', '+254 737 512 904', 'Female', '2008-11-02', '2024-08-20', 'Graduated', { statusReason: 'Completed 2025–2026 Hybrid Senior Cohort', statusDate: '2026-07-24T12:00:00Z' }),
  ];
  // Expand student rosters to 70-80% of each school's learnerCap + 2024/2025 graduated alumni
  const firstMale = [
    'Aaron', 'Allan', 'Amos', 'Andrew', 'Anthony', 'Austin', 'Baraka', 'Benjamin', 'Bernard', 'Bramwell',
    'Calvin', 'Cedric', 'Chris', 'Cyrus', 'Daniel', 'Darius', 'Dennis', 'Derrick', 'Duncan', 'Edwin',
    'Elijah', 'Elisha', 'Emanuel', 'Enock', 'Evans', 'Felix', 'Fidel', 'Francis', 'Gabriel', 'Geoffrey',
    'Gideon', 'Gilbert', 'Godfrey', 'Harrison', 'Hillary', 'Humphrey', 'Ian', 'Ibrahim', 'Isaac', 'Isaiah',
    'Jackson', 'Jacob', 'Jaden', 'James', 'Japheth', 'Jared', 'Jason', 'Jeremy', 'Joel', 'John',
    'Jonathan', 'Jordan', 'Joseph', 'Joshua', 'Josiah', 'Julius', 'Justin', 'Keith', 'Kelvin', 'Kenneth',
    'Kibet', 'Kipchumba', 'Kiplimo', 'Kiptanui', 'Lawrence', 'Leonard', 'Lewis', 'Liam', 'Lukas', 'Mark',
    'Martin', 'Mathew', 'Maurice', 'Meshack', 'Michael', 'Mike', 'Moses', 'Mwaniki', 'Nathan', 'Nelson',
    'Newton', 'Nicholas', 'Noah', 'Norman', 'Oscar', 'Owen', 'Patrick', 'Paul', 'Peter', 'Philip',
    'Raphael', 'Raymond', 'Reuben', 'Richard', 'Robert', 'Ronald', 'Roy', 'Samuel', 'Simon', 'Solomon',
    'Stanley', 'Stephen', 'Sylvester', 'Teddy', 'Terence', 'Thomas', 'Timothy', 'Titus', 'Tobias', 'Tony',
    'Victor', 'Vincent', 'Walter', 'Wesley', 'Wilfred', 'William', 'Wilson', 'Yusuf', 'Zachary', 'Zephaniah',
  ];
  const firstFemale = [
    'Abigail', 'Agatha', 'Agnes', 'Alice', 'Amani', 'Amber', 'Amina', 'Angela', 'Anita', 'Annabel',
    'Ashley', 'Audrey', 'Beatrice', 'Belinda', 'Bernice', 'Beryl', 'Beth', 'Beverly', 'Brenda', 'Bridget',
    'Carol', 'Caroline', 'Catherine', 'Cecilia', 'Charity', 'Chelimo', 'Cherop', 'Chloe', 'Christine', 'Claire',
    'Clarice', 'Cynthia', 'Damaris', 'Daphne', 'Deborah', 'Diana', 'Doreen', 'Dorcas', 'Edith', 'Eileen',
    'Elaine', 'Eleanor', 'Elizabeth', 'Elsie', 'Emily', 'Emma', 'Esther', 'Eunice', 'Eva', 'Evelyn',
    'Faith', 'Farida', 'Fatuma', 'Fiona', 'Flora', 'Florence', 'Fridah', 'Georgina', 'Gladys', 'Gloria',
    'Grace', 'Halima', 'Hannah', 'Harriet', 'Hellen', 'Hilda', 'Hope', 'Imani', 'Irene', 'Isabel',
    'Ivy', 'Jacinta', 'Jane', 'Janet', 'Janice', 'Jasmine', 'Jemimah', 'Jennifer', 'Jessica', 'Joan',
    'Jocelyn', 'Josephine', 'Joy', 'Joyce', 'Judith', 'Julia', 'Juliet', 'June', 'Karen', 'Kate',
    'Lilian', 'Linet', 'Lorna', 'Lucy', 'Lydia', 'Magdalene', 'Margaret', 'Maria', 'Mariam', 'Martha',
    'Mary', 'Maureen', 'Melanie', 'Melissa', 'Mercy', 'Mildred', 'Miriam', 'Monica', 'Moraa', 'Nadia',
    'Naliaka', 'Nancy', 'Naomi', 'Natalie', 'Neema', 'Nelly', 'Nicole', 'Nora', 'Patience', 'Patricia',
    'Pauline', 'Peace', 'Peninah', 'Phoebe', 'Priscilla', 'Purity', 'Rachel', 'Rebecca', 'Regina', 'Rehema',
    'Rhoda', 'Rita', 'Rose', 'Rosemary', 'Ruth', 'Salma', 'Sandra', 'Sarah', 'Selina', 'Serena',
    'Sharon', 'Sheila', 'Shirley', 'Sonia', 'Sophia', 'Stacy', 'Stella', 'Stephanie', 'Susan', 'Sylvia',
    'Tabitha', 'Teresia', 'Tracy', 'Valerie', 'Vanessa', 'Veronica', 'Victoria', 'Violet', 'Vivian', 'Wendy',
    'Winnie', 'Yvonne', 'Zahara', 'Zawadi', 'Zipporah',
  ];
  const lastSurnames = [
    'Kamau', 'Ochieng', 'Mohamed', 'Chebet', 'Wekesa', 'Muriithi', 'Abdi', 'Muthoni', 'Otieno', 'Kosgei',
    'Njoroge', 'Ondiek', 'Akinyi', 'Kipchoge', 'Gacheru', 'Nyambura', 'Karanja', 'Wambua', 'Mutiso', 'Cherono',
    'Mwenda', 'Barasa', 'Kiplagat', 'Mutheu', 'Wairimu', 'Ndungu', 'Chepngeno', 'Wafula', 'Mwangi', 'Wambui',
    'Bakari', 'Swaleh', 'Mcharo', 'Kazungu', 'Mutua', 'Salim', 'Charo', 'Kombo', 'Mwazighe', 'Katana',
    'Tuva', 'Omar', 'Karisa', 'Juma', 'Fondo', 'Chengo', 'Kenga', 'Said', 'Mwakio', 'Kadzo',
    'Njeri', 'Omondi', 'Adhiambo', 'Onyango', 'Auma', 'Awuor', 'Oduor', 'Nasimiyu', 'Okoth', 'Akoth',
    'Nyaboke', 'Odongo', 'Nekesa', 'Kipkemoi', 'Aloo', 'Odhiambo', 'Moraa', 'Kariuki', 'Wanjala', 'Kipruto',
    'Rotich', 'Ruto', 'Kilonzo', 'Musyoka', 'Ndwiga', 'Gitonga', 'Maina', 'Macharia', 'Kimani', 'Kinyua',
    'Munene', 'Murithi', 'Ngugi', 'Ndegwa', 'Kirui', 'Langat', 'Bett', 'Too', 'Rop', 'Sang',
    'Tanui', 'Kurgat', 'Lagat', 'Korir', 'Chelimo', 'Sitienei', 'Wanjiku', 'Wangari', 'Waithera', 'Gathoni',
    'Nyokabi', 'Njoki', 'Mugure', 'Mumbi', 'Kabiru', 'Kibaki', 'Mworia', 'Kirimi', 'Mbae', 'Kithinji',
  ];

  const expandCohortForTenant = (
    tenant: Tenant,
    prefixKey: string,
    targetActiveCount: number,
    targetAlumniCount: number
  ) => {
    const curTenantStudents = students.filter((s) => s.tenantId === tenant.id);
    const curActive = curTenantStudents.filter((s) => s.status === 'Active' || s.status === 'On Leave').length;
    const curAlumni = curTenantStudents.filter((s) => s.status === 'Graduated').length;

    let seq = 1;
    const tenantIdx = tenant.id === 'tenant-oakridge' ? 1 : tenant.id === 'tenant-westfield' ? 2 : 3;
    const admBase = tenantIdx * 3000;
    const upiBase = tenantIdx * 200000;

    // 1. Add Active learners evenly across all configured gradeStreams
    const streamSlots: Array<{ grade: string; section: string }> = [];
    for (const grade of KENYAN_CBC_GRADES) {
      const streams = tenant.gradeStreams?.[grade] || ['A', 'B'];
      for (const sec of streams) {
        streamSlots.push({ grade, section: sec });
      }
    }

    const neededActive = Math.max(0, targetActiveCount - curActive);
    for (let i = 0; i < neededActive; i++) {
      const slot = streamSlots[i % streamSlots.length];
      const gradeIdx = KENYAN_CBC_GRADES.indexOf(slot.grade as (typeof KENYAN_CBC_GRADES)[number]);
      const isFemale = (seq + tenantIdx) % 2 === 0;
      const fnPool = isFemale ? firstFemale : firstMale;
      const rawFn = fnPool[(seq * 7 + tenantIdx * 13) % fnPool.length];
      const fn = rawFn.charAt(0).toUpperCase() + rawFn.slice(1);
      const mnPool = isFemale ? firstFemale : firstMale;
      const mn = mnPool[(seq * 11 + 5) % mnPool.length];
      const ln = lastSurnames[(seq * 13 + tenantIdx * 17 + Math.floor(seq / fnPool.length) * 3) % lastSurnames.length];
      const fullName = `${fn} ${mn.charAt(0).toUpperCase()}. ${ln}`;

      const birthYear = Math.max(2008, Math.min(2022, 2022 - gradeIdx));
      const dob = `${birthYear}-${String(1 + (seq % 12)).padStart(2, '0')}-${String(1 + ((seq * 3) % 27)).padStart(2, '0')}`;
      const enrollRoll = seq % 10;
      const enrolledAt =
        gradeIdx >= 2 && enrollRoll < 5
          ? `2024-09-${String(1 + (seq % 5)).padStart(2, '0')}`
          : gradeIdx >= 1 && enrollRoll < 8
          ? `2025-09-${String(1 + (seq % 5)).padStart(2, '0')}`
          : `2026-08-${String(24 + (seq % 6)).padStart(2, '0')}`;

      const guardianFirst = firstMale[(seq * 5 + 3) % firstMale.length];
      const codeNum = admBase + seq;
      const phoneMid = String(100 + ((seq * 17) % 899)).padStart(3, '0');
      const phoneEnd = String(100 + ((seq * 29 + tenantIdx * 41) % 899)).padStart(3, '0');
      const phoneOp = String(40 + ((seq + tenantIdx * 11) % 58)).padStart(2, '0');

      students.push(
        makeStudent(
          `stu-${prefixKey}-gen-${seq}`,
          tenant.id,
          `ADM-${codeNum}`,
          `KE-${7000000 + upiBase + seq}${String.fromCharCode(65 + (seq % 26))}`,
          fullName,
          slot.grade,
          slot.section,
          `${guardianFirst} ${ln}`,
          `guardian.${prefixKey}.${codeNum}@example.co.ke`,
          `+254 7${phoneOp} ${phoneMid} ${phoneEnd}`,
          isFemale ? 'Female' : 'Male',
          dob,
          enrolledAt
        )
      );
      seq += 1;
    }

    // 2. Add 2024-2025 & 2025-2026 Graduated alumni
    const neededAlumni = Math.max(0, targetAlumniCount - curAlumni);
    for (let a = 0; a < neededAlumni; a++) {
      const is2025Grad = a < Math.floor(neededAlumni / 2);
      const isFemale = (seq + a) % 2 === 1;
      const fnPool = isFemale ? firstFemale : firstMale;
      const rawFn = fnPool[(seq * 9 + a * 3) % fnPool.length];
      const fn = rawFn.charAt(0).toUpperCase() + rawFn.slice(1);
      const ln = lastSurnames[(seq * 7 + a * 11 + tenantIdx * 5) % lastSurnames.length];
      const fullName = `${fn} ${ln} (Alumni)`;
      const codeNum = admBase + seq;
      const sec = (tenant.gradeStreams?.['Grade 12'] || ['A'])[a % (tenant.gradeStreams?.['Grade 12']?.length || 1)];
      const phoneMid = String(100 + ((seq * 19) % 899)).padStart(3, '0');
      const phoneEnd = String(100 + ((seq * 31) % 899)).padStart(3, '0');
      const phoneOp = String(40 + ((seq + 13) % 58)).padStart(2, '0');

      students.push(
        makeStudent(
          `stu-${prefixKey}-alum-${a + 1}`,
          tenant.id,
          `ADM-${codeNum}`,
          `KE-${6000000 + upiBase + seq}${String.fromCharCode(65 + (seq % 26))}`,
          fullName,
          'Grade 12',
          sec,
          `Parent of ${fn} ${ln}`,
          `alumni.${prefixKey}.${codeNum}@example.co.ke`,
          `+254 7${phoneOp} ${phoneMid} ${phoneEnd}`,
          isFemale ? 'Female' : 'Male',
          `${is2025Grad ? '2007' : '2008'}-${String(1 + (a % 12)).padStart(2, '0')}-${String(1 + ((a * 3) % 27)).padStart(2, '0')}`,
          '2024-01-12',
          'Graduated',
          {
            statusReason: is2025Grad
              ? 'Completed 2024–2025 Senior Cohort'
              : 'Completed 2025–2026 Senior Cohort',
            statusDate: is2025Grad ? '2025-07-25T12:00:00Z' : '2026-07-24T12:00:00Z',
          }
        )
      );
      seq += 1;
    }
  };

  // Oakridge: 1,860 active / 2,500 cap (74.4%) + 140 alumni = 2,000 total
  expandCohortForTenant(tenants[0], 'oak', 1860, 140);
  // Westfield: 450 active / 600 cap (75.0%) + 36 alumni = 486 total
  expandCohortForTenant(tenants[1], 'west', 450, 36);
  // St. Jude: 1,800 active / 2,500 cap (72.0%) + 120 alumni = 1,920 total
  expandCohortForTenant(tenants[2], 'sj', 1800, 120);

  const makeAdmission = (
    id: string,
    tenantId: string,
    applicationCode: string,
    studentName: string,
    dateOfBirth: string,
    gender: 'Male' | 'Female',
    targetGrade: string,
    assignedSection: string,
    guardianName: string,
    guardianEmail: string,
    guardianPhone: string,
    previousSchool: string,
    stage: AdmissionApplication['stage'],
    notes: string,
    submittedAt: string,
    updatedAt: string,
    enrolledStudentId?: string
  ): AdmissionApplication => ({
    id,
    tenantId,
    applicationCode,
    studentName,
    dateOfBirth,
    gender,
    targetGrade,
    assignedSection,
    guardianName,
    guardianEmail,
    guardianPhone,
    previousSchool,
    stage,
    checklist: {
      birthCertificate: stage !== 'Inquiry',
      transcripts: stage === 'Interview' || stage === 'Approved' || stage === 'Enrolled',
      medicalClearance: stage === 'Approved' || stage === 'Enrolled',
      guardianId: stage !== 'Inquiry',
      depositPaid: stage === 'Enrolled',
    },
    notes,
    submittedAt,
    updatedAt,
    ...(enrolledStudentId ? { enrolledStudentId } : {}),
  });

  const admissions: AdmissionApplication[] = [
    // Oakridge (Current 2026 pipeline + 2024/2025 historical enrolled)
    makeAdmission('adm-oak-1', 'tenant-oakridge', 'APP-2026-104', 'Elena Vance-Moreau', '2012-04-18', 'Female', 'Grade 9', 'A', 'Jean-Luc Moreau', 'jl.moreau@example.com', '+254 712 555 412', 'Brookhouse Preparatory', 'Approved', 'Strong math olympiad portfolio; awaiting seat deposit confirmation.', '2026-10-28T14:20:00Z', '2026-11-12T09:45:00Z'),
    makeAdmission('adm-oak-2', 'tenant-oakridge', 'APP-2026-105', 'Mateo Silva', '2011-09-12', 'Male', 'Grade 10', 'B', 'Beatriz Silva', 'b.silva@example.com', '+254 722 555 477', 'Riara Springs Academy', 'Interview', 'Family interview scheduled with Admissions Committee for Nov 18.', '2026-11-03T10:15:00Z', '2026-11-11T16:00:00Z'),
    makeAdmission('adm-oak-3', 'tenant-oakridge', 'APP-2026-106', 'Aria Kowalski', '2012-01-25', 'Female', 'Grade 9', 'B', 'Piotr Kowalski', 'p.kowalski@example.com', '+254 733 555 499', 'Kenton College Prep', 'Submitted', 'Awaiting sealed transcript from previous school.', '2026-11-09T11:40:00Z', '2026-11-10T08:30:00Z'),
    makeAdmission('adm-oak-4', 'tenant-oakridge', 'APP-2026-107', 'Soren Lindholm', '2010-12-02', 'Male', 'Grade 11', 'A', 'Astrid Lindholm', 'a.lindholm@example.com', '+254 714 555 520', 'Swedish School Nairobi', 'Inquiry', 'Relocating in January; requested Senior Secondary Physics syllabus.', '2026-11-13T15:10:00Z', '2026-11-13T15:10:00Z'),
    makeAdmission('adm-oak-2025-1', 'tenant-oakridge', 'APP-2025-081', 'Kiprop Chebet', '2011-11-30', 'Male', 'Grade 8', 'A', 'Peter Chebet', 'p.chebet@example.co.ke', '+254 714 550 219', 'Eldoret Premier Academy', 'Enrolled', 'Enrolled into Grade 8 for 2025–2026; promoted to Grade 9 A.', '2025-08-11T09:00:00Z', '2025-09-01T08:30:00Z', 'stu-oak-4'),
    makeAdmission('adm-oak-2025-2', 'tenant-oakridge', 'APP-2025-082', 'Chepkoech Kosgei', '2011-08-12', 'Female', 'Grade 9', 'A', 'Sarah Kosgei', 's.kosgei@example.co.ke', '+254 725 334 890', 'Nakuru Hill Academy', 'Enrolled', 'Enrolled into Grade 9 for 2025–2026; promoted to Grade 10 A.', '2025-08-14T11:20:00Z', '2025-09-02T09:00:00Z', 'stu-oak-7'),
    makeAdmission('adm-oak-2024-1', 'tenant-oakridge', 'APP-2024-041', 'Wanjiku Kamau', '2012-03-14', 'Female', 'Grade 7', 'A', 'Grace Kamau', 'grace.kamau@example.co.ke', '+254 712 345 678', 'Makini Primary School', 'Enrolled', '2024 Junior Secondary intake; currently in Grade 9 A.', '2024-08-10T09:15:00Z', '2024-09-02T08:00:00Z', 'stu-oak-1'),
    makeAdmission('adm-oak-2024-2', 'tenant-oakridge', 'APP-2024-042', 'Faith Muthoni', '2011-05-19', 'Female', 'Grade 8', 'A', 'Margaret Muthoni', 'm.muthoni@example.co.ke', '+254 720 678 134', 'Loreto Convent Msongari', 'Enrolled', '2024 intake; currently in Grade 10 A.', '2024-08-12T10:00:00Z', '2024-09-01T08:00:00Z', 'stu-oak-5'),

    // Westfield (2026 pipeline + 2024/2025 historical enrolled)
    makeAdmission('adm-west-1', 'tenant-westfield', 'WAPP-2026-041', 'Caleb Washington', '2012-05-09', 'Male', 'Grade 9', 'A', 'Denise Washington', 'd.washington@example.com', '+254 721 555 318', 'Nyali International Academy', 'Approved', 'Robotics club transfer candidate.', '2026-11-02T09:00:00Z', '2026-11-12T12:00:00Z'),
    makeAdmission('adm-west-2', 'tenant-westfield', 'WAPP-2026-042', 'Salim Omar', '2011-04-12', 'Male', 'Grade 10', 'A', 'Omar Mbwana', 'o.mbwana@example.co.ke', '+254 733 418 220', 'Mombasa Academy', 'Interview', 'STEM laboratory placement interview scheduled.', '2026-11-06T11:30:00Z', '2026-11-13T10:00:00Z'),
    makeAdmission('adm-west-3', 'tenant-westfield', 'WAPP-2026-043', 'Faith Katunge', '2012-11-04', 'Female', 'Grade 9', 'B', 'Miriam Katunge', 'm.katunge@example.co.ke', '+254 725 901 482', 'Aga Khan Academy Mombasa', 'Submitted', 'Transcripts received; awaiting immunization card.', '2026-11-10T14:00:00Z', '2026-11-12T09:00:00Z'),
    makeAdmission('adm-west-2025-1', 'tenant-westfield', 'WAPP-2025-024', 'Rehema Swaleh', '2012-04-17', 'Female', 'Grade 8', 'A', 'Fatma Swaleh', 'f.swaleh@example.co.ke', '+254 722 714 559', 'Light Academy Mombasa', 'Enrolled', '2025 intake; currently in Grade 9 A.', '2025-08-18T10:00:00Z', '2025-09-01T08:00:00Z', 'stu-west-5'),
    makeAdmission('adm-west-2024-1', 'tenant-westfield', 'WAPP-2024-011', 'Dennis Mwangi', '2012-02-15', 'Male', 'Grade 7', 'A', 'James Mwangi', 'j.mwangi@example.co.ke', '+254 721 319 408', 'Bamburi Premier School', 'Enrolled', '2024 Junior STEM intake; currently in Grade 9 A.', '2024-08-15T09:00:00Z', '2024-09-02T08:00:00Z', 'stu-west-1'),
    makeAdmission('adm-west-2024-2', 'tenant-westfield', 'WAPP-2024-012', 'Victor Mutua', '2011-03-21', 'Male', 'Grade 8', 'A', 'Joseph Mutua', 'j.mutua@example.co.ke', '+254 719 882 154', 'Mombasa Baptist High', 'Enrolled', '2024 intake; currently in Grade 10 A.', '2024-08-16T11:00:00Z', '2024-09-01T08:00:00Z', 'stu-west-3'),

    // St. Jude (2026 pipeline + 2024/2025 historical enrolled)
    makeAdmission('adm-sj-1', 'tenant-stjude', 'SJ-APP-019', 'Freya Pemberton', '2012-08-19', 'Female', 'Grade 9', 'A', 'Hugh Pemberton', 'h.pemberton@example.co.uk', '+254 726 946 511', 'Braeburn Kisumu', 'Interview', 'Academic scholarship assessment completed.', '2026-11-05T13:10:00Z', '2026-11-11T14:20:00Z'),
    makeAdmission('adm-sj-2', 'tenant-stjude', 'SJ-APP-020', 'Brian Anyiko', '2011-06-22', 'Male', 'Grade 10', 'A', 'Judith Anyiko', 'j.anyiko@example.co.ke', '+254 712 409 813', 'Kisumu Senior Academy', 'Approved', 'Cleared interview and Cambridge Mathematics diagnostic.', '2026-11-01T09:30:00Z', '2026-11-12T15:10:00Z'),
    makeAdmission('adm-sj-3', 'tenant-stjude', 'SJ-APP-021', 'Nuru Odhiambo', '2013-12-09', 'Female', 'Grade 7', 'A', 'Caroline Odhiambo', 'c.odhiambo@example.co.ke', '+254 734 812 503', 'Golden Elites School', 'Inquiry', 'Requested 2027 Term 2 boarding fee prospectus.', '2026-11-12T10:45:00Z', '2026-11-12T10:45:00Z'),
    makeAdmission('adm-sj-2025-1', 'tenant-stjude', 'SJ-APP-2025-014', 'Valerie Adhiambo', '2012-09-28', 'Female', 'Grade 8', 'A', 'Pamela Adhiambo', 'p.adhiambo@example.co.ke', '+254 727 608 441', 'Victoria Primary Kisumu', 'Enrolled', '2025 intake; currently in Grade 9 A.', '2025-08-19T09:00:00Z', '2025-09-01T08:00:00Z', 'stu-sj-4'),
    makeAdmission('adm-sj-2024-1', 'tenant-stjude', 'SJ-APP-2024-008', 'Sharon Njeri', '2012-05-11', 'Female', 'Grade 7', 'A', 'Rose Njeri', 'r.njeri@example.co.ke', '+254 723 445 810', 'St. Teresa Preparatory', 'Enrolled', '2024 Junior intake; currently in Grade 9 A.', '2024-08-14T08:30:00Z', '2024-09-02T08:00:00Z', 'stu-sj-1'),
    makeAdmission('adm-sj-2024-2', 'tenant-stjude', 'SJ-APP-2024-009', 'Collins Barasa', '2011-10-04', 'Male', 'Grade 8', 'A', 'Patrick Barasa', 'p.barasa@example.co.ke', '+254 710 924 361', 'Kakamega Hill School', 'Enrolled', '2024 intake; currently in Grade 10 A.', '2024-08-17T10:20:00Z', '2024-09-04T08:00:00Z', 'stu-sj-2'),
  ];

  // Zero-conflict weekly timetable slots
  const makeSlot = (
    id: string,
    tenantId: string,
    day: DayOfWeek,
    period: number,
    grade: string,
    section: string,
    subject: string,
    teacherId: string,
    teacherName: string,
    room: string
  ): TimetableSlot => ({
    id,
    tenantId,
    day,
    period,
    startTime: PERIOD_TIMES[period].startTime,
    endTime: PERIOD_TIMES[period].endTime,
    grade,
    section,
    subject,
    teacherId,
    teacherName,
    room,
  });

  const timetable: TimetableSlot[] = [
    // Oakridge Grade 9 A
    makeSlot('tt-1', 'tenant-oakridge', 'Monday', 1, 'Grade 9', 'A', 'Mathematics', 't-oak-1', 'Mr. Kamau Njoroge', 'Room 101'),
    makeSlot('tt-2', 'tenant-oakridge', 'Monday', 2, 'Grade 9', 'A', 'English', 't-oak-3', 'Ms. Chebet Kiprono', 'Room 104'),
    makeSlot('tt-3', 'tenant-oakridge', 'Monday', 3, 'Grade 9', 'A', 'Integrated Science', 't-oak-2', 'Mrs. Achieng Odhiambo', 'Science Lab 1'),
    makeSlot('tt-4', 'tenant-oakridge', 'Monday', 4, 'Grade 9', 'A', 'Kiswahili', 't-oak-4', 'Mr. Mutua Musyoka', 'Room 101'),
    makeSlot('tt-5', 'tenant-oakridge', 'Monday', 5, 'Grade 9', 'A', 'Social Studies', 't-oak-5', 'Mrs. Wambui Mwangi', 'Hall 202'),
    makeSlot('tt-6', 'tenant-oakridge', 'Monday', 7, 'Grade 9', 'A', 'Pre-Technical Studies', 't-oak-1', 'Mr. Kamau Njoroge', 'Room 101'),
    makeSlot('tt-7', 'tenant-oakridge', 'Tuesday', 1, 'Grade 9', 'A', 'Kiswahili', 't-oak-4', 'Mr. Mutua Musyoka', 'Room 104'),
    makeSlot('tt-8', 'tenant-oakridge', 'Tuesday', 2, 'Grade 9', 'A', 'Mathematics', 't-oak-1', 'Mr. Kamau Njoroge', 'Room 101'),
    makeSlot('tt-9', 'tenant-oakridge', 'Tuesday', 4, 'Grade 9', 'A', 'Agriculture & Nutrition', 't-oak-2', 'Mrs. Achieng Odhiambo', 'Science Lab 1'),
    makeSlot('tt-10', 'tenant-oakridge', 'Tuesday', 6, 'Grade 9', 'A', 'Computer Studies', 't-oak-5', 'Mrs. Wambui Mwangi', 'ICT Lab'),
    makeSlot('tt-11', 'tenant-oakridge', 'Tuesday', 8, 'Grade 9', 'A', 'Creative Arts & Sports', 't-oak-3', 'Ms. Chebet Kiprono', 'Field & Studio'),
    makeSlot('tt-12', 'tenant-oakridge', 'Wednesday', 1, 'Grade 9', 'A', 'Computer Studies', 't-oak-5', 'Mrs. Wambui Mwangi', 'ICT Lab'),
    makeSlot('tt-13', 'tenant-oakridge', 'Wednesday', 3, 'Grade 9', 'A', 'Integrated Science', 't-oak-2', 'Mrs. Achieng Odhiambo', 'Science Lab 1'),
    makeSlot('tt-14', 'tenant-oakridge', 'Wednesday', 4, 'Grade 9', 'A', 'English', 't-oak-3', 'Ms. Chebet Kiprono', 'Room 104'),
    makeSlot('tt-15', 'tenant-oakridge', 'Wednesday', 7, 'Grade 9', 'A', 'Religious Education (CRE / IRE / HRE)', 't-oak-4', 'Mr. Mutua Musyoka', 'Hall 202'),
    makeSlot('tt-16', 'tenant-oakridge', 'Thursday', 2, 'Grade 9', 'A', 'Mathematics', 't-oak-1', 'Mr. Kamau Njoroge', 'Room 101'),
    makeSlot('tt-17', 'tenant-oakridge', 'Thursday', 3, 'Grade 9', 'A', 'Social Studies', 't-oak-5', 'Mrs. Wambui Mwangi', 'Hall 202'),
    makeSlot('tt-18', 'tenant-oakridge', 'Thursday', 5, 'Grade 9', 'A', 'English', 't-oak-3', 'Ms. Chebet Kiprono', 'Room 104'),
    makeSlot('tt-19', 'tenant-oakridge', 'Friday', 1, 'Grade 9', 'A', 'Integrated Science', 't-oak-2', 'Mrs. Achieng Odhiambo', 'Science Lab 1'),
    makeSlot('tt-20', 'tenant-oakridge', 'Friday', 2, 'Grade 9', 'A', 'Kiswahili', 't-oak-4', 'Mr. Mutua Musyoka', 'Room 104'),

    // Oakridge Grade 9 B (non-conflicting teachers t-oak-6, t-oak-7 & rooms Room 102, Room 106)
    makeSlot('tt-28', 'tenant-oakridge', 'Monday', 1, 'Grade 9', 'B', 'English', 't-oak-7', 'Mrs. Zainab Hassan', 'Room 102'),
    makeSlot('tt-29', 'tenant-oakridge', 'Monday', 2, 'Grade 9', 'B', 'Mathematics', 't-oak-6', 'Mr. Brian Kiptoo', 'Room 106'),
    makeSlot('tt-30', 'tenant-oakridge', 'Tuesday', 1, 'Grade 9', 'B', 'Integrated Science', 't-oak-6', 'Mr. Brian Kiptoo', 'Room 102'),
    makeSlot('tt-31', 'tenant-oakridge', 'Wednesday', 2, 'Grade 9', 'B', 'Kiswahili', 't-oak-7', 'Mrs. Zainab Hassan', 'Room 102'),

    // Oakridge Grade 10 A (non-conflicting teachers & rooms)
    makeSlot('tt-21', 'tenant-oakridge', 'Monday', 1, 'Grade 10', 'A', 'Social Studies', 't-oak-5', 'Mrs. Wambui Mwangi', 'Hall 202'),
    makeSlot('tt-22', 'tenant-oakridge', 'Monday', 2, 'Grade 10', 'A', 'Kiswahili', 't-oak-4', 'Mr. Mutua Musyoka', 'Room 101'),
    makeSlot('tt-23', 'tenant-oakridge', 'Monday', 4, 'Grade 10', 'A', 'Mathematics', 't-oak-1', 'Mr. Kamau Njoroge', 'Room 104'),
    makeSlot('tt-24', 'tenant-oakridge', 'Tuesday', 3, 'Grade 10', 'A', 'Mathematics', 't-oak-1', 'Mr. Kamau Njoroge', 'Room 101'),
    makeSlot('tt-25', 'tenant-oakridge', 'Wednesday', 2, 'Grade 10', 'A', 'Integrated Science', 't-oak-2', 'Mrs. Achieng Odhiambo', 'Science Lab 1'),
    makeSlot('tt-26', 'tenant-oakridge', 'Thursday', 1, 'Grade 10', 'A', 'Mathematics', 't-oak-1', 'Mr. Kamau Njoroge', 'Room 101'),
    makeSlot('tt-27', 'tenant-oakridge', 'Friday', 3, 'Grade 10', 'A', 'Computer Studies', 't-oak-5', 'Mrs. Wambui Mwangi', 'ICT Lab'),

    // Westfield STEM High (Grade 9 A, Grade 9 B, Grade 10 A — zero conflicts)
    makeSlot('tt-w1', 'tenant-westfield', 'Monday', 1, 'Grade 9', 'A', 'Mathematics', 't-west-1', 'David Chen', 'STEM 101'),
    makeSlot('tt-w2', 'tenant-westfield', 'Monday', 2, 'Grade 9', 'A', 'Pre-Technical Studies', 't-west-2', 'Elena Morales', 'Maker Studio'),
    makeSlot('tt-w3', 'tenant-westfield', 'Monday', 3, 'Grade 9', 'A', 'Integrated Science', 't-west-3', 'Rachel Foster', 'Bio Lab 1'),
    makeSlot('tt-w4', 'tenant-westfield', 'Monday', 4, 'Grade 9', 'A', 'English', 't-west-4', 'Trevor Brooks', 'Room 210'),
    makeSlot('tt-w5', 'tenant-westfield', 'Tuesday', 1, 'Grade 9', 'A', 'Integrated Science', 't-west-3', 'Rachel Foster', 'Bio Lab 1'),
    makeSlot('tt-w6', 'tenant-westfield', 'Tuesday', 2, 'Grade 9', 'A', 'Kiswahili', 't-west-5', 'Salma Abdalla', 'Room 210'),
    makeSlot('tt-w7', 'tenant-westfield', 'Wednesday', 2, 'Grade 9', 'A', 'Social Studies', 't-west-4', 'Trevor Brooks', 'Room 210'),
    makeSlot('tt-w8', 'tenant-westfield', 'Thursday', 1, 'Grade 9', 'A', 'Computer Studies', 't-west-2', 'Elena Morales', 'ICT Studio'),
    makeSlot('tt-w9', 'tenant-westfield', 'Friday', 1, 'Grade 9', 'A', 'Mathematics', 't-west-1', 'David Chen', 'STEM 101'),
    makeSlot('tt-w10', 'tenant-westfield', 'Monday', 1, 'Grade 9', 'B', 'Integrated Science', 't-west-6', 'Kelvin Mwamburi', 'STEM 102'),
    makeSlot('tt-w11', 'tenant-westfield', 'Monday', 2, 'Grade 9', 'B', 'English', 't-west-4', 'Trevor Brooks', 'STEM 102'),
    makeSlot('tt-w12', 'tenant-westfield', 'Tuesday', 1, 'Grade 10', 'A', 'Core Mathematics', 't-west-1', 'David Chen', 'STEM 101'),
    makeSlot('tt-w13', 'tenant-westfield', 'Wednesday', 1, 'Grade 10', 'A', 'Biology', 't-west-3', 'Rachel Foster', 'Chem Lab 2'),
    makeSlot('tt-w14', 'tenant-westfield', 'Thursday', 2, 'Grade 10', 'A', 'Kiswahili', 't-west-5', 'Salma Abdalla', 'STEM 102'),

    // St. Jude International (Grade 9 A, Grade 9 B, Grade 10 A — zero conflicts)
    makeSlot('tt-sj1', 'tenant-stjude', 'Monday', 1, 'Grade 9', 'A', 'Mathematics', 't-sj-1', 'Arthur Pendelton', 'North Wing 1'),
    makeSlot('tt-sj2', 'tenant-stjude', 'Monday', 2, 'Grade 9', 'A', 'English', 't-sj-2', 'Priya Nair', 'North Wing 2'),
    makeSlot('tt-sj3', 'tenant-stjude', 'Monday', 3, 'Grade 9', 'A', 'Integrated Science', 't-sj-3', 'Oliver Grant', 'Science Block 3'),
    makeSlot('tt-sj4', 'tenant-stjude', 'Monday', 4, 'Grade 9', 'A', 'Kiswahili', 't-sj-4', 'Millicent Atieno', 'North Wing 1'),
    makeSlot('tt-sj5', 'tenant-stjude', 'Tuesday', 1, 'Grade 9', 'A', 'Integrated Science', 't-sj-3', 'Oliver Grant', 'Science Block 3'),
    makeSlot('tt-sj6', 'tenant-stjude', 'Tuesday', 2, 'Grade 9', 'A', 'Computer Studies', 't-sj-5', 'Victor Ouma', 'ICT Wing'),
    makeSlot('tt-sj7', 'tenant-stjude', 'Wednesday', 1, 'Grade 9', 'A', 'Social Studies', 't-sj-2', 'Priya Nair', 'North Wing 2'),
    makeSlot('tt-sj8', 'tenant-stjude', 'Thursday', 2, 'Grade 9', 'A', 'Mathematics', 't-sj-1', 'Arthur Pendelton', 'North Wing 1'),
    makeSlot('tt-sj9', 'tenant-stjude', 'Monday', 1, 'Grade 9', 'B', 'Kiswahili', 't-sj-4', 'Millicent Atieno', 'North Wing 3'),
    makeSlot('tt-sj10', 'tenant-stjude', 'Tuesday', 1, 'Grade 10', 'A', 'Core Mathematics', 't-sj-1', 'Arthur Pendelton', 'North Wing 1'),
    makeSlot('tt-sj11', 'tenant-stjude', 'Wednesday', 2, 'Grade 10', 'A', 'Physics', 't-sj-3', 'Oliver Grant', 'Science Block 3'),
    makeSlot('tt-sj12', 'tenant-stjude', 'Friday', 1, 'Grade 10', 'A', 'Business Studies', 't-sj-2', 'Priya Nair', 'Lecture Hall'),
  ];

  // =========================================================================
  // ACADEMIC YEARS & TERMS (2024–2025, 2025–2026, 2026–2027) FOR ALL 3 SCHOOLS
  // =========================================================================
  const academicYears: AcademicYear[] = [];
  const academicTerms: AcademicTerm[] = [];

  const tenantSlugPrefix: Record<string, string> = {
    'tenant-oakridge': 'oak',
    'tenant-westfield': 'west',
    'tenant-stjude': 'sj',
  };

  for (const t of tenants) {
    const p = tenantSlugPrefix[t.id];
    // Previous Year 2: 2024-2025 (Closed)
    academicYears.push({
      id: `ay-${p}-2024`,
      tenantId: t.id,
      name: '2024–2025',
      startDate: '2024-09-02',
      endDate: '2025-07-25',
      status: 'Closed',
      isCurrent: false,
      closedAt: '2025-07-28T16:00:00Z',
      closedBy: t.mpesaConfig?.updatedBy || 'School Principal',
      createdAt: '2024-08-15T08:00:00Z',
    });
    academicTerms.push(
      {
        id: `term-${p}-2024-1`,
        tenantId: t.id,
        academicYearId: `ay-${p}-2024`,
        name: 'Term 1',
        startDate: '2024-09-02',
        endDate: '2024-12-13',
        status: 'Closed',
        isCurrent: false,
        closedAt: '2024-12-16T16:00:00Z',
        closedBy: t.mpesaConfig?.updatedBy || 'School Principal',
        createdAt: '2024-08-15T08:00:00Z',
      },
      {
        id: `term-${p}-2024-2`,
        tenantId: t.id,
        academicYearId: `ay-${p}-2024`,
        name: 'Term 2',
        startDate: '2025-01-06',
        endDate: '2025-04-04',
        status: 'Closed',
        isCurrent: false,
        closedAt: '2025-04-07T16:00:00Z',
        closedBy: t.mpesaConfig?.updatedBy || 'School Principal',
        createdAt: '2024-08-15T08:00:00Z',
      },
      {
        id: `term-${p}-2024-3`,
        tenantId: t.id,
        academicYearId: `ay-${p}-2024`,
        name: 'Term 3',
        startDate: '2025-05-05',
        endDate: '2025-07-25',
        status: 'Closed',
        isCurrent: false,
        closedAt: '2025-07-28T16:00:00Z',
        closedBy: t.mpesaConfig?.updatedBy || 'School Principal',
        createdAt: '2024-08-15T08:00:00Z',
      }
    );

    // Previous Year 1: 2025-2026 (Closed)
    academicYears.push({
      id: `ay-${p}-2025`,
      tenantId: t.id,
      name: '2025–2026',
      startDate: '2025-09-01',
      endDate: '2026-07-24',
      status: 'Closed',
      isCurrent: false,
      closedAt: '2026-07-27T16:00:00Z',
      closedBy: t.mpesaConfig?.updatedBy || 'School Principal',
      createdAt: '2025-08-15T08:00:00Z',
    });
    academicTerms.push(
      {
        id: `term-${p}-2025-1`,
        tenantId: t.id,
        academicYearId: `ay-${p}-2025`,
        name: 'Term 1',
        startDate: '2025-09-01',
        endDate: '2025-12-12',
        status: 'Closed',
        isCurrent: false,
        closedAt: '2025-12-15T16:00:00Z',
        closedBy: t.mpesaConfig?.updatedBy || 'School Principal',
        createdAt: '2025-08-15T08:00:00Z',
      },
      {
        id: `term-${p}-2025-2`,
        tenantId: t.id,
        academicYearId: `ay-${p}-2025`,
        name: 'Term 2',
        startDate: '2026-01-05',
        endDate: '2026-04-03',
        status: 'Closed',
        isCurrent: false,
        closedAt: '2026-04-06T16:00:00Z',
        closedBy: t.mpesaConfig?.updatedBy || 'School Principal',
        createdAt: '2025-08-15T08:00:00Z',
      },
      {
        id: `term-${p}-2025-3`,
        tenantId: t.id,
        academicYearId: `ay-${p}-2025`,
        name: 'Term 3',
        startDate: '2026-05-04',
        endDate: '2026-07-24',
        status: 'Closed',
        isCurrent: false,
        closedAt: '2026-07-27T16:00:00Z',
        closedBy: t.mpesaConfig?.updatedBy || 'School Principal',
        createdAt: '2025-08-15T08:00:00Z',
      }
    );

    // Current Year: 2026-2027 (Open)
    academicYears.push({
      id: `ay-${p}-2026`,
      tenantId: t.id,
      name: '2026–2027',
      startDate: '2026-09-01',
      endDate: '2027-07-31',
      status: 'Open',
      isCurrent: true,
      createdAt: '2026-08-15T08:00:00Z',
    });
    academicTerms.push(
      {
        id: `term-${p}-1`,
        tenantId: t.id,
        academicYearId: `ay-${p}-2026`,
        name: 'Term 1',
        startDate: '2026-09-01',
        endDate: '2026-12-15',
        status: 'Open',
        isCurrent: true,
        createdAt: '2026-08-15T08:00:00Z',
      },
      {
        id: `term-${p}-2`,
        tenantId: t.id,
        academicYearId: `ay-${p}-2026`,
        name: 'Term 2',
        startDate: '2027-01-05',
        endDate: '2027-04-10',
        status: 'Open',
        isCurrent: false,
        createdAt: '2026-08-15T08:00:00Z',
      },
      {
        id: `term-${p}-3`,
        tenantId: t.id,
        academicYearId: `ay-${p}-2026`,
        name: 'Term 3',
        startDate: '2027-05-03',
        endDate: '2027-07-31',
        status: 'Open',
        isCurrent: false,
        createdAt: '2026-08-15T08:00:00Z',
      }
    );
  }

  // =========================================================================
  // MULTI-YEAR ATTENDANCE, STAFF ATTENDANCE & LEAVE-OUT CHITS (ALL 3 SCHOOLS)
  // =========================================================================
  const attendanceBatches: Array<{ dates: string[]; termSuffix: string }> = [
    // 2024-2025 historical snapshots
    { dates: ['2024-10-14', '2024-10-15', '2024-10-16'], termSuffix: '2024-1' },
    { dates: ['2025-02-10', '2025-02-11', '2025-02-12'], termSuffix: '2024-2' },
    { dates: ['2025-06-09', '2025-06-10', '2025-06-11'], termSuffix: '2024-3' },
    // 2025-2026 historical snapshots
    { dates: ['2025-10-13', '2025-10-14', '2025-10-15'], termSuffix: '2025-1' },
    { dates: ['2026-02-09', '2026-02-10', '2026-02-11'], termSuffix: '2025-2' },
    { dates: ['2026-06-08', '2026-06-09', '2026-06-10'], termSuffix: '2025-3' },
    // Current 2026-2027 Term 1 roll calls
    { dates: ['2026-10-12', '2026-10-13', '2026-11-05', '2026-11-06'], termSuffix: '1' },
    { dates: ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'], termSuffix: '1' },
  ];

  const attendance: AttendanceRecord[] = [];
  for (const t of tenants) {
    const p = tenantSlugPrefix[t.id];
    const recorder = t.teachers[0]?.name || 'Class Teacher';
    // Keep roll-call history focused on key Grade 9 A, Grade 10 A, and Grade 11 A streams (~70-120 learners/school)
    const focalCohort = students.filter(
      (s) =>
        s.tenantId === t.id &&
        ((s.grade === 'Grade 9' && s.section === 'A') ||
          (s.grade === 'Grade 10' && s.section === 'A') ||
          (s.grade === 'Grade 11' && s.section === 'A'))
    ).slice(0, 90);

    attendanceBatches.forEach((batch, bIdx) => {
      const termId = `term-${p}-${batch.termSuffix}`;
      const batchYear = Number(batch.dates[0].slice(0, 4));
      batch.dates.forEach((date, dIdx) => {
        focalCohort.forEach((stu, sIdx) => {
          const enrolledYear = Number(stu.enrolledAt.slice(0, 4));
          if (enrolledYear > batchYear) return;
          if (stu.status === 'Graduated' && batch.termSuffix === '1') return;

          let status: AttendanceRecord['status'] = 'Present';
          let remarks = '';
          const mod = (bIdx * 7 + dIdx * 3 + sIdx) % 19;
          if (mod === 5) {
            status = 'Absent';
            remarks = 'Parent called regarding seasonal flu';
          } else if (mod === 11) {
            status = 'Late';
            remarks = 'Arrived 12 mins after morning assembly bell';
          } else if (mod === 16) {
            status = 'Excused';
            remarks = 'Regional science & debate symposium';
          }

          attendance.push({
            id: `att-${t.id}-${date}-${stu.id}`,
            tenantId: t.id,
            termId,
            date,
            grade: stu.grade,
            section: stu.section,
            studentId: stu.id,
            studentName: stu.fullName,
            studentCode: stu.studentCode,
            status,
            remarks,
            recordedBy: recorder,
            updatedAt: `${date}T08:30:00Z`,
          });
        });
      });
    });
  }

  const staffAttendance: StaffAttendanceRecord[] = [];
  const staffAttendanceDates = ['2024-10-14', '2025-10-13', '2026-11-12', '2026-11-13', '2026-11-14'];
  for (const t of tenants) {
    const recorder = t.mpesaConfig?.updatedBy || 'School Principal';
    staffAttendanceDates.forEach((date, dIdx) => {
      t.teachers.slice(0, 24).forEach((teacher, idx) => {
        const isLate = dIdx === 3 && idx === 2;
        staffAttendance.push({
          id: `satt-${t.id}-${date}-${teacher.id}`,
          tenantId: t.id,
          date,
          staffId: teacher.id,
          staffName: teacher.name,
          staffCategory: 'Teaching',
          role: 'Teacher',
          department: teacher.department,
          phone: teacher.phone,
          status: isLate ? 'Late' : 'Present',
          remarks: isLate ? 'Traffic delay along highway' : '',
          recordedBy: recorder,
          updatedAt: `${date}T07:50:00Z`,
        });
      });
      (t.nonTeachingStaff || []).slice(0, 10).forEach((staff) => {
        staffAttendance.push({
          id: `satt-${t.id}-${date}-${staff.id}`,
          tenantId: t.id,
          date,
          staffId: staff.id,
          staffName: staff.name,
          staffCategory: 'Non-Teaching',
          role: staff.role,
          department: staff.department,
          phone: staff.phone,
          status: 'Present',
          remarks: '',
          recordedBy: recorder,
          updatedAt: `${date}T07:45:00Z`,
        });
      });
    });
  }

  const leaveOutChits: LeaveOutChit[] = [
    {
      id: 'chit-oak-1',
      tenantId: 'tenant-oakridge',
      termId: 'term-oak-1',
      studentId: 'stu-oak-4',
      studentName: 'Kiprop Chebet',
      studentCode: 'ADM-2604',
      grade: 'Grade 9',
      section: 'A',
      startDate: '2026-11-14',
      days: 2,
      endDate: '2026-11-15',
      reason: 'Dental clinic appointment with parent',
      issuedBy: 'Dr. Helena Vance',
      createdAt: '2026-11-14T07:40:00Z',
    },
    {
      id: 'chit-oak-2025-1',
      tenantId: 'tenant-oakridge',
      termId: 'term-oak-2025-2',
      studentId: 'stu-oak-5',
      studentName: 'Faith Muthoni',
      studentCode: 'ADM-2501',
      grade: 'Grade 10',
      section: 'A',
      startDate: '2026-02-10',
      days: 3,
      endDate: '2026-02-12',
      reason: 'National Kenya Science & Engineering Fair representation',
      issuedBy: 'Dr. Helena Vance',
      createdAt: '2026-02-09T15:00:00Z',
    },
    {
      id: 'chit-west-1',
      tenantId: 'tenant-westfield',
      termId: 'term-west-1',
      studentId: 'stu-west-2',
      studentName: 'Esther Wambui',
      studentCode: 'ADM-2602',
      grade: 'Grade 9',
      section: 'A',
      startDate: '2026-11-13',
      days: 1,
      endDate: '2026-11-13',
      reason: 'Passport renewal biometrics with guardian',
      issuedBy: 'David Chen',
      createdAt: '2026-11-13T07:50:00Z',
    },
    {
      id: 'chit-sj-1',
      tenantId: 'tenant-stjude',
      termId: 'term-sj-1',
      studentId: 'stu-sj-3',
      studentName: 'Maxwell Omondi',
      studentCode: 'ADM-2603',
      grade: 'Grade 9',
      section: 'A',
      startDate: '2026-11-12',
      days: 2,
      endDate: '2026-11-13',
      reason: 'Family bereavement leave',
      issuedBy: 'Arthur Pendelton',
      createdAt: '2026-11-12T08:15:00Z',
    },
  ];

  // =========================================================================
  // EXAM CYCLES & EXAM RESULTS ACROSS 2024-2025, 2025-2026, AND 2026-2027
  // =========================================================================
  const examCycles: ExamCycle[] = [];
  const examResults: ExamResult[] = [];

  for (const t of tenants) {
    const p = tenantSlugPrefix[t.id];
    const isOak = t.id === 'tenant-oakridge';

    const tenantCycleSpecs: Array<{
      id: string;
      yearId: string;
      termId: string;
      title: string;
      term: string;
      startDate: string;
      endDate: string;
      status: ExamCycle['status'];
      createdAt: string;
      yearOffset: number; // -2 for 2024-2025, -1 for 2025-2026, 0 for 2026-2027
      scoreShift: number;
    }> = [
      // 2024-2025 (2 years ago)
      {
        id: `exm-${p}-2024-t1`,
        yearId: `ay-${p}-2024`,
        termId: `term-${p}-2024-1`,
        title: '2024–2025 Term 1 End of Term Exam',
        term: 'Term 1',
        startDate: '2024-11-18',
        endDate: '2024-11-22',
        status: 'Published',
        createdAt: '2024-11-01T09:00:00Z',
        yearOffset: -2,
        scoreShift: -5,
      },
      {
        id: `exm-${p}-2024-t2`,
        yearId: `ay-${p}-2024`,
        termId: `term-${p}-2024-2`,
        title: '2024–2025 Term 2 End of Term Exam',
        term: 'Term 2',
        startDate: '2025-03-17',
        endDate: '2025-03-21',
        status: 'Published',
        createdAt: '2025-03-01T09:00:00Z',
        yearOffset: -2,
        scoreShift: -4,
      },
      {
        id: `exm-${p}-2024-t3`,
        yearId: `ay-${p}-2024`,
        termId: `term-${p}-2024-3`,
        title: '2024–2025 Term 3 End of Term Exam',
        term: 'Term 3',
        startDate: '2025-07-07',
        endDate: '2025-07-11',
        status: 'Published',
        createdAt: '2025-06-20T09:00:00Z',
        yearOffset: -2,
        scoreShift: -3,
      },
      // 2025-2026 (1 year ago)
      {
        id: `exm-${p}-2025-t1m`,
        yearId: `ay-${p}-2025`,
        termId: `term-${p}-2025-1`,
        title: '2025–2026 Term 1 Mid-Term Exam',
        term: 'Term 1',
        startDate: '2025-10-13',
        endDate: '2025-10-17',
        status: 'Published',
        createdAt: '2025-10-01T09:00:00Z',
        yearOffset: -1,
        scoreShift: -2,
      },
      {
        id: `exm-${p}-2025-t1`,
        yearId: `ay-${p}-2025`,
        termId: `term-${p}-2025-1`,
        title: '2025–2026 Term 1 End of Term Exam',
        term: 'Term 1',
        startDate: '2025-11-17',
        endDate: '2025-11-21',
        status: 'Published',
        createdAt: '2025-11-01T09:00:00Z',
        yearOffset: -1,
        scoreShift: -1,
      },
      {
        id: `exm-${p}-2025-t2`,
        yearId: `ay-${p}-2025`,
        termId: `term-${p}-2025-2`,
        title: '2025–2026 Term 2 End of Term Exam',
        term: 'Term 2',
        startDate: '2026-03-16',
        endDate: '2026-03-20',
        status: 'Published',
        createdAt: '2026-03-01T09:00:00Z',
        yearOffset: -1,
        scoreShift: 0,
      },
      {
        id: `exm-${p}-2025-t3`,
        yearId: `ay-${p}-2025`,
        termId: `term-${p}-2025-3`,
        title: '2025–2026 Term 3 End of Term Exam',
        term: 'Term 3',
        startDate: '2026-07-06',
        endDate: '2026-07-10',
        status: 'Published',
        createdAt: '2026-06-22T09:00:00Z',
        yearOffset: -1,
        scoreShift: 1,
      },
      // Current 2026-2027 Term 1 (preserve existing cycle IDs)
      {
        id: isOak ? 'exm-oak-open' : `exm-${p}-open`,
        yearId: `ay-${p}-2026`,
        termId: `term-${p}-1`,
        title: 'Term 1 Opening Exam',
        term: 'Term 1',
        startDate: '2026-09-07',
        endDate: '2026-09-11',
        status: 'Published',
        createdAt: '2026-09-01T09:00:00Z',
        yearOffset: 0,
        scoreShift: -2,
      },
      {
        id: isOak ? 'exm-oak-1' : `exm-${p}-1`,
        yearId: `ay-${p}-2026`,
        termId: `term-${p}-1`,
        title: 'Term 1 Mid-Term Exam',
        term: 'Term 1',
        startDate: '2026-10-12',
        endDate: '2026-10-16',
        status: 'Published',
        createdAt: '2026-09-25T10:00:00Z',
        yearOffset: 0,
        scoreShift: 1,
      },
      {
        id: isOak ? 'exm-oak-2' : `exm-${p}-2`,
        yearId: `ay-${p}-2026`,
        termId: `term-${p}-1`,
        title: 'Term 1 End of Term Exam',
        term: 'Term 1',
        startDate: '2026-11-18',
        endDate: '2026-11-24',
        status: 'Grading',
        createdAt: '2026-11-01T09:00:00Z',
        yearOffset: 0,
        scoreShift: 2,
      },
    ];

    for (const c of tenantCycleSpecs) {
      examCycles.push({
        id: c.id,
        tenantId: t.id,
        academicYearId: c.yearId,
        termId: c.termId,
        title: c.title,
        term: c.term,
        startDate: c.startDate,
        endDate: c.endDate,
        status: c.status,
        createdAt: c.createdAt,
      });
    }

    const baseScores: Record<string, number[]> = {
      'stu-oak-1': [94, 91, 89, 96, 88],
      'stu-oak-2': [85, 79, 84, 88, 82],
      'stu-oak-3': [92, 87, 94, 90, 89],
      'stu-oak-4': [74, 71, 78, 82, 76],
      'stu-oak-5': [96, 93, 91, 95, 92],
      'stu-oak-6': [88, 90, 82, 94, 87],
      'stu-oak-7': [81, 76, 89, 85, 83],
      'stu-oak-8': [68, 64, 75, 72, 70],
      'stu-oak-9': [90, 86, 93, 88, 85],
      'stu-oak-10': [79, 84, 77, 91, 81],
    };

    const tenantStudents = students.filter((s) => {
      if (s.tenantId !== t.id) return false;
      // Score all Stream A learners across assessed grades, focal Stream B in Grade 9/10, plus up to 24 alumni per school
      if (s.status === 'Graduated') {
        const alumMatch = s.id.match(/-alum-(\d+)$/);
        return !alumMatch || Number(alumMatch[1]) <= 24;
      }
      if (s.grade === 'Playgroup' || s.grade === 'PP1' || s.grade === 'PP2') return false;
      if (s.section === 'A') return true;
      return (s.grade === 'Grade 9' || s.grade === 'Grade 10') && s.section === 'B';
    });
    const shiftGradeByYear = (currentGrade: string, yearOffset: number, status?: Student['status']): string | null => {
      if (status === 'Graduated') {
        // Alumni graduated either after 2024-2025 or 2025-2026
        if (yearOffset === 0) return null;
        return yearOffset === -2 ? 'Grade 11' : 'Grade 12';
      }
      const idx = KENYAN_CBC_GRADES.indexOf(currentGrade as (typeof KENYAN_CBC_GRADES)[number]);
      if (idx === -1) return currentGrade;
      const targetIdx = idx + yearOffset;
      if (targetIdx < 0) return null;
      return KENYAN_CBC_GRADES[targetIdx];
    };

    const subjectsForGradeAndCycle = (gradeLabel: string): string[] => {
      if (gradeLabel === 'Playgroup' || gradeLabel === 'PP1' || gradeLabel === 'PP2') {
        return ['Language Activities', 'Mathematical Activities', 'Environmental Activities'];
      }
      if (
        gradeLabel === 'Grade 1' ||
        gradeLabel === 'Grade 2' ||
        gradeLabel === 'Grade 3'
      ) {
        return ['English', 'Kiswahili', 'Mathematics', 'Environmental Activities'];
      }
      if (gradeLabel === 'Grade 4' || gradeLabel === 'Grade 5' || gradeLabel === 'Grade 6') {
        return ['English', 'Kiswahili', 'Mathematics', 'Science & Technology', 'Social Studies'];
      }
      if (gradeLabel === 'Grade 10' || gradeLabel === 'Grade 11' || gradeLabel === 'Grade 12') {
        return ['English', 'Kiswahili', 'Core Mathematics', 'Biology', 'Physics', 'Chemistry'];
      }
      return ['Mathematics', 'Integrated Science', 'English', 'Kiswahili', 'Social Studies'];
    };

    tenantStudents.forEach((stu, stuIdx) => {
      const enrolledYear = Number(stu.enrolledAt.slice(0, 4));
      tenantCycleSpecs.forEach((cyc) => {
        const cycleYear = cyc.yearOffset === -2 ? 2024 : cyc.yearOffset === -1 ? 2025 : 2026;
        if (enrolledYear > cycleYear && stu.status !== 'Graduated') return;
        // For multi-stream Grade 9/10 B, keep current-year Mid-Term & Opening scored cleanly; historical cycles scored for Stream A + alumni
        if (stu.section === 'B' && cyc.yearOffset < 0) return;
        // Skip graduated 2024 alumni in 2025-2026 cycles
        if (stu.status === 'Graduated' && stu.statusDate?.startsWith('2025') && cyc.yearOffset >= -1) {
          return;
        }
        const gradeAtCycle = shiftGradeByYear(stu.grade, cyc.yearOffset, stu.status);
        if (!gradeAtCycle) return;

        const subjects = subjectsForGradeAndCycle(gradeAtCycle);
        const preset = baseScores[stu.id];

        subjects.forEach((subject, subIdx) => {
          const base = preset
            ? preset[subIdx % preset.length]
            : 66 + ((stuIdx * 7 + subIdx * 5) % 28);
          const rawScore = Math.min(99, Math.max(42, base + cyc.scoreShift + ((subIdx + stuIdx) % 3) - 1));
          const graded = computeLetterGrade(rawScore, gradeAtCycle);
          examResults.push({
            id: `res-${cyc.id}-${stu.id}-${subIdx}`,
            tenantId: t.id,
            examCycleId: cyc.id,
            studentId: stu.id,
            studentName: stu.fullName,
            studentCode: stu.studentCode,
            grade: gradeAtCycle,
            section: stu.section,
            subject,
            score: rawScore,
            maxScore: 100,
            letterGrade: graded.letterGrade,
            gpaPoints: graded.gpaPoints,
            remarks:
              rawScore >= 88
                ? 'Exemplary analytical depth'
                : rawScore >= 75
                ? 'Consistent term progress'
                : 'Needs targeted revision',
            updatedAt: `${cyc.endDate}T15:00:00Z`,
          });
        });
      });
    });
  }

  // =========================================================================
  // FEE STRUCTURES, MULTI-YEAR INVOICES, PAYMENTS, WAIVERS, MPESA & VOTELINES
  // =========================================================================
  const buildSeedVotelines = (
    tuitionFee: number,
    labFee: number,
    technologyFee: number,
    activitiesFee: number
  ): FeeVoteline[] => [
    { id: 'vl-tuition', name: 'Tuition Fee', amount: tuitionFee },
    { id: 'vl-lab', name: 'Laboratory Fee', amount: labFee },
    { id: 'vl-tech', name: 'Technology & ICT', amount: technologyFee },
    { id: 'vl-act', name: 'Co-Curricular & Activities', amount: activitiesFee },
  ];

  const feeStructures: FeeStructure[] = [];
  const invoices: FeeInvoice[] = [];
  const feeWaivers: FeeWaiverRecord[] = [];
  const creditNotes: CreditNoteRecord[] = [];
  const independentVotelines: IndependentVotelineItem[] = [];
  const mpesaTransactions: MpesaTransactionLog[] = [];

  const gradeBaseFeeKes: Record<string, [number, number, number, number]> = {
    Playgroup: [18000, 500, 1000, 1500],
    PP1: [20000, 500, 1000, 1500],
    PP2: [21000, 800, 1200, 1500],
    'Grade 1': [24000, 1000, 1500, 1500],
    'Grade 2': [25000, 1200, 1600, 1500],
    'Grade 3': [26000, 1300, 1700, 1600],
    'Grade 4': [27000, 1500, 1800, 1700],
    'Grade 5': [28000, 1650, 1900, 1700],
    'Grade 6': [29000, 1800, 2000, 1700],
    'Grade 7': [34000, 2500, 2200, 1800],
    'Grade 8': [35500, 2500, 2200, 1800],
    'Grade 9': [38000, 3200, 2500, 2300],
    'Grade 10': [42000, 3800, 2800, 2400],
    'Grade 11': [45000, 4200, 3000, 2800],
    'Grade 12': [48000, 4500, 3200, 2800],
  };

  let globalRctSeq = 90000;
  let globalInvSeq = 1000;

  for (const t of tenants) {
    const p = tenantSlugPrefix[t.id];
    const schoolFactor = t.id === 'tenant-oakridge' ? 1 : t.id === 'tenant-westfield' ? 0.92 : 1.08;
    const prefixCode = t.slug.slice(0, 3).toUpperCase();

    const termPeriods: Array<{
      termId: string;
      termLabel: string;
      dueDate: string;
      yearFactor: number;
      isCurrent: boolean;
      yearNum: number;
    }> = [
      // 2024-2025
      { termId: `term-${p}-2024-1`, termLabel: 'Term 1 (2024–2025)', dueDate: '2024-09-20', yearFactor: 0.9, isCurrent: false, yearNum: 2024 },
      { termId: `term-${p}-2024-2`, termLabel: 'Term 2 (2024–2025)', dueDate: '2025-01-20', yearFactor: 0.9, isCurrent: false, yearNum: 2025 },
      { termId: `term-${p}-2024-3`, termLabel: 'Term 3 (2024–2025)', dueDate: '2025-05-19', yearFactor: 0.9, isCurrent: false, yearNum: 2025 },
      // 2025-2026
      { termId: `term-${p}-2025-1`, termLabel: 'Term 1 (2025–2026)', dueDate: '2025-09-19', yearFactor: 0.95, isCurrent: false, yearNum: 2025 },
      { termId: `term-${p}-2025-2`, termLabel: 'Term 2 (2025–2026)', dueDate: '2026-01-19', yearFactor: 0.95, isCurrent: false, yearNum: 2026 },
      { termId: `term-${p}-2025-3`, termLabel: 'Term 3 (2025–2026)', dueDate: '2026-05-18', yearFactor: 0.95, isCurrent: false, yearNum: 2026 },
      // Current 2026-2027 Term 1
      { termId: `term-${p}-1`, termLabel: 'Term 1', dueDate: '2026-09-25', yearFactor: 1, isCurrent: true, yearNum: 2026 },
    ];

    // Seed feeStructures for grades used in each tenant
    const tenantGradesUsed = Array.from(
      new Set(students.filter((s) => s.tenantId === t.id).map((s) => s.grade))
    );

    const feeTotalMap = new Map<string, number>();

    for (const tp of termPeriods) {
      for (const gradeName of tenantGradesUsed) {
        const base = gradeBaseFeeKes[gradeName] || [35000, 2500, 2000, 1500];
        const tuition = Math.round((base[0] * schoolFactor * tp.yearFactor) / 100) * 100;
        const lab = Math.round((base[1] * schoolFactor * tp.yearFactor) / 50) * 50;
        const tech = Math.round((base[2] * schoolFactor * tp.yearFactor) / 50) * 50;
        const act = Math.round((base[3] * schoolFactor * tp.yearFactor) / 50) * 50;
        const total = tuition + lab + tech + act;
        feeTotalMap.set(`${tp.termId}::${gradeName}`, total);

        // Seed fee structures for 2024 Term 1, 2025 Term 1, and current 2026 Term 1
        if (tp.termLabel.startsWith('Term 1')) {
          feeStructures.push({
            id: `fs-${p}-${tp.termId}-${gradeName.toLowerCase().replace(/\s+/g, '')}`,
            tenantId: t.id,
            termId: tp.termId,
            grade: gradeName,
            term: tp.termLabel,
            votelines: buildSeedVotelines(tuition, lab, tech, act),
            tuitionFee: tuition,
            labFee: lab,
            technologyFee: tech,
            activitiesFee: act,
            totalFee: total,
          });
        }
      }
    }

    const tenantStudents = students.filter((s) => s.tenantId === t.id);
    tenantStudents.forEach((stu, stuIdx) => {
      const enrolledIso = stu.enrolledAt;
      termPeriods.forEach((tp, tpIdx) => {
        if (tp.dueDate < enrolledIso) return;
        if (stu.status === 'Graduated') {
          if (stu.statusDate && tp.dueDate > stu.statusDate.slice(0, 10)) return;
          if (tp.isCurrent) return;
        }
        const totalAmount = feeTotalMap.get(`${tp.termId}::${stu.grade}`) || 40000;
        globalInvSeq += 1;
        const invoiceNumber = `${prefixCode}-INV-${tp.yearNum}-${globalInvSeq}`;

        let paidAmount = totalAmount;
        let status: FeeInvoice['status'] = 'Paid';
        const payments: FeeInvoice['payments'] = [];

        if (tp.isCurrent) {
          // Current term realistic mix: Paid, Partial, Overdue, Pending
          const bucket = stuIdx % 5;
          if (bucket === 0 || bucket === 2) {
            paidAmount = totalAmount;
            status = 'Paid';
          } else if (bucket === 1) {
            paidAmount = Math.round((totalAmount * 0.6) / 100) * 100;
            status = 'Partial';
          } else if (bucket === 3) {
            paidAmount = 0;
            status = 'Overdue';
          } else {
            paidAmount = 0;
            status = 'Pending';
          }
        } else if (tpIdx === 5 && stuIdx % 6 === 4) {
          // Small historical carry-over balance on one student in 2025-2026 Term 3
          paidAmount = Math.round((totalAmount * 0.85) / 100) * 100;
          status = 'Partial';
        }

        if (paidAmount > 0) {
          globalRctSeq += 1;
          const method: FeeInvoice['payments'][number]['method'] =
            (stuIdx + tpIdx) % 3 === 0
              ? 'Mobile Money'
              : (stuIdx + tpIdx) % 3 === 1
              ? 'Bank Transfer'
              : 'Card';
          const refPrefix = method === 'Mobile Money' ? 'UJK' : method === 'Bank Transfer' ? 'ACH' : 'VISA';
          const paidDate = tp.isCurrent ? '2026-09-18' : tp.dueDate;
          payments.push({
            id: `pay-${p}-${globalInvSeq}`,
            receiptNumber: `${prefixCode}-RCT-${globalRctSeq}`,
            amount: paidAmount,
            method,
            reference: `${refPrefix}-${globalRctSeq}`,
            paidAt: `${paidDate}T10:${String(10 + (stuIdx % 45)).padStart(2, '0')}:00Z`,
            recordedBy: method === 'Mobile Money' ? `M-Pesa Paybill ${t.mpesaConfig?.paybillNumber}` : 'Bursar Office',
          });

          if (method === 'Mobile Money' && (tp.isCurrent || stuIdx < 40)) {
            mpesaTransactions.push({
              id: `mpesa-${p}-${globalRctSeq}`,
              tenantId: t.id,
              paybillNumber: t.mpesaConfig?.paybillNumber || '522522',
              mpesaReceipt: `UJK${globalRctSeq}P`,
              msisdn: stu.guardianPhone.replace(/\D/g, ''),
              accountReference: stu.studentCode,
              amount: paidAmount,
              studentId: stu.id,
              studentName: stu.fullName,
              invoiceId: `inv-${p}-${globalInvSeq}`,
              invoiceNumber,
              status: 'Settled',
              channel: 'Daraja C2B Webhook',
              note: `Routed via Paybill ${t.mpesaConfig?.paybillNumber} for ${tp.termLabel}`,
              receivedAt: `${paidDate}T10:${String(10 + (stuIdx % 45)).padStart(2, '0')}:00Z`,
            });
          }
        }

        const effectiveDueDate =
          status === 'Pending' ? '2026-11-30' : status === 'Overdue' ? '2026-10-15' : tp.dueDate;

        invoices.push({
          id: `inv-${p}-${globalInvSeq}`,
          tenantId: t.id,
          termId: tp.termId,
          invoiceNumber,
          studentId: stu.id,
          studentName: stu.fullName,
          studentCode: stu.studentCode,
          grade: stu.grade,
          term: tp.termLabel,
          dueDate: effectiveDueDate,
          totalAmount,
          paidAmount,
          balance: Math.max(0, totalAmount - paidAmount),
          status,
          payments,
          createdAt: `${tp.dueDate.slice(0, 8)}05T09:00:00Z`,
        });
      });
    });

    // Seed Waivers / Bursaries across 2024-2026
    const firstStu = tenantStudents[0];
    const secondStu = tenantStudents[1];
    const thirdStu = tenantStudents[2];
    if (firstStu && secondStu && thirdStu) {
      feeWaivers.push(
        {
          id: `wv-${p}-2024-1`,
          tenantId: t.id,
          termId: `term-${p}-2024-1`,
          studentId: thirdStu.id,
          studentName: thirdStu.fullName,
          studentCode: thirdStu.studentCode,
          grade: thirdStu.grade,
          term: 'Term 1 (2024–2025)',
          kind: 'Scholarship',
          mode: 'Percentage',
          value: 15,
          discountAmount: 5500,
          reason: 'Academic Merit Entrance Scholarship (2024)',
          approvedBy: t.mpesaConfig?.updatedBy || 'School Principal',
          createdAt: '2024-09-05T10:00:00Z',
        },
        {
          id: `wv-${p}-2025-1`,
          tenantId: t.id,
          termId: `term-${p}-2025-1`,
          studentId: secondStu.id,
          studentName: secondStu.fullName,
          studentCode: secondStu.studentCode,
          grade: secondStu.grade,
          term: 'Term 1 (2025–2026)',
          kind: 'Bursary',
          mode: 'Fixed',
          value: 6000,
          discountAmount: 6000,
          reason: 'County Education Bursary Allocation (2025)',
          approvedBy: 'School Bursar',
          createdAt: '2025-09-12T11:00:00Z',
        },
        {
          id: `wv-${p}-2026-1`,
          tenantId: t.id,
          termId: `term-${p}-1`,
          studentId: firstStu.id,
          studentName: firstStu.fullName,
          studentCode: firstStu.studentCode,
          grade: firstStu.grade,
          term: 'Term 1',
          kind: 'Sibling Discount',
          mode: 'Percentage',
          value: 10,
          discountAmount: 4200,
          reason: 'Approved 2026–2027 Sibling Tuition Relief',
          approvedBy: 'School Bursar',
          createdAt: '2026-09-08T09:30:00Z',
        }
      );

      independentVotelines.push(
        {
          id: `ivl-${p}-1`,
          tenantId: t.id,
          termId: `term-${p}-1`,
          studentId: firstStu.id,
          studentName: firstStu.fullName,
          studentCode: firstStu.studentCode,
          grade: firstStu.grade,
          term: 'Term 1',
          name: 'Transport Fee',
          amount: 8500,
          paidAmount: 0,
          balance: 8500,
          status: 'Pending',
          note: 'Route A — Morning & Evening School Shuttle',
          payments: [],
          recordedBy: 'Bursar Office',
          createdAt: '2026-09-02T08:30:00Z',
        },
        {
          id: `ivl-${p}-2`,
          tenantId: t.id,
          termId: `term-${p}-1`,
          studentId: secondStu.id,
          studentName: secondStu.fullName,
          studentCode: secondStu.studentCode,
          grade: secondStu.grade,
          term: 'Term 1',
          name: 'Academic Trip Fee',
          amount: 3500,
          paidAmount: 3500,
          balance: 0,
          status: 'Paid',
          note: 'Science & Geothermal Field Excursion',
          payments: [
            {
              id: `ivl-pay-${p}-2`,
              receiptNumber: `${prefixCode}-IVL-201`,
              amount: 3500,
              method: 'Mobile Money',
              reference: `MPESA-TRIP-${p.toUpperCase()}`,
              paidAt: '2026-09-14T11:00:00Z',
              recordedBy: 'Bursar Office',
            },
          ],
          recordedBy: 'Bursar Office',
          createdAt: '2026-09-05T10:15:00Z',
        },
        {
          id: `ivl-${p}-2025-1`,
          tenantId: t.id,
          termId: `term-${p}-2025-2`,
          studentId: thirdStu.id,
          studentName: thirdStu.fullName,
          studentCode: thirdStu.studentCode,
          grade: thirdStu.grade,
          term: 'Term 2 (2025–2026)',
          name: 'School Uniform & Sportswear',
          amount: 6500,
          paidAmount: 6500,
          balance: 0,
          status: 'Paid',
          note: 'Full sports kit & laboratory coat issue (2026 Term 2)',
          payments: [
            {
              id: `ivl-pay-${p}-2025-1`,
              receiptNumber: `${prefixCode}-IVL-108`,
              amount: 6500,
              method: 'Cash',
              reference: `CSH-UNI-${p.toUpperCase()}`,
              paidAt: '2026-01-12T09:30:00Z',
              recordedBy: 'Bursar Office',
            },
          ],
          recordedBy: 'Bursar Office',
          createdAt: '2026-01-10T08:00:00Z',
        }
      );
    }
  }

  // =========================================================================
  // ANNOUNCEMENTS, MESSAGES, WHATSAPP LOGS, NOTIFICATIONS & AUDIT TRAILS
  // =========================================================================
  const announcements: Announcement[] = [
    {
      id: 'ann-oak-1',
      tenantId: 'tenant-oakridge',
      title: 'Term 1 Final Examination Schedule & Room Allocations Published',
      body: 'All Grade 9–12 students and proctors can now review room assignments for the Nov 18–24 examination window. Science practicals take place in Lab B2 and Lab C1.',
      audience: 'All School',
      priority: 'Urgent',
      authorName: 'Dr. Helena Vance',
      authorRole: 'Admin',
      createdAt: '2026-11-13T09:15:00Z',
    },
    {
      id: 'ann-oak-2',
      tenantId: 'tenant-oakridge',
      title: 'Faculty Gradebook Submission Window Opens Monday',
      body: 'Subject leads must finalize Term 1 continuous assessment weights and upload provisional exam marks by 17:00 on November 26.',
      audience: 'Teachers Only',
      priority: 'Normal',
      authorName: 'Academic Dean Office',
      authorRole: 'Admin',
      createdAt: '2026-11-12T14:00:00Z',
    },
    {
      id: 'ann-oak-2025',
      tenantId: 'tenant-oakridge',
      title: '2025–2026 Academic Year Closing Assembly & Transcripts Release',
      body: 'End-of-year report cards and fee statements for 2025–2026 Term 3 have been published to guardian portals.',
      audience: 'Parents & Guardians',
      priority: 'Normal',
      authorName: 'Dr. Helena Vance',
      authorRole: 'Admin',
      createdAt: '2026-07-24T11:00:00Z',
    },
    {
      id: 'ann-west-1',
      tenantId: 'tenant-westfield',
      title: 'STEM Showcase & Robotics Qualifier Logistics',
      body: 'Maker Studio will remain open until 18:00 all week for Grade 9–11 teams preparing coastal robotics prototypes.',
      audience: 'All School',
      priority: 'Normal',
      authorName: 'Elena Morales',
      authorRole: 'Teacher',
      createdAt: '2026-11-12T10:30:00Z',
    },
    {
      id: 'ann-west-2',
      tenantId: 'tenant-westfield',
      title: '2025–2026 Coastal STEM Olympiad Gold Medals & Progression Summary',
      body: 'Westfield Grade 10 and Grade 11 teams secured 4 national qualifiers across the 2025–2026 academic cycle.',
      audience: 'Parents & Guardians',
      priority: 'Normal',
      authorName: 'David Chen',
      authorRole: 'Admin',
      createdAt: '2026-07-22T09:00:00Z',
    },
    {
      id: 'ann-sj-1',
      tenantId: 'tenant-stjude',
      title: 'Term 1 Parent-Tutor Consultation Evenings',
      body: 'Booking slots for Grade 9 and Grade 10 subject reviews are open through the parent portal.',
      audience: 'Parents & Guardians',
      priority: 'Normal',
      authorName: 'Arthur Pendelton',
      authorRole: 'Admin',
      createdAt: '2026-11-11T16:00:00Z',
    },
    {
      id: 'ann-sj-2',
      tenantId: 'tenant-stjude',
      title: 'Cambridge & CBC Hybrid Curriculum Annual Review (2025–2026)',
      body: 'Thank you to all parents and faculty for an outstanding 2025–2026 academic year with 98.4% pass attainment.',
      audience: 'All School',
      priority: 'Normal',
      authorName: 'Arthur Pendelton',
      authorRole: 'Admin',
      createdAt: '2026-07-23T14:30:00Z',
    },
  ];

  const messages: DirectMessage[] = [
    {
      id: 'msg-oak-1',
      tenantId: 'tenant-oakridge',
      channel: 'Staff & Faculty',
      senderName: 'Mr. Kamau Njoroge',
      senderRole: 'Teacher',
      body: 'Science Lab 1 apparatus calibration finished ahead of Monday Period 3 Integrated Science.',
      createdAt: '2026-11-13T16:20:00Z',
    },
    {
      id: 'msg-oak-2',
      tenantId: 'tenant-oakridge',
      channel: 'Staff & Faculty',
      senderName: 'Dr. Helena Vance',
      senderRole: 'Admin',
      body: 'Thank you Kamau. Please verify morning roll-call is submitted before 09:30.',
      createdAt: '2026-11-13T16:45:00Z',
    },
    {
      id: 'msg-oak-3',
      tenantId: 'tenant-oakridge',
      channel: 'Admissions & Registrar',
      senderName: 'Grace Admissions',
      senderRole: 'Registrar',
      body: 'Elena Vance-Moreau has completed medical clearance. Only seat deposit remains before enrollment.',
      createdAt: '2026-11-14T08:10:00Z',
    },
    {
      id: 'msg-west-1',
      tenantId: 'tenant-westfield',
      channel: 'Staff & Faculty',
      senderName: 'David Chen',
      senderRole: 'Admin',
      body: 'Core Mathematics mock grading rubric uploaded for Grade 10.',
      createdAt: '2026-11-13T15:00:00Z',
    },
    {
      id: 'msg-west-2',
      tenantId: 'tenant-westfield',
      channel: 'Finance & Bursar',
      senderName: 'Elena Morales',
      senderRole: 'Bursar',
      body: '2025–2026 Term 3 fee arrears carry-forward statements reconciled across all grades.',
      createdAt: '2026-11-14T09:15:00Z',
    },
    {
      id: 'msg-sj-1',
      tenantId: 'tenant-stjude',
      channel: 'Staff & Faculty',
      senderName: 'Priya Nair',
      senderRole: 'Teacher',
      body: 'Grade 9 & 10 English Literature essays reviewed ahead of End of Term window.',
      createdAt: '2026-11-13T13:40:00Z',
    },
    {
      id: 'msg-sj-2',
      tenantId: 'tenant-stjude',
      channel: 'Finance & Bursar',
      senderName: 'Beatrice Anyango',
      senderRole: 'Bursar',
      body: 'Stanbic KES fee collection batch matched against November M-Pesa Paybill 522566 receipts.',
      createdAt: '2026-11-14T10:05:00Z',
    },
  ];

  const whatsappDispatches: WhatsAppDispatchRecord[] = [
    {
      id: 'wa-oak-1',
      tenantId: 'tenant-oakridge',
      category: 'Report Card',
      studentId: 'stu-oak-1',
      studentName: 'Wanjiku Kamau',
      guardianName: 'Grace Kamau',
      guardianPhone: '+254 712 345 678',
      referenceLabel: 'Term 1 Mid-Term Exam',
      messagePreview: 'Academic report card shared for Wanjiku Kamau (Grade 9 A).',
      sentBy: 'Dr. Helena Vance',
      sentAt: '2026-10-22T14:30:00Z',
    },
    {
      id: 'wa-west-1',
      tenantId: 'tenant-westfield',
      category: 'Report Card',
      studentId: 'stu-west-1',
      studentName: 'Dennis Mwangi',
      guardianName: 'James Mwangi',
      guardianPhone: '+254 721 319 408',
      referenceLabel: 'Term 1 Mid-Term Exam',
      messagePreview: 'Academic report card shared for Dennis Mwangi (Grade 9 A).',
      sentBy: 'David Chen',
      sentAt: '2026-10-25T11:15:00Z',
    },
    {
      id: 'wa-sj-1',
      tenantId: 'tenant-stjude',
      category: 'Fee Balance Reminder',
      studentId: 'stu-sj-4',
      studentName: 'Valerie Adhiambo',
      guardianName: 'Pamela Adhiambo',
      guardianPhone: '+254 727 608 441',
      referenceLabel: 'Term 1 Tuition Balance',
      messagePreview: 'Fee reminder sent via Paybill 522566 for Valerie Adhiambo.',
      sentBy: 'Beatrice Anyango',
      sentAt: '2026-11-10T09:45:00Z',
    },
  ];

  const notifications: NotificationItem[] = [
    {
      id: 'notif-oak-1',
      tenantId: 'tenant-oakridge',
      category: 'admission',
      title: 'Application Approved: Elena Vance-Moreau',
      description: 'APP-2026-104 cleared all academic & medical checks for Grade 9 A.',
      targetModule: 'admissions',
      read: false,
      createdAt: '2026-11-14T07:50:00Z',
    },
    {
      id: 'notif-oak-2',
      tenantId: 'tenant-oakridge',
      category: 'fee',
      title: 'Overdue Tuition Alert: Kiprop Chebet',
      description: 'Term 1 tuition balance requires follow-up with guardian.',
      targetModule: 'fees',
      read: false,
      createdAt: '2026-11-13T17:15:00Z',
    },
    {
      id: 'notif-oak-3',
      tenantId: 'tenant-oakridge',
      category: 'exam',
      title: 'Mid-Term Assessment Results Published',
      description: 'Term 1 Mid-Term transcripts are live alongside 2024–2026 historical benchmarks.',
      targetModule: 'exams',
      read: true,
      createdAt: '2026-11-12T12:00:00Z',
    },
    {
      id: 'notif-west-1',
      tenantId: 'tenant-westfield',
      category: 'admission',
      title: 'Application Approved: Caleb Washington',
      description: 'WAPP-2026-041 is ready for final Grade 9 enrollment.',
      targetModule: 'admissions',
      read: false,
      createdAt: '2026-11-13T11:30:00Z',
    },
    {
      id: 'notif-west-2',
      tenantId: 'tenant-westfield',
      category: 'exam',
      title: 'Multi-Year Academic Trend Ready',
      description: '2024–2026 STEM cohort analytics available in Exams & Grades.',
      targetModule: 'exams',
      read: true,
      createdAt: '2026-11-10T09:00:00Z',
    },
    {
      id: 'notif-sj-1',
      tenantId: 'tenant-stjude',
      category: 'announcement',
      title: 'Term 1 Parent-Tutor Bookings Open',
      description: 'Notification sent to all Grade 9 and Grade 10 guardians.',
      targetModule: 'communications',
      read: false,
      createdAt: '2026-11-11T16:05:00Z',
    },
  ];

  const lifecycleAuditLogs: LifecycleAuditEntry[] = [
    {
      id: 'lc-oak-2025',
      tenantId: 'tenant-oakridge',
      timestamp: '2025-07-25T12:00:00Z',
      actorUserId: 'usr-oak-admin',
      who: 'Dr. Helena Vance',
      role: 'Admin',
      action: 'YEAR_END_PROMOTION',
      entity: 'PromotionBatch',
      entityId: 'promo-oak-2025',
      summary: 'Completed 2024–2025 year-end promotion & graduated Grade 12 senior cohort (2 learners).',
      reason: 'Annual Academic Progression 2024–2025 → 2025–2026',
    },
    {
      id: 'lc-oak-2026',
      tenantId: 'tenant-oakridge',
      timestamp: '2026-07-24T12:00:00Z',
      actorUserId: 'usr-oak-admin',
      who: 'Dr. Helena Vance',
      role: 'Admin',
      action: 'YEAR_END_PROMOTION',
      entity: 'PromotionBatch',
      entityId: 'promo-oak-2026',
      summary: 'Completed 2025–2026 year-end promotion & graduated Grade 12 senior cohort (2 learners).',
      reason: 'Annual Academic Progression 2025–2026 → 2026–2027',
    },
    {
      id: 'lc-west-2025',
      tenantId: 'tenant-westfield',
      timestamp: '2025-07-24T12:00:00Z',
      actorUserId: 'usr-west-admin',
      who: 'David Chen',
      role: 'Admin',
      action: 'YEAR_END_PROMOTION',
      entity: 'PromotionBatch',
      entityId: 'promo-west-2025',
      summary: 'Completed 2024–2025 STEM cohort promotion & graduated Grade 12 alumni.',
      reason: 'Annual Academic Progression 2024–2025 → 2025–2026',
    },
    {
      id: 'lc-west-2026',
      tenantId: 'tenant-westfield',
      timestamp: '2026-07-24T12:00:00Z',
      actorUserId: 'usr-west-admin',
      who: 'David Chen',
      role: 'Admin',
      action: 'YEAR_END_PROMOTION',
      entity: 'PromotionBatch',
      entityId: 'promo-west-2026',
      summary: 'Completed 2025–2026 STEM cohort promotion & graduated Grade 12 senior cohort (2 learners).',
      reason: 'Annual Academic Progression 2025–2026 → 2026–2027',
    },
    {
      id: 'lc-sj-2025',
      tenantId: 'tenant-stjude',
      timestamp: '2025-07-24T12:00:00Z',
      actorUserId: 'usr-sj-admin',
      who: 'Arthur Pendelton',
      role: 'Admin',
      action: 'YEAR_END_PROMOTION',
      entity: 'PromotionBatch',
      entityId: 'promo-sj-2025',
      summary: 'Completed 2024–2025 Hybrid cohort promotion & graduated Grade 12 alumni.',
      reason: 'Annual Academic Progression 2024–2025 → 2025–2026',
    },
    {
      id: 'lc-sj-2026',
      tenantId: 'tenant-stjude',
      timestamp: '2026-07-24T12:00:00Z',
      actorUserId: 'usr-sj-admin',
      who: 'Arthur Pendelton',
      role: 'Admin',
      action: 'YEAR_END_PROMOTION',
      entity: 'PromotionBatch',
      entityId: 'promo-sj-2026',
      summary: 'Completed 2025–2026 Hybrid cohort promotion & graduated Grade 12 senior cohort (2 learners).',
      reason: 'Annual Academic Progression 2025–2026 → 2026–2027',
    },
  ];

  const expenses: SchoolExpense[] = tenants.flatMap((t) =>
    buildDefaultExpensesForTenant(
      t.id,
      t.currency,
      t.slug.slice(0, 3).toUpperCase(),
      t.plan === 'Enterprise' ? 12 : 3
    )
  );

  const etimsChecks: EtimsVerificationRecord[] = tenants.flatMap((t) =>
    buildDefaultEtimsChecksForTenant(t.id, t.currency, t.slug.slice(0, 3).toUpperCase())
  );

  const reconciliationLines: ReconciliationLine[] = tenants.flatMap((t) =>
    buildDefaultReconciliationForTenant(t.id, t.currency, t.slug.slice(0, 3).toUpperCase())
  );

  const payrollPeriods = [
    '2024-11',
    '2025-03',
    '2025-07',
    '2025-11',
    '2026-03',
    '2026-07',
    '2026-10',
    '2026-11',
  ];
  const payrollEntries: PayrollEntry[] = tenants.flatMap((t) =>
    payrollPeriods.flatMap((period) =>
      buildDefaultPayrollForTenant(t, period, DEFAULT_STATUTORY_RATE_SCHEDULES)
    )
  );

  const budgets: BudgetAllocation[] = tenants.flatMap((t) => buildDefaultBudgetsForTenant(t));

  const approvalRecords: ApprovalSignOffRecord[] = tenants.flatMap((t) =>
    buildDefaultApprovalsForTenant(t.id, t.currency, t.slug.slice(0, 3).toUpperCase())
  );

  const { users, devCredentials } = await buildSeedUsers();

  return {
    devCredentials,
    state: {
      tenants,
      users,
      academicYears,
      academicTerms,
      mpesaWebhookHashes: {
        'tenant-oakridge': hashWebhook(oakWebhookSecret),
        'tenant-westfield': hashWebhook(westWebhookSecret),
        'tenant-stjude': hashWebhook(sjWebhookSecret),
      },
      mpesaTransactions,
      students,
      admissions,
      timetable,
      attendance,
      staffAttendance,
      leaveOutChits,
      examCycles,
      examResults,
      feeStructures,
      invoices,
      creditNotes,
      feeWaivers,
      independentVotelines,
      expenses,
      etimsChecks,
      reconciliationLines,
      payrollEntries,
      budgets,
      approvalRecords,
      financeAuditLogs: [],
      statutoryRateSchedules: DEFAULT_STATUTORY_RATE_SCHEDULES.map((s) => ({
        ...s,
        payeBands: s.payeBands.map((b) => ({ ...b })),
      })),
      receiptCounters: {
        'tenant-oakridge': globalRctSeq + 10,
        'tenant-westfield': globalRctSeq + 10,
        'tenant-stjude': globalRctSeq + 10,
      },
      studentCounters: {
        'tenant-oakridge': 12000,
        'tenant-westfield': 12000,
        'tenant-stjude': 12000,
      },
      invoiceCounters: {
        'tenant-oakridge': globalInvSeq + 10,
        'tenant-westfield': globalInvSeq + 10,
        'tenant-stjude': globalInvSeq + 10,
      },
      admissionCounters: {
        'tenant-oakridge': 120,
        'tenant-westfield': 120,
        'tenant-stjude': 120,
      },
      voucherCounters: {
        'tenant-oakridge': 202620,
        'tenant-westfield': 202620,
        'tenant-stjude': 202620,
      },
      creditNoteCounters: {},
      announcements,
      messages,
      whatsappDispatches,
      notifications,
      adminAuditLogs: [],
      lifecycleAuditLogs,
    },
  };
}
