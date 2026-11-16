import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import express, { type NextFunction, type Request, type Response } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { ConflictError, TenantStore } from './server/store.ts';
import {
  issueAdminSession,
  requireAdminAuth,
  type AdminAuthenticatedRequest,
} from './server/middleware/adminAuth.ts';
import { PlatformAdminService } from './server/services/adminService.ts';
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

function getTenantId(req: Request): string {
  const headerTenant = req.header('x-tenant-id');
  const queryTenant = typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined;
  return headerTenant || queryTenant || 'tenant-oakridge';
}

// REST API Routes
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', tenants: store.listTenants().length });
});

// Admin Auth & Service Layer Endpoints
const adminGuard = requireAdminAuth(['Super Admin', 'Admin']);

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

app.put('/api/tenants/:id/streams', (req, res, next) => {
  try {
    const tenant = store.updateStreams(req.params.id, req.body);
    res.json({ tenant });
  } catch (err) {
    next(err);
  }
});

app.put('/api/tenants/:id/subjects', (req, res, next) => {
  try {
    const tenant = store.updateSubjects(req.params.id, req.body);
    res.json({ tenant });
  } catch (err) {
    next(err);
  }
});

app.post('/api/tenants/:id/teachers', (req, res, next) => {
  try {
    const result = store.addTeacher(req.params.id, req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

app.put('/api/tenants/:id/teachers/:teacherId', (req, res, next) => {
  try {
    const result = store.updateTeacher(req.params.id, req.params.teacherId, req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/tenants/:id/teachers/:teacherId', (req, res, next) => {
  try {
    const result = store.deleteTeacher(req.params.id, req.params.teacherId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post('/api/tenants/:id/non-teaching-staff', (req, res, next) => {
  try {
    const result = store.addNonTeachingStaff(req.params.id, req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

app.get('/api/workspace', (req, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const workspace = store.getWorkspace(tenantId);
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
