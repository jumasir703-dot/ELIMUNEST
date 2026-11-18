import { randomUUID } from 'node:crypto';
import type {
  AdminAuditAction,
  AdminAuditEntry,
  CurrencyCode,
  SuperAdminTenantSummary,
  TeacherClassAssignment,
  Tenant,
  TenantBranding,
  TenantPlan,
  TenantStatus,
} from '../../src/shared/types.ts';
import { DEFAULT_TENANT_BRANDING } from '../../src/shared/types.ts';
import type { AdminActor } from '../middleware/adminAuth.ts';
import { isPrivilegedAdminRole } from '../middleware/adminAuth.ts';
import { ConflictError, TenantStore } from '../store.ts';

const HEX_COLOR_RE = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;
const ALLOWED_CURRENCIES = new Set<CurrencyCode>(['KES', 'USD']);
const ALLOWED_PLANS = new Set<TenantPlan>(['Starter', 'Enterprise', 'Growth']);
const ALLOWED_STATUSES = new Set<TenantStatus>(['Active', 'Trial', 'Suspended']);
const LOGO_DATA_URI_RE =
  /^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,([A-Za-z0-9+/=]+)$/i;
const MAX_LOGO_DATA_URL_CHARS = 3 * 1024 * 1024;

export interface ProvisionTenantPayload {
  name: string;
  emailDomain?: string;
  curriculum?: string;
  academicYear?: string;
  currentTerm?: string;
  currency?: CurrencyCode;
  plan?: TenantPlan;
  status?: TenantStatus;
  location?: string;
  contactEmail?: string;
  contactPhone?: string;
  postalAddress?: string;
  branding?: Partial<TenantBranding>;
  grades?: string[];
  subjects?: string[];
  rooms?: string[];
  leadTeacherName?: string;
  leadTeacherEmail?: string;
}

export interface UpdateTenantMetadataPayload {
  name?: string;
  emailDomain?: string;
  curriculum?: string;
  academicYear?: string;
  currentTerm?: string;
  currency?: CurrencyCode;
  location?: string;
  contactEmail?: string;
  contactPhone?: string;
  postalAddress?: string;
  plan?: TenantPlan;
  status?: TenantStatus;
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

export interface UpdateTenantBrandingPayload {
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

function normalizeSixCharHex(raw: string): string {
  const trimmed = raw.trim().toUpperCase();
  if (/^#[0-9A-F]{3}$/.test(trimmed)) {
    const [, r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return trimmed;
}

function validateOptionalHex(value: unknown, fieldLabel: string, allowEmpty = false): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new ConflictError(`${fieldLabel} must be a hex color string.`, 400);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    if (allowEmpty) return '';
    throw new ConflictError(`${fieldLabel} cannot be blank.`, 400);
  }
  if (!HEX_COLOR_RE.test(trimmed)) {
    throw new ConflictError(
      `Invalid ${fieldLabel} "${trimmed}". Use a valid #RRGGBB hex color code.`,
      400
    );
  }
  return normalizeSixCharHex(trimmed);
}

function validateLogoDataUrl(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new ConflictError('Logo must be a valid image data URI string.', 400);
  }
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length > MAX_LOGO_DATA_URL_CHARS) {
    throw new ConflictError('Uploaded logo payload exceeds 3 MB limit.', 400);
  }
  const match = LOGO_DATA_URI_RE.exec(trimmed);
  if (!match) {
    throw new ConflictError(
      'Logo must be a base64-encoded PNG, JPG, WEBP, or SVG data URI.',
      400
    );
  }
  const mimeSubtype = match[1].toLowerCase();
  if (mimeSubtype === 'svg+xml') {
    const decodedSvg = Buffer.from(match[2], 'base64').toString('utf-8');
    if (
      /<script\b/i.test(decodedSvg) ||
      /\son[a-z]+\s*=/i.test(decodedSvg) ||
      /javascript:/i.test(decodedSvg) ||
      /<foreignObject\b/i.test(decodedSvg)
    ) {
      throw new ConflictError(
        'SVG logo contains disallowed executable scripts or event handlers.',
        400
      );
    }
  }
  return trimmed;
}

function sanitizeStringArray(arr: unknown, maxItems = 80): string[] {
  if (!Array.isArray(arr)) return [];
  const unique = new Set<string>();
  for (const item of arr) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (trimmed) unique.add(trimmed);
    if (unique.size >= maxItems) break;
  }
  return Array.from(unique);
}

export class PlatformAdminService {
  private readonly repository: TenantStore;

  constructor(repository: TenantStore) {
    this.repository = repository;
  }

  private assertAuthorized(actor: AdminActor | undefined): AdminActor {
    if (!actor || !isPrivilegedAdminRole(actor.role)) {
      throw new ConflictError(
        'Forbidden: Administrative privileges are required for tenant operations.',
        403
      );
    }
    return actor;
  }

  private assertTenantScope(actor: AdminActor, tenantId: string) {
    if (actor.role === 'Developer') return;
    if (!actor.tenantId || actor.tenantId === 'platform' || actor.tenantId !== tenantId) {
      throw new ConflictError(
        'Forbidden: Super Admin and School Administrators may only view and modify their own school.',
        403
      );
    }
  }

  private assertPlatformDeveloper(actor: AdminActor) {
    if (actor.role !== 'Developer') {
      throw new ConflictError(
        'Forbidden: Only Platform Developers may add, delete, or view the multi-tenant directory.',
        403
      );
    }
  }

  private recordAudit(
    actor: AdminActor,
    action: AdminAuditAction,
    tenantId: string,
    tenantName: string,
    summary: string
  ): AdminAuditEntry {
    return this.repository.appendAdminAuditLog({
      id: `audit-${randomUUID().slice(0, 8)}`,
      timestamp: new Date().toISOString(),
      actorRole: actor.role,
      actorEmail: actor.email,
      action,
      tenantId,
      tenantName,
      summary,
    });
  }

  listTenantSummaries(actor: AdminActor): SuperAdminTenantSummary[] {
    const verified = this.assertAuthorized(actor);
    const all = this.repository.getSuperAdminOverview();
    if (verified.role === 'Developer') {
      return all;
    }
    if (!verified.tenantId || verified.tenantId === 'platform') {
      return [];
    }
    return all.filter((s) => s.tenant.id === verified.tenantId);
  }

  listTenants(actor: AdminActor): Tenant[] {
    const verified = this.assertAuthorized(actor);
    const all = this.repository.listTenants();
    if (verified.role === 'Developer') {
      return all;
    }
    if (!verified.tenantId || verified.tenantId === 'platform') {
      return [];
    }
    return all.filter((t) => t.id === verified.tenantId);
  }

  getTenantMetadata(actor: AdminActor, tenantId: string): Tenant {
    const verified = this.assertAuthorized(actor);
    this.assertTenantScope(verified, tenantId);
    return this.repository.getTenantById(tenantId);
  }

  listAuditLogs(actor: AdminActor, limit = 50): AdminAuditEntry[] {
    const verified = this.assertAuthorized(actor);
    const logs = this.repository.listAdminAuditLogs(limit);
    if (verified.role === 'Developer') {
      return logs;
    }
    if (!verified.tenantId || verified.tenantId === 'platform') {
      return [];
    }
    return logs.filter((entry) => entry.tenantId === verified.tenantId);
  }

  provisionTenant(
    actor: AdminActor,
    rawInput: ProvisionTenantPayload
  ): { tenant: Tenant; auditEntry: AdminAuditEntry } {
    const verifiedActor = this.assertAuthorized(actor);
    this.assertPlatformDeveloper(verifiedActor);
    const name = typeof rawInput?.name === 'string' ? rawInput.name.trim() : '';
    if (name.length < 2) {
      throw new ConflictError('School / tenant name must be at least 2 characters.', 400);
    }

    const existingSlugMatch = this.repository
      .listTenants()
      .some((t) => t.name.trim().toLowerCase() === name.toLowerCase());
    if (existingSlugMatch) {
      throw new ConflictError(`A school tenant named "${name}" already exists.`, 409);
    }

    const currency = rawInput.currency || 'KES';
    if (!ALLOWED_CURRENCIES.has(currency)) {
      throw new ConflictError(`Unsupported currency "${String(currency)}". Supported: KES, USD.`, 400);
    }

    const plan = rawInput.plan || 'Growth';
    if (!ALLOWED_PLANS.has(plan)) {
      throw new ConflictError(`Unsupported SaaS plan "${String(plan)}".`, 400);
    }

    const status = rawInput.status || 'Active';
    if (!ALLOWED_STATUSES.has(status)) {
      throw new ConflictError(`Unsupported tenant status "${String(status)}".`, 400);
    }

    const primaryColor =
      validateOptionalHex(rawInput.branding?.primaryColor, 'Primary colour') ||
      DEFAULT_TENANT_BRANDING.primaryColor;
    const accentColor =
      validateOptionalHex(rawInput.branding?.accentColor, 'Accent colour') ||
      DEFAULT_TENANT_BRANDING.accentColor;
    const sidebarColor =
      validateOptionalHex(rawInput.branding?.sidebarColor, 'Sidebar colour', true) ?? '';
    const logoDataUrl = validateLogoDataUrl(rawInput.branding?.logoDataUrl) ?? '';
    const tagline =
      typeof rawInput.branding?.tagline === 'string'
        ? rawInput.branding.tagline.trim().slice(0, 140)
        : '';

    const tenant = this.repository.createTenant({
      name,
      emailDomain: rawInput.emailDomain,
      curriculum: (rawInput.curriculum || '').trim() || 'Kenyan CBC (Playgroup – Grade 12)',
      academicYear: (rawInput.academicYear || '').trim() || '2026–2027',
      currentTerm: (rawInput.currentTerm || '').trim() || 'Term 1',
      currency,
      plan,
      status,
      location: (rawInput.location || '').trim() || 'Nairobi, KE',
      contactEmail: rawInput.contactEmail?.trim(),
      contactPhone: rawInput.contactPhone?.trim(),
      postalAddress: rawInput.postalAddress?.trim(),
      branding: {
        primaryColor,
        accentColor,
        sidebarColor,
        logoDataUrl,
        tagline,
      },
      grades: sanitizeStringArray(rawInput.grades),
      subjects: sanitizeStringArray(rawInput.subjects),
      rooms: sanitizeStringArray(rawInput.rooms),
      leadTeacherName: (rawInput.leadTeacherName || '').trim() || 'Principal Admin',
      leadTeacherEmail: (rawInput.leadTeacherEmail || '').trim() || 'principal@school.ac.ke',
    });

    this.repository.provisionTenantAdminAccount(
      tenant,
      tenant.teachers[0]?.name || 'Principal Admin',
      tenant.teachers[0]?.email || ''
    );

    const auditEntry = this.recordAudit(
      verifiedActor,
      'PROVISION_TENANT',
      tenant.id,
      tenant.name,
      `Provisioned ${tenant.plan} tenant (${tenant.status}) in ${tenant.location} with theme ${primaryColor}.`
    );

    return { tenant, auditEntry };
  }

  updateTenantMetadata(
    actor: AdminActor,
    tenantId: string,
    rawPatch: UpdateTenantMetadataPayload
  ): { tenant: Tenant; auditEntry: AdminAuditEntry } {
    const verifiedActor = this.assertAuthorized(actor);
    this.assertTenantScope(verifiedActor, tenantId);
    const existing = this.repository.getTenantById(tenantId);

    if (rawPatch.name !== undefined && !rawPatch.name.trim()) {
      throw new ConflictError('School name cannot be blank.', 400);
    }
    if (rawPatch.currency !== undefined && !ALLOWED_CURRENCIES.has(rawPatch.currency)) {
      throw new ConflictError(`Unsupported currency "${String(rawPatch.currency)}".`, 400);
    }
    if (rawPatch.plan !== undefined && !ALLOWED_PLANS.has(rawPatch.plan)) {
      throw new ConflictError(`Unsupported plan "${String(rawPatch.plan)}".`, 400);
    }
    if (rawPatch.status !== undefined && !ALLOWED_STATUSES.has(rawPatch.status)) {
      throw new ConflictError(`Unsupported status "${String(rawPatch.status)}".`, 400);
    }
    if (
      verifiedActor.role !== 'Developer' &&
      ((rawPatch.plan !== undefined && rawPatch.plan !== existing.plan) ||
        (rawPatch.status !== undefined && rawPatch.status !== (existing.status || 'Active')))
    ) {
      throw new ConflictError(
        'Forbidden: Only Platform Developers may alter SaaS subscription tiers or tenant status.',
        403
      );
    }

    let validatedBranding: Partial<TenantBranding> | undefined;
    if (rawPatch.branding) {
      validatedBranding = {};
      const nextPrimary = validateOptionalHex(rawPatch.branding.primaryColor, 'Primary colour');
      const nextAccent = validateOptionalHex(rawPatch.branding.accentColor, 'Accent colour');
      const nextSidebar = validateOptionalHex(
        rawPatch.branding.sidebarColor,
        'Sidebar colour',
        true
      );
      const nextLogo = validateLogoDataUrl(rawPatch.branding.logoDataUrl);
      if (nextPrimary !== undefined) validatedBranding.primaryColor = nextPrimary;
      if (nextAccent !== undefined) validatedBranding.accentColor = nextAccent;
      if (nextSidebar !== undefined) validatedBranding.sidebarColor = nextSidebar;
      if (nextLogo !== undefined) validatedBranding.logoDataUrl = nextLogo;
      if (rawPatch.branding.tagline !== undefined) {
        validatedBranding.tagline = String(rawPatch.branding.tagline).trim().slice(0, 140);
      }
    }

    const safePatch: UpdateTenantMetadataPayload = {
      name: rawPatch.name?.trim(),
      emailDomain: rawPatch.emailDomain?.trim(),
      curriculum: rawPatch.curriculum?.trim(),
      academicYear: rawPatch.academicYear?.trim(),
      currentTerm: rawPatch.currentTerm?.trim(),
      currency: rawPatch.currency,
      location: rawPatch.location?.trim(),
      contactEmail: rawPatch.contactEmail?.trim(),
      contactPhone: rawPatch.contactPhone?.trim(),
      postalAddress: rawPatch.postalAddress?.trim(),
      plan: rawPatch.plan,
      status: rawPatch.status,
      branding: validatedBranding,
      addTeacher: rawPatch.addTeacher,
      addRoom: rawPatch.addRoom?.trim(),
      addSubject: rawPatch.addSubject?.trim(),
    };

    const updated = this.repository.updateTenant(tenantId, safePatch);

    let action: AdminAuditAction = 'UPDATE_METADATA';
    let summary = `Updated metadata configuration for ${updated.name}.`;
    if (
      rawPatch.status &&
      rawPatch.status !== existing.status &&
      !rawPatch.name &&
      !rawPatch.branding &&
      !rawPatch.addTeacher &&
      !rawPatch.addRoom &&
      !rawPatch.addSubject
    ) {
      action = 'CHANGE_STATUS';
      summary = `Changed tenant status from ${existing.status || 'Active'} to ${rawPatch.status}.`;
    } else if (rawPatch.addTeacher || rawPatch.addRoom || rawPatch.addSubject) {
      action = 'UPDATE_RESOURCES';
      const additions = [
        rawPatch.addTeacher?.name ? `faculty "${rawPatch.addTeacher.name.trim()}"` : null,
        rawPatch.addRoom ? `room "${rawPatch.addRoom.trim()}"` : null,
        rawPatch.addSubject ? `subject "${rawPatch.addSubject.trim()}"` : null,
      ].filter(Boolean);
      summary = `Added ${additions.join(', ')} to ${updated.name}.`;
    }

    const auditEntry = this.recordAudit(
      verifiedActor,
      action,
      updated.id,
      updated.name,
      summary
    );

    return { tenant: updated, auditEntry };
  }

  updateTenantBranding(
    actor: AdminActor,
    tenantId: string,
    rawInput: UpdateTenantBrandingPayload
  ): { tenant: Tenant; auditEntry: AdminAuditEntry } {
    const verifiedActor = this.assertAuthorized(actor);
    this.assertTenantScope(verifiedActor, tenantId);
    const existing = this.repository.getTenantById(tenantId);

    if (rawInput.name !== undefined && !rawInput.name.trim()) {
      throw new ConflictError('School name cannot be blank.', 400);
    }
    if (rawInput.currency !== undefined && !ALLOWED_CURRENCIES.has(rawInput.currency)) {
      throw new ConflictError(`Unsupported currency "${String(rawInput.currency)}".`, 400);
    }
    if (rawInput.plan !== undefined && !ALLOWED_PLANS.has(rawInput.plan)) {
      throw new ConflictError(`Unsupported plan "${String(rawInput.plan)}".`, 400);
    }
    if (rawInput.status !== undefined && !ALLOWED_STATUSES.has(rawInput.status)) {
      throw new ConflictError(`Unsupported status "${String(rawInput.status)}".`, 400);
    }
    if (
      verifiedActor.role !== 'Developer' &&
      ((rawInput.plan !== undefined && rawInput.plan !== existing.plan) ||
        (rawInput.status !== undefined && rawInput.status !== (existing.status || 'Active')))
    ) {
      throw new ConflictError(
        'Forbidden: Only Platform Developers may alter SaaS subscription tiers or tenant status.',
        403
      );
    }

    let validatedBranding: Partial<TenantBranding> | undefined;
    if (rawInput.branding) {
      validatedBranding = {};
      const nextPrimary = validateOptionalHex(rawInput.branding.primaryColor, 'Primary colour');
      const nextAccent = validateOptionalHex(rawInput.branding.accentColor, 'Accent colour');
      const nextSidebar = validateOptionalHex(
        rawInput.branding.sidebarColor,
        'Sidebar colour',
        true
      );
      const nextLogo = validateLogoDataUrl(rawInput.branding.logoDataUrl);
      if (nextPrimary !== undefined) validatedBranding.primaryColor = nextPrimary;
      if (nextAccent !== undefined) validatedBranding.accentColor = nextAccent;
      if (nextSidebar !== undefined) validatedBranding.sidebarColor = nextSidebar;
      if (nextLogo !== undefined) validatedBranding.logoDataUrl = nextLogo;
      if (rawInput.branding.tagline !== undefined) {
        validatedBranding.tagline = String(rawInput.branding.tagline).trim().slice(0, 140);
      }
    }

    const updated = this.repository.updateTenantBranding(tenantId, {
      name: rawInput.name?.trim(),
      emailDomain: rawInput.emailDomain?.trim(),
      location: rawInput.location?.trim(),
      contactEmail: rawInput.contactEmail?.trim(),
      contactPhone: rawInput.contactPhone?.trim(),
      postalAddress: rawInput.postalAddress?.trim(),
      curriculum: rawInput.curriculum?.trim(),
      academicYear: rawInput.academicYear?.trim(),
      currentTerm: rawInput.currentTerm?.trim(),
      currency: rawInput.currency,
      plan: rawInput.plan,
      status: rawInput.status,
      branding: validatedBranding,
    });

    const logoFlag = updated.branding?.logoDataUrl ? 'with custom logo' : 'using initials crest';
    const auditEntry = this.recordAudit(
      verifiedActor,
      'UPDATE_BRANDING',
      updated.id,
      updated.name,
      `Applied theme ${updated.branding?.primaryColor || '#2563EB'} / ${updated.branding?.accentColor || '#0284C7'} (${logoFlag}).`
    );

    return { tenant: updated, auditEntry };
  }

  deprovisionTenant(
    actor: AdminActor,
    tenantId: string
  ): { deleted: boolean; remainingTenants: Tenant[]; auditEntry: AdminAuditEntry } {
    const verifiedActor = this.assertAuthorized(actor);
    this.assertPlatformDeveloper(verifiedActor);
    const target = this.repository.getTenantById(tenantId);
    const result = this.repository.deleteTenant(tenantId);

    const auditEntry = this.recordAudit(
      verifiedActor,
      'DEPROVISION_TENANT',
      target.id,
      target.name,
      `Deprovisioned tenant "${target.name}" (${target.slug}) and purged isolated workspace data.`
    );

    return {
      deleted: result.deleted,
      remainingTenants: result.remainingTenants,
      auditEntry,
    };
  }
}
