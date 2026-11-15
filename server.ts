import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import express, { type NextFunction, type Request, type Response } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { ConflictError, TenantStore } from './server/store.ts';
import type { WsServerEvent } from './src/shared/types.ts';

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';
// On Vercel the app runs as a serverless function: no listen(), no WebSockets,
// and static files are served by Vercel itself.
const IS_VERCEL = Boolean(process.env.VERCEL);

interface TenantWebSocket extends WebSocket {
  tenantId?: string;
  isAlive?: boolean;
}

const app = express();
app.use(express.json({ limit: '5mb' }));

const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

const store = new TenantStore();

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

app.get('/api/super-admin/tenants', (_req, res) => {
  res.json({ summaries: store.getSuperAdminOverview() });
});

app.get('/api/tenants', (_req, res) => {
  res.json({ tenants: store.listTenants() });
});

app.post('/api/tenants', (req, res, next) => {
  try {
    const tenant = store.createTenant(req.body);
    res.status(201).json({ tenant });
  } catch (err) {
    next(err);
  }
});

app.patch('/api/tenants/:id', (req, res, next) => {
  try {
    const tenant = store.updateTenant(req.params.id, req.body);
    res.json({ tenant });
  } catch (err) {
    next(err);
  }
});

app.patch('/api/tenants/:id/branding', (req, res, next) => {
  try {
    const tenant = store.updateTenantBranding(req.params.id, req.body);
    res.json({ tenant });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/tenants/:id', (req, res, next) => {
  try {
    const result = store.deleteTenant(req.params.id);
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
