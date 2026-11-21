/**
 * Timetable constraint solver.
 *
 * Inputs are "lesson cards" (class + subject + teacher + periods per week, optionally some of them
 * as double periods, time window restrictions, and optional parallel subject group IDs),
 * teacher availability, rooms, custom bell schedule periods, and already-locked lessons.
 *
 * Hard rules:
 *   - a teacher and a room can only be in one place at a time
 *   - a class can only have one lesson at a time, EXCEPT lessons sharing the same optionalGroupId
 *     (which are taught in parallel during the same class slot)
 *   - teachers are never scheduled in their unavailable slots, nor above their max lessons per day
 *   - double periods never cross a break (they start on a configured "double start" period)
 *   - lessons respect subject time window restrictions (allowedPeriods from notBefore/notAfter)
 *   - a subject appears at most `maxPerDay` times per class per day (relaxed once if needed)
 *
 * Soft preferences: parallel optional subjects align on the same slots, subjects spread across the
 * week, balanced days, few gaps for classes and teachers.
 *
 * Pure and deterministic for a given seed: no I/O, safe to unit-test.
 */

export type SolverDay = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday';

export interface SolverLesson {
  id: string;
  grade: string;
  section: string;
  subject: string;
  teacherId: string;
  periodsPerWeek: number;
  /** How many of the weekly periods are taught as 2-period blocks (each block uses 2 periods). */
  doubleLessons?: number;
  /** Fixed room for this lesson (optional). Otherwise any free room is used. */
  room?: string;
  /** Max periods of this subject per class per day. Default: ceil(periodsPerWeek / days). */
  maxPerDay?: number;
  /** Allowed period numbers for this subject/lesson (computed from notBeforeTime/notAfterTime). */
  allowedPeriods?: number[];
  /** Optional subject group identifier; lessons with the same (class, optionalGroupId) share slots. */
  optionalGroupId?: string;
}

export interface SolverPlacement {
  lessonId: string;
  grade: string;
  section: string;
  subject: string;
  teacherId: string;
  room: string;
  day: SolverDay;
  period: number;
}

export interface TeacherConstraint {
  unavailable?: Array<{ day: SolverDay; period: number }>;
  maxPerDay?: number;
}

export interface SolverInput {
  lessons: SolverLesson[];
  days: SolverDay[];
  /** Teaching periods in order, e.g. [1,2,3,4,5,6,7,8]. */
  periods: number[];
  /** Periods on which a double block may start (so it never spans a break), e.g. [1,3,5,7]. */
  doubleStarts: number[];
  rooms: string[];
  teachers: Record<string, TeacherConstraint>;
  /** Lessons that must stay exactly where they are (they count towards their lesson's weekly total). */
  locked?: SolverPlacement[];
  /** Occupied slots belonging to nothing we are solving (other classes, orphaned lessons): they only block. */
  fixed?: SolverPlacement[];
  seed?: number;
  attempts?: number;
  /** Wall-clock budget for all attempts. */
  timeBudgetMs?: number;
}

export interface UnplacedLesson {
  lessonId: string;
  grade: string;
  section: string;
  subject: string;
  teacherId: string;
  missingPeriods: number;
  reason: string;
}

export interface SolverResult {
  placements: SolverPlacement[];
  unplaced: UnplacedLesson[];
  warnings: string[];
  attemptsRun: number;
  placedPeriods: number;
  totalPeriods: number;
}

interface Block {
  id: string;
  lesson: SolverLesson;
  length: 1 | 2;
  maxPerDay: number;
}

interface Placed {
  block: Block;
  day: SolverDay;
  start: number;
  room: string;
  locked: boolean;
}

function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const classKey = (l: { grade: string; section: string }) => `${l.grade}::${l.section}`;

class Attempt {
  private classBusy = new Map<string, Placed[]>(); // `${class}|${day}|${period}`
  private teacherBusy = new Map<string, Placed>();
  private roomBusy = new Map<string, Placed>();
  private teacherDayCount = new Map<string, number>();
  private subjectDayCount = new Map<string, number>(); // `${class}|${subject}|${day}`
  private classDayPeriods = new Map<string, Map<number, number>>(); // `${class}|${day}` -> period -> count
  private teacherDayPeriods = new Map<string, Set<number>>();
  private groupSlots = new Map<string, Map<string, number>>(); // `${class}|${groupId}` -> `${day}|${period}` -> count
  placed: Placed[] = [];
  private unavailable = new Map<string, Set<string>>();
  private allowedPeriodSets = new Map<string, Set<number>>();
  private periodIndex = new Map<number, number>();
  private groupCap = new Map<string, number>(); // `${class}|${groupId}` -> max periodsPerWeek

  constructor(
    private input: SolverInput,
    private rng: () => number,
    private relaxCap: number
  ) {
    input.periods.forEach((p, i) => this.periodIndex.set(p, i));
    for (const [tid, c] of Object.entries(input.teachers)) {
      this.unavailable.set(tid, new Set((c.unavailable || []).map((u) => `${u.day}|${u.period}`)));
    }
    for (const l of input.lessons) {
      if (l.allowedPeriods) {
        this.allowedPeriodSets.set(l.id, new Set(l.allowedPeriods));
      }
      if (l.optionalGroupId) {
        const gk = `${classKey(l)}|${l.optionalGroupId}`;
        this.groupCap.set(gk, Math.max(this.groupCap.get(gk) || 0, l.periodsPerWeek));
      }
    }
  }

  private covers(start: number, length: 1 | 2): number[] | null {
    if (length === 1) return [start];
    const idx = this.periodIndex.get(start);
    if (idx === undefined || idx + 1 >= this.input.periods.length) return null;
    return [start, this.input.periods[idx + 1]];
  }

  /** Returns null when the spot is free, otherwise the reason (and optionally a movable blocker). */
  private check(
    block: Block,
    day: SolverDay,
    start: number,
    ignore?: Placed
  ): { reason: string; blocker?: Placed } | null {
    const ps = this.covers(start, block.length);
    if (!ps) return { reason: 'no double-period slot available' };
    if (block.length === 2 && !this.input.doubleStarts.includes(start)) {
      return { reason: 'no double-period slot available' };
    }

    const allowed = this.allowedPeriodSets.get(block.lesson.id);
    if (allowed) {
      for (const p of ps) {
        if (!allowed.has(p)) return { reason: 'subject time window restricted' };
      }
    }

    const ck = classKey(block.lesson);
    const tid = block.lesson.teacherId;
    const tc = this.input.teachers[tid] || {};
    const unav = this.unavailable.get(tid);

    for (const p of ps) {
      if (unav?.has(`${day}|${p}`)) return { reason: 'teacher is unavailable' };
    }
    if (tc.maxPerDay !== undefined) {
      const used = this.teacherDayCount.get(`${tid}|${day}`) || 0;
      const own =
        ignore && ignore.block.lesson.teacherId === tid && ignore.day === day
          ? ignore.block.length
          : 0;
      if (used - own + ps.length > tc.maxPerDay) {
        return { reason: "teacher's daily maximum reached" };
      }
    }
    for (const p of ps) {
      const t = this.teacherBusy.get(`${tid}|${day}|${p}`);
      if (t && t !== ignore) return { reason: 'teacher is already teaching', blocker: t };
    }

    const optGroup = block.lesson.optionalGroupId;
    for (const p of ps) {
      const existing = (this.classBusy.get(`${ck}|${day}|${p}`) || []).filter((x) => x !== ignore);
      if (existing.length > 0) {
        const incompatible = existing.find(
          (x) =>
            !optGroup ||
            x.block.lesson.optionalGroupId !== optGroup ||
            x.block.lesson.subject.toLowerCase() === block.lesson.subject.toLowerCase()
        );
        if (incompatible) {
          return { reason: 'class already has a lesson', blocker: incompatible };
        }
      }
    }

    // Keep parallel optional subjects aligned within the group's weekly slot budget
    if (optGroup) {
      const gk = `${ck}|${optGroup}`;
      const cap = this.groupCap.get(gk) || block.lesson.periodsPerWeek;
      const slotMap = this.groupSlots.get(gk);
      const currentDistinct = slotMap ? slotMap.size : 0;
      let newSlotsOpened = 0;
      for (const p of ps) {
        const sk = `${day}|${p}`;
        if (!slotMap?.has(sk)) {
          newSlotsOpened += 1;
        }
      }
      if (currentDistinct + newSlotsOpened > cap) {
        return { reason: 'optional subject group must share parallel slots' };
      }
    }

    const sub = this.subjectDayCount.get(`${ck}|${block.lesson.subject}|${day}`) || 0;
    const ownSub =
      ignore &&
      classKey(ignore.block.lesson) === ck &&
      ignore.block.lesson.subject === block.lesson.subject &&
      ignore.day === day
        ? ignore.block.length
        : 0;
    const cap = Math.max(block.maxPerDay + this.relaxCap, block.length);
    if (sub - ownSub + ps.length > cap) {
      return { reason: 'subject limit per day reached' };
    }

    return null;
  }

  private freeRoom(block: Block, day: SolverDay, ps: number[], ignore?: Placed): string | null {
    const fixed = block.lesson.room;
    const candidates = fixed ? [fixed] : this.input.rooms.length ? this.input.rooms : [''];
    for (const r of candidates) {
      if (!r) return '';
      let ok = true;
      for (const p of ps) {
        const o = this.roomBusy.get(`${r}|${day}|${p}`);
        if (o && o !== ignore) {
          ok = false;
          break;
        }
      }
      if (ok) return r;
    }
    return null;
  }

  private gapsAfter(periods: Iterable<number> | undefined, add: number[]): number {
    const all = new Set([...(periods || []), ...add]);
    if (all.size === 0) return 0;
    const idx = [...all].map((p) => this.periodIndex.get(p) ?? 0).sort((a, b) => a - b);
    return idx[idx.length - 1] - idx[0] + 1 - idx.length;
  }

  private score(block: Block, day: SolverDay, start: number): number {
    const ps = this.covers(start, block.length)!;
    const ck = classKey(block.lesson);
    const tid = block.lesson.teacherId;
    const sameSubject = this.subjectDayCount.get(`${ck}|${block.lesson.subject}|${day}`) || 0;
    const classPeriodMap = this.classDayPeriods.get(`${ck}|${day}`);
    const teacherPeriods = this.teacherDayPeriods.get(`${tid}|${day}`);
    let s = 0;
    s += sameSubject * 6; // spread a subject over the week
    s += (classPeriodMap?.size || 0) * 0.9; // balance class days
    s += this.gapsAfter(classPeriodMap?.keys(), ps) * 4; // avoid class gaps
    s += this.gapsAfter(teacherPeriods, ps) * 1.5; // avoid teacher gaps
    s += (this.teacherDayCount.get(`${tid}|${day}`) || 0) * 0.4; // balance teacher days

    // Strongly reward aligning optional subjects onto slots already opened by their parallel group
    if (block.lesson.optionalGroupId) {
      const slotMap = this.groupSlots.get(`${ck}|${block.lesson.optionalGroupId}`);
      for (const p of ps) {
        if (slotMap?.has(`${day}|${p}`)) {
          s -= 50;
        }
      }
    }

    s += this.rng() * 1.5; // jitter between attempts
    return s;
  }

  private add(block: Block, day: SolverDay, start: number, room: string, locked: boolean): Placed {
    const ps = this.covers(start, block.length)!;
    const pl: Placed = { block, day, start, room, locked };
    const ck = classKey(block.lesson);
    const tid = block.lesson.teacherId;
    for (const p of ps) {
      const cKey = `${ck}|${day}|${p}`;
      const list = this.classBusy.get(cKey) || [];
      list.push(pl);
      this.classBusy.set(cKey, list);

      this.teacherBusy.set(`${tid}|${day}|${p}`, pl);
      if (room) this.roomBusy.set(`${room}|${day}|${p}`, pl);

      let cDayMap = this.classDayPeriods.get(`${ck}|${day}`);
      if (!cDayMap) this.classDayPeriods.set(`${ck}|${day}`, (cDayMap = new Map()));
      cDayMap.set(p, (cDayMap.get(p) || 0) + 1);

      this.addTo(this.teacherDayPeriods, `${tid}|${day}`, p);

      if (block.lesson.optionalGroupId) {
        const gk = `${ck}|${block.lesson.optionalGroupId}`;
        let gMap = this.groupSlots.get(gk);
        if (!gMap) this.groupSlots.set(gk, (gMap = new Map()));
        gMap.set(`${day}|${p}`, (gMap.get(`${day}|${p}`) || 0) + 1);
      }
    }
    this.teacherDayCount.set(`${tid}|${day}`, (this.teacherDayCount.get(`${tid}|${day}`) || 0) + ps.length);
    const sk = `${ck}|${block.lesson.subject}|${day}`;
    this.subjectDayCount.set(sk, (this.subjectDayCount.get(sk) || 0) + ps.length);
    this.placed.push(pl);
    return pl;
  }

  private addTo(map: Map<string, Set<number>>, key: string, p: number) {
    let set = map.get(key);
    if (!set) map.set(key, (set = new Set()));
    set.add(p);
  }

  remove(pl: Placed) {
    const ps = this.covers(pl.start, pl.block.length)!;
    const ck = classKey(pl.block.lesson);
    const tid = pl.block.lesson.teacherId;
    for (const p of ps) {
      const cKey = `${ck}|${pl.day}|${p}`;
      const filtered = (this.classBusy.get(cKey) || []).filter((x) => x !== pl);
      if (filtered.length > 0) this.classBusy.set(cKey, filtered);
      else this.classBusy.delete(cKey);

      this.teacherBusy.delete(`${tid}|${pl.day}|${p}`);
      if (pl.room) this.roomBusy.delete(`${pl.room}|${pl.day}|${p}`);

      const cDayMap = this.classDayPeriods.get(`${ck}|${pl.day}`);
      if (cDayMap) {
        const prev = cDayMap.get(p) || 0;
        if (prev <= 1) cDayMap.delete(p);
        else cDayMap.set(p, prev - 1);
      }

      this.teacherDayPeriods.get(`${tid}|${pl.day}`)?.delete(p);

      if (pl.block.lesson.optionalGroupId) {
        const gk = `${ck}|${pl.block.lesson.optionalGroupId}`;
        const gMap = this.groupSlots.get(gk);
        if (gMap) {
          const sk = `${pl.day}|${p}`;
          const prev = gMap.get(sk) || 0;
          if (prev <= 1) gMap.delete(sk);
          else gMap.set(sk, prev - 1);
        }
      }
    }
    this.teacherDayCount.set(`${tid}|${pl.day}`, (this.teacherDayCount.get(`${tid}|${pl.day}`) || 0) - ps.length);
    const sk = `${ck}|${pl.block.lesson.subject}|${pl.day}`;
    this.subjectDayCount.set(sk, (this.subjectDayCount.get(sk) || 0) - ps.length);
    this.placed = this.placed.filter((x) => x !== pl);
  }

  addLocked(block: Block, day: SolverDay, start: number, room: string) {
    this.add(block, day, start, room, true);
  }

  /** Try to place a block at its best feasible spot. Returns false when none exists. */
  tryPlace(block: Block, avoid?: { day: SolverDay; start: number }): boolean {
    let best: { day: SolverDay; start: number; room: string; score: number } | null = null;
    for (const day of this.input.days) {
      for (const start of this.input.periods) {
        if (avoid && avoid.day === day && avoid.start === start) continue;
        if (this.check(block, day, start)) continue;
        const ps = this.covers(start, block.length)!;
        const room = this.freeRoom(block, day, ps);
        if (room === null) continue;
        const score = this.score(block, day, start);
        if (!best || score < best.score) best = { day, start, room, score };
      }
    }
    if (!best) return false;
    this.add(block, best.day, best.start, best.room, false);
    return true;
  }

  /** One-step repair: free a spot by moving the single movable block that is in the way. */
  tryEject(block: Block): boolean {
    for (const day of this.input.days) {
      for (const start of this.input.periods) {
        const fail = this.check(block, day, start);
        if (!fail || !fail.blocker || fail.blocker.locked) continue;
        const blocker = fail.blocker;
        const old = { day: blocker.day, start: blocker.start, room: blocker.room };
        this.remove(blocker);
        if (this.check(block, day, start)) {
          this.add(blocker.block, old.day, old.start, old.room, false);
          continue;
        }
        const ps = this.covers(start, block.length)!;
        const room = this.freeRoom(block, day, ps);
        if (room === null) {
          this.add(blocker.block, old.day, old.start, old.room, false);
          continue;
        }
        this.add(block, day, start, room, false);
        if (this.tryPlace(blocker.block, { day: old.day, start: old.start })) return true;
        const mine = this.placed[this.placed.length - 1];
        this.remove(mine);
        this.add(blocker.block, old.day, old.start, old.room, false);
      }
    }
    return false;
  }

  /** Most common reason this block cannot be placed anywhere (for reporting). */
  dominantReason(block: Block): string {
    const counts = new Map<string, number>();
    for (const day of this.input.days) {
      for (const start of this.input.periods) {
        const f = this.check(block, day, start);
        let reason = f?.reason;
        if (!f) {
          const ps = this.covers(start, block.length)!;
          if (this.freeRoom(block, day, ps) === null) reason = 'no free room';
          else continue;
        }
        counts.set(reason!, (counts.get(reason!) || 0) + 1);
      }
    }
    let top = 'no free slot';
    let max = 0;
    counts.forEach((n, r) => {
      if (n > max) {
        max = n;
        top = r;
      }
    });
    return top;
  }
}

function buildBlocks(lessons: SolverLesson[], days: number, lockedPeriods: Map<string, number>): Block[] {
  const blocks: Block[] = [];
  for (const l of lessons) {
    let remaining = Math.max(0, l.periodsPerWeek - (lockedPeriods.get(l.id) || 0));
    let doubles = Math.min(l.doubleLessons || 0, Math.floor(remaining / 2));
    const maxPerDay = l.maxPerDay ?? Math.max(1, Math.ceil(l.periodsPerWeek / days));
    let n = 0;
    while (doubles-- > 0) {
      blocks.push({ id: `${l.id}#d${n++}`, lesson: l, length: 2, maxPerDay: Math.max(2, maxPerDay) });
      remaining -= 2;
    }
    while (remaining-- > 0) {
      blocks.push({ id: `${l.id}#s${n++}`, lesson: l, length: 1, maxPerDay });
    }
  }
  return blocks;
}

function precheck(input: SolverInput): string[] {
  const warnings: string[] = [];
  const slotsPerWeek = input.days.length * input.periods.length;
  const classLoad = new Map<string, number>();
  const classOptGroups = new Map<string, Map<string, number>>();
  const teacherLoad = new Map<string, number>();

  for (const l of input.lessons) {
    const ck = classKey(l);
    if (l.optionalGroupId) {
      let gMap = classOptGroups.get(ck);
      if (!gMap) classOptGroups.set(ck, (gMap = new Map()));
      gMap.set(l.optionalGroupId, Math.max(gMap.get(l.optionalGroupId) || 0, l.periodsPerWeek));
    } else {
      classLoad.set(ck, (classLoad.get(ck) || 0) + l.periodsPerWeek);
    }
    teacherLoad.set(l.teacherId, (teacherLoad.get(l.teacherId) || 0) + l.periodsPerWeek);

    if (l.allowedPeriods) {
      const allowedWeekly = input.days.length * l.allowedPeriods.length;
      if (l.periodsPerWeek > allowedWeekly) {
        warnings.push(
          `${l.grade} · Stream ${l.section} ${l.subject} needs ${l.periodsPerWeek} periods/week, but its time restriction only allows ${allowedWeekly} slots/week.`
        );
      }
    }
  }
  for (const [ck, gMap] of classOptGroups) {
    let sum = classLoad.get(ck) || 0;
    gMap.forEach((v) => {
      sum += v;
    });
    classLoad.set(ck, sum);
  }

  classLoad.forEach((n, k) => {
    if (n > slotsPerWeek) {
      warnings.push(`${k.replace('::', ' · Stream ')} has ${n} lessons per week but only ${slotsPerWeek} time slots.`);
    }
  });
  teacherLoad.forEach((n, tid) => {
    const unav = input.teachers[tid]?.unavailable?.length || 0;
    const free = slotsPerWeek - unav;
    const cap = input.teachers[tid]?.maxPerDay !== undefined ? input.teachers[tid].maxPerDay! * input.days.length : free;
    if (n > Math.min(free, cap)) {
      warnings.push(`Teacher ${tid} is assigned ${n} lessons per week but can teach at most ${Math.min(free, cap)}.`);
    }
  });
  return warnings;
}

export function solveTimetable(input: SolverInput): SolverResult {
  const warnings = precheck(input);
  const lessonById = new Map(input.lessons.map((l) => [l.id, l]));
  const attemptsMax = Math.max(1, input.attempts ?? 24);
  const deadline = Date.now() + (input.timeBudgetMs ?? 2500);

  const lockedPeriods = new Map<string, number>();
  const lockedByKey = new Map<string, SolverPlacement[]>();
  for (const p of input.locked || []) {
    const lesson =
      lessonById.get(p.lessonId) ||
      input.lessons.find((l) => classKey(l) === classKey(p) && l.subject === p.subject && l.teacherId === p.teacherId);
    if (!lesson) continue;
    lockedPeriods.set(lesson.id, (lockedPeriods.get(lesson.id) || 0) + 1);
    const arr = lockedByKey.get(lesson.id) || [];
    arr.push(p);
    lockedByKey.set(lesson.id, arr);
  }

  const totalPeriods = input.lessons.reduce((s, l) => s + l.periodsPerWeek, 0);
  const teacherLoad = new Map<string, number>();
  input.lessons.forEach((l) => teacherLoad.set(l.teacherId, (teacherLoad.get(l.teacherId) || 0) + l.periodsPerWeek));

  const runPass = (blocks: Block[], rng: () => number, relaxCap: number) => {
    const att = new Attempt(input, rng, relaxCap);
    for (const [lid, list] of lockedByKey) {
      const lesson = lessonById.get(lid)!;
      for (const p of list) {
        att.addLocked({ id: `${lid}#locked`, lesson, length: 1, maxPerDay: lesson.maxPerDay ?? 99 }, p.day, p.period, p.room);
      }
    }
    (input.fixed || []).forEach((f, i) => {
      const lesson: SolverLesson = {
        id: `fixed-${i}`,
        grade: f.grade,
        section: f.section,
        subject: f.subject,
        teacherId: f.teacherId,
        periodsPerWeek: 1,
        maxPerDay: 99,
      };
      att.addLocked({ id: `fixed-${i}#f`, lesson, length: 1, maxPerDay: 99 }, f.day, f.period, f.room);
    });
    const unplaced: Block[] = [];
    for (const b of blocks) {
      if (!att.tryPlace(b) && !att.tryEject(b)) unplaced.push(b);
    }
    return { attempt: att, unplaced, remaining: unplaced.reduce((n, b) => n + b.length, 0) };
  };

  let best: { attempt: Attempt; unplaced: Block[]; remaining: number } | null = null;
  let run = 0;

  for (let a = 0; a < attemptsMax; a++) {
    run++;
    const rng = makeRng((input.seed ?? 1) * 7919 + a * 104729);
    const blocks = buildBlocks(input.lessons, input.days.length, lockedPeriods);
    // Hardest first: doubles, restricted time windows, optional group members, busiest/restricted teachers
    const hardness = (b: Block) =>
      (b.length === 2 ? 1000 : 0) +
      (b.lesson.allowedPeriods ? (input.periods.length - b.lesson.allowedPeriods.length) * 40 : 0) +
      (b.lesson.optionalGroupId ? 250 : 0) +
      (teacherLoad.get(b.lesson.teacherId) || 0) * 3 +
      (input.teachers[b.lesson.teacherId]?.unavailable?.length || 0) * 2 +
      (b.lesson.room ? 5 : 0);
    const jitter = new Map(blocks.map((b) => [b.id, rng() * 8]));
    blocks.sort((x, y) => hardness(y) + (jitter.get(y.id) || 0) - (hardness(x) + (jitter.get(x.id) || 0)));

    let result = runPass(blocks, rng, 0);
    if (result.remaining > 0) {
      const relaxed = runPass(blocks, rng, 1);
      if (relaxed.remaining < result.remaining) result = relaxed;
    }
    if (!best || result.remaining < best.remaining) best = result;
    if (best.remaining === 0 || Date.now() > deadline) break;
  }

  const final = best!;
  const placements: SolverPlacement[] = [];
  for (const pl of final.attempt.placed) {
    if (pl.locked) continue;
    const ps = pl.block.length === 2 ? secondPeriod(input, pl.start) : null;
    const base = {
      lessonId: pl.block.lesson.id,
      grade: pl.block.lesson.grade,
      section: pl.block.lesson.section,
      subject: pl.block.lesson.subject,
      teacherId: pl.block.lesson.teacherId,
      room: pl.room,
      day: pl.day,
    };
    placements.push({ ...base, period: pl.start });
    if (ps !== null) placements.push({ ...base, period: ps });
  }

  const missing = new Map<string, UnplacedLesson>();
  for (const b of final.unplaced) {
    const prev = missing.get(b.lesson.id);
    const reason = final.attempt.dominantReason(b);
    if (prev) prev.missingPeriods += b.length;
    else {
      missing.set(b.lesson.id, {
        lessonId: b.lesson.id,
        grade: b.lesson.grade,
        section: b.lesson.section,
        subject: b.lesson.subject,
        teacherId: b.lesson.teacherId,
        missingPeriods: b.length,
        reason,
      });
    }
  }

  return {
    placements,
    unplaced: [...missing.values()],
    warnings,
    attemptsRun: run,
    placedPeriods: totalPeriods - final.remaining,
    totalPeriods,
  };
}

function secondPeriod(input: SolverInput, start: number): number | null {
  const i = input.periods.indexOf(start);
  return i >= 0 && i + 1 < input.periods.length ? input.periods[i + 1] : null;
}
