import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, store } from '../server';

const RECOVERY = 'Recover2026x';

async function applyRecovery() {
  // The recovery step runs once per process in production; reset the guard so each test re-runs it.
  (store as unknown as { recoveryPromise: Promise<void> | null }).recoveryPromise = null;
  await store.ensureHydrated();
}

describe('Account recovery via RECOVERY_PASSWORD', () => {
  let devCredentials: Array<{ email: string; role: string; password: string }> = [];

  beforeAll(async () => {
    await store.ensureInitialized();
  });

  beforeEach(async () => {
    ({ devCredentials } = await store.resetForTests({ empty: false }));
  });

  afterEach(() => {
    delete process.env.RECOVERY_PASSWORD;
    delete process.env.RECOVERY_EMAIL;
  });

  it('does nothing when RECOVERY_PASSWORD is not set', async () => {
    const dev = devCredentials.find((c) => c.role === 'Developer')!;
    await applyRecovery();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: dev.email, password: dev.password });
    expect(res.status).toBe(200);
  });

  it('resets the developer account to a one-time password by default', async () => {
    const dev = devCredentials.find((c) => c.role === 'Developer')!;
    process.env.RECOVERY_PASSWORD = RECOVERY;
    await applyRecovery();

    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: dev.email, password: dev.password });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: dev.email, password: RECOVERY });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.user.mustChangePassword).toBe(true);
  });

  it('can target another account with RECOVERY_EMAIL', async () => {
    const admin = devCredentials.find((c) => c.role === 'Admin')!;
    process.env.RECOVERY_PASSWORD = RECOVERY;
    process.env.RECOVERY_EMAIL = admin.email.toUpperCase();
    await applyRecovery();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: RECOVERY });
    expect(res.status).toBe(200);
    expect(res.body.user.mustChangePassword).toBe(true);
  });

  it('ignores a password that fails the strength policy', async () => {
    const dev = devCredentials.find((c) => c.role === 'Developer')!;
    process.env.RECOVERY_PASSWORD = 'short';
    await applyRecovery();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: dev.email, password: dev.password });
    expect(res.status).toBe(200);
  });

  it('revokes sessions that existed before the reset', async () => {
    const admin = devCredentials.find((c) => c.role === 'Admin')!;
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: admin.password });
    expect(login.status).toBe(200);
    const change = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ currentPassword: admin.password, newPassword: 'AdminPass2026!' });
    expect(change.status).toBe(200);
    const token = change.body.token as string;

    const before = await request(app).get('/api/auth/session').set('Authorization', `Bearer ${token}`);
    expect(before.status).toBe(200);

    process.env.RECOVERY_PASSWORD = RECOVERY;
    process.env.RECOVERY_EMAIL = admin.email;
    await applyRecovery();

    const after = await request(app).get('/api/auth/session').set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(401);
  });
});
