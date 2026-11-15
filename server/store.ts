import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  addDaysIso,
  buildDefaultLevelSubjectsMap,
  buildDefaultLevelWeeklyLessonsMap,
  CLASS_TEACHER_SUBJECT_TOKEN,
  computeAssessmentGrade,
  DEFAULT_SUBJECT_WEEKLY_LESSONS,
  DEFAULT_TENANT_BRANDING,
  getClusterForGrade,
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
  type AdmissionApplication,
  type AdmissionStage,
  type Announcement,
  type AttendanceRecord,
  type AttendanceStatus,
  type CbcClusterId,
  type DayOfWeek,
  type DirectMessage,
  type ExamCycle,
  type ExamResult,
  type FeeInvoice,
  type FeeStructure,
  type LeaveOutChit,
  type NonTeachingStaffProfile,
  type NotificationCategory,
  type NotificationItem,
  type OnboardingChecklist,
  type PaymentMethod,
  type StaffAttendanceRecord,
  type StaffCategory,
  type Student,
  type SuperAdminTenantSummary,
  type TeacherClassAssignment,
  type TeacherProfile,
  type Tenant,
  type TenantBranding,
  type TenantStatus,
  type TenantWorkspaceData,
  type TimetableSlot,
  type UserRole,
} from '../src/shared/types.ts';
import {
  buildDefaultNonTeachingStaff,
  computeLetterGrade,
  createSeedDatabase,
  PERIOD_TIMES,
  type DatabaseState,
} from './seed.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'elimunest-db.json');
const LEGACY_DB_FILE = path.join(DATA_DIR, 'scholara-db.json');

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

  constructor(onBroadcast?: (tenantId: string, eventType: string, payload: unknown) => void) {
    this.onBroadcast = onBroadcast;
    this.state = this.loadOrInitialize();
  }

  setBroadcaster(fn: (tenantId: string, eventType: string, payload: unknown) => void) {
    this.onBroadcast = fn;
  }

  private loadOrInitialize(): DatabaseState {
    try {
      const sourceFile = fs.existsSync(DB_FILE)
        ? DB_FILE
        : fs.existsSync(LEGACY_DB_FILE)
        ? LEGACY_DB_FILE
        : null;
      if (sourceFile) {
        const raw = fs.readFileSync(sourceFile, 'utf-8');
        const parsed = JSON.parse(raw) as DatabaseState;
        if (
          parsed &&
          Array.isArray(parsed.tenants) &&
          parsed.tenants.length > 0 &&
          Array.isArray(parsed.students) &&
          parsed.students.every((s) => typeof s.upi === 'string' && s.upi.length > 0) &&
          parsed.tenants.every((t) => Array.isArray(t.grades) && t.grades.includes('Playgroup'))
        ) {
          let dirty = sourceFile !== DB_FILE;

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

          if (dirty) {
            this.persist(parsed);
          }
          return parsed;
        }
      }
    } catch (err) {
      console.warn('Initializing fresh database state:', err);
    }
    const seed = createSeedDatabase();
    this.persist(seed);
    return seed;
  }

  private persist(nextState: DatabaseState = this.state) {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmpFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(nextState, null, 2), 'utf-8');
    fs.renameSync(tmpFile, DB_FILE);
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

  listTenants(): Tenant[] {
    return this.state.tenants;
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
      announcements: this.state.announcements.filter((a) => a.tenantId === tenantId),
      messages: this.state.messages.filter((m) => m.tenantId === tenantId),
      notifications: this.state.notifications.filter((n) => n.tenantId === tenantId),
    };
  }

  createTenant(input: {
    name: string;
    curriculum: string;
    academicYear: string;
    currentTerm: string;
    currency: 'USD' | 'GBP' | 'EUR';
    plan: 'Enterprise' | 'Growth';
    status?: TenantStatus;
    location: string;
    branding?: Partial<TenantBranding>;
    grades: string[];
    subjects: string[];
    rooms: string[];
    leadTeacherName: string;
    leadTeacherEmail: string;
  }): Tenant {
    const slug = input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32) || `school-${Date.now()}`;

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
    const tenant: Tenant = {
      id,
      name: input.name.trim(),
      slug,
      curriculum: input.curriculum.trim() || 'Standard Curriculum',
      academicYear: input.academicYear.trim() || '2026–2027',
      currentTerm: input.currentTerm.trim() || 'Term 1',
      currency: input.currency || 'USD',
      plan: input.plan || 'Growth',
      status: input.status || 'Active',
      location: input.location.trim() || 'Campus Main',
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
          email: input.leadTeacherEmail.trim() || `admin@${slug}.edu`,
          phone: '+254 700 000 000',
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

    // Seed default fee structure for first grade so billing works immediately
    this.state.feeStructures.push({
      id: `fs-${randomUUID().slice(0, 6)}`,
      tenantId: id,
      grade: tenant.grades[0],
      term: tenant.currentTerm,
      tuitionFee: 3800,
      labFee: 300,
      technologyFee: 200,
      activitiesFee: 150,
      totalFee: 4450,
    });

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
        'name' | 'curriculum' | 'academicYear' | 'currentTerm' | 'currency' | 'location' | 'plan' | 'status'
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
    if (patch.curriculum && patch.curriculum.trim()) tenant.curriculum = patch.curriculum.trim();
    if (patch.academicYear && patch.academicYear.trim()) tenant.academicYear = patch.academicYear.trim();
    if (patch.currentTerm && patch.currentTerm.trim()) tenant.currentTerm = patch.currentTerm.trim();
    if (patch.currency) tenant.currency = patch.currency;
    if (patch.location !== undefined) tenant.location = patch.location.trim() || tenant.location;
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
      location?: string;
      curriculum?: string;
      academicYear?: string;
      currentTerm?: string;
      currency?: 'USD' | 'GBP' | 'EUR';
      plan?: 'Enterprise' | 'Growth';
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
    this.state.announcements = this.state.announcements.filter((a) => a.tenantId !== tenantId);
    this.state.messages = this.state.messages.filter((m) => m.tenantId !== tenantId);
    this.state.notifications = this.state.notifications.filter((n) => n.tenantId !== tenantId);

    this.persist();
    this.onBroadcast?.(tenant.id, 'workspace:sync', {
      reason: 'tenant:deleted',
      timestamp: new Date().toISOString(),
    });
    return { deleted: true, remainingTenants: this.state.tenants };
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
      tuitionFee: number;
      labFee: number;
      technologyFee: number;
      activitiesFee: number;
    }
  ): FeeStructure {
    this.requireTenant(tenantId);
    const totalFee =
      Number(input.tuitionFee) +
      Number(input.labFee) +
      Number(input.technologyFee) +
      Number(input.activitiesFee);

    const existing = this.state.feeStructures.find(
      (f) => f.tenantId === tenantId && f.grade === input.grade && f.term === input.term
    );
    if (existing) {
      existing.tuitionFee = Number(input.tuitionFee);
      existing.labFee = Number(input.labFee);
      existing.technologyFee = Number(input.technologyFee);
      existing.activitiesFee = Number(input.activitiesFee);
      existing.totalFee = totalFee;
      this.persist();
      this.syncTenant(tenantId, 'fee:structure-updated');
      return existing;
    }

    const fsItem: FeeStructure = {
      id: `fs-${randomUUID().slice(0, 8)}`,
      tenantId,
      grade: input.grade,
      term: input.term,
      tuitionFee: Number(input.tuitionFee),
      labFee: Number(input.labFee),
      technologyFee: Number(input.technologyFee),
      activitiesFee: Number(input.activitiesFee),
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
    input: { amount: number; method: PaymentMethod; reference: string; recordedBy: string }
  ): FeeInvoice {
    const tenant = this.requireTenant(tenantId);
    const invoice = this.state.invoices.find((i) => i.id === invoiceId && i.tenantId === tenantId);
    if (!invoice) throw new ConflictError('Invoice not found.', 404);

    const payAmount = Math.min(invoice.balance, Math.max(1, Number(input.amount)));
    if (payAmount <= 0) {
      throw new ConflictError('Invoice has no remaining balance.', 400);
    }

    const receiptNumber = `RCT-${Math.floor(10000 + Math.random() * 89999)}`;
    invoice.payments.push({
      id: `pay-${randomUUID().slice(0, 8)}`,
      receiptNumber,
      amount: payAmount,
      method: input.method,
      reference: input.reference.trim() || receiptNumber,
      paidAt: new Date().toISOString(),
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
