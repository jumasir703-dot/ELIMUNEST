import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, store } from '../server';

describe('Phase 6: Granular Module Access (Read Only vs Read & Edit), Budget Approver & Custom Budgets', () => {
  let tenantId = '';
  let domain = '';
  let adminToken = '';
  let bursarToken = '';

  const activate = async (email: string, tempPass: string, permPass: string) => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email, password: tempPass });
    expect(login.status).toBe(200);
    if (!login.body.user.mustChangePassword) return login.body.token as string;
    const chg = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ currentPassword: tempPass, newPassword: permPass });
    expect(chg.status).toBe(200);
    return chg.body.token as string;
  };

  beforeAll(async () => {
    await store.ensureInitialized();
  });

  beforeEach(async () => {
    const { devCredentials } = await store.resetForTests({ empty: false });
    const tenant = store.listTenants()[0];
    tenantId = tenant.id;
    domain = tenant.emailDomain || 'oakridge.ac.ke';

    const adminCred = devCredentials.find((c) => c.role === 'Admin')!;
    adminToken = await activate(adminCred.email, adminCred.password, 'AdminPhase6!');

    const bursarRes = await request(app)
      .post('/api/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Bursar Maker',
        email: `bursar.p6@${domain}`,
        role: 'Bursar',
        phone: '+254712000601',
      });
    expect(bursarRes.status).toBe(201);
    bursarToken = await activate(
      bursarRes.body.user.email,
      bursarRes.body.oneTimePassword,
      'BursarPhase6!'
    );
  });

  it('enforces Read Only vs Read & Edit per module on staff accounts and custom roles', async () => {
    // Provision a Registrar with Admissions = Read Only, Communications = Read & Edit
    const regCreate = await request(app)
      .post('/api/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'ReadOnly Registrar',
        email: `ro.reg@${domain}`,
        role: 'Registrar',
        moduleAccess: {
          analytics: 'read',
          admissions: 'read',
          communications: 'edit',
        },
      });
    expect(regCreate.status).toBe(201);
    expect(regCreate.body.user.moduleAccess).toEqual({
      analytics: 'read',
      admissions: 'read',
      communications: 'edit',
    });

    const regToken = await activate(
      regCreate.body.user.email,
      regCreate.body.oneTimePassword,
      'RegReadOnly2026!'
    );

    // Can read workspace (includes students because admissions is read)
    const wsRes = await request(app)
      .get('/api/workspace')
      .set('Authorization', `Bearer ${regToken}`)
      .set('x-tenant-id', tenantId);
    expect(wsRes.status).toBe(200);
    expect(wsRes.body.students.length).toBeGreaterThan(0);

    // Blocked from mutating Admissions (Read Only -> 403)
    const enrolBlocked = await request(app)
      .post('/api/students/enroll')
      .set('Authorization', `Bearer ${regToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        fullName: 'Blocked Learner',
        studentCode: 'BLK-001',
        upi: 'UPI-BLK-001',
        dateOfBirth: '2014-03-10',
        gender: 'Female',
        grade: 'Grade 4',
        section: 'A',
        guardianName: 'Guardian One',
        guardianPhone: '+254712000699',
        enrolledAt: '2026-09-01',
      });
    expect(enrolBlocked.status).toBe(403);
    expect(String(enrolBlocked.body.error || '')).toMatch(/read-only/i);

    // Allowed to mutate Communications (Read & Edit -> 201)
    const annAllowed = await request(app)
      .post('/api/communications/announcements')
      .set('Authorization', `Bearer ${regToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        title: 'Admissions Open Day',
        body: 'Welcome parents this Friday.',
        audience: 'All School',
        priority: 'Normal',
      });
    expect(annAllowed.status).toBe(201);

    // Upgrade Admissions to Read & Edit via custom role & sync existing user
    const customRoleRes = await request(app)
      .post('/api/auth/roles/custom')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Admissions Editor',
        baseRole: 'Registrar',
        defaultModules: ['analytics', 'admissions', 'communications'],
        defaultModuleAccess: {
          analytics: 'read',
          admissions: 'edit',
          communications: 'read',
        },
        syncExistingUsers: false,
      });
    expect(customRoleRes.status).toBe(201);
    const customRoleId = customRoleRes.body.customRole.id;

    const patchRes = await request(app)
      .patch(`/api/auth/users/${regCreate.body.user.id}/access`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        role: 'Registrar',
        customRoleId,
        moduleAccess: {
          analytics: 'read',
          admissions: 'edit',
          communications: 'read',
        },
      });
    expect(patchRes.status).toBe(200);

    // Now Admissions write succeeds (201) and Communications write is blocked (403)
    const enrolAllowed = await request(app)
      .post('/api/students/enroll')
      .set('Authorization', `Bearer ${regToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        fullName: 'Permitted Learner',
        studentCode: 'PRM-001',
        upi: 'UPI-PRM-001',
        dateOfBirth: '2014-03-10',
        gender: 'Female',
        grade: 'Grade 4',
        section: 'A',
        guardianName: 'Guardian Two',
        guardianPhone: '+254712000698',
        enrolledAt: '2026-09-01',
      });
    expect(enrolAllowed.status).toBe(201);

    const annBlocked = await request(app)
      .post('/api/communications/announcements')
      .set('Authorization', `Bearer ${regToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        title: 'Blocked Notice',
        body: 'Should fail read-only',
        audience: 'All School',
        priority: 'Normal',
      });
    expect(annBlocked.status).toBe(403);
  });

  it('supports creating custom departmental budgets and signing them off via Budget Approver role', async () => {
    // 1. Provision a dedicated Budget Approver user
    const approverCreate = await request(app)
      .post('/api/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'BOM Finance Chair',
        email: `approver.p6@${domain}`,
        role: 'Budget Approver',
        phone: '+254712000602',
      });
    expect(approverCreate.status).toBe(201);
    expect(approverCreate.body.user.role).toBe('Budget Approver');
    expect(approverCreate.body.user.moduleAccess?.fees).toBe('read');

    const approverToken = await activate(
      approverCreate.body.user.email,
      approverCreate.body.oneTimePassword,
      'ApproverPhase6!'
    );

    // 2. Bursar creates a brand-new custom departmental budget for Term 3
    const createBudget = await request(app)
      .post('/api/finance/budgets')
      .set('Authorization', `Bearer ${bursarToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        category: 'Robotics & STEM Club',
        allocatedAmount: 275000,
        fiscalYear: '2026–2027',
        term: 'Term 1',
        notes: 'National science fair & Arduino kits',
      });
    expect(createBudget.status).toBe(200);
    expect(createBudget.body.budget.category).toBe('Robotics & STEM Club');
    expect(createBudget.body.budget.status).toBe('Pending Approval');
    const budgetId = createBudget.body.budget.id;

    // 3. Budget Approver can read Finance workspace
    const approverWs = await request(app)
      .get('/api/workspace')
      .set('Authorization', `Bearer ${approverToken}`)
      .set('x-tenant-id', tenantId);
    expect(approverWs.status).toBe(200);
    expect(
      approverWs.body.budgets.some((b: { id: string }) => b.id === budgetId)
    ).toBe(true);

    // 4. Budget Approver CANNOT create budgets, create expenses, or create invoices
    const blockedBudgetCreate = await request(app)
      .post('/api/finance/budgets')
      .set('Authorization', `Bearer ${approverToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        category: 'Unauthorized Line',
        allocatedAmount: 50000,
      });
    expect(blockedBudgetCreate.status).toBe(403);

    const blockedExpense = await request(app)
      .post('/api/finance/expenses')
      .set('Authorization', `Bearer ${approverToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        title: 'Blocked Voucher',
        category: 'Utilities & Bills',
        vendor: 'Kenya Power',
        amount: 12000,
        paymentMethod: 'Bank Transfer',
        reference: 'BLK-REF',
        expenseDate: '2026-11-20',
      });
    expect(blockedExpense.status).toBe(403);

    // 5. Maker-Checker: Bursar who created the budget CANNOT approve their own budget
    const selfApprove = await request(app)
      .patch('/api/finance/budgets/approval')
      .set('Authorization', `Bearer ${bursarToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        budgetId,
        status: 'Approved',
      });
    expect(selfApprove.status).toBe(403);

    // 6. Budget Approver CAN approve the budget line
    const approved = await request(app)
      .patch('/api/finance/budgets/approval')
      .set('Authorization', `Bearer ${approverToken}`)
      .set('x-tenant-id', tenantId)
      .send({
        budgetId,
        status: 'Approved',
        approvalNotes: 'Cleared by BOM Finance Committee MIN/07',
      });
    expect(approved.status).toBe(200);
    expect(approved.body.budget.status).toBe('Approved');
    expect(approved.body.budget.approvedBy).toBe('BOM Finance Chair');
  });
});
