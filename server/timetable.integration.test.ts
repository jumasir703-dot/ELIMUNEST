import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'enest-tt-'));
process.env.AUTH_SESSION_SECRET = 'x'.repeat(40);

const { TenantStore } = await import('./store.ts');

describe('timetable: lesson cards -> constraints -> solver (through TenantStore)', () => {
  const store = new TenantStore();
  let tenantId = '';

  beforeAll(async () => {
    await store.ensureHydrated();
    const t = store.createTenant({
      name: 'Test Academy',
      curriculum: 'Kenyan CBC',
      academicYear: '2026–2027',
      currentTerm: 'Term 1',
      plan: 'Growth',
      location: 'Eldoret, KE',
      grades: ['Grade 7', 'Grade 8'],
      subjects: ['Mathematics', 'English', 'Kiswahili', 'Integrated Science', 'Social Studies'],
      rooms: [],
      leadTeacherName: 'Lead Teacher',
      leadTeacherEmail: 'lead@test.ac.ke',
    });
    tenantId = t.id;
    const subjects = ['Mathematics', 'English', 'Kiswahili', 'Integrated Science', 'Social Studies'];
    // two specialists per subject so every class has someone qualified
    subjects.forEach((s, i) => {
      store.addTeacher(tenantId, { name: `${s} Teacher A`, subjects: [s] });
      store.addTeacher(tenantId, { name: `${s} Teacher B`, subjects: [s] });
      void i;
    });
  });

  const slots = () => store.exportDatabaseState().state.timetable.filter((s) => s.tenantId === tenantId);

  function assertNoClashes() {
    const key = (...p: Array<string | number>) => p.join('|');
    const seen = { cls: new Set<string>(), tch: new Set<string>() };
    for (const s of slots()) {
      const c = key(s.grade, s.section, s.day, s.period);
      const t = key(s.teacherId, s.day, s.period);
      expect(seen.cls.has(c), `class clash ${c}`).toBe(false);
      expect(seen.tch.has(t), `teacher clash ${t}`).toBe(false);
      seen.cls.add(c);
      seen.tch.add(t);
    }
  }

  it('builds lesson cards from the curriculum', () => {
    const r = store.buildTimetableLessonsFromCurriculum(tenantId, { grades: ['Grade 8'] });
    expect(r.created).toBeGreaterThan(0);
    const lessons = store.getTimetableLessons(tenantId);
    expect(lessons.every((l) => l.grade === 'Grade 8')).toBe(true);
    // both streams get cards
    expect(new Set(lessons.map((l) => l.section)).size).toBe(2);
  });

  it('validates lesson cards', () => {
    const t = store.exportDatabaseState().state.tenants.find((x) => x.id === tenantId)!;
    expect(() =>
      store.upsertTimetableLesson(tenantId, { grade: 'Grade 8', section: 'A', subject: 'Mathematics', teacherId: 'nope', periodsPerWeek: 5 })
    ).toThrow(/teacher/i);
    expect(() =>
      store.upsertTimetableLesson(tenantId, { grade: 'Grade 8', section: 'A', subject: 'Mathematics', teacherId: t.teachers[0].id, periodsPerWeek: 99 })
    ).toThrow(/between 1 and 40/);
  });

  it('solves with no clashes and honours teacher availability', () => {
    const t = store.exportDatabaseState().state.tenants.find((x) => x.id === tenantId)!;
    const blocked = t.teachers[1];
    const unavailable = (['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const).map((day) => ({ day, period: 1 }));
    store.setTeacherAvailability(tenantId, blocked.id, { unavailable, maxLessonsPerDay: 5 });

    const r = store.solveTimetableFromLessons(tenantId, { grades: ['Grade 8'], seed: 5 });
    expect(r.unplaced).toEqual([]);
    expect(r.placedPeriods).toBe(r.totalPeriods);
    assertNoClashes();
    expect(slots().some((s) => s.teacherId === blocked.id && s.period === 1)).toBe(false);
    expect(slots().every((s) => s.lessonId)).toBe(true);
  });

  it('keeps locked lessons when re-solving and still has no clashes', () => {
    const before = slots().filter((s) => s.section === 'A');
    const lockIds = before.slice(0, 6).map((s) => s.id);
    store.setTimetableSlotsLocked(tenantId, { slotIds: lockIds, locked: true });
    const lockedBefore = slots().filter((s) => s.locked).map((s) => `${s.day}|${s.period}|${s.grade}|${s.section}|${s.subject}|${s.teacherId}`).sort();

    const r = store.solveTimetableFromLessons(tenantId, { grades: ['Grade 8'], seed: 99 });
    expect(r.unplaced).toEqual([]);
    const lockedAfter = slots().filter((s) => s.locked).map((s) => `${s.day}|${s.period}|${s.grade}|${s.section}|${s.subject}|${s.teacherId}`).sort();
    expect(lockedAfter).toEqual(lockedBefore);
    expect(lockedAfter.length).toBe(6);
    assertNoClashes();
    // total periods per lesson are exactly the weekly counts (locked ones are not duplicated)
    const lessons = store.getTimetableLessons(tenantId);
    for (const l of lessons) {
      const n = slots().filter((s) => s.lessonId === l.id || (s.locked && s.grade === l.grade && s.section === l.section && s.subject === l.subject && s.teacherId === l.teacherId)).length;
      expect(n, `${l.grade} ${l.section} ${l.subject}`).toBe(l.periodsPerWeek);
    }
  });

  it('solving one grade does not disturb or clash with another grade', () => {
    store.buildTimetableLessonsFromCurriculum(tenantId, { grades: ['Grade 7'] });
    const g8Before = slots().filter((s) => s.grade === 'Grade 8').map((s) => s.id).sort();
    const r = store.solveTimetableFromLessons(tenantId, { grades: ['Grade 7'], seed: 7 });
    expect(r.unplaced).toEqual([]);
    expect(slots().filter((s) => s.grade === 'Grade 8').map((s) => s.id).sort()).toEqual(g8Before);
    assertNoClashes();
  });

  it('removes lesson cards when their teacher is deleted', () => {
    const lesson = store.getTimetableLessons(tenantId)[0];
    store.deleteTeacher(tenantId, lesson.teacherId);
    expect(store.getTimetableLessons(tenantId).some((l) => l.teacherId === lesson.teacherId)).toBe(false);
  });
  it('manual edits respect teacher availability and daily limits', () => {
    store.addTeacher(tenantId, { name: 'Constrained Teacher', subjects: ['Mathematics'] });
    const t = store.exportDatabaseState().state.tenants.find((x) => x.id === tenantId)!;
    const teacher = t.teachers.find((x) => x.name === 'Constrained Teacher')!;
    store.setTeacherAvailability(tenantId, teacher.id, {
      unavailable: [{ day: 'Monday', period: 1 }],
      maxLessonsPerDay: 1,
    });
    const base = { grade: 'Grade 7', section: 'Z', subject: 'Mathematics', teacherId: teacher.id };
    expect(() =>
      store.upsertTimetableSlot(tenantId, { ...base, day: 'Monday', period: 1, room: 'Manual Room 1' })
    ).toThrow(/unavailable/i);
    store.upsertTimetableSlot(tenantId, { ...base, day: 'Tuesday', period: 2, room: 'Manual Room 2' });
    expect(() =>
      store.upsertTimetableSlot(tenantId, { ...base, day: 'Tuesday', period: 3, room: 'Manual Room 3' })
    ).toThrow(/limit 1/);
  });

  it('quick generate with replace keeps locked lessons', () => {
    const lockedSlot = slots().find((s) => s.grade === 'Grade 8')!;
    store.setTimetableSlotsLocked(tenantId, { slotIds: [lockedSlot.id], locked: true });
    store.generateTimetable(tenantId, { scope: 'grade', grade: 'Grade 8', replaceExisting: true });
    const after = slots().find((s) => s.id === lockedSlot.id);
    expect(after?.locked).toBe(true);
    expect(after?.subject).toBe(lockedSlot.subject);
  });
});
