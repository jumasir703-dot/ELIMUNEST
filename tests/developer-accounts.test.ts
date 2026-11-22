import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, store } from '../server';

describe('Developer Portal Account & Tenant Credential Management', () => {
  let devToken = '';

  beforeAll(async () => {
    await store.ensureInitialized();
  });

  beforeEach(async () => {
    const { devCredentials } = await store.resetForTests({ empty: false });
    const devCred = devCredentials.find((c) => c.role === 'Developer')!;
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: devCred.email, password: devCred.password });
    expect(login.status).toBe(200);
    const chg = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ currentPassword: devCred.password, newPassword: 'DevMasterPass2026!' });
    expect(chg.status).toBe(200);
    devToken = chg.body.token;
  });

  it('onboards a tenant with a custom initial admin password and maintains accounts & password resets', async () => {
    const onboard = await request(app)
      .post('/api/dev/tenants')
      .set('Authorization', `Bearer ${devToken}`)
      .send({
        name: 'Rift Valley High',
        emailDomain: 'riftvalley.ac.ke',
        adminFullName: 'Joyce Mutai',
        adminEmail: 'joyce.mutai@riftvalley.ac.ke',
        adminPassword: 'RiftAdmin2026!',
      });
    expect(onboard.status).toBe(201);
    expect(onboard.body.adminUser.email).toBe('joyce.mutai@riftvalley.ac.ke');
    expect(onboard.body.adminUser.oneTimePassword).toBe('RiftAdmin2026!');
    expect(onboard.body.adminUser.mustChangePassword).toBe(false);

    const newTenantId = onboard.body.tenant.id;

    // Tenant admin can log in directly with the assigned password
    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'joyce.mutai@riftvalley.ac.ke', password: 'RiftAdmin2026!' });
    expect(adminLogin.status).toBe(200);
    expect(adminLogin.body.user.mustChangePassword).toBe(false);

    // Developer can list tenant accounts and add a Bursar with custom password
    const listRes = await request(app)
      .get(`/api/dev/tenants/${newTenantId}/users`)
      .set('Authorization', `Bearer ${devToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.users).toHaveLength(1);

    const addBursar = await request(app)
      .post(`/api/dev/tenants/${newTenantId}/users`)
      .set('Authorization', `Bearer ${devToken}`)
      .send({
        fullName: 'Bursar Rift',
        email: 'bursar@riftvalley.ac.ke',
        role: 'Bursar',
        password: 'BursarRift2026!',
      });
    expect(addBursar.status).toBe(201);
    expect(addBursar.body.oneTimePassword).toBe('BursarRift2026!');

    // Reset Bursar password to a new custom password and verify old password no longer works
    const resetRes = await request(app)
      .post(`/api/dev/tenants/${newTenantId}/users/${addBursar.body.user.id}/reset-password`)
      .set('Authorization', `Bearer ${devToken}`)
      .send({ newPassword: 'NewBursarPass2026!' });
    expect(resetRes.status).toBe(200);
    expect(resetRes.body.oneTimePassword).toBe('NewBursarPass2026!');

    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'bursar@riftvalley.ac.ke', password: 'BursarRift2026!' });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'bursar@riftvalley.ac.ke', password: 'NewBursarPass2026!' });
    expect(newLogin.status).toBe(200);

    // Disable & re-enable account
    const disableRes = await request(app)
      .patch(`/api/dev/tenants/${newTenantId}/users/${addBursar.body.user.id}/status`)
      .set('Authorization', `Bearer ${devToken}`)
      .send({ status: 'Disabled' });
    expect(disableRes.status).toBe(200);
    expect(disableRes.body.user.status).toBe('Disabled');

    const disabledLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'bursar@riftvalley.ac.ke', password: 'NewBursarPass2026!' });
    expect(disabledLogin.status).toBe(403);
  });

  it('supports creating custom roles, customizing built-in roles, and provisioning staff with custom roles', async () => {
    const onboard = await request(app)
      .post('/api/dev/tenants')
      .set('Authorization', `Bearer ${devToken}`)
      .send({
        name: 'Savanna View Academy',
        emailDomain: 'savannaview.ac.ke',
        adminFullName: 'Grace Achieng',
        adminEmail: 'grace.achieng@savannaview.ac.ke',
        adminPassword: 'SavannaAdmin2026!',
      });
    expect(onboard.status).toBe(201);
    const tenantId = onboard.body.tenant.id;

    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'grace.achieng@savannaview.ac.ke', password: 'SavannaAdmin2026!' });
    expect(adminLogin.status).toBe(200);
    const adminToken = adminLogin.body.token;

    // 1. Create a custom role
    const createRole = await request(app)
      .post('/api/auth/roles/custom')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        name: 'Deputy Principal',
        baseRole: 'Teacher',
        defaultModules: ['analytics', 'attendance', 'timetable', 'exams'],
        description: 'Academic & discipline supervision',
      });
    expect(createRole.status).toBe(201);
    const customRoleId = createRole.body.customRole.id;
    expect(createRole.body.customRole.name).toBe('Deputy Principal');

    // 2. Provision a staff user assigned to the custom role
    const createStaff = await request(app)
      .post('/api/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        fullName: 'Peter Kamau',
        email: 'peter.kamau@savannaview.ac.ke',
        role: 'Teacher',
        customRoleId,
      });
    expect(createStaff.status).toBe(201);
    expect(createStaff.body.user.role).toBe('Teacher');
    expect(createStaff.body.user.customRoleId).toBe(customRoleId);
    expect(createStaff.body.user.roleLabel).toBe('Deputy Principal');
    expect(createStaff.body.user.allowedModules).toEqual([
      'analytics',
      'attendance',
      'timetable',
      'exams',
    ]);

    // 3. Cannot delete an in-use custom role
    const deleteBlocked = await request(app)
      .delete(`/api/auth/roles/custom/${customRoleId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-tenant-id', tenantId);
    expect(deleteBlocked.status).toBe(409);

    // 4. Update custom role & sync to existing users
    const updateRole = await request(app)
      .post('/api/auth/roles/custom')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        id: customRoleId,
        name: 'Senior Deputy Principal',
        baseRole: 'Teacher',
        defaultModules: ['analytics', 'attendance', 'timetable', 'exams', 'admissions'],
        syncExistingUsers: true,
      });
    expect(updateRole.status).toBe(200);
    expect(updateRole.body.updatedUsersCount).toBe(1);

    const listUsers = await request(app)
      .get('/api/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-tenant-id', tenantId);
    expect(listUsers.status).toBe(200);
    const peter = listUsers.body.users.find((u: { email: string }) => u.email === 'peter.kamau@savannaview.ac.ke');
    expect(peter.roleLabel).toBe('Senior Deputy Principal');
    expect(peter.allowedModules).toContain('admissions');

    // 5. Customize built-in Bursar role & keep settings locked on Admin
    const customizeBursar = await request(app)
      .put('/api/auth/roles/builtin/Bursar')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        defaultModules: ['analytics', 'fees', 'communications', 'admissions'],
      });
    expect(customizeBursar.status).toBe(200);
    expect(customizeBursar.body.tenant.roleModuleOverrides.Bursar).toContain('admissions');

    const customizeAdmin = await request(app)
      .put('/api/auth/roles/builtin/Admin')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        defaultModules: ['analytics'],
      });
    expect(customizeAdmin.status).toBe(200);
    expect(customizeAdmin.body.tenant.roleModuleOverrides.Admin).toContain('settings');

    // 6. Create & delete an unused custom role
    const tempRole = await request(app)
      .post('/api/auth/roles/custom')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        name: 'Temporary Coordinator',
        baseRole: 'Registrar',
        defaultModules: ['analytics', 'admissions'],
      });
    expect(tempRole.status).toBe(201);

    const deleteTemp = await request(app)
      .delete(`/api/auth/roles/custom/${tempRole.body.customRole.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-tenant-id', tenantId);
    expect(deleteTemp.status).toBe(200);
  });
});
