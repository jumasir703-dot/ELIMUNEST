import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';
import {
  getModuleAccessLevel,
  type AuthSessionInfo,
  type ImpersonatorMeta,
  type TenantModulePermission,
  type TenantStatus,
  type TenantUser,
  type UserRole,
  validatePasswordStrength,
} from '../../src/shared/types.ts';

const scryptAsync = promisify(scrypt);

const USER_TOKEN_PREFIX = 'elimunest_v1';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const IMPERSONATION_TTL_MS = 60 * 60 * 1000; // 1 hour scoped support token
const EPHEMERAL_BOOT_SECRET = randomBytes(32).toString('hex');
const MIN_SECRET_LENGTH = 32;

function getConfiguredSecret(): string | null {
  const configured =
    process.env.AUTH_SESSION_SECRET?.trim() || process.env.ADMIN_SESSION_SECRET?.trim();
  return configured && configured.length >= MIN_SECRET_LENGTH ? configured : null;
}

export function isSessionSecretConfigured(): boolean {
  return getConfiguredSecret() !== null;
}

export function assertProductionSessionSecret(): void {
  if (process.env.NODE_ENV === 'production' && !isSessionSecretConfigured()) {
    throw new Error(
      `[elimuNest] FATAL: AUTH_SESSION_SECRET must be set to at least ${MIN_SECRET_LENGTH} characters in production.`
    );
  }
}

assertProductionSessionSecret();

function getSessionSecret(): string {
  const configured = getConfiguredSecret();
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `[elimuNest] FATAL: AUTH_SESSION_SECRET must be set to at least ${MIN_SECRET_LENGTH} characters in production.`
    );
  }
  return EPHEMERAL_BOOT_SECRET;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash || !storedHash.startsWith('scrypt:')) {
    return false;
  }
  const parts = storedHash.split(':');
  if (parts.length !== 3) return false;
  const [, salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  try {
    const derivedBuf = (await scryptAsync(password, salt, 64)) as Buffer;
    const expectedBuf = Buffer.from(expectedHex, 'hex');
    if (derivedBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(derivedBuf, expectedBuf);
  } catch {
    return false;
  }
}

export function generateOneTimePassword(): string {
  // Always >= 13 chars and guaranteed to contain letters + digits (satisfies 10-char password policy)
  return `Otp1-${randomBytes(4).toString('hex').toUpperCase()}`;
}

/**
 * Optional fixed password for the SAMPLE-school accounts (not the Developer account).
 * Set SEED_DEMO_PASSWORD in the hosting dashboard so the sample logins stay the same
 * every time the sample data is loaded (e.g. after each Vercel cold start).
 * Ignored if it fails the password policy. Accounts still require a password
 * change on first login.
 */
export function resolveSeedDemoPassword(): string | null {
  const fromEnv = (process.env.SEED_DEMO_PASSWORD || '').trim();
  if (!fromEnv) return null;
  const err = validatePasswordStrength(fromEnv);
  if (err) {
    console.warn(`[elimuNest] SEED_DEMO_PASSWORD ignored: ${err}`);
    return null;
  }
  return fromEnv;
}

export const DEVELOPER_EMAIL = 'developer@elimunest.platform';

/**
 * Initial password for the platform Developer account.
 * Read from DEVELOPER_BOOTSTRAP_PASSWORD (set it in .env / the hosting dashboard, never in code).
 * If unset or too weak, a random one-time password is generated instead.
 * The account is always created with mustChangePassword = true.
 */
export function resolveDeveloperBootstrapPassword(): { password: string; fromEnv: boolean } {
  const fromEnv = (process.env.DEVELOPER_BOOTSTRAP_PASSWORD || '').trim();
  if (fromEnv) {
    const err = validatePasswordStrength(fromEnv);
    if (err) {
      console.warn(`[elimuNest] DEVELOPER_BOOTSTRAP_PASSWORD ignored: ${err}`);
    } else {
      return { password: fromEnv, fromEnv: true };
    }
  }
  return { password: generateOneTimePassword(), fromEnv: false };
}

export type DeveloperPermission =
  | 'dev:tenants'
  | 'dev:subscriptions'
  | 'dev:impersonate'
  | 'dev:telemetry';

const DEVELOPER_ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<DeveloperPermission>> = {
  Developer: new Set<DeveloperPermission>([
    'dev:tenants',
    'dev:subscriptions',
    'dev:impersonate',
    'dev:telemetry',
  ]),
  'Super Admin': new Set<DeveloperPermission>(),
  Admin: new Set<DeveloperPermission>(),
  Registrar: new Set<DeveloperPermission>(),
  Teacher: new Set<DeveloperPermission>(),
  Bursar: new Set<DeveloperPermission>(),
  'Budget Approver': new Set<DeveloperPermission>(),
  Parent: new Set<DeveloperPermission>(),
  Student: new Set<DeveloperPermission>(),
};

export interface AdminActor {
  id: string;
  tenantId?: string;
  role: UserRole;
  email: string;
  name: string;
}

export interface AuthenticatedRequest extends Request {
  authUser?: TenantUser;
  adminActor?: AdminActor;
  impersonation?: ImpersonatorMeta;
}

export type AdminAuthenticatedRequest = AuthenticatedRequest;

export interface UserTokenClaims {
  sub: string;
  tenantId: string;
  role: UserRole;
  email: string;
  name: string;
  tv?: number;
  iat: number;
  exp: number;
  impersonatedBy?: ImpersonatorMeta;
}

const PRIVILEGED_ROLES: ReadonlySet<UserRole> = new Set<UserRole>([
  'Developer',
  'Super Admin',
  'Admin',
]);
const DEVELOPER_ROLES: ReadonlySet<UserRole> = new Set<UserRole>(['Developer']);

export function isPrivilegedAdminRole(
  role: unknown
): role is 'Developer' | 'Super Admin' | 'Admin' {
  return typeof role === 'string' && PRIVILEGED_ROLES.has(role as UserRole);
}

export function isDeveloperRole(role: unknown): role is 'Developer' {
  return typeof role === 'string' && DEVELOPER_ROLES.has(role as UserRole);
}

export function hasDeveloperPermission(
  role: UserRole | undefined,
  permission: DeveloperPermission
): boolean {
  if (!role) return false;
  return DEVELOPER_ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

function signPrefixedPayload(prefix: string, encodedPayload: string): string {
  return createHmac('sha256', getSessionSecret())
    .update(`${prefix}.${encodedPayload}`)
    .digest('base64url');
}

export function createUserSessionToken(
  user: TenantUser,
  meta?: { tenantName?: string; emailDomain?: string; impersonator?: ImpersonatorMeta }
): AuthSessionInfo {
  const now = Date.now();
  const ttl = meta?.impersonator ? IMPERSONATION_TTL_MS : SESSION_TTL_MS;
  const exp = now + ttl;
  const claims: UserTokenClaims = {
    sub: user.id,
    tenantId: user.tenantId,
    role: user.role,
    email: user.email,
    name: user.fullName,
    tv: user.tokenVersion ?? 0,
    iat: now,
    exp,
    ...(meta?.impersonator ? { impersonatedBy: meta.impersonator } : {}),
  };
  const encodedPayload = Buffer.from(JSON.stringify(claims), 'utf-8').toString('base64url');
  const signature = signPrefixedPayload(USER_TOKEN_PREFIX, encodedPayload);
  return {
    token: `${USER_TOKEN_PREFIX}.${encodedPayload}.${signature}`,
    expiresAt: new Date(exp).toISOString(),
    user,
    tenantName: meta?.tenantName,
    emailDomain: meta?.emailDomain,
    ...(meta?.impersonator ? { impersonator: meta.impersonator } : {}),
  };
}

export function verifyUserSessionToken(token: string): UserTokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== USER_TOKEN_PREFIX) {
    return null;
  }

  const [, encodedPayload, providedSignature] = parts;
  if (!encodedPayload || !providedSignature) {
    return null;
  }

  const expectedSignature = signPrefixedPayload(USER_TOKEN_PREFIX, encodedPayload);
  const providedBuf = Buffer.from(providedSignature, 'utf-8');
  const expectedBuf = Buffer.from(expectedSignature, 'utf-8');
  if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
    return null;
  }

  try {
    const raw = Buffer.from(encodedPayload, 'base64url').toString('utf-8');
    const claims = JSON.parse(raw) as UserTokenClaims;
    if (
      !claims ||
      typeof claims.sub !== 'string' ||
      typeof claims.tenantId !== 'string' ||
      typeof claims.exp !== 'number' ||
      claims.exp <= Date.now()
    ) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}

export function resolveLiveSessionFromToken(
  token: string,
  resolveLiveUser: (userId: string) => TenantUser | null,
  resolveTenantStatus?: (tenantId: string) => TenantStatus | null
): {
  ok: true;
  claims: UserTokenClaims;
  liveUser: TenantUser;
} | {
  ok: false;
  status: 401 | 403;
  error: string;
} {
  const claims = verifyUserSessionToken(token);
  if (!claims) {
    return { ok: false, status: 401, error: 'Session invalid or expired. Please sign in again.' };
  }

  const liveUser = resolveLiveUser(claims.sub);
  if (!liveUser || liveUser.status !== 'Active') {
    return { ok: false, status: 401, error: 'Account is disabled or no longer active.' };
  }

  const expectedTokenVersion = liveUser.tokenVersion ?? 0;
  const presentedTokenVersion = claims.tv ?? 0;
  if (presentedTokenVersion !== expectedTokenVersion) {
    return {
      ok: false,
      status: 401,
      error: 'Session invalidated after password update. Please sign in again.',
    };
  }

  if (
    liveUser.tenantId !== 'platform' &&
    !claims.impersonatedBy &&
    resolveTenantStatus &&
    resolveTenantStatus(liveUser.tenantId) === 'Suspended'
  ) {
    return {
      ok: false,
      status: 403,
      error:
        'Tenant Suspended (Kill Switch Active): This school workspace has been suspended by platform engineering.',
    };
  }

  return { ok: true, claims, liveUser };
}

export function verifyAdminSessionToken(
  token: string,
  resolveLiveUser: (userId: string) => TenantUser | null,
  resolveTenantStatus?: (tenantId: string) => TenantStatus | null
): AdminActor | null {
  const resolved = resolveLiveSessionFromToken(token, resolveLiveUser, resolveTenantStatus);
  if (!resolved.ok) return null;
  const { claims, liveUser } = resolved;
  if (claims.impersonatedBy || !isPrivilegedAdminRole(liveUser.role)) {
    return null;
  }
  return {
    id: liveUser.id,
    tenantId: liveUser.tenantId,
    role: liveUser.role,
    email: liveUser.email,
    name: liveUser.fullName,
  };
}

export function extractBearerToken(req: Request): string | null {
  const authHeader = req.header('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return match && match[1] ? match[1].trim() : null;
}

export function createUserAuthMiddleware(
  resolveLiveUser: (userId: string) => TenantUser | null,
  resolveTenantStatus?: (tenantId: string) => TenantStatus | null
) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({
        error:
          'Authentication required. Sign in with your @school email account to access this workspace.',
      });
      return;
    }

    const resolved = resolveLiveSessionFromToken(token, resolveLiveUser, resolveTenantStatus);
    if (!resolved.ok) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }

    const { claims, liveUser } = resolved;

    // Mandatory password rotation for 1-time password accounts
    if (
      liveUser.mustChangePassword &&
      !claims.impersonatedBy &&
      !req.path.startsWith('/auth/session') &&
      !req.path.startsWith('/auth/change-password') &&
      !req.path.startsWith('/auth/logout')
    ) {
      res.status(403).json({
        error: 'Password change required before accessing workspace.',
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
      return;
    }

    // Safe impersonation read-only enforcement
    if (
      claims.impersonatedBy?.readOnly &&
      req.method !== 'GET' &&
      req.method !== 'HEAD' &&
      !req.path.startsWith('/auth/logout') &&
      !req.path.startsWith('/dev/impersonate/end')
    ) {
      res.status(403).json({
        error:
          'Read-Only Support Impersonation Active: Data mutations are blocked while inspecting this tenant in safe mode.',
      });
      return;
    }

    req.authUser = liveUser;
    if (claims.impersonatedBy) {
      req.impersonation = claims.impersonatedBy;
    }
    if (!claims.impersonatedBy && isPrivilegedAdminRole(liveUser.role)) {
      req.adminActor = {
        id: liveUser.id,
        tenantId: liveUser.tenantId,
        role: liveUser.role,
        email: liveUser.email,
        name: liveUser.fullName,
      };
    }
    next();
  };
}

export function requireRole(...allowedRoles: UserRole[]) {
  const allowedSet = new Set<UserRole>(allowedRoles);
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const authUser = req.authUser;
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!allowedSet.has(authUser.role)) {
      res.status(403).json({
        error: `Forbidden: Role "${authUser.role}" is not permitted to perform this action.`,
      });
      return;
    }
    next();
  };
}

export function requireModule(
  moduleId: TenantModulePermission,
  options?: { allowReadOnlyMutation?: boolean }
) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const authUser = req.authUser;
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const level = getModuleAccessLevel(authUser, moduleId);
    if (level === 'none') {
      res.status(403).json({
        error: `Forbidden: Account lacks access permission to module "${moduleId}".`,
      });
      return;
    }
    const isReadMethod = req.method === 'GET' || req.method === 'HEAD';
    if (!isReadMethod && !options?.allowReadOnlyMutation && level !== 'edit') {
      res.status(403).json({
        error: `Forbidden: Read-only access for module "${moduleId}" does not permit editing.`,
      });
      return;
    }
    next();
  };
}

export function requireDeveloperAuth(requiredPermission?: DeveloperPermission) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const authUser = req.authUser;
    if (!authUser) {
      res.status(401).json({
        error: 'Unauthorized: Developer authentication is required for the control plane.',
      });
      return;
    }

    if (req.impersonation) {
      res.status(403).json({
        error:
          'Forbidden: Exit tenant support impersonation before calling isolated /api/dev control plane endpoints.',
      });
      return;
    }

    if (!isDeveloperRole(authUser.role)) {
      res.status(403).json({
        error: `Forbidden: Role "${authUser.role}" is denied access to the isolated Developer Control Plane.`,
      });
      return;
    }

    if (requiredPermission && !hasDeveloperPermission(authUser.role, requiredPermission)) {
      res.status(403).json({
        error: `Forbidden: Missing required developer permission claim "${requiredPermission}".`,
      });
      return;
    }

    next();
  };
}

export function requireAdminAuth(
  allowedRoles: UserRole[] = ['Super Admin', 'Admin'],
  resolveLiveUser?: (userId: string) => TenantUser | null,
  resolveTenantStatus?: (tenantId: string) => TenantStatus | null
) {
  const allowedSet = new Set<UserRole>(allowedRoles);
  return (req: AdminAuthenticatedRequest, res: Response, next: NextFunction) => {
    let actor = req.adminActor;

    if (!actor && resolveLiveUser) {
      const token = extractBearerToken(req);
      if (token) {
        actor = verifyAdminSessionToken(token, resolveLiveUser, resolveTenantStatus) ?? undefined;
      }
    }

    if (!actor) {
      res.status(401).json({
        error: 'Unauthorized: Valid live Administrator session is required.',
      });
      return;
    }

    if (req.impersonation) {
      res.status(403).json({
        error: 'Forbidden: Administrative endpoints cannot be invoked during impersonation.',
      });
      return;
    }

    if (!allowedSet.has(actor.role)) {
      res.status(403).json({
        error: `Forbidden: Role "${actor.role}" lacks permission for this administrative operation.`,
      });
      return;
    }

    req.adminActor = actor;
    next();
  };
}
