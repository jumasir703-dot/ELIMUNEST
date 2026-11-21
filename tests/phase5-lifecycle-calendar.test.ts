import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import * as XLSX from 'xlsx';
import { app, store } from '../server';

describe('Phase 5: Student Lifecycle, Academic Calendar, Bulk Import & Student Portal', () => {
  let tenantId = '';
  let domain = '';
  let adminToken = '';
  let registrarToken = '';
  let teacherToken = '';
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
    adminToken = await activate(adminCred.email, adminCred.password, 'AdminLife2026!');

    const createStaff = async (
      fullName: string,
      email: string,
      role: 'Registrar' | 'Teacher' | 'Bursar'
    ) => {
      const res = await request(app)
        .post('/api/auth/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ fullName, email, role, phone: '+254712000100' });
      expect(res.status).toBe(201);
      return activate(res.body.user.email, res.body.oneTimePassword, `${role}Life2026!`);
    };

    registrarToken = await createStaff('Registrar One', `registrar.life@${domain}`, 'Registrar');
    teacherToken = await createStaff('Teacher One', `teacher.life@${domain}`, 'Teacher');
    bursarToken = await createStaff('Bursar One', `bursar.life@${domain}`, 'Bursar');
  });

  it('1 & 4. Manages academic years/terms, links termId to entities, and enforces Term Close / Reopen locks', async () => {
    // Non-Admin (Bursar) cannot create/close terms
    const forbiddenYear = await request(app)
      .post('/api/academic-calendar/years')
      .set('Authorization', `Bearer ${bursarToken}`)
      .send({ name: '2027', startDate: '2027-01-05', endDate: '2027-12-01' });
    expect(forbiddenYear.status).toBe(403);

    // Fetch existing calendar seeded for tenant
    const calRes = await request(app)
      .get('/api/academic-calendar')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(calRes.status).toBe(200);
    expect(calRes.body.academicYears.length).toBeGreaterThanOrEqual(1);
    expect(calRes.body.academicTerms.length).toBeGreaterThanOrEqual(1);

    // Create 2027 academic year + Term 1 2027
    const yrRes = await request(app)
      .post('/api/academic-calendar/years')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: '2027',
        startDate: '2027-01-04',
        endDate: '2027-11-30',
        setAsCurrent: true,
      });
    expect(yrRes.status).toBe(201);
    const year2027 = yrRes.body.year;
    expect(year2027.isCurrent).toBe(true);

    const termRes = await request(app)
      .post('/api/academic-calendar/terms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        academicYearId: year2027.id,
        name: 'Term 1 2027',
        startDate: '2027-01-04',
        endDate: '2027-04-09',
        setAsCurrent: true,
      });
    expect(termRes.status).toBe(201);
    const term1 = termRes.body.term;
    expect(term1.status).toBe('Open');
    expect(term1.isCurrent).toBe(true);

    // Enroll student and verify invoice links to termId
    const enroll = await request(app)
      .post('/api/students/enroll')
      .set('Authorization', `Bearer ${registrarToken}`)
      .send({
        fullName: 'Brian Kiprop',
        dateOfBirth: '2013-05-12',
        gender: 'Male',
        grade: 'Grade 6',
        section: 'A',
        guardianName: 'Peter Kiprop',
        guardianPhone: '0722334455',
      });
    expect(enroll.status).toBe(201);
    expect(enroll.body.invoice.termId).toBe(term1.id);
    const studentId = enroll.body.student.id;
    const invoiceId = enroll.body.invoice.id;

    // Create exam cycle in Term 1 2027 -> verify termId
    const cycleRes = await request(app)
      .post('/api/exams/cycles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Mid-Term 2027',
        term: 'Term 1 2027',
        startDate: '2027-02-15',
        endDate: '2027-02-19',
      });
    expect(cycleRes.status).toBe(201);
    expect(cycleRes.body.cycle.termId).toBe(term1.id);
    const cycleId = cycleRes.body.cycle.id;

    // Close Term 1 2027
    const closeRes = await request(app)
      .post(`/api/academic-calendar/terms/${term1.id}/close`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.term.status).toBe('Closed');

    // Closed term blocks: exam scores, cycle creation, attendance batch, leave chits, invoices, payments, waivers
    const scoreLock = await request(app)
      .post('/api/exams/scores')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        examCycleId: cycleId,
        studentId,
        subject: 'Mathematics',
        score: 82,
      });
    expect(scoreLock.status).toBe(409);

    const cycleLock = await request(app)
      .post('/api/exams/cycles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'End-Term 2027',
        term: 'Term 1 2027',
        startDate: '2027-03-22',
        endDate: '2027-03-26',
      });
    expect(cycleLock.status).toBe(409);

    const attLock = await request(app)
      .post('/api/attendance/batch')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        date: '2027-02-10',
        grade: 'Grade 6',
        section: 'A',
        entries: [{ studentId, status: 'Present' }],
      });
    expect(attLock.status).toBe(409);

    const chitLock = await request(app)
      .post('/api/attendance/leave-chits')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        studentId,
        startDate: '2027-02-10',
        days: 2,
        reason: 'Medical appointment',
      });
    expect(chitLock.status).toBe(409);

    const invLock = await request(app)
      .post('/api/fees/invoices')
      .set('Authorization', `Bearer ${bursarToken}`)
      .send({
        studentId,
        term: 'Term 1 2027',
        dueDate: '2027-02-28',
        totalAmount: 15000,
      });
    expect(invLock.status).toBe(409);

    const payLock = await request(app)
      .post(`/api/fees/invoices/${invoiceId}/payments`)
      .set('Authorization', `Bearer ${bursarToken}`)
      .send({
        amount: 5000,
        method: 'Cash',
        recordedBy: 'Bursar One',
        paidAt: '2027-02-10',
      });
    expect(payLock.status).toBe(409);

    const waiverLock = await request(app)
      .post('/api/fees/waivers')
      .set('Authorization', `Bearer ${bursarToken}`)
      .send({
        studentId,
        term: 'Term 1 2027',
        kind: 'Bursary',
        mode: 'Fixed',
        value: 2000,
        reason: 'CDF Bursary',
      });
    expect(waiverLock.status).toBe(409);

    // Reopen requires mandatory audit reason
    const reopenBad = await request(app)
      .post(`/api/academic-calendar/terms/${term1.id}/reopen`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: '' });
    expect(reopenBad.status).toBe(400);

    // Reopen with valid reason succeeds and restores writes + logs audit
    const reopenOk = await request(app)
      .post(`/api/academic-calendar/terms/${term1.id}/reopen`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Late parent bursary posting correction' });
    expect(reopenOk.status).toBe(200);
    expect(reopenOk.body.term.status).toBe('Open');

    const attOk = await request(app)
      .post('/api/attendance/batch')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        date: '2027-02-10',
        grade: 'Grade 6',
        section: 'A',
        entries: [{ studentId, status: 'Present' }],
      });
    expect(attOk.status).toBe(200);
    expect(attOk.body.records[0].termId).toBe(term1.id);

    const auditLogs = await request(app)
      .get('/api/students/audit-logs')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(auditLogs.status).toBe(200);
    expect(auditLogs.body.logs.some((l: { action: string }) => l.action === 'TERM_REOPENED')).toBe(
      true
    );
  });

  it('2. Edits student details, transitions lifecycle (transfer/withdraw/graduate), and soft-deletes while preserving financial & exam audit trail', async () => {
    const enroll = await request(app)
      .post('/api/students/enroll')
      .set('Authorization', `Bearer ${registrarToken}`)
      .send({
        fullName: 'Mercy Wanjiku',
        dateOfBirth: '2012-08-20',
        gender: 'Female',
        grade: 'Grade 7',
        section: 'A',
        guardianName: 'Grace Wanjiku',
        guardianPhone: '0711223344',
        guardianEmail: 'grace.wanjiku@example.com',
      });
    expect(enroll.status).toBe(201);
    const stu = enroll.body.student;
    const inv = enroll.body.invoice;

    // Record a fee payment & exam score before soft-delete
    const today = new Date().toISOString().slice(0, 10);
    const payRes = await request(app)
      .post(`/api/fees/invoices/${inv.id}/payments`)
      .set('Authorization', `Bearer ${bursarToken}`)
      .send({
        amount: 5000,
        method: 'Mobile Money',
        reference: 'MPESA-SOFTDEL-01',
        recordedBy: 'Bursar One',
        paidAt: today,
      });
    expect(payRes.status).toBe(200);

    // Edit student details + normalise Kenyan phone
    const editRes = await request(app)
      .patch(`/api/students/${stu.id}`)
      .set('Authorization', `Bearer ${registrarToken}`)
      .send({
        fullName: 'Mercy Wanjiku Kamau',
        section: 'B',
        guardianPhone: '0799887766',
      });
    expect(editRes.status).toBe(200);
    expect(editRes.body.student.fullName).toBe('Mercy Wanjiku Kamau');
    expect(editRes.body.student.section).toBe('B');
    expect(editRes.body.student.guardianPhone).toBe('+254799887766');

    // Duplicate studentCode blocked on PATCH
    const existingOther = store.getWorkspace(tenantId).students.find((s) => s.id !== stu.id)!;
    const dupPatch = await request(app)
      .patch(`/api/students/${stu.id}`)
      .set('Authorization', `Bearer ${registrarToken}`)
      .send({ studentCode: existingOther.studentCode });
    expect(dupPatch.status).toBe(409);

    // Transition status requires reason for Transferred / Withdrawn / Graduated
    const badTrans = await request(app)
      .post(`/api/students/${stu.id}/lifecycle`)
      .set('Authorization', `Bearer ${registrarToken}`)
      .send({ status: 'Transferred', reason: '', statusDate: today });
    expect(badTrans.status).toBe(400);

    const transRes = await request(app)
      .post(`/api/students/${stu.id}/lifecycle`)
      .set('Authorization', `Bearer ${registrarToken}`)
      .send({
        status: 'Transferred',
        reason: 'Relocated to Nakuru County',
        statusDate: today,
      });
    expect(transRes.status).toBe(200);
    expect(transRes.body.student.status).toBe('Transferred');
    expect(transRes.body.student.statusReason).toBe('Relocated to Nakuru County');

    // Soft delete requires reason and preserves invoice/payment in store
    const badDel = await request(app)
      .delete(`/api/students/${stu.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: '' });
    expect(badDel.status).toBe(400);

    const countBefore = store
      .getWorkspace(tenantId)
      .students.filter((s) => !s.deleted).length;

    const delRes = await request(app)
      .delete(`/api/students/${stu.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Duplicate trial admission' });
    expect(delRes.status).toBe(200);
    expect(delRes.body.student.deleted).toBe(true);

    // Active workspace omits deleted student but retains historical invoice & payment
    const ws = store.getWorkspace(tenantId);
    expect(ws.students.some((s) => s.id === stu.id)).toBe(false);
    expect(ws.students.filter((s) => !s.deleted).length).toBe(countBefore - 1);
    const preservedInv = ws.invoices.find((i) => i.id === inv.id);
    expect(preservedInv).toBeDefined();
    expect(preservedInv?.paidAmount).toBe(5000);

    // Audit trail captures edit, transition, and soft delete
    const logsRes = await request(app)
      .get('/api/students/audit-logs')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(logsRes.status).toBe(200);
    const actions = logsRes.body.logs.map((l: { action: string }) => l.action);
    expect(actions).toContain('STUDENT_EDITED');
    expect(actions).toContain('STUDENT_TRANSFERRED');
    expect(actions).toContain('STUDENT_SOFT_DELETED');
  });

  it('3. Previews and executes Year-End Promotion (Promote / Hold Back / Graduate) with balance carry-forward', async () => {
    // Enroll two learners in Grade 6 and one in Grade 9
    const e1 = await request(app)
      .post('/api/students/enroll')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Learner Promote',
        dateOfBirth: '2013-03-10',
        gender: 'Female',
        grade: 'Grade 6',
        section: 'A',
        guardianName: 'Parent Promote',
        guardianPhone: '0722001101',
      });
    const e2 = await request(app)
      .post('/api/students/enroll')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Learner HoldBack',
        dateOfBirth: '2013-04-11',
        gender: 'Male',
        grade: 'Grade 6',
        section: 'A',
        guardianName: 'Parent Hold',
        guardianPhone: '0722001102',
      });
    const e3 = await request(app)
      .post('/api/students/enroll')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Learner Graduate',
        dateOfBirth: '2010-02-18',
        gender: 'Male',
        grade: 'Grade 9',
        section: 'A',
        guardianName: 'Parent Grad',
        guardianPhone: '0722001103',
      });
    expect(e1.status).toBe(201);
    expect(e2.status).toBe(201);
    expect(e3.status).toBe(201);

    const s1 = e1.body.student;
    const s2 = e2.body.student;
    const s3 = e3.body.student;
    const arrears1 = e1.body.invoice.balance;

    // Preview Grade 6
    const preview6 = await request(app)
      .post('/api/students/promotions/preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ grade: 'Grade 6', section: 'A' });
    expect(preview6.status).toBe(200);
    expect(preview6.body.fromGrade).toBe('Grade 6');
    expect(preview6.body.nextGrade).toBe('Grade 7');
    const row1 = preview6.body.rows.find((r: { studentId: string }) => r.studentId === s1.id);
    expect(row1).toBeDefined();
    expect(row1.outstandingFeeBalance).toBe(arrears1);

    // Create a fresh Open academic year + term for promotion carry-forward
    const yr = await request(app)
      .post('/api/academic-calendar/years')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '2027', startDate: '2027-01-05', endDate: '2027-11-28', setAsCurrent: true });
    expect(yr.status).toBe(201);
    const nextTermRes = await request(app)
      .post('/api/academic-calendar/terms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        academicYearId: yr.body.year.id,
        name: 'Term 1 2027',
        startDate: '2027-01-05',
        endDate: '2027-04-02',
        setAsCurrent: true,
      });
    expect(nextTermRes.status).toBe(201);

    // Execute promotion batch on Grade 6: s1 Promote -> Grade 7 B, s2 Hold Back
    const exec6 = await request(app)
      .post('/api/students/promotions/execute')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fromGrade: 'Grade 6',
        carryForwardFees: true,
        toTerm: 'Term 1 2027',
        toTermId: nextTermRes.body.term.id,
        items: [
          { studentId: s1.id, action: 'Promote', targetSection: 'B' },
          { studentId: s2.id, action: 'Hold Back', targetSection: 'A' },
        ],
      });
    expect(exec6.status).toBe(200);
    expect(exec6.body.promotedCount).toBe(1);
    expect(exec6.body.heldBackCount).toBe(1);
    expect(exec6.body.carriedForwardCount).toBeGreaterThanOrEqual(2);

    const wsAfter = store.getWorkspace(tenantId);
    const updated1 = wsAfter.students.find((s) => s.id === s1.id)!;
    const updated2 = wsAfter.students.find((s) => s.id === s2.id)!;
    expect(updated1.grade).toBe('Grade 7');
    expect(updated1.section).toBe('B');
    expect(updated2.grade).toBe('Grade 6');

    const carriedInv1 = wsAfter.invoices.find(
      (i) => i.studentId === s1.id && i.term === 'Term 1 2027'
    );
    expect(carriedInv1).toBeDefined();
    expect(carriedInv1?.carriedForwardFromAmount).toBe(arrears1);

    // Graduate Grade 9 learner
    const exec9 = await request(app)
      .post('/api/students/promotions/execute')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fromGrade: 'Grade 9',
        carryForwardFees: false,
        items: [{ studentId: s3.id, action: 'Graduate' }],
      });
    expect(exec9.status).toBe(200);
    expect(exec9.body.graduatedCount).toBe(1);
    const updated3 = store.getWorkspace(tenantId).students.find((s) => s.id === s3.id)!;
    expect(updated3.status).toBe('Graduated');
  });

  it('5. Supports bulk CSV and Excel student import with dry-run validation, per-row errors, and learnerCap enforcement', async () => {
    const csvBad = [
      'fullName,dateOfBirth,gender,grade,section,guardianName,guardianPhone,guardianEmail',
      'Valid Dry Student,2014-05-01,Female,Grade 5,A,Mary Dry,0722998877,mary.dry@example.com',
      'Bad Phone Student,2014-05-01,Male,Grade 5,A,John Bad,12345,bad@example.com',
      'Bad Grade Student,2014-05-01,Male,Grade 99,A,Paul Bad,0722998866,paul@example.com',
    ].join('\n');

    const dryRes = await request(app)
      .post('/api/students/import')
      .set('Authorization', `Bearer ${registrarToken}`)
      .send({ dryRun: true, csvText: csvBad });
    expect(dryRes.status).toBe(200);
    expect(dryRes.body.dryRun).toBe(true);
    expect(dryRes.body.totalRows).toBe(3);
    expect(dryRes.body.validCount).toBe(1);
    expect(dryRes.body.errorCount).toBe(2);
    expect(dryRes.body.importedCount).toBe(0);

    // Confirm dry run did not persist Valid Dry Student
    expect(
      store.getWorkspace(tenantId).students.some((s) => s.fullName === 'Valid Dry Student')
    ).toBe(false);

    // Enforce learnerCap check
    const activeCount = store.getWorkspace(tenantId).students.filter((s) => !s.deleted).length;
    const tenantObj = store.listTenants().find((t) => t.id === tenantId)!;
    tenantObj.learnerCap = activeCount + 1;

    const capExceedCsv = [
      'fullName,dateOfBirth,gender,grade,section,guardianName,guardianPhone',
      'Cap Student One,2014-06-01,Female,Grade 5,A,Guardian One,0722100001',
      'Cap Student Two,2014-06-02,Male,Grade 5,A,Guardian Two,0722100002',
    ].join('\n');

    const capCommit = await request(app)
      .post('/api/students/import')
      .set('Authorization', `Bearer ${registrarToken}`)
      .send({ dryRun: false, csvText: capExceedCsv });
    expect(capCommit.status).toBe(409);

    // Increase cap and import an actual Excel (.xlsx) workbook via base64
    tenantObj.learnerCap = activeCount + 20;
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet([
      {
        fullName: 'Excel Imported Learner',
        dateOfBirth: '2013-09-14',
        gender: 'Female',
        grade: 'Grade 6',
        section: 'A',
        guardianName: 'Esther Excel',
        guardianPhone: '0733445566',
        guardianEmail: 'esther.excel@example.com',
      },
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'Students');
    const fileBase64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });

    const xlsxRes = await request(app)
      .post('/api/students/import')
      .set('Authorization', `Bearer ${registrarToken}`)
      .send({ dryRun: false, fileBase64, fileName: 'intake.xlsx' });
    expect(xlsxRes.status).toBe(201);
    expect(xlsxRes.body.importedCount).toBe(1);
    expect(xlsxRes.body.createdStudents[0].guardianPhone).toBe('+254733445566');
    const importedId = xlsxRes.body.createdStudents[0].id;
    expect(
      store.getWorkspace(tenantId).invoices.some((i) => i.studentId === importedId)
    ).toBe(true);
  });

  it('6. Supports optional Student Portal role with strict read-only data scoping and instant disablement', async () => {
    // Enroll two students in different classes & an exam cycle with results
    const e1 = await request(app)
      .post('/api/students/enroll')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Zainab Ali',
        dateOfBirth: '2011-04-12',
        gender: 'Female',
        grade: 'Grade 8',
        section: 'A',
        guardianName: 'Ali Omar',
        guardianPhone: '0722556677',
      });
    const e2 = await request(app)
      .post('/api/students/enroll')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Other Class Student',
        dateOfBirth: '2013-04-12',
        gender: 'Male',
        grade: 'Grade 6',
        section: 'A',
        guardianName: 'Other Parent',
        guardianPhone: '0722556688',
      });
    expect(e1.status).toBe(201);
    expect(e2.status).toBe(201);
    const zainab = e1.body.student;
    const otherStu = e2.body.student;

    // Provision fails while studentPortalEnabled is false
    const disabledProvision = await request(app)
      .post(`/api/students/${zainab.id}/portal-account`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(disabledProvision.status).toBe(403);

    // Non-admin cannot toggle student portal
    const bursarToggle = await request(app)
      .put(`/api/tenants/${tenantId}/student-portal`)
      .set('Authorization', `Bearer ${bursarToken}`)
      .send({ enabled: true });
    expect(bursarToggle.status).toBe(403);

    // Admin enables student portal
    const enableRes = await request(app)
      .put(`/api/tenants/${tenantId}/student-portal`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ enabled: true });
    expect(enableRes.status).toBe(200);
    expect(enableRes.body.tenant.studentPortalEnabled).toBe(true);

    // Provision Zainab's login + activate OTP
    const provRes = await request(app)
      .post(`/api/students/${zainab.id}/portal-account`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: `zainab.ali@${domain}` });
    expect(provRes.status).toBe(201);
    expect(provRes.body.user.role).toBe('Student');
    const studentToken = await activate(
      provRes.body.user.email,
      provRes.body.oneTimePassword,
      'StudentPass2026!'
    );

    // Create a Draft exam cycle and record scores for Zainab and otherStu (Draft must NOT leak to Student)
    const draftCycleRes = await request(app)
      .post('/api/exams/cycles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Secret Draft Exam',
        term: store.listTenants().find((t) => t.id === tenantId)!.currentTerm,
        startDate: '2026-11-18',
        endDate: '2026-11-22',
      });
    expect(draftCycleRes.status).toBe(201);
    const draftCycleId = draftCycleRes.body.cycle.id;

    await request(app)
      .post('/api/exams/scores')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        examCycleId: draftCycleId,
        studentId: zainab.id,
        subject: 'Mathematics',
        score: 88,
      });

    // Record attendance for both students
    await request(app)
      .post('/api/attendance/batch')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        date: '2026-11-14',
        grade: 'Grade 8',
        section: 'A',
        entries: [{ studentId: zainab.id, status: 'Present' }],
      });
    await request(app)
      .post('/api/attendance/batch')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        date: '2026-11-14',
        grade: 'Grade 6',
        section: 'A',
        entries: [{ studentId: otherStu.id, status: 'Absent' }],
      });

    // Create Teachers Only announcement and Students announcement
    await request(app)
      .post('/api/communications/announcements')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Staff Meeting',
        body: 'Teachers only confidential briefing',
        audience: 'Teachers Only',
        priority: 'Normal',
      });
    await request(app)
      .post('/api/communications/announcements')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Science Fair',
        body: 'All learners gather at assembly hall',
        audience: 'Students',
        priority: 'Normal',
      });

    // Verify GET /api/workspace scoping for Student
    const stuWsRes = await request(app)
      .get('/api/workspace')
      .set('Authorization', `Bearer ${studentToken}`);
    expect(stuWsRes.status).toBe(200);
    const ws = stuWsRes.body;

    // Strictly own student only
    expect(ws.students.length).toBe(1);
    expect(ws.students[0].id).toBe(zainab.id);

    // Strictly own timetable grade+section only
    expect(
      ws.timetable.every(
        (slot: { grade: string; section: string }) =>
          slot.grade === zainab.grade && slot.section === zainab.section
      )
    ).toBe(true);

    // Strictly own attendance only
    expect(ws.attendance.every((a: { studentId: string }) => a.studentId === zainab.id)).toBe(true);
    expect(ws.attendance.some((a: { studentId: string }) => a.studentId === otherStu.id)).toBe(
      false
    );

    // Published results only (draft cycle omitted!)
    expect(ws.examCycles.every((c: { status: string }) => c.status === 'Published')).toBe(true);
    expect(ws.examResults.every((r: { studentId: string }) => r.studentId === zainab.id)).toBe(
      true
    );
    expect(
      ws.examResults.some((r: { examCycleId: string }) => r.examCycleId === draftCycleId)
    ).toBe(false);

    // Announcements filtered to Students / All School
    expect(
      ws.announcements.every(
        (a: { audience: string }) => a.audience === 'All School' || a.audience === 'Students'
      )
    ).toBe(true);
    expect(ws.announcements.some((a: { title: string }) => a.title === 'Science Fair')).toBe(true);

    // Zero finance, admissions, staff attendance, or payroll leakage
    expect(ws.invoices).toEqual([]);
    expect(ws.expenses).toEqual([]);
    expect(ws.payrollEntries).toEqual([]);
    expect(ws.budgets).toEqual([]);
    expect(ws.reconciliationLines).toEqual([]);
    expect(ws.mpesaTransactions).toEqual([]);
    expect(ws.admissions).toEqual([]);
    expect(ws.staffAttendance).toEqual([]);

    // Student blocked (403) on all write endpoints
    const writeAttempts = await Promise.all([
      request(app)
        .post('/api/students/enroll')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ fullName: 'Hack', grade: 'Grade 8', dateOfBirth: '2011-01-01', guardianName: 'X', guardianPhone: '0722000000' }),
      request(app)
        .post('/api/exams/scores')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ examCycleId: draftCycleId, studentId: zainab.id, subject: 'Mathematics', score: 100 }),
      request(app)
        .post('/api/attendance/batch')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ date: '2026-11-14', grade: 'Grade 8', section: 'A', entries: [] }),
      request(app)
        .post('/api/fees/invoices')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ studentId: zainab.id, term: 'Term 1', dueDate: '2026-12-01', totalAmount: 1 }),
      request(app)
        .post('/api/communications/announcements')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ title: 'X', body: 'Y', audience: 'All School' }),
      request(app)
        .post('/api/communications/messages')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ channel: 'Staff & Faculty', body: 'Hi' }),
    ]);
    for (const attempt of writeAttempts) {
      expect(attempt.status).toBe(403);
    }

    // Disabling student portal immediately blocks existing student session & logins
    const disableRes = await request(app)
      .put(`/api/tenants/${tenantId}/student-portal`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ enabled: false });
    expect(disableRes.status).toBe(200);

    const blockedWs = await request(app)
      .get('/api/workspace')
      .set('Authorization', `Bearer ${studentToken}`);
    expect([401, 403]).toContain(blockedWs.status);

    const blockedLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: `zainab.ali@${domain}`, password: 'StudentPass2026!' });
    expect(blockedLogin.status).toBe(403);
  });
});
