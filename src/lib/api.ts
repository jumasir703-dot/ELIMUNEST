import { useEffect, useRef, useState } from 'react';
import type {
  AdminAuditEntry,
  AdminSessionInfo,
  AdmissionApplication,
  AdmissionStage,
  Announcement,
  ApprovalCommittee,
  ApprovalDecision,
  ApprovalSignOffRecord,
  AttendanceRecord,
  AttendanceStatus,
  AuthSessionInfo,
  BudgetAllocation,
  CbcClusterId,
  CurrencyCode,
  DayOfWeek,
  DevImpersonationTarget,
  DevPlatformTelemetry,
  DirectMessage,
  EtimsVerificationRecord,
  ExamCycle,
  ExamResult,
  ExpenseAttachmentType,
  ExpenseCategory,
  ExpenseStatus,
  FeeInvoice,
  FeeStructure,
  ImpersonatorMeta,
  LeaveOutChit,
  NonTeachingStaffProfile,
  OnboardingChecklist,
  PaymentMethod,
  PayrollEntry,
  PayrollStatus,
  PublicSchoolDirectoryItem,
  ReconciliationChannel,
  ReconciliationLine,
  ReconciliationStatus,
  SchoolExpense,
  StaffAttendanceRecord,
  StaffCategory,
  Student,
  SubscriptionCycle,
  SuperAdminTenantSummary,
  TeacherClassAssignment,
  TeacherProfile,
  Tenant,
  TenantBranding,
  TenantModulePermission,
  TenantPlan,
  TenantStatus,
  TenantUser,
  TenantWorkspaceData,
  TimetableSlot,
  UserRole,
  WhatsAppDispatchCategory,
  WhatsAppDispatchRecord,
  WsServerEvent,
} from '../shared/types';

const AUTH_SESSION_STORAGE_KEY = 'elimunest_auth_session_v1';
const DEV_RESTORE_SESSION_STORAGE_KEY = 'elimunest_dev_restore_session_v1';
const ADMIN_SESSION_STORAGE_KEY = 'elimunest_admin_session_v1';

let memoryAuthSession: AuthSessionInfo | null = null;
let memoryAdminSession: AdminSessionInfo | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null) {
  unauthorizedHandler = fn;
}

function readStoredAuthSession(): AuthSessionInfo | null {
  if (memoryAuthSession) {
    if (Date.parse(memoryAuthSession.expiresAt) > Date.now()) {
      return memoryAuthSession;
    }
    memoryAuthSession = null;
  }
  try {
    const raw = window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSessionInfo;
    if (
      parsed &&
      typeof parsed.token === 'string' &&
      parsed.expiresAt &&
      Date.parse(parsed.expiresAt) > Date.now() &&
      parsed.user
    ) {
      memoryAuthSession = parsed;
      return parsed;
    }
    window.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
  return null;
}

function writeStoredAuthSession(session: AuthSessionInfo | null) {
  memoryAuthSession = session;
  try {
    if (session) {
      window.localStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session));
    } else {
      window.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

function isPrivilegedRole(role: UserRole): boolean {
  return role === 'Developer' || role === 'Super Admin' || role === 'Admin';
}

export function isDeveloperRoleClient(role?: UserRole): boolean {
  return role === 'Developer' || role === 'Super Admin';
}

function readDevRestoreSession(): AuthSessionInfo | null {
  try {
    const raw = window.localStorage.getItem(DEV_RESTORE_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSessionInfo;
    if (
      parsed &&
      typeof parsed.token === 'string' &&
      parsed.expiresAt &&
      Date.parse(parsed.expiresAt) > Date.now() &&
      parsed.user
    ) {
      return parsed;
    }
    window.localStorage.removeItem(DEV_RESTORE_SESSION_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
  return null;
}

function writeDevRestoreSession(session: AuthSessionInfo | null) {
  try {
    if (session) {
      window.localStorage.setItem(DEV_RESTORE_SESSION_STORAGE_KEY, JSON.stringify(session));
    } else {
      window.localStorage.removeItem(DEV_RESTORE_SESSION_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

function readStoredAdminSession(): AdminSessionInfo | null {
  if (memoryAdminSession) return memoryAdminSession;
  try {
    const raw = window.sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdminSessionInfo;
    if (parsed && typeof parsed.token === 'string' && parsed.expiresAt) {
      memoryAdminSession = parsed;
      return parsed;
    }
  } catch {
    // ignore storage failures
  }
  return null;
}

function writeStoredAdminSession(session: AdminSessionInfo | null) {
  memoryAdminSession = session;
  try {
    if (session) {
      window.sessionStorage.setItem(ADMIN_SESSION_STORAGE_KEY, JSON.stringify(session));
    } else {
      window.sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
    }
  } catch {
    // ignore storage failures
  }
}

async function apiRequest<T>(
  url: string,
  options: RequestInit & { tenantId?: string; skipAuth?: boolean } = {}
): Promise<T> {
  const { tenantId, headers, skipAuth, ...rest } = options;
  const mergedHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(headers as Record<string, string> | undefined),
  };
  if (tenantId) {
    mergedHeaders['x-tenant-id'] = tenantId;
  }
  if (!skipAuth && !mergedHeaders.Authorization && !mergedHeaders.authorization) {
    const activeAuth = readStoredAuthSession();
    if (activeAuth?.token) {
      mergedHeaders.Authorization = `Bearer ${activeAuth.token}`;
    }
  }
  const response = await fetch(url, {
    ...rest,
    headers: mergedHeaders,
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload?.error) message = payload.error;
    } catch {
      // keep default message
    }
    if (response.status === 401 && !skipAuth) {
      writeStoredAuthSession(null);
      writeStoredAdminSession(null);
      unauthorizedHandler?.();
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

async function adminApiRequest<T>(
  url: string,
  options: RequestInit & { tenantId?: string } = {}
): Promise<T> {
  const activeAuth = readStoredAuthSession();
  if (!activeAuth) {
    throw new Error('Authentication required. Please sign in.');
  }
  if (!isPrivilegedRole(activeAuth.user.role)) {
    throw new Error(`Role "${activeAuth.user.role}" is not authorized for Platform Admin API access.`);
  }
  return apiRequest<T>(url, options);
}

async function devApiRequest<T>(
  url: string,
  options: RequestInit & { tenantId?: string } = {}
): Promise<T> {
  const activeAuth = readStoredAuthSession();
  if (!activeAuth) {
    throw new Error('Developer authentication required.');
  }
  if (activeAuth.impersonator) {
    throw new Error('Exit active support impersonation before accessing Developer Control Plane APIs.');
  }
  if (!isDeveloperRoleClient(activeAuth.user.role)) {
    throw new Error(
      `Forbidden: Role "${activeAuth.user.role}" lacks Developer Control Plane permissions.`
    );
  }
  return apiRequest<T>(url, options);
}

export const saasApi = {
  getPersistedAuthSession(): AuthSessionInfo | null {
    return readStoredAuthSession();
  },

  hasDevRestoreSession(): boolean {
    return Boolean(readDevRestoreSession());
  },

  clearAuthSession() {
    writeStoredAuthSession(null);
    writeDevRestoreSession(null);
    writeStoredAdminSession(null);
  },

  getAuthSchools() {
    return apiRequest<{ schools: PublicSchoolDirectoryItem[] }>('/api/auth/schools', {
      skipAuth: true,
    });
  },

  async login(payload: { email: string; password: string }): Promise<AuthSessionInfo> {
    const session = await apiRequest<AuthSessionInfo>('/api/auth/login', {
      method: 'POST',
      skipAuth: true,
      body: JSON.stringify(payload),
    });
    writeStoredAuthSession(session);
    writeStoredAdminSession(null);
    return session;
  },

  async registerAccount(payload: {
    tenantId?: string;
    fullName: string;
    email: string;
    role: UserRole;
    password: string;
  }): Promise<AuthSessionInfo> {
    const session = await apiRequest<AuthSessionInfo>('/api/auth/register', {
      method: 'POST',
      skipAuth: true,
      body: JSON.stringify(payload),
    });
    writeStoredAuthSession(session);
    writeStoredAdminSession(null);
    return session;
  },

  async registerTenantAndAdmin(payload: {
    schoolName: string;
    emailDomain: string;
    location: string;
    curriculum: string;
    academicYear?: string;
    currentTerm?: string;
    currency: CurrencyCode;
    plan?: 'Enterprise' | 'Growth';
    fullName: string;
    email: string;
    password: string;
    branding?: Partial<TenantBranding>;
  }): Promise<AuthSessionInfo> {
    const session = await apiRequest<AuthSessionInfo>('/api/auth/register-tenant', {
      method: 'POST',
      skipAuth: true,
      body: JSON.stringify(payload),
    });
    writeStoredAuthSession(session);
    writeStoredAdminSession(null);
    return session;
  },

  async verifyAuthSession(): Promise<AuthSessionInfo | null> {
    const current = readStoredAuthSession();
    if (!current) return null;
    try {
      const refreshed = await apiRequest<{
        user: TenantUser;
        tenantName?: string;
        emailDomain?: string;
        impersonator?: ImpersonatorMeta;
      }>('/api/auth/session');
      const updated: AuthSessionInfo = {
        ...current,
        user: refreshed.user,
        tenantName: refreshed.tenantName,
        emailDomain: refreshed.emailDomain,
        impersonator: refreshed.impersonator,
      };
      writeStoredAuthSession(updated);
      return updated;
    } catch {
      writeStoredAuthSession(null);
      writeStoredAdminSession(null);
      return null;
    }
  },

  async logout() {
    try {
      await apiRequest<{ ok: boolean }>('/api/auth/logout', { method: 'POST', skipAuth: true });
    } catch {
      // ignore offline logout failures
    }
    writeStoredAuthSession(null);
    writeDevRestoreSession(null);
    writeStoredAdminSession(null);
  },

  async changePassword(payload: {
    currentPassword: string;
    newPassword: string;
  }): Promise<AuthSessionInfo> {
    const session = await apiRequest<AuthSessionInfo>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    writeStoredAuthSession(session);
    writeStoredAdminSession(null);
    return session;
  },

  listTenantUsers(tenantId?: string) {
    return apiRequest<{ users: TenantUser[] }>('/api/auth/users', { tenantId });
  },

  createTenantStaffUser(
    tenantId: string,
    payload: {
      fullName: string;
      email: string;
      role: UserRole;
      allowedModules?: TenantModulePermission[];
    }
  ) {
    return apiRequest<{ user: TenantUser; oneTimePassword: string }>('/api/auth/users', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    });
  },

  updateTenantUserAccess(
    tenantId: string,
    userId: string,
    payload: {
      role?: UserRole;
      allowedModules?: TenantModulePermission[];
      status?: 'Active' | 'Disabled';
      resetOneTimePassword?: boolean;
    }
  ) {
    return apiRequest<{ user: TenantUser; oneTimePassword?: string }>(
      `/api/auth/users/${userId}/access`,
      {
        method: 'PATCH',
        tenantId,
        body: JSON.stringify(payload),
      }
    );
  },

  async syncRoleSession(role: UserRole): Promise<AdminSessionInfo | null> {
    if (!isPrivilegedRole(role)) {
      writeStoredAdminSession(null);
      return null;
    }
    const auth = readStoredAuthSession();
    if (!auth || !isPrivilegedRole(auth.user.role)) {
      return null;
    }
    const existing = readStoredAdminSession();
    if (existing && Date.parse(existing.expiresAt) > Date.now() + 30_000) {
      return existing;
    }
    try {
      const session = await apiRequest<AdminSessionInfo>('/api/admin/session', {
        method: 'POST',
        body: JSON.stringify({ role: auth.user.role }),
      });
      writeStoredAdminSession(session);
      return session;
    } catch {
      return null;
    }
  },

  getWorkspace(tenantId?: string) {
    return apiRequest<TenantWorkspaceData>('/api/workspace', { tenantId });
  },

  getSuperAdminTenants() {
    return adminApiRequest<{ summaries: SuperAdminTenantSummary[] }>('/api/admin/tenants');
  },

  getAdminAuditLogs(limit = 50) {
    return adminApiRequest<{ logs: AdminAuditEntry[] }>(`/api/admin/audit-logs?limit=${limit}`);
  },

  createTenant(payload: {
    name: string;
    emailDomain?: string;
    curriculum: string;
    academicYear: string;
    currentTerm: string;
    currency: CurrencyCode;
    plan: TenantPlan;
    status?: TenantStatus;
    location: string;
    branding?: Partial<TenantBranding>;
    grades: string[];
    subjects: string[];
    rooms: string[];
    leadTeacherName: string;
    leadTeacherEmail: string;
  }) {
    return adminApiRequest<{ tenant: Tenant; auditEntry: AdminAuditEntry }>('/api/admin/tenants', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

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
  ) {
    return adminApiRequest<{ tenant: Tenant; auditEntry: AdminAuditEntry }>(
      `/api/admin/tenants/${tenantId}/metadata`,
      {
        method: 'PATCH',
        tenantId,
        body: JSON.stringify(patch),
      }
    );
  },

  updateTenantBranding(
    tenantId: string,
    payload: {
      name?: string;
      emailDomain?: string;
      location?: string;
      curriculum?: string;
      academicYear?: string;
      currentTerm?: string;
      currency?: CurrencyCode;
      plan?: TenantPlan;
      status?: TenantStatus;
      branding?: Partial<TenantBranding>;
    }
  ) {
    return adminApiRequest<{ tenant: Tenant; auditEntry: AdminAuditEntry }>(
      `/api/admin/tenants/${tenantId}/branding`,
      {
        method: 'PATCH',
        tenantId,
        body: JSON.stringify(payload),
      }
    );
  },

  deleteTenant(tenantId: string) {
    return adminApiRequest<{
      deleted: boolean;
      remainingTenants: Tenant[];
      auditEntry: AdminAuditEntry;
    }>(`/api/admin/tenants/${tenantId}`, {
      method: 'DELETE',
      tenantId,
    });
  },

  updateStreams(
    tenantId: string,
    payload: {
      gradeConfigs?: Array<{
        originalGrade?: string | null;
        grade: string;
        streams: string[];
        streamRenames?: Record<string, string>;
      }>;
      streams?: string[];
      renames?: Record<string, string>;
    }
  ) {
    return apiRequest<{ tenant: Tenant }>(`/api/tenants/${tenantId}/streams`, {
      method: 'PUT',
      tenantId,
      body: JSON.stringify(payload),
    });
  },

  updateSubjects(
    tenantId: string,
    payload: {
      subjects: string[];
      renames?: Record<string, string>;
      subjectWeeklyLessons?: Record<string, number>;
      level?: CbcClusterId;
    }
  ) {
    return apiRequest<{ tenant: Tenant }>(`/api/tenants/${tenantId}/subjects`, {
      method: 'PUT',
      tenantId,
      body: JSON.stringify(payload),
    });
  },

  addTeacher(
    tenantId: string,
    payload: {
      name: string;
      email?: string;
      phone?: string;
      department?: string;
      subjects: string[];
      assignedClasses?: TeacherClassAssignment[];
    }
  ) {
    return apiRequest<{ teacher: TeacherProfile; tenant: Tenant }>(
      `/api/tenants/${tenantId}/teachers`,
      {
        method: 'POST',
        tenantId,
        body: JSON.stringify(payload),
      }
    );
  },

  updateTeacher(
    tenantId: string,
    teacherId: string,
    payload: {
      name?: string;
      email?: string;
      phone?: string;
      department?: string;
      subjects: string[];
      assignedClasses?: TeacherClassAssignment[];
    }
  ) {
    return apiRequest<{ teacher: TeacherProfile; tenant: Tenant }>(
      `/api/tenants/${tenantId}/teachers/${teacherId}`,
      {
        method: 'PUT',
        tenantId,
        body: JSON.stringify(payload),
      }
    );
  },

  deleteTeacher(tenantId: string, teacherId: string) {
    return apiRequest<{ tenant: Tenant; removedSlots: number }>(
      `/api/tenants/${tenantId}/teachers/${teacherId}`,
      {
        method: 'DELETE',
        tenantId,
      }
    );
  },

  addNonTeachingStaff(
    tenantId: string,
    payload: {
      name: string;
      role: string;
      department?: string;
      phone?: string;
      email?: string;
      actorRole?: UserRole;
    }
  ) {
    return apiRequest<{ staff: NonTeachingStaffProfile; tenant: Tenant }>(
      `/api/tenants/${tenantId}/non-teaching-staff`,
      {
        method: 'POST',
        tenantId,
        body: JSON.stringify(payload),
      }
    );
  },

  enrollStudent(
    tenantId: string,
    payload: {
      studentCode?: string;
      upi?: string;
      fullName: string;
      dateOfBirth: string;
      gender: 'Female' | 'Male' | 'Non-binary';
      grade: string;
      section: string;
      guardianName: string;
      guardianPhone: string;
      enrolledAt?: string;
    }
  ) {
    return apiRequest<{ student: Student; invoice: FeeInvoice }>('/api/students/enroll', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    });
  },

  createAdmission(
    tenantId: string,
    payload: {
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
  ) {
    return apiRequest<{ application: AdmissionApplication }>('/api/admissions', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    });
  },

  updateAdmission(
    tenantId: string,
    admissionId: string,
    patch: {
      stage?: AdmissionStage;
      checklist?: Partial<OnboardingChecklist>;
      notes?: string;
      assignedSection?: string;
    }
  ) {
    return apiRequest<{
      application: AdmissionApplication;
      enrolledStudent?: Student;
      generatedInvoice?: FeeInvoice;
    }>(`/api/admissions/${admissionId}`, {
      method: 'PATCH',
      tenantId,
      body: JSON.stringify(patch),
    });
  },

  createTimetableSlot(
    tenantId: string,
    payload: {
      day: DayOfWeek;
      period: number;
      grade: string;
      section: string;
      subject: string;
      teacherId: string;
      room: string;
    }
  ) {
    return apiRequest<{ slot: TimetableSlot }>('/api/timetable', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    });
  },

  updateTimetableSlot(
    tenantId: string,
    slotId: string,
    payload: {
      day: DayOfWeek;
      period: number;
      grade: string;
      section: string;
      subject: string;
      teacherId: string;
      room: string;
    }
  ) {
    return apiRequest<{ slot: TimetableSlot }>(`/api/timetable/${slotId}`, {
      method: 'PUT',
      tenantId,
      body: JSON.stringify(payload),
    });
  },

  deleteTimetableSlot(tenantId: string, slotId: string) {
    return apiRequest<{ deleted: boolean }>(`/api/timetable/${slotId}`, {
      method: 'DELETE',
      tenantId,
    });
  },

  generateTimetable(
    tenantId: string,
    payload: {
      scope: 'cohort' | 'grade' | 'cluster' | 'custom' | 'school';
      grade?: string;
      section?: string;
      grades?: string[];
      clusters?: CbcClusterId[];
      replaceExisting?: boolean;
      lessonsPerCohort?: number;
      respectSubjectCounts?: boolean;
    }
  ) {
    return apiRequest<{
      createdCount: number;
      skippedSubjects: string[];
      cohortsScheduled: number;
      singleTeacherCohorts: string[];
    }>('/api/timetable/generate', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    });
  },

  saveAttendanceBatch(
    tenantId: string,
    payload: {
      date: string;
      grade: string;
      section: string;
      recordedBy: string;
      actorRole?: UserRole;
      teacherId?: string;
      entries: Array<{ studentId: string; status: AttendanceStatus; remarks: string }>;
    }
  ) {
    return apiRequest<{ records: AttendanceRecord[] }>('/api/attendance/batch', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    });
  },

  saveStaffAttendanceBatch(
    tenantId: string,
    payload: {
      date: string;
      recordedBy: string;
      staffCategory?: StaffCategory;
      actorRole?: UserRole;
      entries: Array<{ staffId: string; status: AttendanceStatus; remarks: string }>;
    }
  ) {
    return apiRequest<{ records: StaffAttendanceRecord[] }>('/api/attendance/staff/batch', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    });
  },

  createLeaveOutChit(
    tenantId: string,
    payload: {
      studentId: string;
      startDate: string;
      days: number;
      reason: string;
      issuedBy?: string;
    }
  ) {
    return apiRequest<{ chit: LeaveOutChit }>('/api/attendance/leave-chits', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    });
  },

  deleteLeaveOutChit(tenantId: string, chitId: string) {
    return apiRequest<{ deleted: boolean }>(`/api/attendance/leave-chits/${chitId}`, {
      method: 'DELETE',
      tenantId,
    });
  },

  createExamCycle(
    tenantId: string,
    payload: { title: string; term: string; startDate: string; endDate: string }
  ) {
    return apiRequest<{ cycle: ExamCycle }>('/api/exams/cycles', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    });
  },

  upsertExamScore(
    tenantId: string,
    payload: {
      examCycleId: string;
      studentId: string;
      subject: string;
      score: number;
      remarks?: string;
    }
  ) {
    return apiRequest<{ result: ExamResult }>('/api/exams/scores', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    });
  },

  saveExamScoresBatch(
    tenantId: string,
    payload: {
      examCycleId?: string;
      examType?: string;
      grade: string;
      section: string;
      teacherId: string;
      entries: Array<{ studentId: string; subject: string; score: number; remarks?: string }>;
    }
  ) {
    return apiRequest<{ results: ExamResult[]; cycle: ExamCycle; savedCount: number }>(
      '/api/exams/scores/batch',
      {
        method: 'POST',
        tenantId,
        body: JSON.stringify(payload),
      }
    );
  },

  publishExamCycle(tenantId: string, cycleId: string) {
    return apiRequest<{ cycle: ExamCycle }>(`/api/exams/cycles/${cycleId}/publish`, {
      method: 'POST',
      tenantId,
    });
  },

  upsertFeeStructure(
    tenantId: string,
    payload: {
      grade: string;
      term: string;
      votelines: Array<{ id?: string; name: string; amount: number }>;
    }
  ) {
    return apiRequest<{ feeStructure: FeeStructure }>('/api/fees/structures', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    });
  },

  createInvoice(
    tenantId: string,
    payload: { studentId: string; term: string; dueDate: string; totalAmount: number }
  ) {
    return apiRequest<{ invoice: FeeInvoice }>('/api/fees/invoices', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    });
  },

  recordPayment(
    tenantId: string,
    invoiceId: string,
    payload: {
      amount: number;
      method: PaymentMethod;
      reference: string;
      recordedBy: string;
      paidAt?: string;
    }
  ) {
    return apiRequest<{ invoice: FeeInvoice }>(`/api/fees/invoices/${invoiceId}/payments`, {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    });
  },

  recordPaymentsBatch(
    tenantId: string,
    payload: {
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
  ) {
    return apiRequest<{
      updatedInvoices: FeeInvoice[];
      processedCount: number;
      skippedCount: number;
      totalCollected: number;
    }>('/api/fees/payments/batch', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    });
  },

  createExpense(
    tenantId: string,
    payload: {
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
  ) {
    return apiRequest<{ expense: SchoolExpense }>('/api/finance/expenses', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    });
  },

  addExpenseAttachment(
    tenantId: string,
    expenseId: string,
    payload: {
      fileName: string;
      mimeType?: string;
      fileSize?: number;
      docType?: ExpenseAttachmentType;
      dataUrl: string;
      uploadedBy?: string;
    }
  ) {
    return apiRequest<{ expense: SchoolExpense }>(
      `/api/finance/expenses/${expenseId}/attachments`,
      {
        method: 'POST',
        tenantId,
        body: JSON.stringify(payload),
      }
    );
  },

  deleteExpenseAttachment(tenantId: string, expenseId: string, attachmentId: string) {
    return apiRequest<{ expense: SchoolExpense }>(
      `/api/finance/expenses/${expenseId}/attachments/${attachmentId}`,
      {
        method: 'DELETE',
        tenantId,
      }
    );
  },

  updateExpenseStatus(tenantId: string, expenseId: string, status: ExpenseStatus) {
    return apiRequest<{ expense: SchoolExpense }>(`/api/finance/expenses/${expenseId}`, {
      method: 'PATCH',
      tenantId,
      body: JSON.stringify({ status }),
    });
  },

  deleteExpense(tenantId: string, expenseId: string) {
    return apiRequest<{ deleted: boolean }>(`/api/finance/expenses/${expenseId}`, {
      method: 'DELETE',
      tenantId,
    });
  },

  verifyEtimsReceipt(
    tenantId: string,
    payload: {
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
  ) {
    return apiRequest<{ record: EtimsVerificationRecord }>('/api/finance/etims/verify', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    });
  },

  deleteEtimsCheck(tenantId: string, checkId: string) {
    return apiRequest<{ deleted: boolean }>(`/api/finance/etims/${checkId}`, {
      method: 'DELETE',
      tenantId,
    });
  },

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
  ) {
    return apiRequest<{
      imported: ReconciliationLine[];
      matchedCount: number;
      unmatchedCount: number;
    }>('/api/finance/reconciliation/import', {
      method: 'POST',
      tenantId,
      body: JSON.stringify({ lines }),
    });
  },

  autoMatchReconciliation(tenantId: string) {
    return apiRequest<{ matchedCount: number }>('/api/finance/reconciliation/auto-match', {
      method: 'POST',
      tenantId,
    });
  },

  updateReconciliationLine(
    tenantId: string,
    lineId: string,
    payload: {
      status: ReconciliationStatus;
      matchedType?: 'Fee Payment' | 'Expense Voucher';
      matchedRecordId?: string;
      matchedLabel?: string;
      notes?: string;
    }
  ) {
    return apiRequest<{ line: ReconciliationLine }>(`/api/finance/reconciliation/${lineId}`, {
      method: 'PATCH',
      tenantId,
      body: JSON.stringify(payload),
    });
  },

  deleteReconciliationLine(tenantId: string, lineId: string) {
    return apiRequest<{ deleted: boolean }>(`/api/finance/reconciliation/${lineId}`, {
      method: 'DELETE',
      tenantId,
    });
  },

  generatePayrollRun(tenantId: string, payPeriod: string) {
    return apiRequest<{ entries: PayrollEntry[] }>('/api/finance/payroll/generate', {
      method: 'POST',
      tenantId,
      body: JSON.stringify({ payPeriod }),
    });
  },

  upsertPayrollEntry(
    tenantId: string,
    payload: {
      id?: string;
      payPeriod: string;
      staffId?: string;
      staffName: string;
      staffCategory: 'Teaching' | 'Non-Teaching';
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
  ) {
    return apiRequest<{ entry: PayrollEntry }>('/api/finance/payroll', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    });
  },

  updatePayrollStatus(tenantId: string, entryId: string, status: PayrollStatus) {
    return apiRequest<{ entry: PayrollEntry }>(`/api/finance/payroll/${entryId}/status`, {
      method: 'PATCH',
      tenantId,
      body: JSON.stringify({ status }),
    });
  },

  deletePayrollEntry(tenantId: string, entryId: string) {
    return apiRequest<{ deleted: boolean }>(`/api/finance/payroll/${entryId}`, {
      method: 'DELETE',
      tenantId,
    });
  },

  upsertBudgetAllocation(
    tenantId: string,
    payload: {
      category: ExpenseCategory;
      allocatedAmount: number;
      fiscalYear?: string;
      term?: string;
      notes?: string;
    }
  ) {
    return apiRequest<{ budget: BudgetAllocation }>('/api/finance/budgets', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    });
  },

  createApprovalRecord(
    tenantId: string,
    payload: {
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
  ) {
    return apiRequest<{ record: ApprovalSignOffRecord }>('/api/finance/approvals', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    });
  },

  updateApprovalDecision(
    tenantId: string,
    recordId: string,
    payload: { decision: ApprovalDecision; remarks?: string }
  ) {
    return apiRequest<{ record: ApprovalSignOffRecord }>(`/api/finance/approvals/${recordId}`, {
      method: 'PATCH',
      tenantId,
      body: JSON.stringify(payload),
    });
  },

  deleteApprovalRecord(tenantId: string, recordId: string) {
    return apiRequest<{ deleted: boolean }>(`/api/finance/approvals/${recordId}`, {
      method: 'DELETE',
      tenantId,
    });
  },

  createAnnouncement(
    tenantId: string,
    payload: {
      title: string;
      body: string;
      audience: Announcement['audience'];
      priority: Announcement['priority'];
      authorName: string;
      authorRole: UserRole;
    }
  ) {
    return apiRequest<{ announcement: Announcement }>('/api/communications/announcements', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    });
  },

  createMessage(
    tenantId: string,
    payload: { channel: string; senderName: string; senderRole: UserRole; body: string }
  ) {
    return apiRequest<{ message: DirectMessage }>('/api/communications/messages', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    });
  },

  logWhatsAppDispatch(
    tenantId: string,
    payload: {
      category: WhatsAppDispatchCategory;
      studentId: string;
      studentName: string;
      guardianName: string;
      guardianPhone: string;
      referenceLabel: string;
      messagePreview: string;
      sentBy: string;
    }
  ) {
    return apiRequest<{ record: WhatsAppDispatchRecord }>('/api/communications/whatsapp-log', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    });
  },

  markNotificationsRead(tenantId: string, notificationId?: string) {
    return apiRequest<{ ok: boolean }>('/api/notifications/read', {
      method: 'POST',
      tenantId,
      body: JSON.stringify({ notificationId }),
    });
  },

  // Isolated Developer Control Plane Endpoints (/api/dev/*)
  getDevTelemetry() {
    return devApiRequest<{ telemetry: DevPlatformTelemetry }>('/api/dev/telemetry');
  },

  devOnboardTenant(payload: {
    name: string;
    emailDomain?: string;
    location?: string;
    curriculum?: string;
    academicYear?: string;
    currentTerm?: string;
    currency?: CurrencyCode;
    plan?: TenantPlan;
    status?: TenantStatus;
    learnerCap?: number;
    subscriptionCycle?: SubscriptionCycle;
    renewalDate?: string;
    branding?: Partial<TenantBranding>;
    adminFullName: string;
    adminEmail?: string;
    adminPassword?: string;
  }) {
    return devApiRequest<{
      tenant: Tenant;
      adminUser: { fullName: string; email: string; oneTimePassword: string };
      auditEntry: AdminAuditEntry;
    }>('/api/dev/tenants', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  devUpdateSubscription(
    tenantId: string,
    payload: {
      plan?: TenantPlan;
      learnerCap?: number;
      subscriptionCycle?: SubscriptionCycle;
      renewalDate?: string;
    }
  ) {
    return devApiRequest<{ tenant: Tenant; auditEntry: AdminAuditEntry }>(
      `/api/dev/tenants/${tenantId}/subscription`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    );
  },

  devToggleKillSwitch(
    tenantId: string,
    payload: { status: TenantStatus; reason?: string }
  ) {
    return devApiRequest<{ tenant: Tenant; auditEntry: AdminAuditEntry }>(
      `/api/dev/tenants/${tenantId}/kill-switch`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    );
  },

  getDevImpersonationTargets() {
    return devApiRequest<{ targets: DevImpersonationTarget[] }>('/api/dev/impersonation/targets');
  },

  async devStartImpersonation(payload: {
    tenantId: string;
    userId?: string;
    readOnly?: boolean;
  }): Promise<{ session: AuthSessionInfo; auditEntry: AdminAuditEntry }> {
    const currentDevSession = readStoredAuthSession();
    if (!currentDevSession || !isDeveloperRoleClient(currentDevSession.user.role)) {
      throw new Error('Developer authentication required to impersonate a school tenant.');
    }
    const result = await devApiRequest<{ session: AuthSessionInfo; auditEntry: AdminAuditEntry }>(
      '/api/dev/impersonate',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
    writeDevRestoreSession(currentDevSession);
    writeStoredAuthSession(result.session);
    writeStoredAdminSession(null);
    return result;
  },

  async devExitImpersonation(): Promise<AuthSessionInfo | null> {
    const active = readStoredAuthSession();
    const restore = readDevRestoreSession();
    writeDevRestoreSession(null);
    if (!restore) {
      return active;
    }
    writeStoredAuthSession(restore);
    writeStoredAdminSession(null);
    try {
      await apiRequest<{ auditEntry: AdminAuditEntry }>('/api/dev/impersonate/end', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${restore.token}`,
        },
        body: JSON.stringify({
          tenantId: active?.user.tenantId,
          targetEmail: active?.user.email,
        }),
      });
    } catch {
      // ignore offline audit termination errors
    }
    return restore;
  },

  getDevAuditLogs(limit = 80) {
    return devApiRequest<{ logs: AdminAuditEntry[] }>(`/api/dev/audit-logs?limit=${limit}`);
  },
};

export function useTenantSocket(
  tenantId: string,
  onEvent: (event: WsServerEvent) => void
) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!tenantId) {
      setConnected(false);
      return;
    }
    let active = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 1000;

    function connect() {
      if (!active || !tenantId) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${proto}//${window.location.host}/ws`);
      wsRef.current = socket;

      socket.onopen = () => {
        if (!active) return;
        setConnected(true);
        retryDelay = 1000;
        socket.send(JSON.stringify({ type: 'subscribe', tenantId }));
      };

      socket.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(evt.data) as WsServerEvent;
          onEventRef.current(parsed);
        } catch {
          // ignore malformed frame
        }
      };

      socket.onclose = () => {
        if (!active) return;
        setConnected(false);
        reconnectTimer = setTimeout(() => {
          retryDelay = Math.min(8000, retryDelay * 1.5);
          connect();
        }, retryDelay);
      };

      socket.onerror = () => {
        socket.close();
      };
    }

    connect();

    return () => {
      active = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [Boolean(tenantId)]);

  useEffect(() => {
    if (tenantId && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', tenantId }));
    }
  }, [tenantId]);

  return { connected };
}
