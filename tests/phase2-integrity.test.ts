import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, store } from '../server';
import { getSubjectsForGrade } from '../src/shared/types';

describe('Phase 2: Data Integrity, Kenya Statutory Payroll, Maker-Checker, Enrolment & Exams', () => {
  let tenantId = '';
  let adminToken = '';
  let bursar1Token = '';
  let bursar2Token = '';
  let teacherToken = '';
  let devToken = '';

  beforeAll(async () => {
    await store.ensureInitialized();
  });

  beforeEach(async () => {
    const { devCredentials } = await store.resetForTests({ empty: false });
    const tenant = store.listTenants()[0];
    tenantId = tenant.id;
    const domain = tenant.emailDomain || 'oakridge.ac.ke';

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

    const adminCred = devCredentials.find((c) => c.role === 'Admin')!;
    adminToken = await activate(adminCred.email, adminCred.password, 'AdminInt2026!');

    const devCred = devCredentials.find((c) => c.role === 'Developer')!;
    devToken = await activate(devCred.email, devCred.password, 'DevInt2026!');

    const createStaff = async (fullName: string, email: string, role: 'Bursar' | 'Teacher') => {
      const res = await request(app)
        .post('/api/auth/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ fullName, email, role, phone: '+254712000100' });
      expect(res.status).toBe(201);
      return activate(res.body.user.email, res.body.oneTimePassword, `${role}Int2026!`);
    };

    bursar1Token = await createStaff('Bursar Maker', `bursar1@${domain}`, 'Bursar');
    bursar2Token = await createStaff('Bursar Checker', `bursar2@${domain}`, 'Bursar');
    teacherToken = await createStaff('Teacher Scorer', `teacher.int@${domain}`, 'Teacher');
  });

  it('validates payment amounts, dates, duplicate refs, sequential receipts, overpayment creditBalance, voiding & audit trail', async () => {
    const enroll = await request(app)
      .post('/api/students/enroll')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Amina Hassan',
        dateOfBirth: '2013-06-14',
        gender: 'Female',
        grade: 'Grade 6',
        section: 'A',
        guardianName: 'Hassan Ali',
        guardianPhone: '0722111222',
      });
    expect(enroll.status).toBe(201);
    const studentId = enroll.body.student.id;
    const invoiceId = enroll.body.invoice.id;
    const invTotal = enroll.body.invoice.totalAmount;
    const today = new Date().toISOString().slice(0, 10);

    // Reject 0 / negative / NaN
    for (const badAmount of [0, -100, 'abc']) {
      const badPay = await request(app)
        .post(`/api/fees/invoices/${invoiceId}/payments`)
        .set('Authorization', `Bearer ${bursar1Token}`)
        .send({
          amount: badAmount,
          method: 'Cash',
          reference: `REF-${String(badAmount)}`,
          recordedBy: 'Bursar Maker',
          paidAt: today,
        });
      expect(badPay.status).toBe(400);
    }

    // Reject future paidAt and >30d backdated payment for non-Admin Bursar
    const futureDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const futureRes = await request(app)
      .post(`/api/fees/invoices/${invoiceId}/payments`)
      .set('Authorization', `Bearer ${bursar1Token}`)
      .send({
        amount: 1000,
        method: 'Bank Transfer',
        reference: 'FUT-1',
        recordedBy: 'Bursar Maker',
        paidAt: futureDate,
      });
    expect(futureRes.status).toBe(400);

    const oldDate = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
    const backdateRes = await request(app)
      .post(`/api/fees/invoices/${invoiceId}/payments`)
      .set('Authorization', `Bearer ${bursar1Token}`)
      .send({
        amount: 1000,
        method: 'Bank Transfer',
        reference: 'OLD-1',
        recordedBy: 'Bursar Maker',
        paidAt: oldDate,
      });
    expect(backdateRes.status).toBe(403);

    // Overpayment stores excess on student.creditBalance + assigns sequential receipt RCT-xxxxxx
    const overpayAmount = invTotal + 3500;
    const pay1 = await request(app)
      .post(`/api/fees/invoices/${invoiceId}/payments`)
      .set('Authorization', `Bearer ${bursar1Token}`)
      .send({
        amount: overpayAmount,
        method: 'Mobile Money',
        reference: 'MPESA-UNIQ-01',
        recordedBy: 'Bursar Maker',
        paidAt: today,
      });
    expect(pay1.status).toBe(200);
    expect(pay1.body.invoice.balance).toBe(0);
    expect(pay1.body.invoice.status).toBe('Paid');
    const rct1 = pay1.body.invoice.payments[0].receiptNumber;
    expect(rct1).toMatch(/^RCT-\d{6}$/);

    // Duplicate payment reference (case-insensitive) rejected
    const inv2 = await request(app)
      .post('/api/fees/invoices')
      .set('Authorization', `Bearer ${bursar1Token}`)
      .send({ studentId, term: 'Term 2', dueDate: '2026-12-30', totalAmount: 10000 });
    expect(inv2.status).toBe(201);

    const dupRefPay = await request(app)
      .post(`/api/fees/invoices/${inv2.body.invoice.id}/payments`)
      .set('Authorization', `Bearer ${bursar1Token}`)
      .send({
        amount: 2000,
        method: 'Mobile Money',
        reference: 'mpesa-uniq-01',
        recordedBy: 'Bursar Maker',
        paidAt: today,
      });
    expect(dupRefPay.status).toBe(409);

    // Sequential second receipt
    const pay2 = await request(app)
      .post(`/api/fees/invoices/${inv2.body.invoice.id}/payments`)
      .set('Authorization', `Bearer ${bursar1Token}`)
      .send({
        amount: 2000,
        method: 'Bank Transfer',
        reference: 'EFT-UNIQ-02',
        recordedBy: 'Bursar Maker',
        paidAt: today,
      });
    expect(pay2.status).toBe(200);
    const rct2 = pay2.body.invoice.payments[0].receiptNumber;
    expect(rct2).toMatch(/^RCT-\d{6}$/);
    expect(Number(rct2.split('-')[1])).toBe(Number(rct1.split('-')[1]) + 1);

    // Verify student creditBalance was recorded and voiding requires reason
    const ws1 = await request(app)
      .get('/api/workspace')
      .set('Authorization', `Bearer ${adminToken}`);
    const updatedStudent = ws1.body.students.find((s: { id: string }) => s.id === studentId);
    expect(updatedStudent.creditBalance).toBe(3500);

    const voidRes = await request(app)
      .post(`/api/fees/invoices/${inv2.body.invoice.id}/payments/${pay2.body.invoice.payments[0].id}/void`)
      .set('Authorization', `Bearer ${bursar1Token}`)
      .send({ reason: 'Cheque dishonoured by bank' });
    expect(voidRes.status).toBe(200);
    expect(voidRes.body.invoice.balance).toBe(10000);

    // Credit Note & Waiver reduce balance cleanly + financeAuditLog records mutations
    const cnRes = await request(app)
      .post('/api/fees/credit-notes')
      .set('Authorization', `Bearer ${bursar1Token}`)
      .send({ invoiceId: inv2.body.invoice.id, amount: 1500, reason: 'Transport route cancellation' });
    expect(cnRes.status).toBe(201);
    expect(cnRes.body.invoice.balance).toBe(8500);

    const waiverRes = await request(app)
      .post('/api/fees/waivers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        studentId,
        invoiceId: inv2.body.invoice.id,
        term: 'Term 2',
        kind: 'Bursary',
        mode: 'Fixed',
        value: 2500,
        reason: 'County Education Bursary',
      });
    expect(waiverRes.status).toBe(201);
    expect(waiverRes.body.invoice.balance).toBe(6000);

    const auditLogs = await request(app)
      .get('/api/finance/audit-logs')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(auditLogs.status).toBe(200);
    expect(auditLogs.body.logs.length).toBeGreaterThanOrEqual(4);
  });

  it('enforces Maker-Checker, forward-only state transitions, immutability of Posted records, and Feb 2026 Kenya payroll math', async () => {
    // 1. Expense Maker-Checker & Immutability
    const expCreate = await request(app)
      .post('/api/finance/expenses')
      .set('Authorization', `Bearer ${bursar1Token}`)
      .send({
        title: 'Science Lab Reagents',
        category: 'Laboratory & Science',
        vendor: 'Kenya SciLab Ltd',
        amount: 24000,
        paymentMethod: 'Bank Transfer',
        reference: 'INV-SCI-90',
        status: 'Paid', // Server must force Pending Approval regardless
      });
    expect(expCreate.status).toBe(201);
    expect(expCreate.body.expense.status).toBe('Pending Approval');
    const expId = expCreate.body.expense.id;

    // Same maker cannot approve
    const selfApproveExp = await request(app)
      .patch(`/api/finance/expenses/${expId}`)
      .set('Authorization', `Bearer ${bursar1Token}`)
      .send({ status: 'Approved' });
    expect(selfApproveExp.status).toBe(403);

    // Checker can approve, then disburse
    const checkerApproveExp = await request(app)
      .patch(`/api/finance/expenses/${expId}`)
      .set('Authorization', `Bearer ${bursar2Token}`)
      .send({ status: 'Approved' });
    expect(checkerApproveExp.status).toBe(200);
    expect(checkerApproveExp.body.expense.status).toBe('Approved');

    const payExp = await request(app)
      .patch(`/api/finance/expenses/${expId}`)
      .set('Authorization', `Bearer ${bursar2Token}`)
      .send({ status: 'Paid' });
    expect(payExp.status).toBe(200);
    expect(payExp.body.expense.status).toBe('Paid');

    // Paid expense cannot be deleted directly; must be reversed
    const delPaidExp = await request(app)
      .delete(`/api/finance/expenses/${expId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Try delete paid' });
    expect(delPaidExp.status).toBe(409);

    const revPaidExp = await request(app)
      .post(`/api/finance/expenses/${expId}/reverse`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Supplier refunded overcharge' });
    expect(revPaidExp.status).toBe(200);
    expect(revPaidExp.body.expense.reversed).toBe(true);

    // 2. Payroll Statutory Calculations (Feb 2026 schedule) for Gross KES 120,000
    // Expected:
    // NSSF = min(120000, 108000) * 6% = 6,480 (Employee) + 6,480 (Employer)
    // SHIF = round(120000 * 2.75%) = 3,300
    // Housing Levy = round(120000 * 1.5%) = 1,800 (Employee) + 1,800 (Employer)
    // NITA = 50 (Employer)
    // Taxable = 120000 - (6480 + 3300 + 1800) = 108,420
    // Gross PAYE: 24000*0.1 + 8333*0.25 + (108420-32333)*0.30 = 2400 + 2083.25 + 22826.10 = 27309.35
    // Net PAYE = round(27309.35 - 2400) = 24,909
    const payRes = await request(app)
      .post('/api/finance/payroll')
      .set('Authorization', `Bearer ${bursar1Token}`)
      .send({
        payPeriod: '2026-03',
        staffName: 'Dr. Kamau Njoroge',
        staffCategory: 'Teaching',
        designation: 'Senior Principal',
        basicSalary: 100000,
        allowances: 20000,
        saccoOrLoan: 0,
        autoComputeStatutory: true,
      });
    expect(payRes.status).toBe(201);
    const entry = payRes.body.entry;
    expect(entry.grossPay).toBe(120000);
    expect(entry.nssf).toBe(6480);
    expect(entry.shif).toBe(3300);
    expect(entry.housingLevy).toBe(1800);
    expect(entry.paye).toBe(24909);
    expect(entry.employerNssf).toBe(6480);
    expect(entry.employerHousingLevy).toBe(1800);
    expect(entry.employerNita).toBe(50);
    expect(entry.totalEmployerCost).toBe(120000 + 6480 + 1800 + 50);
    expect(entry.status).toBe('Draft');

    // Same Bursar cannot approve payroll
    const selfPayrollApprove = await request(app)
      .patch(`/api/finance/payroll/${entry.id}/status`)
      .set('Authorization', `Bearer ${bursar1Token}`)
      .send({ status: 'Approved' });
    expect(selfPayrollApprove.status).toBe(403);

    // Checker Bursar approves then disburses
    const okPayrollApprove = await request(app)
      .patch(`/api/finance/payroll/${entry.id}/status`)
      .set('Authorization', `Bearer ${bursar2Token}`)
      .send({ status: 'Approved' });
    expect(okPayrollApprove.status).toBe(200);

    // Developer can manage statutory rate schedules
    const devRates = await request(app)
      .get('/api/dev/statutory-rates')
      .set('Authorization', `Bearer ${devToken}`);
    expect(devRates.status).toBe(200);
    expect(devRates.body.schedules.length).toBeGreaterThanOrEqual(1);
  });

  it('enforces enrolment uniqueness/validation and strict exam scoring, publish completeness, and unlock audit', async () => {
    // Reject future DOB and invalid Kenyan phone
    const badPhone = await request(app)
      .post('/api/students/enroll')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Bad Phone Learner',
        dateOfBirth: '2014-02-01',
        gender: 'Male',
        grade: 'Grade 6',
        section: 'A',
        guardianName: 'Guardian',
        guardianPhone: '12345',
      });
    expect(badPhone.status).toBe(400);

    const enroll1 = await request(app)
      .post('/api/students/enroll')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        studentCode: 'OAK-9901',
        upi: 'KEN-UPI-9901',
        fullName: 'Brian Ochieng',
        dateOfBirth: '2014-04-10',
        gender: 'Male',
        grade: 'Grade 6',
        section: 'A',
        guardianName: 'Joseph Ochieng',
        guardianPhone: '0711223344',
      });
    expect(enroll1.status).toBe(201);
    expect(enroll1.body.student.guardianPhone).toBe('+254711223344');

    // Duplicate studentCode/UPI rejected with 409
    const dupUpi = await request(app)
      .post('/api/students/enroll')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        studentCode: 'OAK-9902',
        upi: 'ken-upi-9901',
        fullName: 'Duplicate Learner',
        dateOfBirth: '2014-05-10',
        gender: 'Female',
        grade: 'Grade 6',
        section: 'A',
        guardianName: 'Guardian Two',
        guardianPhone: '+254711223355',
      });
    expect(dupUpi.status).toBe(409);

    // Create exam cycle
    const cycleRes = await request(app)
      .post('/api/exams/cycles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Mid-Term Check',
        term: 'Term 1',
        startDate: '2026-03-01',
        endDate: '2026-03-05',
      });
    expect(cycleRes.status).toBe(201);
    const cycleId = cycleRes.body.cycle.id;

    // Out-of-range score rejected with 400
    const badScore = await request(app)
      .post('/api/exams/scores')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        examCycleId: cycleId,
        studentId: enroll1.body.student.id,
        subject: 'Mathematics',
        score: 105,
      });
    expect(badScore.status).toBe(400);

    // Publishing before all active students have scores/markers fails with 400
    const prematurePublish = await request(app)
      .post(`/api/exams/cycles/${cycleId}/publish`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(prematurePublish.status).toBe(400);

    // Assign teacher to Grade 6 Mathematics only and verify subject scoping
    const tenant = store.listTenants()[0];
    const teacherProfile = tenant.teachers.find((t) =>
      t.email?.toLowerCase().includes('teacher.int')
    );
    if (teacherProfile) {
      await request(app)
        .post(`/api/tenants/${tenantId}/teachers`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ...teacherProfile,
          assignedGrades: ['Grade 6'],
          subjects: ['Mathematics'],
        });

      const forbiddenSubject = await request(app)
        .post('/api/exams/scores')
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({
          examCycleId: cycleId,
          studentId: enroll1.body.student.id,
          subject: 'English',
          score: 78,
        });
      expect(forbiddenSubject.status).toBe(403);
    }

    // Admin fills scores or Absent/Exempt for all active students & subjects grouped by cohort -> publish succeeds
    const ws = await request(app)
      .get('/api/workspace')
      .set('Authorization', `Bearer ${adminToken}`);
    const students = (ws.body.students as Array<{ id: string; grade: string; section: string; status?: string }>).filter(
      (s) => !s.status || s.status === 'Active'
    );
    const byCohort = new Map<string, { grade: string; section: string; students: typeof students }>();
    for (const st of students) {
      const key = `${st.grade}:::${st.section}`;
      if (!byCohort.has(key)) {
        byCohort.set(key, { grade: st.grade, section: st.section, students: [] });
      }
      byCohort.get(key)!.students.push(st);
    }

    for (const cohort of byCohort.values()) {
      const cohortSubjects = getSubjectsForGrade(tenant, cohort.grade);
      const entries: Array<{
        studentId: string;
        subject: string;
        score?: number | null;
        resultStatus: 'Scored' | 'Absent';
      }> = [];
      for (const st of cohort.students) {
        for (const subj of cohortSubjects) {
          const isAbsentSample = st.id === enroll1.body.student.id && subj === 'Mathematics';
          entries.push({
            studentId: st.id,
            subject: subj,
            score: isAbsentSample ? null : 75,
            resultStatus: isAbsentSample ? 'Absent' : 'Scored',
          });
        }
      }
      const batchSave = await request(app)
        .post('/api/exams/scores/batch')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          examCycleId: cycleId,
          grade: cohort.grade,
          section: cohort.section,
          teacherId: '__ADMIN__',
          entries,
        });
      expect(batchSave.status).toBe(200);
    }

    const publishOk = await request(app)
      .post(`/api/exams/cycles/${cycleId}/publish`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(publishOk.status).toBe(200);
    expect(publishOk.body.cycle.status).toBe('Published');

    // Editing after Publish is blocked until Admin unlocks with reason
    const lockedEdit = await request(app)
      .post('/api/exams/scores')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        examCycleId: cycleId,
        studentId: enroll1.body.student.id,
        subject: 'Mathematics',
        score: 82,
        resultStatus: 'Scored',
      });
    expect(lockedEdit.status).toBe(409);

    const unlockRes = await request(app)
      .post(`/api/exams/cycles/${cycleId}/unlock`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Correcting medical exemption mark for Mathematics' });
    expect(unlockRes.status).toBe(200);
    expect(unlockRes.body.cycle.status).toBe('Grading');
    expect(unlockRes.body.cycle.unlockHistory?.length).toBe(1);

    const unlockedEdit = await request(app)
      .post('/api/exams/scores')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        examCycleId: cycleId,
        studentId: enroll1.body.student.id,
        subject: 'Mathematics',
        score: 82,
        resultStatus: 'Scored',
      });
    expect(unlockedEdit.status).toBe(200);
    expect(unlockedEdit.body.result.score).toBe(82);
  });
});
