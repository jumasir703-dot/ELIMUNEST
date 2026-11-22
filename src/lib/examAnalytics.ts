import { computeClientGrade } from './format';
import {
  CLASS_TEACHER_SUBJECT_TOKEN,
  computeMeanGradeFromPoints,
  getStreamsForGrade,
  getSubjectsForGrade,
  is844FormFourGrade,
  CBE_GRADING_SCALE,
  KCSE_844_GRADING_SCALE,
  type AssessmentGradeBand,
  type ExamCycle,
  type ExamResult,
  type ExamResultStatus,
  type Student,
  type TeacherProfile,
  type Tenant,
  type TenantWorkspaceData,
  type TimetableSlot,
} from '../shared/types';

export function isNonSatExamResult(
  r: Pick<ExamResult, 'resultStatus' | 'letterGrade'>
): boolean {
  return (
    r.resultStatus === 'Absent' ||
    r.resultStatus === 'Exempt' ||
    r.letterGrade === 'ABS' ||
    r.letterGrade === 'EXM'
  );
}

export function getCycleOrderRank(title: string): number {
  const lower = title.toLowerCase();
  if (/opening/.test(lower)) return 0;
  if (/mid[- ]?term/.test(lower)) return 1;
  if (/end\s*of\s*term|final/.test(lower)) return 2;
  return 3;
}

export function sortExamCyclesChronologically(cycles: ExamCycle[]): ExamCycle[] {
  return [...cycles].sort((a, b) => {
    const dateCmp = (a.startDate || '').localeCompare(b.startDate || '');
    if (dateCmp !== 0) return dateCmp;
    const rankDiff = getCycleOrderRank(a.title) - getCycleOrderRank(b.title);
    if (rankDiff !== 0) return rankDiff;
    return a.term.localeCompare(b.term);
  });
}

export function shortenCycleTitle(title: string): string {
  return title
    .replace(/\bTerm\s+(\d+)\b/i, 'T$1')
    .replace(/\bExamination\b|\bExam\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function deriveTeacherInitials(fullName?: string): string {
  if (!fullName) return '—';
  const cleaned = fullName
    .trim()
    .replace(/\b(dr|prof|mr|mrs|ms|miss|rev|eng|tr|sir|madam)\.?\s+/gi, ' ')
    .replace(/[^a-zA-Z\s-]/g, ' ')
    .trim();
  if (!cleaned) return '—';
  const parts = cleaned.split(/[\s-]+/).filter(Boolean);
  if (parts.length === 0) return '—';
  return `${parts
    .slice(0, 3)
    .map((part) => part[0].toUpperCase())
    .join('.')}.`;
}

export function resolveSubjectTeacher(
  tenant: Pick<Tenant, 'teachers'>,
  timetable: TimetableSlot[],
  student: Pick<Student, 'grade' | 'section'>,
  subject: string
): { name: string; initials: string; department: string } {
  const gNorm = student.grade.trim().toLowerCase();
  const sNorm = student.section.trim().toLowerCase();
  const subNorm = subject.trim().toLowerCase();
  const teachers: TeacherProfile[] = tenant.teachers || [];

  const lookupDepartment = (teacherName: string, teacherId?: string): string => {
    const match = teachers.find(
      (t) =>
        (teacherId && t.id === teacherId) ||
        t.name.trim().toLowerCase() === teacherName.trim().toLowerCase()
    );
    return match?.department || 'General Academics';
  };

  // 1. Direct timetable slot match for this grade, stream & subject
  const slotMatch = timetable.find(
    (slot) =>
      slot.grade.trim().toLowerCase() === gNorm &&
      slot.section.trim().toLowerCase() === sNorm &&
      slot.subject.trim().toLowerCase() === subNorm &&
      slot.teacherName
  );
  if (slotMatch) {
    return {
      name: slotMatch.teacherName,
      initials: deriveTeacherInitials(slotMatch.teacherName),
      department: lookupDepartment(slotMatch.teacherName, slotMatch.teacherId),
    };
  }

  // 2. Teacher explicitly assigned to this grade + stream + subject
  const explicitCohortMatch = teachers.find((t) =>
    (t.assignedClasses || []).some(
      (c) =>
        c.grade.trim().toLowerCase() === gNorm &&
        (c.section.trim().toLowerCase() === sNorm ||
          c.section.trim().toLowerCase() === 'all streams') &&
        ((c.subject && c.subject.trim().toLowerCase() === subNorm) ||
          c.subject === CLASS_TEACHER_SUBJECT_TOKEN ||
          (!c.subject &&
            (t.subjects.some((s) => s.trim().toLowerCase() === subNorm) ||
              t.subjects.includes(CLASS_TEACHER_SUBJECT_TOKEN))))
    )
  );
  if (explicitCohortMatch) {
    return {
      name: explicitCohortMatch.name,
      initials: deriveTeacherInitials(explicitCohortMatch.name),
      department: explicitCohortMatch.department || 'General Academics',
    };
  }

  // 3. Teacher open to all classes teaching this subject
  const openSubjectTeacher = teachers.find(
    (t) =>
      (!t.assignedClasses || t.assignedClasses.length === 0) &&
      (t.subjects.some((s) => s.trim().toLowerCase() === subNorm) ||
        t.subjects.includes(CLASS_TEACHER_SUBJECT_TOKEN))
  );
  if (openSubjectTeacher) {
    return {
      name: openSubjectTeacher.name,
      initials: deriveTeacherInitials(openSubjectTeacher.name),
      department: openSubjectTeacher.department || 'General Academics',
    };
  }

  // 4. Any teacher configured with this subject
  const anySubjectTeacher = teachers.find((t) =>
    t.subjects.some((s) => s.trim().toLowerCase() === subNorm)
  );
  if (anySubjectTeacher) {
    return {
      name: anySubjectTeacher.name,
      initials: deriveTeacherInitials(anySubjectTeacher.name),
      department: anySubjectTeacher.department || 'General Academics',
    };
  }

  return { name: 'Unassigned', initials: '—', department: 'Unassigned' };
}

export interface KcseBest7Summary {
  totalPoints: number;
  maxPoints: number;
  totalMarks: number;
  subjectCount: number;
  meanPoints: number;
  meanGrade: string;
  selectedSubjects: string[];
}

export function computeKcseBest7(results: ExamResult[], grade: string): KcseBest7Summary | null {
  const scoredOnly = results.filter((r) => !isNonSatExamResult(r));
  if (!is844FormFourGrade(grade) || scoredOnly.length === 0) return null;

  const scored = scoredOnly.map((r) => {
    const pct = (r.maxScore || 100) > 0 ? Math.round((r.score / (r.maxScore || 100)) * 100) : r.score;
    const g = computeClientGrade(pct, grade);
    return {
      subject: r.subject,
      score: r.score,
      points: g.gpaPoints,
      isCompulsory: /^(english|kiswahili|math|mathematics|core mathematics)$/i.test(
        r.subject.trim()
      ),
    };
  });

  // Kenyan KCSE best-7 rule: Group I languages + Mathematics first, then highest remaining subjects up to 7
  const compulsory = scored
    .filter((s) => s.isCompulsory)
    .sort((a, b) => b.points - a.points || b.score - a.score)
    .slice(0, 3);
  const compulsoryNames = new Set(compulsory.map((c) => c.subject.toLowerCase()));
  const electives = scored
    .filter((s) => !compulsoryNames.has(s.subject.toLowerCase()))
    .sort((a, b) => b.points - a.points || b.score - a.score);

  const best7 = [...compulsory, ...electives].slice(0, 7);
  if (best7.length === 0) return null;

  const totalPoints = best7.reduce((sum, s) => sum + s.points, 0);
  const totalMarks = best7.reduce((sum, s) => sum + s.score, 0);
  const meanPoints = Math.round((totalPoints / best7.length) * 100) / 100;
  const meanGrade = computeMeanGradeFromPoints(meanPoints, grade).letterGrade;

  return {
    totalPoints,
    maxPoints: best7.length * 12,
    totalMarks,
    subjectCount: best7.length,
    meanPoints,
    meanGrade,
    selectedSubjects: best7.map((s) => s.subject),
  };
}

export interface BroadsheetStudentRow {
  student: Student;
  subjectsSat: number;
  registeredCount: number;
  missingSubjects: string[];
  subjectMap: Record<
    string,
    {
      score: number;
      maxScore: number;
      letterGrade: string;
      gpaPoints: number;
      resultStatus: ExamResultStatus;
      remarks: string;
    }
  >;
  totalScore: number;
  maxPossible: number;
  meanScore: number | null;
  meanPoints: number | null;
  overallGrade: string;
  overallPoints: number | null;
  kcseBest7: KcseBest7Summary | null;
  prevMeanScore: number | null;
  prevMeanPoints: number | null;
  meanDeviation: number | null;
  pointsDeviation: number | null;
  rank: number | null;
  best7Rank: number | null;
  streamRank: number | null;
}

export interface StreamComparisonRow {
  stream: string;
  enrolledCount: number;
  candidatesSat: number;
  meanScore: number | null;
  meanPoints: number | null;
  meanGrade: string;
  passRate: number | null;
  qualityPassRate: number | null;
  prevMeanScore: number | null;
  deviation: number | null;
  gradeCounts: Record<string, number>;
  rank: number | null;
}

export interface SubjectGradeMatrixRow {
  subject: string;
  entries: number;
  expectedEntries: number;
  completionPct: number;
  gradeCounts: Record<string, number>;
  meanScore: number | null;
  meanPoints: number | null;
  meanGrade: string;
  passRate: number | null;
  prevMeanScore: number | null;
  deviation: number | null;
  rank: number | null;
}

export interface TeacherAnalysisRow {
  key: string;
  teacherName: string;
  teacherInitials: string;
  department: string;
  subject: string;
  stream: string;
  candidatesSat: number;
  meanScore: number;
  meanPoints: number;
  meanGrade: string;
  passRate: number;
  prevMeanScore: number | null;
  deviation: number | null;
  rank: number;
}

export interface MissingMarksSubjectAudit {
  subject: string;
  entered: number;
  expected: number;
  missingCount: number;
  completionPct: number;
  streamsMissing: Array<{ stream: string; missingCount: number; expected: number }>;
}

export interface MissingMarksStudentAudit {
  student: Student;
  enteredCount: number;
  expectedCount: number;
  missingSubjects: string[];
}

export interface GradeAnalyticsReport {
  is844: boolean;
  maxPoints: number;
  scale: AssessmentGradeBand[];
  streams: string[];
  registeredSubjects: string[];
  broadsheetRows: BroadsheetStudentRow[];
  streamComparisons: StreamComparisonRow[];
  overallStreamSummary: StreamComparisonRow;
  subjectMatrix: SubjectGradeMatrixRow[];
  teacherAnalysis: TeacherAnalysisRow[];
  topPerformers: BroadsheetStudentRow[];
  mostImproved: BroadsheetStudentRow[];
  needsAttention: BroadsheetStudentRow[];
  missingMarksBySubject: MissingMarksSubjectAudit[];
  missingMarksByStudent: MissingMarksStudentAudit[];
  completenessPct: number;
  totalMissingCells: number;
  totalExpectedCells: number;
}

function emptyBandCounts(scale: AssessmentGradeBand[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const band of scale) counts[band.grade] = 0;
  return counts;
}

function computePassCutoffs(is844: boolean): { passPct: number; qualityPct: number } {
  return is844
    ? { passPct: 40, qualityPct: 55 } // 8-4-4: D+ (40%+) pass, C+ (55%+) university quality
    : { passPct: 41, qualityPct: 75 }; // CBE: ME2 (41%+) meeting expectations, EE2 (75%+) exceeding
}

export function buildBroadsheetRows(params: {
  students: Student[];
  examResults: ExamResult[];
  levelSubjects: string[];
  activeCycleId: string;
  baselineCycleId?: string | null;
  grade: string;
}): BroadsheetStudentRow[] {
  const { students, examResults, levelSubjects, activeCycleId, baselineCycleId, grade } = params;
  const activeResults = examResults.filter(
    (r) => r.examCycleId === activeCycleId && r.grade === grade
  );
  const baselineResults = baselineCycleId
    ? examResults.filter((r) => r.examCycleId === baselineCycleId && r.grade === grade)
    : [];

  const registeredSubjects = Array.from(
    new Set([...levelSubjects, ...activeResults.map((r) => r.subject)])
  );

  const base = students.map((stu) => {
    const stuResults = activeResults.filter((r) => r.studentId === stu.id);
    const stuScoredResults = stuResults.filter((r) => !isNonSatExamResult(r));
    const subjectMap: BroadsheetStudentRow['subjectMap'] = {};
    let pointsSum = 0;

    for (const r of stuResults) {
      const nonSat = isNonSatExamResult(r);
      const status: ExamResultStatus =
        r.resultStatus ||
        (r.letterGrade === 'ABS' ? 'Absent' : r.letterGrade === 'EXM' ? 'Exempt' : 'Scored');
      if (nonSat) {
        subjectMap[r.subject] = {
          score: 0,
          maxScore: r.maxScore || 100,
          letterGrade: status === 'Exempt' ? 'EXM' : 'ABS',
          gpaPoints: 0,
          resultStatus: status,
          remarks: r.remarks || status,
        };
      } else {
        const graded = computeClientGrade(r.score, stu.grade);
        subjectMap[r.subject] = {
          score: r.score,
          maxScore: r.maxScore || 100,
          letterGrade: graded.letterGrade,
          gpaPoints: graded.gpaPoints,
          resultStatus: 'Scored',
          remarks: r.remarks || '',
        };
        pointsSum += graded.gpaPoints;
      }
    }

    const subjectsSat = stuScoredResults.length;
    const totalScore = stuScoredResults.reduce((s, r) => s + r.score, 0);
    const maxPossible = stuScoredResults.reduce((s, r) => s + (r.maxScore || 100), 0);
    const meanScore =
      maxPossible > 0 ? Math.round((totalScore / maxPossible) * 1000) / 10 : null;
    const meanPoints =
      subjectsSat > 0 ? Math.round((pointsSum / subjectsSat) * 100) / 100 : null;
    const overallGradeInfo =
      meanScore !== null ? computeClientGrade(meanScore, stu.grade) : null;

    const recordedLower = new Set(stuResults.map((r) => r.subject.trim().toLowerCase()));
    const missingSubjects = registeredSubjects.filter(
      (sub) => !recordedLower.has(sub.trim().toLowerCase())
    );

    const kcseBest7 = computeKcseBest7(stuScoredResults, stu.grade);

    // Baseline comparison
    const prevResults = baselineResults.filter(
      (r) => r.studentId === stu.id && !isNonSatExamResult(r)
    );
    let prevMeanScore: number | null = null;
    let prevMeanPoints: number | null = null;
    if (prevResults.length > 0) {
      const prevTot = prevResults.reduce((s, r) => s + r.score, 0);
      const prevMax = prevResults.reduce((s, r) => s + (r.maxScore || 100), 0);
      prevMeanScore = prevMax > 0 ? Math.round((prevTot / prevMax) * 1000) / 10 : null;
      const prevPts = prevResults.reduce(
        (s, r) => s + computeClientGrade(r.score, stu.grade).gpaPoints,
        0
      );
      prevMeanPoints = Math.round((prevPts / prevResults.length) * 100) / 100;
    }

    const meanDeviation =
      meanScore !== null && prevMeanScore !== null
        ? Math.round((meanScore - prevMeanScore) * 10) / 10
        : null;
    const pointsDeviation =
      meanPoints !== null && prevMeanPoints !== null
        ? Math.round((meanPoints - prevMeanPoints) * 100) / 100
        : null;

    return {
      student: stu,
      subjectsSat,
      registeredCount: registeredSubjects.length,
      missingSubjects,
      subjectMap,
      totalScore,
      maxPossible,
      meanScore,
      meanPoints,
      overallGrade: overallGradeInfo?.letterGrade || '—',
      overallPoints: overallGradeInfo?.gpaPoints ?? null,
      kcseBest7,
      prevMeanScore,
      prevMeanPoints,
      meanDeviation,
      pointsDeviation,
      rank: null as number | null,
      best7Rank: null as number | null,
      streamRank: null as number | null,
    };
  });

  // Sort by totalScore desc, overallPoints desc, meanScore desc
  const sorted = [...base].sort((a, b) => {
    if ((a.subjectsSat > 0) !== (b.subjectsSat > 0)) return a.subjectsSat > 0 ? -1 : 1;
    const totalDiff = b.totalScore - a.totalScore;
    if (totalDiff !== 0) return totalDiff;
    const ptsDiff = (b.overallPoints ?? -1) - (a.overallPoints ?? -1);
    if (ptsDiff !== 0) return ptsDiff;
    const meanDiff = (b.meanScore ?? -1) - (a.meanScore ?? -1);
    if (meanDiff !== 0) return meanDiff;
    return a.student.fullName.localeCompare(b.student.fullName);
  });

  // Overall rank
  let lastKey = '';
  let lastRank = 0;
  const withOverallRank = sorted.map((row, idx) => {
    if (row.subjectsSat === 0) return { ...row, rank: null };
    const key = `${row.totalScore}::${row.overallPoints ?? 0}`;
    const rank = key === lastKey ? lastRank : idx + 1;
    lastKey = key;
    lastRank = rank;
    return { ...row, rank };
  });

  // Best-7 KCSE rank (points desc, then best7 totalMarks desc)
  const best7Map = new Map<string, number>();
  const best7Sorted = withOverallRank
    .filter((r) => r.kcseBest7 !== null && r.subjectsSat > 0)
    .sort((a, b) => {
      const pDiff = (b.kcseBest7?.totalPoints ?? 0) - (a.kcseBest7?.totalPoints ?? 0);
      if (pDiff !== 0) return pDiff;
      return (b.kcseBest7?.totalMarks ?? 0) - (a.kcseBest7?.totalMarks ?? 0);
    });
  let lastB7Key = '';
  let lastB7Rank = 0;
  best7Sorted.forEach((row, idx) => {
    const key = `${row.kcseBest7?.totalPoints ?? 0}::${row.kcseBest7?.totalMarks ?? 0}`;
    const r = key === lastB7Key ? lastB7Rank : idx + 1;
    lastB7Key = key;
    lastB7Rank = r;
    best7Map.set(row.student.id, r);
  });

  // Stream rank
  const streamRankMap = new Map<string, number>();
  const byStream = new Map<string, BroadsheetStudentRow[]>();
  withOverallRank.forEach((r) => {
    if (r.subjectsSat === 0) return;
    const list = byStream.get(r.student.section) || [];
    list.push(r);
    byStream.set(r.student.section, list);
  });
  byStream.forEach((list) => {
    let sKey = '';
    let sRank = 0;
    list.forEach((r, idx) => {
      const key = `${r.totalScore}::${r.overallPoints ?? 0}`;
      const rank = key === sKey ? sRank : idx + 1;
      sKey = key;
      sRank = rank;
      streamRankMap.set(r.student.id, rank);
    });
  });

  return withOverallRank.map((row) => ({
    ...row,
    best7Rank: best7Map.get(row.student.id) ?? null,
    streamRank: streamRankMap.get(row.student.id) ?? null,
  }));
}

export function buildGradeAnalyticsReport(params: {
  workspace: TenantWorkspaceData;
  cycleId: string;
  baselineCycleId?: string | null;
  grade: string;
  streamFilter?: string;
}): GradeAnalyticsReport {
  const { workspace, cycleId, baselineCycleId, grade, streamFilter = 'All' } = params;
  const { tenant, students, examResults, timetable } = workspace;

  const is844 = is844FormFourGrade(grade);
  const maxPoints = is844 ? 12 : 8;
  const scale = is844 ? KCSE_844_GRADING_SCALE : CBE_GRADING_SCALE;
  const { passPct, qualityPct } = computePassCutoffs(is844);

  const allGradeStudents = students.filter((s) => s.grade === grade && s.status === 'Active');
  const activeResultsAllStreams = examResults.filter(
    (r) => r.examCycleId === cycleId && r.grade === grade
  );
  const baselineResultsAllStreams = baselineCycleId
    ? examResults.filter((r) => r.examCycleId === baselineCycleId && r.grade === grade)
    : [];

  const streams = Array.from(
    new Set([
      ...getStreamsForGrade(tenant, grade),
      ...allGradeStudents.map((s) => s.section),
    ])
  ).filter(Boolean);

  const levelSubjects = getSubjectsForGrade(tenant, grade);
  const registeredSubjects = Array.from(
    new Set([...levelSubjects, ...activeResultsAllStreams.map((r) => r.subject)])
  );

  const fullBroadsheet = buildBroadsheetRows({
    students: allGradeStudents,
    examResults,
    levelSubjects,
    activeCycleId: cycleId,
    baselineCycleId,
    grade,
  });

  const broadsheetRows =
    streamFilter === 'All'
      ? fullBroadsheet
      : fullBroadsheet.filter((r) => r.student.section === streamFilter);

  const scopedStudentIds = new Set(broadsheetRows.map((r) => r.student.id));
  const activeScopedResults = activeResultsAllStreams.filter((r) =>
    scopedStudentIds.has(r.studentId)
  );
  const baselineScopedResults = baselineResultsAllStreams.filter((r) =>
    scopedStudentIds.has(r.studentId)
  );

  // 1. Stream-vs-Stream Comparison (always shows all streams in the grade for context)
  const buildStreamSummary = (streamName: string, streamRows: BroadsheetStudentRow[]): StreamComparisonRow => {
    const satRows = streamRows.filter((r) => r.meanScore !== null && r.subjectsSat > 0);
    const gradeCounts = emptyBandCounts(scale);
    for (const r of satRows) {
      if (r.overallGrade && gradeCounts[r.overallGrade] !== undefined) {
        gradeCounts[r.overallGrade] += 1;
      }
    }
    const meanScore =
      satRows.length > 0
        ? Math.round(
            (satRows.reduce((s, r) => s + (r.meanScore || 0), 0) / satRows.length) * 10
          ) / 10
        : null;
    const meanPoints =
      satRows.length > 0
        ? Math.round(
            (satRows.reduce((s, r) => s + (r.meanPoints || 0), 0) / satRows.length) * 100
          ) / 100
        : null;
    const meanGrade =
      meanScore !== null ? computeClientGrade(meanScore, grade).letterGrade : '—';
    const passRate =
      satRows.length > 0
        ? Math.round(
            (satRows.filter((r) => (r.meanScore || 0) >= passPct).length / satRows.length) * 100
          )
        : null;
    const qualityPassRate =
      satRows.length > 0
        ? Math.round(
            (satRows.filter((r) => (r.meanScore || 0) >= qualityPct).length / satRows.length) * 100
          )
        : null;

    const prevSatRows = streamRows.filter((r) => r.prevMeanScore !== null);
    const prevMeanScore =
      prevSatRows.length > 0
        ? Math.round(
            (prevSatRows.reduce((s, r) => s + (r.prevMeanScore || 0), 0) / prevSatRows.length) * 10
          ) / 10
        : null;
    const deviation =
      meanScore !== null && prevMeanScore !== null
        ? Math.round((meanScore - prevMeanScore) * 10) / 10
        : null;

    return {
      stream: streamName,
      enrolledCount: streamRows.length,
      candidatesSat: satRows.length,
      meanScore,
      meanPoints,
      meanGrade,
      passRate,
      qualityPassRate,
      prevMeanScore,
      deviation,
      gradeCounts,
      rank: null,
    };
  };

  const unsortedStreams = streams.map((st) =>
    buildStreamSummary(
      st,
      fullBroadsheet.filter((r) => r.student.section === st)
    )
  );
  const rankedStreams = [...unsortedStreams].sort((a, b) => {
    if ((a.meanScore !== null) !== (b.meanScore !== null)) {
      return a.meanScore !== null ? -1 : 1;
    }
    return (b.meanScore ?? -1) - (a.meanScore ?? -1);
  });
  let streamRankCounter = 0;
  let lastStreamMean = -1;
  const streamComparisons = rankedStreams.map((row, idx) => {
    if (row.meanScore === null) return { ...row, rank: null };
    const rank = row.meanScore === lastStreamMean ? streamRankCounter : idx + 1;
    lastStreamMean = row.meanScore;
    streamRankCounter = rank;
    return { ...row, rank };
  });

  const overallStreamSummary = buildStreamSummary('All Streams', fullBroadsheet);

  // 2. Subject × Grade Distribution Matrix (respects streamFilter)
  const expectedStudentsCount = broadsheetRows.length;
  const unsortedSubjectMatrix = registeredSubjects.map((sub) => {
    const subLower = sub.trim().toLowerCase();
    const allRecordedEntries = activeScopedResults.filter(
      (r) => r.subject.trim().toLowerCase() === subLower
    );
    const entries = allRecordedEntries.filter((r) => !isNonSatExamResult(r));
    const gradeCounts = emptyBandCounts(scale);
    let scoreSum = 0;
    let ptsSum = 0;
    let passCount = 0;

    for (const r of entries) {
      const graded = computeClientGrade(r.score, grade);
      if (gradeCounts[graded.letterGrade] !== undefined) {
        gradeCounts[graded.letterGrade] += 1;
      }
      scoreSum += r.score;
      ptsSum += graded.gpaPoints;
      if (r.score >= passPct) passCount += 1;
    }

    const meanScore =
      entries.length > 0 ? Math.round((scoreSum / entries.length) * 10) / 10 : null;
    const meanPoints =
      entries.length > 0 ? Math.round((ptsSum / entries.length) * 100) / 100 : null;
    const meanGrade =
      meanScore !== null ? computeClientGrade(meanScore, grade).letterGrade : '—';
    const passRate =
      entries.length > 0 ? Math.round((passCount / entries.length) * 100) : null;

    const prevEntries = baselineScopedResults.filter(
      (r) => r.subject.trim().toLowerCase() === subLower && !isNonSatExamResult(r)
    );
    const prevMeanScore =
      prevEntries.length > 0
        ? Math.round(
            (prevEntries.reduce((s, r) => s + r.score, 0) / prevEntries.length) * 10
          ) / 10
        : null;
    const deviation =
      meanScore !== null && prevMeanScore !== null
        ? Math.round((meanScore - prevMeanScore) * 10) / 10
        : null;

    const completionPct =
      expectedStudentsCount > 0
        ? Math.min(100, Math.round((allRecordedEntries.length / expectedStudentsCount) * 100))
        : 0;

    return {
      subject: sub,
      entries: entries.length,
      expectedEntries: expectedStudentsCount,
      completionPct,
      gradeCounts,
      meanScore,
      meanPoints,
      meanGrade,
      passRate,
      prevMeanScore,
      deviation,
      rank: null as number | null,
    };
  });

  const sortedSubjectMatrix = [...unsortedSubjectMatrix].sort((a, b) => {
    if ((a.meanScore !== null) !== (b.meanScore !== null)) {
      return a.meanScore !== null ? -1 : 1;
    }
    return (b.meanScore ?? -1) - (a.meanScore ?? -1);
  });
  let subRank = 0;
  let lastSubMean = -1;
  const subjectMatrix = sortedSubjectMatrix.map((row, idx) => {
    if (row.meanScore === null) return { ...row, rank: null };
    const rank = row.meanScore === lastSubMean ? subRank : idx + 1;
    lastSubMean = row.meanScore;
    subRank = rank;
    return { ...row, rank };
  });

  // 3. Teacher & Department Subject Performance Comparison
  const teacherGroups = new Map<string, { stream: string; subject: string; results: ExamResult[] }>();
  for (const r of activeScopedResults) {
    if (isNonSatExamResult(r)) continue;
    const key = `${r.section}::${r.subject.trim().toLowerCase()}`;
    const existing = teacherGroups.get(key) || {
      stream: r.section,
      subject: r.subject,
      results: [],
    };
    existing.results.push(r);
    teacherGroups.set(key, existing);
  }

  const rawTeacherRows = Array.from(teacherGroups.entries()).map(([key, grp]) => {
    const teacherInfo = resolveSubjectTeacher(
      tenant,
      timetable,
      { grade, section: grp.stream },
      grp.subject
    );
    const meanScore =
      Math.round(
        (grp.results.reduce((s, r) => s + r.score, 0) / grp.results.length) * 10
      ) / 10;
    const meanPoints =
      Math.round(
        (grp.results.reduce((s, r) => s + computeClientGrade(r.score, grade).gpaPoints, 0) /
          grp.results.length) *
          100
      ) / 100;
    const meanGrade = computeClientGrade(meanScore, grade).letterGrade;
    const passRate = Math.round(
      (grp.results.filter((r) => r.score >= passPct).length / grp.results.length) * 100
    );

    const prevGrp = baselineScopedResults.filter(
      (r) =>
        r.section === grp.stream &&
        r.subject.trim().toLowerCase() === grp.subject.trim().toLowerCase() &&
        !isNonSatExamResult(r)
    );
    const prevMeanScore =
      prevGrp.length > 0
        ? Math.round((prevGrp.reduce((s, r) => s + r.score, 0) / prevGrp.length) * 10) / 10
        : null;
    const deviation =
      prevMeanScore !== null ? Math.round((meanScore - prevMeanScore) * 10) / 10 : null;

    return {
      key,
      teacherName: teacherInfo.name,
      teacherInitials: teacherInfo.initials,
      department: teacherInfo.department,
      subject: grp.subject,
      stream: grp.stream,
      candidatesSat: grp.results.length,
      meanScore,
      meanPoints,
      meanGrade,
      passRate,
      prevMeanScore,
      deviation,
      rank: 0,
    };
  });

  const teacherAnalysis = rawTeacherRows
    .sort((a, b) => b.meanScore - a.meanScore || a.subject.localeCompare(b.subject))
    .map((row, idx) => ({ ...row, rank: idx + 1 }));

  // 4. Value-Added Highlights: Top Performers, Most Improved, Attention Watchlist
  const satBroadsheet = broadsheetRows.filter((r) => r.subjectsSat > 0 && r.meanScore !== null);
  const topPerformers = satBroadsheet.slice(0, 5);
  const mostImproved = [...satBroadsheet]
    .filter((r) => r.meanDeviation !== null && r.meanDeviation > 0)
    .sort((a, b) => (b.meanDeviation ?? 0) - (a.meanDeviation ?? 0))
    .slice(0, 5);
  const needsAttention = satBroadsheet
    .filter(
      (r) =>
        (r.meanScore !== null && r.meanScore < passPct) ||
        (r.meanDeviation !== null && r.meanDeviation <= -5)
    )
    .sort((a, b) => (a.meanScore ?? 100) - (b.meanScore ?? 100))
    .slice(0, 8);

  // 5. Missing Marks Completeness Audit
  const activeStreams = streamFilter === 'All' ? streams : [streamFilter];
  const missingMarksBySubject: MissingMarksSubjectAudit[] = registeredSubjects.map((sub) => {
    const subLower = sub.trim().toLowerCase();
    const entered = activeScopedResults.filter(
      (r) => r.subject.trim().toLowerCase() === subLower
    ).length;
    const expected = broadsheetRows.length;
    const missingCount = Math.max(0, expected - entered);
    const completionPct =
      expected > 0 ? Math.min(100, Math.round((entered / expected) * 100)) : 100;
    const streamsMissing = activeStreams
      .map((st) => {
        const stStudents = broadsheetRows.filter((r) => r.student.section === st);
        const stSat = stStudents.filter((r) =>
          Object.keys(r.subjectMap).some((s) => s.trim().toLowerCase() === subLower)
        ).length;
        return {
          stream: st,
          expected: stStudents.length,
          missingCount: Math.max(0, stStudents.length - stSat),
        };
      })
      .filter((item) => item.missingCount > 0);

    return {
      subject: sub,
      entered,
      expected,
      missingCount,
      completionPct,
      streamsMissing,
    };
  });

  const missingMarksByStudent: MissingMarksStudentAudit[] = broadsheetRows
    .filter((r) => r.missingSubjects.length > 0)
    .map((r) => ({
      student: r.student,
      enteredCount: Math.max(0, registeredSubjects.length - r.missingSubjects.length),
      expectedCount: registeredSubjects.length,
      missingSubjects: r.missingSubjects,
    }));

  const totalExpectedCells = broadsheetRows.length * registeredSubjects.length;
  const totalMissingCells = missingMarksByStudent.reduce(
    (sum, item) => sum + item.missingSubjects.length,
    0
  );
  const completenessPct =
    totalExpectedCells > 0
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round(((totalExpectedCells - totalMissingCells) / totalExpectedCells) * 100)
          )
        )
      : 100;

  return {
    is844,
    maxPoints,
    scale,
    streams,
    registeredSubjects,
    broadsheetRows,
    streamComparisons,
    overallStreamSummary,
    subjectMatrix,
    teacherAnalysis,
    topPerformers,
    mostImproved,
    needsAttention,
    missingMarksBySubject,
    missingMarksByStudent,
    completenessPct,
    totalMissingCells,
    totalExpectedCells,
  };
}
