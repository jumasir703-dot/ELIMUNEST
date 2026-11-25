import { describe, expect, it } from 'vitest';
import { createSeedDatabase } from '../server/seed.ts';
import { ST_RAPHAEL_DEFAULT_PASSWORDS, ST_RAPHAEL_TENANT_ID } from '../server/seedStRaphael.ts';
import { verifyPassword, DEFAULT_DEV_BOOTSTRAP_PASSWORD, DEVELOPER_EMAIL } from '../server/middleware/adminAuth.ts';
import {
  getClusterForGrade,
  getSubjectsForGrade,
  getTeacherAssignedSubjectsForCohort,
  isTeacherAssignedToCohort,
} from '../src/shared/types.ts';

describe('St. Raphael Academy Seed Integrity, Teacher Coverage & Deterministic Passwords', () => {
  it('seeds St. Raphael at 80% capacity with 65 gap-free teachers, collision-free timetable, and valid default passwords', async () => {
    const { state, devCredentials } = await createSeedDatabase({
      empty: false,
      includeLargeTenants: true,
    });

    // 1. Developer + all St. Raphael accounts exist and verify against default passwords
    const devUser = state.users.find((u) => u.email === DEVELOPER_EMAIL);
    expect(devUser).toBeDefined();
    expect(await verifyPassword(DEFAULT_DEV_BOOTSTRAP_PASSWORD, devUser!.passwordHash)).toBe(true);

    for (const [email, expectedPw] of Object.entries(ST_RAPHAEL_DEFAULT_PASSWORDS)) {
      const user = state.users.find((u) => u.email === email);
      expect(user, `Missing user ${email}`).toBeDefined();
      expect(await verifyPassword(expectedPw, user!.passwordHash)).toBe(true);
    }
    expect(devCredentials.some((c) => c.email === 'juma.j@straphael.ac.ke')).toBe(true);

    // 2. St. Raphael tenant & 80% capacity
    const tenant = state.tenants.find((t) => t.id === ST_RAPHAEL_TENANT_ID)!;
    expect(tenant).toBeDefined();
    expect(tenant.learnerCap).toBe(2500);
    expect(tenant.teachers).toHaveLength(65);
    expect(tenant.nonTeachingStaff).toHaveLength(20);

    const strStudents = state.students.filter((s) => s.tenantId === ST_RAPHAEL_TENANT_ID && !s.deleted);
    const activeStudents = strStudents.filter((s) => s.status === 'Active' || s.status === 'On Leave');
    expect(activeStudents).toHaveLength(2000);
    expect(strStudents).toHaveLength(2016);

    // Every student has registeredSubjects matching their grade's levelSubjects
    for (const stu of strStudents) {
      const expectedSubs = getSubjectsForGrade(tenant, stu.grade);
      expect(stu.registeredSubjects).toEqual(expectedSubs);
    }

    // 3. Zero teacher subject coverage gaps across all 48 classes (Playgroup - Grade 9, A - D)
    const strSlots = state.timetable.filter((s) => s.tenantId === ST_RAPHAEL_TENANT_ID);
    for (const grade of tenant.grades) {
      const requiredSubs = getSubjectsForGrade(tenant, grade);
      const streams = tenant.gradeStreams?.[grade] || tenant.sections;
      expect(streams).toEqual(['A', 'B', 'C', 'D']);

      for (const section of streams) {
        const assignedTeachers = tenant.teachers.filter((t) =>
          isTeacherAssignedToCohort(t, grade, section, [])
        );
        expect(
          assignedTeachers.length,
          `${grade} ${section} must have assigned teachers`
        ).toBeGreaterThan(0);

        const coveredSubs = new Set<string>();
        for (const t of assignedTeachers) {
          const tSubs = getTeacherAssignedSubjectsForCohort(tenant, t, grade, section, []);
          tSubs.forEach((s) => coveredSubs.add(s));
        }
        for (const sub of requiredSubs) {
          expect(
            coveredSubs.has(sub),
            `Coverage gap in ${grade} ${section}: missing teacher for "${sub}" (cluster ${getClusterForGrade(grade)})`
          ).toBe(true);
        }
      }
    }

    // 4. Zero timetable collisions (teacher, room, class) across all St. Raphael slots
    expect(strSlots.length).toBeGreaterThanOrEqual(240);
    const seenTeacher = new Set<string>();
    const seenRoom = new Set<string>();
    const seenClass = new Set<string>();
    for (const slot of strSlots) {
      const tKey = `${slot.day}|${slot.period}|${slot.teacherId}`;
      const rKey = `${slot.day}|${slot.period}|${slot.room}`;
      const cKey = `${slot.day}|${slot.period}|${slot.grade}|${slot.section}`;
      expect(seenTeacher.has(tKey), `Teacher collision: ${tKey}`).toBe(false);
      expect(seenRoom.has(rKey), `Room collision: ${rKey}`).toBe(false);
      expect(seenClass.has(cKey), `Class collision: ${cKey}`).toBe(false);
      seenTeacher.add(tKey);
      seenRoom.add(rKey);
      seenClass.add(cKey);
    }
  });
});
