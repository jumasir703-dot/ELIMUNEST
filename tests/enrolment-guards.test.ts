import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, store } from '../server';

describe('Enrolment guards: unknown grades/streams and accidental duplicates', () => {
  let adminToken = '';

  beforeAll(async () => {
    await store.ensureInitialized();
  });

  beforeEach(async () => {
    const { devCredentials } = await store.resetForTests({ empty: false });
    const cred = devCredentials.find((c) => c.role === 'Admin')!;
    const login = await request(app).post('/api/auth/login').send({ email: cred.email, password: cred.password });
    const chg = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ currentPassword: cred.password, newPassword: 'AdminGuard2026!' });
    adminToken = chg.body.token;
  });

  const enroll = (body: object) =>
    request(app).post('/api/students/enroll').set('Authorization', `Bearer ${adminToken}`).send(body);

  const base = {
    fullName: 'Dup Check',
    dateOfBirth: '2014-03-02',
    gender: 'Female',
    grade: 'Grade 6',
    section: 'A',
    guardianName: 'Guardian',
    guardianPhone: '0712340099',
  };

  it('rejects grades and streams the school does not have', async () => {
    expect((await enroll({ ...base, grade: 'Grade 99' })).status).toBe(400);
    expect((await enroll({ ...base, section: 'Q' })).status).toBe(400);
  });

  it('blocks the same learner being enrolled twice, but allows siblings on the same guardian phone', async () => {
    expect((await enroll(base)).status).toBe(201);
    const dup = await enroll(base);
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatch(/already enrolled/i);
    expect(
      (await enroll({ ...base, fullName: 'Dup Sibling', dateOfBirth: '2016-01-09' })).status
    ).toBe(201);
  });

  it('rejects the same learner in a bulk import re-upload (no silent duplicates)', async () => {
    const rows = [
      { fullName: 'Import One', dateOfBirth: '2014-04-04', gender: 'Female', grade: 'Grade 6', section: 'A', guardianName: 'G One', guardianPhone: '0711000001' },
    ];
    const csvRows = rows.map((r) => ({ ...r }));
    const first = await request(app).post('/api/students/import').set('Authorization', `Bearer ${adminToken}`).send({ dryRun: false, rows: csvRows });
    expect([200, 201]).toContain(first.status);
    expect(first.body.importedCount).toBe(1); // the file itself is valid, so a 0 below means "duplicate", not "bad row"
    // A dry run flags the re-uploaded learner as a duplicate...
    const dry = await request(app).post('/api/students/import').set('Authorization', `Bearer ${adminToken}`).send({ dryRun: true, rows: csvRows });
    expect(dry.status).toBe(200);
    expect(dry.body.errorCount).toBe(1);
    expect(JSON.stringify(dry.body.rows[0].errors)).toMatch(/already enrolled/i);
    // ...and committing it creates nothing (no valid rows left)
    const commit = await request(app).post('/api/students/import').set('Authorization', `Bearer ${adminToken}`).send({ dryRun: false, skipInvalid: true, rows: csvRows });
    expect(commit.status).toBe(400);
    const sameNameCount = store.getWorkspace(store.listTenants()[0].id).students.filter((s) => s.fullName === 'Import One').length;
    expect(sameNameCount).toBe(1);

    // Unknown stream is a row error too
    const badStream = await request(app)
      .post('/api/students/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ dryRun: true, rows: [{ ...csvRows[0], fullName: 'Other Child', section: 'Q' }] });
    expect(badStream.body.errorCount).toBe(1);
    expect(JSON.stringify(badStream.body.rows[0].errors)).toMatch(/Stream/);
  });
});
