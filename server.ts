import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import express, { type NextFunction, type Request, type Response } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import {
  ConflictError,
  getStoragePersistenceMeta,
  TenantStore,
} from './server/store.ts';
import {
  createUserAuthMiddleware,
  createUserSessionToken,
  isDeveloperRole,
  isSessionSecretConfigured,
  issueAdminSession,
  requireAdminAuth,
  requireDeveloperAuth,
  type AdminAuthenticatedRequest,
  type AuthenticatedRequest,
} from './server/middleware/adminAuth.ts';
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
// On Vercel the app runs as a serverless function: no listen(), no WebSockets,
// and static files are served by Vercel itself.
const IS_VERCEL = Boolean(process.env.VERCEL);

interface TenantWebSocket extends WebSocket {
  tenantId?: string;
  isAlive?: boolean;
}

const app = express();
app.use(express.json({ limit: '12mb' }));

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
    if (wsClient.readyState === WebSocket.OPEN && wsClient.tenantId === tenantId) {
      wsClient.send(serialized);
    }
  });
}

store.setBroadcaster((tenantId, eventType, payload) => {
  broadcastToTenant(tenantId, eventType as WsServerEvent['type'], payload);
});

wss.on('connection', (ws: TenantWebSocket) => {
  ws.isAlive = true;
  ws.send(JSON.stringify({ type: 'connected', payload: { timestamp: new Date().toISOString() } }));

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as { type?: string; tenantId?: string };
      if (msg.type === 'subscribe' && typeof msg.tenantId === 'string') {
        ws.tenantId = msg.tenantId;
        ws.send(JSON.stringify({ type: 'subscribed', tenantId: msg.tenantId }));
      }
    } catch {
      // Ignore malformed client frames
    }
  });
});

if (!IS_VERCEL) {
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

app.get('/api/auth/schools', (_req, res) => {
  res.json({ schools: store.getPublicSchoolDirectory() });
});

app.post('/api/auth/login', (req, res, next) => {
  try {
    const { user, tenant, emailDomain } = store.authenticateUser(req.body || {});
    const session = createUserSessionToken(user, {
      tenantName: tenant ? tenant.name : 'elimuNest Platform Control',
      emailDomain,
    });
    res.json(session);
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const { user, tenant } = store.registerUserAccount(req.body || {});
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

app.post('/api/auth/register-tenant', async (req, res, next) => {
  try {
    const { user, tenant } = store.registerTenantWithAdmin(req.body || {});
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

app.post('/api/auth/forgot-password/request', (req, res, next) => {
  try {
    const result = store.requestPasswordResetByPhone(req.body || {});
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/forgot-password/verify', async (req, res, next) => {
  try {
    const result = store.verifyPasswordResetByPhone(req.body || {});
    await store.flushRemotePersist();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/logout', (_req, res) => {
  res.json({ ok: true });
});

// Public Safaricom Daraja C2B Paybill Webhook (routes strictly by Paybill / BusinessShortCode)
app.post('/api/mpesa/c2b-callback', (req, res, next) => {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const queryPaybill =
      typeof req.query.paybill === 'string' ? req.query.paybill.trim() : undefined;
    const paybillNumber = String(
      body.BusinessShortCode ??
        body.ShortCode ??
        body.paybillNumber ??
        queryPaybill ??
        ''
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
      : undefined;

    const result = store.processMpesaPaybillPayment({
      paybillNumber,
      accountReference,
      amount,
      msisdn,
      mpesaReceipt,
      channel: 'Daraja C2B Webhook',
      recordedBy: `M-Pesa Paybill ${paybillNumber.trim()}`,
    });

    res.status(200).json({
      ResultCode: 0,
      ResultDesc: 'Accepted',
      tenantId: result.tenantId,
      tenantName: result.tenantName,
      paybillNumber: result.paybillNumber,
      invoice: result.invoice,
      transaction: result.transaction,
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
    const { user, tenant, emailDomain } = store.changeUserPassword(
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
    const result = store.createTenantStaffUser(authUser, targetTenantId, req.body || {});
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
    const result = store.updateTenantUserAccess(
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
      const result = developerService.onboardTenant(req.authUser!, req.body || {});
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
  (req: AuthenticatedRequest, res, next) => {
    try {
      const result = developerService.startImpersonation(req.authUser!, req.body || {});
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

// Admin Auth & Service Layer Endpoints
const adminGuard = requireAdminAuth(['Developer', 'Super Admin', 'Admin']);

app.post('/api/admin/session', issueAdminSession);

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

app.post('/api/admin/tenants', adminGuard, (req: AdminAuthenticatedRequest, res, next) => {
  try {
    const result = adminService.provisionTenant(req.adminActor!, req.body);
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

app.post('/api/tenants', adminGuard, (req: AdminAuthenticatedRequest, res, next) => {
  try {
    const result = adminService.provisionTenant(req.adminActor!, req.body);
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

app.put('/api/tenants/:id/streams', (req: AuthenticatedRequest, res, next) => {
  try {
    assertTenantParamAccess(req, req.params.id);
    const tenant = store.updateStreams(req.params.id, req.body);
    res.json({ tenant });
  } catch (err) {
    next(err);
  }
});

app.put('/api/tenants/:id/subjects', (req: AuthenticatedRequest, res, next) => {
  try {
    assertTenantParamAccess(req, req.params.id);
    const tenant = store.updateSubjects(req.params.id, req.body);
    res.json({ tenant });
  } catch (err) {
    next(err);
  }
});

app.post('/api/tenants/:id/teachers', (req: AuthenticatedRequest, res, next) => {
  try {
    assertTenantParamAccess(req, req.params.id);
    const result = store.addTeacher(req.params.id, req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

app.put('/api/tenants/:id/teachers/:teacherId', (req: AuthenticatedRequest, res, next) => {
  try {
    assertTenantParamAccess(req, req.params.id);
    const result = store.updateTeacher(req.params.id, req.params.teacherId, req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/tenants/:id/teachers/:teacherId', (req: AuthenticatedRequest, res, next) => {
  try {
    assertTenantParamAccess(req, req.params.id);
    const result = store.deleteTeacher(req.params.id, req.params.teacherId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post('/api/tenants/:id/non-teaching-staff', (req: AuthenticatedRequest, res, next) => {
  try {
    assertTenantParamAccess(req, req.params.id);
    const result = store.addNonTeachingStaff(req.params.id, req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

app.get('/api/workspace', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const workspace = store.getWorkspace(tenantId);
    if (!(isDeveloperRole(req.authUser?.role) && !req.impersonation)) {
      workspace.tenants = [workspace.tenant];
    }
    res.json(workspace);
  } catch (err) {
    next(err);
  }
});

// Admissions & Direct Enrollment
app.post('/api/students/enroll', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = store.enrollStudent(tenantId, req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

app.post('/api/admissions', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const application = store.createAdmission(tenantId, req.body);
    res.status(201).json({ application });
  } catch (err) {
    next(err);
  }
});

app.patch('/api/admissions/:id', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = store.updateAdmission(tenantId, req.params.id, req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Timetable
app.post('/api/timetable', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const slot = store.upsertTimetableSlot(tenantId, req.body);
    res.status(201).json({ slot });
  } catch (err) {
    next(err);
  }
});

app.put('/api/timetable/:id', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const slot = store.upsertTimetableSlot(tenantId, { ...req.body, id: req.params.id });
    res.json({ slot });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/timetable/:id', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    store.deleteTimetableSlot(tenantId, req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

app.post('/api/timetable/generate', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = store.generateTimetable(tenantId, req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Attendance & Leave Out Chits
app.post('/api/attendance/batch', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const records = store.saveAttendanceBatch(tenantId, req.body);
    res.json({ records });
  } catch (err) {
    next(err);
  }
});

app.post('/api/attendance/staff/batch', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const records = store.saveStaffAttendanceBatch(tenantId, req.body);
    res.json({ records });
  } catch (err) {
    next(err);
  }
});

app.post('/api/attendance/leave-chits', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const chit = store.createLeaveOutChit(tenantId, req.body);
    res.status(201).json({ chit });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/attendance/leave-chits/:id', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    store.deleteLeaveOutChit(tenantId, req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// Exams & Assessment
app.post('/api/exams/cycles', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const cycle = store.createExamCycle(tenantId, req.body);
    res.status(201).json({ cycle });
  } catch (err) {
    next(err);
  }
});

app.post('/api/exams/scores', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = store.upsertExamScore(tenantId, req.body);
    res.json({ result });
  } catch (err) {
    next(err);
  }
});

app.post('/api/exams/scores/batch', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = store.saveExamScoresBatch(tenantId, req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post('/api/exams/cycles/:id/publish', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const cycle = store.publishExamCycle(tenantId, req.params.id);
    res.json({ cycle });
  } catch (err) {
    next(err);
  }
});

// Fees & Billing
app.post('/api/fees/structures', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const feeStructure = store.upsertFeeStructure(tenantId, req.body);
    res.json({ feeStructure });
  } catch (err) {
    next(err);
  }
});

app.post('/api/fees/invoices', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const invoice = store.createInvoice(tenantId, req.body);
    res.status(201).json({ invoice });
  } catch (err) {
    next(err);
  }
});

app.post('/api/fees/invoices/:id/payments', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const invoice = store.recordPayment(tenantId, req.params.id, req.body);
    res.json({ invoice });
  } catch (err) {
    next(err);
  }
});

app.post('/api/fees/payments/batch', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = store.recordPaymentsBatch(tenantId, req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Fees & Billing: Independent Votelines (excluded from Fee Structure & Fee Total, appear alongside fees)
app.post('/api/fees/independent-votelines', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const items = store.createIndependentVotelines(tenantId, {
      ...(req.body || {}),
      recordedBy: req.body?.recordedBy || `${req.authUser!.fullName} (${req.authUser!.role})`,
    });
    res.status(201).json({ items });
  } catch (err) {
    next(err);
  }
});

app.post('/api/fees/independent-votelines/:id/payments', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const item = store.recordIndependentVotelinePayment(tenantId, req.params.id, {
      ...(req.body || {}),
      recordedBy: req.body?.recordedBy || `${req.authUser!.fullName} (${req.authUser!.role})`,
    });
    res.json({ item });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/fees/independent-votelines/:id', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = store.deleteIndependentVoteline(tenantId, req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Fees & Billing: Per-Tenant M-Pesa Paybill Integration & Paybill-Separated Settlement
app.put('/api/finance/mpesa/config', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = store.configureTenantMpesa(req.authUser!, tenantId, req.body || {});
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
    const result = store.processMpesaPaybillPayment({
      paybillNumber: body.paybillNumber,
      accountReference: body.accountReference,
      amount: body.amount,
      msisdn: body.msisdn,
      mpesaReceipt: body.mpesaReceipt,
      channel: 'STK / Paybill Terminal',
      expectedTenantId: tenantId,
      recordedBy: `${req.authUser!.fullName} (M-Pesa Paybill)`,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// Finance & Accounting: Expensing
app.post('/api/finance/expenses', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const expense = store.createExpense(tenantId, req.body);
    res.status(201).json({ expense });
  } catch (err) {
    next(err);
  }
});

app.patch('/api/finance/expenses/:id', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const expense = store.updateExpenseStatus(tenantId, req.params.id, req.body?.status);
    res.json({ expense });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/finance/expenses/:id', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = store.deleteExpense(tenantId, req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post('/api/finance/expenses/:id/attachments', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const expense = store.addExpenseAttachment(tenantId, req.params.id, req.body);
    res.status(201).json({ expense });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/finance/expenses/:id/attachments/:attachmentId', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const expense = store.deleteExpenseAttachment(
      tenantId,
      req.params.id,
      req.params.attachmentId
    );
    res.json({ expense });
  } catch (err) {
    next(err);
  }
});

// Finance Controls: eTIMS Receipt Check
app.post('/api/finance/etims/verify', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const record = store.verifyEtimsReceipt(tenantId, req.body);
    res.status(201).json({ record });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/finance/etims/:id', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = store.deleteEtimsCheck(tenantId, req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Finance Controls: M-Pesa & Bank Statement Reconciliation
app.post('/api/finance/reconciliation/import', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : req.body;
    const result = store.importReconciliationLines(tenantId, lines);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

app.post('/api/finance/reconciliation/auto-match', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = store.autoMatchReconciliation(tenantId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.patch('/api/finance/reconciliation/:id', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const line = store.updateReconciliationLine(tenantId, req.params.id, req.body);
    res.json({ line });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/finance/reconciliation/:id', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = store.deleteReconciliationLine(tenantId, req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Finance Controls: Payroll & Statutory Deductions
app.post('/api/finance/payroll/generate', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const entries = store.generatePayrollRun(tenantId, req.body?.payPeriod);
    res.status(201).json({ entries });
  } catch (err) {
    next(err);
  }
});

app.post('/api/finance/payroll', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const entry = store.upsertPayrollEntry(tenantId, req.body);
    res.status(201).json({ entry });
  } catch (err) {
    next(err);
  }
});

app.patch('/api/finance/payroll/:id/status', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const entry = store.updatePayrollStatus(tenantId, req.params.id, req.body?.status);
    res.json({ entry });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/finance/payroll/:id', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = store.deletePayrollEntry(tenantId, req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Finance Controls: Departmental Budget Allocations
app.post('/api/finance/budgets', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const budget = store.upsertBudgetAllocation(tenantId, req.body);
    res.json({ budget });
  } catch (err) {
    next(err);
  }
});

app.patch('/api/finance/budgets/approval', (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const budget = store.approveBudgetAllocation(tenantId, {
      ...(req.body || {}),
      approvedBy: req.body?.approvedBy || req.authUser?.fullName || 'Finance Administrator',
    });
    res.json({ budget });
  } catch (err) {
    next(err);
  }
});

// Finance Controls: Board & Procurement Approvals Sign-Off
app.post('/api/finance/approvals', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const record = store.createApprovalRecord(tenantId, req.body);
    res.status(201).json({ record });
  } catch (err) {
    next(err);
  }
});

app.patch('/api/finance/approvals/:id', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const record = store.updateApprovalDecision(tenantId, req.params.id, req.body);
    res.json({ record });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/finance/approvals/:id', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const result = store.deleteApprovalRecord(tenantId, req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Communications & Notifications
app.post('/api/communications/announcements', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const announcement = store.createAnnouncement(tenantId, req.body);
    res.status(201).json({ announcement });
  } catch (err) {
    next(err);
  }
});

app.post('/api/communications/messages', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const message = store.createMessage(tenantId, req.body);
    res.status(201).json({ message });
  } catch (err) {
    next(err);
  }
});

app.post('/api/communications/whatsapp-log', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const record = store.logWhatsAppDispatch(tenantId, req.body);
    res.status(201).json({ record });
  } catch (err) {
    next(err);
  }
});

app.post('/api/notifications/read', (req, res, next) => {
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

if (!IS_VERCEL) {
  attachFrontend();
}

// Used by the Vercel serverless function entry.
export default app;
