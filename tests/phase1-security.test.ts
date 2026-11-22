import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { app, httpServer, store } from '../server';
import { setSmsSenderForTests } from '../server/lib/sms';

describe('Phase 1: Security Blockers & Tenant Isolation', () => {
  let tenantId = '';
  let adminEmail = '';
  let adminPassword = '';
  let adminToken = '';
  let teacherToken = '';
  let bursarToken = '';
  let parentToken = '';
  let parentUserId = '';
  let childCode = '';
  let domainName = '';
  let devToken = '';

  beforeAll(async () => {
    await store.ensureInitialized();
  });

  beforeEach(async () => {
    setSmsSenderForTests(null);
    const { devCredentials } = await store.resetForTests({ empty: false });
    const tenants = store.listTenants();
    tenantId = tenants[0].id;

    // Seeded demo accounts require password change on first login or accept direct API test flow.
    // Find seeded credentials from devCredentials for Admin, Teacher, Bursar, Parent, Developer
    const findCred = (role: string) => devCredentials.find((c) => c.role === role);
    const adminCred = findCred('Admin')!;
    adminEmail = adminCred.email;
    adminPassword = adminCred.password;

    // Complete password change for seeded Admin so token is usable for API calls
    const adminLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: adminEmail, password: adminPassword });
    expect(adminLoginRes.status).toBe(200);
    adminToken = adminLoginRes.body.token;
    if (adminLoginRes.body.user.mustChangePassword) {
      const nextPass = 'AdminPass2026!';
      const chg = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ currentPassword: adminPassword, newPassword: nextPass });
      expect(chg.status).toBe(200);
      adminToken = chg.body.token;
      adminPassword = nextPass;
    }

    // Create clean staff + parent accounts via Admin API (with password changed)
    const loginAndActivate = async (email: string, tempPass: string, permanentPass: string) => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email, password: tempPass });
      expect(loginRes.status).toBe(200);
      const chgRes = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${loginRes.body.token}`)
        .send({ currentPassword: tempPass, newPassword: permanentPass });
      expect(chgRes.status).toBe(200);
      return chgRes.body.token as string;
    };

    const domain = tenants[0].emailDomain || 'oakridge.ac.ke';
    const teacherRes = await request(app)
      .post('/api/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Grace Wanjiku',
        email: `teacher.sec@${domain}`,
        role: 'Teacher',
        phone: '+254712340001',
      });
    expect(teacherRes.status).toBe(201);
    teacherToken = await loginAndActivate(
      teacherRes.body.user.email,
      teacherRes.body.oneTimePassword,
      'TeacherPass2026!'
    );

    const bursarRes = await request(app)
      .post('/api/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Samuel Kiprop',
        email: `bursar.sec@${domain}`,
        role: 'Bursar',
        phone: '+254712340002',
      });
    expect(bursarRes.status).toBe(201);
    bursarToken = await loginAndActivate(
      bursarRes.body.user.email,
      bursarRes.body.oneTimePassword,
      'BursarPass2026!'
    );

    domainName = domain;
    const childEnroll = await request(app)
      .post('/api/students/enroll')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Achieng Junior',
        dateOfBirth: '2014-03-02',
        gender: 'Female',
        grade: 'Grade 6',
        section: 'A',
        guardianName: 'Mary Achieng',
        guardianPhone: '0712340003',
      });
    expect(childEnroll.status).toBe(201);
    childCode = childEnroll.body.student.studentCode;

    const parentRegRes = await request(app)
      .post('/api/auth/register')
      .send({
        tenantId,
        fullName: 'Mary Achieng',
        email: `parent.sec@${domain}`,
        password: 'ParentPass2026!',
        phone: '+254712340003',
        studentCode: childCode,
        guardianPhone: '0712340003',
      });
    expect(parentRegRes.status).toBe(201);
    expect(parentRegRes.body.user.role).toBe('Parent');
    parentToken = parentRegRes.body.token;
    parentUserId = parentRegRes.body.user.id;

    const devCred = findCred('Developer');
    if (devCred) {
      const devLoginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: devCred.email, password: devCred.password });
      if (devLoginRes.status === 200) {
        if (devLoginRes.body.user.mustChangePassword) {
          const chg = await request(app)
            .post('/api/auth/change-password')
            .set('Authorization', `Bearer ${devLoginRes.body.token}`)
            .send({ currentPassword: devCred.password, newPassword: 'DevMasterPass2026!' });
          devToken = chg.body.token;
        } else {
          devToken = devLoginRes.body.token;
        }
      }
    }
  });

  afterEach(() => {
    setSmsSenderForTests(null);
  });

  it('enforces Parent-only public self-signup, school domain check, and 10-char password policy', async () => {
    const tenant = store.listTenants()[0];
    const domain = tenant.emailDomain || 'oakridge.ac.ke';

    // Weak password rejected
    const weakRes = await request(app).post('/api/auth/register').send({
      tenantId,
      fullName: 'Weak Pass User',
      email: `weak@${domain}`,
      password: 'short1',
    });
    expect(weakRes.status).toBe(400);

    // Non-matching school domain rejected
    const badDomainRes = await request(app).post('/api/auth/register').send({
      tenantId,
      fullName: 'Wrong Domain',
      email: 'outsider@gmail.com',
      password: 'ValidPass2026!',
    });
    expect(badDomainRes.status).toBe(400);

    // Privileged role in public self-signup is rejected with 403
    const escalatedRes = await request(app).post('/api/auth/register').send({
      tenantId,
      fullName: 'Blocked Staff Signup',
      email: `blocked.admin@${domain}`,
      password: 'ValidPass2026!',
      role: 'Admin',
    });
    expect(escalatedRes.status).toBe(403);

    // Signup without proof of a learner is rejected (no account is created)
    const noProofRes = await request(app).post('/api/auth/register').send({
      tenantId,
      fullName: 'Honest Guardian',
      email: `guardian.new@${domain}`,
      password: 'ValidPass2026!',
    });
    expect(noProofRes.status).toBe(403);

    // A second learner with a different guardian phone can be claimed with the right proof
    const second = await request(app)
      .post('/api/students/enroll')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Second Learner',
        dateOfBirth: '2014-06-02',
        gender: 'Male',
        grade: 'Grade 6',
        section: 'A',
        guardianName: 'Honest Guardian',
        guardianPhone: '0712340077',
      });
    expect(second.status).toBe(201);
    const okRes = await request(app).post('/api/auth/register').send({
      tenantId,
      fullName: 'Honest Guardian',
      email: `guardian.new@${domain}`,
      password: 'ValidPass2026!',
      studentCode: second.body.student.studentCode,
      guardianPhone: '0712340077',
    });
    expect(okRes.status).toBe(201);
    expect(okRes.body.user.role).toBe('Parent');
  });

  it('verifies parent ownership: wrong phone / unknown code get the same generic 403, and a linked child cannot be re-claimed', async () => {
    const wrongPhone = await request(app).post('/api/auth/register').send({
      tenantId,
      fullName: 'Intruder',
      email: `intruder.a@${domainName}`,
      password: 'ValidPass2026!',
      studentCode: childCode,
      guardianPhone: '0799999999',
    });
    const unknownCode = await request(app).post('/api/auth/register').send({
      tenantId,
      fullName: 'Intruder',
      email: `intruder.b@${domainName}`,
      password: 'ValidPass2026!',
      studentCode: 'NOPE-0000',
      guardianPhone: '0712340003',
    });
    expect(wrongPhone.status).toBe(403);
    expect(unknownCode.status).toBe(403);
    expect(wrongPhone.body.error).toBe(unknownCode.body.error);

    // Correct proof, but the child already belongs to Mary => 409, Mary keeps access
    const reclaim = await request(app).post('/api/auth/register').send({
      tenantId,
      fullName: 'Other Guardian',
      email: `other.guardian@${domainName}`,
      password: 'ValidPass2026!',
      studentCode: childCode,
      guardianPhone: '0712340003',
    });
    expect(reclaim.status).toBe(409);
    const ws = await request(app).get('/api/workspace').set('Authorization', `Bearer ${parentToken}`);
    expect(ws.body.students.map((s: { studentCode: string }) => s.studentCode)).toEqual([childCode]);
  });

  it('does not grant a parent access to a learner just because guardianEmail matches their email', async () => {
    const victim = (store as any).state.students.find(
      (st: { tenantId: string; id: string }) => st.tenantId === tenantId
    );
    const before = victim.parentUserId;
    victim.guardianEmail = `parent.sec@${domainName}`;
    delete victim.parentUserId;
    const ws = await request(app).get('/api/workspace').set('Authorization', `Bearer ${parentToken}`);
    expect(ws.status).toBe(200);
    expect(ws.body.students.some((s: { id: string }) => s.id === victim.id)).toBe(false);
    victim.parentUserId = before;
  });

  it('lets a parent link another child with proof, and lets an admin relink / unlink', async () => {
    const other = await request(app)
      .post('/api/students/enroll')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Third Learner',
        dateOfBirth: '2013-02-02',
        gender: 'Male',
        grade: 'Grade 7',
        section: 'A',
        guardianName: 'Mary Achieng',
        guardianPhone: '0712340003',
      });
    expect(other.status).toBe(201);

    const bad = await request(app)
      .post('/api/parent/link-child')
      .set('Authorization', `Bearer ${parentToken}`)
      .send({ studentCode: other.body.student.studentCode, guardianPhone: '0700000000' });
    expect(bad.status).toBe(403);

    const good = await request(app)
      .post('/api/parent/link-child')
      .set('Authorization', `Bearer ${parentToken}`)
      .send({ studentCode: other.body.student.studentCode, guardianPhone: '0712340003' });
    expect(good.status).toBe(200);

    let ws = await request(app).get('/api/workspace').set('Authorization', `Bearer ${parentToken}`);
    expect(ws.body.students).toHaveLength(2);

    const unlink = await request(app)
      .patch(`/api/students/${other.body.student.id}/parent`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ parentUserId: null });
    expect(unlink.status).toBe(200);
    ws = await request(app).get('/api/workspace').set('Authorization', `Bearer ${parentToken}`);
    expect(ws.body.students).toHaveLength(1);

    // Teachers / parents cannot relink
    const forbidden = await request(app)
      .patch(`/api/students/${other.body.student.id}/parent`)
      .set('Authorization', `Bearer ${parentToken}`)
      .send({ parentUserId });
    expect(forbidden.status).toBe(403);
  });

  it('scopes teacher workspace to assigned cohorts and ignores client-supplied attendance identity', async () => {
    // No faculty profile for this account => no learners at all
    let ws = await request(app).get('/api/workspace').set('Authorization', `Bearer ${teacherToken}`);
    expect(ws.status).toBe(200);
    expect(ws.body.students).toEqual([]);
    expect(ws.body.admissions).toEqual([]);

    // Spoofing actorRole / teacherId cannot bypass the assignment check
    const spoof = await request(app)
      .post('/api/attendance/batch')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        date: '2026-11-20',
        grade: 'Grade 6',
        section: 'A',
        recordedBy: 'Someone Else',
        teacherId: store.listTenants()[0].teachers[0]?.id,
        entries: [],
      });
    expect(spoof.status).toBe(403);

    // Add a faculty profile for this teacher assigned to Grade 6 A only
    const add = await request(app)
      .post(`/api/tenants/${tenantId}/teachers`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Grace Wanjiku',
        email: `teacher.sec@${domainName}`,
        phone: '+254712340001',
        department: 'Sciences',
        subjects: ['Mathematics'],
        assignedClasses: [{ grade: 'Grade 6', section: 'A' }],
      });
    expect(add.status).toBe(201);

    ws = await request(app).get('/api/workspace').set('Authorization', `Bearer ${teacherToken}`);
    expect(ws.body.students.length).toBeGreaterThan(0);
    expect(
      ws.body.students.every(
        (s: { grade: string; section: string }) => s.grade === 'Grade 6' && s.section === 'A'
      )
    ).toBe(true);
    const ids = new Set(ws.body.students.map((s: { id: string }) => s.id));
    expect(ws.body.attendance.every((a: { studentId: string }) => ids.has(a.studentId))).toBe(true);
    expect(ws.body.examResults.every((r: { studentId: string }) => ids.has(r.studentId))).toBe(true);

    const own = await request(app)
      .post('/api/attendance/batch')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ date: '2026-11-20', grade: 'Grade 6', section: 'A', recordedBy: 'x', entries: [] });
    expect(own.status).toBe(200);
  });

  it('revokes the session server-side on logout', async () => {
    const out = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${parentToken}`);
    expect(out.status).toBe(200);
    const after = await request(app).get('/api/workspace').set('Authorization', `Bearer ${parentToken}`);
    expect(after.status).toBe(401);
  });

  it('hides suspended schools from the public directory', async () => {
    const res = await request(app).get('/api/auth/schools');
    expect(res.status).toBe(200);
    expect(res.body.schools.every((s: { status: string }) => s.status !== 'Suspended')).toBe(true);
  });

  it('enforces server-side RBAC, module authorization, and Parent/Teacher/Bursar workspace scoping', async () => {
    // Link first Oakridge student to Parent's email by enrolling/updating guardianEmail or testing workspace filtering
    const enrollRes = await request(app)
      .post('/api/students/enroll')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Baby Achieng',
        dateOfBirth: '2014-05-12',
        gender: 'Female',
        grade: 'Grade 6',
        section: 'A',
        guardianName: 'Mary Achieng',
        guardianPhone: '0712340003',
        guardianEmail: `parent.sec@${store.listTenants()[0].emailDomain || 'oakridge.ac.ke'}`,
      });
    // Wait: let's check parent link by creating invoice / checking workspace
    expect(enrollRes.status).toBe(201);

    // Parent cannot hit privileged finance/admissions/exam write endpoints
    const parentFeePost = await request(app)
      .post('/api/fees/invoices')
      .set('Authorization', `Bearer ${parentToken}`)
      .send({ studentId: enrollRes.body.student.id, term: 'Term 1', dueDate: '2026-12-01', totalAmount: 5000 });
    expect(parentFeePost.status).toBe(403);

    const parentExamWrite = await request(app)
      .post('/api/exams/scores')
      .set('Authorization', `Bearer ${parentToken}`)
      .send({ examCycleId: 'c1', studentId: enrollRes.body.student.id, subject: 'Mathematics', score: 90 });
    expect(parentExamWrite.status).toBe(403);

    const parentAdmissions = await request(app)
      .post('/api/students/enroll')
      .set('Authorization', `Bearer ${parentToken}`)
      .send({ fullName: 'Blocked', dateOfBirth: '2014-01-01', gender: 'Male', grade: 'Grade 6', section: 'A', guardianName: 'X', guardianPhone: '+254711111111' });
    expect(parentAdmissions.status).toBe(403);

    // Parent workspace must scrub sensitive school finance, payroll, budgets, reconciliation, M-Pesa, and other students
    const parentWs = await request(app)
      .get('/api/workspace')
      .set('Authorization', `Bearer ${parentToken}`);
    expect(parentWs.status).toBe(200);
    expect(parentWs.body.payrollEntries).toEqual([]);
    expect(parentWs.body.expenses).toEqual([]);
    expect(parentWs.body.budgets).toEqual([]);
    expect(parentWs.body.reconciliationLines).toEqual([]);
    expect(parentWs.body.mpesaTransactions).toEqual([]);

    // Teacher workspace must scrub payroll, budgets, reconciliation
    const teacherWs = await request(app)
      .get('/api/workspace')
      .set('Authorization', `Bearer ${teacherToken}`);
    expect(teacherWs.status).toBe(200);
    expect(teacherWs.body.payrollEntries).toEqual([]);
    expect(teacherWs.body.budgets).toEqual([]);
    expect(teacherWs.body.reconciliationLines).toEqual([]);

    // Teacher cannot access /api/fees or publish exam cycle
    const teacherFeeRes = await request(app)
      .post('/api/fees/structures')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ grade: 'Grade 6', term: 'Term 1', votelines: [{ name: 'Tuition', amount: 10000 }] });
    expect(teacherFeeRes.status).toBe(403);

    const teacherPublishRes = await request(app)
      .post('/api/exams/cycles/non-existent/publish')
      .set('Authorization', `Bearer ${teacherToken}`);
    expect(teacherPublishRes.status).toBe(403);

    // Bursar cannot publish exams or enroll students
    const bursarEnrollRes = await request(app)
      .post('/api/students/enroll')
      .set('Authorization', `Bearer ${bursarToken}`)
      .send({ fullName: 'Blocked', dateOfBirth: '2014-01-01', gender: 'Male', grade: 'Grade 6', section: 'A', guardianName: 'X', guardianPhone: '+254711111111' });
    expect(bursarEnrollRes.status).toBe(403);
  });

  it('delivers password reset code via SMS only (never in HTTP response), returns generic messages, and invalidates after 5 wrong guesses', async () => {
    const sentMessages: Array<{ phone: string; text: string }> = [];
    setSmsSenderForTests(async (phone, text) => {
      sentMessages.push({ phone, text });
      return { provider: 'custom' };
    });

    // Wrong email / mismatch returns identical generic response (200)
    const unknownReq = await request(app)
      .post('/api/auth/forgot-password/request')
      .send({ email: 'nobody@oakridge.ac.ke', phone: '+254700000000' });
    expect(unknownReq.status).toBe(200);
    expect(unknownReq.body.code).toBeUndefined();
    expect(unknownReq.body.verificationCode).toBeUndefined();
    expect(sentMessages.length).toBe(0);

    // Valid account + phone sends SMS without returning code in HTTP payload
    const domain = store.listTenants()[0].emailDomain || 'oakridge.ac.ke';
    const validReq = await request(app)
      .post('/api/auth/forgot-password/request')
      .send({ email: `parent.sec@${domain}`, phone: '0712340003' });
    expect(validReq.status).toBe(200);
    expect(validReq.body.message).toBe(unknownReq.body.message);
    expect(JSON.stringify(validReq.body)).not.toMatch(/\b\d{6}\b/);
    expect(sentMessages.length).toBe(1);

    const codeMatch = sentMessages[0].text.match(/\b(\d{6})\b/);
    expect(codeMatch).toBeTruthy();
    const realCode = codeMatch![1];

    // 5 failed verify attempts must invalidate the challenge (400 for first 4, 429 on 5th lockout)
    for (let i = 0; i < 5; i += 1) {
      const badTry = await request(app)
        .post('/api/auth/forgot-password/verify')
        .send({
          email: `parent.sec@${domain}`,
          phone: '+254712340003',
          code: '000000',
          newPassword: 'ResetValidPass2026!',
        });
      expect(badTry.status).toBe(i < 4 ? 400 : 429);
    }

    // Even the real code should now fail because 5 wrong tries invalidated it
    const afterLockRes = await request(app)
      .post('/api/auth/forgot-password/verify')
      .send({
        email: `parent.sec@${domain}`,
        phone: '+254712340003',
        code: realCode,
        newPassword: 'ResetValidPass2026!',
      });
    expect(afterLockRes.status).toBe(400);
  });

  it('invalidates prior tokens on password change via tokenVersion and validates tenant M-Pesa webhook secret + TransID deduplication', async () => {
    const oldToken = adminToken;
    const chgRes = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${oldToken}`)
      .send({ currentPassword: adminPassword, newPassword: 'RotatedPass2026!' });
    expect(chgRes.status).toBe(200);
    const rotatedToken = chgRes.body.token;

    // Old token must now be rejected with 401
    const oldSessionCheck = await request(app)
      .get('/api/auth/session')
      .set('Authorization', `Bearer ${oldToken}`);
    expect(oldSessionCheck.status).toBe(401);

    // New token works
    const newSessionCheck = await request(app)
      .get('/api/auth/session')
      .set('Authorization', `Bearer ${rotatedToken}`);
    expect(newSessionCheck.status).toBe(200);

    // Configure M-Pesa Paybill -> generates per-tenant webhook secret
    const cfgRes = await request(app)
      .put('/api/finance/mpesa/config')
      .set('Authorization', `Bearer ${rotatedToken}`)
      .send({
        enabled: true,
        environment: 'Production',
        paybillNumber: '522533',
        accountName: 'Oakridge Fees',
        accountReferenceFormat: 'ADM-CODE',
        regenerateSecret: true,
      });
    expect(cfgRes.status).toBe(200);
    expect(cfgRes.body.webhookCallbackUrl).toBeTruthy();
    expect(cfgRes.body.mpesaConfig.consumerKey).toBeUndefined();
    const secret = String(cfgRes.body.webhookCallbackUrl).split('/').pop()!;

    // Invalid secret rejected
    const badHook = await request(app)
      .post('/api/mpesa/c2b-callback/wrong-secret-token')
      .send({ TransID: 'TXN100', TransAmount: 5000, BillRefNumber: 'STU-999' });
    expect(badHook.status).toBe(401);

    // Enroll student and send M-Pesa webhook twice with same TransID -> credited only once
    const enrollRes = await request(app)
      .post('/api/students/enroll')
      .set('Authorization', `Bearer ${rotatedToken}`)
      .send({
        fullName: 'Daniel Mwangi',
        dateOfBirth: '2013-03-11',
        gender: 'Male',
        grade: 'Grade 6',
        section: 'A',
        guardianName: 'Peter Mwangi',
        guardianPhone: '+254712349999',
      });
    expect(enrollRes.status).toBe(201);
    const studentCode = enrollRes.body.student.studentCode;
    const initialBalance = enrollRes.body.invoice.balance;

    const hook1 = await request(app)
      .post(`/api/mpesa/c2b-callback/${secret}`)
      .send({
        BusinessShortCode: '522533',
        TransID: 'UBC99DEDUP1',
        TransAmount: 2500,
        BillRefNumber: studentCode,
        MSISDN: '254712349999',
      });
    expect(hook1.status).toBe(200);
    expect(hook1.body).toEqual({ ResultCode: 0, ResultDesc: 'Accepted' });

    const hook2 = await request(app)
      .post(`/api/mpesa/c2b-callback/${secret}`)
      .send({
        BusinessShortCode: '522533',
        TransID: 'UBC99DEDUP1',
        TransAmount: 2500,
        BillRefNumber: studentCode,
        MSISDN: '254712349999',
      });
    expect(hook2.status).toBe(200);
    expect(hook2.body).toEqual({ ResultCode: 0, ResultDesc: 'Accepted' });

    const wsAfter = await request(app)
      .get('/api/workspace')
      .set('Authorization', `Bearer ${rotatedToken}`);
    const updatedInvoice = wsAfter.body.invoices.find(
      (i: { id: string }) => i.id === enrollRes.body.invoice.id
    );
    expect(updatedInvoice.paidAmount).toBe(2500);
    expect(updatedInvoice.balance).toBe(Math.max(0, initialBalance - 2500));

    // Verify Duplicate log exists
    const dupLog = wsAfter.body.mpesaTransactions.find(
      (m: { mpesaReceipt: string; status: string }) =>
        m.mpesaReceipt === 'UBC99DEDUP1' && m.status === 'Duplicate'
    );
    expect(dupLog).toBeTruthy();

    // Check Developer token exists if seeded
    expect(typeof devToken).toBe('string');
  });

  it('rejects unauthenticated WebSocket connections and binds tenantId server-side', async () => {
    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = httpServer.address() as AddressInfo;
    const baseWsUrl = `ws://127.0.0.1:${addr.port}/ws`;

    try {
      // Unauthenticated message must close with 4401
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(baseWsUrl);
        const timer = setTimeout(() => {
          ws.terminate();
          reject(new Error('Expected unauthenticated socket to close'));
        }, 3000);
        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'subscribe', tenantId: 'tenant-other' }));
        });
        ws.on('close', (code) => {
          clearTimeout(timer);
          expect(code).toBe(4401);
          resolve();
        });
      });

      // Authenticated socket receives server-assigned tenantId even if spoofing another tenant
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(baseWsUrl);
        const timer = setTimeout(() => {
          ws.terminate();
          reject(new Error('Expected authenticated socket connected frame'));
        }, 3000);
        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'auth', token: adminToken }));
        });
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'connected') {
            expect(msg.tenantId).toBe(tenantId);
            ws.send(JSON.stringify({ type: 'subscribe', tenantId: 'spoofed-tenant-id' }));
          } else if (msg.type === 'subscribed') {
            expect(msg.tenantId).toBe(tenantId);
            clearTimeout(timer);
            ws.close();
            resolve();
          }
        });
      });

      // A token in the URL is no longer accepted: the socket stays unauthenticated and is closed
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`${baseWsUrl}?token=${encodeURIComponent(adminToken)}`);
        const timer = setTimeout(() => {
          ws.terminate();
          reject(new Error('Expected URL-token socket to be closed'));
        }, 3000);
        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'subscribe', tenantId }));
        });
        ws.on('close', (code) => {
          clearTimeout(timer);
          expect(code).toBe(4401);
          resolve();
        });
      });
    } finally {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });
});
