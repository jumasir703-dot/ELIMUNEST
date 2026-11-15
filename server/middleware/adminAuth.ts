import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { AdminSessionInfo, UserRole } from '../../src/shared/types.ts';

const TOKEN_PREFIX = 'admin_v1';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const EPHEMERAL_BOOT_SECRET = randomBytes(32).toString('hex');

function getSessionSecret(): string {
  const configured = process.env.ADMIN_SESSION_SECRET?.trim();
  return configured && configured.length >= 16 ? configured : EPHEMERAL_BOOT_SECRET;
}

export interface AdminActor {
  id: string;
  role: UserRole;
  email: string;
  name: string;
}

export interface AdminAuthenticatedRequest extends Request {
  adminActor?: AdminActor;
}

interface AdminTokenClaims {
  sub: string;
  role: UserRole;
  email: string;
  name: string;
  iat: number;
  exp: number;
}

const PRIVILEGED_ROLES: ReadonlySet<UserRole> = new Set<UserRole>(['Super Admin', 'Admin']);

export function isPrivilegedAdminRole(role: unknown): role is 'Super Admin' | 'Admin' {
  return typeof role === 'string' && PRIVILEGED_ROLES.has(role as UserRole);
}

function signPayload(encodedPayload: string): string {
  return createHmac('sha256', getSessionSecret())
    .update(`${TOKEN_PREFIX}.${encodedPayload}`)
    .digest('base64url');
}

export function createAdminSessionToken(actor: AdminActor): AdminSessionInfo {
  const now = Date.now();
  const exp = now + SESSION_TTL_MS;
  const claims: AdminTokenClaims = {
    sub: actor.id,
    role: actor.role,
    email: actor.email,
    name: actor.name,
    iat: now,
    exp,
  };
  const encodedPayload = Buffer.from(JSON.stringify(claims), 'utf-8').toString('base64url');
  const signature = signPayload(encodedPayload);
  return {
    token: `${TOKEN_PREFIX}.${encodedPayload}.${signature}`,
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
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) {
    return null;
  }

  const [, encodedPayload, providedSignature] = parts;
  if (!encodedPayload || !providedSignature) {
    return null;
  }

  const expectedSignature = signPayload(encodedPayload);
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
      role: claims.role,
      email: claims.email || 'admin@elimunest.platform',
      name: claims.name || claims.role,
    };
  } catch {
    return null;
  }
}

export function issueAdminSession(req: Request, res: Response) {
  const body = (req.body || {}) as {
    role?: unknown;
    actorEmail?: unknown;
    actorName?: unknown;
  };

  if (!isPrivilegedAdminRole(body.role)) {
    res.status(403).json({
      error: 'Forbidden: Only Super Admin or Admin roles can establish a platform admin session.',
    });
    return;
  }

  const role = body.role;
  const defaultEmail =
    role === 'Super Admin' ? 'superadmin@elimunest.platform' : 'principal.admin@elimunest.platform';
  const email =
    typeof body.actorEmail === 'string' && body.actorEmail.trim()
      ? body.actorEmail.trim().slice(0, 120)
      : defaultEmail;
  const name =
    typeof body.actorName === 'string' && body.actorName.trim()
      ? body.actorName.trim().slice(0, 80)
      : role;

  const session = createAdminSessionToken({
    id: role === 'Super Admin' ? 'actor-super-admin' : 'actor-school-admin',
    role,
    email,
    name,
  });
  res.json(session);
}

export function requireAdminAuth(allowedRoles: UserRole[] = ['Super Admin', 'Admin']) {
  const allowedSet = new Set<UserRole>(allowedRoles);
  return (req: AdminAuthenticatedRequest, res: Response, next: NextFunction) => {
    const authHeader = req.header('authorization') || '';
    const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    if (!match || !match[1]) {
      res.status(401).json({
        error: 'Unauthorized: Missing or invalid Admin Bearer session token.',
      });
      return;
    }

    const actor = verifyAdminSessionToken(match[1].trim());
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
