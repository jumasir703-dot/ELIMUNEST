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

  it('enforces subject time windows, double allocations, and optional parallel groups through TenantStore', () => {
    store.addTeacher(tenantId, { name: 'CRE Specialist', subjects: ['CRE'] });
    store.addTeacher(tenantId, { name: 'IRE Specialist', subjects: ['IRE'] });
    const t = store.exportDatabaseState().state.tenants.find((x) => x.id === tenantId)!;
    const creT = t.teachers.find((x) => x.name === 'CRE Specialist')!;
    const ireT = t.teachers.find((x) => x.name === 'IRE Specialist')!;

    store.setSubjectTimetableConfig(tenantId, {
      subjectConstraints: [
        {
          id: 'rule-sci-am',
          subject: 'Integrated Science',
          grade: 'Grade 7',
          doubleLessons: 1,
          notBeforeTime: '08:40',
          notAfterTime: '12:40',
        },
      ],
      optionalSubjectGroups: [
        {
          id: 'opt-rel',
          name: 'Religious Ed Block',
          grade: 'Grade 7',
          subjects: ['CRE', 'IRE'],
        },
      ],
      syncLessons: true,
    });

    // Manual edit before notBeforeTime (08:00 < 08:40) is rejected
    const sciT = t.teachers.find((x) => x.subjects.includes('Integrated Science'))!;
    expect(() =>
      store.upsertTimetableSlot(tenantId, {
        grade: 'Grade 7',
        section: 'Y',
        subject: 'Integrated Science',
        teacherId: sciT.id,
        day: 'Wednesday',
        period: 1,
        room: 'Lab Y',
      })
    ).toThrow(/Cannot appear before 08:40/i);

    // Parallel manual scheduling for optional group subjects in same (day, period) is permitted
    store.upsertTimetableSlot(tenantId, {
      grade: 'Grade 7',
      section: 'Y',
      subject: 'CRE',
      teacherId: creT.id,
      day: 'Thursday',
      period: 4,
      room: 'Room C1',
    });
    const parallelSlot = store.upsertTimetableSlot(tenantId, {
      grade: 'Grade 7',
      section: 'Y',
      subject: 'IRE',
      teacherId: ireT.id,
      day: 'Thursday',
      period: 4,
      room: 'Room I1',
    });
    expect(parallelSlot.subject).toBe('IRE');

    // Non-grouped subject in that same occupied slot still clashes
    expect(() =>
      store.upsertTimetableSlot(tenantId, {
        grade: 'Grade 7',
        section: 'Y',
        subject: 'Integrated Science',
        teacherId: sciT.id,
        day: 'Thursday',
        period: 4,
        room: 'Lab Y2',
      })
    ).toThrow(/Class Conflict/i);
  });

  it('allows each tenant to customize their daily bell schedule and slot times', () => {
    const customSchedule = [
      { kind: 'lesson' as const, label: 'Morning Block 1', startTime: '07:45', endTime: '08:30', time: '07:45 – 08:30' },
      { kind: 'lesson' as const, label: 'Morning Block 2', startTime: '08:30', endTime: '09:15', time: '08:30 – 09:15' },
      { kind: 'break' as const, label: 'Tea Break', startTime: '09:15', endTime: '09:45', time: '09:15 – 09:45' },
      { kind: 'lesson' as const, label: 'Midday Block 3', startTime: '09:45', endTime: '10:30', time: '09:45 – 10:30' },
      { kind: 'lesson' as const, label: 'Midday Block 4', startTime: '10:30', endTime: '11:15', time: '10:30 – 11:15' },
    ];
    const saved = store.setTimetableDaySchedule(tenantId, {
      bellSchedule: customSchedule,
      dayOpeningNote: '07:30 Morning Devotion',
      dayClosingNote: '11:30 Clubs',
    });
    expect(saved.bellSchedule.filter((r) => r.kind === 'lesson')).toHaveLength(4);
    expect(saved.dayOpeningNote).toBe('07:30 Morning Devotion');

    const { teacher: customTeacher } = store.addTeacher(tenantId, {
      name: 'Custom Schedule Teacher',
      subjects: ['Mathematics'],
    });

    // Period 5 no longer exists in this custom 4-period schedule
    expect(() =>
      store.upsertTimetableSlot(tenantId, {
        grade: 'Grade 7',
        section: 'W',
        subject: 'Mathematics',
        teacherId: customTeacher.id,
        day: 'Monday',
        period: 5,
        room: 'Room W1',
      })
    ).toThrow(/does not exist in this school's daily bell schedule/i);

    // Period 1 adopts the tenant's custom 07:45 - 08:30 timestamps
    const customSlot = store.upsertTimetableSlot(tenantId, {
      grade: 'Grade 7',
      section: 'W',
      subject: 'Mathematics',
      teacherId: customTeacher.id,
      day: 'Monday',
      period: 1,
      room: 'Room W1',
    });
    expect(customSlot.startTime).toBe('07:45');
    expect(customSlot.endTime).toBe('08:30');
  });
});
