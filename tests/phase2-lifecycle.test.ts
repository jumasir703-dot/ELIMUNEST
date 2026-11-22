import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, store } from '../server';

describe('Phase 2: academic terms, student lifecycle, promotion and bulk import', () => {
  let tenantId = '';
  let adminToken = '';
  let teacherToken = '';

  const post = (url: string, token: string, body: object = {}) =>
    request(app).post(url).set('Authorization', `Bearer ${token}`).send(body);
  const patch = (url: string, token: string, body: object = {}) =>
    request(app).patch(url).set('Authorization', `Bearer ${token}`).send(body);
  const workspace = async (token = adminToken) =>
    (await request(app).get('/api/workspace').set('Authorization', `Bearer ${token}`)).body;

  const enroll = async (over: Record<string, unknown> = {}) => {
    const res = await post('/api/students/enroll', adminToken, {
      fullName: 'Test Learner',
      dateOfBirth: '2014-03-02',
      gender: 'Female',
      grade: 'Grade 6',
      section: 'A',
      guardianName: 'Guardian One',
      guardianPhone: '0712340001',
      ...over,
    });
    expect(res.status).toBe(201);
    return res.body.student as { id: string; studentCode: string; grade: string; section: string };
  };

  beforeAll(async () => {
    await store.ensureInitialized();
  });

  beforeEach(async () => {
    const { devCredentials } = await store.resetForTests({ empty: false });
    const tenant = store.listTenants()[0];
    tenantId = tenant.id;
    const domain = tenant.emailDomain || 'oakridge.ac.ke';

    const activate = async (email: string, tempPass: string, permPass: string) => {
      const login = await request(app).post('/api/auth/login').send({ email, password: tempPass });
      expect(login.status).toBe(200);
      if (!login.body.user.mustChangePassword) return login.body.token as string;
      const chg = await post('/api/auth/change-password', login.body.token, {
        currentPassword: tempPass,
        newPassword: permPass,
      });
      expect(chg.status).toBe(200);
      return chg.body.token as string;
    };
    const adminCred = devCredentials.find((c) => c.role === 'Admin')!;
    adminToken = await activate(adminCred.email, adminCred.password, 'AdminLife2026!');
    const t = await post('/api/auth/users', adminToken, {
      fullName: 'Teacher Life',
      email: `teacher.life@${domain}`,
      role: 'Teacher',
      phone: '+254712000111',
    });
    expect(t.status).toBe(201);
    teacherToken = await activate(t.body.user.email, t.body.oneTimePassword, 'TeacherLife2026!');
  });

  // ───────────────────────── terms ─────────────────────────

  it('validates terms, locks attendance / exam cycles / invoices when closed, and reopens only with a reason', async () => {
    const base = `/api/tenants/${tenantId}/terms`;

    // Validation
    expect((await post(base, adminToken, { name: 'T', startDate: '2020-01-06', endDate: '2020-04-10' })).status).toBe(400);
    expect((await post(base, adminToken, { name: 'Term 1', startDate: '2020-13-40', endDate: '2020-04-10' })).status).toBe(400);
    expect((await post(base, adminToken, { name: 'Term 1', startDate: '2020-04-10', endDate: '2020-01-06' })).status).toBe(400);

    const created = await post(base, adminToken, {
      name: 'Term 1',
      academicYear: store.listTenants()[0].academicYear,
      startDate: '2020-01-06',
      endDate: '2020-04-10',
    });
    expect(created.status).toBe(201);
    expect(created.body.term.status).toBe('Open');
    const termId = created.body.term.id as string;

    // Duplicate name and overlapping dates are rejected
    expect(
      (await post(base, adminToken, { name: 'Term 1', startDate: '2021-01-01', endDate: '2021-03-01' })).status
    ).toBe(409);
    expect(
      (await post(base, adminToken, { name: 'Term 2', startDate: '2020-03-01', endDate: '2020-06-01' })).status
    ).toBe(409);

    // Teachers cannot manage the calendar
    expect((await post(`${base}/${termId}/close`, teacherToken)).status).toBe(403);

    const student = await enroll();

    // Open term: writes succeed
    const attendanceBody = {
      date: '2020-02-10',
      grade: 'Grade 6',
      section: 'A',
      recordedBy: 'Admin',
      entries: [{ studentId: student.id, status: 'Present', remarks: '' }],
    };
    expect((await post('/api/attendance/batch', adminToken, attendanceBody)).status).toBe(200);

    // Close the term
    const closed = await post(`${base}/${termId}/close`, adminToken);
    expect(closed.status).toBe(200);
    expect(closed.body.term.status).toBe('Closed');
    expect((await post(`${base}/${termId}/close`, adminToken)).status).toBe(409);

    // Closed term locks attendance, exam cycles dated inside it, and new invoices for it
    const lockedAttendance = await post('/api/attendance/batch', adminToken, attendanceBody);
    expect(lockedAttendance.status).toBe(409);
    expect(lockedAttendance.body.error).toMatch(/closed/i);

    const lockedCycle = await post('/api/exams/cycles', adminToken, {
      title: 'Opener',
      term: 'Term 1',
      startDate: '2020-02-15',
      endDate: '2020-02-20',
    });
    expect(lockedCycle.status).toBe(409);

    const lockedInvoice = await post('/api/fees/invoices', adminToken, {
      studentId: student.id,
      term: 'Term 1',
      dueDate: '2020-03-01',
      totalAmount: 1000,
    });
    // The lock matches the tenant's current academic year; the term above was created for it.
    expect(lockedInvoice.status).toBe(409);

    // Dates outside the closed term are unaffected
    expect(
      (await post('/api/attendance/batch', adminToken, { ...attendanceBody, date: '2020-05-04' })).status
    ).toBe(200);

    // Reopen needs a real reason, then writes work again
    expect((await post(`${base}/${termId}/reopen`, adminToken, { reason: 'x' })).status).toBe(400);
    const reopened = await post(`${base}/${termId}/reopen`, adminToken, { reason: 'Marks entered late' });
    expect(reopened.status).toBe(200);
    expect(reopened.body.term.status).toBe('Open');
    expect(reopened.body.term.reopenReason).toBe('Marks entered late');
    expect((await post('/api/attendance/batch', adminToken, attendanceBody)).status).toBe(200);
  });

  it('never blocks anything when a school has no terms configured', async () => {
    const student = await enroll();
    const res = await post('/api/attendance/batch', adminToken, {
      date: '2020-02-10',
      grade: 'Grade 6',
      section: 'A',
      recordedBy: 'Admin',
      entries: [{ studentId: student.id, status: 'Present', remarks: '' }],
    });
    expect(res.status).toBe(200);
  });

  // ───────────────────────── student edit / status ─────────────────────────

  it('edits learner details with validation and an audit trail that omits phone/email values', async () => {
    const s = await enroll();

    const ok = await patch(`/api/students/${s.id}`, adminToken, {
      fullName: 'Renamed Learner',
      guardianPhone: '0799888777',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.student.fullName).toBe('Renamed Learner');
    expect(ok.body.student.studentCode).toBe(s.studentCode); // admission number is immutable
    expect(ok.body.student.history[0].summary).toBe('Updated name, guardian phone');
    expect(JSON.stringify(ok.body.student.history)).not.toContain('0799888777');

    expect((await patch(`/api/students/${s.id}`, adminToken, { grade: 'Grade 99' })).status).toBe(400);
    expect((await patch(`/api/students/${s.id}`, adminToken, { section: 'Q' })).status).toBe(400);
    expect((await patch(`/api/students/${s.id}`, adminToken, { guardianPhone: '123' })).status).toBe(400);
    expect((await patch(`/api/students/${s.id}`, adminToken, { fullName: 'x' })).status).toBe(400);

    // Duplicate UPI is rejected
    const other = await enroll({ fullName: 'Other Learner', guardianPhone: '0712340002' });
    const otherUpi = (await workspace()).students.find((x: { id: string }) => x.id === other.id).upi;
    expect((await patch(`/api/students/${s.id}`, adminToken, { upi: otherUpi })).status).toBe(409);

    // Teachers cannot edit learners
    expect((await patch(`/api/students/${s.id}`, teacherToken, { fullName: 'Hacked Name' })).status).toBe(403);
    // Other tenants' learners are not reachable
    expect((await patch('/api/students/stu-nope', adminToken, { fullName: 'Nobody Here' })).status).toBe(404);
  });

  it('changes learner status with reasons, keeps the record, and frees learner-cap seats', async () => {
    const s = await enroll();

    expect((await post(`/api/students/${s.id}/status`, adminToken, { status: 'Bogus' })).status).toBe(400);
    expect((await post(`/api/students/${s.id}/status`, adminToken, { status: 'Active' })).status).toBe(409);
    // Withdrawing / transferring needs a reason
    expect((await post(`/api/students/${s.id}/status`, adminToken, { status: 'Withdrawn' })).status).toBe(400);
    expect(
      (await post(`/api/students/${s.id}/status`, adminToken, { status: 'Transferred', reason: 'Moved', effectiveDate: '2026-31-99' })).status
    ).toBe(400);

    const withdrawn = await post(`/api/students/${s.id}/status`, adminToken, {
      status: 'Withdrawn',
      reason: 'Family relocated',
      effectiveDate: '2026-11-01',
    });
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.student.status).toBe('Withdrawn');
    expect(withdrawn.body.student.exitDate).toBe('2026-11-01');
    expect(typeof withdrawn.body.outstandingBalance).toBe('number');
    expect(withdrawn.body.student.history[0].summary).toContain('Active → Withdrawn');

    // Record is retained (soft delete)
    const ws = await workspace();
    expect(ws.students.some((x: { id: string }) => x.id === s.id)).toBe(true);

    // Withdrawn learners no longer hold a seat; reactivating re-checks the cap
    const tenant = (store as any).state.tenants.find((t: { id: string }) => t.id === tenantId);
    const counted = (store as any).state.students.filter(
      (x: { tenantId: string; status: string }) => x.tenantId === tenantId && (x.status === 'Active' || x.status === 'On Leave')
    ).length;
    tenant.learnerCap = counted; // exactly full
    const blocked = await post(`/api/students/${s.id}/status`, adminToken, { status: 'Active' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/cap/i);
    tenant.learnerCap = counted + 1;
    const back = await post(`/api/students/${s.id}/status`, adminToken, { status: 'Active' });
    expect(back.status).toBe(200);
    expect(back.body.student.exitDate).toBeUndefined();

    expect((await post(`/api/students/${s.id}/status`, teacherToken, { status: 'On Leave' })).status).toBe(403);
  });

  // ───────────────────────── promotion ─────────────────────────

  it('previews promotion without changing anything, then applies it with per-learner overrides', async () => {
    const a = await enroll({ fullName: 'Promote Me', guardianPhone: '0712340011' });
    const b = await enroll({ fullName: 'Repeat Me', guardianPhone: '0712340012' });
    const c = await enroll({ fullName: 'Leaving Soon', guardianPhone: '0712340013' });

    const preview = await post('/api/students/promote', adminToken, {
      fromGrade: 'Grade 6',
      decisions: { [b.id]: 'repeat', [c.id]: 'transfer' },
      dryRun: true,
    });
    expect(preview.status).toBe(200);
    expect(preview.body.dryRun).toBe(true);
    expect(preview.body.applied).toBe(false);
    expect(preview.body.toGrade).toBe('Grade 7');
    expect(preview.body.counts.repeat).toBe(1);
    expect(preview.body.counts.transfer).toBe(1);
    const stillSix = (await workspace()).students.filter((s: { id: string; grade: string }) =>
      [a.id, b.id, c.id].includes(s.id) && s.grade === 'Grade 6'
    );
    expect(stillSix).toHaveLength(3); // dry run changed nothing

    const applied = await post('/api/students/promote', adminToken, {
      fromGrade: 'Grade 6',
      decisions: { [b.id]: 'repeat', [c.id]: 'transfer' },
    });
    expect(applied.status).toBe(200);
    expect(applied.body.applied).toBe(true);

    const ws = await workspace();
    const byId = (id: string) => ws.students.find((s: { id: string }) => s.id === id);
    expect(byId(a.id).grade).toBe('Grade 7');
    expect(byId(a.id).history[0].kind).toBe('promotion');
    expect(byId(b.id).grade).toBe('Grade 6');
    expect(byId(c.id).status).toBe('Transferred');
    expect(byId(c.id).exitDate).toBeTruthy();

    // Running it again only touches the learners still Active in Grade 6 (the repeater)
    const again = await post('/api/students/promote', adminToken, { fromGrade: 'Grade 6', dryRun: true });
    expect(again.body.items.map((i: { studentId: string }) => i.studentId)).toContain(b.id);
    expect(again.body.items.map((i: { studentId: string }) => i.studentId)).not.toContain(a.id);
  });

  it('rejects bad promotion requests and graduates the final grade', async () => {
    const s = await enroll();
    expect((await post('/api/students/promote', adminToken, { fromGrade: 'Grade 99' })).status).toBe(400);
    expect(
      (await post('/api/students/promote', adminToken, { fromGrade: 'Grade 6', decisions: { 'stu-x': 'promote' } })).status
    ).toBe(400);
    expect(
      (await post('/api/students/promote', adminToken, { fromGrade: 'Grade 6', decisions: { [s.id]: 'fly' } })).status
    ).toBe(400);
    expect((await post('/api/students/promote', teacherToken, { fromGrade: 'Grade 6' })).status).toBe(403);

    // Move this learner to the school's final grade, then promote: they graduate
    const tenant = store.listTenants()[0];
    const finalGrade = tenant.grades[tenant.grades.length - 1];
    (store as any).state.students.find((x: { id: string }) => x.id === s.id).grade = finalGrade;
    (store as any).state.students.find((x: { id: string }) => x.id === s.id).section =
      (tenant.gradeStreams?.[finalGrade] || tenant.sections)[0];
    const bad = await post('/api/students/promote', adminToken, {
      fromGrade: finalGrade,
      decisions: { [s.id]: 'promote' },
    });
    expect(bad.status).toBe(400); // nowhere to promote to
    const done = await post('/api/students/promote', adminToken, { fromGrade: finalGrade });
    expect(done.status).toBe(200);
    expect(done.body.toGrade).toBeNull();
    expect(done.body.counts.graduate).toBeGreaterThanOrEqual(1);
    const after = (await workspace()).students.find((x: { id: string }) => x.id === s.id);
    expect(after.status).toBe('Graduated');
  });

  it('rejects unknown grades / streams and accidental duplicate enrolment', async () => {
    const base = {
      fullName: 'Dup Check',
      dateOfBirth: '2014-03-02',
      gender: 'Female',
      grade: 'Grade 6',
      section: 'A',
      guardianName: 'Guardian',
      guardianPhone: '0712340099',
    };
    expect((await post('/api/students/enroll', adminToken, { ...base, grade: 'Grade 99' })).status).toBe(400);
    expect((await post('/api/students/enroll', adminToken, { ...base, section: 'Q' })).status).toBe(400);
    expect((await post('/api/students/enroll', adminToken, base)).status).toBe(201);
    const dup = await post('/api/students/enroll', adminToken, base);
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatch(/already enrolled/i);
    // A sibling with the same guardian phone but a different name / DOB is still fine
    expect(
      (await post('/api/students/enroll', adminToken, { ...base, fullName: 'Dup Sibling', dateOfBirth: '2016-01-09' })).status
    ).toBe(201);
  });

  // ───────────────────────── bulk import ─────────────────────────

  it('dry-runs an import without writing, then imports valid rows and reports bad ones by row number', async () => {
    const before = (await workspace()).students.length;
    const rows = [
      { fullName: 'Import One', dateOfBirth: '2014-04-04', gender: 'F', grade: 'Grade 6', section: 'A', guardianName: 'G One', guardianPhone: '0711000001' },
      { fullName: 'Import Two', dateOfBirth: '2013-05-05', gender: 'Male', grade: 'Grade 6', section: 'A', guardianName: 'G Two', guardianPhone: '0711000002' },
      { fullName: 'Bad Phone', dateOfBirth: '2013-05-05', gender: 'Male', grade: 'Grade 6', section: 'A', guardianName: 'G Three', guardianPhone: '12' },
      { fullName: 'Bad Gender', dateOfBirth: '2013-05-05', gender: '??', grade: 'Grade 6', section: 'A', guardianName: 'G Four', guardianPhone: '0711000004' },
      { fullName: 'Bad Grade', dateOfBirth: '2013-05-05', gender: 'F', grade: 'Grade 99', section: 'A', guardianName: 'G Five', guardianPhone: '0711000005' },
    ];

    const dry = await post('/api/students/import', adminToken, { rows, dryRun: true });
    expect(dry.status).toBe(200);
    expect(dry.body.dryRun).toBe(true);
    expect(dry.body.accepted).toBe(2);
    expect(dry.body.rejected).toBe(3);
    expect(dry.body.results.filter((r: { ok: boolean }) => !r.ok).map((r: { row: number }) => r.row)).toEqual([3, 4, 5]);
    expect((await workspace()).students.length).toBe(before); // nothing written

    const real = await post('/api/students/import', adminToken, { rows });
    expect(real.status).toBe(200);
    expect(real.body.accepted).toBe(2);
    const ws = await workspace();
    expect(ws.students.length).toBe(before + 2);
    const imported = ws.students.find((s: { fullName: string }) => s.fullName === 'Import One');
    expect(imported.history[0].kind).toBe('import');
    // Dry-run and real import hand out the same admission numbers (the dry run did not consume any)
    expect(real.body.results.filter((r: { ok: boolean }) => r.ok).map((r: { studentCode: string }) => r.studentCode)).toEqual(
      dry.body.results.filter((r: { ok: boolean }) => r.ok).map((r: { studentCode: string }) => r.studentCode)
    );

    // Re-importing the same file is rejected row by row (no silent duplicates)
    const dup = await post('/api/students/import', adminToken, { rows: rows.slice(0, 2) });
    expect(dup.body.accepted).toBe(0);
    expect((await workspace()).students.length).toBe(before + 2);
  });

  it('enforces import limits, the learner cap, and role access', async () => {
    expect((await post('/api/students/import', adminToken, { rows: [] })).status).toBe(400);
    expect((await post('/api/students/import', adminToken, {})).status).toBe(400);
    const tooMany = Array.from({ length: 501 }, (_, i) => ({ fullName: `L ${i}`, grade: 'Grade 6' }));
    expect((await post('/api/students/import', adminToken, { rows: tooMany })).status).toBe(400);
    expect((await post('/api/students/import', teacherToken, { rows: [{ fullName: 'Nope Nope' }] })).status).toBe(403);

    // Learner cap is honoured mid-import: only the rows that fit are admitted
    const tenant = (store as any).state.tenants.find((t: { id: string }) => t.id === tenantId);
    const counted = (store as any).state.students.filter(
      (x: { tenantId: string; status: string }) => x.tenantId === tenantId && (x.status === 'Active' || x.status === 'On Leave')
    ).length;
    tenant.learnerCap = counted + 1;
    const rows = [1, 2, 3].map((n) => ({
      fullName: `Cap Learner ${n}`,
      dateOfBirth: '2014-04-04',
      gender: 'Female',
      grade: 'Grade 6',
      section: 'A',
      guardianName: `Cap Guardian ${n}`,
      guardianPhone: `07110001${n}0`,
    }));
    const res = await post('/api/students/import', adminToken, { rows });
    expect(res.body.accepted).toBe(1);
    expect(res.body.results[1].error).toMatch(/cap/i);
  });
});
