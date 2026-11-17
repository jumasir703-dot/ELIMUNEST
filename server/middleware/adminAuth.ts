import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type {
  AdminSessionInfo,
  AuthSessionInfo,
  ImpersonatorMeta,
  TenantStatus,
  TenantUser,
  UserRole,
} from '../../src/shared/types.ts';

const USER_TOKEN_PREFIX = 'elimunest_v1';
const ADMIN_TOKEN_PREFIX = 'admin_v1';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const IMPERSONATION_TTL_MS = 60 * 60 * 1000; // 1 hour scoped support token
const EPHEMERAL_BOOT_SECRET = randomBytes(32).toString('hex');

function getSessionSecret(): string {
  const configured =
    process.env.AUTH_SESSION_SECRET?.trim() || process.env.ADMIN_SESSION_SECRET?.trim();
  return configured && configured.length >= 16 ? configured : EPHEMERAL_BOOT_SECRET;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash || !storedHash.startsWith('scrypt:')) {
    return false;
  }
  const parts = storedHash.split(':');
  if (parts.length !== 3) return false;
  const [, salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  try {
    const derivedBuf = scryptSync(password, salt, 64);
    const expectedBuf = Buffer.from(expectedHex, 'hex');
    if (derivedBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(derivedBuf, expectedBuf);
  } catch {
    return false;
  }
}

export function generateOneTimePassword(): string {
  return `Otp-${randomBytes(4).toString('hex').toUpperCase()}`;
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
  'Super Admin': new Set<DeveloperPermission>([
    'dev:tenants',
    'dev:subscriptions',
    'dev:impersonate',
    'dev:telemetry',
  ]),
  Admin: new Set<DeveloperPermission>(),
  Registrar: new Set<DeveloperPermission>(),
  Teacher: new Set<DeveloperPermission>(),
  Bursar: new Set<DeveloperPermission>(),
  Parent: new Set<DeveloperPermission>(),
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
  iat: number;
  exp: number;
  impersonatedBy?: ImpersonatorMeta;
}

interface AdminTokenClaims {
  sub: string;
  tenantId?: string;
  role: UserRole;
  email: string;
  name: string;
  iat: number;
  exp: number;
}

const PRIVILEGED_ROLES: ReadonlySet<UserRole> = new Set<UserRole>([
  'Developer',
  'Super Admin',
  'Admin',
]);
const DEVELOPER_ROLES: ReadonlySet<UserRole> = new Set<UserRole>(['Developer', 'Super Admin']);

export function isPrivilegedAdminRole(
  role: unknown
): role is 'Developer' | 'Super Admin' | 'Admin' {
  return typeof role === 'string' && PRIVILEGED_ROLES.has(role as UserRole);
}

export function isDeveloperRole(role: unknown): role is 'Developer' | 'Super Admin' {
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

export function createAdminSessionToken(actor: AdminActor): AdminSessionInfo {
  const now = Date.now();
  const exp = now + SESSION_TTL_MS;
  const claims: AdminTokenClaims = {
    sub: actor.id,
    tenantId: actor.tenantId,
    role: actor.role,
    email: actor.email,
    name: actor.name,
    iat: now,
    exp,
  };
  const encodedPayload = Buffer.from(JSON.stringify(claims), 'utf-8').toString('base64url');
  const signature = signPrefixedPayload(ADMIN_TOKEN_PREFIX, encodedPayload);
  return {
    token: `${ADMIN_TOKEN_PREFIX}.${encodedPayload}.${signature}`,
    expiresAt: new Date(exp).toISOString(),
    actor: {
      id: actor.id,
      role: actor.role,
      email: actor.email,
      name: actor.name,
    },
  };
}

export function verifyAdminSessionToken(token: string): AdminActor | null {
  const userClaims = verifyUserSessionToken(token);
  if (userClaims && !userClaims.impersonatedBy && isPrivilegedAdminRole(userClaims.role)) {
    return {
      id: userClaims.sub,
      tenantId: userClaims.tenantId,
      role: userClaims.role,
      email: userClaims.email,
      name: userClaims.name,
    };
  }

  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== ADMIN_TOKEN_PREFIX) {
    return null;
  }

  const [, encodedPayload, providedSignature] = parts;
  if (!encodedPayload || !providedSignature) {
    return null;
  }

  const expectedSignature = signPrefixedPayload(ADMIN_TOKEN_PREFIX, encodedPayload);
  const providedBuf = Buffer.from(providedSignature, 'utf-8');
  const expectedBuf = Buffer.from(expectedSignature, 'utf-8');
  if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
    return null;
  }

  try {
    const raw = Buffer.from(encodedPayload, 'base64url').toString('utf-8');
    const claims = JSON.parse(raw) as AdminTokenClaims;
    if (!claims || typeof claims.exp !== 'number' || claims.exp <= Date.now()) {
      return null;
    }
    if (!isPrivilegedAdminRole(claims.role)) {
      return null;
    }
    return {
      id: claims.sub || 'actor-admin',
      tenantId: claims.tenantId,
      role: claims.role,
      email: claims.email || 'admin@elimunest.platform',
      name: claims.name || claims.role,
    };
  } catch {
    return null;
  }
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

    const claims = verifyUserSessionToken(token);
    if (!claims) {
      res.status(401).json({
        error: 'Session invalid or expired. Please sign in again.',
      });
      return;
    }

    const liveUser = resolveLiveUser(claims.sub);
    if (!liveUser || liveUser.status !== 'Active') {
      res.status(401).json({
        error: 'Account is disabled or no longer active.',
      });
      return;
    }

    // Immediate kill-switch enforcement across live tenant API traffic
    if (
      liveUser.tenantId !== 'platform' &&
      !claims.impersonatedBy &&
      resolveTenantStatus &&
      resolveTenantStatus(liveUser.tenantId) === 'Suspended'
    ) {
      res.status(403).json({
        error:
          'Tenant Suspended (Kill Switch Active): This school workspace has been suspended by platform engineering.',
      });
      return;
    }

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

export function issueAdminSession(req: AuthenticatedRequest, res: Response) {
  const token = extractBearerToken(req);
  const userClaims = token ? verifyUserSessionToken(token) : null;
  if (!userClaims || userClaims.impersonatedBy || !isPrivilegedAdminRole(userClaims.role)) {
    res.status(401).json({
      error: 'Unauthorized: Sign in as an Admin or Super Admin account first.',
    });
    return;
  }

  const session = createAdminSessionToken({
    id: userClaims.sub,
    tenantId: userClaims.tenantId,
    role: userClaims.role,
    email: userClaims.email,
    name: userClaims.name,
  });
  res.json(session);
}

export function requireAdminAuth(allowedRoles: UserRole[] = ['Super Admin', 'Admin']) {
  const allowedSet = new Set<UserRole>(allowedRoles);
  return (req: AdminAuthenticatedRequest, res: Response, next: NextFunction) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({
        error: 'Unauthorized: Missing or invalid Admin Bearer session token.',
      });
      return;
    }

    const actor = verifyAdminSessionToken(token);
    if (!actor) {
      res.status(401).json({
        error: 'Unauthorized: Admin session token is invalid or has expired.',
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
