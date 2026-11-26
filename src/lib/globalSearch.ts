import { formatCurrency, formatDateShort } from './format';
import {
  getStreamsForGrade,
  type TenantModulePermission,
  type TenantWorkspaceData,
  type UserRole,
} from '../shared/types';

export type SystemModuleId =
  | 'analytics'
  | 'admissions'
  | 'timetable'
  | 'attendance'
  | 'exams'
  | 'academics'
  | 'fees'
  | 'communications'
  | 'settings'
  | 'super-admin';

export type SearchCategoryId =
  | 'all'
  | 'navigation'
  | 'students'
  | 'staff'
  | 'academics'
  | 'exams'
  | 'finance'
  | 'attendance'
  | 'comms';

export interface SystemNavigationTarget {
  nonce: number;
  module: SystemModuleId;
  subTab?: string;
  subSection?: string;
  searchQuery?: string;
  entityId?: string;
  grade?: string;
  section?: string;
  subject?: string;
  action?:
    | 'open-report-card'
    | 'open-receipt'
    | 'open-dev'
    | 'switch-tenant'
    | 'toggle-theme'
    | 'open-notifications';
  devPath?: string;
  targetTenantId?: string;
}

export interface SearchSecondaryAction {
  label: string;
  target: Omit<SystemNavigationTarget, 'nonce'>;
}

export interface SystemSearchItem {
  id: string;
  category: Exclude<SearchCategoryId, 'all'>;
  typeLabel: string;
  title: string;
  subtitle: string;
  meta: string[];
  keywords: string;
  searchBlob: string;
  priorityBoost: number;
  target: Omit<SystemNavigationTarget, 'nonce'>;
  secondaryActions?: SearchSecondaryAction[];
}

export interface SearchCatalogContext {
  workspace: TenantWorkspaceData;
  currentRole: UserRole;
  effectiveModules: TenantModulePermission[];
  canAccessSuperAdmin: boolean;
  isPlatformSuperAdmin: boolean;
  darkMode: boolean;
}

export const SEARCH_CATEGORY_TABS: Array<{ id: SearchCategoryId; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'navigation', label: 'Pages & Tools' },
  { id: 'students', label: 'Learners' },
  { id: 'staff', label: 'Staff' },
  { id: 'academics', label: 'Academics & Timetable' },
  { id: 'exams', label: 'Exams & Reports' },
  { id: 'finance', label: 'Finance & Fees' },
  { id: 'attendance', label: 'Attendance & Chits' },
  { id: 'comms', label: 'Comms & Admin' },
];

const RECENT_SEARCHES_KEY = 'elimunest_global_recent_searches_v1';

export function loadRecentSearches(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, 6);
  } catch {
    return [];
  }
}

export function saveRecentSearch(query: string): string[] {
  const clean = query.trim();
  if (!clean || typeof window === 'undefined') return loadRecentSearches();
  const prev = loadRecentSearches().filter((q) => q.toLowerCase() !== clean.toLowerCase());
  const next = [clean, ...prev].slice(0, 6);
  try {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota errors
  }
  return next;
}

export function clearRecentSearches(): string[] {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(RECENT_SEARCHES_KEY);
    } catch {
      // Ignore
    }
  }
  return [];
}

function makeBlob(parts: Array<string | number | undefined | null>): string {
  return parts
    .filter((p) => p !== undefined && p !== null && String(p).trim().length > 0)
    .join(' ')
    .toLowerCase();
}

export function buildSystemSearchCatalog(ctx: SearchCatalogContext): SystemSearchItem[] {
  const { workspace, currentRole, effectiveModules, canAccessSuperAdmin, isPlatformSuperAdmin, darkMode } = ctx;
  const { tenant } = workspace;
  const modSet = new Set<string>(effectiveModules);
  if (canAccessSuperAdmin) modSet.add('super-admin');
  const hasMod = (id: SystemModuleId) => modSet.has(id);
  const isParentOrStudent = currentRole === 'Parent' || currentRole === 'Student';
  const isAdminStaff =
    currentRole === 'Admin' || currentRole === 'Super Admin' || currentRole === 'Developer';

  const items: SystemSearchItem[] = [];

  const addItem = (item: Omit<SystemSearchItem, 'searchBlob'>) => {
    items.push({
      ...item,
      searchBlob: makeBlob([item.typeLabel, item.title, item.subtitle, ...item.meta, item.keywords]),
    });
  };

  // =========================================================================
  // 1. PAGES, SUB-MODULES & QUICK ACTIONS
  // =========================================================================
  if (hasMod('analytics')) {
    addItem({
      id: 'nav-analytics',
      category: 'navigation',
      typeLabel: 'Module',
      title: 'Analytics & School Overview',
      subtitle: 'KPIs, fee collection velocity, attendance summary & term pulse',
      meta: ['Analytics'],
      keywords: 'dashboard home kpi summary overview metrics',
      priorityBoost: 120,
      target: { module: 'analytics' },
    });
  }

  if (hasMod('admissions')) {
    addItem({
      id: 'nav-admissions-directory',
      category: 'navigation',
      typeLabel: 'Module',
      title: 'Learners Directory & Enrolment',
      subtitle: 'Search enrolled learners, student codes, UPI, guardians, streams & subjects',
      meta: ['Admissions', `${workspace.students.length} Learners`],
      keywords: 'students learners directory enrolment admission upi code portal',
      priorityBoost: 118,
      target: { module: 'admissions', subSection: 'students' },
    });
    if (!isParentOrStudent) {
      addItem({
        id: 'nav-admissions-pipeline',
        category: 'navigation',
        typeLabel: 'Workflow',
        title: 'Admissions Pipeline & Applications',
        subtitle: 'Track prospective applicants, onboarding checklists & approvals',
        meta: ['Admissions', `${workspace.admissions.length} Applications`],
        keywords: 'applications onboarding checklist applicants',
        priorityBoost: 95,
        target: { module: 'admissions', subSection: 'pipeline' },
      });
      addItem({
        id: 'nav-admissions-import',
        category: 'navigation',
        typeLabel: 'Tool',
        title: 'Bulk Student CSV / Excel Import',
        subtitle: 'Dry-run validation and mass learner import',
        meta: ['Admissions'],
        keywords: 'csv excel upload bulk import learners',
        priorityBoost: 85,
        target: { module: 'admissions', subSection: 'import' },
      });
      addItem({
        id: 'nav-admissions-promotion',
        category: 'navigation',
        typeLabel: 'Tool',
        title: 'Year-End Learner Promotion',
        subtitle: 'Promote, hold back, or graduate learners with balance carry-forward',
        meta: ['Admissions'],
        keywords: 'promotion graduate hold back end of year',
        priorityBoost: 85,
        target: { module: 'admissions', subSection: 'promotion' },
      });
    }
  }

  if (hasMod('timetable')) {
    addItem({
      id: 'nav-timetable-grid',
      category: 'navigation',
      typeLabel: 'Module',
      title: 'Master Class & Teacher Timetable',
      subtitle: 'Weekly bell schedule grid by Grade/Stream, Teacher, or Room',
      meta: ['Timetable', `${workspace.timetable.length} Slots`],
      keywords: 'schedule periods bell classes rooms grid',
      priorityBoost: 114,
      target: { module: 'timetable', subTab: 'grid' },
    });
    if (!isParentOrStudent) {
      addItem({
        id: 'nav-timetable-lessons',
        category: 'navigation',
        typeLabel: 'Tool',
        title: 'Lesson Cards & Clash-Free Solver',
        subtitle: 'Allocate weekly lessons per teacher and auto-generate timetable',
        meta: ['Timetable'],
        keywords: 'solver generate lesson cards allocation periods per week',
        priorityBoost: 90,
        target: { module: 'timetable', subTab: 'lessons' },
      });
      addItem({
        id: 'nav-timetable-constraints',
        category: 'navigation',
        typeLabel: 'Tool',
        title: 'Subject Constraints & Bell Schedule',
        subtitle: 'Configure double lessons, parallel electives, and daily period times',
        meta: ['Timetable'],
        keywords: 'double lessons constraints elective bell schedule',
        priorityBoost: 82,
        target: { module: 'timetable', subTab: 'constraints' },
      });
      addItem({
        id: 'nav-timetable-teachers',
        category: 'navigation',
        typeLabel: 'Tool',
        title: 'Teacher Availability Matrix',
        subtitle: 'Set blocked slots and max lessons per day for faculty',
        meta: ['Timetable'],
        keywords: 'teacher availability blocked slots max lessons',
        priorityBoost: 80,
        target: { module: 'timetable', subTab: 'teachers' },
      });
    }
  }

  if (hasMod('attendance')) {
    addItem({
      id: 'nav-attendance-students',
      category: 'navigation',
      typeLabel: 'Module',
      title: 'Student Daily Roll Call & Leave Out Chits',
      subtitle: 'Mark learner daily attendance and issue student leave out chits',
      meta: ['Attendance', 'Students'],
      keywords: 'roll call register absent present student leave chit',
      priorityBoost: 112,
      target: { module: 'attendance', subTab: 'rollcall', subSection: 'student' },
    });
    if (!isParentOrStudent) {
      addItem({
        id: 'nav-attendance-teacher-lesson',
        category: 'navigation',
        typeLabel: 'Workflow',
        title: 'Teacher Lesson Attendance (Attended / Delegated / Recovered)',
        subtitle: 'Period-level lesson tracking, delegation mandates, and make-up logs',
        meta: ['Attendance', 'Lessons'],
        keywords: 'teacher lesson attendance delegated mandate recovered missed',
        priorityBoost: 108,
        target: { module: 'attendance', subTab: 'rollcall', subSection: 'teacher-lesson' },
      });
      addItem({
        id: 'nav-attendance-teacher-leave',
        category: 'navigation',
        typeLabel: 'Workflow',
        title: 'Teacher Leave Out Chits & Duties Delegation',
        subtitle: 'Issue teacher leave out chit, assign covering faculty, auto-sync timetable',
        meta: ['Attendance', `${(workspace.teacherLeaveOutChits || []).length} Chits`],
        keywords: 'teacher leave out chit delegation handover covering absent pdf slip',
        priorityBoost: 110,
        target: {
          module: 'attendance',
          subTab: 'rollcall',
          subSection: 'teacher-leave-chits',
        },
      });
      if (isAdminStaff) {
        addItem({
          id: 'nav-attendance-teaching',
          category: 'navigation',
          typeLabel: 'Workflow',
          title: 'Teaching Staff Daily Attendance',
          subtitle: 'Faculty daily presence & absence roster',
          meta: ['Attendance', 'Teaching Staff'],
          keywords: 'teaching staff attendance teachers roll call',
          priorityBoost: 92,
          target: { module: 'attendance', subTab: 'rollcall', subSection: 'teaching' },
        });
        addItem({
          id: 'nav-attendance-nonteaching',
          category: 'navigation',
          typeLabel: 'Workflow',
          title: 'Non-Teaching & Support Staff Attendance',
          subtitle: 'Support staff daily register & roster',
          meta: ['Attendance', 'Support Staff'],
          keywords: 'non-teaching support staff attendance bursar guard matron',
          priorityBoost: 84,
          target: { module: 'attendance', subTab: 'rollcall', subSection: 'non-teaching' },
        });
      }
      addItem({
        id: 'nav-attendance-summary',
        category: 'navigation',
        typeLabel: 'Report',
        title: 'Attendance Summaries & History',
        subtitle: 'Period summaries for learners, lesson recovery, and staff registers',
        meta: ['Attendance'],
        keywords: 'attendance summary history reports statistics',
        priorityBoost: 86,
        target: { module: 'attendance', subTab: 'summary', subSection: 'student' },
      });
    }
  }

  if (hasMod('exams')) {
    addItem({
      id: 'nav-exams-results',
      category: 'navigation',
      typeLabel: 'Module',
      title: 'Exam Results, Merit List & Report Cards',
      subtitle: 'View class broadsheets, student report cards, and download official PDFs',
      meta: ['Exams & Grades', `${workspace.examCycles.length} Cycles`],
      keywords: 'report cards merit list grades marks cbe kcse broadsheet pdf',
      priorityBoost: 116,
      target: { module: 'exams', subTab: 'results' },
    });
    addItem({
      id: 'nav-exams-progressive',
      category: 'navigation',
      typeLabel: 'Workflow',
      title: 'Learners Progressive Reports (Manual & Import)',
      subtitle: 'Longitudinal CAT/checkpoint tracking, Excel import & PDF exports',
      meta: ['Exams & Grades'],
      keywords: 'progressive report longitudinal cats assessment trend import pdf',
      priorityBoost: 108,
      target: { module: 'exams', subTab: 'progressive' },
    });
    if (!isParentOrStudent) {
      addItem({
        id: 'nav-exams-analytics',
        category: 'navigation',
        typeLabel: 'Analytics',
        title: 'Exam Performance Analysis & Broadsheet',
        subtitle: 'Subject means, stream comparisons, grade distribution & PDF broadsheet',
        meta: ['Exams & Grades'],
        keywords: 'zeraki exam analytics stream comparison distribution broadsheet',
        priorityBoost: 102,
        target: { module: 'exams', subTab: 'analytics' },
      });
      addItem({
        id: 'nav-exams-entry',
        category: 'navigation',
        typeLabel: 'Workflow',
        title: 'Marks & Exam Scores Entry Sheet',
        subtitle: 'Record or edit learner subject marks and grades',
        meta: ['Exams & Grades'],
        keywords: 'marks entry score grading enter marks',
        priorityBoost: 98,
        target: { module: 'exams', subTab: 'entry' },
      });
    }
  }

  if (hasMod('academics')) {
    if (isParentOrStudent) {
      addItem({
        id: 'nav-academics-parent',
        category: 'navigation',
        typeLabel: 'Module',
        title: 'Parent Curriculum Roadmap & Academics',
        subtitle: 'Schemes of work, lesson plans, and weekly work covered for your child',
        meta: ['Teacher Academics'],
        keywords: 'curriculum schemes lesson plans covered roadmap parent pdf',
        priorityBoost: 108,
        target: { module: 'academics', subTab: 'schemes' },
      });
    } else {
      addItem({
        id: 'nav-academics-schemes',
        category: 'navigation',
        typeLabel: 'Module',
        title: 'Schemes of Work',
        subtitle: 'Termly week-by-week CBC/8-4-4 curriculum schemes, approvals & PDFs',
        meta: ['Teacher Academics', `${(workspace.schemesOfWork || []).length} Schemes`],
        keywords: 'schemes of work termly curriculum approval pdf',
        priorityBoost: 106,
        target: { module: 'academics', subTab: 'schemes' },
      });
      addItem({
        id: 'nav-academics-plans',
        category: 'navigation',
        typeLabel: 'Workflow',
        title: 'Daily Lesson Plans',
        subtitle: 'Structured lesson plans linked to schemes of work & PDF exports',
        meta: ['Teacher Academics', `${(workspace.lessonPlans || []).length} Plans`],
        keywords: 'lesson plans strand substrand objectives activities pdf',
        priorityBoost: 102,
        target: { module: 'academics', subTab: 'lesson-plans' },
      });
      addItem({
        id: 'nav-academics-notes',
        category: 'navigation',
        typeLabel: 'Workflow',
        title: 'Lesson Notes Submission Tracker',
        subtitle: 'Submitted vs Not Submitted radio tracking with short remarks',
        meta: ['Teacher Academics', `${(workspace.lessonNotes || []).length} Notes`],
        keywords: 'lesson notes submitted not submitted short remarks',
        priorityBoost: 100,
        target: { module: 'academics', subTab: 'lesson-notes' },
      });
      addItem({
        id: 'nav-academics-row',
        category: 'navigation',
        typeLabel: 'Workflow',
        title: 'Record of Work Covered',
        subtitle: 'Log taught coverage, mastery levels, remediation & admin sign-off',
        meta: ['Teacher Academics', `${(workspace.recordsOfWork || []).length} Records`],
        keywords: 'record of work covered completed mastery sign-off pdf',
        priorityBoost: 100,
        target: { module: 'academics', subTab: 'record-of-work' },
      });
      addItem({
        id: 'nav-academics-tracking',
        category: 'navigation',
        typeLabel: 'Tool',
        title: 'Academic Submission Compliance & Reminders',
        subtitle: 'Deadlines, missing submissions, and automated teacher reminders',
        meta: ['Teacher Academics'],
        keywords: 'submission tracking deadlines reminders compliance',
        priorityBoost: 88,
        target: { module: 'academics', subTab: 'tracking' },
      });
      addItem({
        id: 'nav-academics-parent-preview',
        category: 'navigation',
        typeLabel: 'Preview',
        title: 'Parent Curriculum Preview & Summary PDF',
        subtitle: 'Preview what parents see and download stream curriculum summary PDF',
        meta: ['Teacher Academics'],
        keywords: 'parent visibility preview curriculum roadmap pdf',
        priorityBoost: 82,
        target: { module: 'academics', subTab: 'parent-preview' },
      });
    }
  }

  if (hasMod('fees')) {
    addItem({
      id: 'nav-fees-invoices',
      category: 'navigation',
      typeLabel: 'Module',
      title: 'Student Fee Invoices & Official Receipts',
      subtitle: 'Manage student invoices, collect payments, credit notes & download PDF receipts',
      meta: ['Finance & Accounting', `${workspace.invoices.length} Invoices`],
      keywords: 'fees invoices receipts balances billing waivers pdf',
      priorityBoost: 118,
      target: { module: 'fees', subTab: 'fees', subSection: 'invoices' },
    });
    if (!isParentOrStudent) {
      addItem({
        id: 'nav-fees-payments',
        category: 'navigation',
        typeLabel: 'Ledger',
        title: 'Fee Payments & M-Pesa Transactions',
        subtitle: 'Daraja C2B paybill stream, payment receipts & manual collection log',
        meta: ['Finance & Accounting'],
        keywords: 'payments mpesa paybill daraja receipts collections',
        priorityBoost: 105,
        target: { module: 'fees', subTab: 'fees', subSection: 'payments' },
      });
      addItem({
        id: 'nav-fees-structures',
        category: 'navigation',
        typeLabel: 'Document',
        title: 'Official Fee Structures & Templates',
        subtitle: 'Configure termly grade votelines and download branded fee structure PDFs',
        meta: ['Finance & Accounting', `${workspace.feeStructures.length} Structures`],
        keywords: 'fee structure votelines tuition boarding pdf',
        priorityBoost: 98,
        target: { module: 'fees', subTab: 'fees', subSection: 'structures' },
      });
      addItem({
        id: 'nav-fees-independent',
        category: 'navigation',
        typeLabel: 'Ledger',
        title: 'Independent Fee Votelines (Transport, Trips, Uniforms)',
        subtitle: 'Track standalone levies outside core tuition invoices',
        meta: ['Finance & Accounting'],
        keywords: 'independent votelines transport trip uniform swimming levy',
        priorityBoost: 90,
        target: { module: 'fees', subTab: 'fees', subSection: 'independent' },
      });
      addItem({
        id: 'nav-finance-expenses',
        category: 'navigation',
        typeLabel: 'Workflow',
        title: 'School Expenses & Payment Vouchers',
        subtitle: 'Record vouchers, Maker-Checker approvals, attachments & reversals',
        meta: ['Finance & Accounting', `${workspace.expenses.length} Vouchers`],
        keywords: 'expenses vouchers suppliers vendors payment approval',
        priorityBoost: 102,
        target: { module: 'fees', subTab: 'expensing' },
      });
      addItem({
        id: 'nav-finance-etims',
        category: 'navigation',
        typeLabel: 'Compliance',
        title: 'KRA eTIMS Tax Invoice Verification',
        subtitle: 'Verify supplier CU numbers, KRA PINs, and VAT compliance',
        meta: ['Finance & Accounting'],
        keywords: 'etims kra pin cu invoice tax vat compliance',
        priorityBoost: 86,
        target: { module: 'fees', subTab: 'etims' },
      });
      addItem({
        id: 'nav-finance-reconciliation',
        category: 'navigation',
        typeLabel: 'Workflow',
        title: 'Bank & M-Pesa Statement Reconciliation',
        subtitle: 'Match bank/mobile money statements against ledger entries',
        meta: ['Finance & Accounting'],
        keywords: 'reconciliation bank mpesa statement matching',
        priorityBoost: 88,
        target: { module: 'fees', subTab: 'reconciliation' },
      });
      addItem({
        id: 'nav-finance-payroll',
        category: 'navigation',
        typeLabel: 'Workflow',
        title: 'Kenya Statutory Payroll (PAYE, NSSF, SHIF, Housing Levy)',
        subtitle: 'Run monthly staff payroll, statutory returns & maker-checker sign-off',
        meta: ['Finance & Accounting', `${workspace.payrollEntries.length} Payslips`],
        keywords: 'payroll salary paye nssf shif housing levy nita payslip',
        priorityBoost: 100,
        target: { module: 'fees', subTab: 'payroll' },
      });
      addItem({
        id: 'nav-finance-budgets',
        category: 'navigation',
        typeLabel: 'Governance',
        title: 'Departmental Budgets & BOM Approvals',
        subtitle: 'Budget allocations, utilization tracking, approvals & PDF reports',
        meta: ['Finance & Accounting', `${workspace.budgets.length} Budgets`],
        keywords: 'budgets bom approvals variance report pdf',
        priorityBoost: 98,
        target: { module: 'fees', subTab: 'budgets' },
      });
      addItem({
        id: 'nav-finance-books',
        category: 'navigation',
        typeLabel: 'Statements',
        title: 'Financial Books (P&L, Balance Sheet, Trial Balance, Cashflow)',
        subtitle: 'Audited financial statements, cashbook, debtors & payables PDFs',
        meta: ['Finance & Accounting'],
        keywords: 'financial books income statement profit loss balance sheet trial balance cashflow pdf',
        priorityBoost: 104,
        target: { module: 'fees', subTab: 'books' },
      });
      if (isAdminStaff) {
        addItem({
          id: 'nav-finance-audit',
          category: 'navigation',
          typeLabel: 'Audit',
          title: 'Finance Immutable Audit Trail',
          subtitle: 'Inspect every financial create, approval, void, and reversal event',
          meta: ['Finance & Accounting'],
          keywords: 'finance audit trail logs history',
          priorityBoost: 84,
          target: { module: 'fees', subTab: 'audit' },
        });
      }
    }
  }

  if (hasMod('communications')) {
    addItem({
      id: 'nav-comms-all',
      category: 'navigation',
      typeLabel: 'Module',
      title: 'Communications, Announcements & Channels',
      subtitle: 'School-wide notices, staff/parent channels, and live broadcasts',
      meta: ['Communications', `${workspace.announcements.length} Notices`],
      keywords: 'announcements messages channels broadcast notices',
      priorityBoost: 106,
      target: { module: 'communications' },
    });
  }

  if (hasMod('settings')) {
    addItem({
      id: 'nav-settings-general',
      category: 'navigation',
      typeLabel: 'Module',
      title: 'School Settings & Configuration',
      subtitle: 'School profile, academic calendar, staff accounts, roles & student portal',
      meta: ['School Settings'],
      keywords: 'settings config domain currency profile',
      priorityBoost: 98,
      target: { module: 'settings', subSection: 'general' },
    });
    addItem({
      id: 'nav-settings-staff',
      category: 'navigation',
      typeLabel: 'Admin',
      title: 'Staff Accounts & Access Rights Matrix',
      subtitle: 'Provision accounts, reset passwords, and customize role permissions',
      meta: ['School Settings'],
      keywords: 'users staff accounts passwords custom roles permissions rbac',
      priorityBoost: 96,
      target: { module: 'settings', subSection: 'staff' },
    });
    addItem({
      id: 'nav-settings-calendar',
      category: 'navigation',
      typeLabel: 'Admin',
      title: 'Academic Years & Terms Calendar',
      subtitle: 'Open, close, reopen, or set current school terms',
      meta: ['School Settings', `${(workspace.academicTerms || []).length} Terms`],
      keywords: 'academic year term calendar open close lock',
      priorityBoost: 92,
      target: { module: 'settings', subSection: 'calendar' },
    });
  }

  if (canAccessSuperAdmin) {
    addItem({
      id: 'nav-superadmin-branding',
      category: 'navigation',
      typeLabel: 'Branding',
      title: 'School Theme, Logo & White-Label Branding',
      subtitle: 'Customize logo, colors, letterhead tagline, and PDF branding',
      meta: ['Super Admin'],
      keywords: 'branding logo colors theme letterhead white label',
      priorityBoost: 94,
      target: { module: 'super-admin', subTab: 'branding' },
    });
    if (currentRole === 'Developer') {
      addItem({
        id: 'nav-superadmin-directory',
        category: 'navigation',
        typeLabel: 'Platform',
        title: 'Multi-Tenant School Directory',
        subtitle: 'Inspect and switch across all onboarded school tenants',
        meta: ['Super Admin', `${workspace.tenants.length} Schools`],
        keywords: 'tenants schools directory multi-tenant',
        priorityBoost: 92,
        target: { module: 'super-admin', subTab: 'directory' },
      });
      addItem({
        id: 'nav-superadmin-audit',
        category: 'navigation',
        typeLabel: 'Audit',
        title: 'Platform Admin Audit Logs',
        subtitle: 'Global administrative changes and impersonation events',
        meta: ['Super Admin'],
        keywords: 'super admin audit logs platform events',
        priorityBoost: 80,
        target: { module: 'super-admin', subTab: 'audit' },
      });
    }
  }

  if (isPlatformSuperAdmin) {
    addItem({
      id: 'nav-dev-telemetry',
      category: 'navigation',
      typeLabel: 'Developer',
      title: 'Developer Control Plane (/dev)',
      subtitle: 'Platform telemetry, tenant onboarding, subscriptions, impersonation & statutory rates',
      meta: ['Platform Console'],
      keywords: 'dev developer console telemetry onboarding subscriptions impersonation',
      priorityBoost: 95,
      target: { module: 'analytics', action: 'open-dev', devPath: '/dev/telemetry' },
    });
  }

  // Quick utility actions
  addItem({
    id: 'action-toggle-theme',
    category: 'navigation',
    typeLabel: 'Action',
    title: darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode',
    subtitle: 'Toggle display appearance for the workspace',
    meta: ['Appearance'],
    keywords: 'dark mode light mode theme appearance',
    priorityBoost: 50,
    target: { module: 'analytics', action: 'toggle-theme' },
  });
  addItem({
    id: 'action-open-notifications',
    category: 'navigation',
    typeLabel: 'Action',
    title: 'Open Notification Feed Drawer',
    subtitle: 'View recent tenant alerts and unread notifications',
    meta: [`${workspace.notifications.filter((n) => !n.read).length} Unread`],
    keywords: 'notifications alerts bell unread feed',
    priorityBoost: 55,
    target: { module: 'analytics', action: 'open-notifications' },
  });

  // =========================================================================
  // 2. LEARNERS / STUDENTS
  // =========================================================================
  for (const stu of workspace.students) {
    const primaryTarget: Omit<SystemNavigationTarget, 'nonce'> = hasMod('admissions')
      ? { module: 'admissions', subSection: 'students', searchQuery: stu.studentCode || stu.fullName, entityId: stu.id }
      : hasMod('exams')
      ? { module: 'exams', subTab: 'results', grade: stu.grade, section: stu.section, searchQuery: stu.fullName, entityId: stu.id }
      : hasMod('fees')
      ? { module: 'fees', subTab: 'fees', subSection: 'invoices', searchQuery: stu.studentCode || stu.fullName, entityId: stu.id }
      : { module: visibleNavFallback(effectiveModules), searchQuery: stu.fullName, entityId: stu.id };

    const secondaryActions: SearchSecondaryAction[] = [];
    if (hasMod('exams')) {
      secondaryActions.push({
        label: 'Report Card',
        target: {
          module: 'exams',
          subTab: 'results',
          grade: stu.grade,
          section: stu.section,
          entityId: stu.id,
          action: 'open-report-card',
        },
      });
      secondaryActions.push({
        label: 'Progressive',
        target: {
          module: 'exams',
          subTab: 'progressive',
          grade: stu.grade,
          section: stu.section,
          entityId: stu.id,
          searchQuery: stu.fullName,
        },
      });
    }
    if (hasMod('fees')) {
      secondaryActions.push({
        label: 'Fees',
        target: {
          module: 'fees',
          subTab: 'fees',
          subSection: 'invoices',
          searchQuery: stu.studentCode || stu.fullName,
          entityId: stu.id,
        },
      });
    }
    if (hasMod('attendance') && !isParentOrStudent) {
      secondaryActions.push({
        label: 'Roll Call',
        target: {
          module: 'attendance',
          subTab: 'rollcall',
          subSection: 'student',
          grade: stu.grade,
          section: stu.section,
          entityId: stu.id,
        },
      });
    }

    addItem({
      id: `stu-${stu.id}`,
      category: 'students',
      typeLabel: 'Learner',
      title: stu.fullName,
      subtitle: `${stu.studentCode} · ${stu.grade} Stream ${stu.section}${stu.guardianName ? ` · Guardian: ${stu.guardianName}` : ''}`,
      meta: [
        stu.status,
        stu.upi ? `UPI ${stu.upi}` : '',
        stu.guardianPhone || '',
      ].filter(Boolean),
      keywords: (stu.registeredSubjects || []).join(' '),
      priorityBoost: 72,
      target: primaryTarget,
      secondaryActions: secondaryActions.slice(0, 3),
    });
  }

  // =========================================================================
  // 3. TEACHING & NON-TEACHING STAFF
  // =========================================================================
  if (!isParentOrStudent) {
    for (const tc of tenant.teachers) {
      const target: Omit<SystemNavigationTarget, 'nonce'> = hasMod('timetable')
        ? { module: 'timetable', subTab: 'grid', subSection: 'teacher', entityId: tc.id }
        : hasMod('academics')
        ? { module: 'academics', subTab: 'schemes', searchQuery: tc.name, entityId: tc.id }
        : hasMod('attendance')
        ? { module: 'attendance', subTab: 'rollcall', subSection: 'teacher-lesson', entityId: tc.id }
        : { module: 'settings', subSection: 'staff', searchQuery: tc.name };

      const secondaryActions: SearchSecondaryAction[] = [];
      if (hasMod('academics')) {
        secondaryActions.push({
          label: 'Academics',
          target: { module: 'academics', subTab: 'schemes', searchQuery: tc.name, entityId: tc.id },
        });
      }
      if (hasMod('attendance')) {
        secondaryActions.push({
          label: 'Lessons Log',
          target: { module: 'attendance', subTab: 'rollcall', subSection: 'teacher-lesson', entityId: tc.id },
        });
        secondaryActions.push({
          label: 'Leave Chit',
          target: { module: 'attendance', subTab: 'rollcall', subSection: 'teacher-leave-chits', entityId: tc.id },
        });
      }

      addItem({
        id: `teacher-${tc.id}`,
        category: 'staff',
        typeLabel: 'Teacher',
        title: tc.name,
        subtitle: `${tc.department}${tc.subjects.length > 0 ? ` · ${tc.subjects.slice(0, 4).join(', ')}` : ''}`,
        meta: [tc.email, tc.phone].filter(Boolean),
        keywords: `${tc.subjects.join(' ')} faculty instructor`,
        priorityBoost: 74,
        target,
        secondaryActions: secondaryActions.slice(0, 3),
      });
    }

    for (const st of tenant.nonTeachingStaff || []) {
      const target: Omit<SystemNavigationTarget, 'nonce'> =
        hasMod('attendance') && isAdminStaff
          ? { module: 'attendance', subTab: 'rollcall', subSection: 'non-teaching', entityId: st.id }
          : hasMod('fees')
          ? { module: 'fees', subTab: 'payroll', searchQuery: st.name }
          : { module: 'settings', subSection: 'staff', searchQuery: st.name };

      addItem({
        id: `nonteaching-${st.id}`,
        category: 'staff',
        typeLabel: 'Support Staff',
        title: st.name,
        subtitle: `${st.role} · ${st.department}`,
        meta: [st.email, st.phone].filter(Boolean),
        keywords: `non-teaching support staff ${st.role}`,
        priorityBoost: 62,
        target,
      });
    }
  }

  // =========================================================================
  // 4. ADMISSIONS APPLICATIONS
  // =========================================================================
  if (hasMod('admissions') && !isParentOrStudent) {
    for (const app of workspace.admissions) {
      addItem({
        id: `adm-${app.id}`,
        category: 'students',
        typeLabel: 'Application',
        title: app.studentName,
        subtitle: `${app.applicationCode} · Applying for ${app.targetGrade} ${app.assignedSection}`,
        meta: [app.stage, app.previousSchool || '', app.guardianName].filter(Boolean),
        keywords: `${app.guardianPhone} ${app.guardianEmail} admissions pipeline`,
        priorityBoost: 64,
        target: {
          module: 'admissions',
          subSection: 'pipeline',
          searchQuery: app.studentName,
          entityId: app.id,
        },
      });
    }
  }

  // =========================================================================
  // 5. GRADES, STREAMS, ROOMS, SUBJECTS & TEACHER ACADEMICS
  // =========================================================================
  if (hasMod('timetable') || hasMod('admissions')) {
    for (const grade of tenant.grades) {
      const streams = getStreamsForGrade(tenant, grade);
      addItem({
        id: `grade-${grade}`,
        category: 'academics',
        typeLabel: 'Grade',
        title: grade,
        subtitle: `Streams: ${streams.join(', ') || 'A'}`,
        meta: [
          hasMod('timetable') ? 'Open Timetable' : 'Open Class',
        ],
        keywords: `class cohort stream ${streams.map((s) => `${grade} ${s}`).join(' ')}`,
        priorityBoost: 68,
        target: hasMod('timetable')
          ? { module: 'timetable', subTab: 'grid', subSection: 'grade', grade, section: streams[0] || 'A' }
          : { module: 'admissions', subSection: 'students', grade },
        secondaryActions:
          hasMod('admissions') && hasMod('timetable')
            ? ([
                {
                  label: 'Learners',
                  target: { module: 'admissions', subSection: 'students', grade },
                },
                ...(hasMod('exams')
                  ? [
                      {
                        label: 'Exams',
                        target: { module: 'exams' as const, subTab: 'results', grade },
                      },
                    ]
                  : []),
              ] as SearchSecondaryAction[])
            : undefined,
      });
    }

    if (hasMod('timetable') && !isParentOrStudent) {
      for (const room of tenant.rooms) {
        addItem({
          id: `room-${room}`,
          category: 'academics',
          typeLabel: 'Room / Lab',
          title: room,
          subtitle: 'View weekly room schedule on Timetable Grid',
          meta: ['Timetable'],
          keywords: 'classroom lab hall venue timetable',
          priorityBoost: 58,
          target: { module: 'timetable', subTab: 'grid', subSection: 'room', searchQuery: room },
        });
      }
    }
  }

  if (hasMod('academics')) {
    for (const s of workspace.schemesOfWork || []) {
      addItem({
        id: `scheme-${s.id}`,
        category: 'academics',
        typeLabel: 'Scheme of Work',
        title: s.title || `${s.subject} Scheme of Work`,
        subtitle: `${s.grade} ${s.section} · ${s.subject} · ${s.teacherName}`,
        meta: [s.term, s.status, s.parentVisible ? 'Parent Visible' : 'Internal'],
        keywords: `${s.referenceBook || ''} ${s.parentSummary || ''}`,
        priorityBoost: 66,
        target: {
          module: 'academics',
          subTab: 'schemes',
          searchQuery: s.title || s.subject,
          entityId: s.id,
        },
      });
    }

    for (const lp of workspace.lessonPlans || []) {
      addItem({
        id: `lp-${lp.id}`,
        category: 'academics',
        typeLabel: 'Lesson Plan',
        title: lp.lessonTitle || `${lp.subject} Lesson Plan`,
        subtitle: `${lp.grade} ${lp.section} · ${lp.subject} · Week ${lp.weekNumber} (${lp.lessonDate})`,
        meta: [lp.teacherName, lp.status],
        keywords: `${lp.strand} ${lp.subStrand} ${lp.learningOutcomes}`,
        priorityBoost: 64,
        target: {
          module: 'academics',
          subTab: 'lesson-plans',
          searchQuery: lp.lessonTitle || lp.subject,
          entityId: lp.id,
        },
      });
    }

    for (const ln of workspace.lessonNotes || []) {
      addItem({
        id: `ln-${ln.id}`,
        category: 'academics',
        typeLabel: 'Lesson Note',
        title: ln.topicTitle || `${ln.subject} Lesson Notes (Wk ${ln.weekNumber})`,
        subtitle: `${ln.grade} ${ln.section} · ${ln.teacherName} · ${ln.lessonDate}`,
        meta: [ln.submissionStatus, ln.remarks ? ln.remarks.slice(0, 48) : ''],
        keywords: `${ln.remarks || ''} ${ln.strand || ''} ${ln.submissionStatus}`,
        priorityBoost: 60,
        target: {
          module: 'academics',
          subTab: 'lesson-notes',
          searchQuery: ln.topicTitle || ln.subject,
          entityId: ln.id,
        },
      });
    }

    for (const row of workspace.recordsOfWork || []) {
      addItem({
        id: `row-${row.id}`,
        category: 'academics',
        typeLabel: 'Record of Work',
        title: `${row.subject} · ${row.strand || row.workCovered.slice(0, 42)}`,
        subtitle: `${row.grade} ${row.section} · ${row.teacherName} · Week ${row.weekNumber} (${row.dateCovered})`,
        meta: [row.coverageStatus, row.learnerMastery, row.status],
        keywords: `${row.workCovered} ${row.subStrand} ${row.remarks || ''}`,
        priorityBoost: 62,
        target: {
          module: 'academics',
          subTab: 'record-of-work',
          searchQuery: row.strand || row.subject,
          entityId: row.id,
        },
      });
    }
  }

  // =========================================================================
  // 6. EXAMS, CYCLES & PROGRESSIVE REPORTS
  // =========================================================================
  if (hasMod('exams')) {
    for (const cyc of workspace.examCycles) {
      addItem({
        id: `cycle-${cyc.id}`,
        category: 'exams',
        typeLabel: 'Exam Cycle',
        title: cyc.title,
        subtitle: `${cyc.term} · ${cyc.startDate} to ${cyc.endDate}`,
        meta: [cyc.status],
        keywords: 'exam assessment merit list broadsheet report cards',
        priorityBoost: 78,
        target: { module: 'exams', subTab: 'results', entityId: cyc.id },
        secondaryActions: !isParentOrStudent
          ? [
              {
                label: 'Analytics',
                target: { module: 'exams', subTab: 'analytics', entityId: cyc.id },
              },
              {
                label: 'Enter Marks',
                target: { module: 'exams', subTab: 'entry', entityId: cyc.id },
              },
            ]
          : undefined,
      });
    }

    for (const pr of workspace.progressiveReports || []) {
      addItem({
        id: `prog-${pr.id}`,
        category: 'exams',
        typeLabel: 'Progressive Report',
        title: `${pr.studentName} · ${pr.assessmentLabel}`,
        subtitle: `${pr.studentCode} · ${pr.grade} ${pr.section} · Mean ${pr.meanScore}% (${pr.meanGrade})`,
        meta: [pr.term, pr.assessmentDate, pr.source === 'import' ? 'Imported' : 'Manual'],
        keywords: `${pr.subjects.map((s) => s.subject).join(' ')} ${pr.classTeacherRemarks || ''}`,
        priorityBoost: 62,
        target: {
          module: 'exams',
          subTab: 'progressive',
          grade: pr.grade,
          section: pr.section,
          entityId: pr.studentId,
          searchQuery: pr.studentName,
        },
      });
    }
  }

  // =========================================================================
  // 7. FINANCE, INVOICES, RECEIPTS, EXPENSES, PAYROLL, BUDGETS, M-PESA
  // =========================================================================
  if (hasMod('fees')) {
    for (const inv of workspace.invoices) {
      const receiptList = inv.payments.filter((p) => !p.voided).map((p) => `${p.receiptNumber} ${p.reference}`).join(' ');
      addItem({
        id: `inv-${inv.id}`,
        category: 'finance',
        typeLabel: 'Fee Invoice',
        title: `${inv.invoiceNumber} · ${inv.studentName}`,
        subtitle: `${inv.studentCode} · ${inv.grade} · ${inv.term}`,
        meta: [
          inv.status,
          `Total ${formatCurrency(inv.totalAmount, tenant.currency)}`,
          inv.balance > 0 ? `Bal ${formatCurrency(inv.balance, tenant.currency)}` : 'Settled',
        ],
        keywords: `${receiptList} fee statement receipt`,
        priorityBoost: 70,
        target: {
          module: 'fees',
          subTab: 'fees',
          subSection: 'invoices',
          searchQuery: inv.invoiceNumber,
          entityId: inv.id,
        },
        secondaryActions:
          inv.payments.some((p) => !p.voided)
            ? [
                {
                  label: 'Receipt',
                  target: {
                    module: 'fees',
                    subTab: 'fees',
                    subSection: 'invoices',
                    searchQuery: inv.invoiceNumber,
                    entityId: inv.id,
                    action: 'open-receipt',
                  },
                },
              ]
            : undefined,
      });
    }

    for (const fs of workspace.feeStructures) {
      addItem({
        id: `fs-${fs.id}`,
        category: 'finance',
        typeLabel: 'Fee Structure',
        title: `${fs.grade} · ${fs.term} Fee Structure`,
        subtitle: `Total ${formatCurrency(fs.totalFee, tenant.currency)} · ${(fs.votelines || []).map((v) => v.name).join(', ')}`,
        meta: ['Official Schedule'],
        keywords: 'tuition lab technology activities voteline',
        priorityBoost: 62,
        target: {
          module: 'fees',
          subTab: 'fees',
          subSection: 'structures',
          grade: fs.grade,
          entityId: fs.id,
        },
      });
    }

    if (!isParentOrStudent) {
      for (const ivl of workspace.independentVotelines || []) {
        if (ivl.voided) continue;
        addItem({
          id: `ivl-${ivl.id}`,
          category: 'finance',
          typeLabel: 'Independent Levy',
          title: `${ivl.name} · ${ivl.studentName}`,
          subtitle: `${ivl.studentCode} · ${ivl.grade} · ${ivl.term}`,
          meta: [ivl.status, formatCurrency(ivl.amount, tenant.currency)],
          keywords: `${ivl.note || ''} independent voteline`,
          priorityBoost: 56,
          target: {
            module: 'fees',
            subTab: 'fees',
            subSection: 'independent',
            searchQuery: ivl.studentName,
            entityId: ivl.id,
          },
        });
      }

      for (const mp of workspace.mpesaTransactions || []) {
        addItem({
          id: `mpesa-${mp.id}`,
          category: 'finance',
          typeLabel: 'M-Pesa Receipt',
          title: `${mp.mpesaReceipt} · ${formatCurrency(mp.amount, tenant.currency)}`,
          subtitle: `${mp.studentName || mp.accountReference} · Paybill ${mp.paybillNumber}`,
          meta: [mp.status, mp.msisdn, formatDateShort(mp.receivedAt)],
          keywords: `${mp.invoiceNumber || ''} ${mp.channel} daraja`,
          priorityBoost: 64,
          target: {
            module: 'fees',
            subTab: 'fees',
            subSection: 'payments',
            searchQuery: mp.mpesaReceipt,
            entityId: mp.id,
          },
        });
      }

      for (const exp of workspace.expenses) {
        if (exp.voided) continue;
        addItem({
          id: `exp-${exp.id}`,
          category: 'finance',
          typeLabel: 'Expense Voucher',
          title: `${exp.voucherNumber} · ${exp.title}`,
          subtitle: `${exp.vendor} · ${exp.category}`,
          meta: [exp.status, formatCurrency(exp.amount, tenant.currency), exp.expenseDate],
          keywords: `${exp.reference} ${exp.etimsCuNumber || ''} ${exp.boardApprovalRef || ''}`,
          priorityBoost: 64,
          target: {
            module: 'fees',
            subTab: 'expensing',
            searchQuery: exp.voucherNumber,
            entityId: exp.id,
          },
        });
      }

      for (const pay of workspace.payrollEntries) {
        if (pay.voided) continue;
        addItem({
          id: `pay-${pay.id}`,
          category: 'finance',
          typeLabel: 'Payroll Entry',
          title: `${pay.staffName} · ${pay.payPeriod}`,
          subtitle: `${pay.designation} (${pay.staffCategory}) · Net ${formatCurrency(pay.netPay, tenant.currency)}`,
          meta: [pay.status, `Gross ${formatCurrency(pay.grossPay, tenant.currency)}`],
          keywords: 'salary paye nssf shif payslip',
          priorityBoost: 56,
          target: {
            module: 'fees',
            subTab: 'payroll',
            searchQuery: pay.staffName,
            entityId: pay.id,
          },
        });
      }

      for (const bgt of workspace.budgets) {
        addItem({
          id: `bgt-${bgt.id}`,
          category: 'finance',
          typeLabel: 'Budget Line',
          title: `${bgt.category} (${bgt.term})`,
          subtitle: `${bgt.fiscalYear} · Allocated ${formatCurrency(bgt.allocatedAmount, tenant.currency)}`,
          meta: [bgt.status || 'Approved'],
          keywords: `${bgt.notes || ''} departmental budget`,
          priorityBoost: 58,
          target: {
            module: 'fees',
            subTab: 'budgets',
            searchQuery: bgt.category,
            entityId: bgt.id,
          },
        });
      }

      for (const ap of workspace.approvalRecords) {
        if (ap.voided) continue;
        addItem({
          id: `appr-${ap.id}`,
          category: 'finance',
          typeLabel: 'BOM Approval',
          title: `${ap.referenceCode} · ${ap.subject}`,
          subtitle: `${ap.committee} · ${formatCurrency(ap.amount, tenant.currency)}`,
          meta: [ap.decision, ap.minuteReference],
          keywords: `${ap.linkedVoucherNumber || ''} ${ap.chairpersonName}`,
          priorityBoost: 56,
          target: {
            module: 'fees',
            subTab: 'budgets',
            searchQuery: ap.referenceCode,
            entityId: ap.id,
          },
        });
      }

      for (const et of workspace.etimsChecks) {
        if (et.voided) continue;
        addItem({
          id: `etims-${et.id}`,
          category: 'finance',
          typeLabel: 'eTIMS Check',
          title: `${et.cuInvoiceNumber} · ${et.supplierName}`,
          subtitle: `PIN ${et.supplierKraPin} · ${formatCurrency(et.totalAmount, tenant.currency)}`,
          meta: [et.status, et.receiptDate],
          keywords: `${et.voucherNumber || ''} kra etims vat`,
          priorityBoost: 54,
          target: {
            module: 'fees',
            subTab: 'etims',
            searchQuery: et.cuInvoiceNumber,
            entityId: et.id,
          },
        });
      }
    }
  }

  // =========================================================================
  // 8. ATTENDANCE & LEAVE OUT CHITS (TEACHER & STUDENT)
  // =========================================================================
  if (hasMod('attendance')) {
    if (!isParentOrStudent) {
      for (const tChit of workspace.teacherLeaveOutChits || []) {
        const delegates = tChit.dutiesDelegations.map((d) => d.delegateTeacherName).join(', ');
        const duties = tChit.dutiesDelegations.map((d) => d.dutyTitle).join(' · ');
        addItem({
          id: `tchit-${tChit.id}`,
          category: 'attendance',
          typeLabel: 'Teacher Leave Chit',
          title: `${tChit.teacherName} (${tChit.days}d · ${tChit.startDate})`,
          subtitle: `${tChit.reason} · Delegated to ${delegates}`,
          meta: [`${tChit.startDate} to ${tChit.endDate}`, `${tChit.dutiesDelegations.length} Duties`],
          keywords: `${duties} ${tChit.handoverNotes || ''} teacher leave delegation`,
          priorityBoost: 72,
          target: {
            module: 'attendance',
            subTab: 'rollcall',
            subSection: 'teacher-leave-chits',
            entityId: tChit.id,
          },
        });
      }
    }

    for (const chit of workspace.leaveOutChits) {
      addItem({
        id: `chit-${chit.id}`,
        category: 'attendance',
        typeLabel: 'Student Leave Chit',
        title: `${chit.studentName} (${chit.days}d · ${chit.startDate})`,
        subtitle: `${chit.studentCode} · ${chit.grade} ${chit.section} · ${chit.reason}`,
        meta: [`${chit.startDate} to ${chit.endDate}`, `Issued by ${chit.issuedBy}`],
        keywords: 'student leave out chit pass permission',
        priorityBoost: 60,
        target: {
          module: 'attendance',
          subTab: 'rollcall',
          subSection: 'student-leave-chits',
          grade: chit.grade,
          section: chit.section,
          entityId: chit.id,
        },
      });
    }

    if (!isParentOrStudent) {
      for (const tla of (workspace.teacherLessonAttendance || []).slice(0, 120)) {
        if (tla.status === 'Attended') continue;
        addItem({
          id: `tla-${tla.id}`,
          category: 'attendance',
          typeLabel: `Lesson ${tla.status}`,
          title: `${tla.subject} (${tla.grade} ${tla.section}) · ${tla.scheduledTeacherName}`,
          subtitle:
            tla.status === 'Delegated'
              ? `Delegated to ${tla.delegatedTeacherName || 'Covering Teacher'} on ${tla.date}`
              : tla.status === 'Recovered'
              ? `Recovered missed ${tla.originalMissedDate || ''} lesson on ${tla.recoveredDate || tla.date}`
              : `Missed on ${tla.date}`,
          meta: [tla.date, tla.timeSlot || ''].filter(Boolean),
          keywords: `${tla.topicCovered || ''} ${tla.delegationNotes || ''} ${tla.remarks || ''}`,
          priorityBoost: 56,
          target: {
            module: 'attendance',
            subTab: 'rollcall',
            subSection: 'teacher-lesson',
            grade: tla.grade,
            section: tla.section,
            entityId: tla.scheduledTeacherId,
          },
        });
      }
    }
  }

  // =========================================================================
  // 9. COMMUNICATIONS, CALENDAR TERMS & MULTI-TENANT SCHOOLS
  // =========================================================================
  if (hasMod('communications')) {
    for (const ann of workspace.announcements) {
      addItem({
        id: `ann-${ann.id}`,
        category: 'comms',
        typeLabel: 'Announcement',
        title: ann.title,
        subtitle: ann.body.slice(0, 110),
        meta: [ann.audience, ann.priority, ann.authorName, formatDateShort(ann.createdAt)],
        keywords: `${ann.body}`,
        priorityBoost: 62,
        target: {
          module: 'communications',
          searchQuery: ann.title,
          entityId: ann.id,
        },
      });
    }

    for (const msg of workspace.messages.slice(-40)) {
      addItem({
        id: `msg-${msg.id}`,
        category: 'comms',
        typeLabel: 'Channel Message',
        title: `${msg.senderName} (${msg.channel})`,
        subtitle: msg.body.slice(0, 110),
        meta: [msg.senderRole, formatDateShort(msg.createdAt)],
        keywords: `${msg.channel} ${msg.body}`,
        priorityBoost: 48,
        target: {
          module: 'communications',
          subSection: msg.channel,
          searchQuery: msg.body.slice(0, 40),
        },
      });
    }
  }

  for (const notif of workspace.notifications.slice(0, 25)) {
    const targetMod = hasMod(notif.targetModule as SystemModuleId)
      ? (notif.targetModule as SystemModuleId)
      : visibleNavFallback(effectiveModules);
    addItem({
      id: `notif-${notif.id}`,
      category: 'comms',
      typeLabel: 'Notification',
      title: notif.title,
      subtitle: notif.description,
      meta: [notif.read ? 'Read' : 'Unread', formatDateShort(notif.createdAt)],
      keywords: `${notif.category} alert`,
      priorityBoost: notif.read ? 44 : 58,
      target: { module: targetMod },
    });
  }

  if (hasMod('settings')) {
    for (const term of workspace.academicTerms || []) {
      addItem({
        id: `term-${term.id}`,
        category: 'comms',
        typeLabel: 'Academic Term',
        title: term.name,
        subtitle: `${term.startDate} to ${term.endDate}`,
        meta: [term.status, term.isCurrent ? 'Current Term' : 'Historical/Upcoming'],
        keywords: 'calendar term academic year',
        priorityBoost: 56,
        target: { module: 'settings', subSection: 'calendar' },
      });
    }
  }

  if (isPlatformSuperAdmin) {
    for (const sch of workspace.tenants) {
      addItem({
        id: `tenant-${sch.id}`,
        category: 'comms',
        typeLabel: 'School Tenant',
        title: sch.name,
        subtitle: `${sch.location} · ${sch.curriculum} · @${sch.emailDomain || sch.slug}`,
        meta: [sch.plan, sch.status || 'Active', sch.id === tenant.id ? 'Current Workspace' : 'Switch School'],
        keywords: `${sch.slug} multi-tenant school`,
        priorityBoost: sch.id === tenant.id ? 60 : 76,
        target: {
          module: 'analytics',
          action: 'switch-tenant',
          targetTenantId: sch.id,
        },
      });
    }
  }

  return items;
}

function visibleNavFallback(mods: TenantModulePermission[]): SystemModuleId {
  return (mods[0] as SystemModuleId) || 'analytics';
}

export function runSystemSearch(
  catalog: SystemSearchItem[],
  query: string,
  category: SearchCategoryId = 'all',
  limit = 48
): {
  results: SystemSearchItem[];
  countsByCategory: Record<SearchCategoryId, number>;
} {
  const trimmed = query.trim().toLowerCase();
  const tokens = trimmed ? trimmed.split(/\s+/).filter(Boolean) : [];

  const countsByCategory: Record<SearchCategoryId, number> = {
    all: 0,
    navigation: 0,
    students: 0,
    staff: 0,
    academics: 0,
    exams: 0,
    finance: 0,
    attendance: 0,
    comms: 0,
  };

  if (tokens.length === 0) {
    // No query: show top curated shortcuts & recent-priority pages
    const scoredAll = catalog
      .map((item) => {
        const baseScore = item.category === 'navigation' ? item.priorityBoost + 100 : item.priorityBoost;
        return { item, score: baseScore };
      })
      .sort((a, b) => b.score - a.score);

    for (const entry of scoredAll) {
      countsByCategory.all += 1;
      countsByCategory[entry.item.category] += 1;
    }

    const filtered =
      category === 'all'
        ? scoredAll.filter((e) => e.item.category === 'navigation').slice(0, 14)
        : scoredAll.filter((e) => e.item.category === category).slice(0, 24);

    return {
      results: filtered.map((e) => e.item),
      countsByCategory,
    };
  }

  const matched: Array<{ item: SystemSearchItem; score: number }> = [];

  for (const item of catalog) {
    let allTokensMatch = true;
    for (const tok of tokens) {
      if (!item.searchBlob.includes(tok)) {
        allTokensMatch = false;
        break;
      }
    }
    if (!allTokensMatch) continue;

    countsByCategory.all += 1;
    countsByCategory[item.category] += 1;

    if (category !== 'all' && item.category !== category) continue;

    const titleLower = item.title.toLowerCase();
    const subLower = item.subtitle.toLowerCase();
    let score = item.priorityBoost;

    if (titleLower === trimmed) {
      score += 400;
    } else if (titleLower.startsWith(trimmed)) {
      score += 260;
    } else if (titleLower.includes(trimmed)) {
      score += 170;
    }

    for (const tok of tokens) {
      if (titleLower.startsWith(tok)) score += 90;
      else if (titleLower.includes(tok)) score += 60;
      else if (subLower.includes(tok)) score += 30;
      else score += 12;
    }

    matched.push({ item, score });
  }

  matched.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.item.title.localeCompare(b.item.title);
  });

  return {
    results: matched.slice(0, limit).map((m) => m.item),
    countsByCategory,
  };
}

export function splitHighlightSegments(
  text: string,
  query: string
): Array<{ text: string; match: boolean }> {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  if (!text || tokens.length === 0) {
    return [{ text, match: false }];
  }
  const escaped = tokens
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = text.split(regex);
  return parts
    .filter((p) => p.length > 0)
    .map((part) => ({
      text: part,
      match: tokens.some((t) => part.toLowerCase() === t),
    }));
}
