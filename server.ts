import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { WebSocketServer, WebSocket } from 'ws';
import {
  ConflictError,
  getStoragePersistenceMeta,
  TenantStore,
} from './server/store.ts';
import {
  createUserAuthMiddleware,
  createUserSessionToken,
  extractBearerToken,
  isDeveloperRole,
  isSessionSecretConfigured,
  requireAdminAuth,
  requireDeveloperAuth,
  requireModule,
  requireRole,
  resolveLiveSessionFromToken,
  type AdminAuthenticatedRequest,
  type AuthenticatedRequest,
} from './server/middleware/adminAuth.ts';
import { SmsNotConfiguredError } from './server/lib/sms.ts';
import { PlatformAdminService } from './server/services/adminService.ts';
import { PlatformDeveloperService } from './server/services/developerService.ts';
import type { WsServerEvent } from './src/shared/types.ts';

function resolveServerPort(): number {
  const portFlagIdx = process.argv.indexOf('--port');
  if (portFlagIdx !== -1 && process.argv[portFlagIdx + 1]) {
    const parsed = Number(process.argv[portFlagIdx + 1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const eqArg = process.argv.find((arg) => arg.startsWith('--port='));
  if (eqArg) {
    const parsed = Number(eqArg.split('=')[1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return Number(process.env.PORT || 3000);
}

const PORT = resolveServerPort();
const IS_PROD = process.env.NODE_ENV === 'production';
const IS_TEST = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
// On Vercel the app runs as a serverless function: no listen(), no WebSockets,
// and static files are served by Vercel itself.
const IS_VERCEL = Boolean(process.env.VERCEL);

interface TenantWebSocket extends WebSocket {
  tenantId?: string;
  authenticated?: boolean;
  isDeveloper?: boolean;
  isAlive?: boolean;
}

const app = express();
app.set('trust proxy', 1);

app.use(
  helmet({
    // A real CSP in production. Vite's dev server needs inline/eval for HMR, so it stays off in dev/test.
    contentSecurityPolicy: IS_PROD
      ? {
          useDefaults: false,
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            // Tailwind/Motion inject inline styles at runtime.
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
            imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
            connectSrc: ["'self'", 'ws:', 'wss:'],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'none'"],
          },
        }
      : false,
    crossOriginEmbedderPolicy: false,
  })
);

const configuredOrigins = (process.env.APP_URL || '')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      const normalized = origin.replace(/\/+$/, '');
      if (configuredOrigins.includes(normalized)) {
        callback(null, true);
        return;
      }
      if (!IS_PROD && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(normalized)) {
        callback(null, true);
        return;
      }
      callback(new ConflictError(`CORS origin "${origin}" is not allowed.`, 403));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id'],
  })
);

const standardJsonParser = express.json({ limit: '1mb' });
const largeJsonParser = express.json({ limit: '12mb' });
const LARGE_PAYLOAD_ROUTE_RE =
  /^\/api\/(finance\/expenses(\/[^/]+\/attachments)?|finance\/reconciliation\/import|exams\/scores\/batch|fees\/payments\/batch|students\/import|dev\/database\/restore|admin\/tenants(\/[^/]+\/(branding|metadata))?|tenants(\/[^/]+\/branding)?)$/i;

app.use((req, res, next) => {
  if (LARGE_PAYLOAD_ROUTE_RE.test(req.path)) {
    largeJsonParser(req, res, next);
  } else {
    standardJsonParser(req, res, next);
  }
});

const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

const store = new TenantStore();
const adminService = new PlatformAdminService(store);
const developerService = new PlatformDeveloperService(store);

function broadcastToTenant(tenantId: string, eventType: WsServerEvent['type'], payload: unknown) {
  const envelope: WsServerEvent = { type: eventType, tenantId, payload };
  const serialized = JSON.stringify(envelope);
  wss.clients.forEach((client) => {
    const wsClient = client as TenantWebSocket;
    if (
      wsClient.readyState === WebSocket.OPEN &&
      wsClient.authenticated &&
      wsClient.tenantId === tenantId
    ) {
      wsClient.send(serialized);
    }
  });
}

store.setBroadcaster((tenantId, eventType, payload) => {
  broadcastToTenant(tenantId, eventType as WsServerEvent['type'], payload);
});

function authenticateWsSocket(token: string, ws: TenantWebSocket): boolean {
  const clean = (token || '').trim();
  if (!clean) return false;
  const resolved = resolveLiveSessionFromToken(
    clean,
    (userId) => store.getUserById(userId),
    (tid) => store.getTenantStatus(tid)
  );
  if (!resolved.ok) return false;
  if (resolved.liveUser.mustChangePassword && !resolved.claims.impersonatedBy) {
    return false;
  }
  const devUser = isDeveloperRole(resolved.liveUser.role) && !resolved.claims.impersonatedBy;
  ws.authenticated = true;
  ws.isDeveloper = devUser;
  ws.tenantId = devUser
    ? store.listTenants()[0]?.id || 'tenant-oakridge'
    : resolved.liveUser.tenantId;
  return true;
}

wss.on('connection', async (ws: TenantWebSocket, req) => {
  ws.isAlive = true;
  ws.authenticated = false;
  await store.ensureHydrated();

  // Tokens are never accepted in the URL (they leak into logs and browser history).
  // The client must send { type: 'auth', token } as its first frame within 5 seconds.
  const authTimer: ReturnType<typeof setTimeout> = setTimeout(() => {
    if (!ws.authenticated && ws.readyState === WebSocket.OPEN) {
      ws.close(4401, 'Authentication timeout');
    }
  }, 5000);

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('close', () => {
    clearTimeout(authTimer);
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as {
        type?: string;
        token?: string;
        tenantId?: string;
      };

      if (!ws.authenticated) {
        if (msg.type === 'auth' && typeof msg.token === 'string') {
          clearTimeout(authTimer);
          if (!authenticateWsSocket(msg.token, ws)) {
            ws.close(4401, 'Unauthorized');
            return;
          }
          if (ws.isDeveloper && typeof msg.tenantId === 'string' && msg.tenantId.trim()) {
            ws.tenantId = msg.tenantId.trim();
          }
          ws.send(
            JSON.stringify({
              type: 'connected',
              tenantId: ws.tenantId,
              payload: { timestamp: new Date().toISOString() },
            })
          );
        } else {
          ws.close(4401, 'Authentication required');
        }
        return;
      }

      if (msg.type === 'subscribe' && typeof msg.tenantId === 'string') {
        if (ws.isDeveloper && msg.tenantId.trim()) {
          ws.tenantId = msg.tenantId.trim();
        }
        ws.send(JSON.stringify({ type: 'subscribed', tenantId: ws.tenantId }));
      }
    } catch {
      // Ignore malformed client frames
    }
  });
});

if (!IS_VERCEL && !IS_TEST) {
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((client) => {
      const wsClient = client as TenantWebSocket;
      if (wsClient.isAlive === false) {
        wsClient.terminate();
        return;
      }
      wsClient.isAlive = false;
      wsClient.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(heartbeatInterval));
}

function getTenantId(req: AuthenticatedRequest): string {
  const headerTenant = req.header('x-tenant-id')?.trim();
  const queryTenant = typeof req.query.tenantId === 'string' ? req.query.tenantId.trim() : undefined;
  const requested = headerTenant || queryTenant;

  const authUser = req.authUser;
  if (!authUser) {
    throw new ConflictError('Authentication required.', 401);
  }

  if (isDeveloperRole(authUser.role) && !req.impersonation) {
    if (requested) return requested;
    const first = store.listTenants()[0];
    return first ? first.id : 'tenant-oakridge';
  }

  if (requested && requested !== authUser.tenantId) {
    throw new ConflictError(
      'Forbidden: Your school account cannot access another school tenant workspace.',
      403
    );
  }
  return authUser.tenantId;
}

function assertTenantParamAccess(req: AuthenticatedRequest, targetTenantId: string): string {
  const authUser = req.authUser;
  if (!authUser) {
    throw new ConflictError('Authentication required.', 401);
  }
  if (!(isDeveloperRole(authUser.role) && !req.impersonation) && authUser.tenantId !== targetTenantId) {
    throw new ConflictError(
      'Forbidden: Cross-tenant modification is not permitted for your account.',
      403
    );
  }
  return targetTenantId;
}

const requireAuth = createUserAuthMiddleware(
  (userId) => store.getUserById(userId),
  (tenantId) => store.getTenantStatus(tenantId)
);

// Ensure remote KV store (when configured) is hydrated before serving API requests
app.use('/api', async (_req, _res, next) => {
  try {
    await store.ensureHydrated();
    next();
  } catch (err) {
    next(err);
  }
});

// Rate Limiters
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  // Tests log in many times from one IP; production limits are unchanged.
  skip: () => IS_TEST,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login requests from this IP. Try again in 15 minutes.' },
});

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  // The suite registers many accounts from one IP; production limits are unchanged.
  skip: () => IS_TEST,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration attempts from this IP. Try again later.' },
});

const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset requests from this IP. Try again later.' },
});

const directoryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again later.' },
});

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Webhook rate limit exceeded.' },
});

// Public Health & Auth Directory / Onboarding Routes
app.get('/api/health', (_req, res) => {
  const persistenceMeta = getStoragePersistenceMeta();
  res.json({
    status: 'ok',
    tenants: store.listTenants().length,
    sessionSecretConfigured: isSessionSecretConfigured(),
    // On Vercel the JSON database lives in per-instance /tmp unless DATA_DIR or KV REST is configured.
    persistentStorage: persistenceMeta.persistentStorage,
    kvConfigured: persistenceMeta.kvConfigured,
    storageMode: persistenceMeta.storageMode,
  });
});

app.get('/api/auth/schools', directoryLimiter, (_req, res) => {
  // Suspended workspaces are not advertised publicly.
  res.json({ schools: store.getPublicSchoolDirectory().filter((t) => t.status !== 'Suspended') });
});

app.post('/api/auth/login', loginLimiter, async (req, res, next) => {
  try {
    const { user, tenant, emailDomain } = await store.authenticateUser(req.body || {});
    const session = createUserSessionToken(user, {
      tenantName: tenant ? tenant.name : 'elimuNest Platform Control',
      emailDomain,
    });
    res.json(session);
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/register', registerLimiter, async (req, res, next) => {
  try {
    const { user, tenant } = await store.registerUserAccount(req.body || {});
    await store.flushRemotePersist();
    const session = createUserSessionToken(user, {
      tenantName: tenant.name,
      emailDomain: tenant.emailDomain,
    });
    res.status(201).json(session);
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/register-tenant', registerLimiter, async (req, res, next) => {
  try {
    const { user, tenant } = await store.registerTenantWithAdmin(req.body || {});
    await store.flushRemotePersist();
    const session = createUserSessionToken(user, {
      tenantName: tenant.name,
      emailDomain: tenant.emailDomain,
    });
    res.status(201).json(session);
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/forgot-password/request', passwordResetLimiter, async (req, res, next) => {
  try {
    const result = await store.requestPasswordResetByPhone(req.body || {}, req.ip || 'unknown');
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/forgot-password/verify', passwordResetLimiter, async (req, res, next) => {
  try {
    const result = await store.verifyPasswordResetByPhone(req.body || {});
    await store.flushRemotePersist();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/logout', (req, res) => {
  // Best effort: a valid token is revoked server-side (bumps tokenVersion, which also signs the
  // account out on other devices). Support/impersonation tokens never revoke the target's sessions.
  const token = extractBearerToken(req);
  if (token) {
    const resolved = resolveLiveSessionFromToken(
      token,
      (userId) => store.getUserById(userId),
      (tid) => store.getTenantStatus(tid)
    );
    if (resolved.ok && !resolved.claims.impersonatedBy) {
      store.revokeUserSessions(resolved.liveUser.id);
    }
  }
  res.json({ ok: true });
});

// Authenticated Per-Tenant Safaricom Daraja C2B Paybill Webhook (secret path param)
const mpesaAllowedIps = (process.env.MPESA_ALLOWED_IPS || '')
  .split(',')
  .map((ip) => ip.trim())
  .filter(Boolean);

app.post('/api/mpesa/c2b-callback/:tenantSecret', webhookLimiter, (req, res, next) => {
  try {
    // Optional defence in depth: set MPESA_ALLOWED_IPS (comma-separated Safaricom Daraja source IPs).
    if (mpesaAllowedIps.length > 0) {
      const callerIp = (req.ip || '').replace(/^::ffff:/, '');
      if (!mpesaAllowedIps.includes(callerIp)) {
        res.status(403).json({ error: 'Webhook source not allowed.' });
        return;
      }
    }
    const matchedTenant = store.verifyMpesaWebhookSecret(String(req.params.tenantSecret || ''));
    if (!matchedTenant) {
      res.status(401).json({ error: 'Unauthorized M-Pesa webhook secret.' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const paybillNumber = String(
      body.BusinessShortCode ?? body.ShortCode ?? body.paybillNumber ?? ''
    );
    const accountReference = String(
      body.BillRefNumber ?? body.accountReference ?? body.AccountReference ?? ''
    );
    const amount = Number(body.TransAmount ?? body.amount ?? 0);
    const msisdn = String(body.MSISDN ?? body.msisdn ?? body.PhoneNumber ?? '');
    const mpesaReceipt = body.TransID
      ? String(body.TransID)
      : body.mpesaReceipt
      ? String(body.mpesaReceipt)
      : '';

    store.processMpesaPaybillPayment({
      tenantId: matchedTenant.id,
      paybillNumber: paybillNumber || undefined,
      accountReference,
      amount,
      msisdn,
      mpesaReceipt,
      channel: 'Daraja C2B Webhook',
      recordedBy: `M-Pesa Paybill ${matchedTenant.mpesaConfig?.paybillNumber || paybillNumber}`,
    });

    res.status(200).json({
      ResultCode: 0,
      ResultDesc: 'Accepted',
    });
  } catch (err) {
    next(err);
  }
});

// Require authenticated user session for all protected API endpoints below
app.use('/api', requireAuth);

app.get('/api/auth/session', (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const tenant =
    user.tenantId !== 'platform'
      ? store.listTenants().find((t) => t.id === user.tenantId)
      : undefined;
  res.json({
    user,
    tenantName: tenant ? tenant.name : 'elimuNest Platform Control',
    emailDomain: tenant?.emailDomain,
    ...(req.impersonation ? { impersonator: req.impersonation } : {}),
  });
});

app.post('/api/auth/change-password', async (req: AuthenticatedRequest, res, next) => {
  try {
    if (req.impersonation) {
      throw new ConflictError(
        'Cannot rotate user credentials while impersonating another account.',
        403
      );
    }
    const { currentPassword, newPassword } = (req.body || {}) as {
      currentPassword?: string;
      newPassword?: string;
    };
    const { user, tenant, emailDomain } = await store.changeUserPassword(
      req.authUser!.id,
      currentPassword || '',
      newPassword || ''
    );
    await store.flushRemotePersist();
    const session = createUserSessionToken(user, {
      tenantName: tenant ? tenant.name : 'elimuNest Platform Control',
      emailDomain,
    });
    res.json(session);
  } catch (err) {
    next(err);
  }
});

app.get('/api/auth/users', (req: AuthenticatedRequest, res, next) => {
  try {
    const authUser = req.authUser!;
    if (
      !isDeveloperRole(authUser.role) &&
      authUser.role !== 'Super Admin' &&
      authUser.role !== 'Admin'
    ) {
      throw new ConflictError('Forbidden: Only School Admins can view the staff user directory.', 403);
    }
    const targetTenantId = getTenantId(req);
    const users = store.listUsersForTenant(targetTenantId);
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/users', async (req: AuthenticatedRequest, res, next) => {
  try {
    const authUser = req.authUser!;
    if (
      !isDeveloperRole(authUser.role) &&
      authUser.role !== 'Super Admin' &&
      authUser.role !== 'Admin'
    ) {
      throw new ConflictError('Forbidden: Only School Admins can provision staff accounts.', 403);
    }
    const targetTenantId = getTenantId(req);
    const result = await store.createTenantStaffUser(authUser, targetTenantId, req.body || {});
    await store.flushRemotePersist();
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

app.patch('/api/auth/users/:userId/access', async (req: AuthenticatedRequest, res, next) => {
  try {
    const authUser = req.authUser!;
    if (
      !isDeveloperRole(authUser.role) &&
      authUser.role !== 'Super Admin' &&
      authUser.role !== 'Admin'
    ) {
      throw new ConflictError('Forbidden: Only School Admins can assign staff access rights.', 403);
    }
    const targetTenantId = getTenantId(req);
    const result = await store.updateTenantUserAccess(
      authUser,
      targetTenantId,
      String(req.params.userId),
      req.body || {}
    );
    await store.flushRemotePersist();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Isolated Developer Control Plane Routes (/api/dev/*) with Role & Permission Middleware Protection
app.get(
  '/api/dev/telemetry',
  requireDeveloperAuth('dev:telemetry'),
  (req: AuthenticatedRequest, res, next) => {
    try {
      const telemetry = developerService.getGlobalTelemetry(req.authUser!, wss.clients.size);
      res.json({ telemetry });
    } catch (err) {
      next(err);
    }
  }
);

app.get(
  '/api/dev/tenants',
  requireDeveloperAuth('dev:tenants'),
  (req: AuthenticatedRequest, res, next) => {
    try {
      const telemetry = developerService.getGlobalTelemetry(req.authUser!, wss.clients.size);
      res.json({ tenants: telemetry.tenantRows });
    } catch (err) {
      next(err);
    }
  }
);

app.post(
  '/api/dev/tenants',
  requireDeveloperAuth('dev:tenants'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const result = await developerService.onboardTenant(req.authUser!, req.body || {});
      await store.flushRemotePersist();
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

app.patch(
  '/api/dev/tenants/:id/subscription',
  requireDeveloperAuth('dev:subscriptions'),
  (req: AuthenticatedRequest, res, next) => {
    try {
      const result = developerService.updateSubscriptionLifecycle(
        req.authUser!,
        String(req.params.id),
        req.body || {}
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

app.patch(
  '/api/dev/tenants/:id/kill-switch',
  requireDeveloperAuth('dev:subscriptions'),
  (req: AuthenticatedRequest, res, next) => {
    try {
      const result = developerService.toggleKillSwitch(
        req.authUser!,
        String(req.params.id),
        req.body || {}
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

app.get(
  '/api/dev/impersonation/targets',
  requireDeveloperAuth('dev:impersonate'),
  (req: AuthenticatedRequest, res, next) => {
    try {
      const targets = developerService.listImpersonationTargets(req.authUser!);
      res.json({ targets });
    } catch (err) {
      next(err);
    }
  }
);

app.post(
  '/api/dev/impersonate',
  requireDeveloperAuth('dev:impersonate'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const result = await developerService.startImpersonation(req.authUser!, req.body || {});
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

app.post(
  '/api/dev/impersonate/end',
  requireDeveloperAuth('dev:impersonate'),
  (req: AuthenticatedRequest, res, next) => {
    try {
      const result = developerService.stopImpersonation(req.authUser!, req.body || {});
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

app.get(
  '/api/dev/audit-logs',
  requireDeveloperAuth('dev:telemetry'),
  (req: AuthenticatedRequest, res, next) => {
    try {
      const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 80;
      const logs = developerService.listAuditLogs(
        req.authUser!,
        Number.isFinite(limit) ? limit : 80
      );
      res.json({ logs });
    } catch (err) {
      next(err);
    }
  }
);

app.get(
  '/api/dev/database/export',
  requireDeveloperAuth('dev:telemetry'),
  (req: AuthenticatedRequest, res, next) => {
    try {
      const snapshot = developerService.exportDatabaseSnapshot(req.authUser!);
      res.json(snapshot);
    } catch (err) {
      next(err);
    }
  }
);

app.post(
  '/api/dev/database/restore',
  requireDeveloperAuth('dev:telemetry'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const result = developerService.restoreDatabaseSnapshot(req.authUser!, req.body);
      await store.flushRemotePersist();
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

app.get(
  '/api/dev/statutory-rates',
  requireDeveloperAuth('dev:telemetry'),
  (req: AuthenticatedRequest, res, next) => {
    try {
      const schedules = developerService.listStatutoryRateSchedules(req.authUser!);
      res.json({ schedules });
    } catch (err) {
      next(err);
    }
  }
);

app.post(
  '/api/dev/statutory-rates',
  requireDeveloperAuth('dev:telemetry'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const result = developerService.upsertStatutoryRateSchedule(req.authUser!, req.body || {});
      await store.flushRemotePersist();
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

// Admin Auth & Service Layer Endpoints (live-user checked via unified session token)
const adminGuard = requireAdminAuth(
  ['Developer', 'Super Admin', 'Admin'],
  (userId) => store.getUserById(userId),
  (tenantId) => store.getTenantStatus(tenantId)
);

app.get('/api/admin/tenants', adminGuard, (req: AdminAuthenticatedRequest, res, next) => {
  try {
    const summaries = adminService.listTenantSummaries(req.adminActor!);
    res.json({ summaries });
  } catch (err) {
    next(err);
  }
});

app.get('/api/admin/tenants/:id/metadata', adminGuard, (req: AdminAuthenticatedRequest, res, next) => {
  try {
    const tenant = adminService.getTenantMetadata(req.adminActor!, String(req.params.id));
    res.json({ tenant });
  } catch (err) {
    next(err);
  }
});

app.post('/api/admin/tenants', adminGuard, async (req: AdminAuthenticatedRequest, res, next) => {
  try {
    const result = await adminService.provisionTenant(req.adminActor!, req.body);
    await store.flushRemotePersist();
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

app.patch('/api/admin/tenants/:id/metadata', adminGuard, (req: AdminAuthenticatedRequest, res, next) => {
  try {
    const result = adminService.updateTenantMetadata(req.adminActor!, String(req.params.id), req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.patch('/api/admin/tenants/:id/branding', adminGuard, (req: AdminAuthenticatedRequest, res, next) => {
  try {
    const result = adminService.updateTenantBranding(req.adminActor!, String(req.params.id), req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/admin/tenants/:id', adminGuard, (req: AdminAuthenticatedRequest, res, next) => {
  try {
    const result = adminService.deprovisionTenant(req.adminActor!, String(req.params.id));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.get('/api/admin/audit-logs', adminGuard, (req: AdminAuthenticatedRequest, res, next) => {
  try {
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 50;
    const logs = adminService.listAuditLogs(
      req.adminActor!,
      Number.isFinite(limit) ? limit : 50
    );
    res.json({ logs });
  } catch (err) {
    next(err);
  }
});

// Compatibility aliases gated by the exact same Admin Auth & Service Layer
app.get('/api/super-admin/tenants', adminGuard, (req: AdminAuthenticatedRequest, res, next) => {
  try {
    const summaries = adminService.listTenantSummaries(req.adminActor!);
    res.json({ summaries });
  } catch (err) {
    next(err);
  }
});

app.get('/api/tenants', adminGuard, (req: AdminAuthenticatedRequest, res, next) => {
  try {
    const tenants = adminService.listTenants(req.adminActor!);
    res.json({ tenants });
  } catch (err) {
    next(err);
  }
});

app.post('/api/tenants', adminGuard, async (req: AdminAuthenticatedRequest, res, next) => {
  try {
    const result = await adminService.provisionTenant(req.adminActor!, req.body);
    await store.flushRemotePersist();
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

app.patch('/api/tenants/:id', adminGuard, (req: AdminAuthenticatedRequest, res, next) => {
  try {
    const result = adminService.updateTenantMetadata(req.adminActor!, String(req.params.id), req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.patch('/api/tenants/:id/branding', adminGuard, (req: AdminAuthenticatedRequest, res, next) => {
  try {
    const result = adminService.updateTenantBranding(req.adminActor!, String(req.params.id), req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/tenants/:id', adminGuard, (req: AdminAuthenticatedRequest, res, next) => {
  try {
    const result = adminService.deprovisionTenant(req.adminActor!, String(req.params.id));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

const settingsGuard = [
  requireRole('Developer', 'Super Admin', 'Admin'),
  requireModule('settings'),
];

app.put('/api/tenants/:id/streams', ...settingsGuard, (req: AuthenticatedRequest, res, next) => {
  try {
    assertTenantParamAccess(req, String(req.params.id));
    const tenant = store.updateStreams(String(req.params.id), req.body);
    res.json({ tenant });
  } catch (err) {
    next(err);
  }
});

app.put('/api/tenants/:id/subjects', ...settingsGuard, (req: AuthenticatedRequest, res, next) => {
  try {
    assertTenantParamAccess(req, String(req.params.id));
    const tenant = store.updateSubjects(String(req.params.id), req.body);
    res.json({ tenant });
  } catch (err) {
    next(err);
  }
});

// Academic calendar: terms can be closed (locks attendance, exam marks, new invoices) and reopened with a reason
app.post('/api/tenants/:id/terms', ...settingsGuard, (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = assertTenantParamAccess(req, String(req.params.id));
    res.status(201).json({ term: store.createTerm(tenantId, req.body || {}, req.authUser) });
  } catch (err) {
    next(err);
  }
});

app.post('/api/tenants/:id/terms/:termId/close', ...settingsGuard, (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = assertTenantParamAccess(req, String(req.params.id));
    res.json(store.closeTerm(tenantId, String(req.params.termId), req.authUser));
  } catch (err) {
    next(err);
  }
});

app.post('/api/tenants/:id/terms/:termId/reopen', ...settingsGuard, (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = assertTenantParamAccess(req, String(req.params.id));
    const term = store.reopenTerm(tenantId, String(req.params.termId), req.body?.reason, req.authUser);
    res.json({ term });
  } catch (err) {
    next(err);
  }
});

app.post('/api/tenants/:id/teachers', ...settingsGuard, (req: AuthenticatedRequest, res, next) => {
  try {
    assertTenantParamAccess(req, String(req.params.id));
    const result = store.addTeacher(String(req.params.id), req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

app.put(
  '/api/tenants/:id/teachers/:teacherId',
  ...settingsGuard,
  (req: AuthenticatedRequest, res, next) => {
    try {
      assertTenantParamAccess(req, String(req.params.id));
      const result = store.updateTeacher(
        String(req.params.id),
        String(req.params.teacherId),
        req.body
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

app.delete(
  '/api/tenants/:id/teachers/:teacherId',
  ...settingsGuard,
  (req: AuthenticatedRequest, res, next) => {
    try {
      assertTenantParamAccess(req, String(req.params.id));
      const result = store.deleteTeacher(String(req.params.id), String(req.params.teacherId));
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

app.post(
  '/api/tenants/:id/non-teaching-staff',
  ...settingsGuard,
  (req: AuthenticatedRequest, res, next) => {
    try {
      assertTenantParamAccess(req, String(req.params.id));
      const result = store.addNonTeachingStaff(String(req.params.id), req.body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

app.get('/api/workspace', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const workspace = store.getWorkspace(tenantId, req.authUser);
    if (!(isDeveloperRole(req.authUser?.role) && !req.impersonation)) {
      workspace.tenants = [workspace.tenant];
    }
    res.json(workspace);
  } catch (err) {
    next(err);
  }
});

// Parent: claim another child (admission number + guardian phone on file must both match)
const parentLinkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many link attempts. Try again later.' },
});

app.post('/api/parent/link-child', parentLinkLimiter, (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const student = store.linkParentToStudent(tenantId, req.authUser!, req.body || {});
    res.json({ studentId: student.id, fullName: student.fullName });
  } catch (err) {
    next(err);
  }
});

// Admissions & Direct Enrollment
const admissionsGuard = [
  requireRole('Developer', 'Super Admin', 'Admin', 'Registrar'),
  requireModule('admissions'),
];

app.post('/api/students/enroll', ...admissionsGuard, (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = store.enrollStudent(tenantId, req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

app.patch('/api/students/:id', ...admissionsGuard, (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const student = store.updateStudent(tenantId, String(req.params.id), req.body || {}, req.authUser);
    res.json({ student });
  } catch (err) {
    next(err);
  }
});

app.post('/api/students/:id/status', ...admissionsGuard, (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = store.changeStudentStatus(tenantId, String(req.params.id), req.body || {}, req.authUser);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post('/api/students/promote', ...admissionsGuard, (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    res.json(store.promoteStudents(tenantId, req.body || {}, req.authUser));
  } catch (err) {
    next(err);
  }
});

app.post('/api/students/import', ...admissionsGuard, (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    res.json(store.importStudents(tenantId, req.body || {}, req.authUser));
  } catch (err) {
    next(err);
  }
});

app.patch('/api/students/:id/parent', ...admissionsGuard, (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const raw = req.body?.parentUserId;
    const parentUserId = raw === null || raw === undefined || raw === '' ? null : String(raw);
    const student = store.setStudentParent(tenantId, String(req.params.id), parentUserId);
    res.json({ student });
  } catch (err) {
    next(err);
  }
});

app.post('/api/admissions', ...admissionsGuard, (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const application = store.createAdmission(tenantId, req.body);
    res.status(201).json({ application });
  } catch (err) {
    next(err);
  }
});

app.patch('/api/admissions/:id', ...admissionsGuard, (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = store.updateAdmission(tenantId, String(req.params.id), req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Timetable
const timetableGuard = [
  requireRole('Developer', 'Super Admin', 'Admin', 'Teacher'),
  requireModule('timetable'),
];

app.post('/api/timetable', ...timetableGuard, (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const slot = store.upsertTimetableSlot(tenantId, req.body);
    res.status(201).json({ slot });
  } catch (err) {
    next(err);
  }
});

app.put('/api/timetable/:id', ...timetableGuard, (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const slot = store.upsertTimetableSlot(tenantId, {
      ...req.body,
      id: String(req.params.id),
    });
    res.json({ slot });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/timetable/:id', ...timetableGuard, (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    store.deleteTimetableSlot(tenantId, String(req.params.id));
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

app.post('/api/timetable/generate', ...timetableGuard, (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = store.generateTimetable(tenantId, req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// aSc-style timetabling: lesson cards, teacher availability, locking and the solver.
// Mutations are limited to admins; teachers may only read lesson cards.
const timetableAdminGuard = [
  requireRole('Developer', 'Super Admin', 'Admin'),
  requireModule('timetable'),
];

app.get('/api/timetable/lessons', ...timetableGuard, (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    res.json({ lessons: store.getTimetableLessons(tenantId) });
  } catch (err) {
    next(err);
  }
});

app.post('/api/timetable/lessons/build', ...timetableAdminGuard, (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    res.json(store.buildTimetableLessonsFromCurriculum(tenantId, req.body || {}));
  } catch (err) {
    next(err);
  }
});

app.post('/api/timetable/lessons', ...timetableAdminGuard, (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const lesson = store.upsertTimetableLesson(tenantId, req.body);
    res.status(201).json({ lesson });
  } catch (err) {
    next(err);
  }
});

app.put('/api/timetable/lessons/:id', ...timetableAdminGuard, (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const lesson = store.upsertTimetableLesson(tenantId, { ...req.body, id: String(req.params.id) });
    res.json({ lesson });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/timetable/lessons/:id', ...timetableAdminGuard, (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    store.deleteTimetableLesson(tenantId, String(req.params.id));
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

app.put('/api/timetable/availability/:teacherId', ...timetableAdminGuard, (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const teacher = store.setTeacherAvailability(tenantId, String(req.params.teacherId), req.body || {});
    res.json({ teacher });
  } catch (err) {
    next(err);
  }
});

app.post('/api/timetable/lock', ...timetableAdminGuard, (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    res.json(store.setTimetableSlotsLocked(tenantId, req.body || {}));
  } catch (err) {
    next(err);
  }
});

app.post('/api/timetable/solve', ...timetableAdminGuard, (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    res.json(store.solveTimetableFromLessons(tenantId, req.body || {}));
  } catch (err) {
    next(err);
  }
});

app.put('/api/timetable/day-schedule', ...timetableAdminGuard, (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    res.json(store.setTimetableDaySchedule(tenantId, req.body || {}));
  } catch (err) {
    next(err);
  }
});

app.put('/api/timetable/subject-constraints', ...timetableAdminGuard, (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    res.json(store.setSubjectTimetableConfig(tenantId, req.body || {}));
  } catch (err) {
    next(err);
  }
});

// Attendance & Leave Out Chits
const attendanceGuard = [
  requireRole('Developer', 'Super Admin', 'Admin', 'Registrar', 'Teacher'),
  requireModule('attendance'),
];

app.post('/api/attendance/batch', ...attendanceGuard, (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const body = { ...(req.body || {}) };
    if (req.authUser?.role === 'Teacher') {
      // Do not trust actorRole / teacherId from the client: bind them to the logged-in teacher.
      const profile = store.findTeacherProfileForUser(tenantId, req.authUser);
      body.actorRole = 'Teacher';
      body.teacherId = profile?.id;
      body.recordedBy = req.authUser.fullName;
    }
    const records = store.saveAttendanceBatch(tenantId, body);
    res.json({ records });
  } catch (err) {
    next(err);
  }
});

app.post(
  '/api/attendance/staff/batch',
  ...attendanceGuard,
  (req: AuthenticatedRequest, res, next) => {
    try {
      const tenantId = getTenantId(req);
      const records = store.saveStaffAttendanceBatch(tenantId, req.body);
      res.json({ records });
    } catch (err) {
      next(err);
    }
  }
);

app.post(
  '/api/attendance/leave-chits',
  ...attendanceGuard,
  (req: AuthenticatedRequest, res, next) => {
    try {
      const tenantId = getTenantId(req);
      const chit = store.createLeaveOutChit(tenantId, req.body);
      res.status(201).json({ chit });
    } catch (err) {
      next(err);
    }
  }
);

app.delete(
  '/api/attendance/leave-chits/:id',
  ...attendanceGuard,
  (req: AuthenticatedRequest, res, next) => {
    try {
      const tenantId = getTenantId(req);
      store.deleteLeaveOutChit(tenantId, String(req.params.id));
      res.json({ deleted: true });
    } catch (err) {
      next(err);
    }
  }
);

// Exams & Assessment
const examsWriteGuard = [
  requireRole('Developer', 'Super Admin', 'Admin', 'Teacher'),
  requireModule('exams'),
];
const examsPublishGuard = [
  requireRole('Developer', 'Super Admin', 'Admin'),
  requireModule('exams'),
];

app.post('/api/exams/cycles', ...examsWriteGuard, (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const cycle = store.createExamCycle(tenantId, req.body);
    res.status(201).json({ cycle });
  } catch (err) {
    next(err);
  }
});

app.post('/api/exams/scores', ...examsWriteGuard, (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = store.upsertExamScore(tenantId, req.body, req.authUser!);
    res.json({ result });
  } catch (err) {
    next(err);
  }
});

app.post('/api/exams/scores/batch', ...examsWriteGuard, (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = store.saveExamScoresBatch(tenantId, req.body, req.authUser!);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post(
  '/api/exams/cycles/:id/publish',
  ...examsPublishGuard,
  (req: AuthenticatedRequest, res, next) => {
    try {
      const tenantId = getTenantId(req);
      const cycle = store.publishExamCycle(tenantId, String(req.params.id));
      res.json({ cycle });
    } catch (err) {
      next(err);
    }
  }
);

app.post(
  '/api/exams/cycles/:id/unlock',
  ...examsPublishGuard,
  (req: AuthenticatedRequest, res, next) => {
    try {
      const tenantId = getTenantId(req);
      const cycle = store.unlockExamCycle(
        tenantId,
        String(req.params.id),
        req.body?.reason,
        req.authUser!
      );
      res.json({ cycle });
    } catch (err) {
      next(err);
    }
  }
);

// Fees, Billing & Finance Controls (Admin & Bursar only)
const financeGuard = [
  requireRole('Developer', 'Super Admin', 'Admin', 'Bursar'),
  requireModule('fees'),
];
app.use('/api/fees', ...financeGuard);
app.use('/api/finance', ...financeGuard);

app.post('/api/fees/structures', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const feeStructure = store.upsertFeeStructure(tenantId, req.body);
    res.json({ feeStructure });
  } catch (err) {
    next(err);
  }
});

app.post('/api/fees/invoices', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const invoice = store.createInvoice(tenantId, req.body, req.authUser!, req.ip);
    res.status(201).json({ invoice });
  } catch (err) {
    next(err);
  }
});

app.post('/api/fees/invoices/:id/payments', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const invoice = store.recordPayment(
      tenantId,
      String(req.params.id),
      req.body,
      req.authUser!,
      req.ip
    );
    res.json({ invoice });
  } catch (err) {
    next(err);
  }
});

app.post(
  '/api/fees/invoices/:id/payments/:paymentId/void',
  (req: AuthenticatedRequest, res, next) => {
    try {
      const tenantId = getTenantId(req);
      const invoice = store.voidPayment(
        tenantId,
        String(req.params.id),
        String(req.params.paymentId),
        req.body?.reason,
        req.authUser!,
        req.ip
      );
      res.json({ invoice });
    } catch (err) {
      next(err);
    }
  }
);

app.post('/api/fees/payments/batch', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = store.recordPaymentsBatch(tenantId, req.body, req.authUser!, req.ip);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post('/api/fees/credit-notes', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = store.createCreditNote(tenantId, req.body || {}, req.authUser!, req.ip);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

app.post('/api/fees/waivers', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = store.createFeeWaiver(tenantId, req.body || {}, req.authUser!, req.ip);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

app.put('/api/fees/sibling-discount', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const tenant = store.updateSiblingDiscountConfig(
      tenantId,
      req.body || {},
      req.authUser!,
      req.ip
    );
    res.json({ tenant });
  } catch (err) {
    next(err);
  }
});

app.post('/api/fees/carry-forward', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = store.carryForwardTermBalances(
      tenantId,
      req.body || {},
      req.authUser!,
      req.ip
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Fees & Billing: Independent Votelines (excluded from Fee Structure & Fee Total, appear alongside fees)
app.post('/api/fees/independent-votelines', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const items = store.createIndependentVotelines(
      tenantId,
      {
        ...(req.body || {}),
        recordedBy: req.body?.recordedBy || `${req.authUser!.fullName} (${req.authUser!.role})`,
      },
      req.authUser!,
      req.ip
    );
    res.status(201).json({ items });
  } catch (err) {
    next(err);
  }
});

app.post('/api/fees/independent-votelines/:id/payments', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const item = store.recordIndependentVotelinePayment(
      tenantId,
      String(req.params.id),
      {
        ...(req.body || {}),
        recordedBy: req.body?.recordedBy || `${req.authUser!.fullName} (${req.authUser!.role})`,
      },
      req.authUser!,
      req.ip
    );
    res.json({ item });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/fees/independent-votelines/:id', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = store.deleteIndependentVoteline(
      tenantId,
      String(req.params.id),
      req.body?.reason,
      req.authUser!,
      req.ip
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Fees & Billing: Per-Tenant M-Pesa Paybill Integration & Unverified Manual Entry
app.put('/api/finance/mpesa/config', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = store.configureTenantMpesa(req.authUser!, tenantId, req.body || {}, req.ip);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post('/api/finance/mpesa/receive', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const body = (req.body || {}) as {
      paybillNumber?: string;
      accountReference?: string;
      amount?: number;
      msisdn?: string;
      mpesaReceipt?: string;
    };
    const result = store.recordManualMpesaEntry(tenantId, req.authUser!, body, req.ip);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// Finance Audit Log (Read-Only for Admin / Super Admin / Developer)
app.get(
  '/api/finance/audit-logs',
  requireRole('Developer', 'Super Admin', 'Admin'),
  (req: AuthenticatedRequest, res, next) => {
    try {
      const tenantId = getTenantId(req);
      const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 150;
      const logs = store.getFinanceAuditLogs(
        tenantId,
        Number.isFinite(limit) ? limit : 150
      );
      res.json({ logs });
    } catch (err) {
      next(err);
    }
  }
);

// Finance & Accounting: Expensing
app.post('/api/finance/expenses', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const expense = store.createExpense(tenantId, req.body, req.authUser!, req.ip);
    res.status(201).json({ expense });
  } catch (err) {
    next(err);
  }
});

app.patch('/api/finance/expenses/:id', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const expense = store.updateExpenseStatus(
      tenantId,
      String(req.params.id),
      req.body?.status,
      req.authUser!,
      req.ip
    );
    res.json({ expense });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/finance/expenses/:id', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = store.deleteExpense(
      tenantId,
      String(req.params.id),
      req.body?.reason,
      req.authUser!,
      req.ip
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post('/api/finance/expenses/:id/reverse', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const expense = store.reverseExpense(
      tenantId,
      String(req.params.id),
      req.body?.reason,
      req.authUser!,
      req.ip
    );
    res.json({ expense });
  } catch (err) {
    next(err);
  }
});

app.post('/api/finance/expenses/:id/attachments', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const expense = store.addExpenseAttachment(tenantId, String(req.params.id), req.body);
    res.status(201).json({ expense });
  } catch (err) {
    next(err);
  }
});

app.delete(
  '/api/finance/expenses/:id/attachments/:attachmentId',
  (req: AuthenticatedRequest, res, next) => {
    try {
      const tenantId = getTenantId(req);
      const expense = store.deleteExpenseAttachment(
        tenantId,
        String(req.params.id),
        String(req.params.attachmentId)
      );
      res.json({ expense });
    } catch (err) {
      next(err);
    }
  }
);

// Finance Controls: eTIMS Receipt Check
app.post('/api/finance/etims/verify', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const record = store.verifyEtimsReceipt(tenantId, req.body, req.authUser!, req.ip);
    res.status(201).json({ record });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/finance/etims/:id', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = store.deleteEtimsCheck(
      tenantId,
      String(req.params.id),
      req.body?.reason,
      req.authUser!,
      req.ip
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Finance Controls: M-Pesa & Bank Statement Reconciliation
app.post('/api/finance/reconciliation/import', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : req.body;
    const result = store.importReconciliationLines(tenantId, lines, req.authUser!, req.ip);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

app.post('/api/finance/reconciliation/auto-match', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = store.autoMatchReconciliation(tenantId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.patch('/api/finance/reconciliation/:id', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const line = store.updateReconciliationLine(
      tenantId,
      String(req.params.id),
      req.body,
      req.authUser!,
      req.ip
    );
    res.json({ line });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/finance/reconciliation/:id', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = store.deleteReconciliationLine(
      tenantId,
      String(req.params.id),
      req.body?.reason,
      req.authUser!,
      req.ip
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Finance Controls: Payroll & Statutory Deductions
app.post('/api/finance/payroll/generate', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const entries = store.generatePayrollRun(tenantId, req.body?.payPeriod, req.authUser!, req.ip);
    res.status(201).json({ entries });
  } catch (err) {
    next(err);
  }
});

app.post('/api/finance/payroll', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const entry = store.upsertPayrollEntry(tenantId, req.body, req.authUser!, req.ip);
    res.status(201).json({ entry });
  } catch (err) {
    next(err);
  }
});

app.patch('/api/finance/payroll/:id/status', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const entry = store.updatePayrollStatus(
      tenantId,
      String(req.params.id),
      req.body?.status,
      req.authUser!,
      req.ip
    );
    res.json({ entry });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/finance/payroll/:id', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = store.deletePayrollEntry(
      tenantId,
      String(req.params.id),
      req.body?.reason,
      req.authUser!,
      req.ip
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post('/api/finance/payroll/:id/reverse', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const entry = store.reversePayrollEntry(
      tenantId,
      String(req.params.id),
      req.body?.reason,
      req.authUser!,
      req.ip
    );
    res.json({ entry });
  } catch (err) {
    next(err);
  }
});

// Finance Controls: Departmental Budget Allocations
app.post('/api/finance/budgets', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const budget = store.upsertBudgetAllocation(tenantId, req.body, req.authUser!, req.ip);
    res.json({ budget });
  } catch (err) {
    next(err);
  }
});

app.patch('/api/finance/budgets/approval', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const budget = store.approveBudgetAllocation(
      tenantId,
      {
        ...(req.body || {}),
        approvedBy: req.body?.approvedBy || req.authUser?.fullName || 'Finance Administrator',
      },
      req.authUser!,
      req.ip
    );
    res.json({ budget });
  } catch (err) {
    next(err);
  }
});

// Finance Controls: Board & Procurement Approvals Sign-Off
app.post('/api/finance/approvals', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const record = store.createApprovalRecord(tenantId, req.body, req.authUser!, req.ip);
    res.status(201).json({ record });
  } catch (err) {
    next(err);
  }
});

app.patch('/api/finance/approvals/:id', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const record = store.updateApprovalDecision(
      tenantId,
      String(req.params.id),
      req.body,
      req.authUser!,
      req.ip
    );
    res.json({ record });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/finance/approvals/:id', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = store.deleteApprovalRecord(
      tenantId,
      String(req.params.id),
      req.body?.reason,
      req.authUser!,
      req.ip
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Communications & Notifications
const communicationsGuard = [
  requireRole('Developer', 'Super Admin', 'Admin', 'Registrar', 'Teacher', 'Bursar'),
  requireModule('communications'),
];
app.use('/api/communications', ...communicationsGuard);

app.post('/api/communications/announcements', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const announcement = store.createAnnouncement(tenantId, req.body);
    res.status(201).json({ announcement });
  } catch (err) {
    next(err);
  }
});

app.post('/api/communications/messages', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const message = store.createMessage(tenantId, req.body);
    res.status(201).json({ message });
  } catch (err) {
    next(err);
  }
});

app.post('/api/communications/whatsapp-log', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const record = store.logWhatsAppDispatch(tenantId, req.body);
    res.status(201).json({ record });
  } catch (err) {
    next(err);
  }
});

app.post('/api/notifications/read', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const notificationId = typeof req.body?.notificationId === 'string' ? req.body.notificationId : undefined;
    store.markNotificationsRead(tenantId, notificationId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Error Handler
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ConflictError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  if (err instanceof SmsNotConfiguredError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : 'Internal server error';
  console.error('API Error:', err);
  res.status(500).json({ error: message });
});

// Vite / Static Frontend Serving
async function attachFrontend() {
  const distPath = path.resolve(process.cwd(), 'dist');
  if (IS_PROD && fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        allowedHosts: true,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`elimuNest SaaS server running on http://0.0.0.0:${PORT}`);
  });
}

if (!IS_VERCEL && !IS_TEST) {
  attachFrontend();
}

export { app, httpServer, wss, store };
// Used by the Vercel serverless function entry.
export default app;
