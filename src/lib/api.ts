import { useEffect, useRef, useState } from 'react';
import type {
  AdmissionApplication,
  AdmissionStage,
  Announcement,
  AttendanceRecord,
  AttendanceStatus,
  CbcClusterId,
  DayOfWeek,
  DirectMessage,
  ExamCycle,
  ExamResult,
  FeeInvoice,
  FeeStructure,
  LeaveOutChit,
  NonTeachingStaffProfile,
  OnboardingChecklist,
  PaymentMethod,
  StaffAttendanceRecord,
  StaffCategory,
  Student,
  SuperAdminTenantSummary,
  TeacherClassAssignment,
  TeacherProfile,
  Tenant,
  TenantBranding,
  TenantStatus,
  TenantWorkspaceData,
  TimetableSlot,
  UserRole,
  WsServerEvent,
} from '../shared/types';

async function apiRequest<T>(
  url: string,
  options: RequestInit & { tenantId?: string } = {}
): Promise<T> {
  const { tenantId, headers, ...rest } = options;
  const mergedHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(headers as Record<string, string> | undefined),
  };
  if (tenantId) {
    mergedHeaders['x-tenant-id'] = tenantId;
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
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export const saasApi = {
  getWorkspace(tenantId: string) {
    return apiRequest<TenantWorkspaceData>('/api/workspace', { tenantId });
  },

  getSuperAdminTenants() {
    return apiRequest<{ summaries: SuperAdminTenantSummary[] }>('/api/super-admin/tenants');
  },

  createTenant(payload: {
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
  }) {
    return apiRequest<{ tenant: Tenant }>('/api/tenants', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

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
  ) {
    return apiRequest<{ tenant: Tenant }>(`/api/tenants/${tenantId}`, {
      method: 'PATCH',
      tenantId,
      body: JSON.stringify(patch),
    });
  },

  updateTenantBranding(
    tenantId: string,
    payload: {
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
  ) {
    return apiRequest<{ tenant: Tenant }>(`/api/tenants/${tenantId}/branding`, {
      method: 'PATCH',
      tenantId,
      body: JSON.stringify(payload),
    });
  },

  deleteTenant(tenantId: string) {
    return apiRequest<{ deleted: boolean; remainingTenants: Tenant[] }>(
      `/api/tenants/${tenantId}`,
      {
        method: 'DELETE',
        tenantId,
      }
    );
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
      tuitionFee: number;
      labFee: number;
      technologyFee: number;
      activitiesFee: number;
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
    payload: { amount: number; method: PaymentMethod; reference: string; recordedBy: string }
  ) {
    return apiRequest<{ invoice: FeeInvoice }>(`/api/fees/invoices/${invoiceId}/payments`, {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
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

  markNotificationsRead(tenantId: string, notificationId?: string) {
    return apiRequest<{ ok: boolean }>('/api/notifications/read', {
      method: 'POST',
      tenantId,
      body: JSON.stringify({ notificationId }),
    });
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
    let active = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 1000;

    function connect() {
      if (!active) return;
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
  }, []);

  useEffect(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', tenantId }));
    }
  }, [tenantId]);

  return { connected };
}
