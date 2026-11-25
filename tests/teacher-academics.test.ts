import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, store } from '../server';
import { ST_RAPHAEL_DEFAULT_PASSWORDS, ST_RAPHAEL_TENANT_ID } from '../server/seedStRaphael';

describe('Teacher Academics: Schemes of Work, Lesson Plans, Submission Tracking & Parent Visibility', () => {
  let oakridgeTenantId = '';

  let oakAdminToken = '';
  let oakTeacherToken = '';
  let oakPeerTeacherToken = '';
  let oakBursarToken = '';
  let oakRegistrarToken = '';
  let oakParentToken = '';

  beforeAll(async () => {
    await store.ensureInitialized();
  });

  beforeEach(async () => {
    const { devCredentials } = await store.resetForTests({ empty: false });
    const tenants = store.listTenants();
    const oakridge = tenants.find((t) => t.id === 'tenant-oakridge')!;
    oakridgeTenantId = oakridge.id;

    const loginSeeded = async (email: string, password: string, nextPermanentPass?: string) => {
      const loginRes = await request(app).post('/api/auth/login').send({ email, password });
      expect(loginRes.status).toBe(200);
      if (loginRes.body.user.mustChangePassword) {
        const chg = await request(app)
          .post('/api/auth/change-password')
          .set('Authorization', `Bearer ${loginRes.body.token}`)
          .send({
            currentPassword: password,
            newPassword: nextPermanentPass || 'OakridgeStrong2026!',
          });
        expect(chg.status).toBe(200);
        return chg.body.token as string;
      }
      return loginRes.body.token as string;
    };

    const findCred = (email: string) => devCredentials.find((c) => c.email === email)!;

    const adminCred = findCred('helena.vance@oakridge.ac.ke');
    oakAdminToken = await loginSeeded(adminCred.email, adminCred.password, 'OakAdminPass2026!');

    const teacherCred = findCred('kamau.njoroge@oakridge.ac.ke');
    oakTeacherToken = await loginSeeded(teacherCred.email, teacherCred.password, 'OakTeacherPass2026!');

    const bursarCred = findCred('mary.wanjiru@oakridge.ac.ke');
    oakBursarToken = await loginSeeded(bursarCred.email, bursarCred.password, 'OakBursarPass2026!');

    const registrarCred = findCred('grace.admissions@oakridge.ac.ke');
    oakRegistrarToken = await loginSeeded(
      registrarCred.email,
      registrarCred.password,
      'OakRegistrarPass2026!'
    );

    // Create a second Teacher user matching t-oak-2 (Mrs. Achieng Odhiambo) to test cross-teacher isolation
    const peerRes = await request(app)
      .post('/api/auth/users')
      .set('Authorization', `Bearer ${oakAdminToken}`)
      .send({
        fullName: 'Achieng Odhiambo',
        email: 'a.odhiambo@oakridge.ac.ke',
        role: 'Teacher',
        phone: '+254712349901',
      });
    expect(peerRes.status).toBe(201);
    oakPeerTeacherToken = await loginSeeded(
      peerRes.body.user.email,
      peerRes.body.oneTimePassword,
      'OakPeerTeach2026!'
    );

    // Enroll a Grade 9 A learner & register Parent account
    const childEnroll = await request(app)
      .post('/api/students/enroll')
      .set('Authorization', `Bearer ${oakAdminToken}`)
      .send({
        fullName: 'Brian Kamau',
        dateOfBirth: '2012-04-11',
        gender: 'Male',
        grade: 'Grade 9',
        section: 'A',
        guardianName: 'Esther Kamau',
        guardianPhone: '0722111888',
      });
    expect(childEnroll.status).toBe(201);

    const parentReg = await request(app).post('/api/auth/register').send({
      tenantId: oakridgeTenantId,
      fullName: 'Esther Kamau',
      email: 'esther.kamau@oakridge.ac.ke',
      password: 'OakParentPass2026!',
      phone: '+254722111888',
      studentCode: childEnroll.body.student.studentCode,
      guardianPhone: '0722111888',
    });
    expect(parentReg.status).toBe(201);
    oakParentToken = parentReg.body.token;
  });

  it('enforces RBAC, cohort ownership, and forbids teacher self-approval or cross-teacher edits', async () => {
    // Bursar, Registrar (read-only), and Parent cannot create schemes or lesson plans
    for (const token of [oakBursarToken, oakRegistrarToken, oakParentToken]) {
      const res = await request(app)
        .post('/api/academics/schemes')
        .set('Authorization', `Bearer ${token}`)
        .send({
          grade: 'Grade 9',
          section: 'A',
          subject: 'Mathematics',
          weeksCount: 4,
          autoFillWeeks: true,
        });
      expect(res.status).toBe(403);
    }

    // Teacher (Mr. Kamau, t-oak-1) cannot create a scheme for a subject they are not assigned to teach (e.g. Integrated Science)
    const unassignedRes = await request(app)
      .post('/api/academics/schemes')
      .set('Authorization', `Bearer ${oakTeacherToken}`)
      .send({
        grade: 'Grade 9',
        section: 'A',
        subject: 'Integrated Science',
        weeksCount: 4,
        autoFillWeeks: true,
      });
    expect(unassignedRes.status).toBe(403);

    // Teacher creates a scheme for their assigned cohort (Grade 9 A Mathematics)
    const createRes = await request(app)
      .post('/api/academics/schemes')
      .set('Authorization', `Bearer ${oakTeacherToken}`)
      .send({
        grade: 'Grade 9',
        section: 'A',
        subject: 'Mathematics',
        title: 'Grade 9 A Mathematics — Term 1 Custom Scheme',
        weeksCount: 6,
        autoFillWeeks: true,
        parentSummary: 'Term coverage on Algebra, Trigonometry, and Consumer Arithmetic.',
      });
    expect(createRes.status).toBe(201);
    const schemeId = createRes.body.scheme.id;
    expect(createRes.body.scheme.status).toBe('Draft');
    expect(createRes.body.scheme.weeks).toHaveLength(6);

    // Peer teacher cannot edit, submit, toggle visibility, or delete Mr. Kamau's scheme
    const peerEdit = await request(app)
      .put(`/api/academics/schemes/${schemeId}`)
      .set('Authorization', `Bearer ${oakPeerTeacherToken}`)
      .send({
        grade: 'Grade 9',
        section: 'A',
        subject: 'Mathematics',
        title: 'Tampered Scheme',
        weeks: createRes.body.scheme.weeks,
      });
    expect(peerEdit.status).toBe(403);

    const peerDelete = await request(app)
      .delete(`/api/academics/schemes/${schemeId}`)
      .set('Authorization', `Bearer ${oakPeerTeacherToken}`);
    expect(peerDelete.status).toBe(403);

    // Teacher submits their own scheme
    const submitRes = await request(app)
      .post(`/api/academics/schemes/${schemeId}/submit`)
      .set('Authorization', `Bearer ${oakTeacherToken}`);
    expect(submitRes.status).toBe(200);
    expect(submitRes.body.scheme.status).toBe('Submitted');

    // Teacher cannot self-approve via review endpoint
    const selfApproveRes = await request(app)
      .post(`/api/academics/schemes/${schemeId}/review`)
      .set('Authorization', `Bearer ${oakTeacherToken}`)
      .send({ decision: 'Approved', parentVisible: true });
    expect(selfApproveRes.status).toBe(403);
  });

  it('enforces approval-gated parent visibility, strips internal fields, and resets status when an Approved scheme is edited', async () => {
    // 1. Teacher creates a scheme with parentVisible: true AND submits it immediately
    const createSchemeRes = await request(app)
      .post('/api/academics/schemes')
      .set('Authorization', `Bearer ${oakTeacherToken}`)
      .send({
        grade: 'Grade 9',
        section: 'A',
        subject: 'Mathematics',
        title: 'Grade 9 A Math — Parent Gate Test',
        parentSummary: 'Algebra and Measurement roadmap for Grade 9 learners.',
        weeksCount: 5,
        autoFillWeeks: true,
        parentVisible: true,
        submitNow: true,
      });
    expect(createSchemeRes.status).toBe(201);
    const schemeId = createSchemeRes.body.scheme.id;
    // Server must keep parentVisible false while pending Admin approval
    expect(createSchemeRes.body.scheme.status).toBe('Submitted');
    expect(createSchemeRes.body.scheme.parentVisible).toBe(false);

    // Teacher creates a Lesson Plan with internal reflection and homework, and submits
    const createLpRes = await request(app)
      .post('/api/academics/lesson-plans')
      .set('Authorization', `Bearer ${oakTeacherToken}`)
      .send({
        schemeOfWorkId: schemeId,
        grade: 'Grade 9',
        section: 'A',
        subject: 'Mathematics',
        weekNumber: 8,
        lessonDate: '2026-11-18',
        periodNumber: 2,
        durationMinutes: 40,
        strand: 'Algebra',
        subStrand: 'Simultaneous Linear Equations',
        lessonTitle: 'Solving Simultaneous Equations by Elimination',
        learningOutcomes: 'Solve 2-variable linear systems using elimination.',
        learningResources: 'KICD Grade 9 Book, algebra cards',
        introductionActivity: '5 min recap on balancing equations.',
        lessonDevelopment: '25 min worked examples and paired practice.',
        conclusionActivity: '10 min plenary check.',
        extendedHomework: 'Complete Exercise 4B numbers 1 to 6.',
        teacherReflection: 'INTERNAL NOTE: Two learners need remedial coaching on sign flips.',
        parentVisible: true,
        submitNow: true,
      });
    expect(createLpRes.status).toBe(201);
    const lpId = createLpRes.body.lessonPlan.id;
    expect(createLpRes.body.lessonPlan.status).toBe('Submitted');
    expect(createLpRes.body.lessonPlan.parentVisible).toBe(false);

    // 2. While Submitted (not Approved), Parent workspace must NOT see these unapproved docs
    const parentWsBefore = await request(app)
      .get('/api/workspace')
      .set('Authorization', `Bearer ${oakParentToken}`)
      .set('x-tenant-id', oakridgeTenantId);
    expect(parentWsBefore.status).toBe(200);
    expect(parentWsBefore.body.schemesOfWork.some((s: any) => s.id === schemeId)).toBe(false);
    expect(parentWsBefore.body.lessonPlans.some((l: any) => l.id === lpId)).toBe(false);

    // 3. Admin requests revision with internal feedback -> still hidden from Parent
    const revRes = await request(app)
      .post(`/api/academics/schemes/${schemeId}/review`)
      .set('Authorization', `Bearer ${oakAdminToken}`)
      .send({
        decision: 'Revision Requested',
        reviewFeedback: 'Please add Week 5 assessment rubric details.',
      });
    expect(revRes.status).toBe(200);
    expect(revRes.body.scheme.status).toBe('Revision Requested');
    expect(revRes.body.scheme.parentVisible).toBe(false);

    // 4. Admin approves Scheme with parentVisible: false -> still hidden from Parent
    const approveHiddenRes = await request(app)
      .post(`/api/academics/schemes/${schemeId}/review`)
      .set('Authorization', `Bearer ${oakAdminToken}`)
      .send({
        decision: 'Approved',
        reviewFeedback: 'Well aligned to KICD strand outcomes.',
        parentVisible: false,
      });
    expect(approveHiddenRes.status).toBe(200);
    expect(approveHiddenRes.body.scheme.status).toBe('Approved');
    expect(approveHiddenRes.body.scheme.parentVisible).toBe(false);

    const parentWsStillHidden = await request(app)
      .get('/api/workspace')
      .set('Authorization', `Bearer ${oakParentToken}`)
      .set('x-tenant-id', oakridgeTenantId);
    expect(parentWsStillHidden.body.schemesOfWork.some((s: any) => s.id === schemeId)).toBe(false);

    // 5. Teacher toggles Parent Visibility ON for the Approved scheme & Admin approves LP with parentVisible: true
    const toggleVisRes = await request(app)
      .patch(`/api/academics/schemes/${schemeId}/parent-visibility`)
      .set('Authorization', `Bearer ${oakTeacherToken}`)
      .send({ parentVisible: true });
    expect(toggleVisRes.status).toBe(200);
    expect(toggleVisRes.body.scheme.parentVisible).toBe(true);

    const approveLpRes = await request(app)
      .post(`/api/academics/lesson-plans/${lpId}/review`)
      .set('Authorization', `Bearer ${oakAdminToken}`)
      .send({
        decision: 'Approved',
        reviewFeedback: 'Clear lesson pacing; ready for class & parents.',
        parentVisible: true,
      });
    expect(approveLpRes.status).toBe(200);

    // 6. Parent workspace now sees BOTH approved & parent-visible documents, with internal fields stripped
    const parentWsVisible = await request(app)
      .get('/api/workspace')
      .set('Authorization', `Bearer ${oakParentToken}`)
      .set('x-tenant-id', oakridgeTenantId);
    expect(parentWsVisible.status).toBe(200);

    const visibleScheme = parentWsVisible.body.schemesOfWork.find((s: any) => s.id === schemeId);
    expect(visibleScheme).toBeDefined();
    expect(visibleScheme.reviewFeedback).toBeUndefined();
    expect(visibleScheme.reviewedByUserId).toBeUndefined();
    expect(visibleScheme.createdByUserId).toBeUndefined();

    const visibleLp = parentWsVisible.body.lessonPlans.find((l: any) => l.id === lpId);
    expect(visibleLp).toBeDefined();
    expect(visibleLp.extendedHomework).toBe('Complete Exercise 4B numbers 1 to 6.');
    expect(visibleLp.teacherReflection).toBeUndefined();
    expect(visibleLp.reviewFeedback).toBeUndefined();
    expect(visibleLp.reviewedByUserId).toBeUndefined();

    // 7. Re-approval invariant: Teacher editing an Approved scheme resets status to Draft and clears parentVisible
    const teacherEditRes = await request(app)
      .put(`/api/academics/schemes/${schemeId}`)
      .set('Authorization', `Bearer ${oakTeacherToken}`)
      .send({
        grade: 'Grade 9',
        section: 'A',
        subject: 'Mathematics',
        title: 'Grade 9 A Math — Updated Post-Approval',
        weeks: visibleScheme.weeks,
        parentVisible: true,
      });
    expect(teacherEditRes.status).toBe(200);
    expect(teacherEditRes.body.scheme.status).toBe('Draft');
    expect(teacherEditRes.body.scheme.parentVisible).toBe(false);

    const parentWsAfterEdit = await request(app)
      .get('/api/workspace')
      .set('Authorization', `Bearer ${oakParentToken}`)
      .set('x-tenant-id', oakridgeTenantId);
    expect(parentWsAfterEdit.body.schemesOfWork.some((s: any) => s.id === schemeId)).toBe(false);
  });

  it('updates submission deadlines, dispatches submission reminders, and scopes St. Raphael parent curriculum view', async () => {
    // Admin updates academic submission config
    const cfgRes = await request(app)
      .put('/api/academics/submission-config')
      .set('Authorization', `Bearer ${oakAdminToken}`)
      .send({
        schemeDueDate: '2026-09-14',
        lessonPlanLeadDays: 2,
        lessonPlanCadence: 'Weekly',
        currentWeekNumber: 9,
        requireApprovalForParentVisibility: true,
      });
    expect(cfgRes.status).toBe(200);
    expect(cfgRes.body.config.currentWeekNumber).toBe(9);
    expect(cfgRes.body.config.schemeDueDate).toBe('2026-09-14');

    // Admin dispatches submission reminder notification
    const remRes = await request(app)
      .post('/api/academics/submission-reminders')
      .set('Authorization', `Bearer ${oakAdminToken}`)
      .send({ targetLabel: 'All Junior School Staff' });
    expect(remRes.status).toBe(200);
    expect(remRes.body.ok).toBe(true);
    expect(remRes.body.notification.category).toBe('academics');
    expect(remRes.body.notification.targetModule).toBe('academics');

    // Verify seeded St. Raphael Parent account (Mary Kamau) sees only Approved+ParentVisible schemes/plans for her children
    await store.resetForTests({ empty: false, includeLargeTenants: true });
    const stRaphaelTenantId = ST_RAPHAEL_TENANT_ID;
    const stRaphParentPass = ST_RAPHAEL_DEFAULT_PASSWORDS['parent.kamau@straphael.ac.ke'];
    const parentLogin = await request(app).post('/api/auth/login').send({
      email: 'parent.kamau@straphael.ac.ke',
      password: stRaphParentPass,
    });
    expect(parentLogin.status).toBe(200);
    expect(parentLogin.body.user.role).toBe('Parent');
    expect(parentLogin.body.user.moduleAccess.academics).toBe('read');

    let stRaphParentToken = parentLogin.body.token as string;
    if (parentLogin.body.user.mustChangePassword) {
      const chg = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${stRaphParentToken}`)
        .send({ currentPassword: stRaphParentPass, newPassword: 'StRaphaelParentNew2026!' });
      expect(chg.status).toBe(200);
      stRaphParentToken = chg.body.token as string;
    }

    const stRaphWs = await request(app)
      .get('/api/workspace')
      .set('Authorization', `Bearer ${stRaphParentToken}`)
      .set('x-tenant-id', stRaphaelTenantId);
    expect(stRaphWs.status).toBe(200);
    expect(stRaphWs.body.students.length).toBeGreaterThanOrEqual(2);
    expect(stRaphWs.body.schemesOfWork.length).toBeGreaterThan(0);
    for (const s of stRaphWs.body.schemesOfWork) {
      expect(s.status).toBe('Approved');
      expect(s.parentVisible).toBe(true);
      expect(s.reviewFeedback).toBeUndefined();
    }
    for (const lp of stRaphWs.body.lessonPlans) {
      expect(lp.status).toBe('Approved');
      expect(lp.parentVisible).toBe(true);
      expect(lp.teacherReflection).toBeUndefined();
    }
  });
});
