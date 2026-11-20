import { randomUUID } from 'node:crypto';
import {
  DEFAULT_TENANT_BRANDING,
  DEFAULT_TIER_LEARNER_CAPS,
  deriveSchoolEmailDomain,
  PUBLIC_EMAIL_DOMAINS,
  sanitizeSchoolEmailDomain,
  type AdminAuditAction,
  type AdminAuditEntry,
  type AuthSessionInfo,
  type CurrencyCode,
  type DevImpersonationTarget,
  type DevPlatformTelemetry,
  type PayeBand,
  type PayrollStatutoryRateSchedule,
  type SubscriptionCycle,
  type Tenant,
  type TenantBranding,
  type TenantPlan,
  type TenantStatus,
  type TenantUser,
} from '../../src/shared/types.ts';
import {
  createUserSessionToken,
  generateOneTimePassword,
  isDeveloperRole,
} from '../middleware/adminAuth.ts';
import { ConflictError, TenantStore } from '../store.ts';

const ALLOWED_PLANS = new Set<TenantPlan>(['Starter', 'Growth', 'Enterprise']);
const ALLOWED_STATUSES = new Set<TenantStatus>(['Active', 'Trial', 'Suspended']);
const ALLOWED_CYCLES = new Set<SubscriptionCycle>(['Monthly', 'Annual']);
const ALLOWED_CURRENCIES = new Set<CurrencyCode>(['KES', 'USD']);
const HEX_COLOR_RE = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;

export interface DeveloperOnboardTenantPayload {
  name: string;
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
  learnerCap?: number;
  subscriptionCycle?: SubscriptionCycle;
  renewalDate?: string;
  branding?: Partial<TenantBranding>;
  adminFullName: string;
  adminEmail?: string;
  adminPhone?: string;
  adminPassword?: string;
}

export class PlatformDeveloperService {
  private readonly store: TenantStore;

  constructor(store: TenantStore) {
    this.store = store;
  }

  private assertDeveloperActor(actor: TenantUser | undefined): TenantUser {
    if (!actor || !isDeveloperRole(actor.role)) {
      throw new ConflictError(
        'Forbidden: Isolated Developer Control Plane requires Developer role.',
        403
      );
    }
    return actor;
  }

  private recordAudit(
    actor: TenantUser,
    action: AdminAuditAction,
    tenantId: string,
    tenantName: string,
    summary: string
  ): AdminAuditEntry {
    return this.store.appendAdminAuditLog({
      id: `dev-audit-${randomUUID().slice(0, 8)}`,
      timestamp: new Date().toISOString(),
      actorRole: actor.role,
      actorEmail: actor.email,
      action,
      tenantId,
      tenantName,
      summary,
    });
  }

  getGlobalTelemetry(actor: TenantUser, wsConnectedClients: number): DevPlatformTelemetry {
    this.assertDeveloperActor(actor);
    return this.store.getPlatformTelemetrySnapshot(wsConnectedClients);
  }

  listAuditLogs(actor: TenantUser, limit = 80): AdminAuditEntry[] {
    this.assertDeveloperActor(actor);
    return this.store.listAdminAuditLogs(limit);
  }

  async onboardTenant(
    actor: TenantUser,
    raw: DeveloperOnboardTenantPayload
  ): Promise<{
    tenant: Tenant;
    adminUser: { fullName: string; email: string; oneTimePassword: string };
    auditEntry: AdminAuditEntry;
  }> {
    const verified = this.assertDeveloperActor(actor);

    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (name.length < 2) {
      throw new ConflictError('School tenant name must be at least 2 characters.', 400);
    }

    const existingTenants = this.store.listTenants();
    if (existingTenants.some((t) => t.name.trim().toLowerCase() === name.toLowerCase())) {
      throw new ConflictError(`A school tenant named "${name}" already exists.`, 409);
    }

    const emailDomain = sanitizeSchoolEmailDomain(
      raw.emailDomain || deriveSchoolEmailDomain(name)
    );
    if (!emailDomain || emailDomain.length < 2 || !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(emailDomain)) {
      throw new ConflictError('Provide a valid school email domain (e.g. academy.ac.ke).', 400);
    }
    if (PUBLIC_EMAIL_DOMAINS.has(emailDomain)) {
      throw new ConflictError(
        `Public domain "@${emailDomain}" cannot be assigned to a school tenant.`,
        400
      );
    }
    const domainClash = existingTenants.find(
      (t) => (t.emailDomain || deriveSchoolEmailDomain(t.slug)).toLowerCase() === emailDomain
    );
    if (domainClash) {
      throw new ConflictError(
        `Email domain "@${emailDomain}" is already bound to ${domainClash.name}.`,
        409
      );
    }

    const currency: CurrencyCode = raw.currency || 'KES';
    if (!ALLOWED_CURRENCIES.has(currency)) {
      throw new ConflictError(`Unsupported currency "${String(currency)}".`, 400);
    }

    const plan: TenantPlan = raw.plan || 'Growth';
    if (!ALLOWED_PLANS.has(plan)) {
      throw new ConflictError(`Unsupported subscription tier "${String(plan)}".`, 400);
    }

    const status: TenantStatus = raw.status || 'Active';
    if (!ALLOWED_STATUSES.has(status)) {
      throw new ConflictError(`Unsupported status "${String(status)}".`, 400);
    }

    const subscriptionCycle: SubscriptionCycle = raw.subscriptionCycle || 'Annual';
    if (!ALLOWED_CYCLES.has(subscriptionCycle)) {
      throw new ConflictError(`Unsupported billing cycle "${String(subscriptionCycle)}".`, 400);
    }

    const learnerCap =
      typeof raw.learnerCap === 'number' && Number.isFinite(raw.learnerCap) && raw.learnerCap > 0
        ? Math.min(50000, Math.round(raw.learnerCap))
        : DEFAULT_TIER_LEARNER_CAPS[plan];

    const primaryColor =
      raw.branding?.primaryColor && HEX_COLOR_RE.test(raw.branding.primaryColor.trim())
        ? raw.branding.primaryColor.trim().toUpperCase()
        : DEFAULT_TENANT_BRANDING.primaryColor;
    const accentColor =
      raw.branding?.accentColor && HEX_COLOR_RE.test(raw.branding.accentColor.trim())
        ? raw.branding.accentColor.trim().toUpperCase()
        : DEFAULT_TENANT_BRANDING.accentColor;

    const adminFullName = (raw.adminFullName || '').trim() || 'Principal Administrator';
    const rawAdminEmail = (raw.adminEmail || '').trim().toLowerCase();
    let finalAdminEmail: string;
    if (rawAdminEmail.includes('@')) {
      const [local, dom] = rawAdminEmail.split('@');
      if (dom !== emailDomain) {
        throw new ConflictError(
          `Initial admin email domain "@${dom}" must match tenant domain "@${emailDomain}".`,
          400
        );
      }
      finalAdminEmail = `${local}@${emailDomain}`;
    } else {
      const localSlug =
        rawAdminEmail ||
        adminFullName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '.')
          .replace(/^\.|\.$/g, '') ||
        'principal';
      finalAdminEmail = `${localSlug}@${emailDomain}`;
    }

    if (
      this.store.listAllUsers().some((u) => u.email.toLowerCase() === finalAdminEmail.toLowerCase())
    ) {
      throw new ConflictError(`User email "${finalAdminEmail}" is already registered.`, 409);
    }

    const oneTimePassword = generateOneTimePassword();

    const tenant = this.store.createTenant({
      name,
      emailDomain,
      curriculum: (raw.curriculum || '').trim() || 'Kenyan CBC (Playgroup – Grade 12)',
      academicYear: (raw.academicYear || '').trim() || '2026–2027',
      currentTerm: (raw.currentTerm || '').trim() || 'Term 1',
      currency,
      plan,
      status,
      learnerCap,
      subscriptionCycle,
      renewalDate: raw.renewalDate,
      location: (raw.location || '').trim() || 'Nairobi, KE',
      contactEmail: (raw.contactEmail || '').trim() || finalAdminEmail,
      contactPhone: (raw.contactPhone || raw.adminPhone || '').trim() || '+254 700 000 000',
      postalAddress: (raw.postalAddress || '').trim() || (raw.location || '').trim() || 'Nairobi, KE',
      branding: {
        primaryColor,
        accentColor,
        sidebarColor: raw.branding?.sidebarColor || '',
        tagline: raw.branding?.tagline || '',
      },
      grades: [],
      subjects: [],
      rooms: [],
      leadTeacherName: adminFullName,
      leadTeacherEmail: finalAdminEmail,
      leadTeacherPhone: raw.adminPhone?.trim() || raw.contactPhone?.trim(),
    });

    const provisionedAdmin = await this.store.provisionTenantAdminAccount(
      tenant,
      adminFullName,
      finalAdminEmail,
      oneTimePassword,
      true,
      raw.adminPhone?.trim() || raw.contactPhone?.trim()
    );

    const auditEntry = this.recordAudit(
      verified,
      'PROVISION_TENANT',
      tenant.id,
      tenant.name,
      `Developer provisioned ${tenant.name} (@${emailDomain}) on ${plan} tier (cap: ${learnerCap} learners). One-time admin password generated for ${finalAdminEmail} (password change required on first login).`
    );

    return {
      tenant,
      adminUser: {
        fullName: adminFullName,
        email: finalAdminEmail,
        oneTimePassword: provisionedAdmin.oneTimePassword,
      },
      auditEntry,
    };
  }

  updateSubscriptionLifecycle(
    actor: TenantUser,
    tenantId: string,
    patch: {
      plan?: TenantPlan;
      learnerCap?: number;
      subscriptionCycle?: SubscriptionCycle;
      renewalDate?: string;
    }
  ): { tenant: Tenant; auditEntry: AdminAuditEntry } {
    const verified = this.assertDeveloperActor(actor);
    const current = this.store.getTenantById(tenantId);

    if (patch.plan !== undefined && !ALLOWED_PLANS.has(patch.plan)) {
      throw new ConflictError(`Unsupported subscription tier "${String(patch.plan)}".`, 400);
    }
    if (patch.subscriptionCycle !== undefined && !ALLOWED_CYCLES.has(patch.subscriptionCycle)) {
      throw new ConflictError(`Unsupported billing cycle "${String(patch.subscriptionCycle)}".`, 400);
    }
    if (
      patch.learnerCap !== undefined &&
      (!Number.isFinite(patch.learnerCap) || patch.learnerCap < 1 || patch.learnerCap > 50000)
    ) {
      throw new ConflictError('Learner cap must be a valid integer between 1 and 50,000.', 400);
    }

    const updated = this.store.updateTenantLifecycle(tenantId, {
      plan: patch.plan,
      learnerCap: patch.learnerCap,
      subscriptionCycle: patch.subscriptionCycle,
      renewalDate: patch.renewalDate,
    });

    const auditEntry = this.recordAudit(
      verified,
      'UPDATE_SUBSCRIPTION',
      updated.id,
      updated.name,
      `Updated subscription lifecycle (${current.plan} -> ${updated.plan}, cap: ${updated.learnerCap} learners, cycle: ${updated.subscriptionCycle}, renewal: ${updated.renewalDate || 'N/A'}).`
    );

    return { tenant: updated, auditEntry };
  }

  toggleKillSwitch(
    actor: TenantUser,
    tenantId: string,
    payload: { status: TenantStatus; reason?: string }
  ): { tenant: Tenant; auditEntry: AdminAuditEntry } {
    const verified = this.assertDeveloperActor(actor);
    const current = this.store.getTenantById(tenantId);
    if (!ALLOWED_STATUSES.has(payload.status)) {
      throw new ConflictError(`Unsupported status "${String(payload.status)}".`, 400);
    }

    const updated = this.store.updateTenantLifecycle(tenantId, {
      status: payload.status,
      suspensionReason: payload.reason,
      suspendedBy: verified.email,
    });

    const action: AdminAuditAction =
      payload.status === 'Suspended' ? 'KILL_SWITCH_SUSPEND' : 'KILL_SWITCH_RESTORE';
    const summary =
      payload.status === 'Suspended'
        ? `KILL SWITCH ENGAGED: Suspended ${updated.name} (was ${current.status || 'Active'}). Reason: ${updated.suspensionReason}`
        : `RESTORED TENANT: Activated ${updated.name} (status set to ${payload.status}).`;

    const auditEntry = this.recordAudit(verified, action, updated.id, updated.name, summary);
    return { tenant: updated, auditEntry };
  }

  listImpersonationTargets(actor: TenantUser): DevImpersonationTarget[] {
    this.assertDeveloperActor(actor);
    const allUsers = this.store.listAllUsers();
    return this.store.listTenants().map((tenant) => ({
      tenantId: tenant.id,
      tenantName: tenant.name,
      emailDomain: tenant.emailDomain || deriveSchoolEmailDomain(tenant.slug),
      status: tenant.status || 'Active',
      plan: tenant.plan,
      location: tenant.location,
      users: allUsers.filter((u) => u.tenantId === tenant.id),
    }));
  }

  async startImpersonation(
    actor: TenantUser,
    payload: { tenantId: string; userId?: string; readOnly?: boolean }
  ): Promise<{ session: AuthSessionInfo; auditEntry: AdminAuditEntry }> {
    const verified = this.assertDeveloperActor(actor);
    const tenant = this.store.getTenantById(payload.tenantId);
    const tenantUsers = this.store.listUsersForTenant(tenant.id).filter((u) => u.status === 'Active');

    let targetUser: TenantUser | undefined;
    if (payload.userId) {
      targetUser = tenantUsers.find((u) => u.id === payload.userId);
      if (!targetUser) {
        throw new ConflictError(
          'Selected user account does not exist or is inactive in the target school tenant.',
          404
        );
      }
    } else {
      targetUser =
        tenantUsers.find((u) => u.role === 'Admin') ||
        tenantUsers.find((u) => u.role === 'Bursar') ||
        tenantUsers[0];
    }

    if (!targetUser) {
      const lead = tenant.teachers[0];
      const emailDomain = tenant.emailDomain || deriveSchoolEmailDomain(tenant.slug);
      await this.store.provisionTenantAdminAccount(
        tenant,
        lead?.name || 'School Administrator',
        lead?.email || `admin@${emailDomain}`,
        undefined,
        true
      );
      targetUser = this.store.listUsersForTenant(tenant.id).find((u) => u.status === 'Active');
    }

    if (!targetUser) {
      throw new ConflictError(`No active staff user available to impersonate for ${tenant.name}.`, 400);
    }

    const readOnly = payload.readOnly !== false;
    const impersonator = {
      id: verified.id,
      fullName: verified.fullName,
      email: verified.email,
      role: verified.role,
      readOnly,
      startedAt: new Date().toISOString(),
    };

    const session = createUserSessionToken(targetUser, {
      tenantName: tenant.name,
      emailDomain: tenant.emailDomain || deriveSchoolEmailDomain(tenant.slug),
      impersonator,
    });

    const auditEntry = this.recordAudit(
      verified,
      'IMPERSONATE_START',
      tenant.id,
      tenant.name,
      `Started ${readOnly ? 'Read-Only' : 'Full Support'} impersonation as ${targetUser.fullName} (${targetUser.email}, ${targetUser.role}) at ${tenant.name}.`
    );

    return { session, auditEntry };
  }

  stopImpersonation(
    actor: TenantUser,
    payload: { tenantId?: string; targetEmail?: string }
  ): { auditEntry: AdminAuditEntry } {
    const verified = this.assertDeveloperActor(actor);
    let tenantName = 'Platform Support Session';
    let resolvedTenantId = payload.tenantId || 'platform';
    if (payload.tenantId && payload.tenantId !== 'platform') {
      try {
        const tenant = this.store.getTenantById(payload.tenantId);
        tenantName = tenant.name;
        resolvedTenantId = tenant.id;
      } catch {
        // ignore if tenant removed
      }
    }

    const auditEntry = this.recordAudit(
      verified,
      'IMPERSONATE_END',
      resolvedTenantId,
      tenantName,
      `Ended tenant support impersonation${payload.targetEmail ? ` (was acting as ${payload.targetEmail})` : ''} and returned to Developer Control Plane.`
    );
    return { auditEntry };
  }

  exportDatabaseSnapshot(actor: TenantUser) {
    this.assertDeveloperActor(actor);
    return this.store.exportDatabaseState();
  }

  restoreDatabaseSnapshot(
    actor: TenantUser,
    rawSnapshot: unknown
  ): {
    restoredTenants: number;
    restoredUsers: number;
    restoredStudents: number;
    auditEntry: AdminAuditEntry;
  } {
    const verified = this.assertDeveloperActor(actor);
    const summary = this.store.restoreDatabaseState(rawSnapshot);
    const auditEntry = this.recordAudit(
      verified,
      'RESTORE_DATABASE',
      'platform',
      'Platform Database Snapshot',
      `Developer restored full database snapshot (${summary.restoredTenants} tenants, ${summary.restoredUsers} accounts, ${summary.restoredStudents} learners).`
    );
    return { ...summary, auditEntry };
  }

  listStatutoryRateSchedules(actor: TenantUser): PayrollStatutoryRateSchedule[] {
    this.assertDeveloperActor(actor);
    return this.store.listStatutoryRateSchedules();
  }

  upsertStatutoryRateSchedule(
    actor: TenantUser,
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
    }
  ): { schedule: PayrollStatutoryRateSchedule; auditEntry: AdminAuditEntry } {
    const verified = this.assertDeveloperActor(actor);
    const schedule = this.store.upsertStatutoryRateSchedule(input, verified.email);
    const auditEntry = this.recordAudit(
      verified,
      'UPDATE_STATUTORY_RATES',
      'platform',
      'Payroll Statutory Schedule',
      `Developer updated statutory payroll schedule "${schedule.label}" (effective ${schedule.effectiveFrom}, currency ${schedule.currency}).`
    );
    return { schedule, auditEntry };
  }
}
