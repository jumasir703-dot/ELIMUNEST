import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, store } from '../server';
import { ST_RAPHAEL_DEFAULT_PASSWORDS, ST_RAPHAEL_TENANT_ID } from '../server/seedStRaphael';

describe('Teacher Lesson Attendance & Learners Progressive Reports', () => {
  let oakridgeTenantId = '';

  let oakAdminToken = '';
  let oakTeacherToken = '';
  let oakPeerTeacherToken = '';
  let oakBursarToken = '';
  let oakRegistrarToken = '';
  let oakParentToken = '';
  let oakStudentId = '';
  let oakStudentCode = '';
  let oakStudentName = '';

  beforeAll(async () => {
    await store.ensureInitialized();
  });

  beforeEach(async () => {
    const { devCredentials } = await store.resetForTests({ empty: false });
    const oakridge = store.listTenants().find((t) => t.id === 'tenant-oakridge')!;
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

    const childEnroll = await request(app)
      .post('/api/students/enroll')
      .set('Authorization', `Bearer ${oakAdminToken}`)
      .send({
        fullName: 'Faith Wanjiku',
        dateOfBirth: '2012-06-18',
        gender: 'Female',
        grade: 'Grade 9',
        section: 'A',
        guardianName: 'Peter Wanjiku',
        guardianPhone: '0722999444',
      });
    expect(childEnroll.status).toBe(201);
    oakStudentId = childEnroll.body.student.id;
    oakStudentCode = childEnroll.body.student.studentCode;
    oakStudentName = childEnroll.body.student.fullName;

    const parentReg = await request(app).post('/api/auth/register').send({
      tenantId: oakridgeTenantId,
      fullName: 'Peter Wanjiku',
      email: 'peter.wanjiku@oakridge.ac.ke',
      password: 'OakParentPass2026!',
      phone: '+254722999444',
      studentCode: oakStudentCode,
      guardianPhone: '0722999444',
    });
    expect(parentReg.status).toBe(201);
    oakParentToken = parentReg.body.token;
  });

  it('tracks Teacher Lesson Attendance with Delegated mandate and Recovered lesson validation', async () => {
    // Non-teaching/non-admin roles (Bursar, Registrar, Parent) cannot record teacher lesson attendance
    for (const token of [oakBursarToken, oakRegistrarToken, oakParentToken]) {
      const forbiddenRes = await request(app)
        .post('/api/attendance/teacher-lessons')
        .set('Authorization', `Bearer ${token}`)
        .send({
          date: '2026-11-24',
          entries: [
            {
              grade: 'Grade 9',
              section: 'A',
              subject: 'Mathematics',
              scheduledTeacherId: 't-oak-1',
              status: 'Attended',
            },
          ],
        });
      expect(forbiddenRes.status).toBe(403);
    }

    // Delegated status requires a covering teacher distinct from scheduledTeacherId
    const missingDelegateRes = await request(app)
      .post('/api/attendance/teacher-lessons')
      .set('Authorization', `Bearer ${oakAdminToken}`)
      .send({
        date: '2026-11-24',
        entries: [
          {
            grade: 'Grade 9',
            section: 'A',
            subject: 'Mathematics',
            scheduledTeacherId: 't-oak-1',
            status: 'Delegated',
          },
        ],
      });
    expect(missingDelegateRes.status).toBe(400);

    const sameDelegateRes = await request(app)
      .post('/api/attendance/teacher-lessons')
      .set('Authorization', `Bearer ${oakAdminToken}`)
      .send({
        date: '2026-11-24',
        entries: [
          {
            grade: 'Grade 9',
            section: 'A',
            subject: 'Mathematics',
            scheduledTeacherId: 't-oak-1',
            status: 'Delegated',
            delegatedTeacherId: 't-oak-1',
          },
        ],
      });
    expect(sameDelegateRes.status).toBe(400);

    // Recovered status requires originalMissedDate (YYYY-MM-DD)
    const missingMissedDateRes = await request(app)
      .post('/api/attendance/teacher-lessons')
      .set('Authorization', `Bearer ${oakAdminToken}`)
      .send({
        date: '2026-11-24',
        entries: [
          {
            grade: 'Grade 9',
            section: 'A',
            subject: 'Mathematics',
            scheduledTeacherId: 't-oak-1',
            status: 'Recovered',
            recoveredDate: '2026-11-24',
          },
        ],
      });
    expect(missingMissedDateRes.status).toBe(400);

    // Teacher cannot record lesson attendance for another teacher's unassigned cohort
    const unassignedCohortRes = await request(app)
      .post('/api/attendance/teacher-lessons')
      .set('Authorization', `Bearer ${oakPeerTeacherToken}`)
      .send({
        date: '2026-11-24',
        entries: [
          {
            grade: 'Grade 7',
            section: 'B',
            subject: 'Mathematics',
            scheduledTeacherId: 't-oak-1',
            status: 'Attended',
          },
        ],
      });
    expect(unassignedCohortRes.status).toBe(403);

    // Admin logs Attended, Delegated (with mandate teacher), Recovered (with missed/recovered dates), and Missed lessons
    const batchRes = await request(app)
      .post('/api/attendance/teacher-lessons')
      .set('Authorization', `Bearer ${oakAdminToken}`)
      .send({
        date: '2026-11-24',
        entries: [
          {
            periodNumber: 1,
            timeSlot: '08:00 - 08:40',
            grade: 'Grade 9',
            section: 'A',
            subject: 'Mathematics',
            scheduledTeacherId: 't-oak-1',
            status: 'Attended',
            topicCovered: 'Simultaneous equations practice',
          },
          {
            periodNumber: 2,
            timeSlot: '08:40 - 09:20',
            grade: 'Grade 9',
            section: 'A',
            subject: 'Integrated Science',
            scheduledTeacherId: 't-oak-2',
            status: 'Delegated',
            delegatedTeacherId: 't-oak-1',
            delegationNotes: 'Covering lab practical while attending county workshop.',
            topicCovered: 'Acids & Bases Titration',
          },
          {
            periodNumber: 7,
            timeSlot: '15:10 - 15:50',
            grade: 'Grade 9',
            section: 'A',
            subject: 'English',
            scheduledTeacherId: 't-oak-3',
            status: 'Recovered',
            originalMissedDate: '2026-11-19',
            recoveredDate: '2026-11-24',
            recoveredPeriod: 7,
            recoveredByTeacherId: 't-oak-3',
            topicCovered: 'Oral Literature Make-up',
          },
          {
            periodNumber: 4,
            timeSlot: '10:20 - 11:00',
            grade: 'Grade 9',
            section: 'A',
            subject: 'Kiswahili',
            scheduledTeacherId: 't-oak-4',
            status: 'Missed',
            remarks: 'Teacher on emergency medical leave.',
          },
        ],
      });
    expect(batchRes.status).toBe(200);
    expect(batchRes.body.records).toHaveLength(4);

    const delegatedRow = batchRes.body.records.find((r: any) => r.status === 'Delegated');
    expect(delegatedRow).toBeDefined();
    expect(delegatedRow.delegatedTeacherId).toBe('t-oak-1');
    expect(delegatedRow.delegatedTeacherName).toBe('Mr. Kamau Njoroge');
    expect(delegatedRow.delegationNotes).toContain('county workshop');

    const recoveredRow = batchRes.body.records.find((r: any) => r.status === 'Recovered');
    expect(recoveredRow).toBeDefined();
    expect(recoveredRow.originalMissedDate).toBe('2026-11-19');
    expect(recoveredRow.recoveredDate).toBe('2026-11-24');
    expect(recoveredRow.recoveredByTeacherName).toBe('Ms. Chebet Kiprono');

    // Delegated covering teacher (Mr. Kamau) can update his delegated slot
    const teacherSelfLog = await request(app)
      .post('/api/attendance/teacher-lessons')
      .set('Authorization', `Bearer ${oakTeacherToken}`)
      .send({
        date: '2026-11-24',
        entries: [
          {
            id: delegatedRow.id,
            grade: 'Grade 9',
            section: 'A',
            subject: 'Integrated Science',
            scheduledTeacherId: 't-oak-2',
            status: 'Delegated',
            delegatedTeacherId: 't-oak-1',
            delegationNotes: 'Completed practical mandate on behalf of Mrs. Achieng.',
            topicCovered: 'Acids & Bases Titration',
          },
        ],
      });
    expect(teacherSelfLog.status).toBe(200);

    // Parent workspace must never expose staff teacherLessonAttendance
    const parentWs = await request(app)
      .get('/api/workspace')
      .set('Authorization', `Bearer ${oakParentToken}`)
      .set('x-tenant-id', oakridgeTenantId);
    expect(parentWs.status).toBe(200);
    expect(parentWs.body.teacherLessonAttendance).toEqual([]);

    // St. Raphael seeded workspace contains Teacher Lesson Attendance records including Delegated & Recovered
    await store.resetForTests({ empty: false, includeLargeTenants: true });
    const stRaphAdminPass = ST_RAPHAEL_DEFAULT_PASSWORDS['juma.j@straphael.ac.ke'];
    const stRaphAdminRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'juma.j@straphael.ac.ke',
        password: stRaphAdminPass,
      });
    expect(stRaphAdminRes.status).toBe(200);
    let stRaphAdminToken = stRaphAdminRes.body.token as string;
    if (stRaphAdminRes.body.user.mustChangePassword) {
      const chg = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${stRaphAdminToken}`)
        .send({ currentPassword: stRaphAdminPass, newPassword: 'StRaphaelAdminNew2026!' });
      expect(chg.status).toBe(200);
      stRaphAdminToken = chg.body.token as string;
    }
    const stRaphWs = await request(app)
      .get('/api/workspace')
      .set('Authorization', `Bearer ${stRaphAdminToken}`)
      .set('x-tenant-id', ST_RAPHAEL_TENANT_ID);
    expect(stRaphWs.status).toBe(200);
    expect(Array.isArray(stRaphWs.body.teacherLessonAttendance)).toBe(true);
    expect(stRaphWs.body.teacherLessonAttendance.some((r: any) => r.status === 'Delegated' && r.delegatedTeacherName)).toBe(true);
    expect(stRaphWs.body.teacherLessonAttendance.some((r: any) => r.status === 'Recovered' && r.originalMissedDate && r.recoveredDate)).toBe(true);
  });

  it('supports Learners Progressive Report manual entry, subject merging, spreadsheet import, delete guards, and parent visibility', async () => {
    // Bursar, Registrar, and Parent cannot save or import progressive reports
    for (const token of [oakBursarToken, oakRegistrarToken, oakParentToken]) {
      const manualRes = await request(app)
        .post('/api/exams/progressive-reports')
        .set('Authorization', `Bearer ${token}`)
        .send({
          studentId: oakStudentId,
          assessmentLabel: 'CAT 1',
          assessmentDate: '2026-10-15',
          subjects: [{ subject: 'Mathematics', score: 82 }],
        });
      expect(manualRes.status).toBe(403);

      const importRes = await request(app)
        .post('/api/exams/progressive-reports/import')
        .set('Authorization', `Bearer ${token}`)
        .send({
          assessmentLabel: 'CAT 1',
          assessmentDate: '2026-10-15',
          rows: [{ studentCode: oakStudentCode, subjects: [{ subject: 'Mathematics', score: 82 }] }],
        });
      expect(importRes.status).toBe(403);
    }

    // Teacher (Mr. Kamau) cannot enter progressive score for unassigned subject (Integrated Science)
    const unassignedSubjectRes = await request(app)
      .post('/api/exams/progressive-reports')
      .set('Authorization', `Bearer ${oakTeacherToken}`)
      .send({
        studentId: oakStudentId,
        academicYear: '2026–2027',
        term: 'Term 1',
        assessmentLabel: 'CAT 1',
        assessmentDate: '2026-10-15',
        subjects: [{ subject: 'Integrated Science', score: 75 }],
      });
    expect(unassignedSubjectRes.status).toBe(403);

    // Teacher saves manual progressive entry for assigned subject (Mathematics)
    const teacherManualRes = await request(app)
      .post('/api/exams/progressive-reports')
      .set('Authorization', `Bearer ${oakTeacherToken}`)
      .send({
        studentId: oakStudentId,
        academicYear: '2026–2027',
        term: 'Term 1',
        assessmentLabel: 'CAT 1',
        assessmentDate: '2026-10-15',
        subjects: [
          {
            subject: 'Mathematics',
            score: 86,
            remarks: 'Strong mastery of linear equations.',
          },
        ],
        classTeacherRemarks: 'Consistent focus in Term 1.',
      });
    expect(teacherManualRes.status).toBe(201);
    const cat1Id = teacherManualRes.body.entry.id as string;
    expect(teacherManualRes.body.entry.meanScore).toBe(86);
    expect(teacherManualRes.body.entry.subjects[0].masteryLevel).toBe('Exceeding Expectations');

    // Admin adds English onto the same CAT 1 checkpoint -> subjects merge cleanly & aggregates recompute
    const adminMergeRes = await request(app)
      .post('/api/exams/progressive-reports')
      .set('Authorization', `Bearer ${oakAdminToken}`)
      .send({
        studentId: oakStudentId,
        academicYear: '2026–2027',
        term: 'Term 1',
        assessmentLabel: 'CAT 1',
        assessmentDate: '2026-10-15',
        subjects: [{ subject: 'English', score: 74 }],
      });
    expect(adminMergeRes.status).toBe(201);
    expect(adminMergeRes.body.entry.id).toBe(cat1Id);
    expect(adminMergeRes.body.entry.subjects).toHaveLength(2);
    expect(adminMergeRes.body.entry.totalScore).toBe(160);
    expect(adminMergeRes.body.entry.meanScore).toBe(80);

    // Teacher cannot import an unassigned subject row
    const teacherBadImport = await request(app)
      .post('/api/exams/progressive-reports/import')
      .set('Authorization', `Bearer ${oakTeacherToken}`)
      .send({
        academicYear: '2026–2027',
        term: 'Term 1',
        assessmentLabel: 'Mid-Term Check',
        assessmentDate: '2026-11-05',
        rows: [
          {
            studentCode: oakStudentCode,
            subjects: [{ subject: 'Integrated Science', score: 77 }],
          },
        ],
      });
    expect(teacherBadImport.status).toBe(403);

    // Admin imports a batch with 1 valid row and 1 unknown studentCode -> saves valid row & reports skipped error
    const adminImportRes = await request(app)
      .post('/api/exams/progressive-reports/import')
      .set('Authorization', `Bearer ${oakAdminToken}`)
      .send({
        academicYear: '2026–2027',
        term: 'Term 1',
        assessmentLabel: 'Mid-Term Check',
        assessmentDate: '2026-11-05',
        rows: [
          {
            studentCode: oakStudentCode,
            studentName: oakStudentName,
            subjects: [
              { subject: 'Mathematics', score: 90 },
              { subject: 'English', score: 80 },
            ],
            classTeacherRemarks: 'Marked improvement across STEM and languages.',
          },
          {
            studentCode: 'NON-EXISTENT-999',
            subjects: [{ subject: 'Mathematics', score: 65 }],
          },
        ],
      });
    expect(adminImportRes.status).toBe(200);
    expect(adminImportRes.body.savedCount).toBe(1);
    expect(adminImportRes.body.skippedRows).toBe(1);
    expect(adminImportRes.body.errors[0].identifier).toBe('NON-EXISTENT-999');
    const importedId = adminImportRes.body.entries[0].id as string;
    expect(adminImportRes.body.entries[0].source).toBe('import');
    expect(adminImportRes.body.entries[0].meanScore).toBe(85);

    // Peer teacher cannot delete Mr. Kamau's progressive entry
    const peerDeleteRes = await request(app)
      .delete(`/api/exams/progressive-reports/${cat1Id}`)
      .set('Authorization', `Bearer ${oakPeerTeacherToken}`);
    expect(peerDeleteRes.status).toBe(403);

    // Parent workspace displays both checkpoints for linked child with recordedByUserId stripped
    const parentWs = await request(app)
      .get('/api/workspace')
      .set('Authorization', `Bearer ${oakParentToken}`)
      .set('x-tenant-id', oakridgeTenantId);
    expect(parentWs.status).toBe(200);
    const parentEntries = parentWs.body.progressiveReports.filter((p: any) => p.studentId === oakStudentId);
    expect(parentEntries).toHaveLength(2);
    for (const entry of parentEntries) {
      expect(entry.recordedByUserId).toBeUndefined();
    }

    // Admin can delete an entry cleanly
    const adminDeleteRes = await request(app)
      .delete(`/api/exams/progressive-reports/${importedId}`)
      .set('Authorization', `Bearer ${oakAdminToken}`);
    expect(adminDeleteRes.status).toBe(200);
    expect(adminDeleteRes.body.deleted).toBe(true);

    // St. Raphael seeded parent sees longitudinal progressiveReports for their child
    await store.resetForTests({ empty: false, includeLargeTenants: true });
    const stRaphParentPass = ST_RAPHAEL_DEFAULT_PASSWORDS['parent.kamau@straphael.ac.ke'];
    const stRaphParentRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'parent.kamau@straphael.ac.ke',
        password: stRaphParentPass,
      });
    expect(stRaphParentRes.status).toBe(200);
    let stRaphParentToken = stRaphParentRes.body.token as string;
    if (stRaphParentRes.body.user.mustChangePassword) {
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
      .set('x-tenant-id', ST_RAPHAEL_TENANT_ID);
    expect(stRaphWs.status).toBe(200);
    expect(Array.isArray(stRaphWs.body.progressiveReports)).toBe(true);
    expect(stRaphWs.body.progressiveReports.length).toBeGreaterThan(0);
    for (const p of stRaphWs.body.progressiveReports) {
      expect(p.recordedByUserId).toBeUndefined();
    }
  });
});
