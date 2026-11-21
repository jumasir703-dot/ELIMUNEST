import { describe, expect, it } from 'vitest';
import {
  solveTimetable,
  type SolverDay,
  type SolverInput,
  type SolverLesson,
  type SolverPlacement,
} from './timetableSolver.ts';

const DAYS: SolverDay[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];

/** Independent verifier of every hard rule, so the tests do not trust the solver's own bookkeeping. */
function verify(input: SolverInput, placements: SolverPlacement[]) {
  const seen = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) || 0) + 1);
  const cls = new Map<string, number>();
  const tch = new Map<string, number>();
  const room = new Map<string, number>();
  const tDay = new Map<string, number>();
  for (const p of placements) {
    seen(cls, `${p.grade}|${p.section}|${p.day}|${p.period}`);
    seen(tch, `${p.teacherId}|${p.day}|${p.period}`);
    if (p.room) seen(room, `${p.room}|${p.day}|${p.period}`);
    seen(tDay, `${p.teacherId}|${p.day}`);
    const unav = input.teachers[p.teacherId]?.unavailable || [];
    expect(unav.some((u) => u.day === p.day && u.period === p.period), 'teacher placed while unavailable').toBe(false);
  }
  for (const [k, n] of cls) expect(n, `class clash ${k}`).toBe(1);
  for (const [k, n] of tch) expect(n, `teacher clash ${k}`).toBe(1);
  for (const [k, n] of room) expect(n, `room clash ${k}`).toBe(1);
  for (const [k, n] of tDay) {
    const tid = k.split('|')[0];
    const max = input.teachers[tid]?.maxPerDay;
    if (max !== undefined) expect(n, `teacher max/day ${k}`).toBeLessThanOrEqual(max);
  }
}

function school(classes: number, teachers: number): { lessons: SolverLesson[]; teacherIds: string[] } {
  const subjects = ['Maths', 'English', 'Kiswahili', 'Science', 'Social', 'CRE', 'Agri', 'Art'];
  const teacherIds = Array.from({ length: teachers }, (_, i) => `t${i}`);
  const lessons: SolverLesson[] = [];
  for (let c = 0; c < classes; c++) {
    subjects.forEach((s, i) => {
      lessons.push({
        id: `l-${c}-${i}`,
        grade: `Grade ${7 + Math.floor(c / 2)}`,
        section: c % 2 === 0 ? 'A' : 'B',
        subject: s,
        teacherId: teacherIds[(i * 3 + c) % teachers],
        periodsPerWeek: i < 3 ? 5 : 3,
      });
    });
  }
  return { lessons, teacherIds };
}

const base = (lessons: SolverLesson[], teachers: SolverInput['teachers'] = {}): SolverInput => ({
  lessons,
  days: DAYS,
  periods: PERIODS,
  doubleStarts: [1, 3, 5, 7],
  rooms: [],
  teachers,
  seed: 3,
});

describe('timetable solver', () => {
  it('places a realistic school with zero clashes', () => {
    const { lessons } = school(8, 16);
    const input = base(lessons);
    const r = solveTimetable(input);
    expect(r.unplaced).toEqual([]);
    expect(r.placements.length).toBe(lessons.reduce((s, l) => s + l.periodsPerWeek, 0));
    verify(input, r.placements);
  });

  it('is deterministic for a given seed', () => {
    const { lessons } = school(4, 8);
    const a = solveTimetable(base(lessons));
    const b = solveTimetable(base(lessons));
    expect(a.placements).toEqual(b.placements);
  });

  it('respects teacher availability and max lessons per day', () => {
    const { lessons } = school(6, 12);
    const teachers: SolverInput['teachers'] = {
      t0: { unavailable: PERIODS.map((p) => ({ day: 'Friday' as SolverDay, period: p })), maxPerDay: 5 },
      t1: { unavailable: [{ day: 'Monday', period: 1 }, { day: 'Monday', period: 2 }], maxPerDay: 6 },
    };
    const input = base(lessons, teachers);
    const r = solveTimetable(input);
    verify(input, r.placements);
    expect(r.placements.some((p) => p.teacherId === 't0' && p.day === 'Friday')).toBe(false);
  });

  it('keeps double periods together and never across a break', () => {
    const lessons: SolverLesson[] = [
      { id: 'sci', grade: 'Grade 8', section: 'A', subject: 'Science', teacherId: 't0', periodsPerWeek: 5, doubleLessons: 2 },
      { id: 'mat', grade: 'Grade 8', section: 'A', subject: 'Maths', teacherId: 't1', periodsPerWeek: 5 },
    ];
    const input = base(lessons);
    const r = solveTimetable(input);
    expect(r.unplaced).toEqual([]);
    verify(input, r.placements);
    const sci = r.placements.filter((p) => p.lessonId === 'sci');
    const byDay = new Map<string, number[]>();
    sci.forEach((p) => byDay.set(p.day, [...(byDay.get(p.day) || []), p.period]));
    const doubles = [...byDay.values()].filter((ps) => ps.length >= 2);
    expect(doubles.length).toBeGreaterThanOrEqual(2);
    for (const ps of doubles) {
      const sorted = [...ps].sort((a, b) => a - b);
      // every double starts on an allowed start period and is consecutive
      expect([1, 3, 5, 7]).toContain(sorted[0]);
      expect(sorted[1]).toBe(sorted[0] + 1);
    }
  });

  it('never moves locked lessons and counts them towards the weekly total', () => {
    const lessons: SolverLesson[] = [
      { id: 'a', grade: 'Grade 8', section: 'A', subject: 'Maths', teacherId: 't0', periodsPerWeek: 5 },
      { id: 'b', grade: 'Grade 8', section: 'B', subject: 'Maths', teacherId: 't0', periodsPerWeek: 5 },
    ];
    const locked: SolverPlacement[] = [
      { lessonId: 'a', grade: 'Grade 8', section: 'A', subject: 'Maths', teacherId: 't0', room: '', day: 'Monday', period: 1 },
      { lessonId: 'a', grade: 'Grade 8', section: 'A', subject: 'Maths', teacherId: 't0', room: '', day: 'Tuesday', period: 1 },
    ];
    const input = { ...base(lessons), locked };
    const r = solveTimetable(input);
    // only NEW placements are returned: 3 of 5 for 'a' (2 are locked), all 5 for 'b'
    const a = r.placements.filter((p) => p.lessonId === 'a');
    expect(a.length).toBe(3);
    expect(r.placements.filter((p) => p.lessonId === 'b').length).toBe(5);
    verify(input, [...locked, ...r.placements]);
    // nothing new may land on the locked slots
    expect(a.some((p) => (p.day === 'Monday' || p.day === 'Tuesday') && p.period === 1)).toBe(false);
    // the same teacher teaches 'b' too, so 'b' must also avoid the locked slots
    expect(r.placements.some((p) => (p.day === 'Monday' || p.day === 'Tuesday') && p.period === 1)).toBe(false);
  });

  it('reports lessons it cannot place, with a reason, instead of breaking rules', () => {
    // one teacher, two classes, 25 periods each > 40 slots/week available to that single teacher
    const lessons: SolverLesson[] = ['A', 'B'].flatMap((sec) =>
      ['Maths', 'English', 'Science', 'Social', 'CRE'].map((s, i) => ({
        id: `${sec}${i}`,
        grade: 'Grade 8',
        section: sec,
        subject: s,
        teacherId: 'solo',
        periodsPerWeek: 5,
      }))
    );
    const input = base(lessons);
    const r = solveTimetable(input);
    verify(input, r.placements);
    expect(r.unplaced.length).toBeGreaterThan(0);
    expect(r.unplaced.reduce((s, u) => s + u.missingPeriods, 0)).toBe(50 - 40);
    expect(r.unplaced[0].reason).toMatch(/teacher/i);
    expect(r.warnings.join(' ')).toMatch(/solo/);
  });

  it('treats fixed slots of other classes as busy', () => {
    const lessons: SolverLesson[] = [
      { id: 'a', grade: 'Grade 8', section: 'A', subject: 'Maths', teacherId: 't0', periodsPerWeek: 5 },
    ];
    const fixed: SolverPlacement[] = PERIODS.slice(0, 7).map((p) => ({
      lessonId: 'x', grade: 'Grade 9', section: 'A', subject: 'Maths', teacherId: 't0', room: '', day: 'Monday' as SolverDay, period: p,
    }));
    const input = { ...base(lessons), fixed };
    const r = solveTimetable(input);
    verify(input, [...fixed, ...r.placements]);
    expect(r.placements.filter((p) => p.day === 'Monday').every((p) => p.period === 8)).toBe(true);
  });

  it('respects rooms: no two lessons share a room at the same time', () => {
    const { lessons } = school(4, 8);
    const input = { ...base(lessons), rooms: ['R1', 'R2', 'R3', 'R4'] };
    const r = solveTimetable(input);
    verify(input, r.placements);
    expect(r.placements.every((p) => p.room !== '')).toBe(true);
  });

  it('enforces subject allowedPeriods (notBefore / notAfter time windows) including doubles', () => {
    const lessons: SolverLesson[] = [
      {
        id: 'lab-sci',
        grade: 'Grade 8',
        section: 'A',
        subject: 'Integrated Science',
        teacherId: 't0',
        periodsPerWeek: 4,
        doubleLessons: 1,
        allowedPeriods: [1, 2, 3, 4], // Morning only (not after lunch)
      },
      {
        id: 'games',
        grade: 'Grade 8',
        section: 'A',
        subject: 'PE & Games',
        teacherId: 't1',
        periodsPerWeek: 3,
        allowedPeriods: [7, 8], // Afternoon only
      },
    ];
    const input = base(lessons);
    const r = solveTimetable(input);
    expect(r.unplaced).toEqual([]);
    verify(input, r.placements);
    const sci = r.placements.filter((p) => p.lessonId === 'lab-sci');
    const games = r.placements.filter((p) => p.lessonId === 'games');
    expect(sci.every((p) => [1, 2, 3, 4].includes(p.period))).toBe(true);
    expect(games.every((p) => [7, 8].includes(p.period))).toBe(true);
  });

  it('schedules optional subject groups in parallel on the same class slots without clashes', () => {
    const lessons: SolverLesson[] = [
      // 37 regular periods + 3 parallel optional subjects (counted once = 40 class slots total)
      { id: 'eng', grade: 'Grade 8', section: 'A', subject: 'English', teacherId: 't0', periodsPerWeek: 7 },
      { id: 'mat', grade: 'Grade 8', section: 'A', subject: 'Mathematics', teacherId: 't1', periodsPerWeek: 7 },
      { id: 'kis', grade: 'Grade 8', section: 'A', subject: 'Kiswahili', teacherId: 't2', periodsPerWeek: 7 },
      { id: 'sci', grade: 'Grade 8', section: 'A', subject: 'Science', teacherId: 't3', periodsPerWeek: 8 },
      { id: 'soc', grade: 'Grade 8', section: 'A', subject: 'Social', teacherId: 't4', periodsPerWeek: 8 },
      { id: 'cre', grade: 'Grade 8', section: 'A', subject: 'CRE', teacherId: 't5', periodsPerWeek: 3, optionalGroupId: 'opt-rel' },
      { id: 'ire', grade: 'Grade 8', section: 'A', subject: 'IRE', teacherId: 't6', periodsPerWeek: 3, optionalGroupId: 'opt-rel' },
      { id: 'hre', grade: 'Grade 8', section: 'A', subject: 'HRE', teacherId: 't7', periodsPerWeek: 3, optionalGroupId: 'opt-rel' },
    ];
    const input = {
      ...base(lessons),
      rooms: ['R1', 'R2', 'R3', 'R4'],
    };
    const r = solveTimetable(input);
    expect(r.unplaced).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.placements.length).toBe(37 + 9);

    // Every teacher & room still has zero clashes
    const tch = new Set<string>();
    const rm = new Set<string>();
    for (const p of r.placements) {
      const tk = `${p.teacherId}|${p.day}|${p.period}`;
      const rk = `${p.room}|${p.day}|${p.period}`;
      expect(tch.has(tk)).toBe(false);
      expect(rm.has(rk)).toBe(false);
      tch.add(tk);
      rm.add(rk);
    }

    // All three optional subjects share the exact same 3 (day, period) class slots
    const slotKey = (p: SolverPlacement) => `${p.day}|${p.period}`;
    const creSlots = new Set(r.placements.filter((p) => p.lessonId === 'cre').map(slotKey));
    const ireSlots = new Set(r.placements.filter((p) => p.lessonId === 'ire').map(slotKey));
    const hreSlots = new Set(r.placements.filter((p) => p.lessonId === 'hre').map(slotKey));
    expect(creSlots.size).toBe(3);
    expect(ireSlots).toEqual(creSlots);
    expect(hreSlots).toEqual(creSlots);
  });

  it('respects custom period layout and custom doubleStarts', () => {
    const lessons: SolverLesson[] = [
      { id: 'chem', grade: 'Grade 10', section: 'A', subject: 'Chemistry', teacherId: 't0', periodsPerWeek: 4, doubleLessons: 2 },
    ];
    const input: SolverInput = {
      lessons,
      days: DAYS,
      periods: [1, 2, 3, 4, 5, 6],
      doubleStarts: [1, 4], // breaks after P2 and P3, and after P5
      rooms: ['Lab 1'],
      teachers: {},
      seed: 11,
    };
    const r = solveTimetable(input);
    expect(r.unplaced).toEqual([]);
    const byDay = new Map<string, number[]>();
    r.placements.forEach((p) => byDay.set(p.day, [...(byDay.get(p.day) || []), p.period]));
    const pairs = [...byDay.values()].filter((ps) => ps.length === 2);
    expect(pairs.length).toBe(2);
    for (const pair of pairs) {
      const sorted = [...pair].sort((a, b) => a - b);
      expect([1, 4]).toContain(sorted[0]);
      expect(sorted[1]).toBe(sorted[0] + 1);
    }
  });
});
