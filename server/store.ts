import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import * as XLSX from 'xlsx';
import {
  addDaysIso,
  ALL_TENANT_MODULES,
  areSubjectsInSameOptionalGroup,
  buildDefaultLevelSubjectsMap,
  buildDefaultLevelWeeklyLessonsMap,
  CLASS_TEACHER_SUBJECT_TOKEN,
  computeAssessmentGrade,
  DEFAULT_ROLE_MODULES,
  DEFAULT_SUBJECT_WEEKLY_LESSONS,
  DEFAULT_TENANT_BRANDING,
  DEFAULT_TIER_LEARNER_CAPS,
  APPROVAL_COMMITTEES,
  EXPENSE_ATTACHMENT_TYPES,
  EXPENSE_CATEGORIES,
  deriveSchoolEmailDomain,
  findOptionalGroupForSubject,
  getClusterForGrade,
  getDoubleStartPeriodsFromSchedule,
  getTenantBellSchedule,
  getTenantLessonRows,
  getTenantPeriodTimes,
  isSlotWithinSubjectTimeWindow,
  normalizeBellSchedule,
  PUBLIC_EMAIL_DOMAINS,
  resolveSubjectConstraint,
  sanitizeSchoolEmailDomain,
  getLessonsPerWeekForSubject,
  getStreamsForGrade,
  getSubjectsForGrade,
  getSubjectsForLevel,
  getTeacherAssignedSubjectsForCohort,
  isDateInLeaveChit,
  isSingleTeacherGrade,
  isTeacherAssignedToCohort,
  KENYAN_BELL_SCHEDULE,
  KENYAN_CBC_CLUSTERS,
  KENYAN_CBC_GRADES,
  KENYAN_CBC_SUBJECTS,
  MAX_FEE_VOTELINES,
  validatePasswordStrength,
  type AcademicTerm,
  type AcademicYear,
  type AdminAuditEntry,
  type AdmissionApplication,
  type AdmissionStage,
  type Announcement,
  type ApprovalCommittee,
  type ApprovalDecision,
  type ApprovalSignOffRecord,
  type AttendanceRecord,
  type AttendanceStatus,
  type BellScheduleRow,
  type BudgetAllocation,
  type BudgetApprovalStatus,
  type CalendarEntityStatus,
  type CbcClusterId,
  type CreditNoteRecord,
  type CurrencyCode,
  DEFAULT_CURRENCY,
  type DayOfWeek,
  type DevCollectionStorageStat,
  type DevPlatformTelemetry,
  type DevTenantTelemetryRow,
  type DirectMessage,
  type EtimsVerificationRecord,
  type EtimsVerificationStatus,
  type ExamCycle,
  type ExamResult,
  type ExamResultStatus,
  type ExpenseAttachment,
  type ExpenseAttachmentType,
  type ExpenseCategory,
  type ExpenseStatus,
  type FeeInvoice,
  type FeeStructure,
  type FeeVoteline,
  type FeeWaiverKind,
  type FeeWaiverMode,
  type FeeWaiverRecord,
  type FinanceAuditEntry,
  type IndependentVotelineItem,
  type IndependentVotelinePayment,
  type LeaveOutChit,
  type LifecycleAuditAction,
  type LifecycleAuditEntry,
  type MpesaEnvironment,
  type MpesaTransactionLog,
  type NonTeachingStaffProfile,
  type NotificationCategory,
  type NotificationItem,
  type OnboardingChecklist,
  type OptionalSubjectGroup,
  type PayeBand,
  type PaymentMethod,
  type PaymentRecord,
  type PayrollEntry,
  type PayrollStatutoryRateSchedule,
  type PayrollStatus,
  type PromotionAction,
  type PromotionExecuteItem,
  type PromotionExecuteResult,
  type PromotionPreviewRow,
  type PublicSchoolDirectoryItem,
  type ReconciliationChannel,
  type ReconciliationLine,
  type ReconciliationStatus,
  type SchoolExpense,
  type StaffAttendanceRecord,
  type StaffCategory,
  type Student,
  type StudentImportResult,
  type StudentImportRowValidation,
  type StudentStatus,
  type SubjectTimetableConstraint,
  type SubscriptionCycle,
  type SuperAdminTenantSummary,
  type TeacherClassAssignment,
  type TeacherProfile,
  type Tenant,
  type TenantBranding,
  type TenantModulePermission,
  type TenantMpesaConfig,
  type TenantPlan,
  type TenantStatus,
  type TenantUser,
  type TenantWorkspaceData,
  type TimetableLesson,
  type TimetableSlot,
  type TimetableSolveResult,
  type UserRole,
  type WhatsAppDispatchCategory,
  type WhatsAppDispatchRecord,
} from '../src/shared/types.ts';
import {
  buildDefaultApprovalsForTenant,
  buildDefaultBudgetsForTenant,
  buildDefaultEtimsChecksForTenant,
  buildDefaultExpensesForTenant,
  buildDefaultNonTeachingStaff,
  buildDefaultPayrollForTenant,
  buildDefaultReconciliationForTenant,
  computeLetterGrade,
  computeStatutoryDeductions,
  createEmptyDatabase,
  createSeedDatabase,
  DEFAULT_STATUTORY_RATE_SCHEDULES,
  PERIOD_TIMES,
  selectActiveStatutorySchedule,
  type DatabaseState,
  type StoredTenantUser,
} from './seed.ts';
import {
  DEVELOPER_EMAIL,
  generateOneTimePassword,
  hashPassword,
  resolveDeveloperBootstrapPassword,
  isSessionSecretConfigured,
  verifyPassword,
} from './middleware/adminAuth.ts';
import { isSmsProviderConfigured, sendSms, SmsNotConfiguredError } from './lib/sms.ts';
import { solveTimetable, type SolverDay, type SolverPlacement } from './lib/timetableSolver.ts';

// Set DATA_DIR to a persistent disk path in production (e.g. /var/data on Render).
// On Vercel the filesystem is read-only except /tmp, which is per-instance and
// temporary unless backed by KV_REST_API_URL + KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_*).
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : process.env.VERCEL
  ? '/tmp/elimunest-data'
  : path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'elimunest-db.json');
const LEGACY_DB_FILE = path.join(DATA_DIR, 'scholara-db.json');
const KV_STATE_KEY = process.env.ELIMUNEST_KV_KEY?.trim() || 'elimunest:db:v1';

interface KvRestConfig {
  url: string;
  token: string;
}

function resolveKvConfig(): KvRestConfig | null {
  const url = (
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    ''
  )
    .trim()
    .replace(/\/+$/, '');
  const token = (
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    ''
  ).trim();
  return url && token ? { url, token } : null;
}

export function isKvConfigured(): boolean {
  return resolveKvConfig() !== null;
}

export function getStoragePersistenceMeta(): {
  storageMode: 'Persistent Disk' | 'KV Durable Sync' | 'Ephemeral (/tmp)' | 'Local JSON Store';
  persistentStorage: boolean;
  kvConfigured: boolean;
  sessionSecretConfigured: boolean;
  dataDir: string;
} {
  const kvConfigured = isKvConfigured();
  const isVercel = Boolean(process.env.VERCEL);
  const hasExplicitDataDir = Boolean(process.env.DATA_DIR?.trim());
  const storageMode = kvConfigured
    ? 'KV Durable Sync'
    : hasExplicitDataDir
    ? 'Persistent Disk'
    : isVercel
    ? 'Ephemeral (/tmp)'
    : 'Local JSON Store';
  return {
    storageMode,
    persistentStorage: !isVercel || hasExplicitDataDir || kvConfigured,
    kvConfigured,
    sessionSecretConfigured: isSessionSecretConfigured(),
    dataDir: DATA_DIR,
  };
}

const LEGACY_SUBJECT_ALIASES: Record<string, string> = {
  'CRE / IRE': 'Religious Education (CRE / IRE / HRE)',
};

const SEEDED_OAKRIDGE_TEACHER_SUBJECTS: Record<string, string[]> = {
  't-oak-1': [
    'Mathematics',
    'Core Mathematics',
    'Pre-Technical Studies',
    'Physics',
    'Business Studies',
  ],
  't-oak-2': [
    'Integrated Science',
    'Science & Technology',
    'Agriculture & Nutrition',
    'Biology',
    'Chemistry',
  ],
  't-oak-3': [
    'English',
    'Creative Arts',
    'Creative Arts & Sports',
    'Physical Education (PE)',
  ],
  't-oak-4': [
    'Kiswahili',
    'Religious Education (CRE / IRE / HRE)',
    'Community Service Learning (CSL)',
  ],
  't-oak-5': [
    'Social Studies',
    'Computer Studies',
    'History & Citizenship',
    'Geography',
  ],
};

export class ConflictError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 409) {
    super(message);
    this.statusCode = statusCode;
  }
}

export class TenantStore {
  private state: DatabaseState;
  private onBroadcast?: (tenantId: string, eventType: string, payload: unknown) => void;
  private passwordResetChallenges = new Map<
    string,
    { code: string; expiresAt: number; attempts: number }
  >();
  private loginAttempts = new Map<string, { count: number; lockedUntil: number }>();
  private resetRequestsByEmail = new Map<string, number[]>();
  private resetRequestsByIp = new Map<string, number[]>();
  private initPromise: Promise<void> | null = null;
  private kvHydrationPromise: Promise<void> | null = null;
  private kvSyncChain: Promise<void> = Promise.resolve();

  constructor(onBroadcast?: (tenantId: string, eventType: string, payload: unknown) => void) {
    this.onBroadcast = onBroadcast;
    const loaded = this.loadExistingDatabase();
    if (loaded) {
      this.state = loaded;
    } else {
      this.state = createEmptyDatabase();
      this.initPromise = this.initializeFreshDatabase();
    }
  }

  private async initializeFreshDatabase(): Promise<void> {
    const isProd = process.env.NODE_ENV === 'production';
    const isTest = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
    const { state, devCredentials } = await createSeedDatabase({ empty: isProd || isTest });
    // Only apply if no data was loaded in the meantime
    if (this.state.tenants.length === 0 && this.state.users.length === 0) {
      this.state = state;
      if (!isProd && !isTest) {
        this.persist(state);
        if (devCredentials.length > 0) {
          console.log('[elimuNest] Seeded development demo accounts (one-time random passwords, change required on first login):');
          for (const cred of devCredentials) {
            console.log(`  - ${cred.role.padEnd(11)} | ${cred.email} | ${cred.password}`);
          }
        }
      }
    }
  }

  async ensureInitialized(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
    }
  }

  setBroadcaster(fn: (tenantId: string, eventType: string, payload: unknown) => void) {
    this.onBroadcast = fn;
  }

  private developerEnsured = false;

  async ensureHydrated(): Promise<void> {
    await this.hydrateFromKvIfConfigured();
    await this.ensureDeveloperAccount();
  }

  /** Creates developer@elimunest.platform if missing. Never overwrites an existing account/password. */
  private async ensureDeveloperAccount(): Promise<void> {
    if (this.developerEnsured) return;
    this.developerEnsured = true;
    const exists = (this.state.users || []).some(
      (u) => u.email.toLowerCase() === DEVELOPER_EMAIL
    );
    if (exists) return;
    const { password, fromEnv } = resolveDeveloperBootstrapPassword();
    this.state.users.push({
      id: 'usr-platform-dev',
      tenantId: 'platform',
      fullName: 'Lead Platform Engineer',
      email: DEVELOPER_EMAIL,
      phone: '',
      role: 'Developer',
      passwordHash: await hashPassword(password),
      status: 'Active',
      mustChangePassword: true,
      tokenVersion: 0,
      allowedModules: [...DEFAULT_ROLE_MODULES.Developer],
      createdAt: new Date().toISOString(),
    });
    this.persist();
    console.log(
      fromEnv
        ? `[elimuNest] Created ${DEVELOPER_EMAIL} with the password from DEVELOPER_BOOTSTRAP_PASSWORD (change required on first login).`
        : `[elimuNest] Created ${DEVELOPER_EMAIL} with one-time password: ${password} (change required on first login). Set DEVELOPER_BOOTSTRAP_PASSWORD to choose your own.`
    );
  }

  private async hydrateFromKvIfConfigured(): Promise<void> {
    await this.ensureInitialized();
    const kv = resolveKvConfig();
    if (!kv) return;
    if (!this.kvHydrationPromise) {
      this.kvHydrationPromise = (async () => {
        try {
          const resp = await fetch(`${kv.url}/get/${encodeURIComponent(KV_STATE_KEY)}`, {
            headers: { Authorization: `Bearer ${kv.token}` },
          });
          if (!resp.ok) return;
          const body = (await resp.json()) as { result?: string | null };
          if (typeof body?.result === 'string' && body.result.trim()) {
            const parsed = JSON.parse(body.result) as DatabaseState;
            if (
              parsed &&
              Array.isArray(parsed.tenants) &&
              (parsed.tenants.length > 0 || (Array.isArray(parsed.users) && parsed.users.length > 0))
            ) {
              const { state: migrated } = this.migrateAndNormalizeState(parsed, false);
              this.state = migrated;
              this.writeDiskOnly(migrated);
              return;
            }
          }
          // KV has no snapshot yet: seed it from current state if non-empty
          if (this.state.tenants.length > 0 || this.state.users.length > 0) {
            await this.writeStateToKv(this.state);
          }
        } catch (err) {
          console.warn('[elimuNest] Remote KV hydration skipped:', err);
        }
      })();
    }
    await this.kvHydrationPromise;
  }

  async flushRemotePersist(): Promise<void> {
    try {
      await this.kvSyncChain;
    } catch {
      // ignore remote sync wait errors
    }
  }

  private async writeStateToKv(nextState: DatabaseState): Promise<void> {
    const kv = resolveKvConfig();
    if (!kv) return;
    try {
      const serialized = JSON.stringify(nextState);
      await fetch(`${kv.url}/set/${encodeURIComponent(KV_STATE_KEY)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${kv.token}`,
          'Content-Type': 'text/plain',
        },
        body: serialized,
      });
    } catch (err) {
      console.warn('[elimuNest] Remote KV persist failed:', err);
    }
  }

  private loadExistingDatabase(): DatabaseState | null {
    if (process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST)) {
      return null;
    }
    try {
      const candidateFiles = [DB_FILE, LEGACY_DB_FILE].filter(Boolean);
      const sourceFile = candidateFiles.find((filePath) => fs.existsSync(filePath)) || null;
      if (sourceFile) {
        const raw = fs.readFileSync(sourceFile, 'utf-8');
        const parsed = JSON.parse(raw) as DatabaseState;
        if (parsed && Array.isArray(parsed.tenants)) {
          const { state: migrated, dirty } = this.migrateAndNormalizeState(
            parsed,
            sourceFile !== DB_FILE
          );
          if (dirty) {
            this.persist(migrated);
          }
          return migrated;
        }
      }
    } catch (err) {
      console.warn('Database read/parse issue; backing up before re-initializing:', err);
      try {
        if (fs.existsSync(DB_FILE)) {
          fs.copyFileSync(DB_FILE, `${DB_FILE}.corrupt.${Date.now()}`);
        }
      } catch {
        // ignore backup error
      }
    }
    return null;
  }

  private migrateAndNormalizeState(
    parsed: DatabaseState,
    initiallyDirty: boolean
  ): { state: DatabaseState; dirty: boolean } {
    let dirty = initiallyDirty;

    if (!Array.isArray(parsed.students)) {
      parsed.students = [];
      dirty = true;
    }
    if (!Array.isArray(parsed.admissions)) {
      parsed.admissions = [];
      dirty = true;
    }
    if (!Array.isArray(parsed.timetable)) {
      parsed.timetable = [];
      dirty = true;
    }
    if (!Array.isArray(parsed.attendance)) {
      parsed.attendance = [];
      dirty = true;
    }
    if (!Array.isArray(parsed.staffAttendance)) {
      parsed.staffAttendance = [];
      dirty = true;
    }
    if (!Array.isArray(parsed.leaveOutChits)) {
      parsed.leaveOutChits = [];
      dirty = true;
    }
    if (!Array.isArray(parsed.examCycles)) {
      parsed.examCycles = [];
      dirty = true;
    }
    if (!Array.isArray(parsed.examResults)) {
      parsed.examResults = [];
      dirty = true;
    }
    if (!Array.isArray(parsed.feeStructures)) {
      parsed.feeStructures = [];
      dirty = true;
    }
    if (!Array.isArray(parsed.invoices)) {
      parsed.invoices = [];
      dirty = true;
    }
    if (!Array.isArray(parsed.announcements)) {
      parsed.announcements = [];
      dirty = true;
    }
    if (!Array.isArray(parsed.messages)) {
      parsed.messages = [];
      dirty = true;
    }
    if (!Array.isArray(parsed.notifications)) {
      parsed.notifications = [];
      dirty = true;
    }

    // Backfill missing student UPI codes without ever discarding existing tenants/learners
    parsed.students.forEach((s, idx) => {
      if (typeof s.upi !== 'string' || !s.upi.trim()) {
        const cleanCode = (s.studentCode || `${idx + 1001}`).replace(/[^A-Z0-9]/gi, '').toUpperCase();
        s.upi = `KEN-${cleanCode || `LRN${idx + 1}`}`;
        dirty = true;
      }
    });

    // Normalize legacy subject labels in timetable & examResults
    parsed.timetable.forEach((slot) => {
      if (LEGACY_SUBJECT_ALIASES[slot.subject]) {
        slot.subject = LEGACY_SUBJECT_ALIASES[slot.subject];
        dirty = true;
      }
    });
    parsed.examResults.forEach((res) => {
      if (LEGACY_SUBJECT_ALIASES[res.subject]) {
        res.subject = LEGACY_SUBJECT_ALIASES[res.subject];
        dirty = true;
      }
    });

    parsed.tenants.forEach((t) => {
      if (!Array.isArray(t.grades) || t.grades.length === 0) {
        t.grades = [...KENYAN_CBC_GRADES];
        dirty = true;
      }
      if (!Array.isArray(t.sections) || t.sections.length === 0) {
        t.sections = ['A', 'B'];
        dirty = true;
      }
      if (!Array.isArray(t.subjects)) {
        t.subjects = [...KENYAN_CBC_SUBJECTS];
        dirty = true;
      }
      if (!Array.isArray(t.teachers)) {
        t.teachers = [];
        dirty = true;
      }
      if (!Array.isArray(t.rooms)) {
        t.rooms = ['Room 101', 'Room 102'];
        dirty = true;
      }
      if (!t.gradeStreams) {
        const fallback = t.sections.length > 0 ? t.sections : ['A'];
        t.gradeStreams = Object.fromEntries(t.grades.map((g) => [g, [...fallback]]));
        dirty = true;
      }
            // Rename legacy subject tokens cleanly
            t.subjects = Array.from(
              new Set(t.subjects.map((sub) => LEGACY_SUBJECT_ALIASES[sub] || sub))
            );
            const isCbcTenant =
              /kenyan|cbc/i.test(t.curriculum) ||
              (t.grades.includes('Playgroup') && t.grades.includes('Grade 12'));

            if (!t.levelSubjects && isCbcTenant) {
              t.levelSubjects = buildDefaultLevelSubjectsMap();
              t.levelSubjectWeeklyLessons = buildDefaultLevelWeeklyLessonsMap();
              // Preserve any existing custom subjects and merge full KICD CBC union
              t.subjects = Array.from(new Set([...KENYAN_CBC_SUBJECTS, ...t.subjects]));
              dirty = true;
            } else if (t.levelSubjects && !t.levelSubjectWeeklyLessons) {
              t.levelSubjectWeeklyLessons = buildDefaultLevelWeeklyLessonsMap();
              dirty = true;
            }

            if (!t.subjectWeeklyLessons) {
              t.subjectWeeklyLessons = Object.fromEntries(
                t.subjects.map((sub) => [sub, getLessonsPerWeekForSubject(t, sub)])
              );
              dirty = true;
            } else {
              for (const [oldName, newName] of Object.entries(LEGACY_SUBJECT_ALIASES)) {
                if (t.subjectWeeklyLessons[oldName] !== undefined) {
                  if (t.subjectWeeklyLessons[newName] === undefined) {
                    t.subjectWeeklyLessons[newName] = t.subjectWeeklyLessons[oldName];
                  }
                  delete t.subjectWeeklyLessons[oldName];
                  dirty = true;
                }
              }
              if (isCbcTenant) {
                Object.entries(DEFAULT_SUBJECT_WEEKLY_LESSONS).forEach(([sub, cnt]) => {
                  if (t.subjectWeeklyLessons && t.subjectWeeklyLessons[sub] === undefined) {
                    t.subjectWeeklyLessons[sub] = cnt;
                    dirty = true;
                  }
                });
              }
            }

            t.teachers.forEach((tc) => {
              if (!Array.isArray(tc.subjects)) {
                tc.subjects = t.subjects.slice(0, 1);
                dirty = true;
              } else {
                const mapped = tc.subjects.map((s) => LEGACY_SUBJECT_ALIASES[s] || s);
                if (mapped.some((m, i) => m !== tc.subjects[i])) {
                  tc.subjects = Array.from(new Set(mapped));
                  dirty = true;
                }
              }
              // Extend Oakridge seeded teachers to cover new KICD Upper Primary / Senior subjects
              const seededExtension =
                t.id === 'tenant-oakridge' ? SEEDED_OAKRIDGE_TEACHER_SUBJECTS[tc.id] : undefined;
              if (seededExtension) {
                const merged = Array.from(new Set([...tc.subjects, ...seededExtension]));
                if (merged.length !== tc.subjects.length) {
                  tc.subjects = merged;
                  dirty = true;
                }
              }
              if (typeof tc.phone !== 'string') {
                tc.phone = '+254 700 000 000';
                dirty = true;
              }
              if (!Array.isArray(tc.assignedClasses)) {
                tc.assignedClasses = [];
                dirty = true;
              }
            });

            if (!Array.isArray(t.nonTeachingStaff) || t.nonTeachingStaff.length === 0) {
              const slugKey = t.slug || t.id;
              const prefix =
                t.id === 'tenant-oakridge'
                  ? 'oak'
                  : t.id === 'tenant-westfield'
                  ? 'west'
                  : t.id === 'tenant-stjude'
                  ? 'sj'
                  : slugKey.slice(0, 4);
              t.nonTeachingStaff = buildDefaultNonTeachingStaff(slugKey, prefix);
              dirty = true;
            }

            if (!t.status) {
              t.status = 'Active';
              dirty = true;
            }
            if (typeof t.learnerCap !== 'number' || !Number.isFinite(t.learnerCap) || t.learnerCap <= 0) {
              t.learnerCap = DEFAULT_TIER_LEARNER_CAPS[t.plan] || 600;
              dirty = true;
            }
            if (!t.subscriptionCycle) {
              t.subscriptionCycle = 'Annual';
              dirty = true;
            }
            if (!t.renewalDate) {
              t.renewalDate = '2027-08-31';
              dirty = true;
            }
            if (!t.emailDomain) {
              const seededDomains: Record<string, string> = {
                'tenant-oakridge': 'oakridge.ac.ke',
                'tenant-westfield': 'westfield.ac.ke',
                'tenant-stjude': 'stjude.ac.ke',
              };
              t.emailDomain = seededDomains[t.id] || deriveSchoolEmailDomain(t.slug || t.name);
              dirty = true;
            }
            const seededTenantMeta: Record<
              string,
              {
                contactEmail: string;
                contactPhone: string;
                postalAddress: string;
                forceKes?: boolean;
              }
            > = {
              'tenant-oakridge': {
                contactEmail: 'info@oakridge.ac.ke',
                contactPhone: '+254 712 408 100',
                postalAddress: 'P.O. Box 45812-00100, Nairobi',
                forceKes: true,
              },
              'tenant-westfield': {
                contactEmail: 'admissions@westfield.ac.ke',
                contactPhone: '+254 711 204 510',
                postalAddress: 'P.O. Box 81204-80100, Mombasa',
                forceKes: true,
              },
              'tenant-stjude': {
                contactEmail: 'office@stjude.ac.ke',
                contactPhone: '+254 715 630 142',
                postalAddress: 'P.O. Box 1924-40100, Kisumu',
                forceKes: true,
              },
            };
            const metaDef = seededTenantMeta[t.id];
            if (metaDef?.forceKes && t.currency !== 'KES') {
              t.currency = 'KES';
              dirty = true;
            } else if (t.currency !== 'KES' && t.currency !== 'USD') {
              t.currency = DEFAULT_CURRENCY;
              dirty = true;
            }
            if (!t.contactEmail) {
              t.contactEmail =
                metaDef?.contactEmail ||
                t.teachers?.[0]?.email ||
                `info@${t.emailDomain || 'school.ac.ke'}`;
              dirty = true;
            }
            if (!t.contactPhone) {
              t.contactPhone =
                metaDef?.contactPhone || t.teachers?.[0]?.phone || '+254 700 000 000';
              dirty = true;
            }
            if (!t.postalAddress) {
              t.postalAddress = metaDef?.postalAddress || t.location || '';
              dirty = true;
            }
            if (!t.branding || !t.branding.primaryColor) {
              const seededDefaults: Record<string, TenantBranding> = {
                'tenant-oakridge': {
                  primaryColor: '#2563EB',
                  accentColor: '#0284C7',
                  sidebarColor: '',
                  logoDataUrl: '',
                  tagline: 'Excellence & Integrity in CBC Learning',
                },
                'tenant-westfield': {
                  primaryColor: '#059669',
                  accentColor: '#0D9488',
                  sidebarColor: '#062C22',
                  logoDataUrl: '',
                  tagline: 'STEM Innovation & Coastal Leadership',
                },
                'tenant-stjude': {
                  primaryColor: '#9F1239',
                  accentColor: '#D97706',
                  sidebarColor: '#2A0B14',
                  logoDataUrl: '',
                  tagline: 'Global Perspectives, Rooted Values',
                },
              };
              t.branding = seededDefaults[t.id] || { ...DEFAULT_TENANT_BRANDING };
              dirty = true;
            }
          });
          if (!Array.isArray(parsed.leaveOutChits)) {
            parsed.leaveOutChits = [];
            dirty = true;
          }
          if (!Array.isArray(parsed.staffAttendance)) {
            parsed.staffAttendance = [];
            dirty = true;
          } else {
            parsed.staffAttendance.forEach((rec) => {
              if (!rec.staffCategory) {
                rec.staffCategory = 'Teaching';
                dirty = true;
              }
            });
          }

          // Normalize assessment cycle names to Term Opening, Mid-Term, and End of Term Exam
          const LEGACY_CYCLE_TITLES: Record<string, { title: string; term: string }> = {
            'Mid-Term Assessment (Oct 2026)': { title: 'Term 1 Mid-Term Exam', term: 'Term 1' },
            'Term 1 Final Examinations': { title: 'Term 1 End of Term Exam', term: 'Term 1' },
            'Fall Quarter Benchmark': { title: 'Term 1 Mid-Term Exam', term: 'Term 1' },
            'Michaelmas Mock Examinations': { title: 'Term 1 Mid-Term Exam', term: 'Term 1' },
          };
          parsed.examCycles.forEach((cyc) => {
            const mapped = LEGACY_CYCLE_TITLES[cyc.title];
            if (mapped) {
              cyc.title = mapped.title;
              cyc.term = mapped.term;
              dirty = true;
            }
          });

          parsed.tenants.forEach((t) => {
            const tCycles = parsed.examCycles.filter((c) => c.tenantId === t.id);
            const hasOpening = tCycles.some((c) => /opening/i.test(c.title));
            const hasMid = tCycles.some((c) => /mid[- ]?term/i.test(c.title));
            const hasEnd = tCycles.some((c) => /end\s*of\s*term/i.test(c.title));
            const baseTerm = /term\s*\d+/i.test(t.currentTerm) ? t.currentTerm : 'Term 1';
            if (!hasOpening) {
              const openId = t.id === 'tenant-oakridge' ? 'exm-oak-open' : `exm-${randomUUID().slice(0, 6)}`;
              parsed.examCycles.unshift({
                id: openId,
                tenantId: t.id,
                title: `${baseTerm} Opening Exam`,
                term: baseTerm,
                startDate: '2026-09-07',
                endDate: '2026-09-11',
                status: 'Published',
                createdAt: '2026-09-01T09:00:00Z',
              });
              dirty = true;
            }
            if (!hasMid) {
              parsed.examCycles.push({
                id: `exm-${randomUUID().slice(0, 6)}`,
                tenantId: t.id,
                title: `${baseTerm} Mid-Term Exam`,
                term: baseTerm,
                startDate: '2026-10-12',
                endDate: '2026-10-16',
                status: 'Published',
                createdAt: '2026-09-25T10:00:00Z',
              });
              dirty = true;
            }
            if (!hasEnd) {
              parsed.examCycles.push({
                id: `exm-${randomUUID().slice(0, 6)}`,
                tenantId: t.id,
                title: `${baseTerm} End of Term Exam`,
                term: baseTerm,
                startDate: '2026-11-18',
                endDate: '2026-11-24',
                status: 'Grading',
                createdAt: '2026-11-01T09:00:00Z',
              });
              dirty = true;
            }
          });

          // Seed baseline Term Opening Exam marks for Oakridge if missing
          const oakOpenCycle = parsed.examCycles.find(
            (c) => c.tenantId === 'tenant-oakridge' && /opening/i.test(c.title)
          );
          if (
            oakOpenCycle &&
            !parsed.examResults.some((r) => r.examCycleId === oakOpenCycle.id)
          ) {
            const midResults = parsed.examResults.filter(
              (r) => r.tenantId === 'tenant-oakridge' && r.examCycleId === 'exm-oak-1'
            );
            midResults.forEach((r, idx) => {
              const openScore = Math.max(40, r.score - (idx % 2 === 0 ? 4 : 2));
              const graded = computeAssessmentGrade(openScore, r.grade);
              parsed.examResults.push({
                id: `res-open-${r.studentId}-${idx}`,
                tenantId: 'tenant-oakridge',
                examCycleId: oakOpenCycle.id,
                studentId: r.studentId,
                studentName: r.studentName,
                studentCode: r.studentCode,
                grade: r.grade,
                section: r.section,
                subject: r.subject,
                score: openScore,
                maxScore: 100,
                letterGrade: graded.letterGrade,
                gpaPoints: graded.gpaPoints,
                remarks: 'Baseline Term Opening evaluation',
                updatedAt: '2026-09-12T10:00:00Z',
              });
            });
            dirty = true;
          }

          // Recompute grades across existing exam results using current CBE (all levels) & 8-4-4 (Grade 12 / Form 4)
          parsed.examResults.forEach((res) => {
            const stu = parsed.students.find((s) => s.id === res.studentId);
            const targetGrade = stu?.grade || res.grade;
            const computed = computeAssessmentGrade(res.score, targetGrade);
            if (res.letterGrade !== computed.letterGrade || res.gpaPoints !== computed.gpaPoints) {
              res.letterGrade = computed.letterGrade;
              res.gpaPoints = computed.gpaPoints;
              dirty = true;
            }
          });

          if (!Array.isArray(parsed.adminAuditLogs)) {
            parsed.adminAuditLogs = [];
            dirty = true;
          }

          // Backfill votelines on persisted feeStructures lacking customizable votelines
          parsed.feeStructures.forEach((fsItem) => {
            if (!Array.isArray(fsItem.votelines) || fsItem.votelines.length === 0) {
              fsItem.votelines = [
                { id: 'vl-tuition', name: 'Tuition Fee', amount: Number(fsItem.tuitionFee || 0) },
                { id: 'vl-lab', name: 'Laboratory Fee', amount: Number(fsItem.labFee || 0) },
                {
                  id: 'vl-tech',
                  name: 'Technology & ICT',
                  amount: Number(fsItem.technologyFee || 0),
                },
                {
                  id: 'vl-act',
                  name: 'Co-Curricular & Activities',
                  amount: Number(fsItem.activitiesFee || 0),
                },
              ];
              fsItem.totalFee = fsItem.votelines.reduce((sum, v) => sum + v.amount, 0);
              dirty = true;
            }
          });

          if (!Array.isArray(parsed.expenses)) {
            parsed.expenses = parsed.tenants.flatMap((t) =>
              buildDefaultExpensesForTenant(
                t.id,
                t.currency === 'USD' ? 'USD' : 'KES',
                t.slug.slice(0, 3).toUpperCase()
              )
            );
            dirty = true;
          }
          if (!Array.isArray(parsed.etimsChecks)) {
            parsed.etimsChecks = parsed.tenants.flatMap((t) =>
              buildDefaultEtimsChecksForTenant(
                t.id,
                t.currency === 'USD' ? 'USD' : 'KES',
                t.slug.slice(0, 3).toUpperCase()
              )
            );
            dirty = true;
          }
          if (!Array.isArray(parsed.reconciliationLines)) {
            parsed.reconciliationLines = parsed.tenants.flatMap((t) =>
              buildDefaultReconciliationForTenant(
                t.id,
                t.currency === 'USD' ? 'USD' : 'KES',
                t.slug.slice(0, 3).toUpperCase()
              )
            );
            dirty = true;
          }
          if (!Array.isArray(parsed.payrollEntries)) {
            parsed.payrollEntries = parsed.tenants.flatMap((t) =>
              buildDefaultPayrollForTenant(t, '2026-11')
            );
            dirty = true;
          }
          if (!Array.isArray(parsed.budgets)) {
            parsed.budgets = parsed.tenants.flatMap((t) => buildDefaultBudgetsForTenant(t));
            dirty = true;
          } else {
            const pendingCats = new Set<string>(['Transport & Fuel', 'ICT & Software']);
            parsed.budgets.forEach((b) => {
              if (!b.status) {
                const isPending = pendingCats.has(b.category);
                b.status = isPending ? 'Pending Approval' : 'Approved';
                if (!isPending) {
                  const t = parsed.tenants.find((x) => x.id === b.tenantId);
                  b.approvedBy = t?.teachers?.[0]?.name || 'School Principal / BOM';
                  b.approvedAt = b.updatedAt || '2026-11-01T08:00:00Z';
                  b.approvalNotes = 'Approved for current term operations.';
                } else {
                  b.approvalNotes = 'Awaiting specific departmental budget approval.';
                }
                dirty = true;
              }
            });
          }
          if (!Array.isArray(parsed.approvalRecords)) {
            parsed.approvalRecords = parsed.tenants.flatMap((t) =>
              buildDefaultApprovalsForTenant(
                t.id,
                t.currency === 'USD' ? 'USD' : 'KES',
                t.slug.slice(0, 3).toUpperCase()
              )
            );
            dirty = true;
          }
          if (!Array.isArray(parsed.whatsappDispatches)) {
            parsed.whatsappDispatches = [];
            dirty = true;
          }
          if ('mpesaSecrets' in (parsed as unknown as Record<string, unknown>)) {
            delete (parsed as unknown as Record<string, unknown>).mpesaSecrets;
            dirty = true;
          }
          if (!parsed.mpesaWebhookHashes || typeof parsed.mpesaWebhookHashes !== 'object') {
            parsed.mpesaWebhookHashes = {};
            dirty = true;
          }
          if (!Array.isArray(parsed.mpesaTransactions)) {
            parsed.mpesaTransactions = [];
            dirty = true;
          }
          if (!Array.isArray(parsed.independentVotelines)) {
            parsed.independentVotelines = [];
            dirty = true;
          }
          parsed.tenants.forEach((t) => {
            if (t.mpesaConfig) {
              const rawCfg = t.mpesaConfig as unknown as Record<string, unknown>;
              for (const legacyKey of [
                'consumerKey',
                'hasConsumerSecret',
                'consumerSecretMasked',
                'hasPasskey',
                'passkeyMasked',
              ]) {
                if (legacyKey in rawCfg) {
                  delete rawCfg[legacyKey];
                  dirty = true;
                }
              }
              if (!parsed.mpesaWebhookHashes![t.id]) {
                const secret = randomBytes(24).toString('hex');
                parsed.mpesaWebhookHashes![t.id] = createHash('sha256').update(secret).digest('hex');
                t.mpesaConfig.hasWebhookSecret = true;
                t.mpesaConfig.callbackUrl = `/api/mpesa/c2b-callback/••••${secret.slice(-4)}`;
                dirty = true;
              } else {
                t.mpesaConfig.hasWebhookSecret = true;
              }
            }
          });
          if (!Array.isArray(parsed.users)) {
            parsed.users = [];
            dirty = true;
          } else {
            parsed.users.forEach((u) => {
              if (u.role === 'Super Admin' && (!u.tenantId || u.tenantId === 'platform')) {
                u.tenantId = parsed.tenants[0]?.id || 'tenant-oakridge';
                if (u.fullName === 'Platform Super Admin') {
                  u.fullName = 'Oakridge Super Admin';
                }
                dirty = true;
              }
              if (!Array.isArray(u.allowedModules)) {
                u.allowedModules = [...(DEFAULT_ROLE_MODULES[u.role] || ['analytics'])];
                dirty = true;
              }
              if (typeof u.tokenVersion !== 'number') {
                u.tokenVersion = 0;
                dirty = true;
              }
            });
          }

          if (!Array.isArray(parsed.creditNotes)) {
            parsed.creditNotes = [];
            dirty = true;
          }
          if (!Array.isArray(parsed.feeWaivers)) {
            parsed.feeWaivers = [];
            dirty = true;
          }
          if (!Array.isArray(parsed.financeAuditLogs)) {
            parsed.financeAuditLogs = [];
            dirty = true;
          }
          if (!Array.isArray(parsed.statutoryRateSchedules) || parsed.statutoryRateSchedules.length === 0) {
            parsed.statutoryRateSchedules = JSON.parse(
              JSON.stringify(DEFAULT_STATUTORY_RATE_SCHEDULES)
            ) as PayrollStatutoryRateSchedule[];
            dirty = true;
          }
          for (const counterKey of [
            'receiptCounters',
            'studentCounters',
            'invoiceCounters',
            'admissionCounters',
            'voucherCounters',
            'creditNoteCounters',
          ] as const) {
            if (!parsed[counterKey] || typeof parsed[counterKey] !== 'object') {
              parsed[counterKey] = {};
              dirty = true;
            }
          }

          // Migrate legacy 'Verified' eTIMS status to honest 'Checked manually'
          parsed.etimsChecks.forEach((chk) => {
            if ((chk.status as string) === 'Verified') {
              chk.status = 'Checked manually';
              dirty = true;
            }
          });
          parsed.expenses.forEach((exp) => {
            if ((exp.etimsStatus as string) === 'Verified') {
              exp.etimsStatus = 'Checked manually';
              dirty = true;
            }
            if (!exp.createdByUserId) {
              exp.createdByUserId = `usr-${exp.tenantId}-bursar`;
              dirty = true;
            }
          });
          parsed.payrollEntries.forEach((p) => {
            if (!p.createdByUserId) {
              p.createdByUserId = `usr-${p.tenantId}-bursar`;
              dirty = true;
            }
            if (p.employerNssf === undefined) {
              const t = parsed.tenants.find((x) => x.id === p.tenantId);
              const stat = computeStatutoryDeductions(
                p.grossPay,
                t?.currency === 'USD' ? 'USD' : 'KES',
                parsed.statutoryRateSchedules,
                p.payPeriod
              );
              p.employerNssf = stat.employerNssf;
              p.employerHousingLevy = stat.employerHousingLevy;
              p.employerNita = stat.employerNita;
              p.totalEmployerCost = p.grossPay + stat.employerNssf + stat.employerHousingLevy + stat.employerNita;
              p.statutoryScheduleId = stat.scheduleId;
              dirty = true;
            }
          });
          parsed.budgets.forEach((b) => {
            if (!b.createdByUserId) {
              b.createdByUserId = `usr-${b.tenantId}-bursar`;
              dirty = true;
            }
          });
          parsed.approvalRecords.forEach((a) => {
            if (!a.createdByUserId) {
              a.createdByUserId = `usr-${a.tenantId}-bursar`;
              dirty = true;
            }
          });

          // Initialize monotonic counters above existing tenant counts
          parsed.tenants.forEach((t) => {
            const stuCount = parsed.students.filter((s) => s.tenantId === t.id).length;
            if ((parsed.studentCounters![t.id] || 0) < stuCount) {
              parsed.studentCounters![t.id] = stuCount;
              dirty = true;
            }
            const invCount = parsed.invoices.filter((i) => i.tenantId === t.id).length;
            if ((parsed.invoiceCounters![t.id] || 0) < invCount) {
              parsed.invoiceCounters![t.id] = invCount;
              dirty = true;
            }
            const admCount = parsed.admissions.filter((a) => a.tenantId === t.id).length;
            if ((parsed.admissionCounters![t.id] || 0) < admCount) {
              parsed.admissionCounters![t.id] = admCount;
              dirty = true;
            }
            const expCount = parsed.expenses.filter((e) => e.tenantId === t.id).length;
            if ((parsed.voucherCounters![t.id] || 0) < expCount) {
              parsed.voucherCounters![t.id] = expCount;
              dirty = true;
            }
            const payCount = parsed.invoices
              .filter((i) => i.tenantId === t.id)
              .reduce((sum, i) => sum + (i.payments?.length || 0), 0);
            if ((parsed.receiptCounters![t.id] || 0) < payCount) {
              parsed.receiptCounters![t.id] = payCount;
              dirty = true;
            }
            const cnCount = (parsed.creditNotes || []).filter((c) => c.tenantId === t.id).length;
            if ((parsed.creditNoteCounters![t.id] || 0) < cnCount) {
              parsed.creditNoteCounters![t.id] = cnCount;
              dirty = true;
            }
          });

          if (!Array.isArray(parsed.academicYears)) {
            parsed.academicYears = [];
            dirty = true;
          }
          if (!Array.isArray(parsed.academicTerms)) {
            parsed.academicTerms = [];
            dirty = true;
          }
          if (!Array.isArray(parsed.lifecycleAuditLogs)) {
            parsed.lifecycleAuditLogs = [];
            dirty = true;
          }

          parsed.tenants.forEach((t) => {
            let tenantYears = parsed.academicYears!.filter((y) => y.tenantId === t.id);
            if (tenantYears.length === 0) {
              const yearId = `ay-${t.id.replace(/[^a-z0-9]/gi, '').slice(0, 8)}-${randomUUID().slice(0, 4)}`;
              const yr: AcademicYear = {
                id: yearId,
                tenantId: t.id,
                name: t.academicYear || '2026–2027',
                startDate: '2026-09-01',
                endDate: '2027-07-31',
                status: 'Open',
                isCurrent: true,
                createdAt: t.createdAt || new Date().toISOString(),
              };
              parsed.academicYears!.push(yr);
              tenantYears = [yr];
              dirty = true;
            }
            const currentYear = tenantYears.find((y) => y.isCurrent) || tenantYears[0];
            let tenantTerms = parsed.academicTerms!.filter((term) => term.tenantId === t.id);
            if (tenantTerms.length === 0) {
              const t1: AcademicTerm = {
                id: `term-${t.id.replace(/[^a-z0-9]/gi, '').slice(0, 8)}-1`,
                tenantId: t.id,
                academicYearId: currentYear.id,
                name: t.currentTerm || 'Term 1',
                startDate: '2026-09-01',
                endDate: '2026-12-15',
                status: 'Open',
                isCurrent: true,
                createdAt: t.createdAt || new Date().toISOString(),
              };
              parsed.academicTerms!.push(t1);
              tenantTerms = [t1];
              dirty = true;
            }
            const currentTerm = tenantTerms.find((term) => term.isCurrent) || tenantTerms[0];

            const matchTerm = (termName?: string, dateStr?: string): AcademicTerm => {
              if (dateStr) {
                const byDate = tenantTerms.find(
                  (tr) => tr.startDate <= dateStr && dateStr <= tr.endDate
                );
                if (byDate) return byDate;
              }
              if (termName) {
                const clean = termName.trim().toLowerCase();
                const base = clean.replace(/\s*\([^)]*\)\s*/g, '').trim();
                const byName =
                  tenantTerms.find((tr) => tr.name.trim().toLowerCase() === clean) ||
                  tenantTerms.find(
                    (tr) =>
                      tr.name.trim().toLowerCase().replace(/\s*\([^)]*\)\s*/g, '').trim() === base
                  );
                if (byName) return byName;
              }
              return currentTerm;
            };

            parsed.examCycles.forEach((cyc) => {
              if (cyc.tenantId === t.id && !cyc.termId) {
                const matched = matchTerm(cyc.term, cyc.startDate);
                cyc.termId = matched.id;
                cyc.academicYearId = matched.academicYearId;
                dirty = true;
              }
            });
            parsed.attendance.forEach((att) => {
              if (att.tenantId === t.id && !att.termId) {
                att.termId = matchTerm(undefined, att.date).id;
                dirty = true;
              }
            });
            parsed.leaveOutChits.forEach((chit) => {
              if (chit.tenantId === t.id && !chit.termId) {
                chit.termId = matchTerm(undefined, chit.startDate).id;
                dirty = true;
              }
            });
            parsed.feeStructures.forEach((fsItem) => {
              if (fsItem.tenantId === t.id && !fsItem.termId) {
                fsItem.termId = matchTerm(fsItem.term).id;
                dirty = true;
              }
            });
            parsed.invoices.forEach((inv) => {
              if (inv.tenantId === t.id && !inv.termId) {
                inv.termId = matchTerm(inv.term).id;
                dirty = true;
              }
            });
            parsed.independentVotelines!.forEach((ivl) => {
              if (ivl.tenantId === t.id && !ivl.termId) {
                ivl.termId = matchTerm(ivl.term).id;
                dirty = true;
              }
            });
            parsed.feeWaivers!.forEach((wv) => {
              if (wv.tenantId === t.id && !wv.termId) {
                wv.termId = matchTerm(wv.term).id;
                dirty = true;
              }
            });
          });
    // Parent linking migration: workspace access is now driven by Student.parentUserId only.
    // Grandfather links that previously resolved through a guardianEmail match so existing
    // parents keep access, then stop trusting the email string at read time.
    if (Array.isArray(parsed.users) && Array.isArray(parsed.students)) {
      const parentsByTenantEmail = new Map<string, string>();
      for (const u of parsed.users) {
        if (u.role === 'Parent' && u.email) {
          parentsByTenantEmail.set(`${u.tenantId}::${u.email.trim().toLowerCase()}`, u.id);
        }
      }
      for (const st of parsed.students) {
        if (st.parentUserId || !st.guardianEmail) continue;
        const match = parentsByTenantEmail.get(
          `${st.tenantId}::${st.guardianEmail.trim().toLowerCase()}`
        );
        if (match) {
          st.parentUserId = match;
          dirty = true;
        }
      }
    }

    return { state: parsed, dirty };
  }

  private writeDiskOnly(nextState: DatabaseState) {
    if (process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST)) {
      return;
    }
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmpFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(nextState, null, 2), 'utf-8');
    fs.renameSync(tmpFile, DB_FILE);
  }

  private persist(nextState: DatabaseState = this.state) {
    this.writeDiskOnly(nextState);
    if (process.env.NODE_ENV !== 'test' && !process.env.VITEST && isKvConfigured()) {
      this.kvSyncChain = this.kvSyncChain.then(() => this.writeStateToKv(nextState));
    }
  }

  async resetForTests(options?: { empty?: boolean }) {
    if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
      throw new Error('resetForTests can only be used in test mode');
    }
    this.passwordResetChallenges.clear();
    this.loginAttempts.clear();
    this.resetRequestsByEmail.clear();
    this.resetRequestsByIp.clear();
    const { state, devCredentials } = await createSeedDatabase({ empty: Boolean(options?.empty) });
    this.state = state;
    this.developerEnsured = false;
    await this.ensureDeveloperAccount();
    return { devCredentials };
  }

  exportDatabaseState(): { exportedAt: string; fileName: string; state: DatabaseState } {
    return {
      exportedAt: new Date().toISOString(),
      fileName: `elimunest-backup-${new Date().toISOString().slice(0, 10)}.json`,
      state: JSON.parse(JSON.stringify(this.state)) as DatabaseState,
    };
  }

  restoreDatabaseState(rawInput: unknown): {
    restoredTenants: number;
    restoredUsers: number;
    restoredStudents: number;
  } {
    const candidate =
      rawInput && typeof rawInput === 'object' && 'state' in rawInput
        ? (rawInput as { state: unknown }).state
        : rawInput;
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      !Array.isArray((candidate as DatabaseState).tenants) ||
      (candidate as DatabaseState).tenants.length === 0
    ) {
      throw new ConflictError(
        'Invalid database snapshot: expected a JSON export containing a non-empty tenants array.',
        400
      );
    }

    const cloned = JSON.parse(JSON.stringify(candidate)) as DatabaseState;
    const { state: migrated } = this.migrateAndNormalizeState(cloned, true);
    this.state = migrated;
    this.persist(migrated);

    migrated.tenants.forEach((t) => {
      this.syncTenant(t.id, 'database:restored');
    });

    return {
      restoredTenants: migrated.tenants.length,
      restoredUsers: (migrated.users || []).length,
      restoredStudents: migrated.students.length,
    };
  }

  private pushNotification(
    tenantId: string,
    category: NotificationCategory,
    title: string,
    description: string,
    targetModule: string
  ): NotificationItem {
    const item: NotificationItem = {
      id: `notif-${randomUUID().slice(0, 8)}`,
      tenantId,
      category,
      title,
      description,
      targetModule,
      read: false,
      createdAt: new Date().toISOString(),
    };
    this.state.notifications.unshift(item);
    // Keep last 80 notifications per tenant
    const tenantCount = this.state.notifications.filter((n) => n.tenantId === tenantId).length;
    if (tenantCount > 80) {
      let seen = 0;
      this.state.notifications = this.state.notifications.filter((n) => {
        if (n.tenantId !== tenantId) return true;
        seen += 1;
        return seen <= 80;
      });
    }
    this.persist();
    this.onBroadcast?.(tenantId, 'notification:new', item);
    return item;
  }

  private syncTenant(tenantId: string, reason: string) {
    this.onBroadcast?.(tenantId, 'workspace:sync', { reason, timestamp: new Date().toISOString() });
  }

  private requireTenant(tenantId: string): Tenant {
    const tenant = this.state.tenants.find((t) => t.id === tenantId);
    if (!tenant) {
      throw new ConflictError(`Tenant not found: ${tenantId}`, 404);
    }
    return tenant;
  }

  getTenantById(tenantId: string): Tenant {
    return this.requireTenant(tenantId);
  }

  getTenantStatus(tenantId: string): TenantStatus | null {
    const found = this.state.tenants.find((t) => t.id === tenantId);
    return found ? found.status || 'Active' : null;
  }

  listTenants(): Tenant[] {
    return this.state.tenants;
  }

  listAllUsers(): TenantUser[] {
    return (this.state.users || []).map((u) => this.toPublicUser(u));
  }

  updateTenantLifecycle(
    tenantId: string,
    patch: {
      plan?: TenantPlan;
      learnerCap?: number;
      subscriptionCycle?: SubscriptionCycle;
      renewalDate?: string;
      status?: TenantStatus;
      suspensionReason?: string;
      suspendedAt?: string;
      suspendedBy?: string;
    }
  ): Tenant {
    const tenant = this.requireTenant(tenantId);
    if (patch.plan) tenant.plan = patch.plan;
    if (typeof patch.learnerCap === 'number' && Number.isFinite(patch.learnerCap) && patch.learnerCap > 0) {
      tenant.learnerCap = Math.round(patch.learnerCap);
    }
    if (patch.subscriptionCycle) tenant.subscriptionCycle = patch.subscriptionCycle;
    if (patch.renewalDate !== undefined && patch.renewalDate.trim()) {
      tenant.renewalDate = patch.renewalDate.trim();
    }
    if (patch.status) {
      tenant.status = patch.status;
      if (patch.status === 'Suspended') {
        tenant.suspensionReason =
          (patch.suspensionReason || '').trim() || 'Platform kill switch engaged by Developer Control Plane.';
        tenant.suspendedAt = patch.suspendedAt || new Date().toISOString();
        tenant.suspendedBy = patch.suspendedBy || 'developer@elimunest.platform';
      } else {
        tenant.suspensionReason = undefined;
        tenant.suspendedAt = undefined;
        tenant.suspendedBy = undefined;
      }
    }
    this.persist();
    this.syncTenant(tenantId, 'tenant:lifecycle-updated');
    return tenant;
  }

  getPlatformTelemetrySnapshot(wsConnectedClients = 0): DevPlatformTelemetry {
    let diskBytes = 0;
    try {
      if (fs.existsSync(DB_FILE)) {
        diskBytes = fs.statSync(DB_FILE).size;
      }
    } catch {
      diskBytes = 0;
    }

    const collectionMap: Array<[string, unknown[]]> = [
      ['tenants', this.state.tenants],
      ['users', this.state.users || []],
      ['students', this.state.students],
      ['admissions', this.state.admissions],
      ['timetable', this.state.timetable],
      ['attendance', this.state.attendance],
      ['staffAttendance', this.state.staffAttendance],
      ['leaveOutChits', this.state.leaveOutChits],
      ['examCycles', this.state.examCycles],
      ['examResults', this.state.examResults],
      ['feeStructures', this.state.feeStructures],
      ['invoices', this.state.invoices],
      ['creditNotes', this.state.creditNotes || []],
      ['feeWaivers', this.state.feeWaivers || []],
      ['independentVotelines', this.state.independentVotelines || []],
      ['mpesaTransactions', this.state.mpesaTransactions || []],
      ['expenses', this.state.expenses],
      ['etimsChecks', this.state.etimsChecks || []],
      ['reconciliationLines', this.state.reconciliationLines || []],
      ['payrollEntries', this.state.payrollEntries || []],
      ['budgets', this.state.budgets || []],
      ['approvalRecords', this.state.approvalRecords || []],
      ['financeAuditLogs', this.state.financeAuditLogs || []],
      ['statutoryRateSchedules', this.state.statutoryRateSchedules || []],
      ['announcements', this.state.announcements],
      ['messages', this.state.messages],
      ['whatsappDispatches', this.state.whatsappDispatches || []],
      ['notifications', this.state.notifications],
      ['adminAuditLogs', this.state.adminAuditLogs || []],
    ];

    const collections: DevCollectionStorageStat[] = collectionMap.map(([collection, arr]) => ({
      collection,
      records: Array.isArray(arr) ? arr.length : 0,
      bytes: Buffer.byteLength(JSON.stringify(arr ?? []), 'utf-8'),
    }));

    collections.sort((a, b) => b.bytes - a.bytes);
    const totalRecords = collections.reduce((sum, c) => sum + c.records, 0);
    const serializedBytes = Buffer.byteLength(JSON.stringify(this.state), 'utf-8');
    if (diskBytes === 0) diskBytes = serializedBytes;

    const byPlan: Record<TenantPlan, number> = {
      Starter: 0,
      Growth: 0,
      Enterprise: 0,
    };
    let activeTenants = 0;
    let trialTenants = 0;
    let suspendedTenants = 0;
    let totalCapacity = 0;
    let totalEnrolled = 0;
    let totalActiveLearners = 0;
    let totalTeachers = 0;

    const tenantRows: DevTenantTelemetryRow[] = this.state.tenants.map((tenant) => {
      const status = tenant.status || 'Active';
      if (status === 'Suspended') suspendedTenants += 1;
      else if (status === 'Trial') trialTenants += 1;
      else activeTenants += 1;

      const plan: TenantPlan =
        tenant.plan === 'Starter' || tenant.plan === 'Growth' || tenant.plan === 'Enterprise'
          ? tenant.plan
          : 'Growth';
      byPlan[plan] += 1;

      const tenantStudents = this.state.students.filter((s) => s.tenantId === tenant.id && !s.deleted);
      const activeLearners = tenantStudents.filter(
        (s) => s.status === 'Active' || s.status === 'On Leave'
      ).length;
      const cap =
        typeof tenant.learnerCap === 'number' && tenant.learnerCap > 0
          ? tenant.learnerCap
          : DEFAULT_TIER_LEARNER_CAPS[plan];
      const utilizationPct = cap > 0 ? Math.min(999, Math.round((activeLearners / cap) * 1000) / 10) : 0;

      totalCapacity += cap;
      totalEnrolled += tenantStudents.length;
      totalActiveLearners += activeLearners;
      totalTeachers += tenant.teachers.length;

      const staffUsersCount = (this.state.users || []).filter(
        (u) => u.tenantId === tenant.id
      ).length;
      const admissionsPending = this.state.admissions.filter(
        (a) => a.tenantId === tenant.id && a.stage !== 'Enrolled'
      ).length;
      const tenantInvoices = this.state.invoices.filter((i) => i.tenantId === tenant.id);
      const totalBilled = tenantInvoices.reduce((s, i) => s + i.totalAmount, 0);
      const totalCollected = tenantInvoices.reduce((s, i) => s + i.paidAmount, 0);

      const estimatedDataBytes = Buffer.byteLength(
        JSON.stringify({
          tenant,
          students: tenantStudents,
          admissions: this.state.admissions.filter((a) => a.tenantId === tenant.id),
          timetable: this.state.timetable.filter((t) => t.tenantId === tenant.id),
          attendance: this.state.attendance.filter((a) => a.tenantId === tenant.id),
          examResults: this.state.examResults.filter((r) => r.tenantId === tenant.id),
          invoices: tenantInvoices,
          expenses: this.state.expenses.filter((e) => e.tenantId === tenant.id),
        }),
        'utf-8'
      );

      return {
        tenant,
        totalLearners: tenantStudents.length,
        activeLearners,
        learnerCap: cap,
        utilizationPct,
        staffUsersCount,
        teachersCount: tenant.teachers.length,
        nonTeachingCount: (tenant.nonTeachingStaff || []).length,
        admissionsPending,
        invoiceCount: tenantInvoices.length,
        totalBilled,
        totalCollected,
        estimatedDataBytes,
      };
    });

    const pendingAdmissions = this.state.admissions.filter((a) => a.stage !== 'Enrolled').length;
    const totalStaffAccounts = (this.state.users || []).filter(
      (u) => u.tenantId !== 'platform'
    ).length;
    const mem = process.memoryUsage();
    const persistenceMeta = getStoragePersistenceMeta();

    return {
      generatedAt: new Date().toISOString(),
      tenants: {
        total: this.state.tenants.length,
        active: activeTenants,
        trial: trialTenants,
        suspended: suspendedTenants,
        byPlan,
      },
      learners: {
        totalEnrolled,
        activeLearners: totalActiveLearners,
        totalCapacity,
        globalUtilizationPct:
          totalCapacity > 0 ? Math.round((totalEnrolled / totalCapacity) * 1000) / 10 : 0,
        pendingAdmissions,
        totalStaffAccounts,
        totalTeachers,
      },
      database: {
        engine: persistenceMeta.kvConfigured
          ? 'JSON Store + KV Durable Sync'
          : 'JSON File Store (Atomic Write)',
        filePathName: path.basename(DB_FILE),
        diskBytes,
        serializedBytes,
        totalRecords,
        storageMode: persistenceMeta.storageMode,
        persistentStorage: persistenceMeta.persistentStorage,
        kvConfigured: persistenceMeta.kvConfigured,
        sessionSecretConfigured: persistenceMeta.sessionSecretConfigured,
        collections,
      },
      runtime: {
        nodeVersion: process.version,
        uptimeSeconds: Math.round(process.uptime()),
        rssBytes: mem.rss,
        heapUsedBytes: mem.heapUsed,
        heapTotalBytes: mem.heapTotal,
        wsConnectedClients,
      },
      tenantRows,
    };
  }

  private countEnrolledLearnersForCap(tenantId: string): number {
    return this.state.students.filter(
      (s) =>
        s.tenantId === tenantId &&
        !s.deleted &&
        s.status !== 'Graduated' &&
        s.status !== 'Transferred' &&
        s.status !== 'Withdrawn'
    ).length;
  }

  private getTenantLearnerCap(tenant: Tenant): number {
    return typeof tenant.learnerCap === 'number' && tenant.learnerCap > 0
      ? tenant.learnerCap
      : DEFAULT_TIER_LEARNER_CAPS[tenant.plan] || 600;
  }

  private assertLearnerCap(tenant: Tenant, additionalCount = 1) {
    const cap = this.getTenantLearnerCap(tenant);
    const currentCount = this.countEnrolledLearnersForCap(tenant.id);
    if (currentCount + additionalCount > cap) {
      throw new ConflictError(
        `Learner cap reached (${currentCount}/${cap}) for ${tenant.name} (${tenant.plan} tier). Raise learner cap or upgrade subscription in the Developer Panel.`,
        409
      );
    }
  }

  listAdminAuditLogs(limit = 50): AdminAuditEntry[] {
    const safeLimit = Math.max(1, Math.min(200, Math.round(limit)));
    return (this.state.adminAuditLogs || []).slice(0, safeLimit);
  }

  appendAdminAuditLog(entry: AdminAuditEntry): AdminAuditEntry {
    if (!Array.isArray(this.state.adminAuditLogs)) {
      this.state.adminAuditLogs = [];
    }
    this.state.adminAuditLogs.unshift(entry);
    if (this.state.adminAuditLogs.length > 250) {
      this.state.adminAuditLogs = this.state.adminAuditLogs.slice(0, 250);
    }
    this.persist();
    return entry;
  }

  getSuperAdminOverview(): SuperAdminTenantSummary[] {
    return this.state.tenants.map((tenant) => {
      const tenantStudents = this.state.students.filter((s) => s.tenantId === tenant.id && !s.deleted);
      const tenantInvoices = this.state.invoices.filter((i) => i.tenantId === tenant.id);
      const totalBilled = tenantInvoices.reduce((acc, inv) => acc + inv.totalAmount, 0);
      const totalCollected = tenantInvoices.reduce((acc, inv) => acc + inv.paidAmount, 0);
      const examResultCount = this.state.examResults.filter(
        (r) => r.tenantId === tenant.id
      ).length;
      const attendanceCount = this.state.attendance.filter(
        (a) => a.tenantId === tenant.id
      ).length;

      return {
        tenant,
        studentCount: tenantStudents.length,
        teacherCount: tenant.teachers.length,
        nonTeachingCount: (tenant.nonTeachingStaff || []).length,
        totalBilled,
        totalCollected,
        examResultCount,
        attendanceCount,
      };
    });
  }

  /**
   * Admin-initiated flows (enrolment, staff-provisioned Parent accounts) are trusted to link a
   * learner to an existing Parent account whose school email equals the guardian email recorded.
   */
  private findParentUserIdByEmail(tenantId: string, email: string | undefined): string | undefined {
    const norm = (email || '').trim().toLowerCase();
    if (!norm) return undefined;
    return (this.state.users || []).find(
      (u) => u.tenantId === tenantId && u.role === 'Parent' && u.email.trim().toLowerCase() === norm
    )?.id;
  }

  /** Invalidates every outstanding session token for a user (used by logout). */
  revokeUserSessions(userId: string): void {
    const stored = (this.state.users || []).find((u) => u.id === userId);
    if (!stored) return;
    stored.tokenVersion = (stored.tokenVersion ?? 0) + 1;
    this.persist();
  }

  /** Resolves the faculty-roster profile for a logged-in teacher by school email. */
  findTeacherProfileForUser(
    tenantId: string,
    user: Pick<TenantUser, 'email'>
  ): TeacherProfile | undefined {
    const tenant = this.state.tenants.find((t) => t.id === tenantId);
    const email = (user.email || '').trim().toLowerCase();
    if (!tenant || !email) return undefined;
    return (tenant.teachers || []).find((t) => (t.email || '').trim().toLowerCase() === email);
  }

  getWorkspace(tenantId: string, authUser?: TenantUser): TenantWorkspaceData {
    const tenant = this.requireTenant(tenantId);
    const tenantStudentsAll = this.state.students.filter((s) => s.tenantId === tenantId);
    const allStudents = tenantStudentsAll.filter((s) => !s.deleted);
    const archivedStudentsCount = tenantStudentsAll.filter((s) => Boolean(s.deleted)).length;
    const allYears = (this.state.academicYears || []).filter((y) => y.tenantId === tenantId);
    const allTerms = (this.state.academicTerms || []).filter((t) => t.tenantId === tenantId);
    const allLifecycleAudit = (this.state.lifecycleAuditLogs || [])
      .filter((l) => l.tenantId === tenantId)
      .slice(0, 200);
    const allAdmissions = this.state.admissions.filter((a) => a.tenantId === tenantId);
    const allTimetable = this.state.timetable.filter((t) => t.tenantId === tenantId);
    const allAttendance = this.state.attendance.filter((a) => a.tenantId === tenantId);
    const allStaffAttendance = this.state.staffAttendance.filter((a) => a.tenantId === tenantId);
    const allLeaveChits = this.state.leaveOutChits.filter((c) => c.tenantId === tenantId);
    const allExamCycles = this.state.examCycles.filter((e) => e.tenantId === tenantId);
    const allExamResults = this.state.examResults.filter((r) => r.tenantId === tenantId);
    const allFeeStructures = this.state.feeStructures.filter((f) => f.tenantId === tenantId);
    const allInvoices = this.state.invoices.filter((i) => i.tenantId === tenantId);
    const allCreditNotes = (this.state.creditNotes || []).filter((c) => c.tenantId === tenantId);
    const allFeeWaivers = (this.state.feeWaivers || []).filter((w) => w.tenantId === tenantId);
    const allVotelines = (this.state.independentVotelines || []).filter(
      (v) => v.tenantId === tenantId && !v.voided
    );
    const allMpesa = (this.state.mpesaTransactions || []).filter((m) => m.tenantId === tenantId);
    const allExpenses = this.state.expenses.filter((e) => e.tenantId === tenantId && !e.voided);
    const allEtims = (this.state.etimsChecks || []).filter((e) => e.tenantId === tenantId && !e.voided);
    const allRecon = (this.state.reconciliationLines || []).filter((r) => r.tenantId === tenantId && !r.voided);
    const allPayroll = (this.state.payrollEntries || []).filter((p) => p.tenantId === tenantId && !p.voided);
    const allBudgets = (this.state.budgets || []).filter((b) => b.tenantId === tenantId);
    const allApprovals = (this.state.approvalRecords || []).filter((a) => a.tenantId === tenantId && !a.voided);
    const allFinanceAudit = (this.state.financeAuditLogs || []).filter((f) => f.tenantId === tenantId).slice(0, 150);
    const statutoryRateSchedules = this.state.statutoryRateSchedules || DEFAULT_STATUTORY_RATE_SCHEDULES;
    const allAnnouncements = this.state.announcements.filter((a) => a.tenantId === tenantId);
    const allMessages = this.state.messages.filter((m) => m.tenantId === tenantId);
    const allWhatsapp = (this.state.whatsappDispatches || []).filter(
      (w) => w.tenantId === tenantId
    );
    const allNotifications = this.state.notifications.filter((n) => n.tenantId === tenantId);

    if (authUser?.role === 'Student') {
      const ownStudent = allStudents.find(
        (s) =>
          (authUser.studentId && s.id === authUser.studentId) ||
          s.studentUserId === authUser.id
      );
      const linked = ownStudent ? [ownStudent] : [];
      const ownIds = new Set(linked.map((s) => s.id));
      const ownGradeSections = new Set(linked.map((s) => `${s.grade}::${s.section}`));
      const publishedCycles = allExamCycles.filter((c) => c.status === 'Published');
      const publishedCycleIds = new Set(publishedCycles.map((c) => c.id));

      return {
        tenant,
        tenants: [tenant],
        academicYears: allYears,
        academicTerms: allTerms,
        students: linked,
        archivedStudentsCount: 0,
        lifecycleAuditLogs: [],
        admissions: [],
        timetable: allTimetable.filter((slot) =>
          ownGradeSections.has(`${slot.grade}::${slot.section}`)
        ),
        attendance: allAttendance.filter((a) => ownIds.has(a.studentId)),
        staffAttendance: [],
        leaveOutChits: allLeaveChits.filter((c) => ownIds.has(c.studentId)),
        examCycles: publishedCycles,
        examResults: allExamResults.filter(
          (r) => ownIds.has(r.studentId) && publishedCycleIds.has(r.examCycleId)
        ),
        feeStructures: [],
        invoices: [],
        creditNotes: [],
        feeWaivers: [],
        independentVotelines: [],
        mpesaTransactions: [],
        expenses: [],
        etimsChecks: [],
        reconciliationLines: [],
        payrollEntries: [],
        budgets: [],
        approvalRecords: [],
        announcements: allAnnouncements.filter(
          (a) => a.audience === 'All School' || a.audience === 'Students'
        ),
        messages: [],
        whatsappDispatches: [],
        notifications: allNotifications.filter(
          (n) =>
            n.category === 'announcement' ||
            n.category === 'exam' ||
            n.category === 'timetable' ||
            n.category === 'attendance'
        ),
      };
    }

    if (authUser?.role === 'Parent') {
      const linkedStudents = allStudents.filter((s) => s.parentUserId === authUser.id);
      const childIds = new Set(linkedStudents.map((s) => s.id));
      const childGrades = new Set(linkedStudents.map((s) => s.grade));
      const childGradeSections = new Set(linkedStudents.map((s) => `${s.grade}::${s.section}`));
      const publishedCycles = allExamCycles.filter((c) => c.status === 'Published');
      const publishedCycleIds = new Set(publishedCycles.map((c) => c.id));

      return {
        tenant,
        tenants: [tenant],
        academicYears: allYears,
        academicTerms: allTerms,
        students: linkedStudents,
        archivedStudentsCount: 0,
        lifecycleAuditLogs: [],
        admissions: [],
        timetable: allTimetable.filter((slot) =>
          childGradeSections.has(`${slot.grade}::${slot.section}`)
        ),
        attendance: allAttendance.filter((a) => childIds.has(a.studentId)),
        staffAttendance: [],
        leaveOutChits: allLeaveChits.filter((c) => childIds.has(c.studentId)),
        examCycles: publishedCycles,
        examResults: allExamResults.filter(
          (r) => childIds.has(r.studentId) && publishedCycleIds.has(r.examCycleId)
        ),
        feeStructures: allFeeStructures.filter((f) => childGrades.has(f.grade)),
        invoices: allInvoices.filter((i) => childIds.has(i.studentId)),
        creditNotes: allCreditNotes.filter((c) => childIds.has(c.studentId)),
        feeWaivers: allFeeWaivers.filter((w) => childIds.has(w.studentId)),
        independentVotelines: allVotelines.filter((v) => childIds.has(v.studentId)),
        mpesaTransactions: [],
        expenses: [],
        etimsChecks: [],
        reconciliationLines: [],
        payrollEntries: [],
        budgets: [],
        approvalRecords: [],
        announcements: allAnnouncements.filter(
          (a) => a.audience === 'All School' || a.audience === 'Parents & Guardians'
        ),
        messages: [],
        whatsappDispatches: [],
        notifications: allNotifications.filter(
          (n) => n.category === 'announcement' || n.category === 'exam'
        ),
      };
    }

    if (authUser?.role === 'Teacher') {
      // Least privilege: a teacher only receives learners in cohorts they are assigned to
      // (explicit class assignment or a timetable slot). No matching teacher profile => no learners.
      const teacherProfile = this.findTeacherProfileForUser(tenantId, authUser);
      const teacherStudents = teacherProfile
        ? allStudents.filter((s) =>
            isTeacherAssignedToCohort(teacherProfile, s.grade, s.section, allTimetable)
          )
        : [];
      const teacherStudentIds = new Set(teacherStudents.map((s) => s.id));
      return {
        tenant,
        tenants: [tenant],
        academicYears: allYears,
        academicTerms: allTerms,
        students: teacherStudents,
        archivedStudentsCount: 0,
        lifecycleAuditLogs: [],
        admissions: [],
        timetable: allTimetable,
        attendance: allAttendance.filter((a) => teacherStudentIds.has(a.studentId)),
        staffAttendance: [],
        leaveOutChits: allLeaveChits.filter((c) => teacherStudentIds.has(c.studentId)),
        examCycles: allExamCycles,
        examResults: allExamResults.filter((r) => teacherStudentIds.has(r.studentId)),
        feeStructures: [],
        invoices: [],
        creditNotes: [],
        feeWaivers: [],
        independentVotelines: [],
        mpesaTransactions: [],
        expenses: [],
        etimsChecks: [],
        reconciliationLines: [],
        payrollEntries: [],
        budgets: [],
        approvalRecords: [],
        announcements: allAnnouncements,
        messages: allMessages,
        whatsappDispatches: [],
        notifications: allNotifications.filter((n) => n.category !== 'fee'),
      };
    }

    if (authUser?.role === 'Bursar') {
      return {
        tenant,
        tenants: [tenant],
        academicYears: allYears,
        academicTerms: allTerms,
        students: allStudents,
        archivedStudentsCount: 0,
        lifecycleAuditLogs: [],
        admissions: [],
        timetable: [],
        attendance: [],
        staffAttendance: [],
        leaveOutChits: [],
        examCycles: [],
        examResults: [],
        feeStructures: allFeeStructures,
        invoices: allInvoices,
        creditNotes: allCreditNotes,
        feeWaivers: allFeeWaivers,
        independentVotelines: allVotelines,
        mpesaTransactions: allMpesa,
        expenses: allExpenses,
        etimsChecks: allEtims,
        reconciliationLines: allRecon,
        payrollEntries: allPayroll,
        budgets: allBudgets,
        approvalRecords: allApprovals,
        statutoryRateSchedules,
        announcements: allAnnouncements,
        messages: allMessages,
        whatsappDispatches: allWhatsapp,
        notifications: allNotifications,
      };
    }

    if (authUser?.role === 'Registrar') {
      return {
        tenant,
        tenants: [tenant],
        academicYears: allYears,
        academicTerms: allTerms,
        students: allStudents,
        archivedStudentsCount,
        lifecycleAuditLogs: allLifecycleAudit,
        admissions: allAdmissions,
        timetable: allTimetable,
        attendance: allAttendance,
        staffAttendance: [],
        leaveOutChits: allLeaveChits,
        examCycles: allExamCycles,
        examResults: allExamResults,
        feeStructures: [],
        invoices: [],
        creditNotes: [],
        feeWaivers: [],
        independentVotelines: [],
        mpesaTransactions: [],
        expenses: [],
        etimsChecks: [],
        reconciliationLines: [],
        payrollEntries: [],
        budgets: [],
        approvalRecords: [],
        announcements: allAnnouncements,
        messages: allMessages,
        whatsappDispatches: allWhatsapp,
        notifications: allNotifications.filter((n) => n.category !== 'fee'),
      };
    }

    return {
      tenant,
      tenants: this.state.tenants,
      academicYears: allYears,
      academicTerms: allTerms,
      students: allStudents,
      archivedStudentsCount,
      lifecycleAuditLogs: allLifecycleAudit,
      admissions: allAdmissions,
      timetable: allTimetable,
      attendance: allAttendance,
      staffAttendance: allStaffAttendance,
      leaveOutChits: allLeaveChits,
      examCycles: allExamCycles,
      examResults: allExamResults,
      feeStructures: allFeeStructures,
      invoices: allInvoices,
      creditNotes: allCreditNotes,
      feeWaivers: allFeeWaivers,
      independentVotelines: allVotelines,
      mpesaTransactions: allMpesa,
      expenses: allExpenses,
      etimsChecks: allEtims,
      reconciliationLines: allRecon,
      payrollEntries: allPayroll,
      budgets: allBudgets,
      approvalRecords: allApprovals,
      financeAuditLogs: allFinanceAudit,
      statutoryRateSchedules,
      announcements: allAnnouncements,
      messages: allMessages,
      whatsappDispatches: allWhatsapp,
      notifications: allNotifications,
    };
  }

  createTenant(input: {
    name: string;
    emailDomain?: string;
    curriculum: string;
    academicYear: string;
    currentTerm: string;
    currency?: CurrencyCode;
    plan: TenantPlan;
    status?: TenantStatus;
    learnerCap?: number;
    subscriptionCycle?: SubscriptionCycle;
    renewalDate?: string;
    location: string;
    contactEmail?: string;
    contactPhone?: string;
    postalAddress?: string;
    branding?: Partial<TenantBranding>;
    grades: string[];
    subjects: string[];
    rooms: string[];
    leadTeacherName: string;
    leadTeacherEmail: string;
    leadTeacherPhone?: string;
    initialAdminPassword?: string;
  }): Tenant {
    const slug = input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32) || `school-${Date.now()}`;

    const resolvedDomain =
      sanitizeSchoolEmailDomain(input.emailDomain || '') || deriveSchoolEmailDomain(slug || input.name);

    const id = `tenant-${slug}-${randomUUID().slice(0, 4)}`;
    const teacherId = `t-${randomUUID().slice(0, 6)}`;
    const resolvedGrades = input.grades.length > 0 ? input.grades : [...KENYAN_CBC_GRADES];
    const resolvedBranding: TenantBranding = {
      primaryColor: input.branding?.primaryColor?.trim() || DEFAULT_TENANT_BRANDING.primaryColor,
      accentColor: input.branding?.accentColor?.trim() || DEFAULT_TENANT_BRANDING.accentColor,
      sidebarColor: input.branding?.sidebarColor?.trim() || '',
      logoDataUrl: input.branding?.logoDataUrl || '',
      tagline: input.branding?.tagline?.trim() || '',
    };
    const resolvedPlan: TenantPlan = input.plan || 'Growth';
    const resolvedCap =
      typeof input.learnerCap === 'number' && Number.isFinite(input.learnerCap) && input.learnerCap > 0
        ? Math.round(input.learnerCap)
        : DEFAULT_TIER_LEARNER_CAPS[resolvedPlan];
    const defaultRenewal = new Date();
    defaultRenewal.setFullYear(defaultRenewal.getFullYear() + 1);
    const resolvedCurrency: CurrencyCode = input.currency || DEFAULT_CURRENCY;
    const resolvedLeadEmail = input.leadTeacherEmail.trim() || `admin@${resolvedDomain}`;
    const resolvedContactPhone = (input.contactPhone || input.leadTeacherPhone || '').trim() || '+254 700 000 000';

    const tenant: Tenant = {
      id,
      name: input.name.trim(),
      slug,
      emailDomain: resolvedDomain,
      curriculum: input.curriculum.trim() || 'Kenyan CBC (Playgroup – Grade 12)',
      academicYear: input.academicYear.trim() || '2026–2027',
      currentTerm: input.currentTerm.trim() || 'Term 1',
      currency: resolvedCurrency,
      plan: resolvedPlan,
      status: input.status || 'Active',
      learnerCap: resolvedCap,
      subscriptionCycle: input.subscriptionCycle || 'Annual',
      renewalDate: (input.renewalDate || '').trim() || defaultRenewal.toISOString().slice(0, 10),
      location: input.location.trim() || 'Nairobi, KE',
      contactEmail: (input.contactEmail || '').trim() || resolvedLeadEmail,
      contactPhone: resolvedContactPhone,
      postalAddress: (input.postalAddress || '').trim() || input.location.trim() || 'Nairobi, KE',
      branding: resolvedBranding,
      grades: resolvedGrades,
      sections: ['A', 'B'],
      gradeStreams: Object.fromEntries(resolvedGrades.map((g) => [g, ['A', 'B']])),
      subjects:
        input.subjects.length > 0
          ? input.subjects
          : [...KENYAN_CBC_SUBJECTS],
      subjectWeeklyLessons: Object.fromEntries(
        (input.subjects.length > 0 ? input.subjects : [...KENYAN_CBC_SUBJECTS]).map((sub) => [
          sub,
          getLessonsPerWeekForSubject({}, sub),
        ])
      ),
      levelSubjects:
        input.subjects.length > 0
          ? Object.fromEntries(
              KENYAN_CBC_CLUSTERS.map((c) => [c.id, [...input.subjects]])
            )
          : buildDefaultLevelSubjectsMap(),
      levelSubjectWeeklyLessons:
        input.subjects.length > 0
          ? Object.fromEntries(
              KENYAN_CBC_CLUSTERS.map((c) => [
                c.id,
                Object.fromEntries(
                  input.subjects.map((sub) => [sub, getLessonsPerWeekForSubject({}, sub, c.id)])
                ),
              ])
            )
          : buildDefaultLevelWeeklyLessonsMap(),
      rooms: input.rooms.length > 0 ? input.rooms : ['Room 101', 'Room 102', 'Science Lab'],
      teachers: [
        {
          id: teacherId,
          name: input.leadTeacherName.trim() || 'Principal Lead',
          email: resolvedLeadEmail,
          phone: resolvedContactPhone,
          department: 'Administration',
          subjects: [
            input.subjects[0] || KENYAN_CBC_SUBJECTS[0],
          ],
          assignedClasses: [],
        },
      ],
      nonTeachingStaff: buildDefaultNonTeachingStaff(slug, id.slice(-4)),
      createdAt: new Date().toISOString(),
    };

    this.state.tenants.push(tenant);

    const nowIso = new Date().toISOString();
    const yearId = `ay-${randomUUID().slice(0, 8)}`;
    const termId = `term-${randomUUID().slice(0, 8)}`;
    if (!Array.isArray(this.state.academicYears)) this.state.academicYears = [];
    if (!Array.isArray(this.state.academicTerms)) this.state.academicTerms = [];
    this.state.academicYears.push({
      id: yearId,
      tenantId: id,
      name: tenant.academicYear,
      startDate: '2026-09-01',
      endDate: '2027-07-31',
      status: 'Open',
      isCurrent: true,
      createdAt: nowIso,
    });
    this.state.academicTerms.push({
      id: termId,
      tenantId: id,
      academicYearId: yearId,
      name: tenant.currentTerm || 'Term 1',
      startDate: '2026-09-01',
      endDate: '2026-12-15',
      status: 'Open',
      isCurrent: true,
      createdAt: nowIso,
    });

    // Seed default fee structure for first grade so billing works immediately (scaled to tenant currency)
    const isKes = resolvedCurrency === 'KES';
    const defTuition = isKes ? 32000 : 3800;
    const defLab = isKes ? 2500 : 300;
    const defTech = isKes ? 2000 : 200;
    const defAct = isKes ? 1800 : 150;
    this.state.feeStructures.push({
      id: `fs-${randomUUID().slice(0, 6)}`,
      tenantId: id,
      termId,
      grade: tenant.grades[0],
      term: tenant.currentTerm,
      votelines: [
        { id: 'vl-tuition', name: 'Tuition Fee', amount: defTuition },
        { id: 'vl-lab', name: 'Laboratory Fee', amount: defLab },
        { id: 'vl-tech', name: 'Technology & ICT', amount: defTech },
        { id: 'vl-act', name: 'Co-Curricular & Activities', amount: defAct },
      ],
      tuitionFee: defTuition,
      labFee: defLab,
      technologyFee: defTech,
      activitiesFee: defAct,
      totalFee: defTuition + defLab + defTech + defAct,
    });

    this.state.expenses.push(
      ...buildDefaultExpensesForTenant(id, tenant.currency, slug.slice(0, 3).toUpperCase())
    );
    this.state.etimsChecks.push(
      ...buildDefaultEtimsChecksForTenant(id, tenant.currency, slug.slice(0, 3).toUpperCase())
    );
    this.state.reconciliationLines.push(
      ...buildDefaultReconciliationForTenant(id, tenant.currency, slug.slice(0, 3).toUpperCase())
    );
    this.state.payrollEntries.push(...buildDefaultPayrollForTenant(tenant, '2026-11'));
    this.state.budgets.push(...buildDefaultBudgetsForTenant(tenant));
    this.state.approvalRecords.push(
      ...buildDefaultApprovalsForTenant(id, tenant.currency, slug.slice(0, 3).toUpperCase())
    );

    // Seed Term Opening, Mid-Term, and End of Term exam cycles
    const termLabel = tenant.currentTerm || 'Term 1';
    this.state.examCycles.push(
      {
        id: `exm-${randomUUID().slice(0, 6)}`,
        tenantId: id,
        academicYearId: yearId,
        termId,
        title: `${termLabel} Opening Exam`,
        term: termLabel,
        startDate: '2026-09-07',
        endDate: '2026-09-11',
        status: 'Draft',
        createdAt: new Date().toISOString(),
      },
      {
        id: `exm-${randomUUID().slice(0, 6)}`,
        tenantId: id,
        academicYearId: yearId,
        termId,
        title: `${termLabel} Mid-Term Exam`,
        term: termLabel,
        startDate: '2026-10-12',
        endDate: '2026-10-16',
        status: 'Draft',
        createdAt: new Date().toISOString(),
      },
      {
        id: `exm-${randomUUID().slice(0, 6)}`,
        tenantId: id,
        academicYearId: yearId,
        termId,
        title: `${termLabel} End of Term Exam`,
        term: termLabel,
        startDate: '2026-11-20',
        endDate: '2026-11-26',
        status: 'Draft',
        createdAt: new Date().toISOString(),
      }
    );

    this.state.announcements.unshift({
      id: `ann-${randomUUID().slice(0, 6)}`,
      tenantId: id,
      title: `Welcome to ${tenant.name} Workspace`,
      body: `Tenant environment provisioned for ${tenant.academicYear} (${tenant.curriculum}). Configure fee structures, admit students, and schedule classes.`,
      audience: 'All School',
      priority: 'Normal',
      authorName: tenant.teachers[0].name,
      authorRole: 'Admin',
      createdAt: new Date().toISOString(),
    });

    this.persist();
    this.pushNotification(
      id,
      'announcement',
      'School Tenant Provisioned',
      `${tenant.name} (${tenant.plan}) is active and isolated.`,
      'settings'
    );
    return tenant;
  }

  updateTenant(
    tenantId: string,
    patch: Partial<
      Pick<
        Tenant,
        | 'name'
        | 'emailDomain'
        | 'curriculum'
        | 'academicYear'
        | 'currentTerm'
        | 'currency'
        | 'location'
        | 'contactEmail'
        | 'contactPhone'
        | 'postalAddress'
        | 'plan'
        | 'status'
      >
    > & {
      branding?: Partial<TenantBranding>;
      addTeacher?: {
        name: string;
        email: string;
        phone?: string;
        department: string;
        subjects?: string[];
        assignedClasses?: TeacherClassAssignment[];
      };
      addRoom?: string;
      addSubject?: string;
    }
  ): Tenant {
    const tenant = this.requireTenant(tenantId);
    if (patch.name && patch.name.trim()) tenant.name = patch.name.trim();
    if (patch.emailDomain !== undefined) {
      const cleanedDomain = sanitizeSchoolEmailDomain(patch.emailDomain);
      if (cleanedDomain) tenant.emailDomain = cleanedDomain;
    }
    if (patch.curriculum && patch.curriculum.trim()) tenant.curriculum = patch.curriculum.trim();
    if (patch.academicYear && patch.academicYear.trim()) tenant.academicYear = patch.academicYear.trim();
    if (patch.currentTerm && patch.currentTerm.trim()) tenant.currentTerm = patch.currentTerm.trim();
    if (patch.currency) tenant.currency = patch.currency;
    if (patch.location !== undefined) tenant.location = patch.location.trim() || tenant.location;
    if (patch.contactEmail !== undefined) tenant.contactEmail = patch.contactEmail.trim();
    if (patch.contactPhone !== undefined) tenant.contactPhone = patch.contactPhone.trim();
    if (patch.postalAddress !== undefined) tenant.postalAddress = patch.postalAddress.trim();
    if (patch.plan) tenant.plan = patch.plan;
    if (patch.status) tenant.status = patch.status;
    if (patch.branding) {
      const current = tenant.branding || { ...DEFAULT_TENANT_BRANDING };
      tenant.branding = {
        primaryColor:
          patch.branding.primaryColor !== undefined
            ? patch.branding.primaryColor.trim() || DEFAULT_TENANT_BRANDING.primaryColor
            : current.primaryColor,
        accentColor:
          patch.branding.accentColor !== undefined
            ? patch.branding.accentColor.trim() || DEFAULT_TENANT_BRANDING.accentColor
            : current.accentColor,
        sidebarColor:
          patch.branding.sidebarColor !== undefined
            ? patch.branding.sidebarColor.trim()
            : current.sidebarColor || '',
        logoDataUrl:
          patch.branding.logoDataUrl !== undefined
            ? patch.branding.logoDataUrl
            : current.logoDataUrl || '',
        tagline:
          patch.branding.tagline !== undefined
            ? patch.branding.tagline.trim()
            : current.tagline || '',
      };
    }

    if (patch.addTeacher && patch.addTeacher.name.trim()) {
      const assignedSubjects = (patch.addTeacher.subjects || [])
        .map((s) => s.trim())
        .filter(Boolean);
      assignedSubjects.forEach((sub) => {
        if (!tenant.subjects.includes(sub)) tenant.subjects.push(sub);
      });
      tenant.teachers.push({
        id: `t-${randomUUID().slice(0, 6)}`,
        name: patch.addTeacher.name.trim(),
        email: patch.addTeacher.email.trim() || 'faculty@school.ac.ke',
        phone: (patch.addTeacher.phone || '').trim() || '+254 700 000 000',
        department: patch.addTeacher.department.trim() || 'General',
        subjects: assignedSubjects.length > 0 ? assignedSubjects : [tenant.subjects[0] || 'Mathematics'],
        assignedClasses: Array.isArray(patch.addTeacher.assignedClasses)
          ? patch.addTeacher.assignedClasses
          : [],
      });
    }
    if (patch.addRoom && patch.addRoom.trim() && !tenant.rooms.includes(patch.addRoom.trim())) {
      tenant.rooms.push(patch.addRoom.trim());
    }
    if (patch.addSubject && patch.addSubject.trim() && !tenant.subjects.includes(patch.addSubject.trim())) {
      tenant.subjects.push(patch.addSubject.trim());
    }

    this.persist();
    this.syncTenant(tenantId, 'tenant:updated');
    return tenant;
  }

  updateTenantBranding(
    tenantId: string,
    input: {
      name?: string;
      emailDomain?: string;
      location?: string;
      contactEmail?: string;
      contactPhone?: string;
      postalAddress?: string;
      curriculum?: string;
      academicYear?: string;
      currentTerm?: string;
      currency?: CurrencyCode;
      plan?: TenantPlan;
      status?: TenantStatus;
      branding?: Partial<TenantBranding>;
    }
  ): Tenant {
    const tenant = this.updateTenant(tenantId, input);
    this.pushNotification(
      tenantId,
      'announcement',
      'School Branding & Theme Updated',
      `${tenant.name} branding palette and platform identity have been updated by Super Admin.`,
      'settings'
    );
    return tenant;
  }

  deleteTenant(tenantId: string): { deleted: boolean; remainingTenants: Tenant[] } {
    const tenant = this.requireTenant(tenantId);
    if (this.state.tenants.length <= 1) {
      throw new ConflictError('Cannot delete the last remaining school tenant.', 400);
    }

    this.state.tenants = this.state.tenants.filter((t) => t.id !== tenantId);
    this.state.students = this.state.students.filter((s) => s.tenantId !== tenantId);
    this.state.admissions = this.state.admissions.filter((a) => a.tenantId !== tenantId);
    this.state.timetable = this.state.timetable.filter((s) => s.tenantId !== tenantId);
    this.state.attendance = this.state.attendance.filter((a) => a.tenantId !== tenantId);
    this.state.staffAttendance = this.state.staffAttendance.filter((a) => a.tenantId !== tenantId);
    this.state.leaveOutChits = this.state.leaveOutChits.filter((c) => c.tenantId !== tenantId);
    this.state.examCycles = this.state.examCycles.filter((e) => e.tenantId !== tenantId);
    this.state.examResults = this.state.examResults.filter((r) => r.tenantId !== tenantId);
    this.state.feeStructures = this.state.feeStructures.filter((f) => f.tenantId !== tenantId);
    this.state.invoices = this.state.invoices.filter((i) => i.tenantId !== tenantId);
    this.state.creditNotes = (this.state.creditNotes || []).filter((c) => c.tenantId !== tenantId);
    this.state.feeWaivers = (this.state.feeWaivers || []).filter((w) => w.tenantId !== tenantId);
    this.state.independentVotelines = (this.state.independentVotelines || []).filter(
      (v) => v.tenantId !== tenantId
    );
    this.state.expenses = this.state.expenses.filter((e) => e.tenantId !== tenantId);
    this.state.etimsChecks = (this.state.etimsChecks || []).filter((e) => e.tenantId !== tenantId);
    this.state.reconciliationLines = (this.state.reconciliationLines || []).filter(
      (r) => r.tenantId !== tenantId
    );
    this.state.payrollEntries = (this.state.payrollEntries || []).filter(
      (p) => p.tenantId !== tenantId
    );
    this.state.budgets = (this.state.budgets || []).filter((b) => b.tenantId !== tenantId);
    this.state.approvalRecords = (this.state.approvalRecords || []).filter(
      (a) => a.tenantId !== tenantId
    );
    this.state.financeAuditLogs = (this.state.financeAuditLogs || []).filter(
      (f) => f.tenantId !== tenantId
    );
    this.state.announcements = this.state.announcements.filter((a) => a.tenantId !== tenantId);
    this.state.messages = this.state.messages.filter((m) => m.tenantId !== tenantId);
    this.state.whatsappDispatches = (this.state.whatsappDispatches || []).filter(
      (w) => w.tenantId !== tenantId
    );
    this.state.mpesaTransactions = (this.state.mpesaTransactions || []).filter(
      (m) => m.tenantId !== tenantId
    );
    if (this.state.mpesaWebhookHashes) {
      delete this.state.mpesaWebhookHashes[tenantId];
    }
    for (const key of [
      'receiptCounters',
      'studentCounters',
      'invoiceCounters',
      'admissionCounters',
      'voucherCounters',
      'creditNoteCounters',
    ] as const) {
      if (this.state[key]) delete this.state[key]![tenantId];
    }
    this.state.notifications = this.state.notifications.filter((n) => n.tenantId !== tenantId);
    this.state.users = (this.state.users || []).filter((u) => u.tenantId !== tenantId);
    this.state.academicYears = (this.state.academicYears || []).filter((y) => y.tenantId !== tenantId);
    this.state.academicTerms = (this.state.academicTerms || []).filter((t) => t.tenantId !== tenantId);
    this.state.lifecycleAuditLogs = (this.state.lifecycleAuditLogs || []).filter(
      (l) => l.tenantId !== tenantId
    );

    this.persist();
    this.onBroadcast?.(tenant.id, 'workspace:sync', {
      reason: 'tenant:deleted',
      timestamp: new Date().toISOString(),
    });
    return { deleted: true, remainingTenants: this.state.tenants };
  }

  private toPublicUser(user: StoredTenantUser): TenantUser {
    const { passwordHash: _omitted, ...publicUser } = user;
    return {
      ...publicUser,
      mustChangePassword: Boolean(publicUser.mustChangePassword),
      tokenVersion: typeof publicUser.tokenVersion === 'number' ? publicUser.tokenVersion : 0,
      allowedModules: Array.isArray(publicUser.allowedModules)
        ? publicUser.allowedModules
        : [...(DEFAULT_ROLE_MODULES[publicUser.role] || ['analytics'])],
    };
  }

  private assertStrongPassword(password: string) {
    const err = validatePasswordStrength(password);
    if (err) {
      throw new ConflictError(err, 400);
    }
  }

  private resolveTenantEmailDomain(tenant: Tenant): string {
    return (
      sanitizeSchoolEmailDomain(tenant.emailDomain || '') ||
      deriveSchoolEmailDomain(tenant.slug || tenant.name)
    );
  }

  private validateInstitutionalEmailDomain(domain: string) {
    if (!domain || domain.length < 2 || !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(domain)) {
      throw new ConflictError(
        'Provide a valid school email domain (e.g., oakridge.ac.ke or riverside).',
        400
      );
    }
    if (PUBLIC_EMAIL_DOMAINS.has(domain)) {
      throw new ConflictError(
        `Public email domain "@${domain}" is not allowed. Use your school domain (@yourschool).`,
        400
      );
    }
  }

  private validateEmailLocalPart(localPart: string) {
    if (!localPart || localPart.length < 2 || !/^[a-z0-9][a-z0-9._-]{0,46}[a-z0-9]$/.test(localPart)) {
      throw new ConflictError(
        'Email name before @ must be 2–48 characters using letters, numbers, dots, or hyphens (e.g. jane.wanjiku).',
        400
      );
    }
  }

  getPublicSchoolDirectory(): PublicSchoolDirectoryItem[] {
    return this.state.tenants.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      emailDomain: this.resolveTenantEmailDomain(t),
      location: t.location,
      curriculum: t.curriculum,
      status: t.status || 'Active',
      branding: t.branding,
    }));
  }

  getUserById(userId: string): TenantUser | null {
    const found = (this.state.users || []).find((u) => u.id === userId);
    return found ? this.toPublicUser(found) : null;
  }

  listUsersForTenant(tenantId: string): TenantUser[] {
    return (this.state.users || [])
      .filter((u) => u.tenantId === tenantId)
      .map((u) => this.toPublicUser(u));
  }

  /**
   * Finds the learner a parent is claiming. Requires BOTH admission number and the guardian phone
   * on file. Failures use one generic message so the endpoint cannot be used to probe which
   * admission numbers or phone numbers exist.
   */
  private findStudentForParentClaim(
    tenantId: string,
    studentCode: string | undefined,
    guardianPhone: string | undefined
  ): Student {
    const generic = new ConflictError(
      'We could not verify that learner. Check the admission number and the guardian phone number the school has on file.',
      403
    );
    const code = (studentCode || '').trim().toLowerCase();
    if (!code || !(guardianPhone || '').trim()) throw generic;
    let phone: string;
    try {
      phone = this.validateAndNormalizeKenyanPhone(guardianPhone || '', 'Guardian phone');
    } catch {
      throw generic;
    }
    const student = this.state.students.find(
      (st) =>
        st.tenantId === tenantId &&
        (st.studentCode || '').trim().toLowerCase() === code &&
        st.status !== 'Graduated'
    );
    if (!student) throw generic;
    let onFile = '';
    try {
      onFile = this.validateAndNormalizeKenyanPhone(student.guardianPhone || '', 'Guardian phone');
    } catch {
      throw generic;
    }
    if (onFile !== phone) throw generic;
    return student;
  }

  /** Lets an already-registered parent claim another child (same ownership check). */
  linkParentToStudent(
    tenantId: string,
    parent: Pick<TenantUser, 'id' | 'role'>,
    input: { studentCode?: string; guardianPhone?: string }
  ): Student {
    if (parent.role !== 'Parent') {
      throw new ConflictError('Only Parent accounts can link a child this way.', 403);
    }
    const student = this.findStudentForParentClaim(tenantId, input.studentCode, input.guardianPhone);
    if (student.parentUserId && student.parentUserId !== parent.id) {
      throw new ConflictError(
        'This learner is already linked to another parent account. Ask the school office to relink it.',
        409
      );
    }
    student.parentUserId = parent.id;
    this.persist();
    return student;
  }

  /** School admin link / unlink of a learner to a Parent account (null clears the link). */
  setStudentParent(tenantId: string, studentId: string, parentUserId: string | null): Student {
    const student = this.state.students.find((st) => st.id === studentId && st.tenantId === tenantId);
    if (!student) throw new ConflictError('Student not found in tenant.', 404);
    if (parentUserId === null) {
      delete student.parentUserId;
    } else {
      const parent = (this.state.users || []).find(
        (u) => u.id === parentUserId && u.tenantId === tenantId && u.role === 'Parent'
      );
      if (!parent) throw new ConflictError('Parent account not found in this school.', 404);
      student.parentUserId = parent.id;
    }
    this.persist();
    return student;
  }

  async registerUserAccount(input: {
    tenantId?: string;
    fullName: string;
    email: string;
    phone?: string;
    role?: UserRole;
    password: string;
    /** Admission number of the child being claimed (required for Parent sign-up). */
    studentCode?: string;
    /** Guardian phone number on file at the school for that child. */
    guardianPhone?: string;
  }): Promise<{ user: TenantUser; tenant: Tenant }> {
    const fullName = (input.fullName || '').trim();
    if (fullName.length < 2) {
      throw new ConflictError('Full name must be at least 2 characters.', 400);
    }

    const password = input.password || '';
    this.assertStrongPassword(password);

    if (input.role && input.role !== 'Parent') {
      throw new ConflictError(
        'Public self-registration is restricted to Parent accounts. Staff accounts must be created by a School Admin.',
        403
      );
    }
    const requestedRole: UserRole = 'Parent';

    const rawEmail = (input.email || '').trim().toLowerCase();
    const atIndex = rawEmail.indexOf('@');
    if (atIndex === -1 || atIndex !== rawEmail.lastIndexOf('@')) {
      throw new ConflictError(
        'Sign up with your school-linked email formatted as yourname@theirschool.',
        400
      );
    }
    const localPart = rawEmail.slice(0, atIndex);
    const emailDomain = rawEmail.slice(atIndex + 1);
    this.validateEmailLocalPart(localPart);
    this.validateInstitutionalEmailDomain(emailDomain);

    let tenant: Tenant | undefined;
    if (input.tenantId) {
      tenant = this.requireTenant(input.tenantId);
      const expectedDomain = this.resolveTenantEmailDomain(tenant);
      if (emailDomain !== expectedDomain) {
        throw new ConflictError(
          `Account email for ${tenant.name} must end with "@${expectedDomain}" (yourname@${expectedDomain}).`,
          400
        );
      }
    } else {
      tenant = this.state.tenants.find((t) => this.resolveTenantEmailDomain(t) === emailDomain);
      if (!tenant) {
        throw new ConflictError(
          `No registered school uses "@${emailDomain}". Select a registered school first.`,
          404
        );
      }
    }

    if (tenant.status === 'Suspended') {
      throw new ConflictError(
        `${tenant.name} workspace is currently suspended. Contact platform administration.`,
        403
      );
    }

    const duplicate = (this.state.users || []).some((u) => u.email.toLowerCase() === rawEmail);
    if (duplicate) {
      throw new ConflictError(
        `An account for "${rawEmail}" already exists. Sign in instead.`,
        409
      );
    }

    // Ownership check: a parent must prove they know a learner's admission number AND the
    // guardian phone the school holds for that learner. No match => no account is created.
    const claimedStudent = this.findStudentForParentClaim(
      tenant.id,
      input.studentCode,
      input.guardianPhone
    );
    if (
      claimedStudent.parentUserId &&
      (this.state.users || []).some((u) => u.id === claimedStudent.parentUserId)
    ) {
      throw new ConflictError(
        'This learner already has a linked parent account. Ask the school office to link a second guardian.',
        409
      );
    }

    const now = new Date().toISOString();
    const newUser: StoredTenantUser = {
      id: `usr-${randomUUID().slice(0, 8)}`,
      tenantId: tenant.id,
      fullName,
      email: rawEmail,
      phone: (input.phone || '').trim() || undefined,
      role: requestedRole,
      passwordHash: await hashPassword(password),
      status: 'Active',
      mustChangePassword: false,
      tokenVersion: 0,
      allowedModules: [...(DEFAULT_ROLE_MODULES.Parent || ['analytics', 'fees', 'exams', 'communications'])],
      createdAt: now,
      lastLoginAt: now,
    };

    if (!Array.isArray(this.state.users)) this.state.users = [];
    this.state.users.push(newUser);
    claimedStudent.parentUserId = newUser.id;
    this.persist();

    this.pushNotification(
      tenant.id,
      'announcement',
      `New ${requestedRole} Account Created`,
      `${fullName} (${rawEmail}) joined ${tenant.name}.`,
      'settings'
    );

    return { user: this.toPublicUser(newUser), tenant };
  }

  async registerTenantWithAdmin(input: {
    schoolName: string;
    emailDomain: string;
    location?: string;
    curriculum?: string;
    academicYear?: string;
    currentTerm?: string;
    currency?: CurrencyCode;
    plan?: 'Enterprise' | 'Growth';
    fullName: string;
    email: string;
    password: string;
    branding?: Partial<TenantBranding>;
  }): Promise<{ user: TenantUser; tenant: Tenant }> {
    const schoolName = (input.schoolName || '').trim();
    if (schoolName.length < 2) {
      throw new ConflictError('School name must be at least 2 characters.', 400);
    }

    const existingName = this.state.tenants.some(
      (t) => t.name.trim().toLowerCase() === schoolName.toLowerCase()
    );
    if (existingName) {
      throw new ConflictError(`A school tenant named "${schoolName}" already exists.`, 409);
    }

    const normalizedDomain = sanitizeSchoolEmailDomain(
      input.emailDomain || deriveSchoolEmailDomain(schoolName)
    );
    this.validateInstitutionalEmailDomain(normalizedDomain);

    const existingDomainTenant = this.state.tenants.find(
      (t) => this.resolveTenantEmailDomain(t) === normalizedDomain
    );
    if (existingDomainTenant) {
      throw new ConflictError(
        `School domain "@${normalizedDomain}" is already registered to ${existingDomainTenant.name}.`,
        409
      );
    }

    const fullName = (input.fullName || '').trim();
    if (fullName.length < 2) {
      throw new ConflictError('Administrator full name must be at least 2 characters.', 400);
    }

    const password = input.password || '';
    this.assertStrongPassword(password);

    const rawEmail = (input.email || '').trim().toLowerCase();
    const atIndex = rawEmail.indexOf('@');
    if (atIndex === -1 || atIndex !== rawEmail.lastIndexOf('@')) {
      throw new ConflictError(
        `Administrator email must be formatted as yourname@${normalizedDomain}.`,
        400
      );
    }
    const localPart = rawEmail.slice(0, atIndex);
    const submittedDomain = rawEmail.slice(atIndex + 1);
    this.validateEmailLocalPart(localPart);

    if (submittedDomain !== normalizedDomain) {
      throw new ConflictError(
        `Your account email domain "@${submittedDomain}" must match your school domain "@${normalizedDomain}".`,
        400
      );
    }

    const duplicateEmail = (this.state.users || []).some((u) => u.email.toLowerCase() === rawEmail);
    if (duplicateEmail) {
      throw new ConflictError(`An account for "${rawEmail}" already exists.`, 409);
    }

    const tenant = this.createTenant({
      name: schoolName,
      emailDomain: normalizedDomain,
      curriculum: (input.curriculum || '').trim() || 'Kenyan CBC (Playgroup – Grade 12)',
      academicYear: (input.academicYear || '').trim() || '2026–2027',
      currentTerm: (input.currentTerm || '').trim() || 'Term 1',
      currency: input.currency === 'USD' ? 'USD' : 'KES',
      plan: input.plan === 'Growth' ? 'Growth' : 'Enterprise',
      status: 'Active',
      location: (input.location || '').trim() || 'Nairobi, KE',
      branding: input.branding,
      grades: [],
      subjects: [],
      rooms: [],
      leadTeacherName: fullName,
      leadTeacherEmail: rawEmail,
    });

    const now = new Date().toISOString();
    const adminUser: StoredTenantUser = {
      id: `usr-${randomUUID().slice(0, 8)}`,
      tenantId: tenant.id,
      fullName,
      email: rawEmail,
      role: 'Admin',
      passwordHash: await hashPassword(password),
      status: 'Active',
      mustChangePassword: false,
      tokenVersion: 0,
      allowedModules: [...DEFAULT_ROLE_MODULES.Admin],
      createdAt: now,
      lastLoginAt: now,
    };

    if (!Array.isArray(this.state.users)) this.state.users = [];
    this.state.users.push(adminUser);
    this.persist();

    return { user: this.toPublicUser(adminUser), tenant };
  }

  async provisionTenantAdminAccount(
    tenant: Tenant,
    adminName: string,
    adminEmail: string,
    password?: string,
    mustChangePassword = true,
    adminPhone?: string
  ): Promise<{ user: TenantUser; oneTimePassword: string }> {
    const domain = this.resolveTenantEmailDomain(tenant);
    const cleanedEmail = (adminEmail || '').trim().toLowerCase();
    const fallbackLocal =
      adminName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '.')
        .replace(/^\.|\.$/g, '') || 'admin';
    const email = cleanedEmail.includes('@') ? cleanedEmail : `${fallbackLocal}@${domain}`;
    const existing = (this.state.users || []).find((u) => u.email.toLowerCase() === email);
    if (existing) {
      return {
        user: this.toPublicUser(existing),
        oneTimePassword: '',
      };
    }
    let assignedPassword: string;
    if (password && password.trim()) {
      this.assertStrongPassword(password.trim());
      assignedPassword = password.trim();
    } else {
      assignedPassword = generateOneTimePassword();
    }
    const now = new Date().toISOString();
    const created: StoredTenantUser = {
      id: `usr-${randomUUID().slice(0, 8)}`,
      tenantId: tenant.id,
      fullName: adminName.trim() || 'School Administrator',
      email,
      phone: (adminPhone || '').trim() || tenant.contactPhone || undefined,
      role: 'Admin',
      passwordHash: await hashPassword(assignedPassword),
      status: 'Active',
      mustChangePassword: Boolean(mustChangePassword),
      tokenVersion: 0,
      allowedModules: [...DEFAULT_ROLE_MODULES.Admin],
      createdAt: now,
    };
    this.state.users.push(created);
    this.persist();
    return { user: this.toPublicUser(created), oneTimePassword: assignedPassword };
  }

  async changeUserPassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<{ user: TenantUser; tenant?: Tenant; emailDomain?: string }> {
    const stored = (this.state.users || []).find((u) => u.id === userId);
    if (!stored || stored.status !== 'Active') {
      throw new ConflictError('Account not found or no longer active.', 404);
    }
    if (!currentPassword || !(await verifyPassword(currentPassword, stored.passwordHash))) {
      throw new ConflictError('Current password is incorrect.', 400);
    }
    const trimmedNew = newPassword || '';
    this.assertStrongPassword(trimmedNew);
    if (trimmedNew === currentPassword) {
      throw new ConflictError(
        'Choose a new password that differs from your current password.',
        400
      );
    }

    stored.passwordHash = await hashPassword(trimmedNew);
    stored.mustChangePassword = false;
    stored.tokenVersion = (stored.tokenVersion ?? 0) + 1;
    stored.lastLoginAt = new Date().toISOString();
    this.persist();

    let tenant: Tenant | undefined;
    let emailDomain: string | undefined;
    if (stored.tenantId !== 'platform') {
      tenant = this.state.tenants.find((t) => t.id === stored.tenantId);
      if (tenant) {
        emailDomain = this.resolveTenantEmailDomain(tenant);
      }
    }
    return {
      user: this.toPublicUser(stored),
      tenant,
      emailDomain,
    };
  }

  private normalizePhoneDigits(phone: string): string {
    const digits = (phone || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('0') && digits.length >= 9) {
      return `254${digits.slice(1)}`;
    }
    if (!digits.startsWith('254') && digits.length === 9 && digits.startsWith('7')) {
      return `254${digits}`;
    }
    return digits;
  }

  private resolveAccountRecoveryPhone(user: StoredTenantUser): string {
    if (user.phone && user.phone.trim()) return user.phone.trim();
    if (user.tenantId !== 'platform') {
      const tenant = this.state.tenants.find((t) => t.id === user.tenantId);
      if (tenant) {
        const matchedTeacher = tenant.teachers.find(
          (tc) => tc.email.toLowerCase() === user.email.toLowerCase() && tc.phone
        );
        if (matchedTeacher?.phone) return matchedTeacher.phone;
        if (user.role === 'Admin' && tenant.contactPhone) return tenant.contactPhone;
      }
    }
    return '';
  }

  private phonesMatch(submitted: string, registered: string): boolean {
    const a = this.normalizePhoneDigits(submitted);
    const b = this.normalizePhoneDigits(registered);
    if (!a || !b || a.length < 7 || b.length < 7) return false;
    if (a === b) return true;
    return a.length >= 9 && b.length >= 9 && a.slice(-9) === b.slice(-9);
  }

  private enforceSlidingRateLimit(
    bucket: Map<string, number[]>,
    key: string,
    maxRequests: number,
    windowMs: number,
    message: string
  ) {
    const now = Date.now();
    const recent = (bucket.get(key) || []).filter((ts) => now - ts < windowMs);
    if (recent.length >= maxRequests) {
      bucket.set(key, recent);
      throw new ConflictError(message, 429);
    }
    recent.push(now);
    bucket.set(key, recent);
  }

  async requestPasswordResetByPhone(
    input: { email: string; phone: string },
    clientIp = 'unknown'
  ): Promise<{
    ok: boolean;
    expiresInMinutes: number;
    deliveryChannel: string;
    message: string;
  }> {
    const email = (input.email || '').trim().toLowerCase();
    const phone = (input.phone || '').trim();
    if (!email || !phone) {
      throw new ConflictError('Enter both your account email and registered phone number.', 400);
    }

    const windowMs = 15 * 60_000;
    this.enforceSlidingRateLimit(
      this.resetRequestsByEmail,
      email,
      5,
      windowMs,
      'Too many password reset requests for this email. Please wait 15 minutes and try again.'
    );
    this.enforceSlidingRateLimit(
      this.resetRequestsByIp,
      clientIp || 'unknown',
      10,
      windowMs,
      'Too many password reset requests from this network. Please try again later.'
    );

    if (process.env.NODE_ENV === 'production' && !isSmsProviderConfigured()) {
      throw new SmsNotConfiguredError();
    }

    const expiresInMinutes = 10;
    const stored = (this.state.users || []).find((u) => u.email.toLowerCase() === email);
    const registeredPhone = stored && stored.status === 'Active' ? this.resolveAccountRecoveryPhone(stored) : '';

    if (stored && stored.status === 'Active' && registeredPhone && this.phonesMatch(phone, registeredPhone)) {
      const code = String(randomInt(100000, 1000000));
      this.passwordResetChallenges.set(email, {
        code,
        expiresAt: Date.now() + expiresInMinutes * 60_000,
        attempts: 0,
      });
      await sendSms(
        registeredPhone,
        `elimuNest verification code: ${code}. Expires in ${expiresInMinutes} minutes. Do not share this code.`
      );
    }

    return {
      ok: true,
      expiresInMinutes,
      deliveryChannel: 'SMS Phone Verification',
      message:
        'If an active account matches those details, a 6-digit verification code has been sent via SMS.',
    };
  }

  async verifyPasswordResetByPhone(input: {
    email: string;
    phone: string;
    code: string;
    newPassword: string;
  }): Promise<{ ok: boolean; email: string }> {
    const email = (input.email || '').trim().toLowerCase();
    const phone = (input.phone || '').trim();
    const code = (input.code || '').trim();
    const newPassword = input.newPassword || '';

    if (!email || !phone || !code || !newPassword) {
      throw new ConflictError(
        'Email, phone number, verification code, and new password are required.',
        400
      );
    }
    this.assertStrongPassword(newPassword);

    const challenge = this.passwordResetChallenges.get(email);
    if (!challenge) {
      throw new ConflictError(
        'Invalid or expired verification details. Request a fresh verification code.',
        400
      );
    }
    if (Date.now() > challenge.expiresAt) {
      this.passwordResetChallenges.delete(email);
      throw new ConflictError(
        'Verification code has expired. Request a new code to continue.',
        400
      );
    }
    if (challenge.attempts >= 5) {
      this.passwordResetChallenges.delete(email);
      throw new ConflictError(
        'Too many invalid verification attempts. Request a fresh verification code.',
        429
      );
    }

    const stored = (this.state.users || []).find((u) => u.email.toLowerCase() === email);
    const registeredPhone =
      stored && stored.status === 'Active' ? this.resolveAccountRecoveryPhone(stored) : '';
    const phoneOk = Boolean(stored && registeredPhone && this.phonesMatch(phone, registeredPhone));
    const codeBuf = Buffer.from(code, 'utf-8');
    const expectedBuf = Buffer.from(challenge.code, 'utf-8');
    const codeOk =
      codeBuf.length === expectedBuf.length && timingSafeEqual(codeBuf, expectedBuf);

    if (!stored || stored.status !== 'Active' || !phoneOk || !codeOk) {
      challenge.attempts += 1;
      if (challenge.attempts >= 5) {
        this.passwordResetChallenges.delete(email);
        throw new ConflictError(
          'Too many invalid verification attempts. Request a fresh verification code.',
          429
        );
      }
      throw new ConflictError(
        'Invalid verification details. Check your phone number and 6-digit SMS code.',
        400
      );
    }

    stored.passwordHash = await hashPassword(newPassword);
    stored.mustChangePassword = false;
    stored.tokenVersion = (stored.tokenVersion ?? 0) + 1;
    stored.lastLoginAt = new Date().toISOString();
    this.passwordResetChallenges.delete(email);
    this.persist();

    return { ok: true, email };
  }

  private normalizeAllowedModules(
    role: UserRole,
    rawModules?: unknown
  ): TenantModulePermission[] {
    const validSet = new Set<TenantModulePermission>(ALL_TENANT_MODULES.map((m) => m.id));
    if (!Array.isArray(rawModules)) {
      return [...(DEFAULT_ROLE_MODULES[role] || ['analytics'])];
    }
    const filtered = Array.from(
      new Set(
        rawModules.filter(
          (item): item is TenantModulePermission =>
            typeof item === 'string' && validSet.has(item as TenantModulePermission)
        )
      )
    );
    if (role === 'Admin' && !filtered.includes('settings')) {
      filtered.push('settings');
    }
    return filtered;
  }

  async createTenantStaffUser(
    actor: TenantUser,
    tenantId: string,
    input: {
      fullName: string;
      email: string;
      phone?: string;
      role: UserRole;
      allowedModules?: TenantModulePermission[];
    }
  ): Promise<{ user: TenantUser; oneTimePassword: string }> {
    if (actor.role !== 'Admin' && actor.role !== 'Super Admin' && actor.role !== 'Developer') {
      throw new ConflictError('Forbidden: Only School Admins can provision staff accounts.', 403);
    }
    const tenant = this.requireTenant(tenantId);
    const fullName = (input.fullName || '').trim();
    if (fullName.length < 2) {
      throw new ConflictError('Staff full name must be at least 2 characters.', 400);
    }

    const allowedSchoolRoles = new Set<UserRole>([
      'Super Admin',
      'Admin',
      'Registrar',
      'Teacher',
      'Bursar',
      'Parent',
    ]);
    const role: UserRole = input.role || 'Teacher';
    if (!allowedSchoolRoles.has(role)) {
      throw new ConflictError(
        'Staff role must be Super Admin, Admin, Registrar, Teacher, Bursar, or Parent.',
        400
      );
    }

    const domain = this.resolveTenantEmailDomain(tenant);
    const rawEmailInput = (input.email || '').trim().toLowerCase();
    let finalEmail: string;
    if (rawEmailInput.includes('@')) {
      const atIndex = rawEmailInput.indexOf('@');
      if (atIndex !== rawEmailInput.lastIndexOf('@')) {
        throw new ConflictError('Provide a valid @school email address.', 400);
      }
      const localPart = rawEmailInput.slice(0, atIndex);
      const emailDomain = rawEmailInput.slice(atIndex + 1);
      this.validateEmailLocalPart(localPart);
      if (emailDomain !== domain) {
        throw new ConflictError(
          `Staff email for ${tenant.name} must end with "@${domain}".`,
          400
        );
      }
      finalEmail = `${localPart}@${domain}`;
    } else {
      this.validateEmailLocalPart(rawEmailInput);
      finalEmail = `${rawEmailInput}@${domain}`;
    }

    if ((this.state.users || []).some((u) => u.email.toLowerCase() === finalEmail)) {
      throw new ConflictError(`An account with email "${finalEmail}" already exists.`, 409);
    }

    const allowedModules = this.normalizeAllowedModules(role, input.allowedModules);
    const oneTimePassword = generateOneTimePassword();
    const now = new Date().toISOString();
    const created: StoredTenantUser = {
      id: `usr-${randomUUID().slice(0, 8)}`,
      tenantId: tenant.id,
      fullName,
      email: finalEmail,
      phone: (input.phone || '').trim() || undefined,
      role,
      passwordHash: await hashPassword(oneTimePassword),
      status: 'Active',
      mustChangePassword: true,
      tokenVersion: 0,
      allowedModules,
      createdAt: now,
    };

    if (!Array.isArray(this.state.users)) this.state.users = [];
    this.state.users.push(created);
    if (role === 'Parent') {
      // The school admin vouches for this account: link learners recorded with this guardian email.
      for (const st of this.state.students) {
        if (
          st.tenantId === tenant.id &&
          !st.parentUserId &&
          (st.guardianEmail || '').trim().toLowerCase() === finalEmail
        ) {
          st.parentUserId = created.id;
        }
      }
    }
    this.persist();

    this.pushNotification(
      tenant.id,
      'announcement',
      `Staff Account Provisioned (${role})`,
      `${actor.fullName} added ${fullName} (${finalEmail}) with access to ${allowedModules.length} module(s).`,
      'settings'
    );

    return { user: this.toPublicUser(created), oneTimePassword };
  }

  async updateTenantUserAccess(
    actor: TenantUser,
    tenantId: string,
    targetUserId: string,
    patch: {
      role?: UserRole;
      phone?: string;
      allowedModules?: TenantModulePermission[];
      status?: 'Active' | 'Disabled';
      resetOneTimePassword?: boolean;
    }
  ): Promise<{ user: TenantUser; oneTimePassword?: string }> {
    if (actor.role !== 'Admin' && actor.role !== 'Super Admin' && actor.role !== 'Developer') {
      throw new ConflictError('Forbidden: Only School Admins can assign staff access rights.', 403);
    }
    const tenant = this.requireTenant(tenantId);
    const target = (this.state.users || []).find(
      (u) => u.id === targetUserId && u.tenantId === tenant.id
    );
    if (!target) {
      throw new ConflictError('Staff account not found in this school tenant.', 404);
    }
    if (target.role === 'Developer') {
      throw new ConflictError('Platform engineering accounts cannot be modified here.', 403);
    }

    const allowedSchoolRoles = new Set<UserRole>([
      'Super Admin',
      'Admin',
      'Registrar',
      'Teacher',
      'Bursar',
      'Parent',
    ]);
    if (patch.role !== undefined) {
      if (!allowedSchoolRoles.has(patch.role)) {
        throw new ConflictError('Invalid staff role specified.', 400);
      }
      if (target.id === actor.id && patch.role !== 'Admin' && patch.role !== 'Super Admin') {
        throw new ConflictError('You cannot remove your own administrative role.', 400);
      }
      target.role = patch.role;
    }

    if (patch.phone !== undefined) {
      target.phone = patch.phone.trim() || undefined;
    }

    if (patch.allowedModules !== undefined) {
      target.allowedModules = this.normalizeAllowedModules(target.role, patch.allowedModules);
    }

    if (patch.status !== undefined) {
      if (patch.status !== 'Active' && patch.status !== 'Disabled') {
        throw new ConflictError('Status must be Active or Disabled.', 400);
      }
      if (target.id === actor.id && patch.status === 'Disabled') {
        throw new ConflictError('You cannot disable your own active Admin account.', 400);
      }
      target.status = patch.status;
      if (patch.status === 'Disabled') {
        target.tokenVersion = (target.tokenVersion ?? 0) + 1;
      }
    }

    let oneTimePassword: string | undefined;
    if (patch.resetOneTimePassword) {
      oneTimePassword = generateOneTimePassword();
      target.passwordHash = await hashPassword(oneTimePassword);
      target.mustChangePassword = true;
      target.tokenVersion = (target.tokenVersion ?? 0) + 1;
    }

    this.persist();
    this.pushNotification(
      tenant.id,
      'announcement',
      'Staff Access Rights Updated',
      `${actor.fullName} updated permissions for ${target.fullName} (${target.role}, ${target.status}).`,
      'settings'
    );

    return {
      user: this.toPublicUser(target),
      ...(oneTimePassword ? { oneTimePassword } : {}),
    };
  }

  async authenticateUser(input: { email: string; password: string }): Promise<{
    user: TenantUser;
    tenant?: Tenant;
    emailDomain?: string;
  }> {
    const email = (input.email || '').trim().toLowerCase();
    const password = input.password || '';
    if (!email || !password) {
      throw new ConflictError('Enter both your email and password.', 400);
    }

    const attempt = this.loginAttempts.get(email);
    if (attempt && attempt.lockedUntil > Date.now()) {
      const mins = Math.max(1, Math.ceil((attempt.lockedUntil - Date.now()) / 60_000));
      throw new ConflictError(
        `Too many failed sign-in attempts for this account. Try again in ${mins} minute(s).`,
        429
      );
    }

    const stored = (this.state.users || []).find((u) => u.email.toLowerCase() === email);
    const valid = stored ? await verifyPassword(password, stored.passwordHash) : false;
    if (!stored || !valid) {
      const nextCount = (attempt && attempt.lockedUntil <= Date.now() ? 0 : attempt?.count || 0) + 1;
      if (nextCount >= 5) {
        this.loginAttempts.set(email, {
          count: nextCount,
          lockedUntil: Date.now() + 15 * 60_000,
        });
        throw new ConflictError(
          'Too many failed sign-in attempts for this account. Try again in 15 minutes.',
          429
        );
      }
      this.loginAttempts.set(email, { count: nextCount, lockedUntil: 0 });
      throw new ConflictError('Invalid email or password.', 401);
    }

    this.loginAttempts.delete(email);

    if (stored.status !== 'Active') {
      throw new ConflictError('This user account has been disabled by your school administrator.', 403);
    }

    let tenant: Tenant | undefined;
    let emailDomain: string | undefined;
    if (stored.tenantId !== 'platform') {
      tenant = this.state.tenants.find((t) => t.id === stored.tenantId);
      if (!tenant) {
        throw new ConflictError('Associated school tenant no longer exists.', 404);
      }
      if (tenant.status === 'Suspended') {
        throw new ConflictError(
          `${tenant.name} workspace is currently suspended. Contact platform administration.`,
          403
        );
      }
      emailDomain = this.resolveTenantEmailDomain(tenant);

      if (stored.role === 'Student') {
        if (!tenant.studentPortalEnabled) {
          throw new ConflictError(
            `Student portal login is currently disabled for ${tenant.name}. Ask your school administrator to enable Student Portal access.`,
            403
          );
        }
        const linkedStudent = this.state.students.find(
          (s) =>
            s.tenantId === tenant!.id &&
            !s.deleted &&
            ((stored.studentId && s.id === stored.studentId) || s.studentUserId === stored.id)
        );
        if (!linkedStudent) {
          throw new ConflictError('No active learner profile is linked to this student account.', 403);
        }
        if (linkedStudent.status === 'Transferred' || linkedStudent.status === 'Withdrawn') {
          throw new ConflictError(
            `Student portal access is deactivated (${linkedStudent.status}).`,
            403
          );
        }
      }
    }

    stored.lastLoginAt = new Date().toISOString();
    this.persist();

    return {
      user: this.toPublicUser(stored),
      tenant,
      emailDomain,
    };
  }

  private normalizeClassAssignments(
    raw: TeacherClassAssignment[] | undefined
  ): TeacherClassAssignment[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const result: TeacherClassAssignment[] = [];
    for (const item of raw) {
      const grade = (item?.grade || '').trim();
      const section = (item?.section || '').trim() || 'All Streams';
      const subject = (item?.subject || '').trim() || undefined;
      if (!grade) continue;
      const key = `${grade.toLowerCase()}::${section.toLowerCase()}::${(subject || '').toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(subject ? { grade, section, subject } : { grade, section });
    }
    return result;
  }

  addTeacher(
    tenantId: string,
    input: {
      name: string;
      email?: string;
      phone?: string;
      department?: string;
      subjects: string[];
      assignedClasses?: TeacherClassAssignment[];
    }
  ): { teacher: TeacherProfile; tenant: Tenant } {
    const tenant = this.requireTenant(tenantId);
    const name = (input.name || '').trim();
    if (!name) {
      throw new ConflictError('Teacher full name is required.', 400);
    }
    const assignedClasses = this.normalizeClassAssignments(input.assignedClasses);
    const rawSubjects = Array.from(
      new Set([
        ...(input.subjects || []).map((s) => s.trim()).filter(Boolean),
        ...assignedClasses.map((c) => c.subject || '').filter(Boolean),
      ])
    );
    const subjects = rawSubjects.filter(
      (sub) => sub !== CLASS_TEACHER_SUBJECT_TOKEN
    );
    const hasClassTeacherToken =
      rawSubjects.includes(CLASS_TEACHER_SUBJECT_TOKEN) ||
      assignedClasses.some((c) => c.subject === CLASS_TEACHER_SUBJECT_TOKEN);
    const finalTeacherSubjects =
      subjects.length > 0
        ? subjects
        : hasClassTeacherToken
        ? [CLASS_TEACHER_SUBJECT_TOKEN]
        : [];
    if (finalTeacherSubjects.length === 0) {
      throw new ConflictError('Assign at least one subject to the teacher.', 400);
    }

    subjects.forEach((sub) => {
      if (!tenant.subjects.includes(sub)) {
        tenant.subjects.push(sub);
      }
    });

    const emailSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
    const teacher: TeacherProfile = {
      id: `t-${randomUUID().slice(0, 6)}`,
      name,
      email: (input.email || '').trim() || `${emailSlug || 'teacher'}@${tenant.slug}.ac.ke`,
      phone: (input.phone || '').trim() || '+254 700 000 000',
      department: (input.department || '').trim() || (hasClassTeacherToken ? 'Class Teacher' : finalTeacherSubjects[0]),
      subjects: finalTeacherSubjects,
      assignedClasses,
    };
    tenant.teachers.push(teacher);

    const classLabel =
      assignedClasses.length > 0
        ? assignedClasses
            .map((c) =>
              c.subject ? `${c.grade} (${c.section} · ${c.subject})` : `${c.grade} (${c.section})`
            )
            .join(', ')
        : 'All Grades & Streams';

    this.persist();
    this.pushNotification(
      tenantId,
      'timetable',
      `Teacher Added: ${teacher.name}`,
      `${teacher.subjects.join(', ')} · ${classLabel}.`,
      'timetable'
    );
    this.syncTenant(tenantId, 'teacher:added');
    return { teacher, tenant };
  }

  updateTeacher(
    tenantId: string,
    teacherId: string,
    input: {
      name?: string;
      email?: string;
      phone?: string;
      department?: string;
      subjects: string[];
      assignedClasses?: TeacherClassAssignment[];
    }
  ): { teacher: TeacherProfile; tenant: Tenant } {
    const tenant = this.requireTenant(tenantId);
    const teacher = tenant.teachers.find((t) => t.id === teacherId);
    if (!teacher) {
      throw new ConflictError('Teacher not found in this school.', 404);
    }
    const normalizedClasses =
      input.assignedClasses !== undefined
        ? this.normalizeClassAssignments(input.assignedClasses)
        : undefined;
    const rawSubjects = Array.from(
      new Set([
        ...(input.subjects || []).map((s) => s.trim()).filter(Boolean),
        ...(normalizedClasses || []).map((c) => c.subject || '').filter(Boolean),
      ])
    );
    const subjects = rawSubjects.filter(
      (sub) => sub !== CLASS_TEACHER_SUBJECT_TOKEN
    );
    const hasClassTeacherToken =
      rawSubjects.includes(CLASS_TEACHER_SUBJECT_TOKEN) ||
      (normalizedClasses || teacher.assignedClasses || []).some(
        (c) => c.subject === CLASS_TEACHER_SUBJECT_TOKEN
      );
    const finalTeacherSubjects =
      subjects.length > 0
        ? subjects
        : hasClassTeacherToken
        ? [CLASS_TEACHER_SUBJECT_TOKEN]
        : [];
    if (finalTeacherSubjects.length === 0) {
      throw new ConflictError('Each teacher must teach at least one subject.', 400);
    }

    subjects.forEach((sub) => {
      if (!tenant.subjects.includes(sub)) {
        tenant.subjects.push(sub);
      }
    });

    if (input.name && input.name.trim()) {
      teacher.name = input.name.trim();
      this.state.timetable.forEach((slot) => {
        if (slot.tenantId === tenantId && slot.teacherId === teacherId) {
          slot.teacherName = teacher.name;
        }
      });
    }
    if (input.email !== undefined && input.email.trim()) {
      teacher.email = input.email.trim();
    }
    if (input.phone !== undefined) {
      teacher.phone = input.phone.trim() || teacher.phone || '+254 700 000 000';
    }
    if (input.department !== undefined && input.department.trim()) {
      teacher.department = input.department.trim();
    }
    teacher.subjects = finalTeacherSubjects;
    if (normalizedClasses !== undefined) {
      teacher.assignedClasses = normalizedClasses;
    }

    this.persist();
    this.pushNotification(
      tenantId,
      'timetable',
      `Teacher Allocation Updated: ${teacher.name}`,
      `Teaches: ${teacher.subjects.join(', ')}.`,
      'timetable'
    );
    this.syncTenant(tenantId, 'teacher:updated');
    return { teacher, tenant };
  }

  updateSubjects(
    tenantId: string,
    input: {
      subjects: string[];
      renames?: Record<string, string>;
      subjectWeeklyLessons?: Record<string, number>;
      level?: CbcClusterId;
    }
  ): Tenant {
    const tenant = this.requireTenant(tenantId);
    const cleaned = Array.from(
      new Set((input.subjects || []).map((s) => s.trim()).filter(Boolean))
    );
    if (cleaned.length === 0) {
      throw new ConflictError('Keep at least one subject configured.', 400);
    }

    const seenLower = new Set<string>();
    for (const sub of cleaned) {
      const low = sub.toLowerCase();
      if (seenLower.has(low)) {
        throw new ConflictError(`Duplicate subject name "${sub}".`, 400);
      }
      seenLower.add(low);
    }

    const renames = input.renames || {};
    const reverseRenames: Record<string, string> = {};
    Object.entries(renames).forEach(([oldName, newName]) => {
      if (newName) reverseRenames[newName] = oldName;
    });

    if (Object.keys(renames).length > 0) {
      this.state.timetable.forEach((slot) => {
        if (slot.tenantId === tenantId && renames[slot.subject]) {
          slot.subject = renames[slot.subject];
        }
      });
      this.state.examResults.forEach((res) => {
        if (res.tenantId === tenantId && renames[res.subject]) {
          res.subject = renames[res.subject];
        }
      });
    }

    const nextWeeklyLessons: Record<string, number> = {};
    cleaned.forEach((sub) => {
      const prevName = reverseRenames[sub] || sub;
      const incoming = input.subjectWeeklyLessons?.[sub];
      if (typeof incoming === 'number' && Number.isFinite(incoming)) {
        nextWeeklyLessons[sub] = Math.max(0, Math.min(10, Math.round(incoming)));
      } else {
        nextWeeklyLessons[sub] = getLessonsPerWeekForSubject(tenant, prevName, input.level);
      }
    });

    if (input.level) {
      if (!tenant.levelSubjects) {
        tenant.levelSubjects = buildDefaultLevelSubjectsMap();
      }
      if (!tenant.levelSubjectWeeklyLessons) {
        tenant.levelSubjectWeeklyLessons = buildDefaultLevelWeeklyLessonsMap();
      }
      tenant.levelSubjects[input.level] = cleaned;
      tenant.levelSubjectWeeklyLessons[input.level] = nextWeeklyLessons;

      const unionSubjects = Array.from(
        new Set(
          KENYAN_CBC_CLUSTERS.flatMap(
            (c) => tenant.levelSubjects?.[c.id] || []
          )
        )
      );
      tenant.subjects = unionSubjects.length > 0 ? unionSubjects : cleaned;
      tenant.subjectWeeklyLessons = {
        ...(tenant.subjectWeeklyLessons || {}),
        ...nextWeeklyLessons,
      };
    } else {
      tenant.subjects = cleaned;
      tenant.subjectWeeklyLessons = nextWeeklyLessons;
    }

    const validSchoolSet = new Set(tenant.subjects.map((s) => s.toLowerCase()));
    tenant.teachers.forEach((teacher) => {
      const remapped = teacher.subjects
        .map((s) => renames[s] || s)
        .filter(
          (s) => s === CLASS_TEACHER_SUBJECT_TOKEN || validSchoolSet.has(s.toLowerCase())
        );
      teacher.subjects = Array.from(new Set(remapped));
      if (Array.isArray(teacher.assignedClasses)) {
        teacher.assignedClasses = this.normalizeClassAssignments(
          teacher.assignedClasses.map((ac) => {
            if (!ac.subject) return ac;
            const nextSub = renames[ac.subject] || ac.subject;
            return nextSub === CLASS_TEACHER_SUBJECT_TOKEN ||
              validSchoolSet.has(nextSub.toLowerCase())
              ? { ...ac, subject: nextSub }
              : { grade: ac.grade, section: ac.section };
          })
        );
      }
    });

    const totalWeekly = Object.values(nextWeeklyLessons).reduce((sum, n) => sum + n, 0);
    const levelDef = input.level
      ? KENYAN_CBC_CLUSTERS.find((c) => c.id === input.level)
      : undefined;
    this.persist();
    this.pushNotification(
      tenantId,
      'timetable',
      levelDef ? `${levelDef.label} Subjects Updated` : 'School Subjects Updated',
      `${cleaned.length} active subjects configured${levelDef ? ` for ${levelDef.label}` : ''} (${totalWeekly} lessons/week).`,
      'timetable'
    );
    this.syncTenant(tenantId, 'tenant:subjects-updated');
    return tenant;
  }

  deleteTeacher(tenantId: string, teacherId: string): { tenant: Tenant; removedSlots: number } {
    const tenant = this.requireTenant(tenantId);
    if (tenant.teachers.length <= 1) {
      throw new ConflictError('Keep at least one teacher configured for the school.', 400);
    }
    const target = tenant.teachers.find((t) => t.id === teacherId);
    if (!target) {
      throw new ConflictError('Teacher not found.', 404);
    }
    tenant.teachers = tenant.teachers.filter((t) => t.id !== teacherId);
    if (tenant.timetableLessons) {
      tenant.timetableLessons = tenant.timetableLessons.filter((l) => l.teacherId !== teacherId);
    }
    const beforeSlots = this.state.timetable.length;
    this.state.timetable = this.state.timetable.filter(
      (s) => !(s.tenantId === tenantId && s.teacherId === teacherId)
    );
    const removedSlots = beforeSlots - this.state.timetable.length;

    this.persist();
    this.pushNotification(
      tenantId,
      'timetable',
      `Teacher Removed: ${target.name}`,
      removedSlots > 0
        ? `Removed teacher and cleared ${removedSlots} timetable lesson(s).`
        : 'Removed from faculty allocation.',
      'timetable'
    );
    this.syncTenant(tenantId, 'teacher:deleted');
    return { tenant, removedSlots };
  }

  updateStreams(
    tenantId: string,
    input: {
      gradeConfigs?: Array<{
        originalGrade?: string | null;
        grade: string;
        streams: string[];
        streamRenames?: Record<string, string>;
      }>;
      streams?: string[];
      renames?: Record<string, string>;
    }
  ): Tenant {
    const tenant = this.requireTenant(tenantId);

    if (Array.isArray(input.gradeConfigs)) {
      if (input.gradeConfigs.length === 0) {
        throw new ConflictError('At least one grade must be configured.', 400);
      }

      const nextGrades: string[] = [];
      const nextGradeStreams: Record<string, string[]> = {};
      const seenGrades = new Set<string>();
      const gradeRenames: Record<string, string> = {};
      const perGradeStreamRenames: Record<string, Record<string, string>> = {};

      for (const cfg of input.gradeConfigs) {
        const gradeName = (cfg.grade || '').trim();
        if (!gradeName) {
          throw new ConflictError('Grade names cannot be empty.', 400);
        }
        const gradeKey = gradeName.toLowerCase();
        if (seenGrades.has(gradeKey)) {
          throw new ConflictError(`Duplicate grade name "${gradeName}".`, 400);
        }
        seenGrades.add(gradeKey);

        const cleanedStreams = Array.from(
          new Set((cfg.streams || []).map((s) => s.trim()).filter(Boolean))
        );
        if (cleanedStreams.length === 0) {
          throw new ConflictError(`Grade "${gradeName}" must have at least one stream.`, 400);
        }

        nextGrades.push(gradeName);
        nextGradeStreams[gradeName] = cleanedStreams;

        if (cfg.originalGrade && cfg.originalGrade.trim() && cfg.originalGrade.trim() !== gradeName) {
          gradeRenames[cfg.originalGrade.trim()] = gradeName;
        }
        if (cfg.streamRenames && Object.keys(cfg.streamRenames).length > 0) {
          perGradeStreamRenames[gradeName] = cfg.streamRenames;
        }
      }

      // 1. Cascade grade renames across all tenant entities
      if (Object.keys(gradeRenames).length > 0) {
        this.state.students.forEach((s) => {
          if (s.tenantId === tenantId && gradeRenames[s.grade]) {
            s.grade = gradeRenames[s.grade];
          }
        });
        this.state.admissions.forEach((a) => {
          if (a.tenantId === tenantId && gradeRenames[a.targetGrade]) {
            a.targetGrade = gradeRenames[a.targetGrade];
          }
        });
        this.state.timetable.forEach((t) => {
          if (t.tenantId === tenantId && gradeRenames[t.grade]) {
            t.grade = gradeRenames[t.grade];
          }
        });
        this.state.attendance.forEach((att) => {
          if (att.tenantId === tenantId && gradeRenames[att.grade]) {
            att.grade = gradeRenames[att.grade];
          }
        });
        this.state.examResults.forEach((res) => {
          if (res.tenantId === tenantId && gradeRenames[res.grade]) {
            res.grade = gradeRenames[res.grade];
          }
        });
        this.state.feeStructures.forEach((fsItem) => {
          if (fsItem.tenantId === tenantId && gradeRenames[fsItem.grade]) {
            fsItem.grade = gradeRenames[fsItem.grade];
          }
        });
        this.state.invoices.forEach((inv) => {
          if (inv.tenantId === tenantId && gradeRenames[inv.grade]) {
            inv.grade = gradeRenames[inv.grade];
          }
        });
        (this.state.independentVotelines || []).forEach((ivl) => {
          if (ivl.tenantId === tenantId && gradeRenames[ivl.grade]) {
            ivl.grade = gradeRenames[ivl.grade];
          }
        });
        tenant.teachers.forEach((teacher) => {
          if (Array.isArray(teacher.assignedClasses)) {
            teacher.assignedClasses = teacher.assignedClasses.map((ac) => ({
              ...ac,
              grade: gradeRenames[ac.grade] || ac.grade,
              section: ac.section,
            }));
          }
        });
      }

      // 2. Cascade per-grade stream renames across grade-scoped entities
      if (Object.keys(perGradeStreamRenames).length > 0) {
        this.state.students.forEach((s) => {
          const map = perGradeStreamRenames[s.grade];
          if (s.tenantId === tenantId && map?.[s.section]) {
            s.section = map[s.section];
          }
        });
        this.state.admissions.forEach((a) => {
          const map = perGradeStreamRenames[a.targetGrade];
          if (a.tenantId === tenantId && map?.[a.assignedSection]) {
            a.assignedSection = map[a.assignedSection];
          }
        });
        this.state.timetable.forEach((t) => {
          const map = perGradeStreamRenames[t.grade];
          if (t.tenantId === tenantId && map?.[t.section]) {
            t.section = map[t.section];
          }
        });
        this.state.attendance.forEach((att) => {
          const map = perGradeStreamRenames[att.grade];
          if (att.tenantId === tenantId && map?.[att.section]) {
            att.section = map[att.section];
          }
        });
        this.state.examResults.forEach((res) => {
          const map = perGradeStreamRenames[res.grade];
          if (res.tenantId === tenantId && map?.[res.section]) {
            res.section = map[res.section];
          }
        });
        tenant.teachers.forEach((teacher) => {
          if (Array.isArray(teacher.assignedClasses)) {
            teacher.assignedClasses = this.normalizeClassAssignments(
              teacher.assignedClasses.map((ac) => {
                const map = perGradeStreamRenames[ac.grade];
                return {
                  ...ac,
                  grade: ac.grade,
                  section: (map && map[ac.section]) || ac.section,
                };
              })
            );
          }
        });
      }

      const unionStreams = Array.from(
        new Set(nextGrades.flatMap((g) => nextGradeStreams[g]))
      );

      tenant.grades = nextGrades;
      tenant.gradeStreams = nextGradeStreams;
      tenant.sections = unionStreams;

      const totalStreams = Object.values(nextGradeStreams).reduce(
        (acc, list) => acc + list.length,
        0
      );

      this.persist();
      this.pushNotification(
        tenantId,
        'announcement',
        'Grades & Streams Updated',
        `${nextGrades.length} grades and ${totalStreams} stream assignments configured.`,
        'admissions'
      );
      this.syncTenant(tenantId, 'tenant:streams-updated');
      return tenant;
    }

    // Backwards-compatible flat stream update
    const cleaned = Array.from(
      new Set((input.streams || []).map((s) => s.trim()).filter(Boolean))
    );
    if (cleaned.length === 0) {
      throw new ConflictError('At least one stream must be configured.', 400);
    }

    const renames = input.renames || {};
    if (Object.keys(renames).length > 0) {
      this.state.students.forEach((s) => {
        if (s.tenantId === tenantId && renames[s.section]) {
          s.section = renames[s.section];
        }
      });
      this.state.admissions.forEach((a) => {
        if (a.tenantId === tenantId && renames[a.assignedSection]) {
          a.assignedSection = renames[a.assignedSection];
        }
      });
      this.state.timetable.forEach((t) => {
        if (t.tenantId === tenantId && renames[t.section]) {
          t.section = renames[t.section];
        }
      });
      this.state.attendance.forEach((att) => {
        if (att.tenantId === tenantId && renames[att.section]) {
          att.section = renames[att.section];
        }
      });
      this.state.examResults.forEach((res) => {
        if (res.tenantId === tenantId && renames[res.section]) {
          res.section = renames[res.section];
        }
      });
      tenant.teachers.forEach((teacher) => {
        if (Array.isArray(teacher.assignedClasses)) {
          teacher.assignedClasses = this.normalizeClassAssignments(
            teacher.assignedClasses.map((ac) => ({
              ...ac,
              grade: ac.grade,
              section: renames[ac.section] || ac.section,
            }))
          );
        }
      });
    }

    tenant.sections = cleaned;
    tenant.gradeStreams = Object.fromEntries(tenant.grades.map((g) => [g, [...cleaned]]));
    this.persist();
    this.pushNotification(
      tenantId,
      'announcement',
      'School Streams Updated',
      `Configured streams: ${cleaned.join(', ')}.`,
      'admissions'
    );
    this.syncTenant(tenantId, 'tenant:streams-updated');
    return tenant;
  }

  // Phase 2 Helpers: Monotonic Counters, Validators, Finance Audit, Statutory Schedules
  private bumpTenantCounter(
    mapKey:
      | 'receiptCounters'
      | 'studentCounters'
      | 'invoiceCounters'
      | 'admissionCounters'
      | 'voucherCounters'
      | 'creditNoteCounters',
    tenantId: string,
    floor = 0
  ): number {
    if (!this.state[mapKey] || typeof this.state[mapKey] !== 'object') {
      this.state[mapKey] = {};
    }
    const current = Number(this.state[mapKey]![tenantId] || 0);
    const next = Math.max(current, floor) + 1;
    this.state[mapKey]![tenantId] = next;
    return next;
  }

  private nextReceiptNumber(tenantId: string): string {
    const existingRefs = new Set<string>();
    for (const inv of this.state.invoices) {
      if (inv.tenantId !== tenantId) continue;
      for (const p of inv.payments || []) {
        existingRefs.add(p.receiptNumber.trim().toUpperCase());
      }
    }
    for (const ivl of this.state.independentVotelines || []) {
      if (ivl.tenantId !== tenantId) continue;
      for (const p of ivl.payments || []) {
        existingRefs.add(p.receiptNumber.trim().toUpperCase());
      }
    }
    let candidate = '';
    do {
      const seq = this.bumpTenantCounter('receiptCounters', tenantId, existingRefs.size);
      candidate = `RCT-${String(seq).padStart(6, '0')}`;
    } while (existingRefs.has(candidate));
    return candidate;
  }

  private nextCreditNoteNumber(tenantId: string): string {
    const floor = (this.state.creditNotes || []).filter((c) => c.tenantId === tenantId).length;
    const seq = this.bumpTenantCounter('creditNoteCounters', tenantId, floor);
    return `CN-${String(seq).padStart(6, '0')}`;
  }

  private nextStudentCode(tenantId: string): string {
    const existing = new Set(
      this.state.students
        .filter((s) => s.tenantId === tenantId)
        .map((s) => s.studentCode.trim().toUpperCase())
    );
    let candidate = '';
    do {
      const seq = this.bumpTenantCounter('studentCounters', tenantId, existing.size);
      candidate = `ADM-${2600 + seq}`;
    } while (existing.has(candidate));
    return candidate;
  }

  private nextUniqueUpi(tenantId: string): string {
    const existing = new Set(
      this.state.students
        .filter((s) => s.tenantId === tenantId)
        .map((s) => s.upi.trim().toUpperCase())
    );
    let candidate = '';
    do {
      candidate = `KE-${randomInt(1000000, 9999999)}M`;
    } while (existing.has(candidate));
    return candidate;
  }

  private nextInvoiceNumber(tenant: Tenant): string {
    const prefix = tenant.slug.slice(0, 3).toUpperCase();
    const existing = new Set(
      this.state.invoices
        .filter((i) => i.tenantId === tenant.id)
        .map((i) => i.invoiceNumber.trim().toUpperCase())
    );
    let candidate = '';
    do {
      const seq = this.bumpTenantCounter('invoiceCounters', tenant.id, existing.size);
      candidate = `${prefix}-INV-${202600 + seq}`;
    } while (existing.has(candidate));
    return candidate;
  }

  private nextAdmissionCode(tenant: Tenant): string {
    const prefix = tenant.slug.slice(0, 3).toUpperCase();
    const existing = new Set(
      this.state.admissions
        .filter((a) => a.tenantId === tenant.id)
        .map((a) => a.applicationCode.trim().toUpperCase())
    );
    let candidate = '';
    do {
      const seq = this.bumpTenantCounter('admissionCounters', tenant.id, existing.size);
      candidate = `${prefix}-APP-${202600 + seq}`;
    } while (existing.has(candidate));
    return candidate;
  }

  private nextVoucherNumber(tenant: Tenant): string {
    const prefix = tenant.slug.slice(0, 3).toUpperCase();
    const existing = new Set(
      this.state.expenses
        .filter((e) => e.tenantId === tenant.id)
        .map((e) => e.voucherNumber.trim().toUpperCase())
    );
    let candidate = '';
    do {
      const seq = this.bumpTenantCounter('voucherCounters', tenant.id, existing.size);
      candidate = `${prefix}-EXP-${202600 + seq}`;
    } while (existing.has(candidate));
    return candidate;
  }

  private parseStrictPositiveAmount(raw: unknown, fieldLabel = 'Amount'): number {
    if (
      raw === null ||
      raw === undefined ||
      typeof raw === 'boolean' ||
      (typeof raw === 'string' && raw.trim() === '')
    ) {
      throw new ConflictError(`${fieldLabel} must be a positive number greater than zero.`, 400);
    }
    const num = Number(raw);
    if (!Number.isFinite(num) || num <= 0) {
      throw new ConflictError(`${fieldLabel} must be a finite number greater than zero.`, 400);
    }
    return Math.round(num);
  }

  private validatePaymentDate(
    rawPaidAt: string | undefined,
    actor?: Pick<TenantUser, 'role'>
  ): string {
    const now = Date.now();
    if (!rawPaidAt || !rawPaidAt.trim()) {
      return new Date(now).toISOString();
    }
    const parsedMs = Date.parse(rawPaidAt);
    if (Number.isNaN(parsedMs)) {
      throw new ConflictError('Invalid payment date format.', 400);
    }
    if (parsedMs > now + 5 * 60_000) {
      throw new ConflictError('Payment date cannot be in the future.', 400);
    }
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const isPrivilegedAdmin =
      actor?.role === 'Admin' || actor?.role === 'Super Admin' || actor?.role === 'Developer';
    if (now - parsedMs > thirtyDaysMs && !isPrivilegedAdmin) {
      throw new ConflictError(
        'Payments backdated more than 30 days require School Admin authorization.',
        403
      );
    }
    return new Date(parsedMs).toISOString();
  }

  private validateAndNormalizeKenyanPhone(raw: string, fieldLabel = 'Guardian phone'): string {
    const cleaned = (raw || '').replace(/[\s()-]+/g, '').trim();
    if (!cleaned) {
      throw new ConflictError(`${fieldLabel} is required (Kenyan format e.g. +254712345678 or 0712345678).`, 400);
    }
    if (/^\+254[17]\d{8}$/.test(cleaned)) return cleaned;
    if (/^254[17]\d{8}$/.test(cleaned)) return `+${cleaned}`;
    if (/^0[17]\d{8}$/.test(cleaned)) return `+254${cleaned.slice(1)}`;
    throw new ConflictError(
      `Invalid ${fieldLabel} "${raw}". Use valid Kenyan format (+2547XXXXXXXX, +2541XXXXXXXX, 07XXXXXXXX, or 01XXXXXXXX).`,
      400
    );
  }

  private validateStudentDateOfBirth(rawDob: string, grade: string): string {
    const trimmed = (rawDob || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      throw new ConflictError('Date of birth must be a valid YYYY-MM-DD calendar date.', 400);
    }
    const [y, m, d] = trimmed.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (
      dt.getUTCFullYear() !== y ||
      dt.getUTCMonth() !== m - 1 ||
      dt.getUTCDate() !== d
    ) {
      throw new ConflictError(`Invalid calendar date of birth "${trimmed}".`, 400);
    }
    const now = new Date();
    if (dt.getTime() >= now.getTime()) {
      throw new ConflictError('Date of birth must be in the past.', 400);
    }
    const ageYears = (now.getTime() - dt.getTime()) / (365.2425 * 24 * 60 * 60 * 1000);
    if (ageYears < 2 || ageYears > 25) {
      throw new ConflictError(
        `Learner age (${ageYears.toFixed(1)} yrs) is outside plausible school enrolment age (2–25 years).`,
        400
      );
    }
    const gLower = grade.toLowerCase();
    if ((gLower.includes('playgroup') || gLower === 'pp1' || gLower === 'pp2') && ageYears > 10) {
      throw new ConflictError(`Date of birth implies age ${Math.floor(ageYears)}, which is not plausible for ${grade}.`, 400);
    }
    if (/grade\s*(1[0-2]|9)|form\s*[1-4]/i.test(grade) && ageYears < 10) {
      throw new ConflictError(`Date of birth implies age ${Math.floor(ageYears)}, which is too young for ${grade}.`, 400);
    }
    return trimmed;
  }

  private ensurePaymentReferenceUnique(
    tenantId: string,
    reference: string,
    method: PaymentMethod
  ) {
    const refTrim = (reference || '').trim();
    if (!refTrim) return;
    if (method === 'Cash' && /^auto$/i.test(refTrim)) return;
    const refLower = refTrim.toLowerCase();
    for (const inv of this.state.invoices) {
      if (inv.tenantId !== tenantId) continue;
      for (const p of inv.payments || []) {
        if (p.voided || p.isReversalEntry) continue;
        if (p.reference && p.reference.trim().toLowerCase() === refLower) {
          throw new ConflictError(
            `Duplicate payment reference "${refTrim}" already exists on invoice ${inv.invoiceNumber}.`,
            409
          );
        }
      }
    }
    for (const ivl of this.state.independentVotelines || []) {
      if (ivl.tenantId !== tenantId || ivl.voided) continue;
      for (const p of ivl.payments || []) {
        if (p.reference && p.reference.trim().toLowerCase() === refLower) {
          throw new ConflictError(
            `Duplicate payment reference "${refTrim}" already exists on independent voteline ${ivl.name}.`,
            409
          );
        }
      }
    }
  }

  private recomputeInvoiceTotals(invoice: FeeInvoice) {
    const activePayments = (invoice.payments || []).filter((p) => !p.isReversalEntry);
    const voidedIds = new Set(
      activePayments.filter((p) => p.voided).map((p) => p.id)
    );
    let paidSum = 0;
    for (const p of activePayments) {
      if (p.voided || voidedIds.has(p.id)) continue;
      const effectiveApplied =
        typeof p.appliedAmount === 'number' ? p.appliedAmount : p.amount;
      paidSum += effectiveApplied;
    }
    const creditNotes = Math.max(0, Number(invoice.creditNotesTotal || 0));
    const waivers = Math.max(0, Number(invoice.waiverTotal || 0));
    const siblingDisc = Math.max(0, Number(invoice.siblingDiscountApplied || 0));
    const netBilled = Math.max(0, invoice.totalAmount - creditNotes - waivers - siblingDisc);
    invoice.paidAmount = Math.max(0, Math.round(paidSum));
    invoice.balance = Math.max(0, Math.round(netBilled - invoice.paidAmount));
    if (invoice.balance === 0) {
      invoice.status = 'Paid';
    } else if (invoice.paidAmount > 0 || creditNotes + waivers + siblingDisc > 0) {
      invoice.status = 'Partial';
    } else {
      invoice.status = 'Pending';
    }
  }

  private findSiblingCountForStudent(
    tenantId: string,
    guardianPhone: string,
    guardianEmail: string,
    excludeStudentId?: string
  ): number {
    const normPhone = guardianPhone.trim();
    const normEmail = guardianEmail.trim().toLowerCase();
    return this.state.students.filter((s) => {
      if (s.tenantId !== tenantId || s.deleted || s.status !== 'Active') return false;
      if (excludeStudentId && s.id === excludeStudentId) return false;
      const samePhone = Boolean(normPhone && s.guardianPhone.trim() === normPhone);
      const sameEmail = Boolean(normEmail && s.guardianEmail.trim().toLowerCase() === normEmail);
      return samePhone || sameEmail;
    }).length;
  }

  private applySiblingDiscountIfEligible(tenant: Tenant, student: Student, invoice: FeeInvoice) {
    const cfg = tenant.siblingDiscountConfig;
    if (!cfg?.enabled || cfg.percentage <= 0) return;
    const minSiblings = Math.max(2, cfg.minSiblings || 2);
    const otherSiblings = this.findSiblingCountForStudent(
      tenant.id,
      student.guardianPhone,
      student.guardianEmail,
      student.id
    );
    if (otherSiblings + 1 >= minSiblings) {
      const discountAmt = Math.min(
        invoice.totalAmount,
        Math.round((invoice.totalAmount * Math.min(50, cfg.percentage)) / 100)
      );
      if (discountAmt > 0) {
        invoice.siblingDiscountApplied = discountAmt;
        this.recomputeInvoiceTotals(invoice);
      }
    }
  }

  private appendFinanceAudit(
    tenantId: string,
    actor: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'> | undefined,
    action: string,
    entity: string,
    entityId: string,
    before: unknown,
    after: unknown,
    ip?: string
  ): FinanceAuditEntry {
    if (!Array.isArray(this.state.financeAuditLogs)) {
      this.state.financeAuditLogs = [];
    }
    const entry: FinanceAuditEntry = {
      id: `faud-${randomUUID().slice(0, 8)}`,
      tenantId,
      timestamp: new Date().toISOString(),
      actorUserId: actor?.id || 'system',
      who: actor?.fullName || actor?.email || 'System',
      role: actor?.role || 'Admin',
      action,
      entity,
      entityId,
      before,
      after,
      ip,
    };
    this.state.financeAuditLogs.unshift(entry);
    if (this.state.financeAuditLogs.length > 2000) {
      this.state.financeAuditLogs = this.state.financeAuditLogs.slice(0, 2000);
    }
    return entry;
  }

  getFinanceAuditLogs(tenantId: string, limit = 150): FinanceAuditEntry[] {
    this.requireTenant(tenantId);
    const safeLimit = Math.max(1, Math.min(500, Math.round(limit)));
    return (this.state.financeAuditLogs || [])
      .filter((e) => e.tenantId === tenantId)
      .slice(0, safeLimit);
  }

  listStatutoryRateSchedules(): PayrollStatutoryRateSchedule[] {
    if (!Array.isArray(this.state.statutoryRateSchedules) || this.state.statutoryRateSchedules.length === 0) {
      this.state.statutoryRateSchedules = JSON.parse(
        JSON.stringify(DEFAULT_STATUTORY_RATE_SCHEDULES)
      ) as PayrollStatutoryRateSchedule[];
    }
    return [...this.state.statutoryRateSchedules].sort((a, b) =>
      b.effectiveFrom.localeCompare(a.effectiveFrom)
    );
  }

  upsertStatutoryRateSchedule(
    input: {
      id?: string;
      effectiveFrom: string;
      label: string;
      currency?: CurrencyCode;
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
    },
    actorEmail: string
  ): PayrollStatutoryRateSchedule {
    const effectiveFrom = (input.effectiveFrom || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
      throw new ConflictError('effectiveFrom must be a valid YYYY-MM-DD date.', 400);
    }
    const label = (input.label || '').trim();
    if (!label) {
      throw new ConflictError('Schedule label is required.', 400);
    }
    if (!Array.isArray(input.payeBands) || input.payeBands.length === 0) {
      throw new ConflictError('Provide at least one PAYE tax band.', 400);
    }
    const sanitizedBands: PayeBand[] = input.payeBands.map((b, idx) => {
      const rate = Number(b.rate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
        throw new ConflictError(`PAYE band #${idx + 1} rate must be a decimal between 0 and 1.`, 400);
      }
      const limit = b.limit === null || b.limit === undefined ? null : Math.round(Number(b.limit));
      if (limit !== null && (!Number.isFinite(limit) || limit <= 0)) {
        throw new ConflictError(`PAYE band #${idx + 1} limit must be positive or null.`, 400);
      }
      return { limit, rate };
    });

    if (!Array.isArray(this.state.statutoryRateSchedules)) {
      this.state.statutoryRateSchedules = [];
    }

    const schedule: PayrollStatutoryRateSchedule = {
      id: input.id?.trim() || `stat-${randomUUID().slice(0, 6)}`,
      effectiveFrom,
      label,
      currency: input.currency === 'USD' ? 'USD' : 'KES',
      nssfLowerLimit: Math.max(0, Math.round(Number(input.nssfLowerLimit))),
      nssfUpperLimit: Math.max(0, Math.round(Number(input.nssfUpperLimit))),
      nssfRate: Number(input.nssfRate),
      nssfMaxEmployee: Math.max(0, Math.round(Number(input.nssfMaxEmployee))),
      shifRate: Number(input.shifRate),
      shifMin: Math.max(0, Math.round(Number(input.shifMin))),
      housingLevyRate: Number(input.housingLevyRate),
      nitaLevy: Math.max(0, Math.round(Number(input.nitaLevy))),
      personalRelief: Math.max(0, Math.round(Number(input.personalRelief))),
      payeBands: sanitizedBands,
      updatedBy: actorEmail,
      updatedAt: new Date().toISOString(),
    };

    const idx = this.state.statutoryRateSchedules.findIndex((s) => s.id === schedule.id);
    if (idx >= 0) {
      this.state.statutoryRateSchedules[idx] = schedule;
    } else {
      this.state.statutoryRateSchedules.push(schedule);
    }
    this.persist();
    return schedule;
  }

  // Admissions
  createAdmission(
    tenantId: string,
    input: {
      studentName: string;
      dateOfBirth: string;
      gender: 'Female' | 'Male' | 'Non-binary';
      targetGrade: string;
      assignedSection: string;
      guardianName: string;
      guardianEmail: string;
      guardianPhone: string;
      previousSchool: string;
      notes: string;
    }
  ): AdmissionApplication {
    const tenant = this.requireTenant(tenantId);
    const studentName = (input.studentName || '').trim();
    if (studentName.length < 2) {
      throw new ConflictError('Student full name must be at least 2 characters.', 400);
    }
    const targetGrade = (input.targetGrade || '').trim() || tenant.grades[0] || 'Grade 7';
    const validatedDob = this.validateStudentDateOfBirth(input.dateOfBirth, targetGrade);
    const normalizedPhone = this.validateAndNormalizeKenyanPhone(
      input.guardianPhone,
      'Guardian phone'
    );
    const now = new Date().toISOString();

    const app: AdmissionApplication = {
      id: `adm-${randomUUID().slice(0, 8)}`,
      tenantId,
      applicationCode: this.nextAdmissionCode(tenant),
      studentName,
      dateOfBirth: validatedDob,
      gender: input.gender,
      targetGrade,
      assignedSection: input.assignedSection || 'A',
      guardianName: input.guardianName.trim(),
      guardianEmail: input.guardianEmail.trim(),
      guardianPhone: normalizedPhone,
      previousSchool: input.previousSchool.trim() || 'Transfer Applicant',
      stage: 'Submitted',
      checklist: {
        birthCertificate: false,
        transcripts: false,
        medicalClearance: false,
        guardianId: false,
        depositPaid: false,
      },
      notes: input.notes.trim(),
      submittedAt: now,
      updatedAt: now,
    };

    this.state.admissions.unshift(app);
    this.persist();
    this.pushNotification(
      tenantId,
      'admission',
      `New Admission Application: ${app.studentName}`,
      `${app.applicationCode} submitted for ${app.targetGrade} ${app.assignedSection}.`,
      'admissions'
    );
    this.syncTenant(tenantId, 'admission:created');
    return app;
  }

  updateAdmission(
    tenantId: string,
    admissionId: string,
    patch: {
      stage?: AdmissionStage;
      checklist?: Partial<OnboardingChecklist>;
      notes?: string;
      assignedSection?: string;
    }
  ): { application: AdmissionApplication; enrolledStudent?: Student; generatedInvoice?: FeeInvoice } {
    const tenant = this.requireTenant(tenantId);
    const app = this.state.admissions.find((a) => a.id === admissionId && a.tenantId === tenantId);
    if (!app) {
      throw new ConflictError('Admission application not found for this tenant.', 404);
    }

    const previousStage = app.stage;
    if (patch.checklist) {
      app.checklist = { ...app.checklist, ...patch.checklist };
    }
    if (patch.notes !== undefined) {
      app.notes = patch.notes;
    }
    if (patch.assignedSection) {
      app.assignedSection = patch.assignedSection;
    }
    if (patch.stage) {
      app.stage = patch.stage;
    }
    app.updatedAt = new Date().toISOString();

    let enrolledStudent: Student | undefined;
    let generatedInvoice: FeeInvoice | undefined;

    // Auto-onboard student & initial fee invoice when transitioning to Enrolled
    if (app.stage === 'Enrolled' && previousStage !== 'Enrolled') {
      this.assertLearnerCap(tenant);
      const validatedDob = this.validateStudentDateOfBirth(app.dateOfBirth, app.targetGrade);
      const normalizedPhone = this.validateAndNormalizeKenyanPhone(
        app.guardianPhone,
        'Guardian phone'
      );
      app.guardianPhone = normalizedPhone;
      const studentCode = this.nextStudentCode(tenantId);
      const upi = this.nextUniqueUpi(tenantId);

      enrolledStudent = {
        id: `stu-${randomUUID().slice(0, 8)}`,
        tenantId,
        studentCode,
        upi,
        fullName: app.studentName,
        grade: app.targetGrade,
        section: app.assignedSection,
        guardianName: app.guardianName,
        guardianEmail: app.guardianEmail,
        parentUserId: this.findParentUserIdByEmail(tenantId, app.guardianEmail),
        guardianPhone: normalizedPhone,
        gender: app.gender,
        dateOfBirth: validatedDob,
        enrolledAt: new Date().toISOString().slice(0, 10),
        status: 'Active',
        creditBalance: 0,
      };
      this.state.students.unshift(enrolledStudent);

      const feeStruct =
        this.state.feeStructures.find((f) => f.tenantId === tenantId && f.grade === app.targetGrade) ||
        this.state.feeStructures.find((f) => f.tenantId === tenantId);
      const totalAmount = feeStruct ? feeStruct.totalFee : 4800;

      const currentTermEntity = this.resolveTenantTerm(tenantId, { termName: tenant.currentTerm });
      generatedInvoice = {
        id: `inv-${randomUUID().slice(0, 8)}`,
        tenantId,
        termId: currentTermEntity?.id,
        invoiceNumber: this.nextInvoiceNumber(tenant),
        studentId: enrolledStudent.id,
        studentName: enrolledStudent.fullName,
        studentCode: enrolledStudent.studentCode,
        grade: enrolledStudent.grade,
        term: currentTermEntity?.name || tenant.currentTerm,
        dueDate: '2026-12-01',
        totalAmount,
        paidAmount: 0,
        balance: totalAmount,
        status: 'Pending',
        payments: [],
        createdAt: new Date().toISOString(),
      };
      this.applySiblingDiscountIfEligible(tenant, enrolledStudent, generatedInvoice);
      this.state.invoices.unshift(generatedInvoice);

      this.pushNotification(
        tenantId,
        'admission',
        `Student Enrolled: ${enrolledStudent.fullName}`,
        `Assigned ID ${enrolledStudent.studentCode} (${enrolledStudent.grade} ${enrolledStudent.section}) and generated ${generatedInvoice.invoiceNumber}.`,
        'admissions'
      );
    } else if (patch.stage && patch.stage !== previousStage) {
      this.pushNotification(
        tenantId,
        'admission',
        `Application Stage Updated: ${app.studentName}`,
        `${app.applicationCode} moved from ${previousStage} to ${app.stage}.`,
        'admissions'
      );
    }

    this.persist();
    this.syncTenant(tenantId, 'admission:updated');
    return { application: app, enrolledStudent, generatedInvoice };
  }

  enrollStudent(
    tenantId: string,
    input: {
      studentCode?: string;
      upi?: string;
      fullName: string;
      dateOfBirth: string;
      gender: 'Female' | 'Male' | 'Non-binary';
      grade: string;
      section: string;
      guardianName: string;
      guardianPhone: string;
      guardianEmail?: string;
      enrolledAt?: string;
    },
    actor?: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>
  ): { student: Student; invoice: FeeInvoice } {
    const tenant = this.requireTenant(tenantId);
    this.assertLearnerCap(tenant);

    const fullName = (input.fullName || '').trim();
    if (fullName.length < 2) {
      throw new ConflictError('Learner full name must be at least 2 characters.', 400);
    }
    const resolvedGrade = (input.grade || '').trim() || tenant.grades[0] || 'Grade 9';
    if (!tenant.grades.includes(resolvedGrade)) {
      throw new ConflictError(`"${resolvedGrade}" is not a grade configured for ${tenant.name}.`, 400);
    }
    const requestedSection = (input.section || '').trim();
    if (requestedSection && !getStreamsForGrade(tenant, resolvedGrade).includes(requestedSection)) {
      throw new ConflictError(`Stream "${requestedSection}" does not exist for ${resolvedGrade}.`, 400);
    }
    const validatedDob = this.validateStudentDateOfBirth(input.dateOfBirth, resolvedGrade);
    const normalizedPhone = this.validateAndNormalizeKenyanPhone(
      input.guardianPhone,
      'Guardian phone'
    );
    // Same name + date of birth + guardian phone is the same child: block accidental double entry
    // (double-clicked enrol button, re-uploaded import file).
    const sameChild = this.state.students.find(
      (s) =>
        s.tenantId === tenantId &&
        !s.deleted &&
        (s.status === 'Active' || s.status === 'On Leave') &&
        s.fullName.trim().toLowerCase() === fullName.toLowerCase() &&
        s.dateOfBirth === validatedDob &&
        s.guardianPhone === normalizedPhone
    );
    if (sameChild) {
      throw new ConflictError(
        `${fullName} (${sameChild.studentCode}) is already enrolled with the same date of birth and guardian phone.`,
        409
      );
    }

    const studentCode =
      input.studentCode && input.studentCode.trim()
        ? input.studentCode.trim().toUpperCase()
        : this.nextStudentCode(tenantId);
    const upi =
      input.upi && input.upi.trim()
        ? input.upi.trim().toUpperCase()
        : this.nextUniqueUpi(tenantId);

    const dupCode = this.state.students.some(
      (s) =>
        s.tenantId === tenantId &&
        !s.deleted &&
        s.studentCode.trim().toUpperCase() === studentCode
    );
    if (dupCode) {
      throw new ConflictError(
        `Admission number / student code "${studentCode}" is already assigned to another learner in ${tenant.name}.`,
        409
      );
    }
    const dupUpi = this.state.students.some(
      (s) => s.tenantId === tenantId && !s.deleted && s.upi.trim().toUpperCase() === upi
    );
    if (dupUpi) {
      throw new ConflictError(
        `NEMIS / UPI "${upi}" is already registered to another learner in ${tenant.name}.`,
        409
      );
    }

    const validStreams = getStreamsForGrade(tenant, resolvedGrade);
    const student: Student = {
      id: `stu-${randomUUID().slice(0, 8)}`,
      tenantId,
      studentCode,
      upi,
      fullName,
      grade: resolvedGrade,
      section: input.section || validStreams[0] || 'A',
      guardianName: input.guardianName.trim(),
      guardianEmail: input.guardianEmail?.trim() || '',
      parentUserId: this.findParentUserIdByEmail(tenantId, input.guardianEmail),
      guardianPhone: normalizedPhone,
      gender: input.gender || 'Female',
      dateOfBirth: validatedDob,
      enrolledAt: input.enrolledAt || new Date().toISOString().slice(0, 10),
      status: 'Active',
      creditBalance: 0,
    };
    this.state.students.unshift(student);

    const feeStruct =
      this.state.feeStructures.find((f) => f.tenantId === tenantId && f.grade === student.grade) ||
      this.state.feeStructures.find((f) => f.tenantId === tenantId);
    const totalAmount = feeStruct ? feeStruct.totalFee : 4800;

    const currentTermEntity = this.resolveTenantTerm(tenantId, { termName: tenant.currentTerm });
    const invoice: FeeInvoice = {
      id: `inv-${randomUUID().slice(0, 8)}`,
      tenantId,
      termId: currentTermEntity?.id,
      invoiceNumber: this.nextInvoiceNumber(tenant),
      studentId: student.id,
      studentName: student.fullName,
      studentCode: student.studentCode,
      grade: student.grade,
      term: currentTermEntity?.name || tenant.currentTerm,
      dueDate: '2026-12-01',
      totalAmount,
      paidAmount: 0,
      balance: totalAmount,
      status: 'Pending',
      payments: [],
      createdAt: new Date().toISOString(),
    };
    this.applySiblingDiscountIfEligible(tenant, student, invoice);
    this.state.invoices.unshift(invoice);

    this.appendLifecycleAudit(
      tenantId,
      actor,
      'STUDENT_ENROLLED',
      'Student',
      student.id,
      `Enrolled ${student.fullName} (${student.studentCode}) into ${student.grade} ${student.section}.`,
      undefined,
      null,
      { studentCode: student.studentCode, grade: student.grade, section: student.section }
    );

    this.persist();
    this.pushNotification(
      tenantId,
      'admission',
      `New Student Enrolled: ${student.fullName}`,
      `Admin No. ${student.studentCode} · UPI ${student.upi} (${student.grade} · Stream ${student.section}).`,
      'admissions'
    );
    this.syncTenant(tenantId, 'student:enrolled');
    return { student, invoice };
  }

  // Timetable with Strict Conflict Detection
  upsertTimetableSlot(
    tenantId: string,
    input: {
      id?: string;
      day: DayOfWeek;
      period: number;
      grade: string;
      section: string;
      subject: string;
      teacherId: string;
      room: string;
    }
  ): TimetableSlot {
    const tenant = this.requireTenant(tenantId);
    const teacher = tenant.teachers.find((t) => t.id === input.teacherId);
    if (!teacher) {
      throw new ConflictError('Selected teacher does not belong to this school tenant.', 400);
    }

    const periodTimes = getTenantPeriodTimes(tenant);
    const times = periodTimes[input.period];
    if (!times) {
      throw new ConflictError(
        `Lesson ${input.period} does not exist in this school's daily bell schedule.`,
        400
      );
    }

    // Subject time-window constraints apply to manual edits as well as the solver.
    const subjectRule = resolveSubjectConstraint(tenant, input.grade, input.subject);
    const windowCheck = isSlotWithinSubjectTimeWindow(times, subjectRule);
    if (!windowCheck.ok) {
      throw new ConflictError(
        `Subject Time Constraint (${input.subject}): ${windowCheck.reason}`,
        409
      );
    }

    // Teacher constraints set on the Constraints tab apply to manual edits too.
    if ((teacher.unavailable || []).some((u) => u.day === input.day && u.period === input.period)) {
      throw new ConflictError(
        `Availability Conflict: ${teacher.name} is marked unavailable on ${input.day} Lesson ${input.period}.`,
        409
      );
    }
    if (teacher.maxLessonsPerDay) {
      const dayLoad = this.state.timetable.filter(
        (s) => s.tenantId === tenantId && s.teacherId === teacher.id && s.day === input.day && s.id !== input.id
      ).length;
      if (dayLoad >= teacher.maxLessonsPerDay) {
        throw new ConflictError(
          `Workload Conflict: ${teacher.name} already has ${dayLoad} lesson(s) on ${input.day} (limit ${teacher.maxLessonsPerDay}).`,
          409
        );
      }
    }

    const others = this.state.timetable.filter(
      (s) => s.tenantId === tenantId && s.day === input.day && s.period === input.period && s.id !== input.id
    );

    const classSlots = others.filter((s) => s.grade === input.grade && s.section === input.section);
    const classClash = classSlots.find(
      (s) =>
        s.subject.trim().toLowerCase() === input.subject.trim().toLowerCase() ||
        !areSubjectsInSameOptionalGroup(tenant, input.grade, s.subject, input.subject)
    );
    if (classClash) {
      throw new ConflictError(
        `Class Conflict: ${input.grade} Stream ${input.section} already has ${classClash.subject} on ${input.day} Lesson ${input.period}.`,
        409
      );
    }

    const teacherClash = others.find((s) => s.teacherId === input.teacherId);
    if (teacherClash) {
      throw new ConflictError(
        `Teacher Conflict: ${teacher.name} is already teaching ${teacherClash.grade} Stream ${teacherClash.section} (${teacherClash.subject}) on ${input.day} Lesson ${input.period}.`,
        409
      );
    }

    const roomClash = others.find((s) => s.room === input.room);
    if (roomClash) {
      throw new ConflictError(
        `Room Conflict: ${input.room} is already booked for ${roomClash.grade} Stream ${roomClash.section} (${roomClash.subject}) on ${input.day} Lesson ${input.period}.`,
        409
      );
    }

    if (input.id) {
      const existing = this.state.timetable.find((s) => s.id === input.id && s.tenantId === tenantId);
      if (!existing) throw new ConflictError('Timetable slot not found.', 404);
      existing.day = input.day;
      existing.period = input.period;
      existing.startTime = times.startTime;
      existing.endTime = times.endTime;
      existing.grade = input.grade;
      existing.section = input.section;
      existing.subject = input.subject;
      existing.teacherId = teacher.id;
      existing.teacherName = teacher.name;
      existing.room = input.room;
      this.persist();
      this.syncTenant(tenantId, 'timetable:updated');
      return existing;
    }

    const slot: TimetableSlot = {
      id: `tt-${randomUUID().slice(0, 8)}`,
      tenantId,
      day: input.day,
      period: input.period,
      startTime: times.startTime,
      endTime: times.endTime,
      grade: input.grade,
      section: input.section,
      subject: input.subject,
      teacherId: teacher.id,
      teacherName: teacher.name,
      room: input.room,
    };
    this.state.timetable.push(slot);
    this.persist();
    this.pushNotification(
      tenantId,
      'timetable',
      `Timetable Updated: ${slot.subject}`,
      `${slot.grade} Stream ${slot.section} · ${slot.day} Lesson ${slot.period} in ${slot.room} (${slot.teacherName}).`,
      'timetable'
    );
    this.syncTenant(tenantId, 'timetable:created');
    return slot;
  }

  deleteTimetableSlot(tenantId: string, slotId: string) {
    this.requireTenant(tenantId);
    const before = this.state.timetable.length;
    this.state.timetable = this.state.timetable.filter((s) => !(s.id === slotId && s.tenantId === tenantId));
    if (this.state.timetable.length === before) {
      throw new ConflictError('Timetable slot not found.', 404);
    }
    this.persist();
    this.syncTenant(tenantId, 'timetable:deleted');
  }


  // ---------------------------------------------------------------------------
  // Timetabling: day structure, subject constraints, optional groups, lesson cards & solver
  // ---------------------------------------------------------------------------

  private teachingPeriods(tenant: Tenant): number[] {
    return getTenantLessonRows(tenant).map((r) => r.period as number);
  }

  /** A double lesson may start on a period only when the next row of the bell schedule is another lesson. */
  private doubleStartPeriods(tenant: Tenant): number[] {
    return getDoubleStartPeriodsFromSchedule(getTenantBellSchedule(tenant));
  }

  private validateTimeString(value: unknown, fieldName: string): string {
    const raw = String(value || '').trim();
    if (!/^\d{2}:\d{2}$/.test(raw)) {
      throw new ConflictError(`${fieldName} must be in HH:MM (24-hour) format.`, 400);
    }
    const [hh, mm] = raw.split(':').map(Number);
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) {
      throw new ConflictError(`${fieldName} contains an invalid time.`, 400);
    }
    return raw;
  }

  setTimetableDaySchedule(
    tenantId: string,
    input: {
      bellSchedule?: BellScheduleRow[];
      dayOpeningNote?: string;
      dayClosingNote?: string;
    }
  ): {
    bellSchedule: BellScheduleRow[];
    dayOpeningNote?: string;
    dayClosingNote?: string;
  } {
    const tenant = this.requireTenant(tenantId);
    const rawRows = Array.isArray(input.bellSchedule) ? input.bellSchedule : [];
    if (rawRows.length === 0) {
      throw new ConflictError('Provide at least one lesson row in the day schedule.', 400);
    }

    const sanitized: BellScheduleRow[] = rawRows.map((row, idx) => {
      const kind: 'lesson' | 'break' = row.kind === 'break' ? 'break' : 'lesson';
      const startTime = this.validateTimeString(row.startTime, `Row ${idx + 1} start time`);
      const endTime = this.validateTimeString(row.endTime, `Row ${idx + 1} end time`);
      if (startTime >= endTime) {
        throw new ConflictError(
          `Row ${idx + 1} ("${row.label || kind}") end time (${endTime}) must be after start time (${startTime}).`,
          400
        );
      }
      return {
        id: row.id || `bell-${randomUUID().slice(0, 6)}`,
        kind,
        label: (row.label || '').trim() || (kind === 'break' ? 'Break' : 'Lesson'),
        startTime,
        endTime,
        time: `${startTime} – ${endTime}`,
      };
    });

    const normalized = normalizeBellSchedule(sanitized);
    const lessonRows = normalized.filter((r) => r.kind === 'lesson');
    if (lessonRows.length === 0) {
      throw new ConflictError('The daily schedule must include at least 1 teaching lesson period.', 400);
    }

    tenant.bellSchedule = normalized;
    if (input.dayOpeningNote !== undefined) {
      tenant.dayOpeningNote = String(input.dayOpeningNote || '').trim();
    }
    if (input.dayClosingNote !== undefined) {
      tenant.dayClosingNote = String(input.dayClosingNote || '').trim();
    }

    // Keep existing scheduled slot timestamps aligned to the updated bell schedule
    const periodMap = getTenantPeriodTimes(tenant);
    const validPeriods = new Set(lessonRows.map((r) => r.period as number));
    for (const slot of this.state.timetable) {
      if (slot.tenantId !== tenantId) continue;
      const t = periodMap[slot.period];
      if (t) {
        slot.startTime = t.startTime;
        slot.endTime = t.endTime;
      }
    }
    for (const teacher of tenant.teachers) {
      if (Array.isArray(teacher.unavailable)) {
        teacher.unavailable = teacher.unavailable.filter((u) => validPeriods.has(u.period));
      }
      if (teacher.maxLessonsPerDay && teacher.maxLessonsPerDay > lessonRows.length) {
        teacher.maxLessonsPerDay = lessonRows.length;
      }
    }

    this.persist();
    this.syncTenant(tenantId, 'timetable:schedule-updated');
    return {
      bellSchedule: normalized,
      dayOpeningNote: tenant.dayOpeningNote,
      dayClosingNote: tenant.dayClosingNote,
    };
  }

  setSubjectTimetableConfig(
    tenantId: string,
    input: {
      subjectConstraints?: SubjectTimetableConstraint[];
      optionalSubjectGroups?: OptionalSubjectGroup[];
      syncLessons?: boolean;
    }
  ): {
    subjectConstraints: SubjectTimetableConstraint[];
    optionalSubjectGroups: OptionalSubjectGroup[];
  } {
    const tenant = this.requireTenant(tenantId);
    const maxPeriodsPerDay = Math.max(1, this.teachingPeriods(tenant).length);

    if (input.subjectConstraints !== undefined) {
      const cleanedConstraints: SubjectTimetableConstraint[] = [];
      for (const raw of input.subjectConstraints) {
        const subject = (raw.subject || '').trim();
        if (!subject) {
          throw new ConflictError('Every subject constraint must specify a subject.', 400);
        }
        const grade = (raw.grade || '').trim();
        const validGrade =
          !grade || grade.toLowerCase() === 'all grades' ? 'All Grades' : grade;
        if (validGrade !== 'All Grades' && !tenant.grades.includes(validGrade)) {
          throw new ConflictError(`Invalid grade "${validGrade}" on subject rule for ${subject}.`, 400);
        }
        const notBeforeTime = (raw.notBeforeTime || '').trim()
          ? this.validateTimeString(raw.notBeforeTime, `${subject} earliest time`)
          : undefined;
        const notAfterTime = (raw.notAfterTime || '').trim()
          ? this.validateTimeString(raw.notAfterTime, `${subject} latest time`)
          : undefined;
        if (notBeforeTime && notAfterTime && notBeforeTime >= notAfterTime) {
          throw new ConflictError(
            `${subject}: "Not before" (${notBeforeTime}) must be earlier than "Not after" (${notAfterTime}).`,
            400
          );
        }
        const doubleLessons = Math.max(0, Math.min(10, Math.round(Number(raw.doubleLessons || 0))));
        const maxPerDayRaw = Math.round(Number(raw.maxPerDay || 0));
        const maxPerDay =
          maxPerDayRaw >= 1 && maxPerDayRaw <= maxPeriodsPerDay ? maxPerDayRaw : undefined;
        const preferredRoom = (raw.preferredRoom || '').trim() || undefined;
        if (preferredRoom && !tenant.rooms.includes(preferredRoom)) {
          throw new ConflictError(
            `Preferred room "${preferredRoom}" for ${subject} is not configured in school rooms.`,
            400
          );
        }

        cleanedConstraints.push({
          id: raw.id || `subc-${randomUUID().slice(0, 8)}`,
          subject,
          grade: validGrade,
          ...(doubleLessons > 0 ? { doubleLessons } : {}),
          ...(notBeforeTime ? { notBeforeTime } : {}),
          ...(notAfterTime ? { notAfterTime } : {}),
          ...(maxPerDay ? { maxPerDay } : {}),
          ...(preferredRoom ? { preferredRoom } : {}),
        });
      }
      tenant.subjectConstraints = cleanedConstraints;
    }

    if (input.optionalSubjectGroups !== undefined) {
      const cleanedGroups: OptionalSubjectGroup[] = [];
      for (const raw of input.optionalSubjectGroups) {
        const name = (raw.name || '').trim();
        if (!name) {
          throw new ConflictError('Every optional subject group requires a group name.', 400);
        }
        const grade = (raw.grade || '').trim();
        const validGrade =
          !grade || grade.toLowerCase() === 'all grades' ? 'All Grades' : grade;
        if (validGrade !== 'All Grades' && !tenant.grades.includes(validGrade)) {
          throw new ConflictError(`Invalid grade "${validGrade}" on optional group "${name}".`, 400);
        }
        const uniqueSubjects: string[] = [];
        const seen = new Set<string>();
        for (const s of raw.subjects || []) {
          const clean = s.trim();
          const low = clean.toLowerCase();
          if (clean && !seen.has(low)) {
            seen.add(low);
            uniqueSubjects.push(clean);
          }
        }
        if (uniqueSubjects.length < 2) {
          throw new ConflictError(
            `Optional group "${name}" must contain at least 2 distinct subjects to schedule in parallel.`,
            400
          );
        }
        cleanedGroups.push({
          id: raw.id || `optg-${randomUUID().slice(0, 8)}`,
          name,
          grade: validGrade,
          subjects: uniqueSubjects,
        });
      }
      tenant.optionalSubjectGroups = cleanedGroups;
    }

    // Keep existing lesson cards aligned with updated subject constraints & optional groups
    if (input.syncLessons !== false && Array.isArray(tenant.timetableLessons)) {
      for (const lesson of tenant.timetableLessons) {
        const rule = resolveSubjectConstraint(tenant, lesson.grade, lesson.subject);
        const opt = findOptionalGroupForSubject(tenant, lesson.grade, lesson.subject);
        if (opt) lesson.optionalGroupId = opt.id;
        else delete lesson.optionalGroupId;

        if (rule) {
          if (rule.doubleLessons !== undefined) {
            lesson.doubleLessons = Math.min(
              Math.floor(lesson.periodsPerWeek / 2),
              rule.doubleLessons
            );
          }
          if (rule.notBeforeTime) lesson.notBeforeTime = rule.notBeforeTime;
          else delete lesson.notBeforeTime;
          if (rule.notAfterTime) lesson.notAfterTime = rule.notAfterTime;
          else delete lesson.notAfterTime;
          if (rule.maxPerDay) lesson.maxPerDay = rule.maxPerDay;
          if (rule.preferredRoom && !lesson.room) lesson.room = rule.preferredRoom;
        }
      }
    }

    this.persist();
    this.syncTenant(tenantId, 'timetable:subject-constraints-updated');
    return {
      subjectConstraints: tenant.subjectConstraints || [],
      optionalSubjectGroups: tenant.optionalSubjectGroups || [],
    };
  }

  getTimetableLessons(tenantId: string): TimetableLesson[] {
    return [...(this.requireTenant(tenantId).timetableLessons || [])];
  }

  upsertTimetableLesson(
    tenantId: string,
    input: {
      id?: string;
      grade: string;
      section: string;
      subject: string;
      teacherId: string;
      periodsPerWeek: number;
      doubleLessons?: number;
      room?: string;
      maxPerDay?: number;
      notBeforeTime?: string;
      notAfterTime?: string;
      optionalGroupId?: string;
    }
  ): TimetableLesson {
    const tenant = this.requireTenant(tenantId);
    if (!tenant.grades.includes(input.grade)) {
      throw new ConflictError('Select a valid grade for this lesson.', 400);
    }
    if (!getStreamsForGrade(tenant, input.grade).includes(input.section)) {
      throw new ConflictError('Select a valid stream for this grade.', 400);
    }
    if (!tenant.teachers.some((t) => t.id === input.teacherId)) {
      throw new ConflictError('Selected teacher does not belong to this school.', 400);
    }
    const subject = (input.subject || '').trim();
    if (!subject) throw new ConflictError('Subject is required.', 400);
    const periodsPerDay = Math.max(1, this.teachingPeriods(tenant).length);
    const maxWeekly = periodsPerDay * 5;
    const periodsPerWeek = Math.round(Number(input.periodsPerWeek));
    if (!Number.isFinite(periodsPerWeek) || periodsPerWeek < 1 || periodsPerWeek > Math.max(40, maxWeekly)) {
      throw new ConflictError(`Periods per week must be between 1 and ${Math.max(40, maxWeekly)}.`, 400);
    }
    const doubleLessons = Math.max(
      0,
      Math.min(Math.floor(periodsPerWeek / 2), Math.round(Number(input.doubleLessons || 0)))
    );
    const room = (input.room || '').trim();
    if (room && !tenant.rooms.includes(room)) {
      throw new ConflictError('Selected room is not configured for this school.', 400);
    }
    const maxPerDayRaw = Math.round(Number(input.maxPerDay || 0));
    const maxPerDay = maxPerDayRaw >= 1 && maxPerDayRaw <= periodsPerDay ? maxPerDayRaw : undefined;
    const notBeforeTime = (input.notBeforeTime || '').trim()
      ? this.validateTimeString(input.notBeforeTime, 'Not-before time')
      : undefined;
    const notAfterTime = (input.notAfterTime || '').trim()
      ? this.validateTimeString(input.notAfterTime, 'Not-after time')
      : undefined;
    if (notBeforeTime && notAfterTime && notBeforeTime >= notAfterTime) {
      throw new ConflictError('Not-before time must be earlier than Not-after time.', 400);
    }
    const optionalGroupId =
      (input.optionalGroupId || '').trim() ||
      findOptionalGroupForSubject(tenant, input.grade, subject)?.id ||
      undefined;

    const lessons = (tenant.timetableLessons = tenant.timetableLessons || []);
    const next: TimetableLesson = {
      id: input.id || `les-${randomUUID().slice(0, 8)}`,
      grade: input.grade,
      section: input.section,
      subject,
      teacherId: input.teacherId,
      periodsPerWeek,
      ...(doubleLessons > 0 ? { doubleLessons } : {}),
      ...(room ? { room } : {}),
      ...(maxPerDay ? { maxPerDay } : {}),
      ...(notBeforeTime ? { notBeforeTime } : {}),
      ...(notAfterTime ? { notAfterTime } : {}),
      ...(optionalGroupId ? { optionalGroupId } : {}),
    };
    if (input.id) {
      const idx = lessons.findIndex((l) => l.id === input.id);
      if (idx < 0) throw new ConflictError('Lesson not found.', 404);
      lessons[idx] = next;
    } else {
      lessons.push(next);
    }
    this.persist();
    this.syncTenant(tenantId, 'timetable:lessons-updated');
    return next;
  }

  deleteTimetableLesson(tenantId: string, lessonId: string) {
    const tenant = this.requireTenant(tenantId);
    const before = (tenant.timetableLessons || []).length;
    tenant.timetableLessons = (tenant.timetableLessons || []).filter((l) => l.id !== lessonId);
    if (tenant.timetableLessons.length === before) {
      throw new ConflictError('Lesson not found.', 404);
    }
    this.persist();
    this.syncTenant(tenantId, 'timetable:lessons-updated');
  }

  /** Builds lesson cards from the school's curriculum: every class x subject with a qualified teacher. */
  buildTimetableLessonsFromCurriculum(
    tenantId: string,
    input: { grades?: string[]; replace?: boolean }
  ): { created: number; total: number; skipped: string[] } {
    const tenant = this.requireTenant(tenantId);
    if (tenant.teachers.length === 0) {
      throw new ConflictError('Add at least one teacher before building lessons.', 400);
    }
    const grades =
      input.grades && input.grades.length > 0
        ? tenant.grades.filter((g) => input.grades!.includes(g))
        : [...tenant.grades];
    if (grades.length === 0) throw new ConflictError('Select at least one grade.', 400);

    const cohortKeys = new Set<string>();
    grades.forEach((g) => getStreamsForGrade(tenant, g).forEach((s) => cohortKeys.add(`${g}::${s}`)));

    let lessons = tenant.timetableLessons || [];
    if (input.replace !== false) {
      lessons = lessons.filter((l) => !cohortKeys.has(`${l.grade}::${l.section}`));
    }
    const load = new Map<string, number>();
    tenant.teachers.forEach((t) => load.set(t.id, 0));
    lessons.forEach((l) => load.set(l.teacherId, (load.get(l.teacherId) || 0) + l.periodsPerWeek));
    const homeroom = new Set<string>();
    const skipped = new Set<string>();
    const created: TimetableLesson[] = [];

    for (const grade of grades) {
      for (const section of getStreamsForGrade(tenant, grade)) {
        const clusterId = getClusterForGrade(grade);
        const subjects = getSubjectsForLevel(tenant, clusterId).filter(Boolean);
        const single = isSingleTeacherGrade(grade);
        let classTeacher: TeacherProfile | null = null;

        if (single) {
          const ranked = [...tenant.teachers].sort((a, b) => {
            const sc = (t: TeacherProfile) => {
              if (isTeacherAssignedToCohort(t, grade, section)) return 0;
              const open = (t.assignedClasses || []).length === 0;
              if (open && !homeroom.has(t.id)) return 1;
              if (!homeroom.has(t.id)) return 2;
              return 3;
            };
            return sc(a) - sc(b) || (load.get(a.id) || 0) - (load.get(b.id) || 0);
          });
          classTeacher = ranked[0] || null;
          if (classTeacher) homeroom.add(classTeacher.id);
        }

        for (const subject of subjects) {
          const periods = getLessonsPerWeekForSubject(tenant, subject, clusterId);
          if (periods <= 0) continue;
          let teacher: TeacherProfile | undefined | null = classTeacher;
          if (!single) {
            const qualified = tenant.teachers.filter((t) =>
              getTeacherAssignedSubjectsForCohort(tenant, t, grade, section).some(
                (s) => s.toLowerCase() === subject.toLowerCase()
              )
            );
            teacher = [...qualified].sort((a, b) => {
              const ea = isTeacherAssignedToCohort(a, grade, section) ? 0 : 1;
              const eb = isTeacherAssignedToCohort(b, grade, section) ? 0 : 1;
              return ea - eb || (load.get(a.id) || 0) - (load.get(b.id) || 0);
            })[0];
          }
          if (!teacher) {
            skipped.add(subject);
            continue;
          }
          load.set(teacher.id, (load.get(teacher.id) || 0) + periods);
          const rule = resolveSubjectConstraint(tenant, grade, subject);
          const opt = findOptionalGroupForSubject(tenant, grade, subject);
          const doubleCount = rule?.doubleLessons
            ? Math.min(Math.floor(periods / 2), rule.doubleLessons)
            : 0;
          created.push({
            id: `les-${randomUUID().slice(0, 8)}`,
            grade,
            section,
            subject,
            teacherId: teacher.id,
            periodsPerWeek: periods,
            ...(doubleCount > 0 ? { doubleLessons: doubleCount } : {}),
            ...(rule?.preferredRoom ? { room: rule.preferredRoom } : {}),
            ...(rule?.maxPerDay ? { maxPerDay: rule.maxPerDay } : {}),
            ...(rule?.notBeforeTime ? { notBeforeTime: rule.notBeforeTime } : {}),
            ...(rule?.notAfterTime ? { notAfterTime: rule.notAfterTime } : {}),
            ...(opt ? { optionalGroupId: opt.id } : {}),
          });
        }
      }
    }

    tenant.timetableLessons = [...lessons, ...created];
    this.persist();
    this.syncTenant(tenantId, 'timetable:lessons-updated');
    return { created: created.length, total: tenant.timetableLessons.length, skipped: [...skipped] };
  }

  setTeacherAvailability(
    tenantId: string,
    teacherId: string,
    input: { unavailable?: Array<{ day: DayOfWeek; period: number }>; maxLessonsPerDay?: number | null }
  ): TeacherProfile {
    const tenant = this.requireTenant(tenantId);
    const teacher = tenant.teachers.find((t) => t.id === teacherId);
    if (!teacher) throw new ConflictError('Teacher not found in this school.', 404);
    const days: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const periods = this.teachingPeriods(tenant);
    const seen = new Set<string>();
    const unavailable: Array<{ day: DayOfWeek; period: number }> = [];
    for (const u of input.unavailable || []) {
      if (!days.includes(u.day) || !periods.includes(Number(u.period))) continue;
      const k = `${u.day}|${u.period}`;
      if (seen.has(k)) continue;
      seen.add(k);
      unavailable.push({ day: u.day, period: Number(u.period) });
    }
    teacher.unavailable = unavailable;
    const max = Math.round(Number(input.maxLessonsPerDay || 0));
    if (max >= 1 && max <= periods.length) teacher.maxLessonsPerDay = max;
    else delete teacher.maxLessonsPerDay;
    this.persist();
    this.syncTenant(tenantId, 'timetable:availability-updated');
    return teacher;
  }

  setTimetableSlotsLocked(
    tenantId: string,
    input: { slotIds?: string[]; grade?: string; section?: string; all?: boolean; locked: boolean }
  ): { updated: number } {
    this.requireTenant(tenantId);
    const ids = new Set(input.slotIds || []);
    let updated = 0;
    for (const s of this.state.timetable) {
      if (s.tenantId !== tenantId) continue;
      const match =
        input.all === true ||
        ids.has(s.id) ||
        (!!input.grade && s.grade === input.grade && (!input.section || s.section === input.section));
      if (!match) continue;
      if (Boolean(s.locked) !== input.locked) {
        s.locked = input.locked;
        updated += 1;
      }
    }
    if (updated > 0) {
      this.persist();
      this.syncTenant(tenantId, 'timetable:locked');
    }
    return { updated };
  }

  /** Solve all lesson cards (optionally only some grades), keeping locked lessons and enforcing subject + teacher constraints. */
  solveTimetableFromLessons(
    tenantId: string,
    input: { grades?: string[]; assignRooms?: boolean; seed?: number }
  ): TimetableSolveResult {
    const tenant = this.requireTenant(tenantId);
    const allLessons = tenant.timetableLessons || [];
    if (allLessons.length === 0) {
      throw new ConflictError('Create lesson cards first (Lessons tab → Build from curriculum).', 400);
    }
    const teacherIds = new Set(tenant.teachers.map((t) => t.id));
    const gradeFilter = input.grades && input.grades.length > 0 ? new Set(input.grades) : null;
    const target = allLessons.filter((l) => teacherIds.has(l.teacherId) && (!gradeFilter || gradeFilter.has(l.grade)));
    if (target.length === 0) {
      throw new ConflictError('No lesson cards match the selected grades.', 400);
    }
    const cohortKeys = new Set(target.map((l) => `${l.grade}::${l.section}`));
    const inCohort = (s: TimetableSlot) => cohortKeys.has(`${s.grade}::${s.section}`);

    const lessonRows = getTenantLessonRows(tenant);
    const periodTimes = getTenantPeriodTimes(tenant);
    const assignRooms = input.assignRooms ?? tenant.rooms.length > 0;
    const toPlacement = (s: TimetableSlot): SolverPlacement => ({
      lessonId: s.lessonId || '',
      grade: s.grade,
      section: s.section,
      subject: s.subject,
      teacherId: s.teacherId,
      room: assignRooms ? s.room : '',
      day: s.day as SolverDay,
      period: s.period,
    });

    const tenantSlots = this.state.timetable.filter((s) => s.tenantId === tenantId);
    const lockedPlacements: SolverPlacement[] = [];
    const fixed: SolverPlacement[] = [];
    for (const s of tenantSlots) {
      if (!inCohort(s)) {
        fixed.push(toPlacement(s));
      } else if (s.locked) {
        const lesson =
          target.find((l) => l.id === s.lessonId) ||
          target.find(
            (l) => l.grade === s.grade && l.section === s.section && l.subject === s.subject && l.teacherId === s.teacherId
          );
        if (lesson) lockedPlacements.push({ ...toPlacement(s), lessonId: lesson.id });
        else fixed.push(toPlacement(s));
      }
    }

    const teacherName = new Map(tenant.teachers.map((t) => [t.id, t.name]));
    const result = solveTimetable({
      lessons: target.map((l) => {
        const rule = resolveSubjectConstraint(tenant, l.grade, l.subject);
        const optGroup = findOptionalGroupForSubject(tenant, l.grade, l.subject);
        const notBeforeTime = l.notBeforeTime || rule?.notBeforeTime;
        const notAfterTime = l.notAfterTime || rule?.notAfterTime;
        const doubleLessons = l.doubleLessons ?? rule?.doubleLessons;
        const maxPerDay = l.maxPerDay ?? rule?.maxPerDay;
        const preferredRoom = l.room || rule?.preferredRoom;
        const optionalGroupId = l.optionalGroupId || optGroup?.id;
        const allowedPeriods =
          notBeforeTime || notAfterTime
            ? lessonRows
                .filter(
                  (row) =>
                    isSlotWithinSubjectTimeWindow(row, { notBeforeTime, notAfterTime }).ok
                )
                .map((row) => row.period as number)
            : undefined;
        return {
          id: l.id,
          grade: l.grade,
          section: l.section,
          subject: l.subject,
          teacherId: l.teacherId,
          periodsPerWeek: l.periodsPerWeek,
          ...(doubleLessons ? { doubleLessons } : {}),
          ...(assignRooms && preferredRoom ? { room: preferredRoom } : {}),
          ...(maxPerDay ? { maxPerDay } : {}),
          ...(allowedPeriods ? { allowedPeriods } : {}),
          ...(optionalGroupId ? { optionalGroupId } : {}),
        };
      }),
      days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      periods: this.teachingPeriods(tenant),
      doubleStarts: this.doubleStartPeriods(tenant),
      rooms: assignRooms ? tenant.rooms : [],
      teachers: Object.fromEntries(
        tenant.teachers.map((t) => [
          t.id,
          { unavailable: (t.unavailable || []) as Array<{ day: SolverDay; period: number }>, maxPerDay: t.maxLessonsPerDay },
        ])
      ),
      locked: lockedPlacements,
      fixed,
      seed: input.seed,
    });

    // replace every unlocked slot of the solved classes with the new placements
    this.state.timetable = this.state.timetable.filter(
      (s) => !(s.tenantId === tenantId && inCohort(s) && !s.locked)
    );
    for (const p of result.placements) {
      const times = periodTimes[p.period] || { startTime: '08:00', endTime: '08:40' };
      this.state.timetable.push({
        id: `tt-${randomUUID().slice(0, 8)}`,
        tenantId,
        day: p.day,
        period: p.period,
        startTime: times.startTime,
        endTime: times.endTime,
        grade: p.grade,
        section: p.section,
        subject: p.subject,
        teacherId: p.teacherId,
        teacherName: teacherName.get(p.teacherId) || '',
        room: p.room || 'Home classroom',
        lessonId: p.lessonId,
      });
    }
    this.persist();
    this.pushNotification(
      tenantId,
      'timetable',
      'Timetable Generated',
      `${result.placedPeriods} of ${result.totalPeriods} lesson periods placed${
        result.unplaced.length ? `; ${result.unplaced.length} lesson(s) need attention` : ''
      }.`,
      'timetable'
    );
    this.syncTenant(tenantId, 'timetable:generated');

    const nameOf = (id: string) => teacherName.get(id) || id;
    return {
      placedPeriods: result.placedPeriods,
      totalPeriods: result.totalPeriods,
      createdSlots: result.placements.length,
      attemptsRun: result.attemptsRun,
      warnings: result.warnings.map((w) =>
        w.replace(/^Teacher (\S+) /, (_m, id: string) => `Teacher ${nameOf(id)} `)
      ),
      unplaced: result.unplaced.map((u) => ({
        lessonId: u.lessonId,
        grade: u.grade,
        section: u.section,
        subject: u.subject,
        teacherName: nameOf(u.teacherId),
        missingPeriods: u.missingPeriods,
        reason: u.reason,
      })),
    };
  }

  generateTimetable(
    tenantId: string,
    input: {
      scope: 'cohort' | 'grade' | 'cluster' | 'custom' | 'school';
      grade?: string;
      section?: string;
      grades?: string[];
      clusters?: CbcClusterId[];
      replaceExisting?: boolean;
      lessonsPerCohort?: number;
      respectSubjectCounts?: boolean;
    }
  ): {
    createdCount: number;
    skippedSubjects: string[];
    cohortsScheduled: number;
    singleTeacherCohorts: string[];
  } {
    const tenant = this.requireTenant(tenantId);
    const DAYS: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const PERIODS = this.teachingPeriods(tenant);
    const periodTimesMap = getTenantPeriodTimes(tenant);
    const replaceExisting = input.replaceExisting !== false;

    if (tenant.teachers.length === 0) {
      throw new ConflictError('Add at least one teacher before generating a timetable.', 400);
    }

    const targetCohorts: Array<{ grade: string; section: string }> = [];
    if (input.scope === 'school') {
      tenant.grades.forEach((g) => {
        getStreamsForGrade(tenant, g).forEach((sec) => {
          targetCohorts.push({ grade: g, section: sec });
        });
      });
    } else if (input.scope === 'cluster' || input.scope === 'custom') {
      const clusterGradeSet = new Set<string>();
      (input.clusters || []).forEach((cid) => {
        const def = KENYAN_CBC_CLUSTERS.find((c) => c.id === cid);
        def?.grades.forEach((g) => clusterGradeSet.add(g.toLowerCase()));
      });
      (input.grades || []).forEach((g) => {
        if (g && g.trim()) clusterGradeSet.add(g.trim().toLowerCase());
      });

      const matchedGrades = tenant.grades.filter((g) =>
        clusterGradeSet.has(g.toLowerCase())
      );
      if (matchedGrades.length === 0) {
        throw new ConflictError(
          'Select at least one CBC cluster or grade for timetable generation.',
          400
        );
      }
      matchedGrades.forEach((g) => {
        getStreamsForGrade(tenant, g).forEach((sec) => {
          targetCohorts.push({ grade: g, section: sec });
        });
      });
    } else if (input.scope === 'grade') {
      const targetGrade = input.grade || tenant.grades[0];
      if (!targetGrade) {
        throw new ConflictError('Select a grade to generate timetable.', 400);
      }
      getStreamsForGrade(tenant, targetGrade).forEach((sec) => {
        targetCohorts.push({ grade: targetGrade, section: sec });
      });
    } else {
      const targetGrade = input.grade || tenant.grades[0];
      const targetSection = input.section || getStreamsForGrade(tenant, targetGrade)[0] || 'A';
      targetCohorts.push({ grade: targetGrade, section: targetSection });
    }

    if (targetCohorts.length === 0) {
      throw new ConflictError('No grade & stream cohorts found for timetable generation.', 400);
    }

    // Build subject -> qualified teachers lookup across all configured school & level subjects
    const subjectTeachers = new Map<string, TeacherProfile[]>();
    const allKnownSubjects = Array.from(
      new Set([
        ...tenant.subjects,
        ...Object.values(tenant.levelSubjects || {}).flatMap((list) => list || []),
      ])
    ).filter(Boolean);

    if (allKnownSubjects.length === 0) {
      throw new ConflictError('Configure at least one school subject before generating.', 400);
    }

    allKnownSubjects.forEach((sub) => {
      const qualified = tenant.teachers.filter((t) =>
        t.subjects.some((ts) => ts.toLowerCase() === sub.toLowerCase())
      );
      if (qualified.length > 0) {
        subjectTeachers.set(sub, qualified);
      }
    });

    const targetClusters = Array.from(
      new Set(targetCohorts.map((c) => getClusterForGrade(c.grade)))
    );
    const hasSpecialistCohorts = targetCohorts.some((c) => !isSingleTeacherGrade(c.grade));
    const skippedSubjectsSet = new Set<string>();
    let hasAnySpecialistSubjectCovered = false;

    targetClusters.forEach((cid) => {
      const clusterDef = KENYAN_CBC_CLUSTERS.find((c) => c.id === cid);
      if (clusterDef?.singleClassTeacher) return;
      getSubjectsForLevel(tenant, cid).forEach((sub) => {
        if ((subjectTeachers.get(sub) || []).length > 0) {
          hasAnySpecialistSubjectCovered = true;
        } else {
          skippedSubjectsSet.add(sub);
        }
      });
    });

    if (hasSpecialistCohorts && !hasAnySpecialistSubjectCovered) {
      throw new ConflictError(
        'No subjects for the selected level(s) have assigned teachers yet. Assign teachers first.',
        400
      );
    }

    const skippedSubjects = Array.from(skippedSubjectsSet);

    const cohortKeySet = new Set(targetCohorts.map((c) => `${c.grade}::${c.section}`));
    if (replaceExisting) {
      this.state.timetable = this.state.timetable.filter(
        // locked lessons survive a regenerate (they are treated as occupied slots below)
        (s) => !(s.tenantId === tenantId && !s.locked && cohortKeySet.has(`${s.grade}::${s.section}`))
      );
    }

    // Current tenant slots (used to enforce zero teacher/room/class collisions)
    const tenantSlots = this.state.timetable.filter((s) => s.tenantId === tenantId);
    const teacherLoad = new Map<string, number>();
    tenant.teachers.forEach((t) => teacherLoad.set(t.id, 0));
    tenantSlots.forEach((s) => {
      teacherLoad.set(s.teacherId, (teacherLoad.get(s.teacherId) || 0) + 1);
    });

    // Track homeroom teachers already handling Pre-School / Lower Primary streams so each stream gets its own 1 dedicated teacher when available
    const designatedSingleTeachers = new Set<string>();
    tenantSlots.forEach((s) => {
      if (isSingleTeacherGrade(s.grade)) {
        designatedSingleTeachers.add(s.teacherId);
      }
    });

    const rooms = tenant.rooms.length > 0 ? tenant.rooms : ['Room 101'];
    const useSubjectTargets = input.respectSubjectCounts !== false && !input.lessonsPerCohort;
    const explicitCap =
      typeof input.lessonsPerCohort === 'number' && input.lessonsPerCohort > 0
        ? Math.min(40, Math.max(5, input.lessonsPerCohort))
        : 40;
    let createdCount = 0;
    const singleTeacherCohorts: string[] = [];

    for (const cohort of targetCohorts) {
      const existingCohortSlots = tenantSlots.filter(
        (s) => s.grade === cohort.grade && s.section === cohort.section
      );

      const clusterId = getClusterForGrade(cohort.grade);
      const isSingleTeacherCohort = isSingleTeacherGrade(cohort.grade);
      let designatedClassTeacher: TeacherProfile | null = null;

      if (isSingleTeacherCohort) {
        // Pre-School (Playgroup–PP2) & Lower Primary (Grade 1–3): 1 teacher handles ALL subjects
        const existingSlotTeacherId = existingCohortSlots[0]?.teacherId;
        if (existingSlotTeacherId) {
          designatedClassTeacher =
            tenant.teachers.find((t) => t.id === existingSlotTeacherId) || null;
        }
        if (!designatedClassTeacher) {
          const rankedCandidates = [...tenant.teachers].sort((a, b) => {
            const score = (t: TeacherProfile) => {
              const classes = t.assignedClasses || [];
              const exactStream = classes.some(
                (c) => c.grade === cohort.grade && c.section === cohort.section
              );
              if (exactStream) return 0;
              const allStreamsGrade = classes.some(
                (c) => c.grade === cohort.grade && c.section === 'All Streams'
              );
              if (allStreamsGrade) return 1;
              const isOpen = classes.length === 0;
              const alreadyHomeroom = designatedSingleTeachers.has(t.id);
              if (isOpen && !alreadyHomeroom) return 2;
              if (isOpen) return 3;
              if (!alreadyHomeroom) return 4;
              return 5;
            };
            const diff = score(a) - score(b);
            if (diff !== 0) return diff;
            return (teacherLoad.get(a.id) || 0) - (teacherLoad.get(b.id) || 0);
          });
          designatedClassTeacher = rankedCandidates[0] || null;
        }
        if (designatedClassTeacher) {
          designatedSingleTeachers.add(designatedClassTeacher.id);
          singleTeacherCohorts.push(
            `${cohort.grade} · Stream ${cohort.section} (${designatedClassTeacher.name})`
          );
        }
      }

      const levelSubjects = getSubjectsForLevel(tenant, clusterId).filter(Boolean);
      const cohortSubjectSource = isSingleTeacherCohort
        ? levelSubjects
        : levelSubjects.filter((sub) => (subjectTeachers.get(sub) || []).length > 0);
      if (cohortSubjectSource.length === 0) continue;

      // Build interleaved queue based on each subject's configured weekly lesson count for this CBC level
      const subjectCounts = cohortSubjectSource
        .map((sub) => ({
          subject: sub,
          count: getLessonsPerWeekForSubject(tenant, sub, clusterId),
        }))
        .filter((item) => item.count > 0);

      const interleavedQueue: string[] = [];
      const maxRounds = subjectCounts.reduce((m, item) => Math.max(m, item.count), 0);
      for (let round = 0; round < maxRounds; round += 1) {
        for (const item of subjectCounts) {
          if (round < item.count) {
            interleavedQueue.push(item.subject);
          }
        }
      }

      const targetLessons = useSubjectTargets
        ? Math.min(40, interleavedQueue.length)
        : explicitCap;
      const remainingBudget = Math.max(0, targetLessons - existingCohortSlots.length);
      if (remainingBudget === 0 || interleavedQueue.length === 0) continue;

      // Subtract already-present subjects if merging (replaceExisting === false)
      const existingCounts = new Map<string, number>();
      existingCohortSlots.forEach((s) => {
        existingCounts.set(s.subject, (existingCounts.get(s.subject) || 0) + 1);
      });
      const filteredQueue: string[] = [];
      const skipLeft = new Map(existingCounts);
      for (const sub of interleavedQueue) {
        const left = skipLeft.get(sub) || 0;
        if (left > 0) {
          skipLeft.set(sub, left - 1);
        } else {
          filteredQueue.push(sub);
        }
      }
      const queue = filteredQueue.slice(0, remainingBudget);

      for (const subject of queue) {
        const qualified = isSingleTeacherCohort
          ? designatedClassTeacher
            ? [designatedClassTeacher]
            : []
          : subjectTeachers.get(subject) || [];
        if (qualified.length === 0) continue;

        // Sort days by fewest occurrences of this subject, then fewest total lessons in this cohort
        const dayOrder = [...DAYS].sort((dA, dB) => {
          const sameSubA = tenantSlots.filter(
            (s) =>
              s.grade === cohort.grade &&
              s.section === cohort.section &&
              s.day === dA &&
              s.subject === subject
          ).length;
          const sameSubB = tenantSlots.filter(
            (s) =>
              s.grade === cohort.grade &&
              s.section === cohort.section &&
              s.day === dB &&
              s.subject === subject
          ).length;
          if (sameSubA !== sameSubB) return sameSubA - sameSubB;
          const countA = tenantSlots.filter(
            (s) => s.grade === cohort.grade && s.section === cohort.section && s.day === dA
          ).length;
          const countB = tenantSlots.filter(
            (s) => s.grade === cohort.grade && s.section === cohort.section && s.day === dB
          ).length;
          return countA - countB;
        });

        let placed = false;
        for (const day of dayOrder) {
          if (placed) break;
          const subjectSameDay = tenantSlots.filter(
            (s) =>
              s.grade === cohort.grade &&
              s.section === cohort.section &&
              s.day === day &&
              s.subject === subject
          ).length;
          if (subjectSameDay >= 2) continue;

          for (const period of PERIODS) {
            const times = periodTimesMap[period];
            if (!times) continue;
            const subjectRule = resolveSubjectConstraint(tenant, cohort.grade, subject);
            if (!isSlotWithinSubjectTimeWindow(times, subjectRule).ok) continue;

            const slotsAtTime = tenantSlots.filter(
              (s) => s.day === day && s.period === period
            );
            const cohortSlotsAtTime = slotsAtTime.filter(
              (s) => s.grade === cohort.grade && s.section === cohort.section
            );
            const classBusy = cohortSlotsAtTime.some(
              (s) =>
                s.subject.trim().toLowerCase() === subject.trim().toLowerCase() ||
                !areSubjectsInSameOptionalGroup(tenant, cohort.grade, s.subject, subject)
            );
            if (classBusy) continue;

            let freeTeacher: TeacherProfile | undefined;
            const teacherEligible = (t: TeacherProfile) => {
              if (slotsAtTime.some((s) => s.teacherId === t.id)) return false;
              if ((t.unavailable || []).some((u) => u.day === day && u.period === period)) return false;
              if (t.maxLessonsPerDay) {
                const usedDay = tenantSlots.filter((s) => s.teacherId === t.id && s.day === day).length;
                if (usedDay >= t.maxLessonsPerDay) return false;
              }
              return true;
            };

            if (isSingleTeacherCohort) {
              freeTeacher = qualified.find(teacherEligible);
            } else {
              const subLower = subject.toLowerCase();
              const classMatchRank = (t: TeacherProfile) => {
                const classes = t.assignedClasses || [];
                if (classes.length === 0) return 2;
                const exactSubjectMatch = classes.some(
                  (c) =>
                    c.grade === cohort.grade &&
                    (c.section === cohort.section || c.section === 'All Streams') &&
                    c.subject &&
                    (c.subject.toLowerCase() === subLower ||
                      c.subject === CLASS_TEACHER_SUBJECT_TOKEN)
                );
                if (exactSubjectMatch) return 0;
                const classOnlyMatch = classes.some(
                  (c) =>
                    c.grade === cohort.grade &&
                    (c.section === cohort.section || c.section === 'All Streams') &&
                    !c.subject
                );
                if (classOnlyMatch) return 1;
                return 3;
              };
              const cohortQualified = qualified.filter((t) => classMatchRank(t) <= 2);
              const candidatePool = cohortQualified.length > 0 ? cohortQualified : qualified;

              freeTeacher = [...candidatePool]
                .sort((a, b) => {
                  const rankDiff = classMatchRank(a) - classMatchRank(b);
                  if (rankDiff !== 0) return rankDiff;
                  return (teacherLoad.get(a.id) || 0) - (teacherLoad.get(b.id) || 0);
                })
                .find(teacherEligible);
            }
            if (!freeTeacher) continue;

            const preferredRooms = [...rooms].sort((rA, rB) => {
              const score = (r: string) => {
                if (subjectRule?.preferredRoom && r === subjectRule.preferredRoom) return -5;
                if (/science/i.test(subject) && /lab/i.test(r)) return -2;
                if (/computer|ict/i.test(subject) && /ict|computer|lab/i.test(r)) return -2;
                if (/creative|sport/i.test(subject) && /field|studio|hall/i.test(r)) return -2;
                return 0;
              };
              return score(rA) - score(rB);
            });
            const homeroom = `${cohort.grade} · Room ${cohort.section}`;
            const freeRoom =
              preferredRooms.find((r) => !slotsAtTime.some((s) => s.room === r)) ||
              (!slotsAtTime.some((s) => s.room === homeroom) ? homeroom : undefined);
            if (!freeRoom) continue;

            const newSlot: TimetableSlot = {
              id: `tt-${randomUUID().slice(0, 8)}`,
              tenantId,
              day,
              period,
              startTime: times.startTime,
              endTime: times.endTime,
              grade: cohort.grade,
              section: cohort.section,
              subject,
              teacherId: freeTeacher.id,
              teacherName: freeTeacher.name,
              room: freeRoom,
            };
            this.state.timetable.push(newSlot);
            tenantSlots.push(newSlot);
            teacherLoad.set(freeTeacher.id, (teacherLoad.get(freeTeacher.id) || 0) + 1);
            createdCount += 1;
            placed = true;
            break;
          }
        }
      }
    }

    this.persist();
    this.pushNotification(
      tenantId,
      'timetable',
      'Timetable Generated',
      `Scheduled ${createdCount} clash-free lesson(s) across ${targetCohorts.length} class stream(s).`,
      'timetable'
    );
    this.syncTenant(tenantId, 'timetable:generated');

    return {
      createdCount,
      skippedSubjects: hasSpecialistCohorts ? skippedSubjects : [],
      cohortsScheduled: targetCohorts.length,
      singleTeacherCohorts,
    };
  }

  // Attendance & Leave Out Chits
  createLeaveOutChit(
    tenantId: string,
    input: {
      studentId: string;
      startDate: string;
      days: number;
      reason: string;
      issuedBy?: string;
      termId?: string;
    }
  ): LeaveOutChit {
    this.requireTenant(tenantId);
    const student = this.state.students.find(
      (s) => s.id === input.studentId && s.tenantId === tenantId && !s.deleted
    );
    if (!student) {
      throw new ConflictError('Selected student not found in this school.', 404);
    }
    const reason = (input.reason || '').trim();
    if (!reason) {
      throw new ConflictError('Provide a reason for the leave out chit.', 400);
    }
    const startDate = (input.startDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      throw new ConflictError('Provide a valid start date (YYYY-MM-DD).', 400);
    }
    const resolvedTerm = this.assertTermOpen(tenantId, {
      termId: input.termId,
      date: startDate,
      actionLabel: 'Issuing a leave out chit',
    });
    const days = Math.max(1, Math.min(90, Math.round(Number(input.days) || 1)));
    const endDate = addDaysIso(startDate, days - 1);
    const issuedBy = (input.issuedBy || '').trim() || 'Administration Desk';
    const now = new Date().toISOString();

    const chit: LeaveOutChit = {
      id: `loc-${randomUUID().slice(0, 8)}`,
      tenantId,
      termId: resolvedTerm?.id,
      studentId: student.id,
      studentName: student.fullName,
      studentCode: student.studentCode,
      grade: student.grade,
      section: student.section,
      startDate,
      days,
      endDate,
      reason,
      issuedBy,
      createdAt: now,
    };

    this.state.leaveOutChits.unshift(chit);

    // Automatically mark student Absent across every covered date until the leave chit lapses
    const chitRemark = `Leave Out Chit (${days}d: ${startDate} to ${endDate}): ${reason}`;
    for (let offset = 0; offset < days; offset += 1) {
      const targetDate = addDaysIso(startDate, offset);
      const existing = this.state.attendance.find(
        (r) => r.tenantId === tenantId && r.date === targetDate && r.studentId === student.id
      );
      if (existing) {
        existing.status = 'Absent';
        existing.termId = resolvedTerm?.id || existing.termId;
        existing.remarks = chitRemark;
        existing.recordedBy = issuedBy;
        existing.updatedAt = now;
      } else {
        this.state.attendance.push({
          id: `att-${targetDate}-${student.id}`,
          tenantId,
          termId: resolvedTerm?.id,
          date: targetDate,
          grade: student.grade,
          section: student.section,
          studentId: student.id,
          studentName: student.fullName,
          studentCode: student.studentCode,
          status: 'Absent',
          remarks: chitRemark,
          recordedBy: issuedBy,
          updatedAt: now,
        });
      }
    }

    this.persist();
    this.pushNotification(
      tenantId,
      'attendance',
      `Leave Out Chit Issued: ${student.fullName}`,
      `${days} day(s) (${startDate} – ${endDate}) · Reason: ${reason}. Marked Absent until leave lapses.`,
      'attendance'
    );
    this.syncTenant(tenantId, 'attendance:leave-chit-created');
    return chit;
  }

  deleteLeaveOutChit(tenantId: string, chitId: string) {
    this.requireTenant(tenantId);
    const chit = this.state.leaveOutChits.find(
      (c) => c.id === chitId && c.tenantId === tenantId
    );
    if (!chit) {
      throw new ConflictError('Leave out chit not found.', 404);
    }
    this.assertTermOpen(tenantId, {
      termId: chit.termId,
      date: chit.startDate,
      actionLabel: 'Deleting a leave out chit',
    });
    this.state.leaveOutChits = this.state.leaveOutChits.filter(
      (c) => !(c.id === chitId && c.tenantId === tenantId)
    );
    this.persist();
    this.syncTenant(tenantId, 'attendance:leave-chit-deleted');
  }

  addNonTeachingStaff(
    tenantId: string,
    input: {
      name: string;
      role: string;
      department?: string;
      phone?: string;
      email?: string;
      actorRole?: UserRole;
    }
  ): { staff: NonTeachingStaffProfile; tenant: Tenant } {
    if (input.actorRole && input.actorRole !== 'Admin' && input.actorRole !== 'Super Admin') {
      throw new ConflictError(
        'Only School Admin can manage Non-Teaching Staff attendance and records.',
        403
      );
    }
    const tenant = this.requireTenant(tenantId);
    const name = (input.name || '').trim();
    const role = (input.role || '').trim();
    if (!name) {
      throw new ConflictError('Staff member full name is required.', 400);
    }
    if (!role) {
      throw new ConflictError('Staff designation / role is required.', 400);
    }
    if (!Array.isArray(tenant.nonTeachingStaff)) {
      tenant.nonTeachingStaff = [];
    }
    const emailSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
    const staff: NonTeachingStaffProfile = {
      id: `nts-${randomUUID().slice(0, 6)}`,
      name,
      role,
      department: (input.department || '').trim() || 'Support Services',
      phone: (input.phone || '').trim() || '+254 700 000 000',
      email: (input.email || '').trim() || `${emailSlug || 'staff'}@${tenant.slug}.ac.ke`,
    };
    tenant.nonTeachingStaff.push(staff);
    this.persist();
    this.pushNotification(
      tenantId,
      'attendance',
      `Non-Teaching Staff Added: ${staff.name}`,
      `${staff.role} (${staff.department}) added to staff roll call.`,
      'attendance'
    );
    this.syncTenant(tenantId, 'non-teaching-staff:added');
    return { staff, tenant };
  }

  saveAttendanceBatch(
    tenantId: string,
    input: {
      date: string;
      grade: string;
      section: string;
      termId?: string;
      recordedBy: string;
      actorRole?: UserRole;
      teacherId?: string;
      entries: Array<{ studentId: string; status: AttendanceStatus; remarks: string }>;
    }
  ): AttendanceRecord[] {
    const tenant = this.requireTenant(tenantId);
    if (input.actorRole && input.actorRole !== 'Admin' && input.actorRole !== 'Super Admin') {
      if (input.actorRole !== 'Teacher') {
        throw new ConflictError(
          'Student register marking is only permitted for assigned teachers and Admin.',
          403
        );
      }
      const teacher = tenant.teachers.find((t) => t.id === input.teacherId);
      const tenantSlots = this.state.timetable.filter((s) => s.tenantId === tenantId);
      if (!teacher || !isTeacherAssignedToCohort(teacher, input.grade, input.section, tenantSlots)) {
        throw new ConflictError(
          `Only teachers assigned to ${input.grade} Stream ${input.section} or Admin can mark this register.`,
          403
        );
      }
    }

    const resolvedTerm = this.assertTermOpen(tenantId, {
      termId: input.termId,
      date: input.date,
      actionLabel: 'Marking attendance',
    });

    const now = new Date().toISOString();
    const saved: AttendanceRecord[] = [];
    const unexcusedAbsences: string[] = [];

    for (const entry of input.entries) {
      const student = this.state.students.find(
        (s) => s.id === entry.studentId && s.tenantId === tenantId && !s.deleted
      );
      if (!student) continue;

      const activeChit = this.state.leaveOutChits.find(
        (c) =>
          c.tenantId === tenantId &&
          c.studentId === student.id &&
          isDateInLeaveChit(c, input.date)
      );

      // Enforce: Any student with an active leave out chit is marked Absent until it lapses
      const resolvedStatus: AttendanceStatus = activeChit ? 'Absent' : entry.status;
      const chitRemark = activeChit
        ? `Leave Out Chit (${activeChit.days}d: ${activeChit.startDate} to ${activeChit.endDate}): ${activeChit.reason}`
        : '';
      const resolvedRemarks = activeChit
        ? entry.remarks.trim() || chitRemark
        : entry.remarks;

      const existing = this.state.attendance.find(
        (r) => r.tenantId === tenantId && r.date === input.date && r.studentId === entry.studentId
      );

      if (existing) {
        existing.status = resolvedStatus;
        existing.termId = resolvedTerm?.id || existing.termId;
        existing.remarks = resolvedRemarks;
        existing.recordedBy = input.recordedBy;
        existing.updatedAt = now;
        saved.push(existing);
      } else {
        const rec: AttendanceRecord = {
          id: `att-${input.date}-${student.id}`,
          tenantId,
          termId: resolvedTerm?.id,
          date: input.date,
          grade: student.grade,
          section: student.section,
          studentId: student.id,
          studentName: student.fullName,
          studentCode: student.studentCode,
          status: resolvedStatus,
          remarks: resolvedRemarks,
          recordedBy: input.recordedBy,
          updatedAt: now,
        };
        this.state.attendance.push(rec);
        saved.push(rec);
      }

      if (resolvedStatus === 'Absent' && !resolvedRemarks.trim()) {
        unexcusedAbsences.push(student.fullName);
      }
    }

    this.persist();
    if (unexcusedAbsences.length > 0) {
      this.pushNotification(
        tenantId,
        'attendance',
        `Unexcused Absence Alert (${input.grade} ${input.section})`,
        `${unexcusedAbsences.join(', ')} marked Absent without prior excuse on ${input.date}.`,
        'attendance'
      );
    }
    this.syncTenant(tenantId, 'attendance:saved');
    return saved;
  }

  saveStaffAttendanceBatch(
    tenantId: string,
    input: {
      date: string;
      recordedBy: string;
      staffCategory?: StaffCategory;
      actorRole?: UserRole;
      entries: Array<{ staffId: string; status: AttendanceStatus; remarks: string }>;
    }
  ): StaffAttendanceRecord[] {
    if (input.actorRole && input.actorRole !== 'Admin' && input.actorRole !== 'Super Admin') {
      throw new ConflictError(
        'Teaching and Non-Teaching staff attendance is restricted to School Admin only.',
        403
      );
    }
    const tenant = this.requireTenant(tenantId);
    const category: StaffCategory =
      input.staffCategory === 'Non-Teaching' ? 'Non-Teaching' : 'Teaching';
    const now = new Date().toISOString();
    const saved: StaffAttendanceRecord[] = [];
    const unexcusedAbsences: string[] = [];

    for (const entry of input.entries) {
      const rosterMember =
        category === 'Teaching'
          ? tenant.teachers.find((t) => t.id === entry.staffId)
          : (tenant.nonTeachingStaff || []).find((n) => n.id === entry.staffId);
      if (!rosterMember) continue;

      const roleLabel =
        category === 'Teaching'
          ? 'Teacher'
          : (rosterMember as NonTeachingStaffProfile).role || 'Support Staff';

      const existing = this.state.staffAttendance.find(
        (r) =>
          r.tenantId === tenantId &&
          r.date === input.date &&
          r.staffId === entry.staffId &&
          (r.staffCategory || 'Teaching') === category
      );

      if (existing) {
        existing.status = entry.status;
        existing.remarks = entry.remarks;
        existing.staffName = rosterMember.name;
        existing.staffCategory = category;
        existing.role = roleLabel;
        existing.department = rosterMember.department;
        existing.phone = rosterMember.phone || '';
        existing.recordedBy = input.recordedBy;
        existing.updatedAt = now;
        saved.push(existing);
      } else {
        const rec: StaffAttendanceRecord = {
          id: `satt-${category === 'Non-Teaching' ? 'nt' : 'tc'}-${input.date}-${rosterMember.id}`,
          tenantId,
          date: input.date,
          staffId: rosterMember.id,
          staffName: rosterMember.name,
          staffCategory: category,
          role: roleLabel,
          department: rosterMember.department,
          phone: rosterMember.phone || '',
          status: entry.status,
          remarks: entry.remarks,
          recordedBy: input.recordedBy,
          updatedAt: now,
        };
        this.state.staffAttendance.push(rec);
        saved.push(rec);
      }

      if (entry.status === 'Absent' && !entry.remarks.trim()) {
        unexcusedAbsences.push(rosterMember.name);
      }
    }

    this.persist();
    if (unexcusedAbsences.length > 0) {
      this.pushNotification(
        tenantId,
        'attendance',
        `${category} Staff Absence Alert`,
        `${unexcusedAbsences.join(', ')} marked Absent on ${input.date}.`,
        'attendance'
      );
    }
    this.syncTenant(tenantId, 'staff-attendance:saved');
    return saved;
  }

  // Exams & Assessment
  createExamCycle(
    tenantId: string,
    input: { title: string; term: string; termId?: string; startDate: string; endDate: string }
  ): ExamCycle {
    const tenant = this.requireTenant(tenantId);
    const resolvedTerm = this.assertTermOpen(tenantId, {
      termId: input.termId,
      termName: (input.term || '').trim() || tenant.currentTerm,
      date: input.startDate,
      actionLabel: 'Creating an exam cycle',
    });
    const cycle: ExamCycle = {
      id: `exm-${randomUUID().slice(0, 8)}`,
      tenantId,
      academicYearId: resolvedTerm?.academicYearId,
      termId: resolvedTerm?.id,
      title: input.title.trim(),
      term: resolvedTerm?.name || input.term.trim() || tenant.currentTerm,
      startDate: input.startDate,
      endDate: input.endDate,
      status: 'Grading',
      createdAt: new Date().toISOString(),
    };
    this.state.examCycles.unshift(cycle);
    this.persist();
    this.syncTenant(tenantId, 'exam:cycle-created');
    return cycle;
  }

  private parseStrictExamScore(
    rawScore: unknown,
    studentName: string,
    subject: string,
    resultStatus?: ExamResultStatus
  ): { status: ExamResultStatus; score: number } {
    const status: ExamResultStatus =
      resultStatus === 'Absent' || resultStatus === 'Exempt' ? resultStatus : 'Scored';
    if (status === 'Absent' || status === 'Exempt') {
      return { status, score: 0 };
    }
    if (
      rawScore === null ||
      rawScore === undefined ||
      typeof rawScore === 'boolean' ||
      (typeof rawScore === 'string' && rawScore.trim() === '')
    ) {
      throw new ConflictError(
        `Invalid score for ${studentName} in ${subject}. Provide a numeric score between 0 and 100 or mark Absent/Exempt.`,
        400
      );
    }
    const rawNum = Number(rawScore);
    if (!Number.isFinite(rawNum) || rawNum < 0 || rawNum > 100) {
      throw new ConflictError(
        `Invalid score for ${studentName} in ${subject}. Marks must be between 0 and 100.`,
        400
      );
    }
    return { status: 'Scored', score: Math.round(rawNum) };
  }

  private assertTeacherCanGradeSubject(
    tenant: Tenant,
    actor: Pick<TenantUser, 'role' | 'email' | 'fullName'> | undefined,
    requestedTeacherId: string | undefined,
    grade: string,
    section: string,
    subject: string
  ): TeacherProfile | undefined {
    if (!actor || actor.role !== 'Teacher') {
      if (requestedTeacherId && requestedTeacherId !== '__ADMIN__') {
        const t = tenant.teachers.find((x) => x.id === requestedTeacherId);
        if (t) {
          const tenantSlots = this.state.timetable.filter((s) => s.tenantId === tenant.id);
          const allowed = getTeacherAssignedSubjectsForCohort(tenant, t, grade, section, tenantSlots);
          if (!allowed.some((s) => s.toLowerCase() === subject.toLowerCase())) {
            throw new ConflictError(
              `${t.name} is not assigned to teach "${subject}" in ${grade} Stream ${section}.`,
              403
            );
          }
        }
        return t;
      }
      return undefined;
    }

    if (requestedTeacherId === '__ADMIN__') {
      throw new ConflictError(
        'Teachers cannot use Admin override. Enter marks only for classes and subjects assigned to you.',
        403
      );
    }
    // Identity comes from the authenticated account only; a client-supplied teacherId is never trusted.
    const matchedTeacher = tenant.teachers.find(
      (t) => t.email.trim().toLowerCase() === actor.email.trim().toLowerCase()
    );

    if (!matchedTeacher) {
      throw new ConflictError(
        `Teacher profile for ${actor.fullName} is not configured in ${tenant.name} faculty roster.`,
        403
      );
    }
    if (matchedTeacher.email.trim().toLowerCase() !== actor.email.trim().toLowerCase()) {
      throw new ConflictError(
        'Teachers can only submit scores under their own teacher assignment.',
        403
      );
    }
    const tenantSlots = this.state.timetable.filter((s) => s.tenantId === tenant.id);
    if (!isTeacherAssignedToCohort(matchedTeacher, grade, section, tenantSlots)) {
      throw new ConflictError(
        `${matchedTeacher.name} is not assigned to ${grade} Stream ${section}.`,
        403
      );
    }
    const allowed = getTeacherAssignedSubjectsForCohort(
      tenant,
      matchedTeacher,
      grade,
      section,
      tenantSlots
    );
    if (!allowed.some((s) => s.toLowerCase() === subject.toLowerCase())) {
      throw new ConflictError(
        `${matchedTeacher.name} is not assigned to teach "${subject}" in ${grade} Stream ${section}.`,
        403
      );
    }
    return matchedTeacher;
  }

  upsertExamScore(
    tenantId: string,
    input: {
      examCycleId: string;
      studentId: string;
      subject: string;
      score: number;
      resultStatus?: ExamResultStatus;
      remarks?: string;
    },
    actor?: Pick<TenantUser, 'role' | 'email' | 'fullName'>
  ): ExamResult {
    const tenant = this.requireTenant(tenantId);
    const student = this.state.students.find(
      (s) => s.id === input.studentId && s.tenantId === tenantId && !s.deleted
    );
    if (!student) throw new ConflictError('Student not found in tenant.', 404);
    const cycle = this.state.examCycles.find((c) => c.id === input.examCycleId && c.tenantId === tenantId);
    if (!cycle) throw new ConflictError('Exam cycle not found in tenant.', 404);

    this.assertTermOpen(tenantId, {
      termId: cycle.termId,
      termName: cycle.term,
      date: cycle.startDate,
      actionLabel: `Editing exam marks in "${cycle.title}"`,
    });

    if (cycle.status === 'Published') {
      throw new ConflictError(
        `Exam cycle "${cycle.title}" is Published and locked. An Admin must unlock it with a reason before marks can be edited.`,
        409
      );
    }

    const subject = (input.subject || '').trim();
    if (!subject) {
      throw new ConflictError('Subject is required.', 400);
    }
    this.assertTeacherCanGradeSubject(
      tenant,
      actor,
      undefined,
      student.grade,
      student.section,
      subject
    );

    const parsed = this.parseStrictExamScore(
      input.score,
      student.fullName,
      subject,
      input.resultStatus
    );
    const gradeCalc =
      parsed.status === 'Absent'
        ? { letterGrade: 'ABS', gpaPoints: 0 }
        : parsed.status === 'Exempt'
        ? { letterGrade: 'EXM', gpaPoints: 0 }
        : computeLetterGrade(parsed.score, student.grade);
    const now = new Date().toISOString();

    const existing = this.state.examResults.find(
      (r) =>
        r.tenantId === tenantId &&
        r.examCycleId === input.examCycleId &&
        r.studentId === input.studentId &&
        r.subject.toLowerCase() === subject.toLowerCase()
    );

    if (existing) {
      existing.score = parsed.score;
      existing.resultStatus = parsed.status;
      existing.letterGrade = gradeCalc.letterGrade;
      existing.gpaPoints = gradeCalc.gpaPoints;
      if (input.remarks !== undefined) existing.remarks = input.remarks;
      existing.updatedAt = now;
      this.persist();
      this.syncTenant(tenantId, 'exam:score-updated');
      return existing;
    }

    const res: ExamResult = {
      id: `res-${randomUUID().slice(0, 8)}`,
      tenantId,
      examCycleId: input.examCycleId,
      studentId: student.id,
      studentName: student.fullName,
      studentCode: student.studentCode,
      grade: student.grade,
      section: student.section,
      subject,
      score: parsed.score,
      maxScore: 100,
      letterGrade: gradeCalc.letterGrade,
      gpaPoints: gradeCalc.gpaPoints,
      resultStatus: parsed.status,
      remarks:
        input.remarks?.trim() ||
        (parsed.status !== 'Scored'
          ? parsed.status
          : parsed.score >= 85
          ? 'Strong mastery'
          : 'Term evaluation'),
      updatedAt: now,
    };
    this.state.examResults.push(res);
    this.persist();
    this.syncTenant(tenantId, 'exam:score-updated');
    return res;
  }

  saveExamScoresBatch(
    tenantId: string,
    input: {
      examCycleId?: string;
      examType?: string;
      grade: string;
      section: string;
      teacherId: string;
      entries: Array<{
        studentId: string;
        subject: string;
        score: number;
        resultStatus?: ExamResultStatus;
        remarks?: string;
      }>;
    },
    actor?: Pick<TenantUser, 'role' | 'email' | 'fullName'>
  ): { results: ExamResult[]; cycle: ExamCycle; savedCount: number } {
    const tenant = this.requireTenant(tenantId);
    const grade = (input.grade || '').trim();
    const section = (input.section || '').trim();
    if (!grade || !section) {
      throw new ConflictError('Select both Grade and Stream before saving results.', 400);
    }

    if (!Array.isArray(input.entries) || input.entries.length === 0) {
      throw new ConflictError('Provide at least one student mark to save.', 400);
    }

    // Resolve Exam Cycle by ID or Exam Type in current term
    let cycle = input.examCycleId
      ? this.state.examCycles.find(
          (c) => c.id === input.examCycleId && c.tenantId === tenantId
        )
      : undefined;

    if (!cycle && input.examType) {
      const typeNorm = input.examType.trim().toLowerCase().replace(/^term\s+/i, '');
      cycle = this.state.examCycles.find(
        (c) => c.tenantId === tenantId && c.title.toLowerCase().includes(typeNorm)
      );
      if (!cycle) {
        const termLabel = tenant.currentTerm || 'Term 1';
        cycle = this.createExamCycle(tenantId, {
          title: `${termLabel} ${input.examType.replace(/^Term\s+/i, '').trim()}`,
          term: termLabel,
          startDate: new Date().toISOString().slice(0, 10),
          endDate: addDaysIso(new Date().toISOString().slice(0, 10), 5),
        });
      }
    }

    if (!cycle) {
      throw new ConflictError('Select a valid exam type / cycle.', 404);
    }

    this.assertTermOpen(tenantId, {
      termId: cycle.termId,
      termName: cycle.term,
      date: cycle.startDate,
      actionLabel: `Saving exam marks for "${cycle.title}"`,
    });

    if (cycle.status === 'Published') {
      throw new ConflictError(
        `Exam cycle "${cycle.title}" is Published and locked. An Admin must unlock it with a reason before saving marks.`,
        409
      );
    }

    const isAdminOverride = input.teacherId === '__ADMIN__';
    if (actor?.role === 'Teacher' && isAdminOverride) {
      throw new ConflictError(
        'Teachers cannot use Admin override when saving marks.',
        403
      );
    }

    let teacher: TeacherProfile | undefined;
    let allowedSet: Set<string> | null = null;

    if (!isAdminOverride || actor?.role === 'Teacher') {
      teacher =
        actor?.role === 'Teacher'
          ? tenant.teachers.find((t) => t.email.trim().toLowerCase() === actor.email.trim().toLowerCase()) ||
            tenant.teachers.find((t) => t.id === input.teacherId)
          : tenant.teachers.find((t) => t.id === input.teacherId);

      if (!teacher) {
        throw new ConflictError('Select a valid teacher before saving results.', 400);
      }
      if (
        actor?.role === 'Teacher' &&
        teacher.email.trim().toLowerCase() !== actor.email.trim().toLowerCase()
      ) {
        throw new ConflictError(
          'Teachers can only submit marks for their own assigned classes and subjects.',
          403
        );
      }
      const tenantSlots = this.state.timetable.filter((s) => s.tenantId === tenantId);
      if (actor?.role === 'Teacher' && !isTeacherAssignedToCohort(teacher, grade, section, tenantSlots)) {
        throw new ConflictError(
          `${teacher.name} is not assigned to teach ${grade} Stream ${section}.`,
          403
        );
      }
      const allowedSubjects = getTeacherAssignedSubjectsForCohort(
        tenant,
        teacher,
        grade,
        section,
        tenantSlots
      );
      allowedSet = new Set(allowedSubjects.map((s) => s.toLowerCase()));
    }

    const now = new Date().toISOString();
    const saved: ExamResult[] = [];
    const touchedSubjects = new Set<string>();

    for (const entry of input.entries) {
      const subject = (entry.subject || '').trim();
      if (!subject) {
        throw new ConflictError('Every mark entry must specify a subject.', 400);
      }
      if (allowedSet && !allowedSet.has(subject.toLowerCase())) {
        throw new ConflictError(
          `${teacher?.name || 'Teacher'} is only allowed to enter or upload results for subjects assigned to teach in ${grade} Stream ${section}. "${subject}" is not assigned.`,
          403
        );
      }

      const student = this.state.students.find(
        (s) => s.id === entry.studentId && s.tenantId === tenantId && !s.deleted
      );
      if (!student) {
        throw new ConflictError(`Student not found in this school (${entry.studentId}).`, 404);
      }
      if (
        student.grade.toLowerCase() !== grade.toLowerCase() ||
        student.section.toLowerCase() !== section.toLowerCase()
      ) {
        throw new ConflictError(
          `${student.fullName} belongs to ${student.grade} Stream ${student.section}, not ${grade} Stream ${section}.`,
          400
        );
      }

      const parsed = this.parseStrictExamScore(
        entry.score,
        student.fullName,
        subject,
        entry.resultStatus
      );
      const gradeCalc =
        parsed.status === 'Absent'
          ? { letterGrade: 'ABS', gpaPoints: 0 }
          : parsed.status === 'Exempt'
          ? { letterGrade: 'EXM', gpaPoints: 0 }
          : computeLetterGrade(parsed.score, student.grade);

      const existing = this.state.examResults.find(
        (r) =>
          r.tenantId === tenantId &&
          r.examCycleId === cycle!.id &&
          r.studentId === student.id &&
          r.subject.toLowerCase() === subject.toLowerCase()
      );

      if (existing) {
        existing.score = parsed.score;
        existing.resultStatus = parsed.status;
        existing.letterGrade = gradeCalc.letterGrade;
        existing.gpaPoints = gradeCalc.gpaPoints;
        if (entry.remarks !== undefined && entry.remarks.trim()) {
          existing.remarks = entry.remarks.trim();
        }
        existing.updatedAt = now;
        saved.push(existing);
      } else {
        const res: ExamResult = {
          id: `res-${randomUUID().slice(0, 8)}`,
          tenantId,
          examCycleId: cycle.id,
          studentId: student.id,
          studentName: student.fullName,
          studentCode: student.studentCode,
          grade: student.grade,
          section: student.section,
          subject,
          score: parsed.score,
          maxScore: 100,
          letterGrade: gradeCalc.letterGrade,
          gpaPoints: gradeCalc.gpaPoints,
          resultStatus: parsed.status,
          remarks:
            entry.remarks?.trim() ||
            (parsed.status !== 'Scored'
              ? parsed.status
              : parsed.score >= 85
              ? 'Strong mastery'
              : 'Term evaluation'),
          updatedAt: now,
        };
        this.state.examResults.push(res);
        saved.push(res);
      }
      touchedSubjects.add(subject);
    }

    this.persist();
    const subjectList = Array.from(touchedSubjects).join(', ');
    this.pushNotification(
      tenantId,
      'exam',
      `Marks Saved: ${cycle.title} (${grade} Stream ${section})`,
      `${saved.length} score(s) recorded for ${subjectList} by ${teacher ? teacher.name : 'Exam Officer'}.`,
      'exams'
    );
    this.syncTenant(tenantId, 'exam:scores-batch-saved');
    return { results: saved, cycle, savedCount: saved.length };
  }

  publishExamCycle(tenantId: string, examCycleId: string): ExamCycle {
    const tenant = this.requireTenant(tenantId);
    const cycle = this.state.examCycles.find((c) => c.id === examCycleId && c.tenantId === tenantId);
    if (!cycle) throw new ConflictError('Exam cycle not found.', 404);

    this.assertTermOpen(tenantId, {
      termId: cycle.termId,
      termName: cycle.term,
      date: cycle.startDate,
      actionLabel: `Publishing "${cycle.title}"`,
    });

    const activeStudents = this.state.students.filter(
      (s) => s.tenantId === tenantId && !s.deleted && s.status === 'Active'
    );
    const cycleResults = this.state.examResults.filter(
      (r) => r.tenantId === tenantId && r.examCycleId === examCycleId
    );
    const resultKeys = new Set(
      cycleResults.map((r) => `${r.studentId}::${r.subject.trim().toLowerCase()}`)
    );

    const missing: string[] = [];
    for (const student of activeStudents) {
      const subjects = getSubjectsForGrade(tenant, student.grade);
      for (const subject of subjects) {
        if (!resultKeys.has(`${student.id}::${subject.trim().toLowerCase()}`)) {
          missing.push(`${student.fullName} (${student.grade} · ${subject})`);
        }
      }
    }

    if (missing.length > 0) {
      throw new ConflictError(
        `Cannot publish "${cycle.title}": ${missing.length} mark(s) missing across enrolled learners (record a score or mark Absent/Exempt). First missing: ${missing.slice(0, 3).join(', ')}`,
        400
      );
    }

    cycle.status = 'Published';
    this.persist();
    this.pushNotification(
      tenantId,
      'exam',
      `Exam Results Published: ${cycle.title}`,
      `Official transcripts and GPA rankings for ${cycle.term} are now available.`,
      'exams'
    );
    this.syncTenant(tenantId, 'exam:published');
    return cycle;
  }

  unlockExamCycle(
    tenantId: string,
    examCycleId: string,
    reason: string,
    actor: Pick<TenantUser, 'role' | 'fullName' | 'email'>
  ): ExamCycle {
    this.requireTenant(tenantId);
    if (actor.role !== 'Admin' && actor.role !== 'Super Admin' && actor.role !== 'Developer') {
      throw new ConflictError('Only School Admin can unlock a published exam cycle.', 403);
    }
    const cleanReason = (reason || '').trim();
    if (!cleanReason) {
      throw new ConflictError('Provide an audit reason before unlocking a published exam cycle.', 400);
    }
    const cycle = this.state.examCycles.find((c) => c.id === examCycleId && c.tenantId === tenantId);
    if (!cycle) throw new ConflictError('Exam cycle not found.', 404);
    this.assertTermOpen(tenantId, {
      termId: cycle.termId,
      termName: cycle.term,
      date: cycle.startDate,
      actionLabel: `Unlocking "${cycle.title}"`,
    });
    if (cycle.status !== 'Published') {
      throw new ConflictError(`Exam cycle "${cycle.title}" is not currently Published.`, 400);
    }

    cycle.status = 'Grading';
    if (!Array.isArray(cycle.unlockHistory)) cycle.unlockHistory = [];
    cycle.unlockHistory.unshift({
      unlockedAt: new Date().toISOString(),
      unlockedBy: actor.fullName || actor.email,
      reason: cleanReason,
    });

    this.persist();
    this.pushNotification(
      tenantId,
      'exam',
      `Exam Cycle Unlocked: ${cycle.title}`,
      `Unlocked for grading by ${actor.fullName || actor.email}. Reason: ${cleanReason}`,
      'exams'
    );
    this.syncTenant(tenantId, 'exam:unlocked');
    return cycle;
  }

  // Fees & Billing
  upsertFeeStructure(
    tenantId: string,
    input: {
      grade: string;
      term: string;
      termId?: string;
      votelines?: Array<{ id?: string; name: string; amount: number }>;
      tuitionFee?: number;
      labFee?: number;
      technologyFee?: number;
      activitiesFee?: number;
    }
  ): FeeStructure {
    this.requireTenant(tenantId);

    const grade = (input.grade || '').trim();
    const term = (input.term || '').trim();
    if (!grade || !term) {
      throw new ConflictError('Grade and term are required for a fee structure.', 400);
    }
    const resolvedTerm = this.assertTermOpen(tenantId, {
      termId: input.termId,
      termName: term,
      actionLabel: 'Updating fee structure',
    });

    let normalizedVotelines: FeeVoteline[];
    if (Array.isArray(input.votelines)) {
      if (input.votelines.length === 0) {
        throw new ConflictError('Provide at least 1 fee voteline.', 400);
      }
      if (input.votelines.length > MAX_FEE_VOTELINES) {
        throw new ConflictError(
          `Fee structures support at most ${MAX_FEE_VOTELINES} votelines.`,
          400
        );
      }
      normalizedVotelines = input.votelines.map((line, index) => {
        const name = typeof line.name === 'string' ? line.name.trim() : '';
        if (!name) {
          throw new ConflictError(`Voteline #${index + 1} requires a name.`, 400);
        }
        const rawAmt = Number(line.amount);
        if (!Number.isFinite(rawAmt) || rawAmt < 0) {
          throw new ConflictError(`Voteline "${name}" must have a valid non-negative amount.`, 400);
        }
        return {
          id:
            typeof line.id === 'string' && line.id.trim()
              ? line.id.trim()
              : `vl-${randomUUID().slice(0, 8)}`,
          name,
          amount: Math.round(rawAmt),
        };
      });
    } else {
      normalizedVotelines = [
        { id: 'vl-tuition', name: 'Tuition Fee', amount: Math.max(0, Math.round(Number(input.tuitionFee || 0))) },
        { id: 'vl-lab', name: 'Laboratory Fee', amount: Math.max(0, Math.round(Number(input.labFee || 0))) },
        { id: 'vl-tech', name: 'Technology & ICT', amount: Math.max(0, Math.round(Number(input.technologyFee || 0))) },
        { id: 'vl-act', name: 'Co-Curricular & Activities', amount: Math.max(0, Math.round(Number(input.activitiesFee || 0))) },
      ];
    }

    const totalFee = normalizedVotelines.reduce((sum, line) => sum + line.amount, 0);
    const findAmt = (pattern: RegExp, fallbackIdx: number) =>
      normalizedVotelines.find((v) => pattern.test(v.name))?.amount ??
      normalizedVotelines[fallbackIdx]?.amount ??
      0;

    const tuitionFee = findAmt(/tuition/i, 0);
    const labFee = findAmt(/lab|science/i, 1);
    const technologyFee = findAmt(/tech|ict|comp/i, 2);
    const activitiesFee = findAmt(/activ|sport|co[- ]?curr/i, 3);

    const existing = this.state.feeStructures.find(
      (f) => f.tenantId === tenantId && f.grade === grade && f.term === term
    );
    if (existing) {
      existing.votelines = normalizedVotelines;
      existing.tuitionFee = tuitionFee;
      existing.labFee = labFee;
      existing.technologyFee = technologyFee;
      existing.activitiesFee = activitiesFee;
      existing.totalFee = totalFee;
      this.persist();
      this.syncTenant(tenantId, 'fee:structure-updated');
      return existing;
    }

    const fsItem: FeeStructure = {
      id: `fs-${randomUUID().slice(0, 8)}`,
      tenantId,
      termId: resolvedTerm?.id,
      grade,
      term,
      votelines: normalizedVotelines,
      tuitionFee,
      labFee,
      technologyFee,
      activitiesFee,
      totalFee,
    };
    this.state.feeStructures.push(fsItem);
    this.persist();
    this.syncTenant(tenantId, 'fee:structure-updated');
    return fsItem;
  }

  createInvoice(
    tenantId: string,
    input: { studentId: string; term: string; termId?: string; dueDate: string; totalAmount: number },
    actor?: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>,
    ip?: string
  ): FeeInvoice {
    const tenant = this.requireTenant(tenantId);
    const student = this.state.students.find(
      (s) => s.id === input.studentId && s.tenantId === tenantId && !s.deleted
    );
    if (!student) throw new ConflictError('Student not found in tenant.', 404);

    const requestedTermName = (input.term || '').trim() || tenant.currentTerm;
    const resolvedTerm = this.assertTermOpen(tenantId, {
      termId: input.termId,
      termName: requestedTermName,
      actionLabel: 'Issuing a fee invoice',
    });

    const amount = this.parseStrictPositiveAmount(input.totalAmount, 'Invoice amount');

    const invoice: FeeInvoice = {
      id: `inv-${randomUUID().slice(0, 8)}`,
      tenantId,
      termId: resolvedTerm?.id,
      invoiceNumber: this.nextInvoiceNumber(tenant),
      studentId: student.id,
      studentName: student.fullName,
      studentCode: student.studentCode,
      grade: student.grade,
      term: resolvedTerm?.name || requestedTermName,
      dueDate: input.dueDate || '2026-12-01',
      totalAmount: amount,
      paidAmount: 0,
      balance: amount,
      status: 'Pending',
      payments: [],
      createdAt: new Date().toISOString(),
    };
    this.applySiblingDiscountIfEligible(tenant, student, invoice);
    this.state.invoices.unshift(invoice);
    this.appendFinanceAudit(
      tenantId,
      actor,
      'CREATE_INVOICE',
      'FeeInvoice',
      invoice.id,
      null,
      { invoiceNumber: invoice.invoiceNumber, studentId: student.id, totalAmount: invoice.totalAmount, balance: invoice.balance },
      ip
    );
    this.persist();
    this.pushNotification(
      tenantId,
      'fee',
      `Invoice Issued: ${invoice.invoiceNumber}`,
      `${student.fullName} billed ${tenant.currency} ${amount.toLocaleString()} for ${invoice.term}.`,
      'fees'
    );
    this.syncTenant(tenantId, 'fee:invoice-created');
    return invoice;
  }

  recordPayment(
    tenantId: string,
    invoiceId: string,
    input: {
      amount: number;
      method: PaymentMethod;
      reference: string;
      recordedBy: string;
      paidAt?: string;
    },
    actor?: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>,
    ip?: string
  ): FeeInvoice {
    const tenant = this.requireTenant(tenantId);
    const invoice = this.state.invoices.find((i) => i.id === invoiceId && i.tenantId === tenantId);
    if (!invoice) throw new ConflictError('Invoice not found.', 404);
    this.assertTermOpen(tenantId, {
      termId: invoice.termId,
      termName: invoice.term,
      actionLabel: `Recording payment on ${invoice.invoiceNumber}`,
    });

    const amount = this.parseStrictPositiveAmount(input.amount, 'Payment amount');
    const validMethods = new Set<PaymentMethod>(['Bank Transfer', 'Card', 'Mobile Money', 'Cash']);
    const method: PaymentMethod = validMethods.has(input.method) ? input.method : 'Bank Transfer';
    const paidAtIso = this.validatePaymentDate(input.paidAt, actor);
    const rawRef = (input.reference || '').trim();
    if (rawRef) {
      this.ensurePaymentReferenceUnique(tenantId, rawRef, method);
    }

    const beforeSnap = {
      paidAmount: invoice.paidAmount,
      balance: invoice.balance,
      status: invoice.status,
    };

    const appliedAmount = Math.min(invoice.balance, amount);
    const creditedExcess = Math.max(0, amount - appliedAmount);
    const receiptNumber = this.nextReceiptNumber(tenantId);
    const finalRef =
      rawRef && !(method === 'Cash' && /^auto$/i.test(rawRef)) ? rawRef : receiptNumber;

    const payment: PaymentRecord = {
      id: `pay-${randomUUID().slice(0, 8)}`,
      receiptNumber,
      amount,
      appliedAmount,
      creditedExcess,
      method,
      reference: finalRef,
      paidAt: paidAtIso,
      recordedBy: (input.recordedBy || '').trim() || actor?.fullName || 'Bursar Office',
    };
    invoice.payments.push(payment);

    if (creditedExcess > 0) {
      const student = this.state.students.find(
        (s) => s.id === invoice.studentId && s.tenantId === tenantId
      );
      if (student) {
        student.creditBalance = Math.max(0, (student.creditBalance || 0) + creditedExcess);
      }
    }

    this.recomputeInvoiceTotals(invoice);
    this.appendFinanceAudit(
      tenantId,
      actor,
      'RECORD_PAYMENT',
      'FeeInvoice',
      invoice.id,
      beforeSnap,
      {
        paymentId: payment.id,
        receiptNumber,
        amount,
        appliedAmount,
        creditedExcess,
        paidAmount: invoice.paidAmount,
        balance: invoice.balance,
        status: invoice.status,
      },
      ip
    );

    this.persist();
    this.pushNotification(
      tenantId,
      'fee',
      `Payment Received: ${invoice.studentName}`,
      `${tenant.currency} ${amount.toLocaleString()} via ${method} (${receiptNumber})${creditedExcess > 0 ? ` · ${tenant.currency} ${creditedExcess.toLocaleString()} credited to learner account` : ''}. Balance: ${tenant.currency} ${invoice.balance.toLocaleString()}.`,
      'fees'
    );
    this.syncTenant(tenantId, 'fee:payment-recorded');
    return invoice;
  }

  recordPaymentsBatch(
    tenantId: string,
    input: {
      recordedBy?: string;
      entries: Array<{
        invoiceId?: string;
        invoiceNumber?: string;
        studentId?: string;
        studentCode?: string;
        amount: number;
        method?: PaymentMethod;
        reference?: string;
        paidAt?: string;
      }>;
    },
    actor?: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>,
    ip?: string
  ): {
    updatedInvoices: FeeInvoice[];
    processedCount: number;
    skippedCount: number;
    totalCollected: number;
  } {
    const tenant = this.requireTenant(tenantId);
    if (!Array.isArray(input.entries) || input.entries.length === 0) {
      throw new ConflictError('Provide at least one fee payment entry to post.', 400);
    }

    const validMethods = new Set<PaymentMethod>(['Bank Transfer', 'Card', 'Mobile Money', 'Cash']);
    const recordedBy = (input.recordedBy || '').trim() || actor?.fullName || 'Bursar Office';
    const touchedIds = new Set<string>();
    let processedCount = 0;
    let skippedCount = 0;
    let totalCollected = 0;

    // Validate amounts, dates, and duplicate references upfront before mutating state
    const prepared: Array<{
      invoice: FeeInvoice;
      amount: number;
      method: PaymentMethod;
      reference: string;
      paidAtIso: string;
    }> = [];
    const batchRefs = new Set<string>();

    for (const entry of input.entries) {
      const amount = this.parseStrictPositiveAmount(entry.amount, 'Batch payment amount');
      const method: PaymentMethod =
        entry.method && validMethods.has(entry.method) ? entry.method : 'Bank Transfer';
      const paidAtIso = this.validatePaymentDate(entry.paidAt, actor);
      const rawRef = (entry.reference || '').trim();
      if (rawRef) {
        if (!(method === 'Cash' && /^auto$/i.test(rawRef))) {
          this.ensurePaymentReferenceUnique(tenantId, rawRef, method);
          const refLow = rawRef.toLowerCase();
          if (batchRefs.has(refLow)) {
            throw new ConflictError(`Duplicate payment reference "${rawRef}" within batch upload.`, 409);
          }
          batchRefs.add(refLow);
        }
      }

      let targetInvoice: FeeInvoice | undefined;
      if (entry.invoiceId) {
        targetInvoice = this.state.invoices.find(
          (i) => i.id === entry.invoiceId && i.tenantId === tenantId
        );
      }
      if (!targetInvoice && entry.invoiceNumber) {
        const invNum = entry.invoiceNumber.trim().toLowerCase();
        targetInvoice = this.state.invoices.find(
          (i) => i.tenantId === tenantId && i.invoiceNumber.trim().toLowerCase() === invNum
        );
      }
      if (!targetInvoice && entry.studentId) {
        targetInvoice =
          this.state.invoices.find(
            (i) => i.tenantId === tenantId && i.studentId === entry.studentId && i.balance > 0
          ) ||
          this.state.invoices.find(
            (i) => i.tenantId === tenantId && i.studentId === entry.studentId
          );
      }
      if (!targetInvoice && entry.studentCode) {
        const code = entry.studentCode.trim().toLowerCase();
        targetInvoice =
          this.state.invoices.find(
            (i) =>
              i.tenantId === tenantId &&
              i.studentCode.trim().toLowerCase() === code &&
              i.balance > 0
          ) ||
          this.state.invoices.find(
            (i) => i.tenantId === tenantId && i.studentCode.trim().toLowerCase() === code
          );
      }

      if (!targetInvoice) {
        skippedCount += 1;
        continue;
      }

      this.assertTermOpen(tenantId, {
        termId: targetInvoice.termId,
        termName: targetInvoice.term,
        actionLabel: `Batch payment for ${targetInvoice.invoiceNumber}`,
      });

      prepared.push({
        invoice: targetInvoice,
        amount,
        method,
        reference: rawRef,
        paidAtIso,
      });
    }

    if (prepared.length === 0) {
      throw new ConflictError(
        'No matching invoices were found for the uploaded payment entries.',
        400
      );
    }

    for (const item of prepared) {
      const beforeSnap = {
        paidAmount: item.invoice.paidAmount,
        balance: item.invoice.balance,
      };
      const appliedAmount = Math.min(item.invoice.balance, item.amount);
      const creditedExcess = Math.max(0, item.amount - appliedAmount);
      const receiptNumber = this.nextReceiptNumber(tenantId);
      const finalRef =
        item.reference && !(item.method === 'Cash' && /^auto$/i.test(item.reference))
          ? item.reference
          : receiptNumber;

      const payment: PaymentRecord = {
        id: `pay-${randomUUID().slice(0, 8)}`,
        receiptNumber,
        amount: item.amount,
        appliedAmount,
        creditedExcess,
        method: item.method,
        reference: finalRef,
        paidAt: item.paidAtIso,
        recordedBy,
      };
      item.invoice.payments.push(payment);

      if (creditedExcess > 0) {
        const student = this.state.students.find(
          (s) => s.id === item.invoice.studentId && s.tenantId === tenantId
        );
        if (student) {
          student.creditBalance = Math.max(0, (student.creditBalance || 0) + creditedExcess);
        }
      }

      this.recomputeInvoiceTotals(item.invoice);
      this.appendFinanceAudit(
        tenantId,
        actor,
        'RECORD_PAYMENT_BATCH',
        'FeeInvoice',
        item.invoice.id,
        beforeSnap,
        {
          paymentId: payment.id,
          receiptNumber,
          amount: item.amount,
          appliedAmount,
          creditedExcess,
          paidAmount: item.invoice.paidAmount,
          balance: item.invoice.balance,
        },
        ip
      );

      touchedIds.add(item.invoice.id);
      processedCount += 1;
      totalCollected += item.amount;
    }

    this.persist();
    this.pushNotification(
      tenantId,
      'fee',
      `Batch Fee Payments Recorded (${processedCount})`,
      `${tenant.currency} ${totalCollected.toLocaleString()} credited across ${touchedIds.size} student invoice(s).`,
      'fees'
    );
    this.syncTenant(tenantId, 'fee:payments-batch');

    return {
      updatedInvoices: this.state.invoices.filter(
        (i) => i.tenantId === tenantId && touchedIds.has(i.id)
      ),
      processedCount,
      skippedCount,
      totalCollected,
    };
  }

  voidPayment(
    tenantId: string,
    invoiceId: string,
    paymentId: string,
    reason: string,
    actor: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>,
    ip?: string
  ): FeeInvoice {
    const tenant = this.requireTenant(tenantId);
    if (
      actor.role !== 'Admin' &&
      actor.role !== 'Bursar' &&
      actor.role !== 'Super Admin' &&
      actor.role !== 'Developer'
    ) {
      throw new ConflictError('Only School Admin or Bursar can void a payment receipt.', 403);
    }
    const cleanReason = (reason || '').trim();
    if (!cleanReason) {
      throw new ConflictError('Provide a reason before voiding a payment.', 400);
    }

    const invoice = this.state.invoices.find((i) => i.id === invoiceId && i.tenantId === tenantId);
    if (!invoice) throw new ConflictError('Invoice not found.', 404);
    this.assertTermOpen(tenantId, {
      termId: invoice.termId,
      termName: invoice.term,
      actionLabel: `Voiding payment on ${invoice.invoiceNumber}`,
    });
    const payment = (invoice.payments || []).find((p) => p.id === paymentId);
    if (!payment) throw new ConflictError('Payment record not found on invoice.', 404);
    if (payment.isReversalEntry) {
      throw new ConflictError('Cannot void a payment reversal entry.', 409);
    }
    if (payment.voided) {
      throw new ConflictError(`Receipt ${payment.receiptNumber} has already been voided.`, 409);
    }

    const creditedExcess = Math.max(0, Number(payment.creditedExcess || 0));
    if (creditedExcess > 0) {
      const student = this.state.students.find(
        (s) => s.id === invoice.studentId && s.tenantId === tenantId
      );
      if (student) {
        const currentCred = student.creditBalance || 0;
        if (currentCred < creditedExcess) {
          throw new ConflictError(
            `Cannot void ${payment.receiptNumber}: excess credit of ${tenant.currency} ${creditedExcess.toLocaleString()} has already been applied elsewhere.`,
            409
          );
        }
        student.creditBalance = currentCred - creditedExcess;
      }
    }

    const beforeSnap = {
      paidAmount: invoice.paidAmount,
      balance: invoice.balance,
      status: invoice.status,
      receiptNumber: payment.receiptNumber,
    };

    const now = new Date().toISOString();
    const actorName = actor.fullName || actor.email;
    payment.voided = true;
    payment.voidReason = cleanReason;
    payment.voidedBy = actorName;
    payment.voidedAt = now;

    // Append explicit reversing entry (never delete original record)
    invoice.payments.push({
      id: `rev-${randomUUID().slice(0, 8)}`,
      receiptNumber: `${payment.receiptNumber}-REV`,
      amount: -Math.abs(payment.amount),
      appliedAmount: -Math.abs(
        typeof payment.appliedAmount === 'number' ? payment.appliedAmount : payment.amount
      ),
      creditedExcess: creditedExcess > 0 ? -creditedExcess : 0,
      method: payment.method,
      reference: `VOID:${payment.receiptNumber}`,
      paidAt: now,
      recordedBy: actorName,
      isReversalEntry: true,
      reversedPaymentId: payment.id,
      voidReason: cleanReason,
    });

    this.recomputeInvoiceTotals(invoice);
    this.appendFinanceAudit(
      tenantId,
      actor,
      'VOID_PAYMENT',
      'FeeInvoice',
      invoice.id,
      beforeSnap,
      {
        voidedReceipt: payment.receiptNumber,
        reason: cleanReason,
        paidAmount: invoice.paidAmount,
        balance: invoice.balance,
        status: invoice.status,
      },
      ip
    );

    this.persist();
    this.pushNotification(
      tenantId,
      'fee',
      `Payment Voided: ${payment.receiptNumber}`,
      `${tenant.currency} ${payment.amount.toLocaleString()} reversed on ${invoice.invoiceNumber} by ${actorName}. Reason: ${cleanReason}`,
      'fees'
    );
    this.syncTenant(tenantId, 'fee:payment-voided');
    return invoice;
  }

  createCreditNote(
    tenantId: string,
    input: { invoiceId: string; amount: number; reason: string },
    actor: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>,
    ip?: string
  ): { creditNote: CreditNoteRecord; invoice: FeeInvoice } {
    const tenant = this.requireTenant(tenantId);
    const invoice = this.state.invoices.find(
      (i) => i.id === input.invoiceId && i.tenantId === tenantId
    );
    if (!invoice) throw new ConflictError('Invoice not found.', 404);
    this.assertTermOpen(tenantId, {
      termId: invoice.termId,
      termName: invoice.term,
      actionLabel: `Issuing credit note on ${invoice.invoiceNumber}`,
    });

    const amount = this.parseStrictPositiveAmount(input.amount, 'Credit note amount');
    const reason = (input.reason || '').trim();
    if (!reason) throw new ConflictError('Provide a reason for the credit note.', 400);

    if (amount > invoice.balance) {
      throw new ConflictError(
        `Credit note amount (${tenant.currency} ${amount.toLocaleString()}) cannot exceed the remaining invoice balance (${tenant.currency} ${invoice.balance.toLocaleString()}). Void a payment instead if refunding paid funds.`,
        400
      );
    }

    const beforeSnap = {
      creditNotesTotal: invoice.creditNotesTotal || 0,
      balance: invoice.balance,
      status: invoice.status,
    };

    const cn: CreditNoteRecord = {
      id: `cn-${randomUUID().slice(0, 8)}`,
      tenantId,
      creditNoteNumber: this.nextCreditNoteNumber(tenantId),
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      studentId: invoice.studentId,
      studentName: invoice.studentName,
      studentCode: invoice.studentCode,
      amount,
      reason,
      createdBy: actor.fullName || actor.email,
      createdAt: new Date().toISOString(),
    };

    if (!Array.isArray(this.state.creditNotes)) this.state.creditNotes = [];
    this.state.creditNotes.unshift(cn);
    invoice.creditNotesTotal = (invoice.creditNotesTotal || 0) + amount;
    this.recomputeInvoiceTotals(invoice);

    this.appendFinanceAudit(
      tenantId,
      actor,
      'CREATE_CREDIT_NOTE',
      'CreditNote',
      cn.id,
      beforeSnap,
      {
        creditNoteNumber: cn.creditNoteNumber,
        amount,
        reason,
        invoiceBalance: invoice.balance,
      },
      ip
    );

    this.persist();
    this.pushNotification(
      tenantId,
      'fee',
      `Credit Note Issued: ${cn.creditNoteNumber}`,
      `${tenant.currency} ${amount.toLocaleString()} credited to ${invoice.studentName} (${invoice.invoiceNumber}).`,
      'fees'
    );
    this.syncTenant(tenantId, 'fee:credit-note-created');
    return { creditNote: cn, invoice };
  }

  createFeeWaiver(
    tenantId: string,
    input: {
      studentId: string;
      invoiceId?: string;
      term?: string;
      kind: FeeWaiverKind;
      mode: FeeWaiverMode;
      value: number;
      reason: string;
    },
    actor: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>,
    ip?: string
  ): { waiver: FeeWaiverRecord; invoice?: FeeInvoice } {
    const tenant = this.requireTenant(tenantId);
    const student = this.state.students.find(
      (s) => s.id === input.studentId && s.tenantId === tenantId && !s.deleted
    );
    if (!student) throw new ConflictError('Student not found in tenant.', 404);

    const reason = (input.reason || '').trim();
    if (!reason) throw new ConflictError('Provide a reason or sponsorship reference.', 400);
    const val = this.parseStrictPositiveAmount(input.value, 'Waiver / bursary value');
    const mode: FeeWaiverMode = input.mode === 'Percentage' ? 'Percentage' : 'Fixed';
    if (mode === 'Percentage' && val > 100) {
      throw new ConflictError('Percentage waiver/scholarship cannot exceed 100%.', 400);
    }

    const term = (input.term || '').trim() || tenant.currentTerm;
    const targetInvoice = input.invoiceId
      ? this.state.invoices.find(
          (i) => i.id === input.invoiceId && i.tenantId === tenantId && i.studentId === student.id
        )
      : this.state.invoices.find(
          (i) => i.tenantId === tenantId && i.studentId === student.id && i.term === term
        ) ||
        this.state.invoices.find(
          (i) => i.tenantId === tenantId && i.studentId === student.id && i.balance > 0
        );

    const resolvedTerm = this.assertTermOpen(tenantId, {
      termId: targetInvoice?.termId,
      termName: targetInvoice?.term || term,
      actionLabel: 'Applying a fee waiver or bursary',
    });

    const feeStruct = this.state.feeStructures.find(
      (f) => f.tenantId === tenantId && f.grade === student.grade && f.term === term
    );
    const basisAmount = targetInvoice ? targetInvoice.totalAmount : feeStruct?.totalFee || 0;
    const rawDiscount =
      mode === 'Percentage' ? Math.round((basisAmount * val) / 100) : val;
    const discountAmount = targetInvoice
      ? Math.min(targetInvoice.balance, rawDiscount)
      : rawDiscount;

    if (discountAmount <= 0) {
      throw new ConflictError('No open fee balance available to apply this waiver/bursary.', 400);
    }

    const beforeSnap = targetInvoice
      ? { waiverTotal: targetInvoice.waiverTotal || 0, balance: targetInvoice.balance }
      : null;

    const validKinds = new Set<FeeWaiverKind>([
      'Waiver',
      'Bursary',
      'Scholarship',
      'Sibling Discount',
    ]);
    const kind: FeeWaiverKind = validKinds.has(input.kind) ? input.kind : 'Bursary';

    const waiver: FeeWaiverRecord = {
      id: `wvr-${randomUUID().slice(0, 8)}`,
      tenantId,
      termId: resolvedTerm?.id,
      studentId: student.id,
      studentName: student.fullName,
      studentCode: student.studentCode,
      grade: student.grade,
      term,
      kind,
      mode,
      value: val,
      discountAmount,
      invoiceId: targetInvoice?.id,
      invoiceNumber: targetInvoice?.invoiceNumber,
      reason,
      approvedBy: actor.fullName || actor.email,
      createdAt: new Date().toISOString(),
    };

    if (!Array.isArray(this.state.feeWaivers)) this.state.feeWaivers = [];
    this.state.feeWaivers.unshift(waiver);

    if (targetInvoice) {
      targetInvoice.waiverTotal = (targetInvoice.waiverTotal || 0) + discountAmount;
      this.recomputeInvoiceTotals(targetInvoice);
    }

    this.appendFinanceAudit(
      tenantId,
      actor,
      'APPLY_FEE_WAIVER',
      'FeeWaiver',
      waiver.id,
      beforeSnap,
      {
        kind,
        mode,
        value: val,
        discountAmount,
        invoiceId: targetInvoice?.id,
        newBalance: targetInvoice?.balance,
      },
      ip
    );

    this.persist();
    this.pushNotification(
      tenantId,
      'fee',
      `${kind} Applied: ${student.fullName}`,
      `${tenant.currency} ${discountAmount.toLocaleString()} (${reason})${targetInvoice ? ` on ${targetInvoice.invoiceNumber}` : ''}.`,
      'fees'
    );
    this.syncTenant(tenantId, 'fee:waiver-created');
    return { waiver, invoice: targetInvoice };
  }

  updateSiblingDiscountConfig(
    tenantId: string,
    config: { enabled: boolean; percentage: number; minSiblings?: number },
    actor: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>,
    ip?: string
  ): Tenant {
    const tenant = this.requireTenant(tenantId);
    const pct = Number(config.percentage);
    if (!Number.isFinite(pct) || pct < 0 || pct > 50) {
      throw new ConflictError('Sibling discount percentage must be between 0% and 50%.', 400);
    }
    const minSiblings = Math.max(2, Math.min(10, Math.round(Number(config.minSiblings || 2))));
    const beforeSnap = tenant.siblingDiscountConfig || { enabled: false, percentage: 0, minSiblings: 2 };
    tenant.siblingDiscountConfig = {
      enabled: Boolean(config.enabled),
      percentage: Math.round(pct * 10) / 10,
      minSiblings,
    };
    this.appendFinanceAudit(
      tenantId,
      actor,
      'UPDATE_SIBLING_DISCOUNT',
      'Tenant',
      tenantId,
      beforeSnap,
      tenant.siblingDiscountConfig,
      ip
    );
    this.persist();
    this.syncTenant(tenantId, 'fee:sibling-discount-updated');
    return tenant;
  }

  private carryForwardSingleStudentBalance(
    tenant: Tenant,
    student: Student,
    fromTerm: string,
    toTerm: string,
    toTermId: string | undefined,
    dueDate: string,
    actorName: string
  ): { invoice: FeeInvoice; carriedArrears: number } | null {
    const tenantId = tenant.id;
    const priorOpenInvoices = this.state.invoices.filter(
      (i) =>
        i.tenantId === tenantId &&
        i.studentId === student.id &&
        (fromTerm ? i.term === fromTerm : i.term !== toTerm) &&
        i.balance > 0 &&
        !i.carriedForwardToTerm
    );
    const arrears = priorOpenInvoices.reduce((sum, inv) => sum + inv.balance, 0);
    for (const inv of priorOpenInvoices) {
      inv.carriedForwardToTerm = toTerm;
      inv.balance = 0;
      inv.status = 'Paid';
    }

    const feeStruct =
      this.state.feeStructures.find(
        (f) => f.tenantId === tenantId && f.grade === student.grade && f.term === toTerm
      ) ||
      this.state.feeStructures.find((f) => f.tenantId === tenantId && f.grade === student.grade) ||
      this.state.feeStructures.find((f) => f.tenantId === tenantId);

    const baseTermFee = feeStruct ? feeStruct.totalFee : 0;
    const grossNewAmount = baseTermFee + arrears;
    if (grossNewAmount <= 0 && (student.creditBalance || 0) <= 0) return null;

    const nextInv: FeeInvoice = {
      id: `inv-${randomUUID().slice(0, 8)}`,
      tenantId,
      termId: toTermId,
      invoiceNumber: this.nextInvoiceNumber(tenant),
      studentId: student.id,
      studentName: student.fullName,
      studentCode: student.studentCode,
      grade: student.grade,
      term: toTerm,
      dueDate,
      totalAmount: grossNewAmount,
      carriedForwardFromAmount: arrears > 0 ? arrears : undefined,
      paidAmount: 0,
      balance: grossNewAmount,
      status: 'Pending',
      payments: [],
      createdAt: new Date().toISOString(),
    };
    this.applySiblingDiscountIfEligible(tenant, student, nextInv);

    // Apply any existing overpayment creditBalance from previous term
    const availCredit = Math.max(0, Number(student.creditBalance || 0));
    if (availCredit > 0 && nextInv.balance > 0) {
      const appliedCredit = Math.min(availCredit, nextInv.balance);
      student.creditBalance = availCredit - appliedCredit;
      nextInv.payments.push({
        id: `pay-${randomUUID().slice(0, 8)}`,
        receiptNumber: this.nextReceiptNumber(tenantId),
        amount: appliedCredit,
        appliedAmount: appliedCredit,
        creditedExcess: 0,
        method: 'Bank Transfer',
        reference: `CREDIT-CF-${fromTerm.replace(/\s+/g, '')}`,
        paidAt: new Date().toISOString(),
        recordedBy: `Credit Carry-Forward (${actorName})`,
      });
      this.recomputeInvoiceTotals(nextInv);
    }

    this.state.invoices.unshift(nextInv);
    return { invoice: nextInv, carriedArrears: arrears };
  }

  carryForwardTermBalances(
    tenantId: string,
    input: { fromTerm?: string; toTerm: string; toTermId?: string; dueDate?: string },
    actor: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>,
    ip?: string
  ): { createdInvoices: FeeInvoice[]; carriedStudentsCount: number; updatedTerm: string } {
    const tenant = this.requireTenant(tenantId);
    const fromTerm = (input.fromTerm || '').trim() || tenant.currentTerm;
    const toTerm = (input.toTerm || '').trim();
    if (!toTerm || toTerm.toLowerCase() === fromTerm.toLowerCase()) {
      throw new ConflictError('Specify a new target term different from the current term.', 400);
    }
    const resolvedTargetTerm = this.assertTermOpen(tenantId, {
      termId: input.toTermId,
      termName: toTerm,
      exactTermNameOnly: true,
      actionLabel: `Carrying fee balances forward to ${toTerm}`,
    });
    const effectiveToTerm = resolvedTargetTerm?.name || toTerm;
    const dueDate = (input.dueDate || '').trim() || addDaysIso(new Date().toISOString().slice(0, 10), 30);
    const actorName = actor.fullName || actor.email;

    const createdInvoices: FeeInvoice[] = [];
    const activeStudents = this.state.students.filter(
      (s) => s.tenantId === tenantId && !s.deleted && s.status === 'Active'
    );

    for (const student of activeStudents) {
      const res = this.carryForwardSingleStudentBalance(
        tenant,
        student,
        fromTerm,
        effectiveToTerm,
        resolvedTargetTerm?.id,
        dueDate,
        actorName
      );
      if (res) {
        createdInvoices.push(res.invoice);
      }
    }

    tenant.currentTerm = effectiveToTerm;
    if (resolvedTargetTerm) {
      (this.state.academicTerms || []).forEach((t) => {
        if (t.tenantId === tenantId) t.isCurrent = t.id === resolvedTargetTerm.id;
      });
    }
    this.appendFinanceAudit(
      tenantId,
      actor,
      'CARRY_FORWARD_TERM',
      'Tenant',
      tenantId,
      { fromTerm },
      { toTerm: effectiveToTerm, createdInvoicesCount: createdInvoices.length },
      ip
    );

    this.persist();
    this.pushNotification(
      tenantId,
      'fee',
      `Term Carry-Forward Complete (${effectiveToTerm})`,
      `Carried arrears & credits from ${fromTerm} to ${effectiveToTerm} across ${createdInvoices.length} learner invoice(s).`,
      'fees'
    );
    this.syncTenant(tenantId, 'fee:term-carried-forward');
    return {
      createdInvoices,
      carriedStudentsCount: createdInvoices.length,
      updatedTerm: effectiveToTerm,
    };
  }

  createIndependentVotelines(
    tenantId: string,
    input: {
      name: string;
      amount: number;
      term?: string;
      note?: string;
      targetScope?: 'student' | 'grade' | 'all';
      studentId?: string;
      invoiceId?: string;
      grade?: string;
      recordedBy?: string;
    },
    actor?: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>,
    ip?: string
  ): IndependentVotelineItem[] {
    const tenant = this.requireTenant(tenantId);
    const name = (input.name || '').trim();
    if (!name) {
      throw new ConflictError('Enter an independent voteline name (e.g. Transport Fee or Academic Trip Fee).', 400);
    }
    const amount = this.parseStrictPositiveAmount(input.amount, 'Independent voteline amount');

    const scope = input.targetScope || 'student';
    const term = (input.term || '').trim() || tenant.currentTerm;
    const resolvedTerm = this.assertTermOpen(tenantId, {
      termName: term,
      actionLabel: 'Adding independent votelines',
    });
    const note = (input.note || '').trim() || undefined;
    const recordedBy = (input.recordedBy || '').trim() || actor?.fullName || 'Bursar Office';

    let targetStudents: Student[] = [];
    if (scope === 'grade') {
      const targetGrade = (input.grade || '').trim();
      if (!targetGrade) {
        throw new ConflictError('Select a target grade / class for the independent voteline.', 400);
      }
      const gradeStudents = this.state.students.filter(
        (s) => s.tenantId === tenantId && !s.deleted && s.grade === targetGrade
      );
      const activeGradeStudents = gradeStudents.filter((s) => s.status === 'Active');
      targetStudents = activeGradeStudents.length > 0 ? activeGradeStudents : gradeStudents;
    } else if (scope === 'all') {
      const allTenantStudents = this.state.students.filter(
        (s) => s.tenantId === tenantId && !s.deleted
      );
      const activeStudents = allTenantStudents.filter((s) => s.status === 'Active');
      targetStudents = activeStudents.length > 0 ? activeStudents : allTenantStudents;
    } else {
      let stu: Student | undefined;
      if (input.studentId) {
        stu = this.state.students.find(
          (s) => s.id === input.studentId && s.tenantId === tenantId && !s.deleted
        );
      }
      if (!stu && input.invoiceId) {
        const inv = this.state.invoices.find(
          (i) => i.id === input.invoiceId && i.tenantId === tenantId
        );
        if (inv) {
          stu = this.state.students.find(
            (s) => s.id === inv.studentId && s.tenantId === tenantId && !s.deleted
          );
        }
      }
      if (!stu) {
        throw new ConflictError('Student not found in active school.', 404);
      }
      targetStudents = [stu];
    }

    if (targetStudents.length === 0) {
      throw new ConflictError('No students matched the selected target scope.', 400);
    }

    if (!Array.isArray(this.state.independentVotelines)) {
      this.state.independentVotelines = [];
    }

    const nowIso = new Date().toISOString();
    const created: IndependentVotelineItem[] = [];

    for (const student of targetStudents) {
      const linkedInvoice =
        (input.invoiceId &&
          this.state.invoices.find(
            (i) => i.id === input.invoiceId && i.tenantId === tenantId && i.studentId === student.id
          )) ||
        this.state.invoices.find(
          (i) => i.tenantId === tenantId && i.studentId === student.id && i.term === term
        ) ||
        this.state.invoices.find((i) => i.tenantId === tenantId && i.studentId === student.id);

      const item: IndependentVotelineItem = {
        id: `ivl-${randomUUID().slice(0, 8)}`,
        tenantId,
        termId: resolvedTerm?.id,
        studentId: student.id,
        studentName: student.fullName,
        studentCode: student.studentCode,
        grade: student.grade,
        invoiceId: linkedInvoice?.id,
        invoiceNumber: linkedInvoice?.invoiceNumber,
        term: resolvedTerm?.name || term,
        name,
        amount,
        paidAmount: 0,
        balance: amount,
        status: 'Pending',
        note,
        payments: [],
        recordedBy,
        createdAt: nowIso,
      };
      this.state.independentVotelines.unshift(item);
      created.push(item);
    }

    this.appendFinanceAudit(
      tenantId,
      actor,
      'CREATE_INDEPENDENT_VOTELINES',
      'IndependentVoteline',
      created[0]?.id || 'batch',
      null,
      { name, amount, count: created.length },
      ip
    );

    this.persist();
    this.pushNotification(
      tenantId,
      'fee',
      `Independent Voteline Added: ${name}`,
      `${created.length} learner(s) assigned ${name} (${tenant.currency} ${amount.toLocaleString()}) alongside fees — Fee Total unchanged.`,
      'fees'
    );
    this.syncTenant(tenantId, 'fee:independent-voteline-created');
    return created;
  }

  recordIndependentVotelinePayment(
    tenantId: string,
    itemId: string,
    input: {
      amount: number;
      method: PaymentMethod;
      reference?: string;
      recordedBy?: string;
      paidAt?: string;
    },
    actor?: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>,
    ip?: string
  ): IndependentVotelineItem {
    const tenant = this.requireTenant(tenantId);
    if (!Array.isArray(this.state.independentVotelines)) {
      this.state.independentVotelines = [];
    }
    const item = this.state.independentVotelines.find(
      (v) => v.id === itemId && v.tenantId === tenantId && !v.voided
    );
    if (!item) {
      throw new ConflictError('Independent voteline record not found.', 404);
    }
    this.assertTermOpen(tenantId, {
      termId: item.termId,
      termName: item.term,
      actionLabel: `Recording payment on "${item.name}"`,
    });
    if (item.balance <= 0) {
      throw new ConflictError('Independent voteline has no remaining balance.', 400);
    }

    const requestedAmount = this.parseStrictPositiveAmount(
      input.amount,
      'Independent voteline payment'
    );
    const validMethods = new Set<PaymentMethod>(['Bank Transfer', 'Card', 'Mobile Money', 'Cash']);
    const method: PaymentMethod =
      input.method && validMethods.has(input.method) ? input.method : 'Mobile Money';
    const paidAtIso = this.validatePaymentDate(input.paidAt, actor);
    const rawRef = (input.reference || '').trim();
    if (rawRef) {
      this.ensurePaymentReferenceUnique(tenantId, rawRef, method);
    }

    const payAmount = Math.min(item.balance, requestedAmount);
    const receiptNumber = this.nextReceiptNumber(tenantId);
    const finalRef =
      rawRef && !(method === 'Cash' && /^auto$/i.test(rawRef)) ? rawRef : receiptNumber;

    const payment: IndependentVotelinePayment = {
      id: `ivlpay-${randomUUID().slice(0, 8)}`,
      receiptNumber,
      amount: payAmount,
      method,
      reference: finalRef,
      paidAt: paidAtIso,
      recordedBy: (input.recordedBy || '').trim() || actor?.fullName || 'Bursar Office',
    };

    const beforeSnap = { paidAmount: item.paidAmount, balance: item.balance };
    item.payments.push(payment);
    item.paidAmount += payAmount;
    item.balance = Math.max(0, item.amount - item.paidAmount);
    item.status = item.balance === 0 ? 'Paid' : 'Partial';

    this.appendFinanceAudit(
      tenantId,
      actor,
      'RECORD_IVL_PAYMENT',
      'IndependentVoteline',
      item.id,
      beforeSnap,
      { receiptNumber, amount: payAmount, balance: item.balance },
      ip
    );

    this.persist();
    this.pushNotification(
      tenantId,
      'fee',
      `Independent Voteline Payment: ${item.name}`,
      `${item.studentName} paid ${tenant.currency} ${payAmount.toLocaleString()} toward ${item.name} (${receiptNumber}).`,
      'fees'
    );
    this.syncTenant(tenantId, 'fee:independent-voteline-payment');
    return item;
  }

  deleteIndependentVoteline(
    tenantId: string,
    itemId: string,
    reason?: string,
    actor?: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>,
    ip?: string
  ): { deleted: boolean } {
    this.requireTenant(tenantId);
    const list = this.state.independentVotelines || [];
    const item = list.find((v) => v.id === itemId && v.tenantId === tenantId && !v.voided);
    if (!item) {
      throw new ConflictError('Independent voteline record not found.', 404);
    }
    this.assertTermOpen(tenantId, {
      termId: item.termId,
      termName: item.term,
      actionLabel: `Voiding independent voteline "${item.name}"`,
    });
    if (item.paidAmount > 0) {
      throw new ConflictError(
        `Cannot void independent voteline "${item.name}" after payments (${item.paidAmount}) have been posted.`,
        409
      );
    }
    const cleanReason = (reason || '').trim() || 'Voided by Bursar / Admin';
    item.voided = true;
    item.voidReason = cleanReason;
    item.voidedBy = actor?.fullName || actor?.email || 'Bursar / Admin';
    item.voidedAt = new Date().toISOString();

    this.appendFinanceAudit(
      tenantId,
      actor,
      'VOID_INDEPENDENT_VOTELINE',
      'IndependentVoteline',
      item.id,
      { name: item.name, amount: item.amount },
      { voided: true, voidReason: cleanReason },
      ip
    );
    this.persist();
    this.syncTenant(tenantId, 'fee:independent-voteline-deleted');
    return { deleted: true };
  }

  private hashWebhookSecret(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }

  verifyMpesaWebhookSecret(tenantSecret: string): Tenant | null {
    const raw = (tenantSecret || '').trim();
    if (!raw || !this.state.mpesaWebhookHashes) return null;
    const candidateHash = this.hashWebhookSecret(raw);
    const candidateBuf = Buffer.from(candidateHash, 'utf-8');
    for (const [tenantId, storedHash] of Object.entries(this.state.mpesaWebhookHashes)) {
      if (!storedHash) continue;
      const storedBuf = Buffer.from(storedHash, 'utf-8');
      if (candidateBuf.length === storedBuf.length && timingSafeEqual(candidateBuf, storedBuf)) {
        return this.state.tenants.find((t) => t.id === tenantId) || null;
      }
    }
    return null;
  }

  private normalizePaybillNumber(raw: string): string {
    const cleaned = (raw || '').replace(/\s+/g, '').trim();
    if (!/^\d{5,8}$/.test(cleaned)) {
      throw new ConflictError(
        'Enter a valid M-Pesa Paybill / Business Shortcode (5 to 8 numeric digits, e.g., 522522).',
        400
      );
    }
    return cleaned;
  }

  configureTenantMpesa(
    actor: Pick<TenantUser, 'role' | 'fullName' | 'email'>,
    tenantId: string,
    input: {
      enabled?: boolean;
      environment?: MpesaEnvironment;
      paybillNumber?: string;
      accountName?: string;
      accountReferenceFormat?: string;
      settlementBank?: string;
      regenerateSecret?: boolean;
    },
    ip?: string
  ): { tenant: Tenant; mpesaConfig: TenantMpesaConfig; webhookCallbackUrl?: string } {
    if (
      actor.role !== 'Admin' &&
      actor.role !== 'Super Admin' &&
      actor.role !== 'Developer' &&
      actor.role !== 'Bursar'
    ) {
      throw new ConflictError(
        'Forbidden: Only School Admin or Bursar accounts can configure M-Pesa Paybill integration.',
        403
      );
    }

    const tenant = this.requireTenant(tenantId);
    const paybillNumber = this.normalizePaybillNumber(input.paybillNumber || '');

    // Enforce global uniqueness across all tenants: Paybill is the differentiating routing key
    const conflictingTenant = this.state.tenants.find(
      (t) => t.id !== tenantId && t.mpesaConfig?.paybillNumber === paybillNumber
    );
    if (conflictingTenant) {
      throw new ConflictError(
        `Paybill "${paybillNumber}" is already assigned to ${conflictingTenant.name}. Each school tenant must register a unique Paybill to enforce payment separation.`,
        409
      );
    }

    const accountName = (input.accountName || '').trim() || `${tenant.name} Fees`;
    const accountReferenceFormat =
      (input.accountReferenceFormat || '').trim() || 'Student Code (e.g. ADM-2601)';
    const enabled = input.enabled !== undefined ? Boolean(input.enabled) : true;
    const environment: MpesaEnvironment =
      input.environment === 'Production' ? 'Production' : 'Sandbox';

    if (!this.state.mpesaWebhookHashes || typeof this.state.mpesaWebhookHashes !== 'object') {
      this.state.mpesaWebhookHashes = {};
    }

    let plainWebhookSecret: string | undefined;
    if (!this.state.mpesaWebhookHashes[tenantId] || input.regenerateSecret) {
      plainWebhookSecret = randomBytes(24).toString('hex');
      this.state.mpesaWebhookHashes[tenantId] = this.hashWebhookSecret(plainWebhookSecret);
    }

    const maskedCallbackPath = plainWebhookSecret
      ? `/api/mpesa/c2b-callback/••••${plainWebhookSecret.slice(-4)}`
      : tenant.mpesaConfig?.callbackUrl && !tenant.mpesaConfig.callbackUrl.includes('?paybill=')
      ? tenant.mpesaConfig.callbackUrl
      : `/api/mpesa/c2b-callback/••••${this.state.mpesaWebhookHashes[tenantId].slice(-4)}`;

    const config: TenantMpesaConfig = {
      enabled,
      environment,
      paybillNumber,
      accountName,
      accountReferenceFormat,
      hasWebhookSecret: true,
      callbackUrl: maskedCallbackPath,
      settlementBank: (input.settlementBank || '').trim() || undefined,
      updatedAt: new Date().toISOString(),
      updatedBy: actor.fullName || actor.email || actor.role,
    };

    const beforeMpesa = tenant.mpesaConfig
      ? { paybillNumber: tenant.mpesaConfig.paybillNumber, enabled: tenant.mpesaConfig.enabled }
      : null;
    tenant.mpesaConfig = config;
    this.appendFinanceAudit(
      tenantId,
      { id: actor.email, fullName: actor.fullName, email: actor.email, role: actor.role },
      'CONFIGURE_MPESA',
      'TenantMpesaConfig',
      tenantId,
      beforeMpesa,
      { paybillNumber: config.paybillNumber, enabled: config.enabled, environment: config.environment },
      ip
    );
    this.persist();
    this.pushNotification(
      tenantId,
      'fee',
      `M-Pesa Paybill ${enabled ? 'Configured' : 'Saved (Disabled)'}: ${paybillNumber}`,
      `${tenant.name} fee payments are isolated via Paybill ${paybillNumber} (${environment}).`,
      'fees'
    );
    this.syncTenant(tenantId, 'finance:mpesa-config-updated');

    return {
      tenant,
      mpesaConfig: config,
      ...(plainWebhookSecret
        ? { webhookCallbackUrl: `/api/mpesa/c2b-callback/${plainWebhookSecret}` }
        : {}),
    };
  }

  recordManualMpesaEntry(
    tenantId: string,
    actor: Pick<TenantUser, 'role' | 'fullName' | 'email'> & { id?: string },
    input: {
      paybillNumber?: string;
      accountReference?: string;
      amount?: number;
      msisdn?: string;
      mpesaReceipt?: string;
    },
    ip?: string
  ): {
    status: 'Unverified';
    transaction: MpesaTransactionLog;
    reconciliationLine: ReconciliationLine;
  } {
    const tenant = this.requireTenant(tenantId);
    const paybillNumber = this.normalizePaybillNumber(
      input.paybillNumber || tenant.mpesaConfig?.paybillNumber || ''
    );
    if (tenant.mpesaConfig?.paybillNumber && tenant.mpesaConfig.paybillNumber !== paybillNumber) {
      throw new ConflictError(
        `Tenant Isolation Blocked: Paybill "${paybillNumber}" does not match ${tenant.name}'s configured Paybill (${tenant.mpesaConfig.paybillNumber}).`,
        403
      );
    }

    const accountReference = (input.accountReference || '').trim();
    if (!accountReference) {
      throw new ConflictError('Account Reference (Student Code or Invoice #) is required.', 400);
    }

    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ConflictError('Enter a valid positive payment amount.', 400);
    }

    const msisdn = (input.msisdn || '').trim() || '254700000000';
    const mpesaReceipt =
      (input.mpesaReceipt || '').trim().toUpperCase() ||
      `MAN${randomBytes(4).toString('hex').toUpperCase()}`;

    if (!Array.isArray(this.state.mpesaTransactions)) {
      this.state.mpesaTransactions = [];
    }

    const duplicate = this.state.mpesaTransactions.some(
      (tx) =>
        tx.tenantId === tenantId &&
        tx.mpesaReceipt.trim().toUpperCase() === mpesaReceipt &&
        tx.status !== 'Rejected'
    );
    if (duplicate) {
      throw new ConflictError(
        `M-Pesa receipt "${mpesaReceipt}" has already been logged for ${tenant.name}.`,
        409
      );
    }

    const refLower = accountReference.toLowerCase();
    const matchedStudent = this.state.students.find(
      (s) =>
        s.tenantId === tenantId &&
        (s.studentCode.trim().toLowerCase() === refLower ||
          s.upi.trim().toLowerCase() === refLower)
    );
    const matchedInvoice = this.state.invoices.find(
      (i) =>
        i.tenantId === tenantId &&
        (i.invoiceNumber.trim().toLowerCase() === refLower ||
          (matchedStudent && i.studentId === matchedStudent.id && i.balance > 0))
    );

    const now = new Date().toISOString();
    const txLog: MpesaTransactionLog = {
      id: `mpesa-${randomUUID().slice(0, 8)}`,
      tenantId,
      paybillNumber,
      mpesaReceipt,
      msisdn,
      accountReference,
      amount: Math.round(amount),
      studentId: matchedStudent?.id || matchedInvoice?.studentId,
      studentName: matchedStudent?.fullName || matchedInvoice?.studentName,
      invoiceId: matchedInvoice?.id,
      invoiceNumber: matchedInvoice?.invoiceNumber,
      status: 'Unverified',
      channel: 'Manual Entry',
      note: `Manual M-Pesa entry by ${actor.fullName} — awaiting reconciliation verification.`,
      receivedAt: now,
    };

    const reconLine: ReconciliationLine = {
      id: `rec-${randomUUID().slice(0, 8)}`,
      tenantId,
      channel: 'M-Pesa',
      accountName: tenant.mpesaConfig?.accountName || `Paybill ${paybillNumber}`,
      transactionDate: now.slice(0, 10),
      statementRef: mpesaReceipt,
      narration: `Manual M-Pesa (${accountReference}) · MSISDN ${msisdn}`,
      direction: 'Credit',
      amount: Math.round(amount),
      status: 'Unmatched',
      notes: `Queued from manual M-Pesa entry by ${actor.fullName}. Verify on Reconciliation before posting.`,
      importedAt: now,
    };

    this.state.mpesaTransactions.unshift(txLog);
    if (!Array.isArray(this.state.reconciliationLines)) {
      this.state.reconciliationLines = [];
    }
    this.state.reconciliationLines.unshift(reconLine);
    this.appendFinanceAudit(
      tenantId,
      {
        id: actor.id || actor.email,
        fullName: actor.fullName,
        email: actor.email,
        role: actor.role,
      },
      'RECORD_MANUAL_MPESA',
      'MpesaTransactionLog',
      txLog.id,
      null,
      { mpesaReceipt, accountReference, amount: txLog.amount, status: 'Unverified' },
      ip
    );
    this.persist();
    this.syncTenant(tenantId, 'finance:mpesa-manual-unverified');

    return { status: 'Unverified', transaction: txLog, reconciliationLine: reconLine };
  }

  processMpesaPaybillPayment(input: {
    tenantId?: string;
    paybillNumber?: string;
    accountReference?: string;
    amount?: number;
    msisdn?: string;
    mpesaReceipt?: string;
    channel?: 'Daraja C2B Webhook';
    recordedBy?: string;
  }): {
    duplicate?: boolean;
    tenantId: string;
    tenantName: string;
    paybillNumber: string;
    invoice?: FeeInvoice;
    transaction: MpesaTransactionLog;
  } {
    const paybillInput = (input.paybillNumber || '').replace(/\s+/g, '').trim();
    let matchedTenant: Tenant | undefined;
    if (input.tenantId) {
      matchedTenant = this.requireTenant(input.tenantId);
      if (
        paybillInput &&
        matchedTenant.mpesaConfig?.paybillNumber &&
        matchedTenant.mpesaConfig.paybillNumber !== paybillInput
      ) {
        throw new ConflictError(
          `Paybill "${paybillInput}" does not match configured Paybill for ${matchedTenant.name}.`,
          403
        );
      }
    } else {
      const normalizedPaybill = this.normalizePaybillNumber(paybillInput);
      matchedTenant = this.state.tenants.find(
        (t) => t.mpesaConfig?.paybillNumber === normalizedPaybill
      );
    }

    if (!matchedTenant) {
      throw new ConflictError('No school tenant matched M-Pesa webhook configuration.', 404);
    }

    const paybillNumber =
      matchedTenant.mpesaConfig?.paybillNumber || this.normalizePaybillNumber(paybillInput);
    const accountReference = (input.accountReference || '').trim();
    const msisdn = (input.msisdn || '').trim() || '254700000000';
    const requestedAmount = Number(input.amount);
    const channel = input.channel || 'Daraja C2B Webhook';
    const mpesaReceipt = (input.mpesaReceipt || '').trim().toUpperCase();

    if (!mpesaReceipt) {
      throw new ConflictError('TransID / M-Pesa receipt code is required.', 400);
    }
    if (!accountReference) {
      throw new ConflictError('BillRefNumber / Account Reference is required.', 400);
    }
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      throw new ConflictError('TransAmount must be a positive number.', 400);
    }

    if (!Array.isArray(this.state.mpesaTransactions)) {
      this.state.mpesaTransactions = [];
    }

    // Deduplicate on TransID per tenant: never credit twice
    const existingSettled = this.state.mpesaTransactions.find(
      (tx) =>
        tx.tenantId === matchedTenant!.id &&
        tx.mpesaReceipt.trim().toUpperCase() === mpesaReceipt &&
        tx.status === 'Settled'
    );
    if (existingSettled) {
      const duplicateEntry: MpesaTransactionLog = {
        id: `mpesa-${randomUUID().slice(0, 8)}`,
        tenantId: matchedTenant.id,
        paybillNumber,
        mpesaReceipt,
        msisdn,
        accountReference,
        amount: Math.round(requestedAmount),
        studentId: existingSettled.studentId,
        studentName: existingSettled.studentName,
        invoiceId: existingSettled.invoiceId,
        invoiceNumber: existingSettled.invoiceNumber,
        status: 'Duplicate',
        channel,
        note: `Duplicate TransID ${mpesaReceipt} ignored — already settled on ${existingSettled.receivedAt}.`,
        receivedAt: new Date().toISOString(),
      };
      this.state.mpesaTransactions.unshift(duplicateEntry);
      this.persist();
      this.syncTenant(matchedTenant.id, 'finance:mpesa-duplicate');
      return {
        duplicate: true,
        tenantId: matchedTenant.id,
        tenantName: matchedTenant.name,
        paybillNumber,
        transaction: duplicateEntry,
      };
    }

    if (matchedTenant.status === 'Suspended') {
      throw new ConflictError(
        `School account "${matchedTenant.name}" is currently suspended. Payment cannot be settled.`,
        403
      );
    }
    if (!matchedTenant.mpesaConfig?.enabled) {
      throw new ConflictError(
        `M-Pesa Paybill "${paybillNumber}" is currently disabled for ${matchedTenant.name}.`,
        400
      );
    }

    const refLower = accountReference.toLowerCase();
    // Look up student & open invoice strictly within matchedTenant.id
    let targetInvoice = this.state.invoices.find(
      (i) =>
        i.tenantId === matchedTenant!.id &&
        i.balance > 0 &&
        (i.studentCode.trim().toLowerCase() === refLower ||
          i.invoiceNumber.trim().toLowerCase() === refLower)
    );

    if (!targetInvoice) {
      const matchedStudent = this.state.students.find(
        (s) =>
          s.tenantId === matchedTenant!.id &&
          (s.studentCode.trim().toLowerCase() === refLower ||
            s.upi.trim().toLowerCase() === refLower)
      );
      if (matchedStudent) {
        targetInvoice = this.state.invoices.find(
          (i) =>
            i.tenantId === matchedTenant!.id &&
            i.studentId === matchedStudent.id &&
            i.balance > 0
        );
      }
    }

    if (!targetInvoice) {
      const rejectedEntry: MpesaTransactionLog = {
        id: `mpesa-${randomUUID().slice(0, 8)}`,
        tenantId: matchedTenant.id,
        paybillNumber,
        mpesaReceipt,
        msisdn,
        accountReference,
        amount: Math.round(requestedAmount),
        status: 'Rejected',
        channel,
        note: `No open fee invoice matched "${accountReference}" within ${matchedTenant.name}.`,
        receivedAt: new Date().toISOString(),
      };
      this.state.mpesaTransactions.unshift(rejectedEntry);
      this.persist();
      this.syncTenant(matchedTenant.id, 'finance:mpesa-unmatched-ref');
      return {
        tenantId: matchedTenant.id,
        tenantName: matchedTenant.name,
        paybillNumber,
        transaction: rejectedEntry,
      };
    }

    const updatedInvoice = this.recordPayment(matchedTenant.id, targetInvoice.id, {
      amount: Math.round(requestedAmount),
      method: 'Mobile Money',
      reference: mpesaReceipt,
      recordedBy: input.recordedBy || `M-Pesa Paybill ${paybillNumber}`,
    });

    const latestPayment = updatedInvoice.payments[updatedInvoice.payments.length - 1];
    const settledAmount = latestPayment ? latestPayment.amount : Math.round(requestedAmount);
    const txLog: MpesaTransactionLog = {
      id: `mpesa-${randomUUID().slice(0, 8)}`,
      tenantId: matchedTenant.id,
      paybillNumber,
      mpesaReceipt,
      msisdn,
      accountReference,
      amount: settledAmount,
      studentId: updatedInvoice.studentId,
      studentName: updatedInvoice.studentName,
      invoiceId: updatedInvoice.id,
      invoiceNumber: updatedInvoice.invoiceNumber,
      status: 'Settled',
      channel,
      note: `Settled to ${matchedTenant.name} via Paybill ${paybillNumber}`,
      receivedAt: new Date().toISOString(),
    };
    this.state.mpesaTransactions.unshift(txLog);
    this.persist();
    this.syncTenant(matchedTenant.id, 'finance:mpesa-settled');

    return {
      tenantId: matchedTenant.id,
      tenantName: matchedTenant.name,
      paybillNumber,
      invoice: updatedInvoice,
      transaction: txLog,
    };
  }

  // Finance & Accounting: Expensing Vouchers & Supporting Documents
  private normalizeExpenseAttachments(
    raw:
      | Array<{
          fileName: string;
          mimeType?: string;
          fileSize?: number;
          docType?: ExpenseAttachmentType;
          dataUrl: string;
          uploadedBy?: string;
        }>
      | undefined,
    defaultUploader: string
  ): ExpenseAttachment[] {
    if (!Array.isArray(raw) || raw.length === 0) return [];
    if (raw.length > 6) {
      throw new ConflictError('Attach up to 6 supporting documents per expense voucher.', 400);
    }
    const validDocTypes = new Set<string>(EXPENSE_ATTACHMENT_TYPES);
    const MAX_DATA_URL_LEN = 3_500_000; // ~2.5MB decoded binary per file
    const attachments: ExpenseAttachment[] = [];

    for (const item of raw) {
      const fileName = (item?.fileName || '').trim();
      const dataUrl = typeof item?.dataUrl === 'string' ? item.dataUrl.trim() : '';
      if (!fileName || !dataUrl.startsWith('data:')) {
        throw new ConflictError('Supporting document requires a valid file name and uploaded file data.', 400);
      }
      if (dataUrl.length > MAX_DATA_URL_LEN) {
        throw new ConflictError(`Attachment "${fileName}" exceeds the 2.5 MB file size limit.`, 400);
      }
      const docType: ExpenseAttachmentType =
        item.docType && validDocTypes.has(item.docType)
          ? item.docType
          : 'Other Supporting Document';
      const mimeMatch = dataUrl.match(/^data:([^;]+);/);
      const mimeType = (item.mimeType || mimeMatch?.[1] || 'application/octet-stream').trim();
      const fileSize = Number.isFinite(Number(item.fileSize))
        ? Math.max(0, Math.round(Number(item.fileSize)))
        : Math.round((dataUrl.length * 3) / 4);

      attachments.push({
        id: `att-${randomUUID().slice(0, 8)}`,
        fileName,
        mimeType,
        fileSize,
        docType,
        dataUrl,
        uploadedAt: new Date().toISOString(),
        uploadedBy: (item.uploadedBy || '').trim() || defaultUploader,
      });
    }
    return attachments;
  }

  createExpense(
    tenantId: string,
    input: {
      title: string;
      category: ExpenseCategory;
      vendor: string;
      amount: number;
      paymentMethod: PaymentMethod;
      reference?: string;
      expenseDate?: string;
      status?: ExpenseStatus;
      recordedBy?: string;
      notes?: string;
      attachments?: Array<{
        fileName: string;
        mimeType?: string;
        fileSize?: number;
        docType?: ExpenseAttachmentType;
        dataUrl: string;
        uploadedBy?: string;
      }>;
    },
    actor?: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>,
    ip?: string
  ): SchoolExpense {
    const tenant = this.requireTenant(tenantId);
    const title = (input.title || '').trim();
    const vendor = (input.vendor || '').trim();
    const amount = this.parseStrictPositiveAmount(input.amount, 'Expense amount');

    if (!title) {
      throw new ConflictError('Expense description / title is required.', 400);
    }
    if (!vendor) {
      throw new ConflictError('Vendor / Payee name is required.', 400);
    }

    const validCategories = new Set<string>(EXPENSE_CATEGORIES);
    const category: ExpenseCategory = validCategories.has(input.category)
      ? input.category
      : 'Administration & Statutory';
    const validMethods = new Set<PaymentMethod>(['Bank Transfer', 'Card', 'Mobile Money', 'Cash']);
    const paymentMethod: PaymentMethod = validMethods.has(input.paymentMethod)
      ? input.paymentMethod
      : 'Bank Transfer';
    // Maker-checker: all new expenses start at Pending Approval
    const status: ExpenseStatus = 'Pending Approval';

    const voucherNumber = this.nextVoucherNumber(tenant);
    const expenseDate =
      input.expenseDate && !Number.isNaN(Date.parse(input.expenseDate))
        ? new Date(input.expenseDate).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);

    const recordedBy = (input.recordedBy || '').trim() || actor?.fullName || 'Bursar Office';
    const attachments = this.normalizeExpenseAttachments(input.attachments, recordedBy);

    const expense: SchoolExpense = {
      id: `exp-${randomUUID().slice(0, 8)}`,
      tenantId,
      voucherNumber,
      title,
      category,
      vendor,
      amount,
      paymentMethod,
      reference: (input.reference || '').trim() || voucherNumber,
      expenseDate,
      status,
      recordedBy,
      createdByUserId: actor?.id || 'system',
      notes: (input.notes || '').trim() || undefined,
      attachments,
      createdAt: new Date().toISOString(),
    };

    this.state.expenses.unshift(expense);
    this.appendFinanceAudit(
      tenantId,
      actor,
      'CREATE_EXPENSE',
      'SchoolExpense',
      expense.id,
      null,
      { voucherNumber, title, vendor, amount, status },
      ip
    );
    this.persist();
    this.pushNotification(
      tenantId,
      'fee',
      `Expense Voucher Recorded: ${voucherNumber}`,
      `${title} — ${tenant.currency} ${amount.toLocaleString()} (${status}) to ${vendor}.`,
      'fees'
    );
    this.syncTenant(tenantId, 'finance:expense-created');
    return expense;
  }

  addExpenseAttachment(
    tenantId: string,
    expenseId: string,
    input: {
      fileName: string;
      mimeType?: string;
      fileSize?: number;
      docType?: ExpenseAttachmentType;
      dataUrl: string;
      uploadedBy?: string;
    }
  ): SchoolExpense {
    this.requireTenant(tenantId);
    const expense = this.state.expenses.find(
      (e) => e.id === expenseId && e.tenantId === tenantId && !e.voided
    );
    if (!expense) {
      throw new ConflictError('Expense voucher not found in tenant.', 404);
    }
    if (expense.status === 'Paid') {
      throw new ConflictError('Paid expense vouchers are posted and immutable.', 409);
    }

    const existing = expense.attachments || [];
    if (existing.length >= 6) {
      throw new ConflictError('Maximum of 6 supporting documents reached for this voucher.', 400);
    }

    const [createdAttachment] = this.normalizeExpenseAttachments([input], expense.recordedBy);
    expense.attachments = [...existing, createdAttachment];
    this.persist();
    this.syncTenant(tenantId, 'finance:expense-attachment-added');
    return expense;
  }

  deleteExpenseAttachment(
    tenantId: string,
    expenseId: string,
    attachmentId: string
  ): SchoolExpense {
    this.requireTenant(tenantId);
    const expense = this.state.expenses.find(
      (e) => e.id === expenseId && e.tenantId === tenantId && !e.voided
    );
    if (!expense) {
      throw new ConflictError('Expense voucher not found in tenant.', 404);
    }
    if (expense.status === 'Paid') {
      throw new ConflictError('Paid expense vouchers are posted and immutable.', 409);
    }
    const existing = expense.attachments || [];
    const next = existing.filter((a) => a.id !== attachmentId);
    if (next.length === existing.length) {
      throw new ConflictError('Supporting document not found.', 404);
    }
    expense.attachments = next;
    this.persist();
    this.syncTenant(tenantId, 'finance:expense-attachment-deleted');
    return expense;
  }

  updateExpenseStatus(
    tenantId: string,
    expenseId: string,
    status: ExpenseStatus,
    actor?: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>,
    ip?: string
  ): SchoolExpense {
    this.requireTenant(tenantId);
    const validStatuses = new Set<ExpenseStatus>(['Pending Approval', 'Approved', 'Paid']);
    if (!validStatuses.has(status)) {
      throw new ConflictError(`Invalid expense status "${status}".`, 400);
    }

    const expense = this.state.expenses.find(
      (e) => e.id === expenseId && e.tenantId === tenantId && !e.voided
    );
    if (!expense) {
      throw new ConflictError('Expense voucher not found in tenant.', 404);
    }
    if (expense.reversed) {
      throw new ConflictError('Reversed expense vouchers cannot change status.', 409);
    }

    const rank: Record<ExpenseStatus, number> = {
      'Pending Approval': 0,
      Approved: 1,
      Paid: 2,
    };
    if (rank[status] <= rank[expense.status]) {
      throw new ConflictError(
        `Expense voucher ${expense.voucherNumber} cannot transition from "${expense.status}" to "${status}". Status transitions are strictly forward-only.`,
        409
      );
    }
    if (expense.status === 'Pending Approval' && status === 'Paid') {
      throw new ConflictError(
        `Expense voucher ${expense.voucherNumber} must be Approved before it can be marked Paid.`,
        409
      );
    }

    if (status === 'Approved') {
      if (
        actor &&
        actor.role !== 'Admin' &&
        actor.role !== 'Bursar' &&
        actor.role !== 'Super Admin' &&
        actor.role !== 'Developer'
      ) {
        throw new ConflictError('Only School Admin or a different Bursar can approve expenses.', 403);
      }
      if (expense.createdByUserId && actor?.id && expense.createdByUserId === actor.id) {
        throw new ConflictError(
          'Maker-checker violation: the user who created an expense voucher cannot approve it.',
          403
        );
      }
      expense.approvedByUserId = actor?.id;
      expense.approvedBy = actor?.fullName || actor?.email || 'Finance Approver';
      expense.approvedAt = new Date().toISOString();
    }

    const beforeSnap = { status: expense.status };
    expense.status = status;
    this.appendFinanceAudit(
      tenantId,
      actor,
      'UPDATE_EXPENSE_STATUS',
      'SchoolExpense',
      expense.id,
      beforeSnap,
      { voucherNumber: expense.voucherNumber, status, approvedBy: expense.approvedBy },
      ip
    );
    this.persist();
    this.syncTenant(tenantId, 'finance:expense-updated');
    return expense;
  }

  deleteExpense(
    tenantId: string,
    expenseId: string,
    reason?: string,
    actor?: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>,
    ip?: string
  ): { deleted: boolean } {
    this.requireTenant(tenantId);
    const expense = this.state.expenses.find(
      (e) => e.id === expenseId && e.tenantId === tenantId && !e.voided
    );
    if (!expense) {
      throw new ConflictError('Expense voucher not found in tenant.', 404);
    }
    if (expense.status === 'Paid') {
      throw new ConflictError(
        `Paid expense voucher ${expense.voucherNumber} cannot be deleted. Reverse it instead with an audit reason.`,
        409
      );
    }

    const cleanReason = (reason || '').trim() || 'Voided prior to payment';
    expense.voided = true;
    expense.voidReason = cleanReason;
    expense.voidedBy = actor?.fullName || actor?.email || 'Finance Office';
    expense.voidedAt = new Date().toISOString();

    this.appendFinanceAudit(
      tenantId,
      actor,
      'VOID_EXPENSE',
      'SchoolExpense',
      expense.id,
      { voucherNumber: expense.voucherNumber, status: expense.status, amount: expense.amount },
      { voided: true, voidReason: cleanReason },
      ip
    );
    this.persist();
    this.syncTenant(tenantId, 'finance:expense-deleted');
    return { deleted: true };
  }

  reverseExpense(
    tenantId: string,
    expenseId: string,
    reason: string,
    actor: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>,
    ip?: string
  ): SchoolExpense {
    this.requireTenant(tenantId);
    const cleanReason = (reason || '').trim();
    if (!cleanReason) {
      throw new ConflictError('Provide a reversal reason before reversing a paid expense.', 400);
    }
    const expense = this.state.expenses.find(
      (e) => e.id === expenseId && e.tenantId === tenantId && !e.voided
    );
    if (!expense) {
      throw new ConflictError('Expense voucher not found in tenant.', 404);
    }
    if (expense.status !== 'Paid') {
      throw new ConflictError('Only Paid expense vouchers require reversal; void unpaid vouchers instead.', 400);
    }
    if (expense.reversed) {
      throw new ConflictError(`Expense voucher ${expense.voucherNumber} has already been reversed.`, 409);
    }

    expense.reversed = true;
    expense.reversalReason = cleanReason;
    expense.reversedBy = actor.fullName || actor.email;
    expense.reversedAt = new Date().toISOString();

    this.appendFinanceAudit(
      tenantId,
      actor,
      'REVERSE_EXPENSE',
      'SchoolExpense',
      expense.id,
      { voucherNumber: expense.voucherNumber, status: expense.status, amount: expense.amount },
      { reversed: true, reversalReason: cleanReason },
      ip
    );
    this.persist();
    this.syncTenant(tenantId, 'finance:expense-reversed');
    return expense;
  }

  // Finance Controls: eTIMS Receipt Verification
  verifyEtimsReceipt(
    tenantId: string,
    input: {
      expenseId?: string;
      supplierName: string;
      supplierKraPin: string;
      cuInvoiceNumber: string;
      receiptDate?: string;
      taxableAmount?: number;
      vatAmount?: number;
      totalAmount: number;
      exemptVat?: boolean;
      checkedBy?: string;
    },
    actor?: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>,
    ip?: string
  ): EtimsVerificationRecord {
    const tenant = this.requireTenant(tenantId);
    const supplierName = (input.supplierName || '').trim();
    const supplierKraPin = (input.supplierKraPin || '').trim().toUpperCase();
    const cuInvoiceNumber = (input.cuInvoiceNumber || '').trim().toUpperCase();
    const totalAmount = this.parseStrictPositiveAmount(input.totalAmount, 'Receipt total amount');

    if (!supplierName) {
      throw new ConflictError('Supplier name is required for eTIMS check.', 400);
    }
    if (!/^[AP]\d{9}[A-Z]$/.test(supplierKraPin)) {
      throw new ConflictError(
        'Invalid KRA PIN format. Expected 11 characters such as P051482910K or A001234567Z.',
        400
      );
    }
    if (cuInvoiceNumber.length < 8) {
      throw new ConflictError('Enter a valid eTIMS CU Invoice / Control Unit serial number.', 400);
    }

    const linkedExpense = input.expenseId
      ? this.state.expenses.find((e) => e.id === input.expenseId && e.tenantId === tenantId && !e.voided)
      : undefined;

    const vatAmount = input.exemptVat
      ? 0
      : Number.isFinite(Number(input.vatAmount))
      ? Math.max(0, Math.round(Number(input.vatAmount)))
      : totalAmount - Math.round(totalAmount / 1.16);
    const taxableAmount = Number.isFinite(Number(input.taxableAmount))
      ? Math.max(0, Math.round(Number(input.taxableAmount)))
      : Math.max(0, totalAmount - vatAmount);

    let status: EtimsVerificationStatus = input.exemptVat ? 'Exempt' : 'Checked manually';
    let verificationNotes = input.exemptVat
      ? 'Zero-rated / VAT-exempt KRA eTIMS tax invoice checked manually.'
      : 'Supplier KRA PIN format, CU Invoice serial, and 16% VAT breakdown checked manually.';

    if (linkedExpense && Math.abs(linkedExpense.amount - totalAmount) > 5) {
      status = 'Mismatch';
      verificationNotes = `Amount variance detected: Voucher ${linkedExpense.voucherNumber} is ${tenant.currency} ${linkedExpense.amount.toLocaleString()} vs eTIMS receipt ${tenant.currency} ${totalAmount.toLocaleString()}.`;
    }

    const record: EtimsVerificationRecord = {
      id: `etims-${randomUUID().slice(0, 8)}`,
      tenantId,
      expenseId: linkedExpense?.id,
      voucherNumber: linkedExpense?.voucherNumber,
      supplierName,
      supplierKraPin,
      cuInvoiceNumber,
      receiptDate:
        input.receiptDate && !Number.isNaN(Date.parse(input.receiptDate))
          ? new Date(input.receiptDate).toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10),
      taxableAmount,
      vatAmount,
      totalAmount,
      status,
      verificationNotes,
      checkedBy: (input.checkedBy || '').trim() || actor?.fullName || 'Bursar Compliance Desk',
      checkedAt: new Date().toISOString(),
    };

    if (linkedExpense) {
      linkedExpense.etimsCuNumber = cuInvoiceNumber;
      linkedExpense.supplierKraPin = supplierKraPin;
      linkedExpense.etimsStatus = status;
    }

    if (!Array.isArray(this.state.etimsChecks)) this.state.etimsChecks = [];
    this.state.etimsChecks.unshift(record);
    this.appendFinanceAudit(
      tenantId,
      actor,
      'CHECK_ETIMS_RECEIPT',
      'EtimsVerificationRecord',
      record.id,
      null,
      { supplierKraPin, cuInvoiceNumber, totalAmount, status },
      ip
    );
    this.persist();
    this.syncTenant(tenantId, 'finance:etims-verified');
    return record;
  }

  deleteEtimsCheck(
    tenantId: string,
    checkId: string,
    reason?: string,
    actor?: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>,
    ip?: string
  ): { deleted: boolean } {
    this.requireTenant(tenantId);
    const check = (this.state.etimsChecks || []).find(
      (c) => c.id === checkId && c.tenantId === tenantId && !c.voided
    );
    if (!check) {
      throw new ConflictError('eTIMS verification record not found.', 404);
    }
    const cleanReason = (reason || '').trim() || 'Voided eTIMS check record';
    check.voided = true;
    check.voidReason = cleanReason;
    check.voidedBy = actor?.fullName || actor?.email || 'Bursar Compliance Desk';
    check.voidedAt = new Date().toISOString();

    this.appendFinanceAudit(
      tenantId,
      actor,
      'VOID_ETIMS_CHECK',
      'EtimsVerificationRecord',
      check.id,
      { cuInvoiceNumber: check.cuInvoiceNumber, status: check.status },
      { voided: true, voidReason: cleanReason },
      ip
    );
    this.persist();
    this.syncTenant(tenantId, 'finance:etims-deleted');
    return { deleted: true };
  }

  // Finance Controls: M-Pesa & Bank Statement Reconciliation
  private matchStatementLineWithTenantLedger(
    tenantId: string,
    line: {
      direction: 'Credit' | 'Debit';
      statementRef: string;
      amount: number;
      narration: string;
    }
  ): {
    status: ReconciliationStatus;
    matchedType?: 'Fee Payment' | 'Expense Voucher';
    matchedRecordId?: string;
    matchedLabel?: string;
  } {
    const refNorm = line.statementRef.trim().toLowerCase();
    const narrNorm = line.narration.trim().toLowerCase();

    if (line.direction === 'Credit') {
      const invoices = this.state.invoices.filter((i) => i.tenantId === tenantId);
      for (const inv of invoices) {
        for (const pay of inv.payments || []) {
          if (pay.voided || pay.isReversalEntry) continue;
          const payRef = (pay.reference || '').trim().toLowerCase();
          const recNo = pay.receiptNumber.trim().toLowerCase();
          const refHit =
            (payRef && (payRef === refNorm || narrNorm.includes(payRef))) ||
            (recNo && (recNo === refNorm || narrNorm.includes(recNo)));
          if (refHit && pay.amount === line.amount) {
            return {
              status: 'Matched',
              matchedType: 'Fee Payment',
              matchedRecordId: pay.id,
              matchedLabel: `${pay.receiptNumber} · ${inv.studentName} (${inv.invoiceNumber})`,
            };
          }
          if (refHit && pay.amount !== line.amount) {
            return {
              status: 'Discrepancy',
              matchedType: 'Fee Payment',
              matchedRecordId: pay.id,
              matchedLabel: `${pay.receiptNumber} · Amount mismatch`,
            };
          }
        }
      }
      for (const inv of invoices) {
        const pay = (inv.payments || []).find(
          (p) => !p.voided && !p.isReversalEntry && p.amount === line.amount
        );
        if (pay) {
          return {
            status: 'Matched',
            matchedType: 'Fee Payment',
            matchedRecordId: pay.id,
            matchedLabel: `${pay.receiptNumber} · ${inv.studentName} (Amount match)`,
          };
        }
      }
      return { status: 'Unmatched' };
    }

    const expenses = this.state.expenses.filter((e) => e.tenantId === tenantId && !e.voided && !e.reversed);
    for (const exp of expenses) {
      const expRef = (exp.reference || '').trim().toLowerCase();
      const vNo = exp.voucherNumber.trim().toLowerCase();
      const refHit =
        (expRef && (expRef === refNorm || narrNorm.includes(expRef))) ||
        (vNo && (vNo === refNorm || narrNorm.includes(vNo)));
      if (refHit && exp.amount === line.amount) {
        return {
          status: 'Matched',
          matchedType: 'Expense Voucher',
          matchedRecordId: exp.id,
          matchedLabel: `${exp.voucherNumber} · ${exp.vendor}`,
        };
      }
      if (refHit && exp.amount !== line.amount) {
        return {
          status: 'Discrepancy',
          matchedType: 'Expense Voucher',
          matchedRecordId: exp.id,
          matchedLabel: `${exp.voucherNumber} · Amount mismatch`,
        };
      }
    }
    const exactExp = expenses.find((e) => e.status === 'Paid' && e.amount === line.amount);
    if (exactExp) {
      return {
        status: 'Matched',
        matchedType: 'Expense Voucher',
        matchedRecordId: exactExp.id,
        matchedLabel: `${exactExp.voucherNumber} · ${exactExp.vendor} (Amount match)`,
      };
    }
    return { status: 'Unmatched' };
  }

  importReconciliationLines(
    tenantId: string,
    lines: Array<{
      channel: ReconciliationChannel;
      accountName?: string;
      transactionDate?: string;
      statementRef: string;
      narration: string;
      direction: 'Credit' | 'Debit';
      amount: number;
      notes?: string;
    }>,
    actor?: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>,
    ip?: string
  ): { imported: ReconciliationLine[]; matchedCount: number; unmatchedCount: number } {
    this.requireTenant(tenantId);
    if (!Array.isArray(lines) || lines.length === 0) {
      throw new ConflictError('Provide at least one statement line to import.', 400);
    }

    if (!Array.isArray(this.state.reconciliationLines)) {
      this.state.reconciliationLines = [];
    }

    const imported: ReconciliationLine[] = [];
    let matchedCount = 0;
    let unmatchedCount = 0;

    for (const raw of lines) {
      const statementRef = (raw.statementRef || '').trim();
      const narration = (raw.narration || '').trim() || statementRef;
      const amount = this.parseStrictPositiveAmount(raw.amount, 'Statement line amount');
      if (!statementRef) {
        throw new ConflictError('Each statement line requires a reference code.', 400);
      }
      const channel: ReconciliationChannel = raw.channel === 'M-Pesa' ? 'M-Pesa' : 'Bank';
      const direction: 'Credit' | 'Debit' = raw.direction === 'Debit' ? 'Debit' : 'Credit';
      const transactionDate =
        raw.transactionDate && !Number.isNaN(Date.parse(raw.transactionDate))
          ? new Date(raw.transactionDate).toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10);

      const matchResult = this.matchStatementLineWithTenantLedger(tenantId, {
        direction,
        statementRef,
        amount,
        narration,
      });
      if (matchResult.status === 'Matched') matchedCount += 1;
      else unmatchedCount += 1;

      const created: ReconciliationLine = {
        id: `rec-${randomUUID().slice(0, 8)}`,
        tenantId,
        channel,
        accountName:
          (raw.accountName || '').trim() ||
          (channel === 'M-Pesa' ? 'Paybill Settlement Account' : 'Main Bank Operating Account'),
        transactionDate,
        statementRef,
        narration,
        direction,
        amount,
        status: matchResult.status,
        matchedType: matchResult.matchedType,
        matchedRecordId: matchResult.matchedRecordId,
        matchedLabel: matchResult.matchedLabel,
        notes: (raw.notes || '').trim() || undefined,
        importedAt: new Date().toISOString(),
      };
      this.state.reconciliationLines.unshift(created);
      imported.push(created);
    }

    this.appendFinanceAudit(
      tenantId,
      actor,
      'IMPORT_RECONCILIATION',
      'ReconciliationLine',
      imported[0]?.id || 'batch',
      null,
      { importedCount: imported.length, matchedCount, unmatchedCount },
      ip
    );
    this.persist();
    this.syncTenant(tenantId, 'finance:reconciliation-imported');
    return { imported, matchedCount, unmatchedCount };
  }

  autoMatchReconciliation(tenantId: string): { matchedCount: number } {
    this.requireTenant(tenantId);
    let matchedCount = 0;
    for (const line of this.state.reconciliationLines || []) {
      if (line.tenantId !== tenantId || line.voided || line.status === 'Matched') continue;
      const res = this.matchStatementLineWithTenantLedger(tenantId, line);
      line.status = res.status;
      line.matchedType = res.matchedType;
      line.matchedRecordId = res.matchedRecordId;
      line.matchedLabel = res.matchedLabel;
      if (res.status === 'Matched') matchedCount += 1;
    }
    this.persist();
    this.syncTenant(tenantId, 'finance:reconciliation-automatch');
    return { matchedCount };
  }

  updateReconciliationLine(
    tenantId: string,
    lineId: string,
    patch: {
      status: ReconciliationStatus;
      matchedType?: 'Fee Payment' | 'Expense Voucher';
      matchedRecordId?: string;
      matchedLabel?: string;
      notes?: string;
    },
    actor?: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>,
    ip?: string
  ): ReconciliationLine {
    this.requireTenant(tenantId);
    const valid = new Set<ReconciliationStatus>(['Matched', 'Unmatched', 'Discrepancy']);
    if (!valid.has(patch.status)) {
      throw new ConflictError(`Invalid reconciliation status "${patch.status}".`, 400);
    }
    const line = (this.state.reconciliationLines || []).find(
      (r) => r.id === lineId && r.tenantId === tenantId && !r.voided
    );
    if (!line) {
      throw new ConflictError('Reconciliation statement line not found.', 404);
    }
    const beforeSnap = { status: line.status, matchedRecordId: line.matchedRecordId };
    line.status = patch.status;
    if (patch.status === 'Unmatched') {
      line.matchedType = undefined;
      line.matchedRecordId = undefined;
      line.matchedLabel = undefined;
    } else {
      if (patch.matchedType !== undefined) line.matchedType = patch.matchedType;
      if (patch.matchedRecordId !== undefined) line.matchedRecordId = patch.matchedRecordId;
      if (patch.matchedLabel !== undefined) line.matchedLabel = patch.matchedLabel.trim() || undefined;
    }
    if (patch.notes !== undefined) line.notes = patch.notes.trim() || undefined;

    this.appendFinanceAudit(
      tenantId,
      actor,
      'UPDATE_RECONCILIATION',
      'ReconciliationLine',
      line.id,
      beforeSnap,
      { status: line.status, matchedRecordId: line.matchedRecordId },
      ip
    );
    this.persist();
    this.syncTenant(tenantId, 'finance:reconciliation-updated');
    return line;
  }

  deleteReconciliationLine(
    tenantId: string,
    lineId: string,
    reason?: string,
    actor?: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>,
    ip?: string
  ): { deleted: boolean } {
    this.requireTenant(tenantId);
    const line = (this.state.reconciliationLines || []).find(
      (r) => r.id === lineId && r.tenantId === tenantId && !r.voided
    );
    if (!line) {
      throw new ConflictError('Reconciliation statement line not found.', 404);
    }
    const cleanReason = (reason || '').trim() || 'Voided statement line';
    line.voided = true;
    line.voidReason = cleanReason;
    line.voidedBy = actor?.fullName || actor?.email || 'Bursar Office';
    line.voidedAt = new Date().toISOString();

    this.appendFinanceAudit(
      tenantId,
      actor,
      'VOID_RECONCILIATION',
      'ReconciliationLine',
      line.id,
      { statementRef: line.statementRef, amount: line.amount },
      { voided: true, voidReason: cleanReason },
      ip
    );
    this.persist();
    this.syncTenant(tenantId, 'finance:reconciliation-deleted');
    return { deleted: true };
  }

  // Finance Controls: Payroll & Statutory Deductions
  generatePayrollRun(
    tenantId: string,
    payPeriod: string,
    actor?: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>,
    ip?: string
  ): PayrollEntry[] {
    const tenant = this.requireTenant(tenantId);
    const period = (payPeriod || '').trim() || new Date().toISOString().slice(0, 7);
    if (!Array.isArray(this.state.payrollEntries)) this.state.payrollEntries = [];

    const existingStaffIds = new Set(
      this.state.payrollEntries
        .filter((p) => p.tenantId === tenantId && p.payPeriod === period && !p.voided && !p.reversed)
        .map((p) => p.staffId)
    );

    const defaults = buildDefaultPayrollForTenant(
      tenant,
      period,
      this.state.statutoryRateSchedules
    );
    const created: PayrollEntry[] = [];
    for (const entry of defaults) {
      if (!existingStaffIds.has(entry.staffId)) {
        const nextEntry: PayrollEntry = {
          ...entry,
          id: `payr-${randomUUID().slice(0, 8)}`,
          status: 'Draft',
          createdByUserId: actor?.id || 'system',
          approvedByUserId: undefined,
          approvedBy: undefined,
          approvedAt: undefined,
          updatedAt: new Date().toISOString(),
        };
        this.state.payrollEntries.push(nextEntry);
        created.push(nextEntry);
      }
    }

    if (created.length > 0) {
      this.appendFinanceAudit(
        tenantId,
        actor,
        'GENERATE_PAYROLL_RUN',
        'PayrollEntry',
        period,
        null,
        { payPeriod: period, generatedCount: created.length },
        ip
      );
    }
    this.persist();
    this.syncTenant(tenantId, 'finance:payroll-generated');
    return this.state.payrollEntries.filter(
      (p) => p.tenantId === tenantId && p.payPeriod === period && !p.voided
    );
  }

  upsertPayrollEntry(
    tenantId: string,
    input: {
      id?: string;
      payPeriod: string;
      staffId?: string;
      staffName: string;
      staffCategory: StaffCategory;
      designation: string;
      basicSalary: number;
      allowances: number;
      saccoOrLoan?: number;
      autoComputeStatutory?: boolean;
      paye?: number;
      nssf?: number;
      shif?: number;
      housingLevy?: number;
      status?: PayrollStatus;
    },
    actor?: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>,
    ip?: string
  ): PayrollEntry {
    const tenant = this.requireTenant(tenantId);
    const staffName = (input.staffName || '').trim();
    if (!staffName) {
      throw new ConflictError('Staff full name is required for payroll entry.', 400);
    }
    const rawBasic = Number(input.basicSalary);
    const rawAllowances = Number(input.allowances ?? 0);
    const rawSacco = Number(input.saccoOrLoan ?? 0);
    if (!Number.isFinite(rawBasic) || rawBasic < 0) {
      throw new ConflictError('Basic salary must be a valid non-negative number.', 400);
    }
    if (!Number.isFinite(rawAllowances) || rawAllowances < 0) {
      throw new ConflictError('Allowances must be a valid non-negative number.', 400);
    }
    if (!Number.isFinite(rawSacco) || rawSacco < 0) {
      throw new ConflictError('SACCO / loan deduction must be a valid non-negative number.', 400);
    }

    const basicSalary = Math.round(rawBasic);
    const allowances = Math.round(rawAllowances);
    const saccoOrLoan = Math.round(rawSacco);
    const grossPay = basicSalary + allowances;
    if (grossPay <= 0) {
      throw new ConflictError('Gross salary must be greater than zero.', 400);
    }

    const payPeriod = (input.payPeriod || '').trim() || new Date().toISOString().slice(0, 7);
    const statutory = computeStatutoryDeductions(
      grossPay,
      tenant.currency,
      this.state.statutoryRateSchedules,
      payPeriod
    );
    const useAuto = input.autoComputeStatutory !== false;
    const paye = useAuto
      ? statutory.paye
      : Math.max(0, Math.round(Number(input.paye ?? statutory.paye)));
    const nssf = useAuto
      ? statutory.nssf
      : Math.max(0, Math.round(Number(input.nssf ?? statutory.nssf)));
    const shif = useAuto
      ? statutory.shif
      : Math.max(0, Math.round(Number(input.shif ?? statutory.shif)));
    const housingLevy = useAuto
      ? statutory.housingLevy
      : Math.max(0, Math.round(Number(input.housingLevy ?? statutory.housingLevy)));

    const totalDeductions = paye + nssf + shif + housingLevy + saccoOrLoan;
    const netPay = Math.max(0, grossPay - totalDeductions);
    const employerNssf = statutory.employerNssf;
    const employerHousingLevy = statutory.employerHousingLevy;
    const employerNita = statutory.employerNita;
    const totalEmployerCost = grossPay + employerNssf + employerHousingLevy + employerNita;

    if (!Array.isArray(this.state.payrollEntries)) this.state.payrollEntries = [];
    const existing = input.id
      ? this.state.payrollEntries.find(
          (p) => p.id === input.id && p.tenantId === tenantId && !p.voided
        )
      : undefined;

    if (existing) {
      if (existing.status === 'Disbursed' || existing.reversed) {
        throw new ConflictError(
          'Disbursed or reversed payroll entries are posted and immutable. Reverse it instead with an audit reason.',
          409
        );
      }
      const beforeSnap = {
        basicSalary: existing.basicSalary,
        allowances: existing.allowances,
        netPay: existing.netPay,
        status: existing.status,
      };
      existing.payPeriod = payPeriod;
      existing.staffName = staffName;
      existing.staffCategory = input.staffCategory === 'Non-Teaching' ? 'Non-Teaching' : 'Teaching';
      existing.designation = (input.designation || '').trim() || existing.designation;
      existing.basicSalary = basicSalary;
      existing.allowances = allowances;
      existing.grossPay = grossPay;
      existing.paye = paye;
      existing.nssf = nssf;
      existing.shif = shif;
      existing.housingLevy = housingLevy;
      existing.saccoOrLoan = saccoOrLoan;
      existing.totalDeductions = totalDeductions;
      existing.netPay = netPay;
      existing.employerNssf = employerNssf;
      existing.employerHousingLevy = employerHousingLevy;
      existing.employerNita = employerNita;
      existing.totalEmployerCost = totalEmployerCost;
      existing.statutoryScheduleId = statutory.scheduleId;
      // Editing payroll figures resets approval for maker-checker verification
      existing.status = 'Draft';
      existing.createdByUserId = actor?.id || existing.createdByUserId || 'system';
      existing.approvedByUserId = undefined;
      existing.approvedBy = undefined;
      existing.approvedAt = undefined;
      existing.updatedAt = new Date().toISOString();

      this.appendFinanceAudit(
        tenantId,
        actor,
        'UPDATE_PAYROLL_ENTRY',
        'PayrollEntry',
        existing.id,
        beforeSnap,
        {
          staffName,
          grossPay,
          netPay,
          employerNssf,
          employerHousingLevy,
          employerNita,
          status: existing.status,
        },
        ip
      );
      this.persist();
      this.syncTenant(tenantId, 'finance:payroll-updated');
      return existing;
    }

    const created: PayrollEntry = {
      id: `payr-${randomUUID().slice(0, 8)}`,
      tenantId,
      payPeriod,
      staffId: (input.staffId || '').trim() || `stf-${randomUUID().slice(0, 6)}`,
      staffName,
      staffCategory: input.staffCategory === 'Non-Teaching' ? 'Non-Teaching' : 'Teaching',
      designation: (input.designation || '').trim() || 'Staff Member',
      basicSalary,
      allowances,
      grossPay,
      paye,
      nssf,
      shif,
      housingLevy,
      saccoOrLoan,
      totalDeductions,
      netPay,
      employerNssf,
      employerHousingLevy,
      employerNita,
      totalEmployerCost,
      statutoryScheduleId: statutory.scheduleId,
      // Maker-checker: all newly created payroll entries start in Draft
      status: 'Draft',
      createdByUserId: actor?.id || 'system',
      updatedAt: new Date().toISOString(),
    };

    this.state.payrollEntries.push(created);
    this.appendFinanceAudit(
      tenantId,
      actor,
      'CREATE_PAYROLL_ENTRY',
      'PayrollEntry',
      created.id,
      null,
      {
        staffName,
        payPeriod,
        grossPay,
        netPay,
        employerNssf,
        employerHousingLevy,
        employerNita,
        status: created.status,
      },
      ip
    );
    this.persist();
    this.syncTenant(tenantId, 'finance:payroll-created');
    return created;
  }

  updatePayrollStatus(
    tenantId: string,
    entryId: string,
    status: PayrollStatus,
    actor?: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>,
    ip?: string
  ): PayrollEntry {
    this.requireTenant(tenantId);
    const valid = new Set<PayrollStatus>(['Draft', 'Approved', 'Disbursed']);
    if (!valid.has(status)) {
      throw new ConflictError(`Invalid payroll status "${status}".`, 400);
    }
    const entry = (this.state.payrollEntries || []).find(
      (p) => p.id === entryId && p.tenantId === tenantId && !p.voided
    );
    if (!entry) {
      throw new ConflictError('Payroll entry not found in tenant.', 404);
    }
    if (entry.reversed) {
      throw new ConflictError('Reversed payroll entries cannot change status.', 409);
    }

    const rank: Record<PayrollStatus, number> = {
      Draft: 0,
      Approved: 1,
      Disbursed: 2,
    };
    if (rank[status] <= rank[entry.status]) {
      throw new ConflictError(
        `Payroll entry for ${entry.staffName} cannot transition from "${entry.status}" to "${status}". Status transitions are strictly forward-only.`,
        409
      );
    }
    if (entry.status === 'Draft' && status === 'Disbursed') {
      throw new ConflictError(
        `Payroll entry for ${entry.staffName} must be Approved before it can be Disbursed.`,
        409
      );
    }

    if (status === 'Approved') {
      if (
        actor &&
        actor.role !== 'Admin' &&
        actor.role !== 'Bursar' &&
        actor.role !== 'Super Admin' &&
        actor.role !== 'Developer'
      ) {
        throw new ConflictError('Only School Admin or a different Bursar can approve payroll.', 403);
      }
      if (entry.createdByUserId && actor?.id && entry.createdByUserId === actor.id) {
        throw new ConflictError(
          'Maker-checker violation: the user who prepared a payroll entry cannot approve it.',
          403
        );
      }
      entry.approvedByUserId = actor?.id;
      entry.approvedBy = actor?.fullName || actor?.email || 'Finance Approver';
      entry.approvedAt = new Date().toISOString();
    }

    const beforeSnap = { status: entry.status };
    entry.status = status;
    entry.updatedAt = new Date().toISOString();

    this.appendFinanceAudit(
      tenantId,
      actor,
      'UPDATE_PAYROLL_STATUS',
      'PayrollEntry',
      entry.id,
      beforeSnap,
      { staffName: entry.staffName, payPeriod: entry.payPeriod, status, approvedBy: entry.approvedBy },
      ip
    );
    this.persist();
    this.syncTenant(tenantId, 'finance:payroll-status');
    return entry;
  }

  deletePayrollEntry(
    tenantId: string,
    entryId: string,
    reason?: string,
    actor?: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>,
    ip?: string
  ): { deleted: boolean } {
    this.requireTenant(tenantId);
    const entry = (this.state.payrollEntries || []).find(
      (p) => p.id === entryId && p.tenantId === tenantId && !p.voided
    );
    if (!entry) {
      throw new ConflictError('Payroll entry not found in tenant.', 404);
    }
    if (entry.status === 'Disbursed') {
      throw new ConflictError(
        `Disbursed payroll entry for ${entry.staffName} cannot be deleted. Reverse it instead with an audit reason.`,
        409
      );
    }

    const cleanReason = (reason || '').trim() || 'Voided before disbursement';
    entry.voided = true;
    entry.voidReason = cleanReason;
    entry.voidedBy = actor?.fullName || actor?.email || 'Finance Office';
    entry.voidedAt = new Date().toISOString();
    entry.updatedAt = entry.voidedAt;

    this.appendFinanceAudit(
      tenantId,
      actor,
      'VOID_PAYROLL_ENTRY',
      'PayrollEntry',
      entry.id,
      { staffName: entry.staffName, status: entry.status, netPay: entry.netPay },
      { voided: true, voidReason: cleanReason },
      ip
    );
    this.persist();
    this.syncTenant(tenantId, 'finance:payroll-deleted');
    return { deleted: true };
  }

  reversePayrollEntry(
    tenantId: string,
    entryId: string,
    reason: string,
    actor: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>,
    ip?: string
  ): PayrollEntry {
    this.requireTenant(tenantId);
    const cleanReason = (reason || '').trim();
    if (!cleanReason) {
      throw new ConflictError('Provide a reversal reason before reversing a disbursed payroll entry.', 400);
    }
    const entry = (this.state.payrollEntries || []).find(
      (p) => p.id === entryId && p.tenantId === tenantId && !p.voided
    );
    if (!entry) {
      throw new ConflictError('Payroll entry not found in tenant.', 404);
    }
    if (entry.status !== 'Disbursed') {
      throw new ConflictError(
        'Only Disbursed payroll entries require reversal; void non-disbursed entries instead.',
        400
      );
    }
    if (entry.reversed) {
      throw new ConflictError(
        `Payroll entry for ${entry.staffName} (${entry.payPeriod}) has already been reversed.`,
        409
      );
    }

    const now = new Date().toISOString();
    entry.reversed = true;
    entry.reversalReason = cleanReason;
    entry.reversedBy = actor.fullName || actor.email;
    entry.reversedAt = now;
    entry.updatedAt = now;

    this.appendFinanceAudit(
      tenantId,
      actor,
      'REVERSE_PAYROLL_ENTRY',
      'PayrollEntry',
      entry.id,
      { staffName: entry.staffName, payPeriod: entry.payPeriod, status: entry.status, netPay: entry.netPay },
      { reversed: true, reversalReason: cleanReason },
      ip
    );
    this.persist();
    this.syncTenant(tenantId, 'finance:payroll-reversed');
    return entry;
  }

  // Finance Controls: Departmental Budget Allocations & Tracking
  upsertBudgetAllocation(
    tenantId: string,
    input: {
      category: ExpenseCategory;
      allocatedAmount: number;
      fiscalYear?: string;
      term?: string;
      notes?: string;
    },
    actor?: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>,
    ip?: string
  ): BudgetAllocation {
    const tenant = this.requireTenant(tenantId);
    const validCategories = new Set<string>(EXPENSE_CATEGORIES);
    if (!validCategories.has(input.category)) {
      throw new ConflictError(`Invalid budget expense category "${input.category}".`, 400);
    }
    const allocatedAmount = Math.round(Number(input.allocatedAmount));
    if (!Number.isFinite(allocatedAmount) || allocatedAmount < 0) {
      throw new ConflictError('Budget allocation amount must be zero or positive.', 400);
    }

    if (!Array.isArray(this.state.budgets)) this.state.budgets = [];
    const existing = this.state.budgets.find(
      (b) => b.tenantId === tenantId && b.category === input.category
    );

    if (existing) {
      const beforeSnap = {
        allocatedAmount: existing.allocatedAmount,
        status: existing.status,
      };
      const amountChanged = existing.allocatedAmount !== allocatedAmount;
      existing.allocatedAmount = allocatedAmount;
      if (input.fiscalYear) existing.fiscalYear = input.fiscalYear.trim();
      if (input.term) existing.term = input.term.trim();
      if (input.notes !== undefined) existing.notes = input.notes.trim() || undefined;
      if (amountChanged) {
        existing.status = 'Pending Approval';
        existing.createdByUserId = actor?.id || existing.createdByUserId || 'system';
        existing.approvedBy = undefined;
        existing.approvedAt = undefined;
        existing.approvalNotes = 'Ceiling revised — awaiting approval.';
      } else if (!existing.status) {
        existing.status = 'Pending Approval';
        existing.createdByUserId = actor?.id || existing.createdByUserId || 'system';
      }
      existing.updatedAt = new Date().toISOString();

      this.appendFinanceAudit(
        tenantId,
        actor,
        'UPSERT_BUDGET',
        'BudgetAllocation',
        existing.id,
        beforeSnap,
        { category: existing.category, allocatedAmount, status: existing.status },
        ip
      );
      this.persist();
      this.syncTenant(tenantId, 'finance:budget-updated');
      return existing;
    }

    const created: BudgetAllocation = {
      id: `bdg-${randomUUID().slice(0, 8)}`,
      tenantId,
      fiscalYear: (input.fiscalYear || '').trim() || tenant.academicYear || '2026–2027',
      term: (input.term || '').trim() || tenant.currentTerm || 'Term 1',
      category: input.category,
      allocatedAmount,
      status: 'Pending Approval',
      createdByUserId: actor?.id || 'system',
      notes: (input.notes || '').trim() || undefined,
      updatedAt: new Date().toISOString(),
    };
    this.state.budgets.push(created);
    this.appendFinanceAudit(
      tenantId,
      actor,
      'UPSERT_BUDGET',
      'BudgetAllocation',
      created.id,
      null,
      { category: created.category, allocatedAmount, status: created.status },
      ip
    );
    this.persist();
    this.syncTenant(tenantId, 'finance:budget-created');
    return created;
  }

  approveBudgetAllocation(
    tenantId: string,
    input: {
      budgetId?: string;
      category?: ExpenseCategory;
      status: BudgetApprovalStatus;
      approvedBy: string;
      approvalNotes?: string;
    },
    actor?: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>,
    ip?: string
  ): BudgetAllocation {
    const tenant = this.requireTenant(tenantId);
    if (!Array.isArray(this.state.budgets)) this.state.budgets = [];

    let target = input.budgetId
      ? this.state.budgets.find((b) => b.tenantId === tenantId && b.id === input.budgetId)
      : undefined;
    if (!target && input.category) {
      target = this.state.budgets.find(
        (b) => b.tenantId === tenantId && b.category === input.category
      );
    }

    if (!target && input.category) {
      const validCategories = new Set<string>(EXPENSE_CATEGORIES);
      if (!validCategories.has(input.category)) {
        throw new ConflictError(`Invalid budget category "${input.category}".`, 400);
      }
      target = {
        id: `bdg-${randomUUID().slice(0, 8)}`,
        tenantId,
        fiscalYear: tenant.academicYear || '2026–2027',
        term: tenant.currentTerm || 'Term 1',
        category: input.category,
        allocatedAmount: 0,
        status: 'Draft',
        createdByUserId: actor?.id || 'system',
        updatedAt: new Date().toISOString(),
      };
      this.state.budgets.push(target);
    }

    if (!target) {
      throw new ConflictError('Budget allocation record not found.', 404);
    }

    const allowedStatuses = new Set<BudgetApprovalStatus>([
      'Draft',
      'Pending Approval',
      'Approved',
      'Rejected',
    ]);
    if (!allowedStatuses.has(input.status)) {
      throw new ConflictError(`Invalid budget approval status "${String(input.status)}".`, 400);
    }

    if (input.status === 'Approved') {
      if (
        actor &&
        actor.role !== 'Admin' &&
        actor.role !== 'Bursar' &&
        actor.role !== 'Super Admin' &&
        actor.role !== 'Developer'
      ) {
        throw new ConflictError('Only School Admin or a different Bursar can approve budgets.', 403);
      }
      if (target.createdByUserId && actor?.id && target.createdByUserId === actor.id) {
        throw new ConflictError(
          'Maker-checker violation: the user who created or revised a budget ceiling cannot approve it.',
          403
        );
      }
      if (target.allocatedAmount <= 0) {
        throw new ConflictError(
          `Set a positive budget ceiling for ${target.category} before approving it.`,
          400
        );
      }
    }

    const beforeSnap = { status: target.status, allocatedAmount: target.allocatedAmount };
    const now = new Date().toISOString();
    target.status = input.status;
    target.approvalNotes = (input.approvalNotes || '').trim() || undefined;
    target.updatedAt = now;

    if (input.status === 'Approved' || input.status === 'Rejected') {
      target.approvedBy =
        actor?.fullName || actor?.email || (input.approvedBy || '').trim() || 'Finance Administrator';
      target.approvedAt = now;
    } else {
      target.approvedBy = undefined;
      target.approvedAt = undefined;
    }

    this.appendFinanceAudit(
      tenantId,
      actor,
      'APPROVE_BUDGET',
      'BudgetAllocation',
      target.id,
      beforeSnap,
      { category: target.category, status: target.status, approvedBy: target.approvedBy },
      ip
    );
    this.persist();
    this.syncTenant(tenantId, 'finance:budget-approval');
    this.pushNotification(
      tenantId,
      'fee',
      `Budget ${input.status}: ${target.category}`,
      `${target.category} ceiling (${target.allocatedAmount.toLocaleString()}) marked ${input.status} by ${target.approvedBy || 'Finance Admin'}.`,
      'finance'
    );
    return target;
  }

  // Finance Controls: Board / Procurement Sign-Off Approvals
  createApprovalRecord(
    tenantId: string,
    input: {
      committee: ApprovalCommittee;
      subject: string;
      linkedExpenseId?: string;
      amount: number;
      meetingDate?: string;
      minuteReference: string;
      chairpersonName: string;
      secretaryName: string;
      bursarName?: string;
      decision?: ApprovalDecision;
      remarks?: string;
    },
    actor?: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>,
    ip?: string
  ): ApprovalSignOffRecord {
    const tenant = this.requireTenant(tenantId);
    const subject = (input.subject || '').trim();
    const minuteReference = (input.minuteReference || '').trim();
    const chairpersonName = (input.chairpersonName || '').trim();
    const secretaryName = (input.secretaryName || '').trim();
    const amount = this.parseStrictPositiveAmount(input.amount, 'Sign-off amount');

    if (!subject || !minuteReference || !chairpersonName || !secretaryName) {
      throw new ConflictError(
        'Subject, minute reference, chairperson, and secretary signatories are required.',
        400
      );
    }

    const validCommittees = new Set<string>(APPROVAL_COMMITTEES);
    const committee: ApprovalCommittee = validCommittees.has(input.committee)
      ? input.committee
      : 'Board of Management (BOM)';
    // Maker-checker: newly submitted approval items start at Pending Sign-Off
    const decision: ApprovalDecision =
      input.decision === 'Deferred' || input.decision === 'Rejected'
        ? input.decision
        : 'Pending Sign-Off';

    const linkedExpense = input.linkedExpenseId
      ? this.state.expenses.find(
          (e) => e.id === input.linkedExpenseId && e.tenantId === tenantId && !e.voided
        )
      : undefined;

    if (!Array.isArray(this.state.approvalRecords)) this.state.approvalRecords = [];
    const count = this.state.approvalRecords.filter((a) => a.tenantId === tenantId).length;
    const prefix = tenant.slug.slice(0, 3).toUpperCase();
    const referenceCode = `${prefix}-BOM-2026-${String(count + 1).padStart(2, '0')}`;

    const record: ApprovalSignOffRecord = {
      id: `apr-${randomUUID().slice(0, 8)}`,
      tenantId,
      referenceCode,
      committee,
      subject,
      linkedExpenseId: linkedExpense?.id,
      linkedVoucherNumber: linkedExpense?.voucherNumber,
      amount,
      meetingDate:
        input.meetingDate && !Number.isNaN(Date.parse(input.meetingDate))
          ? new Date(input.meetingDate).toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10),
      minuteReference,
      chairpersonName,
      secretaryName,
      bursarName: (input.bursarName || '').trim() || actor?.fullName || 'School Bursar',
      decision,
      remarks: (input.remarks || '').trim() || undefined,
      createdByUserId: actor?.id || 'system',
      createdAt: new Date().toISOString(),
    };

    if (linkedExpense) {
      linkedExpense.boardApprovalRef = `${referenceCode} (${minuteReference})`;
    }

    this.state.approvalRecords.unshift(record);
    this.appendFinanceAudit(
      tenantId,
      actor,
      'CREATE_APPROVAL_RECORD',
      'ApprovalSignOffRecord',
      record.id,
      null,
      { referenceCode, subject, amount, decision },
      ip
    );
    this.persist();
    this.syncTenant(tenantId, 'finance:approval-created');
    return record;
  }

  updateApprovalDecision(
    tenantId: string,
    recordId: string,
    patch: { decision: ApprovalDecision; remarks?: string },
    actor?: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>,
    ip?: string
  ): ApprovalSignOffRecord {
    this.requireTenant(tenantId);
    const validDecisions = new Set<ApprovalDecision>([
      'Pending Sign-Off',
      'Approved',
      'Deferred',
      'Rejected',
    ]);
    if (!validDecisions.has(patch.decision)) {
      throw new ConflictError(`Invalid approval decision "${patch.decision}".`, 400);
    }

    const record = (this.state.approvalRecords || []).find(
      (a) => a.id === recordId && a.tenantId === tenantId && !a.voided
    );
    if (!record) {
      throw new ConflictError('Board / Procurement approval record not found.', 404);
    }

    if (patch.decision === 'Approved') {
      if (
        actor &&
        actor.role !== 'Admin' &&
        actor.role !== 'Bursar' &&
        actor.role !== 'Super Admin' &&
        actor.role !== 'Developer'
      ) {
        throw new ConflictError('Only School Admin or a different Bursar can approve sign-offs.', 403);
      }
      if (record.createdByUserId && actor?.id && record.createdByUserId === actor.id) {
        throw new ConflictError(
          'Maker-checker violation: the user who submitted a sign-off record cannot approve it.',
          403
        );
      }
    }

    const beforeSnap = { decision: record.decision };
    record.decision = patch.decision;
    if (patch.remarks !== undefined) record.remarks = patch.remarks.trim() || undefined;
    record.signedAt = patch.decision === 'Approved' ? new Date().toISOString() : undefined;

    if (record.linkedExpenseId) {
      const linkedExpense = this.state.expenses.find(
        (e) => e.id === record.linkedExpenseId && e.tenantId === tenantId && !e.voided
      );
      if (linkedExpense) {
        linkedExpense.boardApprovalRef = `${record.referenceCode} (${record.minuteReference})`;
        if (
          patch.decision === 'Approved' &&
          linkedExpense.status === 'Pending Approval' &&
          (!linkedExpense.createdByUserId || !actor?.id || linkedExpense.createdByUserId !== actor.id)
        ) {
          linkedExpense.status = 'Approved';
          linkedExpense.approvedByUserId = actor?.id;
          linkedExpense.approvedBy = actor?.fullName || actor?.email || 'BOM Approver';
          linkedExpense.approvedAt = new Date().toISOString();
        }
      }
    }

    this.appendFinanceAudit(
      tenantId,
      actor,
      'UPDATE_APPROVAL_DECISION',
      'ApprovalSignOffRecord',
      record.id,
      beforeSnap,
      { referenceCode: record.referenceCode, decision: record.decision },
      ip
    );
    this.persist();
    this.syncTenant(tenantId, 'finance:approval-updated');
    return record;
  }

  deleteApprovalRecord(
    tenantId: string,
    recordId: string,
    reason?: string,
    actor?: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>,
    ip?: string
  ): { deleted: boolean } {
    this.requireTenant(tenantId);
    const record = (this.state.approvalRecords || []).find(
      (a) => a.id === recordId && a.tenantId === tenantId && !a.voided
    );
    if (!record) {
      throw new ConflictError('Board / Procurement approval record not found.', 404);
    }

    const cleanReason = (reason || '').trim() || 'Voided approval record';
    record.voided = true;
    record.voidReason = cleanReason;
    record.voidedBy = actor?.fullName || actor?.email || 'Finance Office';
    record.voidedAt = new Date().toISOString();

    this.appendFinanceAudit(
      tenantId,
      actor,
      'VOID_APPROVAL_RECORD',
      'ApprovalSignOffRecord',
      record.id,
      { referenceCode: record.referenceCode, decision: record.decision, amount: record.amount },
      { voided: true, voidReason: cleanReason },
      ip
    );
    this.persist();
    this.syncTenant(tenantId, 'finance:approval-deleted');
    return { deleted: true };
  }

  // Communications
  createAnnouncement(
    tenantId: string,
    input: {
      title: string;
      body: string;
      audience: Announcement['audience'];
      priority: Announcement['priority'];
      authorName: string;
      authorRole: UserRole;
    }
  ): Announcement {
    this.requireTenant(tenantId);
    const ann: Announcement = {
      id: `ann-${randomUUID().slice(0, 8)}`,
      tenantId,
      title: input.title.trim(),
      body: input.body.trim(),
      audience: input.audience,
      priority: input.priority,
      authorName: input.authorName,
      authorRole: input.authorRole,
      createdAt: new Date().toISOString(),
    };
    this.state.announcements.unshift(ann);
    this.persist();
    this.onBroadcast?.(tenantId, 'announcement:new', ann);
    this.pushNotification(
      tenantId,
      'announcement',
      `${ann.priority === 'Urgent' ? '[Urgent] ' : ''}${ann.title}`,
      `Broadcast to ${ann.audience} by ${ann.authorName}.`,
      'communications'
    );
    return ann;
  }

  createMessage(
    tenantId: string,
    input: { channel: string; senderName: string; senderRole: UserRole; body: string }
  ): DirectMessage {
    this.requireTenant(tenantId);
    const msg: DirectMessage = {
      id: `msg-${randomUUID().slice(0, 8)}`,
      tenantId,
      channel: input.channel,
      senderName: input.senderName,
      senderRole: input.senderRole,
      body: input.body.trim(),
      createdAt: new Date().toISOString(),
    };
    this.state.messages.push(msg);
    this.persist();
    this.onBroadcast?.(tenantId, 'message:new', msg);
    this.pushNotification(
      tenantId,
      'message',
      `New message in ${msg.channel}`,
      `${msg.senderName} (${msg.senderRole}): ${msg.body.slice(0, 72)}`,
      'communications'
    );
    return msg;
  }

  logWhatsAppDispatch(
    tenantId: string,
    input: {
      category: WhatsAppDispatchCategory;
      studentId: string;
      studentName: string;
      guardianName: string;
      guardianPhone: string;
      referenceLabel: string;
      messagePreview: string;
      sentBy: string;
    }
  ): WhatsAppDispatchRecord {
    this.requireTenant(tenantId);
    if (!input.studentName?.trim() || !input.guardianPhone?.trim()) {
      throw new ConflictError('Student name and guardian phone number are required.', 400);
    }
    if (!Array.isArray(this.state.whatsappDispatches)) {
      this.state.whatsappDispatches = [];
    }
    const record: WhatsAppDispatchRecord = {
      id: `wa-${randomUUID().slice(0, 8)}`,
      tenantId,
      category: input.category,
      studentId: input.studentId || '',
      studentName: input.studentName.trim(),
      guardianName: (input.guardianName || 'Parent / Guardian').trim(),
      guardianPhone: input.guardianPhone.trim(),
      referenceLabel: (input.referenceLabel || input.category).trim(),
      messagePreview: (input.messagePreview || '').trim().slice(0, 1200),
      sentBy: (input.sentBy || 'Staff').trim(),
      sentAt: new Date().toISOString(),
    };
    this.state.whatsappDispatches.unshift(record);
    if (this.state.whatsappDispatches.length > 500) {
      this.state.whatsappDispatches = this.state.whatsappDispatches.slice(0, 500);
    }
    this.persist();
    this.pushNotification(
      tenantId,
      input.category === 'Report Card' ? 'exam' : 'fee',
      `WhatsApp ${input.category} Sent`,
      `Sent to ${record.guardianName} (${record.guardianPhone}) for ${record.studentName} · ${record.referenceLabel}`,
      input.category === 'Report Card' ? 'exams' : 'fees'
    );
    return record;
  }

  markNotificationsRead(tenantId: string, notificationId?: string) {
    this.requireTenant(tenantId);
    this.state.notifications.forEach((n) => {
      if (n.tenantId === tenantId && (!notificationId || n.id === notificationId)) {
        n.read = true;
      }
    });
    this.persist();
    this.syncTenant(tenantId, 'notifications:read');
  }

  // =========================================================================
  // Academic Calendar & Term Close / Reopen
  // =========================================================================

  private resolveTenantTerm(
    tenantId: string,
    opts?: { termId?: string; termName?: string; date?: string; exactTermNameOnly?: boolean }
  ): AcademicTerm | undefined {
    const terms = (this.state.academicTerms || []).filter((t) => t.tenantId === tenantId);
    if (terms.length === 0) return undefined;

    if (opts?.termId && opts.termId.trim()) {
      const byId = terms.find((t) => t.id === opts.termId!.trim());
      return byId;
    }

    if (opts?.date && /^\d{4}-\d{2}-\d{2}$/.test(opts.date.trim())) {
      const d = opts.date.trim();
      const byDate =
        terms.find((t) => t.isCurrent && t.startDate <= d && d <= t.endDate) ||
        terms.find((t) => t.startDate <= d && d <= t.endDate);
      if (byDate) return byDate;
    }

    if (opts?.termName && opts.termName.trim()) {
      const clean = opts.termName.trim().toLowerCase();
      const base = clean.replace(/\s*\([^)]*\)\s*/g, '').trim();
      const exact =
        terms.find((t) => t.isCurrent && t.name.trim().toLowerCase() === clean) ||
        terms.find((t) => t.name.trim().toLowerCase() === clean);
      if (exact) return exact;
      const baseMatch =
        terms.find(
          (t) =>
            t.isCurrent &&
            t.name.trim().toLowerCase().replace(/\s*\([^)]*\)\s*/g, '').trim() === base
        ) ||
        terms.find(
          (t) => t.name.trim().toLowerCase().replace(/\s*\([^)]*\)\s*/g, '').trim() === base
        );
      if (baseMatch) return baseMatch;
      if (opts.exactTermNameOnly) return undefined;
    }

    return terms.find((t) => t.isCurrent) || terms[0];
  }

  private assertTermOpen(
    tenantId: string,
    opts?: {
      termId?: string;
      termName?: string;
      date?: string;
      exactTermNameOnly?: boolean;
      actionLabel?: string;
    }
  ): AcademicTerm | undefined {
    const term = this.resolveTenantTerm(tenantId, opts);
    if (opts?.termId && !term) {
      throw new ConflictError('Specified academic term not found for this school.', 404);
    }
    if (term && term.status === 'Closed') {
      throw new ConflictError(
        `${opts?.actionLabel || 'This operation'} is locked because "${term.name}" is Closed. An Admin must reopen the term in School Settings before making changes.`,
        409
      );
    }
    return term;
  }

  private appendLifecycleAudit(
    tenantId: string,
    actor: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'> | undefined,
    action: LifecycleAuditAction,
    entity: LifecycleAuditEntry['entity'],
    entityId: string,
    summary: string,
    reason?: string,
    before?: unknown,
    after?: unknown
  ): LifecycleAuditEntry {
    if (!Array.isArray(this.state.lifecycleAuditLogs)) {
      this.state.lifecycleAuditLogs = [];
    }
    const entry: LifecycleAuditEntry = {
      id: `laud-${randomUUID().slice(0, 8)}`,
      tenantId,
      timestamp: new Date().toISOString(),
      actorUserId: actor?.id || 'system',
      who: actor?.fullName || actor?.email || 'System',
      role: actor?.role || 'Admin',
      action,
      entity,
      entityId,
      summary,
      ...(reason ? { reason } : {}),
      ...(before !== undefined ? { before } : {}),
      ...(after !== undefined ? { after } : {}),
    };
    this.state.lifecycleAuditLogs.unshift(entry);
    if (this.state.lifecycleAuditLogs.length > 2000) {
      this.state.lifecycleAuditLogs = this.state.lifecycleAuditLogs.slice(0, 2000);
    }
    return entry;
  }

  getLifecycleAuditLogs(tenantId: string, limit = 200): LifecycleAuditEntry[] {
    this.requireTenant(tenantId);
    const safeLimit = Math.max(1, Math.min(500, Math.round(limit)));
    return (this.state.lifecycleAuditLogs || [])
      .filter((l) => l.tenantId === tenantId)
      .slice(0, safeLimit);
  }

  listAcademicCalendar(tenantId: string): {
    academicYears: AcademicYear[];
    academicTerms: AcademicTerm[];
  } {
    this.requireTenant(tenantId);
    return {
      academicYears: (this.state.academicYears || []).filter((y) => y.tenantId === tenantId),
      academicTerms: (this.state.academicTerms || []).filter((t) => t.tenantId === tenantId),
    };
  }

  createAcademicYear(
    tenantId: string,
    input: { name: string; startDate: string; endDate: string; setAsCurrent?: boolean },
    actor: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>
  ): AcademicYear {
    const tenant = this.requireTenant(tenantId);
    const name = (input.name || '').trim();
    const startDate = (input.startDate || '').trim();
    const endDate = (input.endDate || '').trim();
    if (!name) throw new ConflictError('Academic year name is required (e.g. 2027).', 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      throw new ConflictError('Provide valid YYYY-MM-DD start and end dates.', 400);
    }
    if (startDate >= endDate) {
      throw new ConflictError('Academic year end date must be after start date.', 400);
    }

    if (!Array.isArray(this.state.academicYears)) this.state.academicYears = [];
    const dup = this.state.academicYears.some(
      (y) => y.tenantId === tenantId && y.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (dup) {
      throw new ConflictError(`Academic year "${name}" already exists for ${tenant.name}.`, 409);
    }

    const existingForTenant = this.state.academicYears.filter((y) => y.tenantId === tenantId);
    const makeCurrent = Boolean(input.setAsCurrent) || existingForTenant.length === 0;
    if (makeCurrent) {
      existingForTenant.forEach((y) => {
        y.isCurrent = false;
      });
      tenant.academicYear = name;
    }

    const year: AcademicYear = {
      id: `ay-${randomUUID().slice(0, 8)}`,
      tenantId,
      name,
      startDate,
      endDate,
      status: 'Open',
      isCurrent: makeCurrent,
      createdAt: new Date().toISOString(),
    };
    this.state.academicYears.push(year);

    this.appendLifecycleAudit(
      tenantId,
      actor,
      'ACADEMIC_YEAR_CREATED',
      'AcademicYear',
      year.id,
      `Created academic year "${year.name}" (${startDate} to ${endDate}).`,
      undefined,
      null,
      year
    );

    this.persist();
    this.syncTenant(tenantId, 'calendar:year-created');
    return year;
  }

  createAcademicTerm(
    tenantId: string,
    input: {
      academicYearId: string;
      name: string;
      startDate: string;
      endDate: string;
      setAsCurrent?: boolean;
    },
    actor: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>
  ): AcademicTerm {
    const tenant = this.requireTenant(tenantId);
    const year = (this.state.academicYears || []).find(
      (y) => y.id === input.academicYearId && y.tenantId === tenantId
    );
    if (!year) {
      throw new ConflictError('Selected academic year not found for this school.', 404);
    }

    const name = (input.name || '').trim();
    const startDate = (input.startDate || '').trim();
    const endDate = (input.endDate || '').trim();
    if (!name) throw new ConflictError('Term name is required (e.g. Term 2).', 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      throw new ConflictError('Provide valid YYYY-MM-DD start and end dates.', 400);
    }
    if (startDate >= endDate) {
      throw new ConflictError('Term end date must be after start date.', 400);
    }

    if (!Array.isArray(this.state.academicTerms)) this.state.academicTerms = [];
    const dup = this.state.academicTerms.some(
      (t) =>
        t.tenantId === tenantId &&
        t.academicYearId === year.id &&
        t.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (dup) {
      throw new ConflictError(
        `Term "${name}" already exists inside academic year ${year.name}.`,
        409
      );
    }

    const existingTerms = this.state.academicTerms.filter((t) => t.tenantId === tenantId);
    const makeCurrent = Boolean(input.setAsCurrent) || existingTerms.length === 0;
    if (makeCurrent) {
      existingTerms.forEach((t) => {
        t.isCurrent = false;
      });
      (this.state.academicYears || []).forEach((y) => {
        if (y.tenantId === tenantId) y.isCurrent = y.id === year.id;
      });
      tenant.currentTerm = name;
      tenant.academicYear = year.name;
    }

    const term: AcademicTerm = {
      id: `term-${randomUUID().slice(0, 8)}`,
      tenantId,
      academicYearId: year.id,
      name,
      startDate,
      endDate,
      status: 'Open',
      isCurrent: makeCurrent,
      createdAt: new Date().toISOString(),
    };
    this.state.academicTerms.push(term);

    this.appendLifecycleAudit(
      tenantId,
      actor,
      'ACADEMIC_TERM_CREATED',
      'AcademicTerm',
      term.id,
      `Created term "${term.name}" in ${year.name} (${startDate} to ${endDate}).`,
      undefined,
      null,
      term
    );

    this.persist();
    this.syncTenant(tenantId, 'calendar:term-created');
    return term;
  }

  setCurrentAcademicTerm(
    tenantId: string,
    termId: string,
    actor: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>
  ): AcademicTerm {
    const tenant = this.requireTenant(tenantId);
    const terms = (this.state.academicTerms || []).filter((t) => t.tenantId === tenantId);
    const target = terms.find((t) => t.id === termId);
    if (!target) {
      throw new ConflictError('Academic term not found.', 404);
    }
    const year = (this.state.academicYears || []).find(
      (y) => y.id === target.academicYearId && y.tenantId === tenantId
    );
    terms.forEach((t) => {
      t.isCurrent = t.id === target.id;
    });
    if (year) {
      (this.state.academicYears || []).forEach((y) => {
        if (y.tenantId === tenantId) y.isCurrent = y.id === year.id;
      });
      tenant.academicYear = year.name;
    }
    tenant.currentTerm = target.name;

    this.appendLifecycleAudit(
      tenantId,
      actor,
      'TERM_SET_CURRENT',
      'AcademicTerm',
      target.id,
      `Set active term to ${target.name}${year ? ` (${year.name})` : ''}.`
    );

    this.persist();
    this.syncTenant(tenantId, 'calendar:term-current-updated');
    return target;
  }

  closeAcademicTerm(
    tenantId: string,
    termId: string,
    actor: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>
  ): AcademicTerm {
    this.requireTenant(tenantId);
    const target = (this.state.academicTerms || []).find(
      (t) => t.id === termId && t.tenantId === tenantId
    );
    if (!target) {
      throw new ConflictError('Academic term not found.', 404);
    }
    if (target.status === 'Closed') {
      throw new ConflictError(`Term "${target.name}" is already closed.`, 409);
    }
    const actorName = actor.fullName || actor.email;
    target.status = 'Closed';
    target.closedAt = new Date().toISOString();
    target.closedBy = actorName;

    this.appendLifecycleAudit(
      tenantId,
      actor,
      'TERM_CLOSED',
      'AcademicTerm',
      target.id,
      `Closed term "${target.name}". Exams, attendance, and fees for this term are now locked.`,
      undefined,
      { status: 'Open' },
      { status: 'Closed', closedBy: actorName }
    );

    this.persist();
    this.pushNotification(
      tenantId,
      'announcement',
      `Academic Term Closed: ${target.name}`,
      `${actorName} closed ${target.name}. Exam marks, attendance, and fee edits for this term are now locked.`,
      'settings'
    );
    this.syncTenant(tenantId, 'calendar:term-closed');
    return target;
  }

  reopenAcademicTerm(
    tenantId: string,
    termId: string,
    reason: string,
    actor: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>
  ): AcademicTerm {
    this.requireTenant(tenantId);
    if (actor.role !== 'Admin' && actor.role !== 'Super Admin' && actor.role !== 'Developer') {
      throw new ConflictError('Only School Admin can reopen a closed academic term.', 403);
    }
    const cleanReason = (reason || '').trim();
    if (cleanReason.length < 3) {
      throw new ConflictError('Provide a reason before reopening a closed term.', 400);
    }
    const target = (this.state.academicTerms || []).find(
      (t) => t.id === termId && t.tenantId === tenantId
    );
    if (!target) {
      throw new ConflictError('Academic term not found.', 404);
    }
    if (target.status !== 'Closed') {
      throw new ConflictError(`Term "${target.name}" is already open.`, 400);
    }

    const actorName = actor.fullName || actor.email;
    target.status = 'Open';
    target.reopenedAt = new Date().toISOString();
    target.reopenedBy = actorName;
    target.reopenReason = cleanReason;

    this.appendLifecycleAudit(
      tenantId,
      actor,
      'TERM_REOPENED',
      'AcademicTerm',
      target.id,
      `Reopened closed term "${target.name}" by ${actorName}.`,
      cleanReason,
      { status: 'Closed' },
      { status: 'Open', reopenedBy: actorName, reopenReason: cleanReason }
    );

    this.persist();
    this.pushNotification(
      tenantId,
      'announcement',
      `Academic Term Reopened: ${target.name}`,
      `${actorName} reopened ${target.name}. Reason: ${cleanReason}`,
      'settings'
    );
    this.syncTenant(tenantId, 'calendar:term-reopened');
    return target;
  }

  // =========================================================================
  // Student Lifecycle Management, Soft Delete & Portal Toggle
  // =========================================================================

  updateStudentDetails(
    tenantId: string,
    studentId: string,
    patch: {
      fullName?: string;
      grade?: string;
      section?: string;
      gender?: 'Female' | 'Male' | 'Non-binary';
      dateOfBirth?: string;
      studentCode?: string;
      upi?: string;
      guardianName?: string;
      guardianEmail?: string;
      guardianPhone?: string;
      enrolledAt?: string;
    },
    actor: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>
  ): Student {
    const tenant = this.requireTenant(tenantId);
    const student = this.state.students.find(
      (s) => s.id === studentId && s.tenantId === tenantId && !s.deleted
    );
    if (!student) {
      throw new ConflictError('Student record not found.', 404);
    }

    const beforeSnap = {
      fullName: student.fullName,
      grade: student.grade,
      section: student.section,
      studentCode: student.studentCode,
      upi: student.upi,
      guardianName: student.guardianName,
      guardianPhone: student.guardianPhone,
      guardianEmail: student.guardianEmail,
    };

    if (patch.fullName !== undefined) {
      const cleaned = patch.fullName.trim();
      if (cleaned.length < 2) {
        throw new ConflictError('Learner full name must be at least 2 characters.', 400);
      }
      student.fullName = cleaned;
    }
    const nextGrade = patch.grade !== undefined && patch.grade.trim() ? patch.grade.trim() : student.grade;
    if (patch.dateOfBirth !== undefined) {
      student.dateOfBirth = this.validateStudentDateOfBirth(patch.dateOfBirth, nextGrade);
    } else if (patch.grade !== undefined && nextGrade !== student.grade) {
      this.validateStudentDateOfBirth(student.dateOfBirth, nextGrade);
    }
    student.grade = nextGrade;

    if (patch.section !== undefined && patch.section.trim()) {
      student.section = patch.section.trim();
    }
    if (patch.gender !== undefined) {
      if (!['Female', 'Male', 'Non-binary'].includes(patch.gender)) {
        throw new ConflictError('Gender must be Female, Male, or Non-binary.', 400);
      }
      student.gender = patch.gender;
    }
    if (patch.studentCode !== undefined) {
      const nextCode = patch.studentCode.trim().toUpperCase();
      if (!nextCode) throw new ConflictError('Student admission code cannot be empty.', 400);
      const dupCode = this.state.students.some(
        (s) =>
          s.tenantId === tenantId &&
          s.id !== student.id &&
          !s.deleted &&
          s.studentCode.trim().toUpperCase() === nextCode
      );
      if (dupCode) {
        throw new ConflictError(
          `Admission number / student code "${nextCode}" is already assigned to another learner in ${tenant.name}.`,
          409
        );
      }
      student.studentCode = nextCode;
    }
    if (patch.upi !== undefined) {
      const nextUpi = patch.upi.trim().toUpperCase();
      if (!nextUpi) throw new ConflictError('NEMIS / UPI cannot be empty.', 400);
      const dupUpi = this.state.students.some(
        (s) =>
          s.tenantId === tenantId &&
          s.id !== student.id &&
          !s.deleted &&
          s.upi.trim().toUpperCase() === nextUpi
      );
      if (dupUpi) {
        throw new ConflictError(
          `NEMIS / UPI "${nextUpi}" is already registered to another learner in ${tenant.name}.`,
          409
        );
      }
      student.upi = nextUpi;
    }
    if (patch.guardianName !== undefined) {
      const gName = patch.guardianName.trim();
      if (gName.length < 2) throw new ConflictError('Guardian name must be at least 2 characters.', 400);
      student.guardianName = gName;
    }
    if (patch.guardianPhone !== undefined) {
      student.guardianPhone = this.validateAndNormalizeKenyanPhone(
        patch.guardianPhone,
        'Guardian phone'
      );
    }
    if (patch.guardianEmail !== undefined) {
      student.guardianEmail = patch.guardianEmail.trim();
    }
    if (patch.enrolledAt !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(patch.enrolledAt.trim())) {
      student.enrolledAt = patch.enrolledAt.trim();
    }

    // Keep linked display snapshots in sync
    for (const inv of this.state.invoices) {
      if (inv.tenantId === tenantId && inv.studentId === student.id) {
        inv.studentName = student.fullName;
        inv.studentCode = student.studentCode;
      }
    }

    this.appendLifecycleAudit(
      tenantId,
      actor,
      'STUDENT_EDITED',
      'Student',
      student.id,
      `Updated profile for ${student.fullName} (${student.studentCode}).`,
      undefined,
      beforeSnap,
      {
        fullName: student.fullName,
        grade: student.grade,
        section: student.section,
        studentCode: student.studentCode,
        upi: student.upi,
        guardianName: student.guardianName,
        guardianPhone: student.guardianPhone,
        guardianEmail: student.guardianEmail,
      }
    );

    this.persist();
    this.syncTenant(tenantId, 'student:updated');
    return student;
  }

  transitionStudentStatus(
    tenantId: string,
    studentId: string,
    input: { status: StudentStatus; reason?: string; statusDate?: string },
    actor: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>
  ): Student {
    const tenant = this.requireTenant(tenantId);
    const student = this.state.students.find(
      (s) => s.id === studentId && s.tenantId === tenantId && !s.deleted
    );
    if (!student) {
      throw new ConflictError('Student record not found.', 404);
    }

    const validStatuses = new Set<StudentStatus>([
      'Active',
      'On Leave',
      'Graduated',
      'Transferred',
      'Withdrawn',
    ]);
    if (!validStatuses.has(input.status)) {
      throw new ConflictError('Invalid student lifecycle status.', 400);
    }

    const reason = (input.reason || '').trim();
    if (
      (input.status === 'Transferred' ||
        input.status === 'Withdrawn' ||
        input.status === 'Graduated') &&
      !reason
    ) {
      throw new ConflictError(`Provide a reason before marking learner as ${input.status}.`, 400);
    }

    const rawDate = (input.statusDate || '').trim();
    const effectiveDate = rawDate
      ? (() => {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
            throw new ConflictError('Effective date must be YYYY-MM-DD.', 400);
          }
          return rawDate;
        })()
      : new Date().toISOString().slice(0, 10);

    const exitedStatuses = new Set<StudentStatus>(['Graduated', 'Transferred', 'Withdrawn']);
    if (
      (input.status === 'Active' || input.status === 'On Leave') &&
      exitedStatuses.has(student.status)
    ) {
      this.assertLearnerCap(tenant, 1);
    }

    const prevStatus = student.status;
    student.status = input.status;
    student.statusReason = reason || undefined;
    student.statusDate = effectiveDate;

    const actionMap: Record<StudentStatus, LifecycleAuditAction> = {
      Transferred: 'STUDENT_TRANSFERRED',
      Withdrawn: 'STUDENT_WITHDRAWN',
      Graduated: 'STUDENT_GRADUATED',
      Active: 'STUDENT_REACTIVATED',
      'On Leave': 'STUDENT_REACTIVATED',
    };

    this.appendLifecycleAudit(
      tenantId,
      actor,
      actionMap[input.status],
      'Student',
      student.id,
      `Moved ${student.fullName} (${student.studentCode}) from ${prevStatus} to ${input.status} effective ${effectiveDate}.`,
      reason || undefined,
      { status: prevStatus },
      { status: input.status, statusDate: effectiveDate, statusReason: reason || undefined }
    );

    this.persist();
    this.pushNotification(
      tenantId,
      'admission',
      `Learner ${input.status}: ${student.fullName}`,
      `${student.studentCode} (${student.grade} ${student.section}) marked ${input.status} on ${effectiveDate}.${reason ? ` Reason: ${reason}` : ''}`,
      'admissions'
    );
    this.syncTenant(tenantId, 'student:lifecycle-updated');
    return student;
  }

  softDeleteStudent(
    tenantId: string,
    studentId: string,
    reason: string,
    actor: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>
  ): { deleted: true; student: Student } {
    this.requireTenant(tenantId);
    const cleanReason = (reason || '').trim();
    if (cleanReason.length < 3) {
      throw new ConflictError('Provide a clear audit reason (minimum 3 characters) to archive/delete a student record.', 400);
    }
    const student = this.state.students.find(
      (s) => s.id === studentId && s.tenantId === tenantId
    );
    if (!student) {
      throw new ConflictError('Student record not found.', 404);
    }
    if (student.deleted) {
      throw new ConflictError(`Student "${student.fullName}" has already been archived/deleted.`, 409);
    }

    const now = new Date().toISOString();
    const actorName = actor.fullName || actor.email;
    student.deleted = true;
    student.deletedAt = now;
    student.deletedBy = actorName;
    student.deleteReason = cleanReason;

    // Disable any linked Student portal login account as well
    if (student.studentUserId) {
      const linkedUser = (this.state.users || []).find((u) => u.id === student.studentUserId);
      if (linkedUser) {
        linkedUser.status = 'Disabled';
        linkedUser.tokenVersion = (linkedUser.tokenVersion ?? 0) + 1;
      }
    }

    this.appendLifecycleAudit(
      tenantId,
      actor,
      'STUDENT_SOFT_DELETED',
      'Student',
      student.id,
      `Soft-deleted ${student.fullName} (${student.studentCode}, ${student.grade} ${student.section}). Historical invoices, attendance, and exam records retained.`,
      cleanReason,
      { deleted: false, status: student.status },
      { deleted: true, deletedAt: now, deletedBy: actorName }
    );

    this.persist();
    this.syncTenant(tenantId, 'student:soft-deleted');
    return { deleted: true, student };
  }

  // =========================================================================
  // Year-End Promotion Wizard
  // =========================================================================

  private resolveNextGrade(tenant: Tenant, currentGrade: string): string | null {
    const grades = tenant.grades && tenant.grades.length > 0 ? tenant.grades : [...KENYAN_CBC_GRADES];
    const idx = grades.findIndex((g) => g.trim().toLowerCase() === currentGrade.trim().toLowerCase());
    if (idx === -1) return null;
    return idx + 1 < grades.length ? grades[idx + 1] : null;
  }

  previewYearEndPromotion(
    tenantId: string,
    input: { grade: string; section?: string }
  ): {
    fromGrade: string;
    nextGrade: string | null;
    rows: PromotionPreviewRow[];
  } {
    const tenant = this.requireTenant(tenantId);
    const fromGrade = (input.grade || '').trim();
    if (!fromGrade) {
      throw new ConflictError('Select a source grade to preview promotions.', 400);
    }
    const sectionFilter =
      input.section && input.section.trim() && input.section.trim() !== 'All'
        ? input.section.trim()
        : null;

    const nextGrade = this.resolveNextGrade(tenant, fromGrade);
    const defaultAction: PromotionAction = nextGrade ? 'Promote' : 'Graduate';

    const cohortStudents = this.state.students.filter(
      (s) =>
        s.tenantId === tenantId &&
        !s.deleted &&
        s.status === 'Active' &&
        s.grade.trim().toLowerCase() === fromGrade.toLowerCase() &&
        (!sectionFilter || s.section.trim().toLowerCase() === sectionFilter.toLowerCase())
    );

    const rows: PromotionPreviewRow[] = cohortStudents.map((s) => {
      const openInvoices = this.state.invoices.filter(
        (i) =>
          i.tenantId === tenantId &&
          i.studentId === s.id &&
          i.balance > 0 &&
          !i.carriedForwardToTerm
      );
      const outstandingFeeBalance = openInvoices.reduce((sum, i) => sum + i.balance, 0);
      return {
        studentId: s.id,
        studentCode: s.studentCode,
        fullName: s.fullName,
        currentGrade: s.grade,
        currentSection: s.section,
        defaultAction,
        nextGrade: nextGrade || 'Graduated',
        outstandingFeeBalance,
        creditBalance: Math.max(0, Number(s.creditBalance || 0)),
      };
    });

    return { fromGrade, nextGrade, rows };
  }

  executeYearEndPromotion(
    tenantId: string,
    input: {
      fromGrade: string;
      items: PromotionExecuteItem[];
      carryForwardFees?: boolean;
      fromTerm?: string;
      toTerm?: string;
      toTermId?: string;
      dueDate?: string;
      statusDate?: string;
    },
    actor: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>,
    ip?: string
  ): PromotionExecuteResult {
    const tenant = this.requireTenant(tenantId);
    if (!Array.isArray(input.items) || input.items.length === 0) {
      throw new ConflictError('Provide at least one student promotion decision.', 400);
    }

    let toTermName = (input.toTerm || '').trim();
    let toTermId = input.toTermId;
    // Without an explicit fromTerm, carry open balances from every term other than the target one.
    // (tenant.currentTerm is no longer the "old" term once the new term has been set as current.)
    const fromTermName = (input.fromTerm || '').trim();
    const dueDate =
      (input.dueDate || '').trim() || addDaysIso(new Date().toISOString().slice(0, 10), 30);

    if (input.carryForwardFees) {
      if (toTermId) {
        const resolvedTarget = this.assertTermOpen(tenantId, {
          termId: toTermId,
          actionLabel: 'Carrying balances forward during promotion',
        });
        if (resolvedTarget) {
          toTermName = resolvedTarget.name;
          toTermId = resolvedTarget.id;
        }
      } else {
        if (!toTermName) {
          throw new ConflictError(
            'Select or enter a target term when carrying fee balances forward.',
            400
          );
        }
        const resolvedTarget = this.assertTermOpen(tenantId, {
          termName: toTermName,
          actionLabel: `Carrying balances forward to ${toTermName}`,
        });
        if (resolvedTarget) {
          toTermName = resolvedTarget.name;
          toTermId = resolvedTarget.id;
        }
      }
      if (toTermName.toLowerCase() === fromTermName.toLowerCase() && !toTermId) {
        throw new ConflictError(
          'Target carry-forward term must differ from the source term.',
          400
        );
      }
    }

    const effectiveDate =
      input.statusDate && /^\d{4}-\d{2}-\d{2}$/.test(input.statusDate.trim())
        ? input.statusDate.trim()
        : new Date().toISOString().slice(0, 10);

    let promotedCount = 0;
    let heldBackCount = 0;
    let graduatedCount = 0;
    let carriedForwardCount = 0;
    let carriedForwardAmount = 0;
    let skippedCount = 0;

    const actorName = actor.fullName || actor.email;
    const defaultNextGrade = this.resolveNextGrade(tenant, input.fromGrade || '');

    for (const item of input.items) {
      const student = this.state.students.find(
        (s) => s.id === item.studentId && s.tenantId === tenantId && !s.deleted
      );
      if (!student || student.status !== 'Active') {
        skippedCount += 1;
        continue;
      }

      if (item.action === 'Graduate') {
        student.status = 'Graduated';
        student.statusDate = effectiveDate;
        student.statusReason = (item.reason || '').trim() || 'Year-end graduation';
        graduatedCount += 1;
      } else if (item.action === 'Hold Back') {
        if (item.targetSection && item.targetSection.trim()) {
          student.section = item.targetSection.trim();
        }
        heldBackCount += 1;
      } else {
        const nextGrade =
          (item.targetGrade || '').trim() || this.resolveNextGrade(tenant, student.grade) || defaultNextGrade;
        if (!nextGrade) {
          student.status = 'Graduated';
          student.statusDate = effectiveDate;
          student.statusReason = (item.reason || '').trim() || 'Completed final grade — graduated';
          graduatedCount += 1;
        } else {
          student.grade = nextGrade;
          if (item.targetSection && item.targetSection.trim()) {
            student.section = item.targetSection.trim();
          }
          promotedCount += 1;
        }
      }

      if (input.carryForwardFees && student.status === 'Active' && toTermName) {
        const carried = this.carryForwardSingleStudentBalance(
          tenant,
          student,
          fromTermName,
          toTermName,
          toTermId,
          dueDate,
          actorName
        );
        if (carried) {
          carriedForwardCount += 1;
          carriedForwardAmount += carried.carriedArrears;
        }
      }
    }

    const summary = `Year-end promotion from ${input.fromGrade}: ${promotedCount} promoted, ${heldBackCount} held back, ${graduatedCount} graduated${
      input.carryForwardFees
        ? `, ${carriedForwardCount} invoice(s) carried forward to ${toTermName} (${tenant.currency} ${carriedForwardAmount.toLocaleString()} arrears)`
        : ''
    }.`;

    this.appendLifecycleAudit(
      tenantId,
      actor,
      'YEAR_END_PROMOTION',
      'PromotionBatch',
      `promo-${randomUUID().slice(0, 6)}`,
      summary,
      undefined,
      { fromGrade: input.fromGrade, count: input.items.length },
      { promotedCount, heldBackCount, graduatedCount, carriedForwardCount, carriedForwardAmount }
    );

    if (input.carryForwardFees && carriedForwardCount > 0) {
      this.appendFinanceAudit(
        tenantId,
        actor,
        'PROMOTION_CARRY_FORWARD',
        'PromotionBatch',
        input.fromGrade,
        { fromTerm: fromTermName },
        { toTerm: toTermName, carriedForwardCount, carriedForwardAmount },
        ip
      );
    }

    this.persist();
    this.pushNotification(
      tenantId,
      'admission',
      `Year-End Promotion Completed (${input.fromGrade})`,
      summary,
      'admissions'
    );
    this.syncTenant(tenantId, 'student:promotion-executed');

    return {
      promotedCount,
      heldBackCount,
      graduatedCount,
      carriedForwardCount,
      carriedForwardAmount,
      skippedCount,
    };
  }

  // =========================================================================
  // Bulk Import (CSV / Excel) with Dry-Run Preview & Learner Cap Check
  // =========================================================================

  private normalizeImportDateValue(rawVal: unknown): string {
    if (typeof rawVal === 'number' && Number.isFinite(rawVal) && rawVal > 2000 && rawVal < 80000) {
      // Excel serial date (days since 1899-12-30)
      const utcMs = Math.round((rawVal - 25569) * 86400 * 1000);
      return new Date(utcMs).toISOString().slice(0, 10);
    }
    const str = String(rawVal ?? '').trim();
    if (!str) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    const dmy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(str);
    if (dmy) {
      const dd = dmy[1].padStart(2, '0');
      const mm = dmy[2].padStart(2, '0');
      const yyyy = dmy[3];
      return `${yyyy}-${mm}-${dd}`;
    }
    return str;
  }

  private normalizeImportGender(raw: string): 'Female' | 'Male' | 'Non-binary' | null {
    const norm = raw.trim().toLowerCase();
    if (!norm) return 'Female';
    if (norm === 'f' || norm === 'female') return 'Female';
    if (norm === 'm' || norm === 'male') return 'Male';
    if (norm === 'nb' || norm === 'non-binary' || norm === 'nonbinary' || norm === 'other') {
      return 'Non-binary';
    }
    return null;
  }

  importStudents(
    tenantId: string,
    input: {
      dryRun?: boolean;
      skipInvalid?: boolean;
      csvText?: string;
      fileBase64?: string;
      fileName?: string;
      rows?: Array<Record<string, unknown>>;
    },
    actor: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>
  ): StudentImportResult {
    const tenant = this.requireTenant(tenantId);
    const dryRun = input.dryRun !== false;

    let rawRecords: Array<Record<string, unknown>> = [];
    if (Array.isArray(input.rows)) {
      rawRecords = input.rows;
    } else if (typeof input.fileBase64 === 'string' && input.fileBase64.trim()) {
      const cleanBase64 = input.fileBase64.replace(/^data:[^;]+;base64,/, '').trim();
      const buf = Buffer.from(cleanBase64, 'base64');
      const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
      const firstSheet = wb.SheetNames[0];
      if (!firstSheet) {
        throw new ConflictError('Uploaded workbook contains no readable worksheet.', 400);
      }
      rawRecords = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[firstSheet], {
        defval: '',
      });
    } else if (typeof input.csvText === 'string' && input.csvText.trim()) {
      const wb = XLSX.read(input.csvText, { type: 'string', raw: true });
      const firstSheet = wb.SheetNames[0];
      if (!firstSheet) {
        throw new ConflictError('CSV input contains no readable rows.', 400);
      }
      rawRecords = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[firstSheet], {
        defval: '',
      });
    } else {
      throw new ConflictError('Provide a CSV, Excel file, or parsed rows to import.', 400);
    }

    if (rawRecords.length === 0) {
      throw new ConflictError('No student rows found in uploaded file.', 400);
    }
    if (rawRecords.length > 2000) {
      throw new ConflictError('Bulk import supports up to 2,000 rows per batch.', 400);
    }

    const existingCodes = new Set(
      this.state.students
        .filter((s) => s.tenantId === tenantId && !s.deleted)
        .map((s) => s.studentCode.trim().toUpperCase())
    );
    const existingUpis = new Set(
      this.state.students
        .filter((s) => s.tenantId === tenantId && !s.deleted)
        .map((s) => s.upi.trim().toUpperCase())
    );
    const seenBatchCodes = new Set<string>();
    const seenBatchUpis = new Set<string>();
    // Same name + date of birth + guardian phone is the same child (re-uploaded file, double entry).
    const childKey = (name: string, dob: string, phone: string) =>
      `${name.trim().toLowerCase()}|${dob}|${phone}`;
    const existingChildKeys = new Set(
      this.state.students
        .filter(
          (s) =>
            s.tenantId === tenantId &&
            !s.deleted &&
            (s.status === 'Active' || s.status === 'On Leave')
        )
        .map((s) => childKey(s.fullName, s.dateOfBirth, s.guardianPhone))
    );
    const seenBatchChildKeys = new Set<string>();

    const pickField = (rec: Record<string, unknown>, aliases: string[]): unknown => {
      const normalizedKeys = new Map<string, unknown>();
      for (const [k, v] of Object.entries(rec)) {
        normalizedKeys.set(k.trim().toLowerCase().replace(/[\s_-]+/g, ''), v);
      }
      for (const alias of aliases) {
        const val = normalizedKeys.get(alias.toLowerCase().replace(/[\s_-]+/g, ''));
        if (val !== undefined && String(val).trim() !== '') return val;
      }
      return '';
    };

    const allowedGrades = tenant.grades && tenant.grades.length > 0 ? tenant.grades : [...KENYAN_CBC_GRADES];
    const validations: StudentImportRowValidation[] = [];

    rawRecords.forEach((rec, index) => {
      const rowNumber = index + 1;
      const errors: string[] = [];

      const rawStringMap: Record<string, string> = {};
      for (const [k, v] of Object.entries(rec)) {
        rawStringMap[k] = String(v ?? '').trim();
      }

      const fullName = String(
        pickField(rec, ['fullName', 'full name', 'studentName', 'student name', 'learnerName', 'name'])
      ).trim();
      if (fullName.length < 2) {
        errors.push('Full name is required (min 2 characters).');
      }

      const rawGrade = String(pickField(rec, ['grade', 'class', 'form', 'level'])).trim();
      const matchedGrade = allowedGrades.find(
        (g) => g.trim().toLowerCase() === rawGrade.toLowerCase()
      );
      if (!rawGrade) {
        errors.push('Grade / class is required.');
      } else if (!matchedGrade) {
        errors.push(`Grade "${rawGrade}" is not configured for ${tenant.name}.`);
      }
      const finalGrade = matchedGrade || rawGrade || allowedGrades[0] || 'Grade 9';

      const validStreams = getStreamsForGrade(tenant, finalGrade);
      const rawSection = String(pickField(rec, ['section', 'stream'])).trim();
      const finalSection =
        rawSection ||
        validStreams[0] ||
        tenant.sections[0] ||
        'A';

      const rawGender = String(pickField(rec, ['gender', 'sex'])).trim();
      const gender = this.normalizeImportGender(rawGender);
      if (!gender) {
        errors.push(`Invalid gender "${rawGender}" (use Female, Male, or Non-binary).`);
      }

      const dobRaw = pickField(rec, ['dateOfBirth', 'date of birth', 'dob', 'birthdate']);
      const normalizedDob = this.normalizeImportDateValue(dobRaw);
      let validatedDob = normalizedDob;
      try {
        validatedDob = this.validateStudentDateOfBirth(normalizedDob, finalGrade);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : 'Invalid date of birth.');
      }

      const guardianName = String(
        pickField(rec, ['guardianName', 'guardian name', 'parentName', 'parent name', 'parent'])
      ).trim();
      if (guardianName.length < 2) {
        errors.push('Guardian / Parent name is required.');
      }

      const rawPhone = String(
        pickField(rec, ['guardianPhone', 'guardian phone', 'parentPhone', 'phone', 'mobile'])
      ).trim();
      let normalizedPhone = rawPhone;
      try {
        normalizedPhone = this.validateAndNormalizeKenyanPhone(rawPhone, 'Guardian phone');
      } catch (err) {
        errors.push(err instanceof Error ? err.message : 'Invalid Kenyan guardian phone.');
      }

      const guardianEmail = String(
        pickField(rec, ['guardianEmail', 'guardian email', 'parentEmail', 'email'])
      ).trim();
      if (guardianEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guardianEmail)) {
        errors.push(`Invalid guardian email "${guardianEmail}".`);
      }

      if (rawSection && matchedGrade && !validStreams.includes(rawSection)) {
        errors.push(`Stream "${rawSection}" does not exist for ${finalGrade}.`);
      }

      if (
        fullName.length >= 2 &&
        /^\d{4}-\d{2}-\d{2}$/.test(validatedDob) &&
        /^\+254\d{9}$/.test(normalizedPhone)
      ) {
        const key = childKey(fullName, validatedDob, normalizedPhone);
        if (existingChildKeys.has(key)) {
          errors.push(`${fullName} is already enrolled with the same date of birth and guardian phone.`);
        } else if (seenBatchChildKeys.has(key)) {
          errors.push(`${fullName} appears twice in this import (same date of birth and guardian phone).`);
        } else {
          seenBatchChildKeys.add(key);
        }
      }

      const rawCode = String(
        pickField(rec, ['studentCode', 'student code', 'admissionNumber', 'admission no', 'adm no', 'code'])
      )
        .trim()
        .toUpperCase();
      if (rawCode) {
        if (existingCodes.has(rawCode)) {
          errors.push(`Student code "${rawCode}" already exists in ${tenant.name}.`);
        } else if (seenBatchCodes.has(rawCode)) {
          errors.push(`Duplicate student code "${rawCode}" inside import batch.`);
        } else {
          seenBatchCodes.add(rawCode);
        }
      }

      const rawUpi = String(pickField(rec, ['upi', 'nemis', 'nemis upi'])).trim().toUpperCase();
      if (rawUpi) {
        if (existingUpis.has(rawUpi)) {
          errors.push(`NEMIS / UPI "${rawUpi}" already exists in ${tenant.name}.`);
        } else if (seenBatchUpis.has(rawUpi)) {
          errors.push(`Duplicate NEMIS / UPI "${rawUpi}" inside import batch.`);
        } else {
          seenBatchUpis.add(rawUpi);
        }
      }

      const enrolledRaw = pickField(rec, ['enrolledAt', 'enrolled at', 'enrolmentDate', 'enrollment date']);
      const normalizedEnrolled = this.normalizeImportDateValue(enrolledRaw);
      const enrolledAt =
        normalizedEnrolled && /^\d{4}-\d{2}-\d{2}$/.test(normalizedEnrolled)
          ? normalizedEnrolled
          : new Date().toISOString().slice(0, 10);

      validations.push({
        rowNumber,
        raw: rawStringMap,
        valid: errors.length === 0,
        errors,
        ...(errors.length === 0 && gender
          ? {
              normalized: {
                fullName,
                grade: finalGrade,
                section: finalSection,
                gender,
                dateOfBirth: validatedDob,
                studentCode: rawCode || 'AUTO',
                upi: rawUpi || 'AUTO',
                guardianName,
                guardianEmail,
                guardianPhone: normalizedPhone,
                enrolledAt,
              },
            }
          : {}),
      });
    });

    const validRows = validations.filter((v) => v.valid && v.normalized);
    const errorCount = validations.length - validRows.length;
    const learnerCap = this.getTenantLearnerCap(tenant);
    const currentActiveCount = this.countEnrolledLearnersForCap(tenantId);
    const remainingCapacity = Math.max(0, learnerCap - currentActiveCount);
    const capExceeded = validRows.length > remainingCapacity;

    if (dryRun) {
      return {
        dryRun: true,
        totalRows: validations.length,
        validCount: validRows.length,
        errorCount,
        importedCount: 0,
        currentActiveCount,
        learnerCap,
        remainingCapacity,
        capExceeded,
        rows: validations,
        createdStudents: [],
      };
    }

    if (errorCount > 0 && !input.skipInvalid) {
      throw new ConflictError(
        `Bulk import blocked: ${errorCount} row(s) contain validation errors. Fix the errors or enable "Import valid rows only".`,
        400
      );
    }
    if (validRows.length === 0) {
      throw new ConflictError('No valid learner rows to import.', 400);
    }
    if (capExceeded) {
      throw new ConflictError(
        `Learner cap exceeded: attempting to import ${validRows.length} learner(s) with only ${remainingCapacity} slot(s) remaining (${currentActiveCount}/${learnerCap} capacity).`,
        409
      );
    }

    const currentTermEntity = this.resolveTenantTerm(tenantId, { termName: tenant.currentTerm });
    const createdStudents: Student[] = [];
    const nowIso = new Date().toISOString();

    for (const row of validRows) {
      const norm = row.normalized!;
      const studentCode =
        norm.studentCode && norm.studentCode !== 'AUTO'
          ? norm.studentCode
          : this.nextStudentCode(tenantId);
      const upi =
        norm.upi && norm.upi !== 'AUTO' ? norm.upi : this.nextUniqueUpi(tenantId);

      const student: Student = {
        id: `stu-${randomUUID().slice(0, 8)}`,
        tenantId,
        studentCode,
        upi,
        fullName: norm.fullName,
        grade: norm.grade,
        section: norm.section,
        guardianName: norm.guardianName,
        guardianEmail: norm.guardianEmail,
        guardianPhone: norm.guardianPhone,
        gender: norm.gender,
        dateOfBirth: norm.dateOfBirth,
        enrolledAt: norm.enrolledAt,
        status: 'Active',
        creditBalance: 0,
      };
      this.state.students.unshift(student);
      createdStudents.push(student);

      const feeStruct =
        this.state.feeStructures.find((f) => f.tenantId === tenantId && f.grade === student.grade) ||
        this.state.feeStructures.find((f) => f.tenantId === tenantId);
      const totalAmount = feeStruct ? feeStruct.totalFee : 4800;

      const invoice: FeeInvoice = {
        id: `inv-${randomUUID().slice(0, 8)}`,
        tenantId,
        termId: currentTermEntity?.id,
        invoiceNumber: this.nextInvoiceNumber(tenant),
        studentId: student.id,
        studentName: student.fullName,
        studentCode: student.studentCode,
        grade: student.grade,
        term: currentTermEntity?.name || tenant.currentTerm,
        dueDate: '2026-12-01',
        totalAmount,
        paidAmount: 0,
        balance: totalAmount,
        status: 'Pending',
        payments: [],
        createdAt: nowIso,
      };
      this.applySiblingDiscountIfEligible(tenant, student, invoice);
      this.state.invoices.unshift(invoice);
    }

    this.appendLifecycleAudit(
      tenantId,
      actor,
      'STUDENT_BULK_IMPORT',
      'StudentImportBatch',
      `imp-${randomUUID().slice(0, 6)}`,
      `Bulk-imported ${createdStudents.length} learner(s) (${errorCount} skipped).`,
      input.fileName ? `Source: ${input.fileName}` : undefined,
      null,
      { importedCount: createdStudents.length, errorCount }
    );

    this.persist();
    this.pushNotification(
      tenantId,
      'admission',
      `Bulk Student Import Complete (${createdStudents.length})`,
      `${createdStudents.length} learner(s) enrolled and invoiced for ${currentTermEntity?.name || tenant.currentTerm}.`,
      'admissions'
    );
    this.syncTenant(tenantId, 'student:bulk-imported');

    return {
      dryRun: false,
      totalRows: validations.length,
      validCount: validRows.length,
      errorCount,
      importedCount: createdStudents.length,
      currentActiveCount: currentActiveCount + createdStudents.length,
      learnerCap,
      remainingCapacity: Math.max(0, learnerCap - (currentActiveCount + createdStudents.length)),
      capExceeded: false,
      rows: validations,
      createdStudents,
    };
  }

  // =========================================================================
  // Student Portal Toggle & Read-Only Account Provisioning
  // =========================================================================

  updateTenantStudentPortal(
    tenantId: string,
    enabled: boolean,
    actor: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>
  ): Tenant {
    const tenant = this.requireTenant(tenantId);
    const nextEnabled = Boolean(enabled);
    tenant.studentPortalEnabled = nextEnabled;

    // Immediately invalidate active Student portal sessions if portal is turned off
    if (!nextEnabled) {
      (this.state.users || []).forEach((u) => {
        if (u.tenantId === tenantId && u.role === 'Student') {
          u.tokenVersion = (u.tokenVersion ?? 0) + 1;
        }
      });
    }

    this.persist();
    this.pushNotification(
      tenantId,
      'announcement',
      `Student Portal ${nextEnabled ? 'Enabled' : 'Disabled'}`,
      `${actor.fullName || actor.email} ${nextEnabled ? 'enabled' : 'disabled'} read-only Student Portal logins for ${tenant.name}.`,
      'settings'
    );
    this.syncTenant(tenantId, 'tenant:student-portal-updated');
    return tenant;
  }

  async provisionStudentPortalAccount(
    actor: Pick<TenantUser, 'id' | 'fullName' | 'email' | 'role'>,
    tenantId: string,
    studentId: string,
    input?: { email?: string; resetOneTimePassword?: boolean }
  ): Promise<{ user: TenantUser; oneTimePassword?: string; student: Student }> {
    const tenant = this.requireTenant(tenantId);
    if (!tenant.studentPortalEnabled) {
      throw new ConflictError(
        `Student portal logins are disabled for ${tenant.name}. Enable Student Portal in School Settings first.`,
        403
      );
    }

    const student = this.state.students.find(
      (s) => s.id === studentId && s.tenantId === tenantId && !s.deleted
    );
    if (!student) {
      throw new ConflictError('Student record not found.', 404);
    }
    if (student.status === 'Transferred' || student.status === 'Withdrawn') {
      throw new ConflictError(
        `Cannot provision a portal account for a ${student.status} learner.`,
        409
      );
    }

    const existing = (this.state.users || []).find(
      (u) =>
        u.tenantId === tenantId &&
        u.role === 'Student' &&
        (u.studentId === student.id || (student.studentUserId && u.id === student.studentUserId))
    );

    if (existing) {
      let oneTimePassword: string | undefined;
      if (input?.resetOneTimePassword) {
        oneTimePassword = generateOneTimePassword();
        existing.passwordHash = await hashPassword(oneTimePassword);
        existing.mustChangePassword = true;
        existing.status = 'Active';
        existing.tokenVersion = (existing.tokenVersion ?? 0) + 1;
        this.appendLifecycleAudit(
          tenantId,
          actor,
          'STUDENT_PORTAL_PROVISIONED',
          'Student',
          student.id,
          `Reset Student Portal one-time password for ${student.fullName} (${existing.email}).`
        );
        this.persist();
        this.syncTenant(tenantId, 'student:portal-account-reset');
      }
      return { user: this.toPublicUser(existing), oneTimePassword, student };
    }

    const domain = this.resolveTenantEmailDomain(tenant);
    const rawEmailInput = (input?.email || '').trim().toLowerCase();
    let finalEmail: string;
    if (rawEmailInput) {
      const atIdx = rawEmailInput.indexOf('@');
      if (atIdx !== -1) {
        const local = rawEmailInput.slice(0, atIdx);
        const dom = rawEmailInput.slice(atIdx + 1);
        this.validateEmailLocalPart(local);
        if (dom !== domain) {
          throw new ConflictError(`Student login email must end with "@${domain}".`, 400);
        }
        finalEmail = `${local}@${domain}`;
      } else {
        this.validateEmailLocalPart(rawEmailInput);
        finalEmail = `${rawEmailInput}@${domain}`;
      }
    } else {
      const cleanCode = student.studentCode
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '.')
        .replace(/^\.+|\.+$/g, '');
      const local = cleanCode.length >= 2 ? cleanCode : `stu.${student.id.slice(-4)}`;
      finalEmail = `${local}@${domain}`;
    }

    if ((this.state.users || []).some((u) => u.email.toLowerCase() === finalEmail)) {
      throw new ConflictError(`An account with email "${finalEmail}" already exists.`, 409);
    }

    const oneTimePassword = generateOneTimePassword();
    const created: StoredTenantUser = {
      id: `usr-${randomUUID().slice(0, 8)}`,
      tenantId: tenant.id,
      fullName: student.fullName,
      email: finalEmail,
      phone: student.guardianPhone,
      role: 'Student',
      studentId: student.id,
      passwordHash: await hashPassword(oneTimePassword),
      status: 'Active',
      mustChangePassword: true,
      tokenVersion: 0,
      allowedModules: [...DEFAULT_ROLE_MODULES.Student],
      createdAt: new Date().toISOString(),
    };

    if (!Array.isArray(this.state.users)) this.state.users = [];
    this.state.users.push(created);
    student.studentUserId = created.id;

    this.appendLifecycleAudit(
      tenantId,
      actor,
      'STUDENT_PORTAL_PROVISIONED',
      'Student',
      student.id,
      `Provisioned read-only Student Portal account (${finalEmail}) for ${student.fullName} (${student.studentCode}).`
    );

    this.persist();
    this.pushNotification(
      tenantId,
      'announcement',
      `Student Portal Account Ready: ${student.fullName}`,
      `Login ${finalEmail} provisioned with one-time password.`,
      'admissions'
    );
    this.syncTenant(tenantId, 'student:portal-provisioned');

    return { user: this.toPublicUser(created), oneTimePassword, student };
  }
}
