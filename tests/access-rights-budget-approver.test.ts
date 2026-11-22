import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, store } from '../server';

describe('Per-Module Read/Edit Access Rights, Custom Budget Creation & Budget Approver Role', () => {
  let devToken = '';
  let tenantId = '';
  let adminToken = '';

  async function loginAndRotate(email: string, tempPassword: string, newPassword: string) {
    const login = await request(app).post('/api/auth/login').send({ email, password: tempPassword });
    expect(login.status).toBe(200);
    if (login.body.user?.mustChangePassword) {
      const rot = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${login.body.token}`)
        .send({ currentPassword: tempPassword, newPassword });
      expect(rot.status).toBe(200);
      return rot.body.token as string;
    }
    return login.body.token as string;
  }

  beforeAll(async () => {
    await store.ensureInitialized();
  });

  beforeEach(async () => {
    const { devCredentials } = await store.resetForTests({ empty: false });
    const devCred = devCredentials.find((c) => c.role === 'Developer')!;
    devToken = await loginAndRotate(devCred.email, devCred.password, 'DevMasterPass2026!');

    const onboard = await request(app)
      .post('/api/dev/tenants')
      .set('Authorization', `Bearer ${devToken}`)
      .send({
        name: 'Highland Crest Academy',
        emailDomain: 'highlandcrest.ac.ke',
        adminFullName: 'Miriam Wanjiku',
        adminEmail: 'miriam.wanjiku@highlandcrest.ac.ke',
        adminPassword: 'HighlandAdmin2026!',
      });
    expect(onboard.status).toBe(201);
    tenantId = onboard.body.tenant.id;
    adminToken = await loginAndRotate(
      'miriam.wanjiku@highlandcrest.ac.ke',
      'HighlandAdmin2026!',
      'HighlandAdmin2026!'
    );
  });

  it('enforces Read Only vs Read & Edit per assigned module and persists built-in & custom role moduleAccess', async () => {
    // Provision Registrar with Admissions = read, Communications = edit
    const createRegistrar = await request(app)
      .post('/api/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        fullName: 'Grace Chebet',
        email: 'grace.chebet@highlandcrest.ac.ke',
        role: 'Registrar',
        moduleAccess: {
          analytics: 'read',
          admissions: 'read',
          communications: 'edit',
        },
      });
    expect(createRegistrar.status).toBe(201);
    expect(createRegistrar.body.user.moduleAccess).toEqual({
      analytics: 'read',
      admissions: 'read',
      communications: 'edit',
    });

    const registrarToken = await loginAndRotate(
      'grace.chebet@highlandcrest.ac.ke',
      createRegistrar.body.oneTimePassword,
      'RegistrarPass2026!'
    );

    // Workspace GET succeeds with read access
    const wsRes = await request(app)
      .get('/api/workspace')
      .set('Authorization', `Bearer ${registrarToken}`)
      .set('x-tenant-id', tenantId);
    expect(wsRes.status).toBe(200);

    // Admissions mutation is blocked (403) because admissions is Read Only
    const blockedAdmission = await request(app)
      .post('/api/admissions')
      .set('Authorization', `Bearer ${registrarToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        studentName: 'Test Applicant',
        dateOfBirth: '2016-05-10',
        gender: 'Female',
        targetGrade: 'Grade 4',
        assignedSection: 'A',
        guardianName: 'Parent Applicant',
        guardianEmail: 'parent.applicant@example.com',
        guardianPhone: '+254711000111',
        previousSchool: 'St Marys Primary',
        notes: 'Initial application',
      });
    expect(blockedAdmission.status).toBe(403);
    expect(blockedAdmission.body.error).toMatch(/Read-only access/i);

    // Communications mutation succeeds (201) because communications is Read & Edit
    const allowedAnnouncement = await request(app)
      .post('/api/communications/announcements')
      .set('Authorization', `Bearer ${registrarToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        title: 'Admissions Office Hours',
        body: 'Registrar desk open 8am to 4pm.',
        audience: 'All School',
        priority: 'Normal',
      });
    expect(allowedAnnouncement.status).toBe(201);

    // Update Registrar rights: promote admissions to edit, downgrade communications to read
    const updateAccess = await request(app)
      .patch(`/api/auth/users/${createRegistrar.body.user.id}/access`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        moduleAccess: {
          analytics: 'read',
          admissions: 'edit',
          communications: 'read',
        },
      });
    expect(updateAccess.status).toBe(200);
    expect(updateAccess.body.user.moduleAccess.admissions).toBe('edit');
    expect(updateAccess.body.user.moduleAccess.communications).toBe('read');

    const nowAllowedAdmission = await request(app)
      .post('/api/admissions')
      .set('Authorization', `Bearer ${registrarToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        studentName: 'Test Applicant Allowed',
        dateOfBirth: '2016-06-12',
        gender: 'Male',
        targetGrade: 'Grade 4',
        assignedSection: 'A',
        guardianName: 'Parent Applicant',
        guardianEmail: 'parent.allowed@example.com',
        guardianPhone: '+254711000112',
        previousSchool: 'St Marys Primary',
        notes: 'Approved test application',
      });
    expect(nowAllowedAdmission.status).toBe(201);

    const nowBlockedAnnouncement = await request(app)
      .post('/api/communications/announcements')
      .set('Authorization', `Bearer ${registrarToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        title: 'Should Be Blocked',
        body: 'Cannot post with read-only access.',
        audience: 'All School',
        priority: 'Normal',
      });
    expect(nowBlockedAnnouncement.status).toBe(403);

    // Built-in role template customization preserves defaultModuleAccess (read vs edit)
    const customizeTeacher = await request(app)
      .put('/api/auth/roles/builtin/Teacher')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        defaultModuleAccess: {
          analytics: 'read',
          timetable: 'read',
          attendance: 'edit',
          exams: 'read',
          communications: 'read',
        },
      });
    expect(customizeTeacher.status).toBe(200);
    expect(customizeTeacher.body.tenant.roleModuleAccessOverrides.Teacher).toEqual({
      analytics: 'read',
      timetable: 'read',
      attendance: 'edit',
      exams: 'read',
      communications: 'read',
    });

    // Provision a new Teacher inheriting the customized built-in template
    const newTeacher = await request(app)
      .post('/api/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        fullName: 'Samuel Kiprop',
        email: 'samuel.kiprop@highlandcrest.ac.ke',
        role: 'Teacher',
      });
    expect(newTeacher.status).toBe(201);
    expect(newTeacher.body.user.moduleAccess).toEqual({
      analytics: 'read',
      timetable: 'read',
      attendance: 'edit',
      exams: 'read',
      communications: 'read',
    });

    // Custom role preserves per-module Read Only vs Read & Edit defaults
    const createCustomRole = await request(app)
      .post('/api/auth/roles/custom')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        name: 'Finance Committee Reviewer',
        baseRole: 'Budget Approver',
        defaultModuleAccess: {
          analytics: 'read',
          fees: 'read',
          communications: 'edit',
        },
        description: 'Reviews financial ledgers and signs off budgets',
      });
    expect(createCustomRole.status).toBe(201);
    expect(createCustomRole.body.customRole.defaultModuleAccess).toEqual({
      analytics: 'read',
      fees: 'read',
      communications: 'edit',
    });
  });

  it('supports Budget Approver role, custom budget creation, and enforces Maker-Checker & Read-Only safeguards', async () => {
    // 1. Provision a Bursar (fees: edit) and a dedicated Budget Approver (fees: read)
    const createBursar = await request(app)
      .post('/api/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        fullName: 'Daniel Njoroge',
        email: 'daniel.njoroge@highlandcrest.ac.ke',
        role: 'Bursar',
      });
    expect(createBursar.status).toBe(201);
    const bursarToken = await loginAndRotate(
      'daniel.njoroge@highlandcrest.ac.ke',
      createBursar.body.oneTimePassword,
      'BursarPass2026!'
    );

    const createApprover = await request(app)
      .post('/api/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        fullName: 'Beatrice Otieno',
        email: 'beatrice.otieno@highlandcrest.ac.ke',
        role: 'Budget Approver',
      });
    expect(createApprover.status).toBe(201);
    expect(createApprover.body.user.role).toBe('Budget Approver');
    expect(createApprover.body.user.moduleAccess).toEqual({
      analytics: 'read',
      fees: 'read',
      communications: 'read',
    });
    const approverToken = await loginAndRotate(
      'beatrice.otieno@highlandcrest.ac.ke',
      createApprover.body.oneTimePassword,
      'ApproverPass2026!'
    );

    // 2. Bursar creates a custom budget line ("Science Lab Equipment Upgrade")
    const createBudget = await request(app)
      .post('/api/finance/budgets')
      .set('Authorization', `Bearer ${bursarToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        category: 'Science Lab Equipment Upgrade',
        fiscalYear: '2026–2027',
        term: 'Term 1',
        allocatedAmount: 450000,
        notes: 'STEM lab microscopes and glassware',
      });
    expect(createBudget.status).toBe(200);
    expect(createBudget.body.budget.category).toBe('Science Lab Equipment Upgrade');
    expect(createBudget.body.budget.status).toBe('Pending Approval');
    const budgetId = createBudget.body.budget.id;

    // 3. Maker-Checker blocks the Bursar from approving their own budget
    const selfApprove = await request(app)
      .patch('/api/finance/budgets/approval')
      .set('Authorization', `Bearer ${bursarToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        budgetId,
        category: 'Science Lab Equipment Upgrade',
        fiscalYear: '2026–2027',
        term: 'Term 1',
        status: 'Approved',
      });
    expect(selfApprove.status).toBe(403);
    expect(selfApprove.body.error).toMatch(/Maker-checker violation/i);

    // 4. Budget Approver cannot create budgets or record expenses (read-only on finance mutations)
    const approverCreateBlocked = await request(app)
      .post('/api/finance/budgets')
      .set('Authorization', `Bearer ${approverToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        category: 'Sports Gear',
        allocatedAmount: 100000,
      });
    expect(approverCreateBlocked.status).toBe(403);

    const approverExpenseBlocked = await request(app)
      .post('/api/finance/expenses')
      .set('Authorization', `Bearer ${approverToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        title: 'Unauthorized expense',
        category: 'Utilities & Bills',
        vendor: 'Kenya Power',
        amount: 5000,
        paymentMethod: 'Bank Transfer',
      });
    expect(approverExpenseBlocked.status).toBe(403);

    // 5. Budget Approver CAN approve the pending custom budget
    const approveRes = await request(app)
      .patch('/api/finance/budgets/approval')
      .set('Authorization', `Bearer ${approverToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        budgetId,
        category: 'Science Lab Equipment Upgrade',
        fiscalYear: '2026–2027',
        term: 'Term 1',
        status: 'Approved',
        approvedBy: 'Budget Approver Office',
        approvalNotes: 'Approved under MIN/FIN/2026-04',
      });
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.budget.status).toBe('Approved');
    expect(approveRes.body.budget.approvedBy).toBe('Beatrice Otieno');
    expect(approveRes.body.budget.approvalNotes).toBe('Approved under MIN/FIN/2026-04');

    // 6. A Read-Only Bursar (non-Budget Approver with fees: read) CANNOT approve budgets
    const readOnlyBursar = await request(app)
      .post('/api/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        fullName: 'Audit Assistant Bursar',
        email: 'audit.bursar@highlandcrest.ac.ke',
        role: 'Bursar',
        moduleAccess: {
          analytics: 'read',
          fees: 'read',
          communications: 'read',
        },
      });
    expect(readOnlyBursar.status).toBe(201);
    const readOnlyBursarToken = await loginAndRotate(
      'audit.bursar@highlandcrest.ac.ke',
      readOnlyBursar.body.oneTimePassword,
      'ReadOnlyBursar2026!'
    );

    const readOnlyApproveBlocked = await request(app)
      .patch('/api/finance/budgets/approval')
      .set('Authorization', `Bearer ${readOnlyBursarToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        budgetId,
        status: 'Rejected',
      });
    expect(readOnlyApproveBlocked.status).toBe(403);
    expect(readOnlyApproveBlocked.body.error).toMatch(/Read-only access/i);
  });
});
