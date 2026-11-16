import {
  buildDefaultLevelSubjectsMap,
  buildDefaultLevelWeeklyLessonsMap,
  computeAssessmentGrade,
  DEFAULT_SUBJECT_WEEKLY_LESSONS,
  EXPENSE_CATEGORIES,
  KENYAN_BELL_SCHEDULE,
  KENYAN_CBC_GRADES,
  KENYAN_CBC_SUBJECTS,
  type AdminAuditEntry,
  type AdmissionApplication,
  type Announcement,
  type ApprovalSignOffRecord,
  type AttendanceRecord,
  type BudgetAllocation,
  type DayOfWeek,
  type DirectMessage,
  type EtimsVerificationRecord,
  type ExamCycle,
  type ExamResult,
  type FeeInvoice,
  type FeeStructure,
  type FeeVoteline,
  type LeaveOutChit,
  type NonTeachingStaffProfile,
  type NotificationItem,
  type PayrollEntry,
  type ReconciliationLine,
  type SchoolExpense,
  type StaffAttendanceRecord,
  type Student,
  type Tenant,
  type TimetableSlot,
  type WhatsAppDispatchRecord,
} from '../src/shared/types.ts';

export function buildDefaultNonTeachingStaff(
  slug: string,
  idPrefix = slug.slice(0, 4)
): NonTeachingStaffProfile[] {
  return [
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
}

export interface DatabaseState {
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
  adminAuditLogs: AdminAuditEntry[];
}

export function buildDefaultExpensesForTenant(
  tenantId: string,
  currency: 'KES' | 'USD',
  prefix: string
): SchoolExpense[] {
  const isKes = currency === 'KES';
  const mult = isKes ? 120 : 1;
  return [
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
      notes: 'Chemistry & Biology Grade 9-12 practical consumables.',
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
      notes: 'Dry grains, dairy, and produce batch delivery.',
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
      notes: 'Scheduled 15,000 km brake & oil service plus diesel refill.',
      etimsStatus: 'Unverified',
      createdAt: '2026-11-14T08:45:00Z',
    },
  ];
}

export function computeStatutoryDeductions(grossPay: number, currency: 'KES' | 'USD') {
  const gross = Math.max(0, Math.round(grossPay));
  if (currency === 'USD') {
    // Scaled international tax/social withholding approximation for USD campuses
    const paye = Math.round(gross * 0.14);
    const nssf = Math.round(gross * 0.04);
    const shif = Math.round(gross * 0.025);
    const housingLevy = Math.round(gross * 0.015);
    return { paye, nssf, shif, housingLevy };
  }

  // Kenya KRA PAYE progressive monthly bands + Personal Relief (KES 2,400)
  const nssf = Math.min(4320, Math.round(gross * 0.06));
  const shif = Math.max(300, Math.round(gross * 0.0275));
  const housingLevy = Math.round(gross * 0.015);
  const taxable = Math.max(0, gross - nssf);

  let tax = 0;
  let rem = taxable;
  const band1 = Math.min(rem, 24000);
  tax += band1 * 0.1;
  rem -= band1;
  if (rem > 0) {
    const band2 = Math.min(rem, 8333);
    tax += band2 * 0.25;
    rem -= band2;
  }
  if (rem > 0) {
    const band3 = Math.min(rem, 467667);
    tax += band3 * 0.3;
    rem -= band3;
  }
  if (rem > 0) {
    const band4 = Math.min(rem, 300000);
    tax += band4 * 0.325;
    rem -= band4;
  }
  if (rem > 0) {
    tax += rem * 0.35;
  }
  const paye = Math.max(0, Math.round(tax - 2400));
  return { paye, nssf, shif, housingLevy };
}

export function buildDefaultEtimsChecksForTenant(
  tenantId: string,
  currency: 'KES' | 'USD',
  prefix: string
): EtimsVerificationRecord[] {
  const isKes = currency === 'KES';
  const mult = isKes ? 120 : 1;
  const total1 = 650 * mult;
  const taxable1 = Math.round(total1 / 1.16);
  const vat1 = total1 - taxable1;

  const total2 = 1200 * mult;
  const taxable2 = Math.round(total2 / 1.16);
  const vat2 = total2 - taxable2;

  return [
    {
      id: `etims-${tenantId}-1`,
      tenantId,
      expenseId: `exp-${tenantId}-1`,
      voucherNumber: `${prefix}-EXP-202601`,
      supplierName: 'AfriLab Scientific Supplies Ltd',
      supplierKraPin: 'P051482910K',
      cuInvoiceNumber: `KRAMW012026${prefix.slice(0, 2)}0184`,
      receiptDate: '2026-11-04',
      taxableAmount: taxable1,
      vatAmount: vat1,
      totalAmount: total1,
      status: 'Verified',
      verificationNotes: 'CU serial & supplier KRA PIN verified against KRA eTIMS format.',
      checkedBy: 'Bursar Office',
      checkedAt: '2026-11-04T10:10:00Z',
    },
    {
      id: `etims-${tenantId}-2`,
      tenantId,
      expenseId: `exp-${tenantId}-2`,
      voucherNumber: `${prefix}-EXP-202602`,
      supplierName: 'Highland Fresh Produce Co.',
      supplierKraPin: 'P051993044M',
      cuInvoiceNumber: `KRAMW012026${prefix.slice(0, 2)}0299`,
      receiptDate: '2026-11-08',
      taxableAmount: taxable2,
      vatAmount: vat2,
      totalAmount: total2,
      status: 'Verified',
      verificationNotes: 'Zero-rated & standard rated farm produce tax invoice validated.',
      checkedBy: 'Accounts Office',
      checkedAt: '2026-11-08T13:05:00Z',
    },
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
      narration: 'MPESA FEE COLLECTION - TERM 1',
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
  ];
}

export function buildDefaultPayrollForTenant(
  tenant: Tenant,
  payPeriod = '2026-11'
): PayrollEntry[] {
  const isKes = tenant.currency === 'KES';
  const entries: PayrollEntry[] = [];

  tenant.teachers.forEach((teacher, idx) => {
    const basicSalary = isKes ? 58000 + idx * 4500 : 1800 + idx * 140;
    const allowances = isKes ? 9500 : 280;
    const grossPay = basicSalary + allowances;
    const { paye, nssf, shif, housingLevy } = computeStatutoryDeductions(grossPay, tenant.currency);
    const saccoOrLoan = isKes ? (idx % 2 === 0 ? 3500 : 0) : idx % 2 === 0 ? 80 : 0;
    const totalDeductions = paye + nssf + shif + housingLevy + saccoOrLoan;
    entries.push({
      id: `payr-${tenant.id}-t-${idx + 1}`,
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
      status: 'Approved',
      updatedAt: '2026-11-14T10:00:00Z',
    });
  });

  (tenant.nonTeachingStaff || []).forEach((staff, idx) => {
    const basicSalary = isKes ? 34000 + idx * 3500 : 1050 + idx * 90;
    const allowances = isKes ? 5000 : 150;
    const grossPay = basicSalary + allowances;
    const { paye, nssf, shif, housingLevy } = computeStatutoryDeductions(grossPay, tenant.currency);
    const saccoOrLoan = isKes && idx === 0 ? 2500 : 0;
    const totalDeductions = paye + nssf + shif + housingLevy + saccoOrLoan;
    entries.push({
      id: `payr-${tenant.id}-n-${idx + 1}`,
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
      status: 'Draft',
      updatedAt: '2026-11-14T10:00:00Z',
    });
  });

  return entries;
}

export function buildDefaultBudgetsForTenant(tenant: Tenant): BudgetAllocation[] {
  const isKes = tenant.currency === 'KES';
  const scale = isKes ? 1 : 0.008;
  const baseAmounts: Record<(typeof EXPENSE_CATEGORIES)[number], number> = {
    'Payroll & Allowances': Math.round(750000 * scale),
    'Utilities & Water': Math.round(95000 * scale),
    'Catering & Boarding': Math.round(280000 * scale),
    'Teaching & Lab Supplies': Math.round(140000 * scale),
    'Maintenance & Repairs': Math.round(110000 * scale),
    'Transport & Fuel': Math.round(90000 * scale),
    'ICT & Software': Math.round(75000 * scale),
    'Administration & Statutory': Math.round(85000 * scale),
  };

  return EXPENSE_CATEGORIES.map((category, idx) => ({
    id: `bdg-${tenant.id}-${idx + 1}`,
    tenantId: tenant.id,
    fiscalYear: tenant.academicYear || '2026–2027',
    term: tenant.currentTerm || 'Term 1',
    category,
    allocatedAmount: Math.max(100, baseAmounts[category]),
    notes: `${tenant.currentTerm} departmental ceiling`,
    updatedAt: '2026-11-01T08:00:00Z',
  }));
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
      secretaryName: 'Dr. Helena Vance (Principal)',
      bursarName: 'Mary Wanjiru (School Bursar)',
      decision: 'Approved',
      remarks: 'Awarded to lowest evaluated compliant bidder AfriLab Scientific.',
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
      secretaryName: 'Dr. Helena Vance (Principal)',
      bursarName: 'Mary Wanjiru (School Bursar)',
      decision: 'Pending Sign-Off',
      remarks: 'Awaiting Finance Sub-Committee counter-signature before disbursement.',
      createdAt: '2026-11-15T09:00:00Z',
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

export function createSeedDatabase(): DatabaseState {
  const tenants: Tenant[] = [
    {
      id: 'tenant-oakridge',
      name: 'Oakridge Preparatory Academy',
      slug: 'oakridge-prep',
      curriculum: 'Kenyan CBC (Playgroup – Grade 12)',
      academicYear: '2026–2027',
      currentTerm: 'Term 1',
      currency: 'KES',
      plan: 'Enterprise',
      status: 'Active',
      location: 'Nairobi, KE',
      branding: {
        primaryColor: '#2563EB',
        accentColor: '#0284C7',
        sidebarColor: '',
        logoDataUrl: '',
        tagline: 'Excellence & Integrity in CBC Learning',
      },
      grades: [...KENYAN_CBC_GRADES],
      sections: ['A', 'B', 'C'],
      gradeStreams: buildSeedGradeStreams({
        Playgroup: ['A'],
        'Grade 9': ['A', 'B', 'C'],
        'Grade 12': ['A'],
      }),
      subjects: [...KENYAN_CBC_SUBJECTS],
      subjectWeeklyLessons: { ...DEFAULT_SUBJECT_WEEKLY_LESSONS },
      levelSubjects: buildDefaultLevelSubjectsMap(),
      levelSubjectWeeklyLessons: buildDefaultLevelWeeklyLessonsMap(),
      rooms: ['Room 101', 'Room 104', 'Science Lab 1', 'ICT Lab', 'Hall 202', 'Field & Studio'],
      teachers: [
        {
          id: 't-oak-1',
          name: 'Mr. Kamau Njoroge',
          email: 'k.njoroge@oakridge.ac.ke',
          phone: '+254 712 408 112',
          department: 'Mathematics & Tech',
          subjects: [
            'Mathematics',
            'Core Mathematics',
            'Pre-Technical Studies',
            'Physics',
            'Business Studies',
          ],
          assignedClasses: [],
        },
        {
          id: 't-oak-2',
          name: 'Mrs. Achieng Odhiambo',
          email: 'a.odhiambo@oakridge.ac.ke',
          phone: '+254 722 619 304',
          department: 'Sciences & Agriculture',
          subjects: [
            'Integrated Science',
            'Science & Technology',
            'Agriculture & Nutrition',
            'Biology',
            'Chemistry',
          ],
          assignedClasses: [],
        },
        {
          id: 't-oak-3',
          name: 'Ms. Chebet Kiprono',
          email: 'c.kiprono@oakridge.ac.ke',
          phone: '+254 733 845 219',
          department: 'Languages & Arts',
          subjects: [
            'English',
            'Creative Arts',
            'Creative Arts & Sports',
            'Physical Education (PE)',
          ],
          assignedClasses: [],
        },
        {
          id: 't-oak-4',
          name: 'Mr. Mutua Musyoka',
          email: 'm.musyoka@oakridge.ac.ke',
          phone: '+254 714 902 551',
          department: 'Languages & CRE',
          subjects: [
            'Kiswahili',
            'Religious Education (CRE / IRE / HRE)',
            'Community Service Learning (CSL)',
          ],
          assignedClasses: [],
        },
        {
          id: 't-oak-5',
          name: 'Mrs. Wambui Mwangi',
          email: 'w.mwangi@oakridge.ac.ke',
          phone: '+254 720 337 489',
          department: 'Humanities & ICT',
          subjects: [
            'Social Studies',
            'Computer Studies',
            'History & Citizenship',
            'Geography',
          ],
          assignedClasses: [],
        },
      ],
      nonTeachingStaff: buildDefaultNonTeachingStaff('oakridge', 'oak'),
      createdAt: '2025-08-12T09:00:00Z',
    },
    {
      id: 'tenant-westfield',
      name: 'Westfield STEM High',
      slug: 'westfield-stem',
      curriculum: 'Kenyan CBC STEM Track',
      academicYear: '2026–2027',
      currentTerm: 'Term 1',
      currency: 'KES',
      plan: 'Growth',
      status: 'Active',
      location: 'Mombasa, KE',
      branding: {
        primaryColor: '#059669',
        accentColor: '#0D9488',
        sidebarColor: '#062C22',
        logoDataUrl: '',
        tagline: 'STEM Innovation & Coastal Leadership',
      },
      grades: [...KENYAN_CBC_GRADES],
      sections: ['A', 'B'],
      gradeStreams: buildSeedGradeStreams({
        Playgroup: ['A'],
        'Grade 12': ['A'],
      }),
      subjects: [
        'AP Calculus AB',
        'AP Biology',
        'Engineering Design',
        'US History',
        'English Composition',
      ],
      rooms: ['STEM 101', 'Bio Lab 1', 'Maker Studio', 'Room 210'],
      teachers: [
        { id: 't-west-1', name: 'David Chen', email: 'd.chen@westfield.edu', phone: '+254 711 204 510', department: 'Mathematics', subjects: ['AP Calculus AB'], assignedClasses: [] },
        { id: 't-west-2', name: 'Elena Morales', email: 'e.morales@westfield.edu', phone: '+254 722 308 614', department: 'Engineering', subjects: ['Engineering Design'], assignedClasses: [] },
        { id: 't-west-3', name: 'Rachel Foster', email: 'r.foster@westfield.edu', phone: '+254 733 419 725', department: 'Biology', subjects: ['AP Biology'], assignedClasses: [] },
        { id: 't-west-4', name: 'Trevor Brooks', email: 't.brooks@westfield.edu', phone: '+254 718 527 836', department: 'Humanities', subjects: ['US History', 'English Composition'], assignedClasses: [] },
      ],
      nonTeachingStaff: buildDefaultNonTeachingStaff('westfield', 'west'),
      createdAt: '2026-01-18T11:30:00Z',
    },
    {
      id: 'tenant-stjude',
      name: 'St. Jude International School',
      slug: 'st-jude-intl',
      curriculum: 'Cambridge & CBC Hybrid',
      academicYear: '2026–2027',
      currentTerm: 'Term 1',
      currency: 'USD',
      plan: 'Enterprise',
      status: 'Active',
      location: 'Kisumu, KE',
      branding: {
        primaryColor: '#9F1239',
        accentColor: '#D97706',
        sidebarColor: '#2A0B14',
        logoDataUrl: '',
        tagline: 'Global Perspectives, Rooted Values',
      },
      grades: [...KENYAN_CBC_GRADES],
      sections: ['A', 'B'],
      gradeStreams: buildSeedGradeStreams({
        Playgroup: ['A'],
        'Grade 12': ['A'],
      }),
      subjects: [
        'Further Mathematics',
        'Economics',
        'Physics IGCSE',
        'English Language',
        'Modern Languages',
      ],
      rooms: ['North Wing 1', 'North Wing 2', 'Science Block 3', 'Lecture Hall'],
      teachers: [
        { id: 't-sj-1', name: 'Arthur Pendelton', email: 'a.pendelton@stjude.ac.uk', phone: '+254 715 630 142', department: 'Mathematics', subjects: ['Further Mathematics'], assignedClasses: [] },
        { id: 't-sj-2', name: 'Priya Nair', email: 'p.nair@stjude.ac.uk', phone: '+254 726 741 253', department: 'Economics', subjects: ['Economics', 'English Language'], assignedClasses: [] },
        { id: 't-sj-3', name: 'Oliver Grant', email: 'o.grant@stjude.ac.uk', phone: '+254 737 852 364', department: 'Physics', subjects: ['Physics IGCSE', 'Modern Languages'], assignedClasses: [] },
      ],
      nonTeachingStaff: buildDefaultNonTeachingStaff('stjude', 'sj'),
      createdAt: '2026-03-04T08:15:00Z',
    },
  ];

  const students: Student[] = [
    // Oakridge Grade 9 A
    {
      id: 'stu-oak-1',
      tenantId: 'tenant-oakridge',
      studentCode: 'ADM-2601',
      upi: 'KE-8841029A',
      fullName: 'Wanjiku Kamau',
      grade: 'Grade 9',
      section: 'A',
      guardianName: 'Grace Kamau',
      guardianEmail: 'grace.kamau@example.co.ke',
      guardianPhone: '+254 712 345 678',
      gender: 'Female',
      dateOfBirth: '2012-03-14',
      enrolledAt: '2026-08-24',
      status: 'Active',
    },
    {
      id: 'stu-oak-2',
      tenantId: 'tenant-oakridge',
      studentCode: 'ADM-2602',
      upi: 'KE-8841030B',
      fullName: 'Brian Ochieng',
      grade: 'Grade 9',
      section: 'A',
      guardianName: 'Charles Ochieng',
      guardianEmail: 'c.ochieng@example.co.ke',
      guardianPhone: '+254 722 891 045',
      gender: 'Male',
      dateOfBirth: '2012-07-22',
      enrolledAt: '2026-08-24',
      status: 'Active',
    },
    {
      id: 'stu-oak-3',
      tenantId: 'tenant-oakridge',
      studentCode: 'ADM-2603',
      upi: 'KE-8841031C',
      fullName: 'Amina Mohamed',
      grade: 'Grade 9',
      section: 'A',
      guardianName: 'Hassan Mohamed',
      guardianEmail: 'h.mohamed@example.co.ke',
      guardianPhone: '+254 733 412 908',
      gender: 'Female',
      dateOfBirth: '2012-01-09',
      enrolledAt: '2026-08-25',
      status: 'Active',
    },
    {
      id: 'stu-oak-4',
      tenantId: 'tenant-oakridge',
      studentCode: 'ADM-2604',
      upi: 'KE-8841032D',
      fullName: 'Kiprop Chebet',
      grade: 'Grade 9',
      section: 'A',
      guardianName: 'Peter Chebet',
      guardianEmail: 'p.chebet@example.co.ke',
      guardianPhone: '+254 714 550 219',
      gender: 'Male',
      dateOfBirth: '2011-11-30',
      enrolledAt: '2026-08-25',
      status: 'Active',
    },
    // Oakridge Grade 10 A & B
    {
      id: 'stu-oak-5',
      tenantId: 'tenant-oakridge',
      studentCode: 'ADM-2501',
      upi: 'KE-7732011E',
      fullName: 'Faith Muthoni',
      grade: 'Grade 10',
      section: 'A',
      guardianName: 'Margaret Muthoni',
      guardianEmail: 'm.muthoni@example.co.ke',
      guardianPhone: '+254 720 678 134',
      gender: 'Female',
      dateOfBirth: '2011-05-19',
      enrolledAt: '2025-09-01',
      status: 'Active',
    },
    {
      id: 'stu-oak-6',
      tenantId: 'tenant-oakridge',
      studentCode: 'ADM-2502',
      upi: 'KE-7732012F',
      fullName: 'Kevin Otieno',
      grade: 'Grade 10',
      section: 'A',
      guardianName: 'George Otieno',
      guardianEmail: 'g.otieno@example.co.ke',
      guardianPhone: '+254 718 902 411',
      gender: 'Male',
      dateOfBirth: '2011-02-04',
      enrolledAt: '2025-09-01',
      status: 'Active',
    },
    {
      id: 'stu-oak-7',
      tenantId: 'tenant-oakridge',
      studentCode: 'ADM-2503',
      upi: 'KE-7732013G',
      fullName: 'Chepkoech Kosgei',
      grade: 'Grade 10',
      section: 'A',
      guardianName: 'Sarah Kosgei',
      guardianEmail: 's.kosgei@example.co.ke',
      guardianPhone: '+254 725 334 890',
      gender: 'Female',
      dateOfBirth: '2011-08-12',
      enrolledAt: '2025-09-02',
      status: 'Active',
    },
    {
      id: 'stu-oak-8',
      tenantId: 'tenant-oakridge',
      studentCode: 'ADM-2504',
      upi: 'KE-7732014H',
      fullName: 'David Njoroge',
      grade: 'Grade 10',
      section: 'B',
      guardianName: 'Paul Njoroge',
      guardianEmail: 'p.njoroge@example.co.ke',
      guardianPhone: '+254 711 774 502',
      gender: 'Male',
      dateOfBirth: '2011-06-27',
      enrolledAt: '2025-09-02',
      status: 'Active',
    },
    // Oakridge Grade 11 A
    {
      id: 'stu-oak-9',
      tenantId: 'tenant-oakridge',
      studentCode: 'ADM-2401',
      upi: 'KE-6621094J',
      fullName: 'Mercy Akinyi',
      grade: 'Grade 11',
      section: 'A',
      guardianName: 'Beatrice Akinyi',
      guardianEmail: 'b.akinyi@example.co.ke',
      guardianPhone: '+254 728 456 912',
      gender: 'Female',
      dateOfBirth: '2010-04-11',
      enrolledAt: '2024-09-01',
      status: 'Active',
    },
    {
      id: 'stu-oak-10',
      tenantId: 'tenant-oakridge',
      studentCode: 'ADM-2402',
      upi: 'KE-6621095K',
      fullName: 'Samuel Kipchoge',
      grade: 'Grade 11',
      section: 'A',
      guardianName: 'Daniel Kipchoge',
      guardianEmail: 'd.kipchoge@example.co.ke',
      guardianPhone: '+254 716 203 785',
      gender: 'Male',
      dateOfBirth: '2010-09-03',
      enrolledAt: '2024-09-01',
      status: 'Active',
    },
    {
      id: 'stu-oak-11',
      tenantId: 'tenant-oakridge',
      studentCode: 'ADM-2605',
      upi: 'KE-8841039L',
      fullName: 'Zawadi Wambua',
      grade: 'Playgroup',
      section: 'A',
      guardianName: 'Joyce Wambua',
      guardianEmail: 'j.wambua@example.co.ke',
      guardianPhone: '+254 724 118 902',
      gender: 'Female',
      dateOfBirth: '2022-04-12',
      enrolledAt: '2026-01-12',
      status: 'Active',
    },
    {
      id: 'stu-oak-12',
      tenantId: 'tenant-oakridge',
      studentCode: 'ADM-2606',
      upi: 'KE-8841040M',
      fullName: 'Baraka Mutiso',
      grade: 'PP1',
      section: 'B',
      guardianName: 'Stephen Mutiso',
      guardianEmail: 's.mutiso@example.co.ke',
      guardianPhone: '+254 713 908 441',
      gender: 'Male',
      dateOfBirth: '2021-08-19',
      enrolledAt: '2026-01-14',
      status: 'Active',
    },
    {
      id: 'stu-oak-13',
      tenantId: 'tenant-oakridge',
      studentCode: 'ADM-2301',
      upi: 'KE-5519022N',
      fullName: 'Imani Nyambura',
      grade: 'Grade 12',
      section: 'A',
      guardianName: 'Catherine Nyambura',
      guardianEmail: 'c.nyambura@example.co.ke',
      guardianPhone: '+254 729 551 034',
      gender: 'Female',
      dateOfBirth: '2009-02-28',
      enrolledAt: '2024-01-15',
      status: 'Active',
    },
    // Westfield STEM High
    {
      id: 'stu-west-1',
      tenantId: 'tenant-westfield',
      studentCode: 'ADM-2601',
      upi: 'KE-9910421M',
      fullName: 'Dennis Mwangi',
      grade: 'Grade 9',
      section: 'A',
      guardianName: 'James Mwangi',
      guardianEmail: 'j.mwangi@example.co.ke',
      guardianPhone: '+254 721 319 408',
      gender: 'Male',
      dateOfBirth: '2012-02-15',
      enrolledAt: '2026-08-20',
      status: 'Active',
    },
    {
      id: 'stu-west-2',
      tenantId: 'tenant-westfield',
      studentCode: 'ADM-2602',
      upi: 'KE-9910422N',
      fullName: 'Esther Wambui',
      grade: 'Grade 9',
      section: 'A',
      guardianName: 'Lucy Wambui',
      guardianEmail: 'l.wambui@example.co.ke',
      guardianPhone: '+254 734 610 227',
      gender: 'Female',
      dateOfBirth: '2012-06-08',
      enrolledAt: '2026-08-20',
      status: 'Active',
    },
    {
      id: 'stu-west-3',
      tenantId: 'tenant-westfield',
      studentCode: 'ADM-2501',
      upi: 'KE-9910308P',
      fullName: 'Victor Mutua',
      grade: 'Grade 10',
      section: 'A',
      guardianName: 'Joseph Mutua',
      guardianEmail: 'j.mutua@example.co.ke',
      guardianPhone: '+254 719 882 154',
      gender: 'Male',
      dateOfBirth: '2011-03-21',
      enrolledAt: '2025-08-22',
      status: 'Active',
    },
    // St. Jude International
    {
      id: 'stu-sj-1',
      tenantId: 'tenant-stjude',
      studentCode: 'ADM-2601',
      upi: 'KE-5501920R',
      fullName: 'Sharon Njeri',
      grade: 'Grade 9',
      section: 'A',
      guardianName: 'Rose Njeri',
      guardianEmail: 'r.njeri@example.co.ke',
      guardianPhone: '+254 723 445 810',
      gender: 'Female',
      dateOfBirth: '2012-05-11',
      enrolledAt: '2026-09-02',
      status: 'Active',
    },
    {
      id: 'stu-sj-2',
      tenantId: 'tenant-stjude',
      studentCode: 'ADM-2602',
      upi: 'KE-5501921S',
      fullName: 'Collins Barasa',
      grade: 'Grade 10',
      section: 'A',
      guardianName: 'Patrick Barasa',
      guardianEmail: 'p.barasa@example.co.ke',
      guardianPhone: '+254 710 924 361',
      gender: 'Male',
      dateOfBirth: '2011-10-04',
      enrolledAt: '2025-09-04',
      status: 'Active',
    },
  ];

  const admissions: AdmissionApplication[] = [
    {
      id: 'adm-oak-1',
      tenantId: 'tenant-oakridge',
      applicationCode: 'APP-2026-104',
      studentName: 'Elena Vance-Moreau',
      dateOfBirth: '2012-04-18',
      gender: 'Female',
      targetGrade: 'Grade 9',
      assignedSection: 'A',
      guardianName: 'Jean-Luc Moreau',
      guardianEmail: 'jl.moreau@example.com',
      guardianPhone: '+1 (617) 555-0412',
      previousSchool: 'Cambridge Friends School',
      stage: 'Approved',
      checklist: {
        birthCertificate: true,
        transcripts: true,
        medicalClearance: true,
        guardianId: true,
        depositPaid: false,
      },
      notes: 'Strong math olympiad portfolio; awaiting seat deposit confirmation.',
      submittedAt: '2026-10-28T14:20:00Z',
      updatedAt: '2026-11-12T09:45:00Z',
    },
    {
      id: 'adm-oak-2',
      tenantId: 'tenant-oakridge',
      applicationCode: 'APP-2026-105',
      studentName: 'Mateo Silva',
      dateOfBirth: '2011-09-12',
      gender: 'Male',
      targetGrade: 'Grade 10',
      assignedSection: 'B',
      guardianName: 'Beatriz Silva',
      guardianEmail: 'b.silva@example.com',
      guardianPhone: '+1 (617) 555-0477',
      previousSchool: 'Brookline Latin Annex',
      stage: 'Interview',
      checklist: {
        birthCertificate: true,
        transcripts: true,
        medicalClearance: false,
        guardianId: true,
        depositPaid: false,
      },
      notes: 'Family interview scheduled with Admissions Committee for Nov 18.',
      submittedAt: '2026-11-03T10:15:00Z',
      updatedAt: '2026-11-11T16:00:00Z',
    },
    {
      id: 'adm-oak-3',
      tenantId: 'tenant-oakridge',
      applicationCode: 'APP-2026-106',
      studentName: 'Aria Kowalski',
      dateOfBirth: '2012-01-25',
      gender: 'Female',
      targetGrade: 'Grade 9',
      assignedSection: 'B',
      guardianName: 'Piotr Kowalski',
      guardianEmail: 'p.kowalski@example.com',
      guardianPhone: '+1 (617) 555-0499',
      previousSchool: 'Lexington Charter Academy',
      stage: 'Submitted',
      checklist: {
        birthCertificate: true,
        transcripts: false,
        medicalClearance: false,
        guardianId: true,
        depositPaid: false,
      },
      notes: 'Awaiting sealed transcript from Lexington Charter.',
      submittedAt: '2026-11-09T11:40:00Z',
      updatedAt: '2026-11-10T08:30:00Z',
    },
    {
      id: 'adm-oak-4',
      tenantId: 'tenant-oakridge',
      applicationCode: 'APP-2026-107',
      studentName: 'Soren Lindholm',
      dateOfBirth: '2010-12-02',
      gender: 'Male',
      targetGrade: 'Grade 11',
      assignedSection: 'A',
      guardianName: 'Astrid Lindholm',
      guardianEmail: 'a.lindholm@example.com',
      guardianPhone: '+1 (617) 555-0520',
      previousSchool: 'Stockholm International',
      stage: 'Inquiry',
      checklist: {
        birthCertificate: false,
        transcripts: false,
        medicalClearance: false,
        guardianId: false,
        depositPaid: false,
      },
      notes: 'Relocating to Boston in January; requested IB HL Physics syllabus.',
      submittedAt: '2026-11-13T15:10:00Z',
      updatedAt: '2026-11-13T15:10:00Z',
    },
    {
      id: 'adm-west-1',
      tenantId: 'tenant-westfield',
      applicationCode: 'WAPP-2026-041',
      studentName: 'Caleb Washington',
      dateOfBirth: '2012-05-09',
      gender: 'Male',
      targetGrade: 'Grade 9',
      assignedSection: 'A',
      guardianName: 'Denise Washington',
      guardianEmail: 'd.washington@example.com',
      guardianPhone: '+1 (512) 555-0318',
      previousSchool: 'Austin Horizon Middle',
      stage: 'Approved',
      checklist: {
        birthCertificate: true,
        transcripts: true,
        medicalClearance: true,
        guardianId: true,
        depositPaid: false,
      },
      notes: 'Robotics club transfer candidate.',
      submittedAt: '2026-11-02T09:00:00Z',
      updatedAt: '2026-11-12T12:00:00Z',
    },
    {
      id: 'adm-sj-1',
      tenantId: 'tenant-stjude',
      applicationCode: 'SJ-APP-019',
      studentName: 'Freya Pemberton',
      dateOfBirth: '2012-08-19',
      gender: 'Female',
      targetGrade: 'Grade 9',
      assignedSection: 'A',
      guardianName: 'Hugh Pemberton',
      guardianEmail: 'h.pemberton@example.co.uk',
      guardianPhone: '+44 20 7946 0511',
      previousSchool: 'Hampstead Prep',
      stage: 'Interview',
      checklist: {
        birthCertificate: true,
        transcripts: true,
        medicalClearance: true,
        guardianId: false,
        depositPaid: false,
      },
      notes: 'Academic scholarship assessment completed.',
      submittedAt: '2026-11-05T13:10:00Z',
      updatedAt: '2026-11-11T14:20:00Z',
    },
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
    // Oakridge Grade 9 A (Kenyan 8-lesson bell schedule)
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

    // Oakridge Grade 10 A (non-conflicting teachers & rooms)
    makeSlot('tt-21', 'tenant-oakridge', 'Monday', 1, 'Grade 10', 'A', 'Social Studies', 't-oak-5', 'Mrs. Wambui Mwangi', 'Hall 202'),
    makeSlot('tt-22', 'tenant-oakridge', 'Monday', 2, 'Grade 10', 'A', 'Kiswahili', 't-oak-4', 'Mr. Mutua Musyoka', 'Room 101'),
    makeSlot('tt-23', 'tenant-oakridge', 'Monday', 4, 'Grade 10', 'A', 'Mathematics', 't-oak-1', 'Mr. Kamau Njoroge', 'Room 104'),
    makeSlot('tt-24', 'tenant-oakridge', 'Tuesday', 3, 'Grade 10', 'A', 'Mathematics', 't-oak-1', 'Mr. Kamau Njoroge', 'Room 101'),
    makeSlot('tt-25', 'tenant-oakridge', 'Wednesday', 2, 'Grade 10', 'A', 'Integrated Science', 't-oak-2', 'Mrs. Achieng Odhiambo', 'Science Lab 1'),
    makeSlot('tt-26', 'tenant-oakridge', 'Thursday', 1, 'Grade 10', 'A', 'Mathematics', 't-oak-1', 'Mr. Kamau Njoroge', 'Room 101'),
    makeSlot('tt-27', 'tenant-oakridge', 'Friday', 3, 'Grade 10', 'A', 'Computer Studies', 't-oak-5', 'Mrs. Wambui Mwangi', 'ICT Lab'),

    // Westfield STEM High
    makeSlot('tt-w1', 'tenant-westfield', 'Monday', 1, 'Grade 9', 'A', 'AP Calculus AB', 't-west-1', 'David Chen', 'STEM 101'),
    makeSlot('tt-w2', 'tenant-westfield', 'Monday', 2, 'Grade 9', 'A', 'Engineering Design', 't-west-2', 'Elena Morales', 'Maker Studio'),
    makeSlot('tt-w3', 'tenant-westfield', 'Tuesday', 1, 'Grade 9', 'A', 'AP Biology', 't-west-3', 'Rachel Foster', 'Bio Lab 1'),
    makeSlot('tt-w4', 'tenant-westfield', 'Wednesday', 2, 'Grade 9', 'A', 'US History', 't-west-4', 'Trevor Brooks', 'Room 210'),

    // St. Jude International
    makeSlot('tt-sj1', 'tenant-stjude', 'Monday', 1, 'Grade 9', 'A', 'Further Mathematics', 't-sj-1', 'Arthur Pendelton', 'North Wing 1'),
    makeSlot('tt-sj2', 'tenant-stjude', 'Monday', 2, 'Grade 9', 'A', 'Economics', 't-sj-2', 'Priya Nair', 'North Wing 2'),
    makeSlot('tt-sj3', 'tenant-stjude', 'Tuesday', 1, 'Grade 9', 'A', 'Physics IGCSE', 't-sj-3', 'Oliver Grant', 'Science Block 3'),
  ];

  // Multi-day Attendance records
  const attendanceDates = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'];
  const attendance: AttendanceRecord[] = [];
  const oakGrade9Students = students.filter((s) => s.tenantId === 'tenant-oakridge' && s.grade === 'Grade 9');
  const oakGrade10Students = students.filter((s) => s.tenantId === 'tenant-oakridge' && s.grade === 'Grade 10');

  attendanceDates.forEach((date, dIdx) => {
    oakGrade9Students.forEach((stu, sIdx) => {
      let status: AttendanceRecord['status'] = 'Present';
      let remarks = '';
      if (dIdx === 4 && sIdx === 3) {
        status = 'Absent';
        remarks = 'Parent called regarding seasonal flu';
      } else if (dIdx === 3 && sIdx === 1) {
        status = 'Late';
        remarks = 'Arrived 12 mins after morning bell';
      } else if (dIdx === 1 && sIdx === 2) {
        status = 'Excused';
        remarks = 'Regional debate tournament';
      }
      attendance.push({
        id: `att-${date}-${stu.id}`,
        tenantId: 'tenant-oakridge',
        date,
        grade: stu.grade,
        section: stu.section,
        studentId: stu.id,
        studentName: stu.fullName,
        studentCode: stu.studentCode,
        status,
        remarks,
        recordedBy: 'Dr. Helena Vance',
        updatedAt: `${date}T08:30:00Z`,
      });
    });

    oakGrade10Students.forEach((stu, sIdx) => {
      let status: AttendanceRecord['status'] = 'Present';
      let remarks = '';
      if (dIdx === 4 && sIdx === 2) {
        status = 'Late';
        remarks = 'Transit delay';
      } else if (dIdx === 2 && sIdx === 1) {
        status = 'Absent';
        remarks = 'Unverified morning absence';
      }
      attendance.push({
        id: `att-${date}-${stu.id}`,
        tenantId: 'tenant-oakridge',
        date,
        grade: stu.grade,
        section: stu.section,
        studentId: stu.id,
        studentName: stu.fullName,
        studentCode: stu.studentCode,
        status,
        remarks,
        recordedBy: 'Samuel Okafor',
        updatedAt: `${date}T08:35:00Z`,
      });
    });
  });

  // Exam Cycles (Term Opening, Mid-Term, End of Term)
  const examCycles: ExamCycle[] = [
    {
      id: 'exm-oak-open',
      tenantId: 'tenant-oakridge',
      title: 'Term 1 Opening Exam',
      term: 'Term 1',
      startDate: '2026-09-07',
      endDate: '2026-09-11',
      status: 'Published',
      createdAt: '2026-09-01T09:00:00Z',
    },
    {
      id: 'exm-oak-1',
      tenantId: 'tenant-oakridge',
      title: 'Term 1 Mid-Term Exam',
      term: 'Term 1',
      startDate: '2026-10-12',
      endDate: '2026-10-16',
      status: 'Published',
      createdAt: '2026-09-25T10:00:00Z',
    },
    {
      id: 'exm-oak-2',
      tenantId: 'tenant-oakridge',
      title: 'Term 1 End of Term Exam',
      term: 'Term 1',
      startDate: '2026-11-18',
      endDate: '2026-11-24',
      status: 'Grading',
      createdAt: '2026-11-01T09:00:00Z',
    },
    {
      id: 'exm-west-open',
      tenantId: 'tenant-westfield',
      title: 'Term 1 Opening Exam',
      term: 'Term 1',
      startDate: '2026-09-08',
      endDate: '2026-09-11',
      status: 'Published',
      createdAt: '2026-09-01T09:00:00Z',
    },
    {
      id: 'exm-west-1',
      tenantId: 'tenant-westfield',
      title: 'Term 1 Mid-Term Exam',
      term: 'Term 1',
      startDate: '2026-10-20',
      endDate: '2026-10-23',
      status: 'Published',
      createdAt: '2026-10-01T09:00:00Z',
    },
    {
      id: 'exm-west-2',
      tenantId: 'tenant-westfield',
      title: 'Term 1 End of Term Exam',
      term: 'Term 1',
      startDate: '2026-11-20',
      endDate: '2026-11-25',
      status: 'Grading',
      createdAt: '2026-11-01T09:00:00Z',
    },
    {
      id: 'exm-sj-open',
      tenantId: 'tenant-stjude',
      title: 'Term 1 Opening Exam',
      term: 'Term 1',
      startDate: '2026-09-09',
      endDate: '2026-09-12',
      status: 'Published',
      createdAt: '2026-09-01T09:00:00Z',
    },
    {
      id: 'exm-sj-1',
      tenantId: 'tenant-stjude',
      title: 'Term 1 Mid-Term Exam',
      term: 'Term 1',
      startDate: '2026-11-02',
      endDate: '2026-11-06',
      status: 'Published',
      createdAt: '2026-10-14T09:00:00Z',
    },
    {
      id: 'exm-sj-2',
      tenantId: 'tenant-stjude',
      title: 'Term 1 End of Term Exam',
      term: 'Term 1',
      startDate: '2026-11-24',
      endDate: '2026-11-28',
      status: 'Grading',
      createdAt: '2026-11-01T09:00:00Z',
    },
  ];

  // Exam Results
  const examResults: ExamResult[] = [];
  const oakSubjects = ['Mathematics', 'Integrated Science', 'English', 'Kiswahili'];
  const baseScores: Record<string, number[]> = {
    'stu-oak-1': [94, 91, 89, 96],
    'stu-oak-2': [85, 79, 84, 88],
    'stu-oak-3': [92, 87, 94, 90],
    'stu-oak-4': [74, 71, 78, 82],
    'stu-oak-5': [96, 93, 91, 95],
    'stu-oak-6': [88, 90, 82, 94],
    'stu-oak-7': [81, 76, 89, 85],
    'stu-oak-8': [68, 64, 75, 72],
    'stu-oak-9': [90, 86, 93, 88],
    'stu-oak-10': [79, 84, 77, 91],
  };

  students
    .filter((s) => s.tenantId === 'tenant-oakridge')
    .forEach((stu) => {
      const scores = baseScores[stu.id] || [82, 80, 84, 86];
      oakSubjects.forEach((subject, idx) => {
        const score = scores[idx];
        const openScore = Math.max(40, score - (idx % 2 === 0 ? 4 : 2));
        const openGrade = computeLetterGrade(openScore, stu.grade);
        examResults.push({
          id: `res-open-${stu.id}-${idx}`,
          tenantId: 'tenant-oakridge',
          examCycleId: 'exm-oak-open',
          studentId: stu.id,
          studentName: stu.fullName,
          studentCode: stu.studentCode,
          grade: stu.grade,
          section: stu.section,
          subject,
          score: openScore,
          maxScore: 100,
          letterGrade: openGrade.letterGrade,
          gpaPoints: openGrade.gpaPoints,
          remarks: 'Baseline Term Opening evaluation',
          updatedAt: '2026-09-12T10:00:00Z',
        });

        const { letterGrade, gpaPoints } = computeLetterGrade(score, stu.grade);
        examResults.push({
          id: `res-1-${stu.id}-${idx}`,
          tenantId: 'tenant-oakridge',
          examCycleId: 'exm-oak-1',
          studentId: stu.id,
          studentName: stu.fullName,
          studentCode: stu.studentCode,
          grade: stu.grade,
          section: stu.section,
          subject,
          score,
          maxScore: 100,
          letterGrade,
          gpaPoints,
          remarks: score >= 90 ? 'Exemplary analytical depth' : score >= 75 ? 'Consistent term progress' : 'Needs targeted revision',
          updatedAt: '2026-10-20T15:00:00Z',
        });

        // Also seed End of Term (Grading in progress)
        const c2Score = Math.min(100, Math.max(40, score + (idx % 2 === 0 ? 2 : -1)));
        const c2Grade = computeLetterGrade(c2Score, stu.grade);
        examResults.push({
          id: `res-2-${stu.id}-${idx}`,
          tenantId: 'tenant-oakridge',
          examCycleId: 'exm-oak-2',
          studentId: stu.id,
          studentName: stu.fullName,
          studentCode: stu.studentCode,
          grade: stu.grade,
          section: stu.section,
          subject,
          score: c2Score,
          maxScore: 100,
          letterGrade: c2Grade.letterGrade,
          gpaPoints: c2Grade.gpaPoints,
          remarks: 'Provisional grading',
          updatedAt: '2026-11-13T14:00:00Z',
        });
      });
    });

  // Westfield & St Jude results
  students
    .filter((s) => s.tenantId === 'tenant-westfield')
    .forEach((stu, idx) => {
      ['English', 'Mathematics', 'Integrated Science'].forEach((subject, sIdx) => {
        const score = 82 + ((idx * 5 + sIdx * 3) % 16);
        const { letterGrade, gpaPoints } = computeLetterGrade(score, stu.grade);
        examResults.push({
          id: `res-w-${stu.id}-${sIdx}`,
          tenantId: 'tenant-westfield',
          examCycleId: 'exm-west-1',
          studentId: stu.id,
          studentName: stu.fullName,
          studentCode: stu.studentCode,
          grade: stu.grade,
          section: stu.section,
          subject,
          score,
          maxScore: 100,
          letterGrade,
          gpaPoints,
          remarks: 'Consistent CBC assessment',
          updatedAt: '2026-10-27T11:00:00Z',
        });
      });
    });

  students
    .filter((s) => s.tenantId === 'tenant-stjude')
    .forEach((stu, idx) => {
      ['English', 'Mathematics', 'Integrated Science'].forEach((subject, sIdx) => {
        const score = 84 + ((idx * 4 + sIdx * 4) % 14);
        const { letterGrade, gpaPoints } = computeLetterGrade(score, stu.grade);
        examResults.push({
          id: `res-sj-${stu.id}-${sIdx}`,
          tenantId: 'tenant-stjude',
          examCycleId: 'exm-sj-1',
          studentId: stu.id,
          studentName: stu.fullName,
          studentCode: stu.studentCode,
          grade: stu.grade,
          section: stu.section,
          subject,
          score,
          maxScore: 100,
          letterGrade,
          gpaPoints,
          remarks: 'Well structured examination technique',
          updatedAt: '2026-11-08T16:00:00Z',
        });
      });
    });

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

  // Fee Structures
  const feeStructures: FeeStructure[] = [
    {
      id: 'fs-oak-9',
      tenantId: 'tenant-oakridge',
      grade: 'Grade 9',
      term: 'Term 1 (Autumn)',
      votelines: buildSeedVotelines(4200, 350, 250, 200),
      tuitionFee: 4200,
      labFee: 350,
      technologyFee: 250,
      activitiesFee: 200,
      totalFee: 5000,
    },
    {
      id: 'fs-oak-10',
      tenantId: 'tenant-oakridge',
      grade: 'Grade 10',
      term: 'Term 1 (Autumn)',
      votelines: buildSeedVotelines(4500, 400, 250, 250),
      tuitionFee: 4500,
      labFee: 400,
      technologyFee: 250,
      activitiesFee: 250,
      totalFee: 5400,
    },
    {
      id: 'fs-oak-11',
      tenantId: 'tenant-oakridge',
      grade: 'Grade 11',
      term: 'Term 1 (Autumn)',
      votelines: buildSeedVotelines(4900, 450, 300, 250),
      tuitionFee: 4900,
      labFee: 450,
      technologyFee: 300,
      activitiesFee: 250,
      totalFee: 5900,
    },
    {
      id: 'fs-west-9',
      tenantId: 'tenant-westfield',
      grade: 'Grade 9',
      term: 'Fall Semester',
      votelines: buildSeedVotelines(3400, 300, 200, 150),
      tuitionFee: 3400,
      labFee: 300,
      technologyFee: 200,
      activitiesFee: 150,
      totalFee: 4050,
    },
    {
      id: 'fs-sj-9',
      tenantId: 'tenant-stjude',
      grade: 'Grade 9',
      term: 'Michaelmas Term',
      votelines: buildSeedVotelines(5200, 400, 250, 300),
      tuitionFee: 5200,
      labFee: 400,
      technologyFee: 250,
      activitiesFee: 300,
      totalFee: 6150,
    },
  ];

  // Invoices
  const invoices: FeeInvoice[] = [
    {
      id: 'inv-oak-1',
      tenantId: 'tenant-oakridge',
      invoiceNumber: 'INV-2026-8801',
      studentId: 'stu-oak-1',
      studentName: 'Wanjiku Kamau',
      studentCode: 'ADM-2601',
      grade: 'Grade 9',
      term: 'Term 1 (Autumn)',
      dueDate: '2026-09-15',
      totalAmount: 5000,
      paidAmount: 5000,
      balance: 0,
      status: 'Paid',
      payments: [
        {
          id: 'pay-1',
          receiptNumber: 'RCT-90412',
          amount: 5000,
          method: 'Bank Transfer',
          reference: 'ACH-771204',
          paidAt: '2026-09-10T11:22:00Z',
          recordedBy: 'Bursar Office',
        },
      ],
      createdAt: '2026-08-25T09:00:00Z',
    },
    {
      id: 'inv-oak-2',
      tenantId: 'tenant-oakridge',
      invoiceNumber: 'INV-2026-8802',
      studentId: 'stu-oak-2',
      studentName: 'Brian Ochieng',
      studentCode: 'ADM-2602',
      grade: 'Grade 9',
      term: 'Term 1 (Autumn)',
      dueDate: '2026-09-15',
      totalAmount: 5000,
      paidAmount: 3000,
      balance: 2000,
      status: 'Partial',
      payments: [
        {
          id: 'pay-2',
          receiptNumber: 'RCT-90488',
          amount: 3000,
          method: 'Card',
          reference: 'VISA-4491',
          paidAt: '2026-09-14T15:10:00Z',
          recordedBy: 'Bursar Office',
        },
      ],
      createdAt: '2026-08-25T09:00:00Z',
    },
    {
      id: 'inv-oak-3',
      tenantId: 'tenant-oakridge',
      invoiceNumber: 'INV-2026-8803',
      studentId: 'stu-oak-3',
      studentName: 'Amina Mohamed',
      studentCode: 'ADM-2603',
      grade: 'Grade 9',
      term: 'Term 1 (Autumn)',
      dueDate: '2026-09-15',
      totalAmount: 5000,
      paidAmount: 5000,
      balance: 0,
      status: 'Paid',
      payments: [
        {
          id: 'pay-3',
          receiptNumber: 'RCT-90502',
          amount: 5000,
          method: 'Bank Transfer',
          reference: 'WIRE-30192',
          paidAt: '2026-09-12T09:30:00Z',
          recordedBy: 'Bursar Office',
        },
      ],
      createdAt: '2026-08-25T09:00:00Z',
    },
    {
      id: 'inv-oak-4',
      tenantId: 'tenant-oakridge',
      invoiceNumber: 'INV-2026-8804',
      studentId: 'stu-oak-4',
      studentName: 'Kiprop Chebet',
      studentCode: 'ADM-2604',
      grade: 'Grade 9',
      term: 'Term 1 (Autumn)',
      dueDate: '2026-10-30',
      totalAmount: 5000,
      paidAmount: 0,
      balance: 5000,
      status: 'Overdue',
      payments: [],
      createdAt: '2026-08-25T09:00:00Z',
    },
    {
      id: 'inv-oak-5',
      tenantId: 'tenant-oakridge',
      invoiceNumber: 'INV-2026-8805',
      studentId: 'stu-oak-5',
      studentName: 'Faith Muthoni',
      studentCode: 'ADM-2501',
      grade: 'Grade 10',
      term: 'Term 1 (Autumn)',
      dueDate: '2026-09-15',
      totalAmount: 5400,
      paidAmount: 5400,
      balance: 0,
      status: 'Paid',
      payments: [
        {
          id: 'pay-5',
          receiptNumber: 'RCT-90555',
          amount: 5400,
          method: 'Bank Transfer',
          reference: 'ACH-992101',
          paidAt: '2026-09-08T10:00:00Z',
          recordedBy: 'Bursar Office',
        },
      ],
      createdAt: '2026-08-25T09:00:00Z',
    },
    {
      id: 'inv-oak-6',
      tenantId: 'tenant-oakridge',
      invoiceNumber: 'INV-2026-8806',
      studentId: 'stu-oak-6',
      studentName: 'Kevin Otieno',
      studentCode: 'ADM-2502',
      grade: 'Grade 10',
      term: 'Term 1 (Autumn)',
      dueDate: '2026-11-28',
      totalAmount: 5400,
      paidAmount: 2700,
      balance: 2700,
      status: 'Partial',
      payments: [
        {
          id: 'pay-6',
          receiptNumber: 'RCT-90611',
          amount: 2700,
          method: 'Card',
          reference: 'MC-8821',
          paidAt: '2026-10-15T14:20:00Z',
          recordedBy: 'Bursar Office',
        },
      ],
      createdAt: '2026-09-01T09:00:00Z',
    },
    {
      id: 'inv-oak-7',
      tenantId: 'tenant-oakridge',
      invoiceNumber: 'INV-2026-8807',
      studentId: 'stu-oak-8',
      studentName: 'David Njoroge',
      studentCode: 'ADM-2504',
      grade: 'Grade 10',
      term: 'Term 1 (Autumn)',
      dueDate: '2026-11-25',
      totalAmount: 5400,
      paidAmount: 0,
      balance: 5400,
      status: 'Pending',
      payments: [],
      createdAt: '2026-11-01T09:00:00Z',
    },
    {
      id: 'inv-oak-8',
      tenantId: 'tenant-oakridge',
      invoiceNumber: 'INV-2026-8808',
      studentId: 'stu-oak-9',
      studentName: 'Mercy Akinyi',
      studentCode: 'ADM-2401',
      grade: 'Grade 11',
      term: 'Term 1 (Autumn)',
      dueDate: '2026-09-15',
      totalAmount: 5900,
      paidAmount: 5900,
      balance: 0,
      status: 'Paid',
      payments: [
        {
          id: 'pay-8',
          receiptNumber: 'RCT-90690',
          amount: 5900,
          method: 'Bank Transfer',
          reference: 'WIRE-7182',
          paidAt: '2026-09-11T16:40:00Z',
          recordedBy: 'Bursar Office',
        },
      ],
      createdAt: '2026-08-25T09:00:00Z',
    },
    {
      id: 'inv-west-1',
      tenantId: 'tenant-westfield',
      invoiceNumber: 'WST-INV-401',
      studentId: 'stu-west-1',
      studentName: 'Dennis Mwangi',
      studentCode: 'ADM-2601',
      grade: 'Grade 9',
      term: 'Fall Semester',
      dueDate: '2026-09-20',
      totalAmount: 4050,
      paidAmount: 4050,
      balance: 0,
      status: 'Paid',
      payments: [
        {
          id: 'pay-w1',
          receiptNumber: 'W-RCT-104',
          amount: 4050,
          method: 'Card',
          reference: 'AMEX-1904',
          paidAt: '2026-09-12T10:15:00Z',
          recordedBy: 'Finance Office',
        },
      ],
      createdAt: '2026-08-22T09:00:00Z',
    },
    {
      id: 'inv-sj-1',
      tenantId: 'tenant-stjude',
      invoiceNumber: 'SJD-INV-201',
      studentId: 'stu-sj-1',
      studentName: 'Sharon Njeri',
      studentCode: 'ADM-2601',
      grade: 'Grade 9',
      term: 'Michaelmas Term',
      dueDate: '2026-10-01',
      totalAmount: 6150,
      paidAmount: 6150,
      balance: 0,
      status: 'Paid',
      payments: [
        {
          id: 'pay-sj1',
          receiptNumber: 'SJD-RCT-81',
          amount: 6150,
          method: 'Bank Transfer',
          reference: 'BACS-44102',
          paidAt: '2026-09-28T09:10:00Z',
          recordedBy: 'Bursary',
        },
      ],
      createdAt: '2026-09-05T09:00:00Z',
    },
  ];

  // Announcements
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
      id: 'ann-west-1',
      tenantId: 'tenant-westfield',
      title: 'STEM Showcase & Robotics Qualifier Logistics',
      body: 'Maker Studio will remain open until 18:00 all week for Grade 9–11 teams preparing prototypes.',
      audience: 'All School',
      priority: 'Normal',
      authorName: 'Elena Morales',
      authorRole: 'Teacher',
      createdAt: '2026-11-12T10:30:00Z',
    },
    {
      id: 'ann-sj-1',
      tenantId: 'tenant-stjude',
      title: 'Michaelmas Parent-Tutor Consultation Evenings',
      body: 'Booking slots for Grade 9 and Grade 10 subject reviews are open through the parent portal.',
      audience: 'Parents & Guardians',
      priority: 'Normal',
      authorName: 'Arthur Pendelton',
      authorRole: 'Admin',
      createdAt: '2026-11-11T16:00:00Z',
    },
  ];

  const messages: DirectMessage[] = [
    {
      id: 'msg-oak-1',
      tenantId: 'tenant-oakridge',
      channel: 'Staff & Faculty',
      senderName: 'Prof. Marcus Reid',
      senderRole: 'Teacher',
      body: 'Lab B2 centrifuge calibration finished ahead of Monday Period 2 Physics.',
      createdAt: '2026-11-13T16:20:00Z',
    },
    {
      id: 'msg-oak-2',
      tenantId: 'tenant-oakridge',
      channel: 'Staff & Faculty',
      senderName: 'Dr. Helena Vance',
      senderRole: 'Admin',
      body: 'Thank you Marcus. Please verify attendance roll-call is submitted before 09:30.',
      createdAt: '2026-11-13T16:45:00Z',
    },
    {
      id: 'msg-oak-3',
      tenantId: 'tenant-oakridge',
      channel: 'Admissions & Registrar',
      senderName: 'Admissions Desk',
      senderRole: 'Registrar',
      body: 'Elena Vance-Moreau has completed medical clearance. Only seat deposit remains before enrollment.',
      createdAt: '2026-11-14T08:10:00Z',
    },
    {
      id: 'msg-west-1',
      tenantId: 'tenant-westfield',
      channel: 'Staff & Faculty',
      senderName: 'David Chen',
      senderRole: 'Teacher',
      body: 'AP Calculus mock grading rubric uploaded for Grade 10.',
      createdAt: '2026-11-13T15:00:00Z',
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
      description: 'Invoice INV-2026-8804 ($5,000) is past due date 2026-10-30.',
      targetModule: 'fees',
      read: false,
      createdAt: '2026-11-13T17:15:00Z',
    },
    {
      id: 'notif-oak-3',
      tenantId: 'tenant-oakridge',
      category: 'exam',
      title: 'Mid-Term Assessment Results Published',
      description: 'Term 1 Mid-Term transcripts are live across Grades 9–11.',
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
      id: 'notif-sj-1',
      tenantId: 'tenant-stjude',
      category: 'announcement',
      title: 'Michaelmas Parent-Tutor Bookings Open',
      description: 'Notification sent to all Grade 9 and Grade 10 guardians.',
      targetModule: 'communications',
      read: false,
      createdAt: '2026-11-11T16:05:00Z',
    },
  ];

  const expenses: SchoolExpense[] = tenants.flatMap((t) =>
    buildDefaultExpensesForTenant(t.id, t.currency, t.slug.slice(0, 3).toUpperCase())
  );

  const etimsChecks: EtimsVerificationRecord[] = tenants.flatMap((t) =>
    buildDefaultEtimsChecksForTenant(t.id, t.currency, t.slug.slice(0, 3).toUpperCase())
  );

  const reconciliationLines: ReconciliationLine[] = tenants.flatMap((t) =>
    buildDefaultReconciliationForTenant(t.id, t.currency, t.slug.slice(0, 3).toUpperCase())
  );

  const payrollEntries: PayrollEntry[] = tenants.flatMap((t) =>
    buildDefaultPayrollForTenant(t, '2026-11')
  );

  const budgets: BudgetAllocation[] = tenants.flatMap((t) => buildDefaultBudgetsForTenant(t));

  const approvalRecords: ApprovalSignOffRecord[] = tenants.flatMap((t) =>
    buildDefaultApprovalsForTenant(t.id, t.currency, t.slug.slice(0, 3).toUpperCase())
  );

  return {
    tenants,
    students,
    admissions,
    timetable,
    attendance,
    staffAttendance: [],
    leaveOutChits: [],
    examCycles,
    examResults,
    feeStructures,
    invoices,
    expenses,
    etimsChecks,
    reconciliationLines,
    payrollEntries,
    budgets,
    approvalRecords,
    announcements,
    messages,
    whatsappDispatches: [],
    notifications,
    adminAuditLogs: [],
  };
}
