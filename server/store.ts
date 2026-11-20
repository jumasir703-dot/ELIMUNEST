import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  addDaysIso,
  ALL_TENANT_MODULES,
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
  getClusterForGrade,
  PUBLIC_EMAIL_DOMAINS,
  sanitizeSchoolEmailDomain,
  getLessonsPerWeekForSubject,
  getStreamsForGrade,
  getSubjectsForLevel,
  getTeacherAssignedSubjectsForCohort,
  isDateInLeaveChit,
  isSingleTeacherGrade,
  isTeacherAssignedToCohort,
  KENYAN_CBC_CLUSTERS,
  KENYAN_CBC_GRADES,
  KENYAN_CBC_SUBJECTS,
  MAX_FEE_VOTELINES,
  type AdminAuditEntry,
  type AdmissionApplication,
  type AdmissionStage,
  type Announcement,
  type ApprovalCommittee,
  type ApprovalDecision,
  type ApprovalSignOffRecord,
  type AttendanceRecord,
  type AttendanceStatus,
  type BudgetAllocation,
  type BudgetApprovalStatus,
  type CbcClusterId,
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
  type ExpenseAttachment,
  type ExpenseAttachmentType,
  type ExpenseCategory,
  type ExpenseStatus,
  type FeeInvoice,
  type FeeStructure,
  type FeeVoteline,
  type IndependentVotelineItem,
  type IndependentVotelinePayment,
  type LeaveOutChit,
  type MpesaEnvironment,
  type MpesaTransactionLog,
  type NonTeachingStaffProfile,
  type NotificationCategory,
  type NotificationItem,
  type OnboardingChecklist,
  type PaymentMethod,
  type PayrollEntry,
  type PayrollStatus,
  type PublicSchoolDirectoryItem,
  type ReconciliationChannel,
  type ReconciliationLine,
  type ReconciliationStatus,
  type SchoolExpense,
  type StaffAttendanceRecord,
  type StaffCategory,
  type Student,
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
  type TimetableSlot,
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
  buildSeedUsers,
  computeLetterGrade,
  computeStatutoryDeductions,
  createSeedDatabase,
  DEFAULT_SEED_USER_PASSWORD,
  PERIOD_TIMES,
  type DatabaseState,
  type StoredTenantUser,
} from './seed.ts';
import {
  generateOneTimePassword,
  hashPassword,
  isSessionSecretConfigured,
  verifyPassword,
} from './middleware/adminAuth.ts';

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
const BUNDLED_DB_FILE = path.resolve(process.cwd(), 'data', 'elimunest-db.json');
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
  private kvHydrationPromise: Promise<void> | null = null;
  private kvSyncChain: Promise<void> = Promise.resolve();

  constructor(onBroadcast?: (tenantId: string, eventType: string, payload: unknown) => void) {
    this.onBroadcast = onBroadcast;
    this.state = this.loadOrInitialize();
  }

  setBroadcaster(fn: (tenantId: string, eventType: string, payload: unknown) => void) {
    this.onBroadcast = fn;
  }

  async ensureHydrated(): Promise<void> {
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
            if (parsed && Array.isArray(parsed.tenants) && parsed.tenants.length > 0) {
              const { state: migrated } = this.migrateAndNormalizeState(parsed, false);
              this.state = migrated;
              this.writeDiskOnly(migrated);
              return;
            }
          }
          // KV has no snapshot yet: seed it from current state
          await this.writeStateToKv(this.state);
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

  private loadOrInitialize(): DatabaseState {
    try {
      const candidateFiles = [
        DB_FILE,
        LEGACY_DB_FILE,
        BUNDLED_DB_FILE !== DB_FILE ? BUNDLED_DB_FILE : '',
      ].filter(Boolean);
      const sourceFile = candidateFiles.find((filePath) => fs.existsSync(filePath)) || null;
      if (sourceFile) {
        const raw = fs.readFileSync(sourceFile, 'utf-8');
        const parsed = JSON.parse(raw) as DatabaseState;
        if (parsed && Array.isArray(parsed.tenants) && parsed.tenants.length > 0) {
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
    const seed = createSeedDatabase();
    this.persist(seed);
    return seed;
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
          if (!parsed.mpesaSecrets || typeof parsed.mpesaSecrets !== 'object') {
            parsed.mpesaSecrets = {};
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
          // Backfill default distinct Paybill configs onto the 3 seeded demo campuses if unclaimed
          const seedMpesaDefaults: Record<
            string,
            { paybill: string; key: string; secret: string; passkey: string; bank: string }
          > = {
            'tenant-oakridge': {
              paybill: '522522',
              key: 'oakridge_daraja_live_key_01',
              secret: 'oakridge-sandbox-secret-7a91',
              passkey: 'oakridge-lipa-passkey-2c88',
              bank: 'KCB School Collection A/C 1104829104',
            },
            'tenant-westfield': {
              paybill: '522544',
              key: 'westfield_daraja_key_02',
              secret: 'westfield-sandbox-secret-4b19',
              passkey: 'westfield-lipa-passkey-9e04',
              bank: 'Equity Bank Mombasa Collection A/C',
            },
            'tenant-stjude': {
              paybill: '522566',
              key: 'stjude_daraja_key_03',
              secret: 'stjude-sandbox-secret-3f50',
              passkey: 'stjude-lipa-passkey-6d11',
              bank: 'Stanbic Bank Kisumu USD/KES Fee A/C',
            },
          };
          parsed.tenants.forEach((t) => {
            const def = seedMpesaDefaults[t.id];
            if (def && !t.mpesaConfig) {
              const paybillClaimed = parsed.tenants.some(
                (other) => other.id !== t.id && other.mpesaConfig?.paybillNumber === def.paybill
              );
              if (!paybillClaimed) {
                t.mpesaConfig = {
                  enabled: true,
                  environment: 'Sandbox',
                  paybillNumber: def.paybill,
                  accountName: `${t.name} Fees`,
                  accountReferenceFormat: 'Student Code',
                  consumerKey: def.key,
                  hasConsumerSecret: true,
                  consumerSecretMasked: `••••${def.secret.slice(-4)}`,
                  hasPasskey: true,
                  passkeyMasked: `••••${def.passkey.slice(-4)}`,
                  callbackUrl: `/api/mpesa/c2b-callback?paybill=${def.paybill}`,
                  settlementBank: def.bank,
                  updatedAt: '2026-09-01T08:00:00Z',
                  updatedBy: 'System Seed',
                };
                parsed.mpesaSecrets![t.id] = {
                  consumerSecret: def.secret,
                  passkey: def.passkey,
                };
                dirty = true;
              }
            }
          });
          if (!Array.isArray(parsed.users) || parsed.users.length === 0) {
            parsed.users = buildSeedUsers();
            dirty = true;
          } else {
            const seedUsers = buildSeedUsers();
            const devUser = seedUsers.find((u) => u.role === 'Developer');
            if (
              devUser &&
              !parsed.users.some(
                (u) => u.role === 'Developer' || u.email.toLowerCase() === devUser.email.toLowerCase()
              )
            ) {
              parsed.users.unshift(devUser);
              dirty = true;
            }
            const seedPhonesByEmail = new Map(
              seedUsers.map((su) => [su.email.toLowerCase(), su.phone])
            );
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
              if (!u.phone) {
                const seededPhone = seedPhonesByEmail.get(u.email.toLowerCase());
                if (seededPhone) {
                  u.phone = seededPhone;
                  dirty = true;
                }
              }
            });
          }

    return { state: parsed, dirty };
  }

  private writeDiskOnly(nextState: DatabaseState) {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmpFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(nextState, null, 2), 'utf-8');
    fs.renameSync(tmpFile, DB_FILE);
  }

  private persist(nextState: DatabaseState = this.state) {
    this.writeDiskOnly(nextState);
    if (isKvConfigured()) {
      this.kvSyncChain = this.kvSyncChain.then(() => this.writeStateToKv(nextState));
    }
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
      ['independentVotelines', this.state.independentVotelines || []],
      ['mpesaTransactions', this.state.mpesaTransactions || []],
      ['expenses', this.state.expenses],
      ['etimsChecks', this.state.etimsChecks || []],
      ['reconciliationLines', this.state.reconciliationLines || []],
      ['payrollEntries', this.state.payrollEntries || []],
      ['budgets', this.state.budgets || []],
      ['approvalRecords', this.state.approvalRecords || []],
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

      const tenantStudents = this.state.students.filter((s) => s.tenantId === tenant.id);
      const activeLearners = tenantStudents.filter((s) => s.status === 'Active').length;
      const cap =
        typeof tenant.learnerCap === 'number' && tenant.learnerCap > 0
          ? tenant.learnerCap
          : DEFAULT_TIER_LEARNER_CAPS[plan];
      const utilizationPct = cap > 0 ? Math.min(999, Math.round((tenantStudents.length / cap) * 1000) / 10) : 0;

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

  private assertLearnerCap(tenant: Tenant) {
    const cap =
      typeof tenant.learnerCap === 'number' && tenant.learnerCap > 0
        ? tenant.learnerCap
        : DEFAULT_TIER_LEARNER_CAPS[tenant.plan] || 600;
    const currentCount = this.state.students.filter((s) => s.tenantId === tenant.id).length;
    if (currentCount >= cap) {
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
      const tenantStudents = this.state.students.filter((s) => s.tenantId === tenant.id);
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

  getWorkspace(tenantId: string): TenantWorkspaceData {
    const tenant = this.requireTenant(tenantId);
    return {
      tenant,
      tenants: this.state.tenants,
      students: this.state.students.filter((s) => s.tenantId === tenantId),
      admissions: this.state.admissions.filter((a) => a.tenantId === tenantId),
      timetable: this.state.timetable.filter((t) => t.tenantId === tenantId),
      attendance: this.state.attendance.filter((a) => a.tenantId === tenantId),
      staffAttendance: this.state.staffAttendance.filter((a) => a.tenantId === tenantId),
      leaveOutChits: this.state.leaveOutChits.filter((c) => c.tenantId === tenantId),
      examCycles: this.state.examCycles.filter((e) => e.tenantId === tenantId),
      examResults: this.state.examResults.filter((r) => r.tenantId === tenantId),
      feeStructures: this.state.feeStructures.filter((f) => f.tenantId === tenantId),
      invoices: this.state.invoices.filter((i) => i.tenantId === tenantId),
      independentVotelines: (this.state.independentVotelines || []).filter(
        (v) => v.tenantId === tenantId
      ),
      mpesaTransactions: (this.state.mpesaTransactions || []).filter(
        (m) => m.tenantId === tenantId
      ),
      expenses: this.state.expenses.filter((e) => e.tenantId === tenantId),
      etimsChecks: (this.state.etimsChecks || []).filter((e) => e.tenantId === tenantId),
      reconciliationLines: (this.state.reconciliationLines || []).filter(
        (r) => r.tenantId === tenantId
      ),
      payrollEntries: (this.state.payrollEntries || []).filter((p) => p.tenantId === tenantId),
      budgets: (this.state.budgets || []).filter((b) => b.tenantId === tenantId),
      approvalRecords: (this.state.approvalRecords || []).filter(
        (a) => a.tenantId === tenantId
      ),
      announcements: this.state.announcements.filter((a) => a.tenantId === tenantId),
      messages: this.state.messages.filter((m) => m.tenantId === tenantId),
      whatsappDispatches: (this.state.whatsappDispatches || []).filter(
        (w) => w.tenantId === tenantId
      ),
      notifications: this.state.notifications.filter((n) => n.tenantId === tenantId),
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

    // Seed default fee structure for first grade so billing works immediately (scaled to tenant currency)
    const isKes = resolvedCurrency === 'KES';
    const defTuition = isKes ? 32000 : 3800;
    const defLab = isKes ? 2500 : 300;
    const defTech = isKes ? 2000 : 200;
    const defAct = isKes ? 1800 : 150;
    this.state.feeStructures.push({
      id: `fs-${randomUUID().slice(0, 6)}`,
      tenantId: id,
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
    this.state.announcements = this.state.announcements.filter((a) => a.tenantId !== tenantId);
    this.state.messages = this.state.messages.filter((m) => m.tenantId !== tenantId);
    this.state.whatsappDispatches = (this.state.whatsappDispatches || []).filter(
      (w) => w.tenantId !== tenantId
    );
    this.state.mpesaTransactions = (this.state.mpesaTransactions || []).filter(
      (m) => m.tenantId !== tenantId
    );
    if (this.state.mpesaSecrets) {
      delete this.state.mpesaSecrets[tenantId];
    }
    this.state.notifications = this.state.notifications.filter((n) => n.tenantId !== tenantId);
    this.state.users = (this.state.users || []).filter((u) => u.tenantId !== tenantId);

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
      allowedModules: Array.isArray(publicUser.allowedModules)
        ? publicUser.allowedModules
        : [...(DEFAULT_ROLE_MODULES[publicUser.role] || ['analytics'])],
    };
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

  registerUserAccount(input: {
    tenantId?: string;
    fullName: string;
    email: string;
    phone?: string;
    role?: UserRole;
    password: string;
  }): { user: TenantUser; tenant: Tenant } {
    const fullName = (input.fullName || '').trim();
    if (fullName.length < 2) {
      throw new ConflictError('Full name must be at least 2 characters.', 400);
    }

    const password = input.password || '';
    if (password.length < 6) {
      throw new ConflictError('Password must be at least 6 characters.', 400);
    }

    const allowedSignupRoles = new Set<UserRole>([
      'Admin',
      'Registrar',
      'Teacher',
      'Bursar',
      'Parent',
    ]);
    const requestedRole: UserRole = input.role || 'Teacher';
    if (!allowedSignupRoles.has(requestedRole)) {
      throw new ConflictError(
        'Self-registration is restricted to Admin, Registrar, Teacher, Bursar, or Parent accounts.',
        403
      );
    }

    const rawEmail = (input.email || '').trim().toLowerCase();
    const atIndex = rawEmail.indexOf('@');
    if (atIndex === -1 || atIndex !== rawEmail.lastIndexOf('@')) {
      throw new ConflictError(
        'Sign up with your institutional email formatted as yourname@theirschool.',
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
          `No registered school uses "@${emailDomain}". Select a school or register a new school tenant first.`,
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

    const now = new Date().toISOString();
    const newUser: StoredTenantUser = {
      id: `usr-${randomUUID().slice(0, 8)}`,
      tenantId: tenant.id,
      fullName,
      email: rawEmail,
      phone: (input.phone || '').trim() || undefined,
      role: requestedRole,
      passwordHash: hashPassword(password),
      status: 'Active',
      createdAt: now,
      lastLoginAt: now,
    };

    if (!Array.isArray(this.state.users)) this.state.users = [];
    this.state.users.push(newUser);
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

  registerTenantWithAdmin(input: {
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
  }): { user: TenantUser; tenant: Tenant } {
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
        `School domain "@${normalizedDomain}" is already registered to ${existingDomainTenant.name}. Sign in or create a user under that school instead.`,
        409
      );
    }

    const fullName = (input.fullName || '').trim();
    if (fullName.length < 2) {
      throw new ConflictError('Administrator full name must be at least 2 characters.', 400);
    }

    const password = input.password || '';
    if (password.length < 6) {
      throw new ConflictError('Password must be at least 6 characters.', 400);
    }

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
      passwordHash: hashPassword(password),
      status: 'Active',
      createdAt: now,
      lastLoginAt: now,
    };

    if (!Array.isArray(this.state.users)) this.state.users = [];
    this.state.users.push(adminUser);
    this.persist();

    return { user: this.toPublicUser(adminUser), tenant };
  }

  provisionTenantAdminAccount(
    tenant: Tenant,
    adminName: string,
    adminEmail: string,
    password?: string,
    mustChangePassword = false,
    adminPhone?: string
  ): { user: TenantUser; oneTimePassword: string } {
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
        oneTimePassword: password || '',
      };
    }
    const assignedPassword =
      password && password.length >= 6
        ? password
        : mustChangePassword
        ? generateOneTimePassword()
        : DEFAULT_SEED_USER_PASSWORD;
    const now = new Date().toISOString();
    const created: StoredTenantUser = {
      id: `usr-${randomUUID().slice(0, 8)}`,
      tenantId: tenant.id,
      fullName: adminName.trim() || 'School Administrator',
      email,
      phone: (adminPhone || '').trim() || tenant.contactPhone || undefined,
      role: 'Admin',
      passwordHash: hashPassword(assignedPassword),
      status: 'Active',
      mustChangePassword: Boolean(mustChangePassword),
      allowedModules: [...DEFAULT_ROLE_MODULES.Admin],
      createdAt: now,
    };
    this.state.users.push(created);
    this.persist();
    return { user: this.toPublicUser(created), oneTimePassword: assignedPassword };
  }

  changeUserPassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): { user: TenantUser; tenant?: Tenant; emailDomain?: string } {
    const stored = (this.state.users || []).find((u) => u.id === userId);
    if (!stored || stored.status !== 'Active') {
      throw new ConflictError('Account not found or no longer active.', 404);
    }
    if (!currentPassword || !verifyPassword(currentPassword, stored.passwordHash)) {
      throw new ConflictError('Current password is incorrect.', 400);
    }
    const trimmedNew = newPassword || '';
    if (trimmedNew.length < 8) {
      throw new ConflictError('New password must be at least 8 characters.', 400);
    }
    if (trimmedNew === currentPassword) {
      throw new ConflictError(
        'Choose a new password that differs from your temporary 1-time password.',
        400
      );
    }

    stored.passwordHash = hashPassword(trimmedNew);
    stored.mustChangePassword = false;
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

  private maskPhoneNumber(phone: string): string {
    const clean = phone.trim();
    if (clean.length <= 5) return '••••';
    return `${clean.slice(0, 5)}•••${clean.slice(-3)}`;
  }

  requestPasswordResetByPhone(input: { email: string; phone: string }): {
    ok: boolean;
    maskedPhone: string;
    expiresInMinutes: number;
    deliveryChannel: string;
    verificationCode: string;
  } {
    const email = (input.email || '').trim().toLowerCase();
    const phone = (input.phone || '').trim();
    if (!email || !phone) {
      throw new ConflictError('Enter both your account email and registered phone number.', 400);
    }

    const stored = (this.state.users || []).find((u) => u.email.toLowerCase() === email);
    if (!stored || stored.status !== 'Active') {
      throw new ConflictError('No active account matches those credentials.', 404);
    }

    const registeredPhone = this.resolveAccountRecoveryPhone(stored);
    if (!registeredPhone) {
      throw new ConflictError(
        'No recovery phone number is registered on this account. Contact your school or platform administrator.',
        400
      );
    }

    if (!this.phonesMatch(phone, registeredPhone)) {
      throw new ConflictError(
        'Phone number does not match the registered number on file for this account.',
        403
      );
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresInMinutes = 10;
    this.passwordResetChallenges.set(email, {
      code,
      expiresAt: Date.now() + expiresInMinutes * 60_000,
      attempts: 0,
    });

    return {
      ok: true,
      maskedPhone: this.maskPhoneNumber(registeredPhone),
      expiresInMinutes,
      deliveryChannel: 'SMS Phone Verification',
      verificationCode: code,
    };
  }

  verifyPasswordResetByPhone(input: {
    email: string;
    phone: string;
    code: string;
    newPassword: string;
  }): { ok: boolean; email: string } {
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
    if (newPassword.length < 8) {
      throw new ConflictError('New password must be at least 8 characters.', 400);
    }

    const challenge = this.passwordResetChallenges.get(email);
    if (!challenge) {
      throw new ConflictError(
        'No active password reset request found for this email. Request a verification code first.',
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
    if (!stored || stored.status !== 'Active') {
      throw new ConflictError('Account not found or no longer active.', 404);
    }
    const registeredPhone = this.resolveAccountRecoveryPhone(stored);
    if (!registeredPhone || !this.phonesMatch(phone, registeredPhone)) {
      throw new ConflictError('Phone number verification failed for this account.', 403);
    }

    if (challenge.code !== code) {
      challenge.attempts += 1;
      throw new ConflictError('Invalid 6-digit phone verification code.', 400);
    }

    stored.passwordHash = hashPassword(newPassword);
    stored.mustChangePassword = false;
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

  createTenantStaffUser(
    actor: TenantUser,
    tenantId: string,
    input: {
      fullName: string;
      email: string;
      phone?: string;
      role: UserRole;
      allowedModules?: TenantModulePermission[];
    }
  ): { user: TenantUser; oneTimePassword: string } {
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
      passwordHash: hashPassword(oneTimePassword),
      status: 'Active',
      mustChangePassword: true,
      allowedModules,
      createdAt: now,
    };

    if (!Array.isArray(this.state.users)) this.state.users = [];
    this.state.users.push(created);
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

  updateTenantUserAccess(
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
  ): { user: TenantUser; oneTimePassword?: string } {
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
    }

    let oneTimePassword: string | undefined;
    if (patch.resetOneTimePassword) {
      oneTimePassword = generateOneTimePassword();
      target.passwordHash = hashPassword(oneTimePassword);
      target.mustChangePassword = true;
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

  authenticateUser(input: { email: string; password: string }): {
    user: TenantUser;
    tenant?: Tenant;
    emailDomain?: string;
  } {
    const email = (input.email || '').trim().toLowerCase();
    const password = input.password || '';
    if (!email || !password) {
      throw new ConflictError('Enter both your email and password.', 400);
    }

    const stored = (this.state.users || []).find((u) => u.email.toLowerCase() === email);
    if (!stored || !verifyPassword(password, stored.passwordHash)) {
      throw new ConflictError('Invalid email or password.', 401);
    }

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
    const existingCount = this.state.admissions.filter((a) => a.tenantId === tenantId).length;
    const prefix = tenant.slug.slice(0, 3).toUpperCase();
    const now = new Date().toISOString();

    const app: AdmissionApplication = {
      id: `adm-${randomUUID().slice(0, 8)}`,
      tenantId,
      applicationCode: `${prefix}-APP-${202600 + existingCount + 1}`,
      studentName: input.studentName.trim(),
      dateOfBirth: input.dateOfBirth,
      gender: input.gender,
      targetGrade: input.targetGrade,
      assignedSection: input.assignedSection || 'A',
      guardianName: input.guardianName.trim(),
      guardianEmail: input.guardianEmail.trim(),
      guardianPhone: input.guardianPhone.trim(),
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
      const stuCount = this.state.students.filter((s) => s.tenantId === tenantId).length;
      const prefix = tenant.slug.slice(0, 3).toUpperCase();
      enrolledStudent = {
        id: `stu-${randomUUID().slice(0, 8)}`,
        tenantId,
        studentCode: `ADM-${2600 + stuCount + 1}`,
        upi: `KE-${Math.floor(1000000 + Math.random() * 8999999)}A`,
        fullName: app.studentName,
        grade: app.targetGrade,
        section: app.assignedSection,
        guardianName: app.guardianName,
        guardianEmail: app.guardianEmail,
        guardianPhone: app.guardianPhone,
        gender: app.gender,
        dateOfBirth: app.dateOfBirth,
        enrolledAt: new Date().toISOString().slice(0, 10),
        status: 'Active',
      };
      this.state.students.unshift(enrolledStudent);

      const feeStruct =
        this.state.feeStructures.find((f) => f.tenantId === tenantId && f.grade === app.targetGrade) ||
        this.state.feeStructures.find((f) => f.tenantId === tenantId);
      const totalAmount = feeStruct ? feeStruct.totalFee : 4800;
      const invCount = this.state.invoices.filter((i) => i.tenantId === tenantId).length;

      generatedInvoice = {
        id: `inv-${randomUUID().slice(0, 8)}`,
        tenantId,
        invoiceNumber: `${prefix}-INV-${202600 + invCount + 1}`,
        studentId: enrolledStudent.id,
        studentName: enrolledStudent.fullName,
        studentCode: enrolledStudent.studentCode,
        grade: enrolledStudent.grade,
        term: tenant.currentTerm,
        dueDate: '2026-12-01',
        totalAmount,
        paidAmount: 0,
        balance: totalAmount,
        status: 'Pending',
        payments: [],
        createdAt: new Date().toISOString(),
      };
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
    }
  ): { student: Student; invoice: FeeInvoice } {
    const tenant = this.requireTenant(tenantId);
    this.assertLearnerCap(tenant);
    const stuCount = this.state.students.filter((s) => s.tenantId === tenantId).length;
    const prefix = tenant.slug.slice(0, 3).toUpperCase();

    const studentCode =
      input.studentCode && input.studentCode.trim()
        ? input.studentCode.trim().toUpperCase()
        : `ADM-${2600 + stuCount + 1}`;
    const upi =
      input.upi && input.upi.trim()
        ? input.upi.trim().toUpperCase()
        : `KE-${Math.floor(1000000 + Math.random() * 8999999)}M`;

    const resolvedGrade = input.grade || tenant.grades[0] || 'Grade 9';
    const validStreams = getStreamsForGrade(tenant, resolvedGrade);
    const student: Student = {
      id: `stu-${randomUUID().slice(0, 8)}`,
      tenantId,
      studentCode,
      upi,
      fullName: input.fullName.trim(),
      grade: resolvedGrade,
      section: input.section || validStreams[0] || 'A',
      guardianName: input.guardianName.trim(),
      guardianEmail: input.guardianEmail?.trim() || '',
      guardianPhone: input.guardianPhone.trim(),
      gender: input.gender || 'Female',
      dateOfBirth: input.dateOfBirth || '2012-01-01',
      enrolledAt: input.enrolledAt || new Date().toISOString().slice(0, 10),
      status: 'Active',
    };
    this.state.students.unshift(student);

    const feeStruct =
      this.state.feeStructures.find((f) => f.tenantId === tenantId && f.grade === student.grade) ||
      this.state.feeStructures.find((f) => f.tenantId === tenantId);
    const totalAmount = feeStruct ? feeStruct.totalFee : 4800;
    const invCount = this.state.invoices.filter((i) => i.tenantId === tenantId).length;

    const invoice: FeeInvoice = {
      id: `inv-${randomUUID().slice(0, 8)}`,
      tenantId,
      invoiceNumber: `${prefix}-INV-${202600 + invCount + 1}`,
      studentId: student.id,
      studentName: student.fullName,
      studentCode: student.studentCode,
      grade: student.grade,
      term: tenant.currentTerm,
      dueDate: '2026-12-01',
      totalAmount,
      paidAmount: 0,
      balance: totalAmount,
      status: 'Pending',
      payments: [],
      createdAt: new Date().toISOString(),
    };
    this.state.invoices.unshift(invoice);

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

    const times = PERIOD_TIMES[input.period] || { startTime: '08:00', endTime: '08:40' };
    const others = this.state.timetable.filter(
      (s) => s.tenantId === tenantId && s.day === input.day && s.period === input.period && s.id !== input.id
    );

    const classClash = others.find((s) => s.grade === input.grade && s.section === input.section);
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
    const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];
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
        (s) => !(s.tenantId === tenantId && cohortKeySet.has(`${s.grade}::${s.section}`))
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
            const slotsAtTime = tenantSlots.filter(
              (s) => s.day === day && s.period === period
            );
            const classBusy = slotsAtTime.some(
              (s) => s.grade === cohort.grade && s.section === cohort.section
            );
            if (classBusy) continue;

            let freeTeacher: TeacherProfile | undefined;
            if (isSingleTeacherCohort) {
              // Strictly 1 class teacher handles ALL subjects for this Pre-School / Lower Primary cohort
              freeTeacher = qualified.find(
                (t) => !slotsAtTime.some((s) => s.teacherId === t.id)
              );
            } else {
              // Specialist selection: prioritize exact (grade, stream, subject), then (grade, stream), then open to all classes
              const subLower = subject.toLowerCase();
              const classMatchRank = (t: TeacherProfile) => {
                const classes = t.assignedClasses || [];
                if (classes.length === 0) return 2; // Open to all classes
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
                .find((t) => !slotsAtTime.some((s) => s.teacherId === t.id));
            }
            if (!freeTeacher) continue;

            // Pick a free room (prefer lab/ICT room for science/computer subjects if free)
            const preferredRooms = [...rooms].sort((rA, rB) => {
              const score = (r: string) => {
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

            const times = PERIOD_TIMES[period];
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
      'Kenyan Timetable Generated',
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
    }
  ): LeaveOutChit {
    this.requireTenant(tenantId);
    const student = this.state.students.find(
      (s) => s.id === input.studentId && s.tenantId === tenantId
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
    const days = Math.max(1, Math.min(90, Math.round(Number(input.days) || 1)));
    const endDate = addDaysIso(startDate, days - 1);
    const issuedBy = (input.issuedBy || '').trim() || 'Administration Desk';
    const now = new Date().toISOString();

    const chit: LeaveOutChit = {
      id: `loc-${randomUUID().slice(0, 8)}`,
      tenantId,
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
        existing.remarks = chitRemark;
        existing.recordedBy = issuedBy;
        existing.updatedAt = now;
      } else {
        this.state.attendance.push({
          id: `att-${targetDate}-${student.id}`,
          tenantId,
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

    const now = new Date().toISOString();
    const saved: AttendanceRecord[] = [];
    const unexcusedAbsences: string[] = [];

    for (const entry of input.entries) {
      const student = this.state.students.find((s) => s.id === entry.studentId && s.tenantId === tenantId);
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
        existing.remarks = resolvedRemarks;
        existing.recordedBy = input.recordedBy;
        existing.updatedAt = now;
        saved.push(existing);
      } else {
        const rec: AttendanceRecord = {
          id: `att-${input.date}-${student.id}`,
          tenantId,
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
    input: { title: string; term: string; startDate: string; endDate: string }
  ): ExamCycle {
    const tenant = this.requireTenant(tenantId);
    const cycle: ExamCycle = {
      id: `exm-${randomUUID().slice(0, 8)}`,
      tenantId,
      title: input.title.trim(),
      term: input.term.trim() || tenant.currentTerm,
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

  upsertExamScore(
    tenantId: string,
    input: {
      examCycleId: string;
      studentId: string;
      subject: string;
      score: number;
      remarks?: string;
    }
  ): ExamResult {
    this.requireTenant(tenantId);
    const student = this.state.students.find((s) => s.id === input.studentId && s.tenantId === tenantId);
    if (!student) throw new ConflictError('Student not found in tenant.', 404);
    const cycle = this.state.examCycles.find((c) => c.id === input.examCycleId && c.tenantId === tenantId);
    if (!cycle) throw new ConflictError('Exam cycle not found in tenant.', 404);

    const clampedScore = Math.max(0, Math.min(100, Math.round(input.score)));
    const { letterGrade, gpaPoints } = computeLetterGrade(clampedScore, student.grade);
    const now = new Date().toISOString();

    const existing = this.state.examResults.find(
      (r) =>
        r.tenantId === tenantId &&
        r.examCycleId === input.examCycleId &&
        r.studentId === input.studentId &&
        r.subject === input.subject
    );

    if (existing) {
      existing.score = clampedScore;
      existing.letterGrade = letterGrade;
      existing.gpaPoints = gpaPoints;
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
      subject: input.subject,
      score: clampedScore,
      maxScore: 100,
      letterGrade,
      gpaPoints,
      remarks: input.remarks?.trim() || (clampedScore >= 85 ? 'Strong mastery' : 'Term evaluation'),
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
      entries: Array<{ studentId: string; subject: string; score: number; remarks?: string }>;
    }
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

    const isAdminOverride = input.teacherId === '__ADMIN__';
    let teacher: TeacherProfile | undefined;
    let allowedSet: Set<string> | null = null;

    if (!isAdminOverride) {
      teacher = tenant.teachers.find((t) => t.id === input.teacherId);
      if (!teacher) {
        throw new ConflictError('Select a valid teacher before saving results.', 400);
      }
      const tenantSlots = this.state.timetable.filter((s) => s.tenantId === tenantId);
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
        (s) => s.id === entry.studentId && s.tenantId === tenantId
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

      const rawNum = Number(entry.score);
      if (!Number.isFinite(rawNum) || rawNum < 0 || rawNum > 100) {
        throw new ConflictError(
          `Invalid score for ${student.fullName} in ${subject}. Marks must be between 0 and 100.`,
          400
        );
      }
      const clampedScore = Math.max(0, Math.min(100, Math.round(rawNum)));
      const { letterGrade, gpaPoints } = computeLetterGrade(clampedScore, student.grade);

      const existing = this.state.examResults.find(
        (r) =>
          r.tenantId === tenantId &&
          r.examCycleId === cycle!.id &&
          r.studentId === student.id &&
          r.subject.toLowerCase() === subject.toLowerCase()
      );

      if (existing) {
        existing.score = clampedScore;
        existing.letterGrade = letterGrade;
        existing.gpaPoints = gpaPoints;
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
          score: clampedScore,
          maxScore: 100,
          letterGrade,
          gpaPoints,
          remarks:
            entry.remarks?.trim() ||
            (clampedScore >= 85 ? 'Strong mastery' : 'Term evaluation'),
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
    this.requireTenant(tenantId);
    const cycle = this.state.examCycles.find((c) => c.id === examCycleId && c.tenantId === tenantId);
    if (!cycle) throw new ConflictError('Exam cycle not found.', 404);
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

  // Fees & Billing
  upsertFeeStructure(
    tenantId: string,
    input: {
      grade: string;
      term: string;
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
    input: { studentId: string; term: string; dueDate: string; totalAmount: number }
  ): FeeInvoice {
    const tenant = this.requireTenant(tenantId);
    const student = this.state.students.find((s) => s.id === input.studentId && s.tenantId === tenantId);
    if (!student) throw new ConflictError('Student not found in tenant.', 404);

    const count = this.state.invoices.filter((i) => i.tenantId === tenantId).length;
    const prefix = tenant.slug.slice(0, 3).toUpperCase();
    const amount = Math.max(1, Number(input.totalAmount));

    const invoice: FeeInvoice = {
      id: `inv-${randomUUID().slice(0, 8)}`,
      tenantId,
      invoiceNumber: `${prefix}-INV-${202600 + count + 1}`,
      studentId: student.id,
      studentName: student.fullName,
      studentCode: student.studentCode,
      grade: student.grade,
      term: input.term || tenant.currentTerm,
      dueDate: input.dueDate,
      totalAmount: amount,
      paidAmount: 0,
      balance: amount,
      status: 'Pending',
      payments: [],
      createdAt: new Date().toISOString(),
    };
    this.state.invoices.unshift(invoice);
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
    }
  ): FeeInvoice {
    const tenant = this.requireTenant(tenantId);
    const invoice = this.state.invoices.find((i) => i.id === invoiceId && i.tenantId === tenantId);
    if (!invoice) throw new ConflictError('Invoice not found.', 404);

    const payAmount = Math.min(invoice.balance, Math.max(1, Number(input.amount)));
    if (payAmount <= 0) {
      throw new ConflictError('Invoice has no remaining balance.', 400);
    }

    const receiptNumber = `RCT-${Math.floor(10000 + Math.random() * 89999)}`;
    const paidAtIso =
      input.paidAt && !Number.isNaN(Date.parse(input.paidAt))
        ? new Date(input.paidAt).toISOString()
        : new Date().toISOString();

    invoice.payments.push({
      id: `pay-${randomUUID().slice(0, 8)}`,
      receiptNumber,
      amount: payAmount,
      method: input.method,
      reference: input.reference.trim() || receiptNumber,
      paidAt: paidAtIso,
      recordedBy: input.recordedBy || 'Bursar Office',
    });

    invoice.paidAmount += payAmount;
    invoice.balance = Math.max(0, invoice.totalAmount - invoice.paidAmount);
    invoice.status = invoice.balance === 0 ? 'Paid' : 'Partial';

    this.persist();
    this.pushNotification(
      tenantId,
      'fee',
      `Payment Received: ${invoice.studentName}`,
      `${tenant.currency} ${payAmount.toLocaleString()} via ${input.method} (${receiptNumber}). Balance: ${tenant.currency} ${invoice.balance.toLocaleString()}.`,
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
    }
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
    const recordedBy = (input.recordedBy || '').trim() || 'Bursar Office';
    const touchedIds = new Set<string>();
    let processedCount = 0;
    let skippedCount = 0;
    let totalCollected = 0;

    for (const entry of input.entries) {
      const requestedAmount = Math.round(Number(entry.amount));
      if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
        skippedCount += 1;
        continue;
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
        targetInvoice = this.state.invoices.find(
          (i) => i.tenantId === tenantId && i.studentId === entry.studentId && i.balance > 0
        );
      }
      if (!targetInvoice && entry.studentCode) {
        const code = entry.studentCode.trim().toLowerCase();
        targetInvoice = this.state.invoices.find(
          (i) =>
            i.tenantId === tenantId &&
            i.studentCode.trim().toLowerCase() === code &&
            i.balance > 0
        );
      }

      if (!targetInvoice || targetInvoice.balance <= 0) {
        skippedCount += 1;
        continue;
      }

      const payAmount = Math.min(targetInvoice.balance, requestedAmount);
      const method: PaymentMethod =
        entry.method && validMethods.has(entry.method) ? entry.method : 'Bank Transfer';
      const receiptNumber = `RCT-${Math.floor(10000 + Math.random() * 89999)}`;
      const paidAtIso =
        entry.paidAt && !Number.isNaN(Date.parse(entry.paidAt))
          ? new Date(entry.paidAt).toISOString()
          : new Date().toISOString();

      targetInvoice.payments.push({
        id: `pay-${randomUUID().slice(0, 8)}`,
        receiptNumber,
        amount: payAmount,
        method,
        reference: (entry.reference || '').trim() || receiptNumber,
        paidAt: paidAtIso,
        recordedBy,
      });

      targetInvoice.paidAmount += payAmount;
      targetInvoice.balance = Math.max(0, targetInvoice.totalAmount - targetInvoice.paidAmount);
      targetInvoice.status = targetInvoice.balance === 0 ? 'Paid' : 'Partial';

      touchedIds.add(targetInvoice.id);
      processedCount += 1;
      totalCollected += payAmount;
    }

    if (processedCount === 0) {
      throw new ConflictError(
        'No valid open-balance invoices matched the uploaded payment entries.',
        400
      );
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
    }
  ): IndependentVotelineItem[] {
    const tenant = this.requireTenant(tenantId);
    const name = (input.name || '').trim();
    if (!name) {
      throw new ConflictError('Enter an independent voteline name (e.g. Transport Fee or Academic Trip Fee).', 400);
    }
    const amount = Math.round(Number(input.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ConflictError('Enter a positive amount for the independent voteline.', 400);
    }

    const scope = input.targetScope || 'student';
    const term = (input.term || '').trim() || tenant.currentTerm;
    const note = (input.note || '').trim() || undefined;
    const recordedBy = (input.recordedBy || '').trim() || 'Bursar Office';

    let targetStudents: Student[] = [];
    if (scope === 'grade') {
      const targetGrade = (input.grade || '').trim();
      if (!targetGrade) {
        throw new ConflictError('Select a target grade / class for the independent voteline.', 400);
      }
      const gradeStudents = this.state.students.filter(
        (s) => s.tenantId === tenantId && s.grade === targetGrade
      );
      const activeGradeStudents = gradeStudents.filter((s) => s.status === 'Active');
      targetStudents = activeGradeStudents.length > 0 ? activeGradeStudents : gradeStudents;
    } else if (scope === 'all') {
      const allTenantStudents = this.state.students.filter((s) => s.tenantId === tenantId);
      const activeStudents = allTenantStudents.filter((s) => s.status === 'Active');
      targetStudents = activeStudents.length > 0 ? activeStudents : allTenantStudents;
    } else {
      let stu: Student | undefined;
      if (input.studentId) {
        stu = this.state.students.find((s) => s.id === input.studentId && s.tenantId === tenantId);
      }
      if (!stu && input.invoiceId) {
        const inv = this.state.invoices.find(
          (i) => i.id === input.invoiceId && i.tenantId === tenantId
        );
        if (inv) {
          stu = this.state.students.find((s) => s.id === inv.studentId && s.tenantId === tenantId);
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
        studentId: student.id,
        studentName: student.fullName,
        studentCode: student.studentCode,
        grade: student.grade,
        invoiceId: linkedInvoice?.id,
        invoiceNumber: linkedInvoice?.invoiceNumber,
        term,
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
    }
  ): IndependentVotelineItem {
    const tenant = this.requireTenant(tenantId);
    if (!Array.isArray(this.state.independentVotelines)) {
      this.state.independentVotelines = [];
    }
    const item = this.state.independentVotelines.find(
      (v) => v.id === itemId && v.tenantId === tenantId
    );
    if (!item) {
      throw new ConflictError('Independent voteline record not found.', 404);
    }
    if (item.balance <= 0) {
      throw new ConflictError('Independent voteline has no remaining balance.', 400);
    }

    const requestedAmount = Math.round(Number(input.amount));
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      throw new ConflictError('Enter a valid positive payment amount.', 400);
    }
    const payAmount = Math.min(item.balance, requestedAmount);
    const receiptNumber = `IVL-RCT-${Math.floor(10000 + Math.random() * 89999)}`;
    const paidAtIso =
      input.paidAt && !Number.isNaN(Date.parse(input.paidAt))
        ? new Date(input.paidAt).toISOString()
        : new Date().toISOString();

    const payment: IndependentVotelinePayment = {
      id: `ivlpay-${randomUUID().slice(0, 8)}`,
      receiptNumber,
      amount: payAmount,
      method: input.method || 'Mobile Money',
      reference: (input.reference || '').trim() || receiptNumber,
      paidAt: paidAtIso,
      recordedBy: (input.recordedBy || '').trim() || 'Bursar Office',
    };

    item.payments.push(payment);
    item.paidAmount += payAmount;
    item.balance = Math.max(0, item.amount - item.paidAmount);
    item.status = item.balance === 0 ? 'Paid' : 'Partial';

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

  deleteIndependentVoteline(tenantId: string, itemId: string): { deleted: boolean } {
    this.requireTenant(tenantId);
    const list = this.state.independentVotelines || [];
    const idx = list.findIndex((v) => v.id === itemId && v.tenantId === tenantId);
    if (idx === -1) {
      throw new ConflictError('Independent voteline record not found.', 404);
    }
    list.splice(idx, 1);
    this.state.independentVotelines = list;
    this.persist();
    this.syncTenant(tenantId, 'fee:independent-voteline-deleted');
    return { deleted: true };
  }

  private maskMpesaSecret(secret: string): string {
    const clean = secret.trim();
    if (!clean) return '';
    if (clean.length <= 4) return '••••';
    return `••••${clean.slice(-4)}`;
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
      consumerKey?: string;
      consumerSecret?: string;
      passkey?: string;
      settlementBank?: string;
    }
  ): { tenant: Tenant; mpesaConfig: TenantMpesaConfig } {
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
    const consumerKey = (input.consumerKey || '').trim();
    const enabled = input.enabled !== undefined ? Boolean(input.enabled) : true;
    const environment: MpesaEnvironment =
      input.environment === 'Production' ? 'Production' : 'Sandbox';

    if (!this.state.mpesaSecrets || typeof this.state.mpesaSecrets !== 'object') {
      this.state.mpesaSecrets = {};
    }
    const existingSecrets = this.state.mpesaSecrets[tenantId];
    const resolvedSecret = (input.consumerSecret || '').trim() || existingSecrets?.consumerSecret || '';
    const resolvedPasskey = (input.passkey || '').trim() || existingSecrets?.passkey || '';

    if (enabled) {
      if (!consumerKey) {
        throw new ConflictError(
          'Daraja Consumer Key is required when enabling M-Pesa Paybill integration.',
          400
        );
      }
      if (!resolvedSecret) {
        throw new ConflictError(
          'Daraja Consumer Secret is required when enabling M-Pesa Paybill integration.',
          400
        );
      }
      if (!resolvedPasskey) {
        throw new ConflictError(
          'Lipa Na M-Pesa Online Passkey is required when enabling M-Pesa Paybill integration.',
          400
        );
      }
    }

    this.state.mpesaSecrets[tenantId] = {
      consumerSecret: resolvedSecret,
      passkey: resolvedPasskey,
    };

    const config: TenantMpesaConfig = {
      enabled,
      environment,
      paybillNumber,
      accountName,
      accountReferenceFormat,
      consumerKey,
      hasConsumerSecret: Boolean(resolvedSecret),
      consumerSecretMasked: resolvedSecret ? this.maskMpesaSecret(resolvedSecret) : undefined,
      hasPasskey: Boolean(resolvedPasskey),
      passkeyMasked: resolvedPasskey ? this.maskMpesaSecret(resolvedPasskey) : undefined,
      callbackUrl: `/api/mpesa/c2b-callback?paybill=${paybillNumber}`,
      settlementBank: (input.settlementBank || '').trim() || undefined,
      updatedAt: new Date().toISOString(),
      updatedBy: actor.fullName || actor.email || actor.role,
    };

    tenant.mpesaConfig = config;
    this.persist();
    this.pushNotification(
      tenantId,
      'fee',
      `M-Pesa Paybill ${enabled ? 'Configured' : 'Saved (Disabled)'}: ${paybillNumber}`,
      `${tenant.name} fee payments are isolated via Paybill ${paybillNumber} (${environment}).`,
      'fees'
    );
    this.syncTenant(tenantId, 'finance:mpesa-config-updated');

    return { tenant, mpesaConfig: config };
  }

  processMpesaPaybillPayment(input: {
    paybillNumber?: string;
    accountReference?: string;
    amount?: number;
    msisdn?: string;
    mpesaReceipt?: string;
    channel?: 'Daraja C2B Webhook' | 'STK / Paybill Terminal';
    expectedTenantId?: string;
    recordedBy?: string;
  }): {
    tenantId: string;
    tenantName: string;
    paybillNumber: string;
    invoice: FeeInvoice;
    transaction: MpesaTransactionLog;
  } {
    const paybillNumber = this.normalizePaybillNumber(input.paybillNumber || '');
    const accountReference = (input.accountReference || '').trim();
    const msisdn = (input.msisdn || '').trim() || '254700000000';
    const requestedAmount = Math.round(Number(input.amount));
    const channel = input.channel || 'Daraja C2B Webhook';
    const mpesaReceipt =
      (input.mpesaReceipt || '').trim().toUpperCase() ||
      `MPE${Math.random().toString(36).slice(2, 9).toUpperCase()}`;

    if (!accountReference) {
      throw new ConflictError(
        'Account Reference (Student Code or Invoice Number) is required to match the student fee ledger.',
        400
      );
    }
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      throw new ConflictError('Enter a positive payment amount for M-Pesa Paybill settlement.', 400);
    }

    const matchedTenant = this.state.tenants.find(
      (t) => t.mpesaConfig?.paybillNumber === paybillNumber
    );
    if (!matchedTenant) {
      throw new ConflictError(
        `No school tenant is registered with M-Pesa Paybill "${paybillNumber}". Configure the school's Paybill under Fee & Billing -> M-Pesa Integration first.`,
        404
      );
    }

    if (!Array.isArray(this.state.mpesaTransactions)) {
      this.state.mpesaTransactions = [];
    }

    // Strict tenant separation guard when called from inside a tenant's workspace
    if (input.expectedTenantId && matchedTenant.id !== input.expectedTenantId) {
      const rejectedEntry: MpesaTransactionLog = {
        id: `mpesa-${randomUUID().slice(0, 8)}`,
        tenantId: input.expectedTenantId,
        paybillNumber,
        mpesaReceipt,
        msisdn,
        accountReference,
        amount: requestedAmount,
        status: 'Rejected',
        channel,
        note: `Blocked cross-tenant payment: Paybill ${paybillNumber} belongs to ${matchedTenant.name}.`,
        receivedAt: new Date().toISOString(),
      };
      this.state.mpesaTransactions.unshift(rejectedEntry);
      this.persist();
      this.syncTenant(input.expectedTenantId, 'finance:mpesa-blocked-cross-tenant');
      throw new ConflictError(
        `Tenant Isolation Blocked: Paybill "${paybillNumber}" belongs to ${matchedTenant.name}, not the active school workspace.`,
        403
      );
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
        i.tenantId === matchedTenant.id &&
        i.balance > 0 &&
        (i.studentCode.trim().toLowerCase() === refLower ||
          i.invoiceNumber.trim().toLowerCase() === refLower)
    );

    if (!targetInvoice) {
      const matchedStudent = this.state.students.find(
        (s) =>
          s.tenantId === matchedTenant.id &&
          (s.studentCode.trim().toLowerCase() === refLower ||
            s.upi.trim().toLowerCase() === refLower ||
            s.fullName.trim().toLowerCase() === refLower)
      );
      if (matchedStudent) {
        targetInvoice = this.state.invoices.find(
          (i) =>
            i.tenantId === matchedTenant.id &&
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
        amount: requestedAmount,
        status: 'Rejected',
        channel,
        note: `No open fee invoice matched "${accountReference}" within ${matchedTenant.name}.`,
        receivedAt: new Date().toISOString(),
      };
      this.state.mpesaTransactions.unshift(rejectedEntry);
      this.persist();
      this.syncTenant(matchedTenant.id, 'finance:mpesa-unmatched-ref');
      throw new ConflictError(
        `No open student fee balance matched account reference "${accountReference}" in ${matchedTenant.name} (Paybill ${paybillNumber}).`,
        404
      );
    }

    const updatedInvoice = this.recordPayment(matchedTenant.id, targetInvoice.id, {
      amount: requestedAmount,
      method: 'Mobile Money',
      reference: mpesaReceipt,
      recordedBy: input.recordedBy || `M-Pesa Paybill ${paybillNumber}`,
    });

    const latestPayment = updatedInvoice.payments[updatedInvoice.payments.length - 1];
    const settledAmount = latestPayment ? latestPayment.amount : requestedAmount;
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
    }
  ): SchoolExpense {
    const tenant = this.requireTenant(tenantId);
    const title = (input.title || '').trim();
    const vendor = (input.vendor || '').trim();
    const amount = Math.round(Number(input.amount));

    if (!title) {
      throw new ConflictError('Expense description / title is required.', 400);
    }
    if (!vendor) {
      throw new ConflictError('Vendor / Payee name is required.', 400);
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ConflictError('Expense amount must be greater than zero.', 400);
    }

    const validCategories = new Set<string>(EXPENSE_CATEGORIES);
    const category: ExpenseCategory = validCategories.has(input.category)
      ? input.category
      : 'Administration & Statutory';
    const validMethods = new Set<PaymentMethod>(['Bank Transfer', 'Card', 'Mobile Money', 'Cash']);
    const paymentMethod: PaymentMethod = validMethods.has(input.paymentMethod)
      ? input.paymentMethod
      : 'Bank Transfer';
    const validStatuses = new Set<ExpenseStatus>(['Pending Approval', 'Approved', 'Paid']);
    const status: ExpenseStatus =
      input.status && validStatuses.has(input.status) ? input.status : 'Pending Approval';

    const count = this.state.expenses.filter((e) => e.tenantId === tenantId).length;
    const prefix = tenant.slug.slice(0, 3).toUpperCase();
    const voucherNumber = `${prefix}-EXP-${202600 + count + 1}`;
    const expenseDate =
      input.expenseDate && !Number.isNaN(Date.parse(input.expenseDate))
        ? new Date(input.expenseDate).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);

    const recordedBy = (input.recordedBy || '').trim() || 'Bursar Office';
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
      notes: (input.notes || '').trim() || undefined,
      attachments,
      createdAt: new Date().toISOString(),
    };

    this.state.expenses.unshift(expense);
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
      (e) => e.id === expenseId && e.tenantId === tenantId
    );
    if (!expense) {
      throw new ConflictError('Expense voucher not found in tenant.', 404);
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
      (e) => e.id === expenseId && e.tenantId === tenantId
    );
    if (!expense) {
      throw new ConflictError('Expense voucher not found in tenant.', 404);
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

  updateExpenseStatus(tenantId: string, expenseId: string, status: ExpenseStatus): SchoolExpense {
    this.requireTenant(tenantId);
    const validStatuses = new Set<ExpenseStatus>(['Pending Approval', 'Approved', 'Paid']);
    if (!validStatuses.has(status)) {
      throw new ConflictError(`Invalid expense status "${status}".`, 400);
    }

    const expense = this.state.expenses.find(
      (e) => e.id === expenseId && e.tenantId === tenantId
    );
    if (!expense) {
      throw new ConflictError('Expense voucher not found in tenant.', 404);
    }

    expense.status = status;
    this.persist();
    this.syncTenant(tenantId, 'finance:expense-updated');
    return expense;
  }

  deleteExpense(tenantId: string, expenseId: string): { deleted: boolean } {
    this.requireTenant(tenantId);
    const idx = this.state.expenses.findIndex(
      (e) => e.id === expenseId && e.tenantId === tenantId
    );
    if (idx === -1) {
      throw new ConflictError('Expense voucher not found in tenant.', 404);
    }
    this.state.expenses.splice(idx, 1);
    this.persist();
    this.syncTenant(tenantId, 'finance:expense-deleted');
    return { deleted: true };
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
    }
  ): EtimsVerificationRecord {
    const tenant = this.requireTenant(tenantId);
    const supplierName = (input.supplierName || '').trim();
    const supplierKraPin = (input.supplierKraPin || '').trim().toUpperCase();
    const cuInvoiceNumber = (input.cuInvoiceNumber || '').trim().toUpperCase();
    const totalAmount = Math.round(Number(input.totalAmount));

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
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      throw new ConflictError('Receipt total amount must be greater than zero.', 400);
    }

    const linkedExpense = input.expenseId
      ? this.state.expenses.find((e) => e.id === input.expenseId && e.tenantId === tenantId)
      : undefined;

    const vatAmount = input.exemptVat
      ? 0
      : Number.isFinite(Number(input.vatAmount))
      ? Math.max(0, Math.round(Number(input.vatAmount)))
      : totalAmount - Math.round(totalAmount / 1.16);
    const taxableAmount = Number.isFinite(Number(input.taxableAmount))
      ? Math.max(0, Math.round(Number(input.taxableAmount)))
      : Math.max(0, totalAmount - vatAmount);

    let status: EtimsVerificationStatus = input.exemptVat ? 'Exempt' : 'Verified';
    let verificationNotes = input.exemptVat
      ? 'Zero-rated / VAT-exempt KRA eTIMS tax invoice verified.'
      : 'Supplier KRA PIN format, CU Invoice serial, and 16% VAT breakdown verified.';

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
      checkedBy: (input.checkedBy || '').trim() || 'Bursar Compliance Desk',
      checkedAt: new Date().toISOString(),
    };

    if (linkedExpense) {
      linkedExpense.etimsCuNumber = cuInvoiceNumber;
      linkedExpense.supplierKraPin = supplierKraPin;
      linkedExpense.etimsStatus = status;
    }

    if (!Array.isArray(this.state.etimsChecks)) this.state.etimsChecks = [];
    this.state.etimsChecks.unshift(record);
    this.persist();
    this.syncTenant(tenantId, 'finance:etims-verified');
    return record;
  }

  deleteEtimsCheck(tenantId: string, checkId: string): { deleted: boolean } {
    this.requireTenant(tenantId);
    const idx = (this.state.etimsChecks || []).findIndex(
      (c) => c.id === checkId && c.tenantId === tenantId
    );
    if (idx === -1) {
      throw new ConflictError('eTIMS verification record not found.', 404);
    }
    this.state.etimsChecks.splice(idx, 1);
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
      // Fallback exact amount match against single open payment if reference differs
      for (const inv of invoices) {
        const pay = (inv.payments || []).find((p) => p.amount === line.amount);
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

    // Debit: Match against Paid / Approved Expenses
    const expenses = this.state.expenses.filter((e) => e.tenantId === tenantId);
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
    }>
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
      const amount = Math.round(Number(raw.amount));
      if (!statementRef || !Number.isFinite(amount) || amount <= 0) {
        throw new ConflictError(
          'Each statement line requires a reference code and positive amount.',
          400
        );
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

    this.persist();
    this.syncTenant(tenantId, 'finance:reconciliation-imported');
    return { imported, matchedCount, unmatchedCount };
  }

  autoMatchReconciliation(tenantId: string): { matchedCount: number } {
    this.requireTenant(tenantId);
    let matchedCount = 0;
    for (const line of this.state.reconciliationLines || []) {
      if (line.tenantId !== tenantId || line.status === 'Matched') continue;
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
    }
  ): ReconciliationLine {
    this.requireTenant(tenantId);
    const valid = new Set<ReconciliationStatus>(['Matched', 'Unmatched', 'Discrepancy']);
    if (!valid.has(patch.status)) {
      throw new ConflictError(`Invalid reconciliation status "${patch.status}".`, 400);
    }
    const line = (this.state.reconciliationLines || []).find(
      (r) => r.id === lineId && r.tenantId === tenantId
    );
    if (!line) {
      throw new ConflictError('Reconciliation statement line not found.', 404);
    }
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
    this.persist();
    this.syncTenant(tenantId, 'finance:reconciliation-updated');
    return line;
  }

  deleteReconciliationLine(tenantId: string, lineId: string): { deleted: boolean } {
    this.requireTenant(tenantId);
    const idx = (this.state.reconciliationLines || []).findIndex(
      (r) => r.id === lineId && r.tenantId === tenantId
    );
    if (idx === -1) {
      throw new ConflictError('Reconciliation statement line not found.', 404);
    }
    this.state.reconciliationLines.splice(idx, 1);
    this.persist();
    this.syncTenant(tenantId, 'finance:reconciliation-deleted');
    return { deleted: true };
  }

  // Finance Controls: Payroll & Statutory Deductions
  generatePayrollRun(tenantId: string, payPeriod: string): PayrollEntry[] {
    const tenant = this.requireTenant(tenantId);
    const period = (payPeriod || '').trim() || new Date().toISOString().slice(0, 7);
    if (!Array.isArray(this.state.payrollEntries)) this.state.payrollEntries = [];

    const existingStaffIds = new Set(
      this.state.payrollEntries
        .filter((p) => p.tenantId === tenantId && p.payPeriod === period)
        .map((p) => p.staffId)
    );

    const defaults = buildDefaultPayrollForTenant(tenant, period);
    const created: PayrollEntry[] = [];
    for (const entry of defaults) {
      if (!existingStaffIds.has(entry.staffId)) {
        const nextEntry = { ...entry, id: `payr-${randomUUID().slice(0, 8)}` };
        this.state.payrollEntries.push(nextEntry);
        created.push(nextEntry);
      }
    }
    this.persist();
    this.syncTenant(tenantId, 'finance:payroll-generated');
    return this.state.payrollEntries.filter(
      (p) => p.tenantId === tenantId && p.payPeriod === period
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
    }
  ): PayrollEntry {
    const tenant = this.requireTenant(tenantId);
    const staffName = (input.staffName || '').trim();
    if (!staffName) {
      throw new ConflictError('Staff full name is required for payroll entry.', 400);
    }
    const basicSalary = Math.max(0, Math.round(Number(input.basicSalary)));
    const allowances = Math.max(0, Math.round(Number(input.allowances || 0)));
    const saccoOrLoan = Math.max(0, Math.round(Number(input.saccoOrLoan || 0)));
    const grossPay = basicSalary + allowances;
    if (grossPay <= 0) {
      throw new ConflictError('Gross salary must be greater than zero.', 400);
    }

    const statutory = computeStatutoryDeductions(grossPay, tenant.currency);
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
    const payPeriod = (input.payPeriod || '').trim() || new Date().toISOString().slice(0, 7);
    const status: PayrollStatus =
      input.status === 'Approved' || input.status === 'Disbursed' ? input.status : 'Draft';

    if (!Array.isArray(this.state.payrollEntries)) this.state.payrollEntries = [];
    const existing = input.id
      ? this.state.payrollEntries.find((p) => p.id === input.id && p.tenantId === tenantId)
      : undefined;

    if (existing) {
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
      existing.status = status;
      existing.updatedAt = new Date().toISOString();
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
      status,
      updatedAt: new Date().toISOString(),
    };

    this.state.payrollEntries.push(created);
    this.persist();
    this.syncTenant(tenantId, 'finance:payroll-created');
    return created;
  }

  updatePayrollStatus(tenantId: string, entryId: string, status: PayrollStatus): PayrollEntry {
    this.requireTenant(tenantId);
    const valid = new Set<PayrollStatus>(['Draft', 'Approved', 'Disbursed']);
    if (!valid.has(status)) {
      throw new ConflictError(`Invalid payroll status "${status}".`, 400);
    }
    const entry = (this.state.payrollEntries || []).find(
      (p) => p.id === entryId && p.tenantId === tenantId
    );
    if (!entry) {
      throw new ConflictError('Payroll entry not found in tenant.', 404);
    }
    entry.status = status;
    entry.updatedAt = new Date().toISOString();
    this.persist();
    this.syncTenant(tenantId, 'finance:payroll-status');
    return entry;
  }

  deletePayrollEntry(tenantId: string, entryId: string): { deleted: boolean } {
    this.requireTenant(tenantId);
    const idx = (this.state.payrollEntries || []).findIndex(
      (p) => p.id === entryId && p.tenantId === tenantId
    );
    if (idx === -1) {
      throw new ConflictError('Payroll entry not found in tenant.', 404);
    }
    this.state.payrollEntries.splice(idx, 1);
    this.persist();
    this.syncTenant(tenantId, 'finance:payroll-deleted');
    return { deleted: true };
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
    }
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
      const amountChanged = existing.allocatedAmount !== allocatedAmount;
      existing.allocatedAmount = allocatedAmount;
      if (input.fiscalYear) existing.fiscalYear = input.fiscalYear.trim();
      if (input.term) existing.term = input.term.trim();
      if (input.notes !== undefined) existing.notes = input.notes.trim() || undefined;
      if (amountChanged) {
        existing.status = 'Pending Approval';
        existing.approvedBy = undefined;
        existing.approvedAt = undefined;
        existing.approvalNotes = 'Ceiling revised — awaiting approval.';
      } else if (!existing.status) {
        existing.status = 'Pending Approval';
      }
      existing.updatedAt = new Date().toISOString();
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
      notes: (input.notes || '').trim() || undefined,
      updatedAt: new Date().toISOString(),
    };
    this.state.budgets.push(created);
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
    }
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

    if (input.status === 'Approved' && target.allocatedAmount <= 0) {
      throw new ConflictError(
        `Set a positive budget ceiling for ${target.category} before approving it.`,
        400
      );
    }

    const now = new Date().toISOString();
    target.status = input.status;
    target.approvalNotes = (input.approvalNotes || '').trim() || undefined;
    target.updatedAt = now;

    if (input.status === 'Approved' || input.status === 'Rejected') {
      target.approvedBy = (input.approvedBy || '').trim() || 'Finance Administrator';
      target.approvedAt = now;
    } else {
      target.approvedBy = undefined;
      target.approvedAt = undefined;
    }

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
    }
  ): ApprovalSignOffRecord {
    const tenant = this.requireTenant(tenantId);
    const subject = (input.subject || '').trim();
    const minuteReference = (input.minuteReference || '').trim();
    const chairpersonName = (input.chairpersonName || '').trim();
    const secretaryName = (input.secretaryName || '').trim();
    const amount = Math.round(Number(input.amount));

    if (!subject || !minuteReference || !chairpersonName || !secretaryName) {
      throw new ConflictError(
        'Subject, minute reference, chairperson, and secretary signatories are required.',
        400
      );
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ConflictError('Sign-off amount must be greater than zero.', 400);
    }

    const validCommittees = new Set<string>(APPROVAL_COMMITTEES);
    const committee: ApprovalCommittee = validCommittees.has(input.committee)
      ? input.committee
      : 'Board of Management (BOM)';
    const validDecisions = new Set<ApprovalDecision>([
      'Pending Sign-Off',
      'Approved',
      'Deferred',
      'Rejected',
    ]);
    const decision: ApprovalDecision =
      input.decision && validDecisions.has(input.decision)
        ? input.decision
        : 'Pending Sign-Off';

    const linkedExpense = input.linkedExpenseId
      ? this.state.expenses.find((e) => e.id === input.linkedExpenseId && e.tenantId === tenantId)
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
      bursarName: (input.bursarName || '').trim() || 'School Bursar',
      decision,
      remarks: (input.remarks || '').trim() || undefined,
      createdAt: new Date().toISOString(),
      signedAt: decision === 'Approved' ? new Date().toISOString() : undefined,
    };

    if (linkedExpense) {
      linkedExpense.boardApprovalRef = `${referenceCode} (${minuteReference})`;
      if (decision === 'Approved' && linkedExpense.status === 'Pending Approval') {
        linkedExpense.status = 'Approved';
      }
    }

    this.state.approvalRecords.unshift(record);
    this.persist();
    this.syncTenant(tenantId, 'finance:approval-created');
    return record;
  }

  updateApprovalDecision(
    tenantId: string,
    recordId: string,
    patch: { decision: ApprovalDecision; remarks?: string }
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
      (a) => a.id === recordId && a.tenantId === tenantId
    );
    if (!record) {
      throw new ConflictError('Board / Procurement approval record not found.', 404);
    }

    record.decision = patch.decision;
    if (patch.remarks !== undefined) record.remarks = patch.remarks.trim() || undefined;
    record.signedAt = patch.decision === 'Approved' ? new Date().toISOString() : undefined;

    if (record.linkedExpenseId) {
      const linkedExpense = this.state.expenses.find(
        (e) => e.id === record.linkedExpenseId && e.tenantId === tenantId
      );
      if (linkedExpense) {
        linkedExpense.boardApprovalRef = `${record.referenceCode} (${record.minuteReference})`;
        if (patch.decision === 'Approved' && linkedExpense.status === 'Pending Approval') {
          linkedExpense.status = 'Approved';
        }
      }
    }

    this.persist();
    this.syncTenant(tenantId, 'finance:approval-updated');
    return record;
  }

  deleteApprovalRecord(tenantId: string, recordId: string): { deleted: boolean } {
    this.requireTenant(tenantId);
    const idx = (this.state.approvalRecords || []).findIndex(
      (a) => a.id === recordId && a.tenantId === tenantId
    );
    if (idx === -1) {
      throw new ConflictError('Board / Procurement approval record not found.', 404);
    }
    this.state.approvalRecords.splice(idx, 1);
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
}
