import { useMemo, useState } from 'react';
import {
  Bell,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Eye,
  EyeOff,
  FileCheck2,
  FileText,
  Lock,
  Plus,
  Printer,
  Search,
  Send,
  SlidersHorizontal,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { saasApi } from '../lib/api';
import {
  CLASS_TEACHER_SUBJECT_TOKEN,
  getStreamsForGrade,
  getStudentRegisteredSubjects,
  getSubjectsForGrade,
  getTeacherAssignedSubjectsForCohort,
  type AcademicDocumentStatus,
  type AcademicSubmissionDeadlineConfig,
  type LessonPlan,
  type SchemeOfWork,
  type SchemeOfWorkWeek,
  type TeacherProfile,
  type Tenant,
  type TenantWorkspaceData,
  type UserRole,
} from '../shared/types';
import { TenantDocumentHeader } from './TenantDocumentHeader';

interface TeacherAcademicsModuleProps {
  workspace: TenantWorkspaceData;
  currentRole: UserRole;
  currentUserId: string;
  currentUserEmail?: string;
  readOnly?: boolean;
  onRefresh: () => void | Promise<void>;
  onNotify: (msg: string, tone?: 'success' | 'error' | 'info') => void;
}

type AcademicsTab = 'schemes' | 'lesson-plans' | 'tracking' | 'parent-preview';

const STATUS_BADGE_MAP: Record<AcademicDocumentStatus, string> = {
  Approved: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800',
  Submitted: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800',
  'Revision Requested': 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800',
  Draft: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
};

function generateClientSchemeWeeks(subject: string, count = 8): SchemeOfWorkWeek[] {
  const cleanCount = Math.max(1, Math.min(14, Math.round(count)));
  const lower = subject.toLowerCase();
  const baseRows: Array<Omit<SchemeOfWorkWeek, 'weekNumber'>> = /math/i.test(lower)
    ? [
        {
          strand: 'Numbers & Operations',
          subStrand: 'Fractions, Ratios & Percentages',
          learningOutcomes: 'Convert fractions, decimals and percentages and solve consumer problems.',
          keyInquiryQuestion: 'How do percentages help compare discounts and results?',
          learningActivities: 'Fraction-strip matching, practical discount problems, guided practice.',
          resources: 'KICD Learner Book, place-value charts, fraction cards',
          assessmentMethod: 'Written exercise & observation checklist',
          remarks: '',
        },
        {
          strand: 'Algebra',
          subStrand: 'Linear Equations & Expressions',
          learningOutcomes: 'Formulate and solve single-variable linear equations from word scenarios.',
          keyInquiryQuestion: 'How can an unknown quantity be represented symbolically?',
          learningActivities: 'Balance-scale model task, peer equation formulation.',
          resources: 'Algebra tiles, chalkboard diagrams, learner workbooks',
          assessmentMethod: 'Exit ticket & rubric',
          remarks: '',
        },
        {
          strand: 'Measurements',
          subStrand: 'Perimeter, Area & Volume',
          learningOutcomes: 'Compute perimeter and area of composite figures and volume of cuboids.',
          keyInquiryQuestion: 'Why do builders measure perimeter before fencing?',
          learningActivities: 'Tape-measure classroom dimension activity, scale sketches.',
          resources: 'Metre rule, tape measure, grid paper, 3D solid models',
          assessmentMethod: 'Practical measurement task',
          remarks: '',
        },
        {
          strand: 'Data Handling',
          subStrand: 'Bar Graphs & Mean Interpretation',
          learningOutcomes: 'Collect, tabulate and interpret frequency tables and bar charts.',
          keyInquiryQuestion: 'What makes a visual chart easier to interpret than raw numbers?',
          learningActivities: 'Class data tallying and plotting scaled bar graphs.',
          resources: 'Graph books, coloured pencils, sample charts',
          assessmentMethod: 'Chart portfolio check',
          remarks: '',
        },
      ]
    : /english|kiswahili|language/i.test(lower)
    ? [
        {
          strand: 'Listening & Speaking',
          subStrand: 'Oral Dialogue & Vocabulary Fluency',
          learningOutcomes: 'Respond courteously in structured dialogue and summarise spoken ideas.',
          keyInquiryQuestion: 'How does active listening strengthen respectful dialogue?',
          learningActivities: 'Think-pair-share conversation, moderated mini-debate.',
          resources: 'KICD Reader, audio clips, cue cards',
          assessmentMethod: 'Oral fluency rubric',
          remarks: '',
        },
        {
          strand: 'Reading',
          subStrand: 'Comprehension & Inference',
          learningOutcomes: 'Identify main ideas and infer vocabulary meaning in context.',
          keyInquiryQuestion: 'Which context clues reveal unfamiliar word meanings?',
          learningActivities: 'Timed silent reading, guided comprehension questions.',
          resources: 'Class reader, dictionary, passage worksheets',
          assessmentMethod: 'Comprehension quiz',
          remarks: '',
        },
        {
          strand: 'Grammar in Use',
          subStrand: 'Tenses & Sentence Connectors',
          learningOutcomes: 'Construct compound sentences with accurate tense and agreement.',
          keyInquiryQuestion: 'How do connectors clarify sequence and cause in writing?',
          learningActivities: 'Sentence-strip joining and peer editing.',
          resources: 'Grammar reference charts, sentence cards',
          assessmentMethod: 'Gap-fill exercise & peer review',
          remarks: '',
        },
        {
          strand: 'Writing',
          subStrand: 'Functional & Narrative Composition',
          learningOutcomes: 'Plan, draft and proofread a coherent letter or short narrative.',
          keyInquiryQuestion: 'Why does outlining improve clarity in storytelling?',
          learningActivities: 'Mind-mapping, paragraph drafting and teacher conferencing.',
          resources: 'Writing rubric, model compositions, exercise books',
          assessmentMethod: 'Composition grading rubric',
          remarks: '',
        },
      ]
    : /science|bio|chem|phys|agric/i.test(lower)
    ? [
        {
          strand: 'Scientific Investigation',
          subStrand: 'Safety & Apparatus Handling',
          learningOutcomes: 'Identify common apparatus, observe safety rules and record observations.',
          keyInquiryQuestion: 'How do safety rules protect learners during practicals?',
          learningActivities: 'Lab station tour, hazard-symbol matching, apparatus sketching.',
          resources: 'Beakers, measuring cylinders, safety goggles, hazard chart',
          assessmentMethod: 'Practical checklist',
          remarks: '',
        },
        {
          strand: 'Living Things & Environment',
          subStrand: 'Plant Nutrition & Ecosystems',
          learningOutcomes: 'Explain requirements for photosynthesis and map local food chains.',
          keyInquiryQuestion: 'Why are green plants essential to every food web?',
          learningActivities: 'Leaf walk observation, food-chain chart building.',
          resources: 'Hand lenses, specimen leaves, chart paper',
          assessmentMethod: 'Poster & oral defence',
          remarks: '',
        },
        {
          strand: 'Matter & Mixtures',
          subStrand: 'Separation of Mixtures',
          learningOutcomes: 'Demonstrate filtration, decantation and evaporation.',
          keyInquiryQuestion: 'Which physical property guides mixture separation?',
          learningActivities: 'Guided sand-salt-water separation experiment.',
          resources: 'Filter paper, funnel, evaporating dish, salt, sand',
          assessmentMethod: 'Lab worksheet & rubric',
          remarks: '',
        },
        {
          strand: 'Energy & Forces',
          subStrand: 'Simple Circuits & Conservation',
          learningOutcomes: 'Assemble a simple circuit and explain clean energy uses.',
          keyInquiryQuestion: 'Why does an open switch stop current flow?',
          learningActivities: 'Dry-cell, switch and bulb practical assembly.',
          resources: 'Dry cells, connecting wires, switches, bulbs',
          assessmentMethod: 'Practical observation',
          remarks: '',
        },
      ]
    : [
        {
          strand: 'Foundational Concepts',
          subStrand: 'Core Terms & Real-World Context',
          learningOutcomes: 'Demonstrate foundational understanding and apply key concepts.',
          keyInquiryQuestion: 'How does this topic connect to everyday community life?',
          learningActivities: 'Guided inquiry discussion and group exploration.',
          resources: 'KICD Learner Book, visual charts, worksheets',
          assessmentMethod: 'Observation checklist & class exercise',
          remarks: '',
        },
        {
          strand: 'Applied Practice',
          subStrand: 'Collaborative Problem Solving',
          learningOutcomes: 'Collaborate in small groups to design and present a practical solution.',
          keyInquiryQuestion: 'What steps ensure accuracy and teamwork?',
          learningActivities: 'Workstation task and peer feedback circle.',
          resources: 'Activity worksheets, manipulatives',
          assessmentMethod: 'Performance rubric',
          remarks: '',
        },
        {
          strand: 'Critical Inquiry',
          subStrand: 'Case Study & Reflection',
          learningOutcomes: 'Analyse a local case study and propose sustainable improvements.',
          keyInquiryQuestion: 'How does evidence guide better decisions?',
          learningActivities: 'Case-study reading and structured group summary.',
          resources: 'Printed case-study cards, reference texts',
          assessmentMethod: 'Written summary check',
          remarks: '',
        },
        {
          strand: 'Portfolio Review',
          subStrand: 'Formative Synthesis',
          learningOutcomes: 'Compile term competencies into an organised learner portfolio.',
          keyInquiryQuestion: 'Which skill have you strengthened most this term?',
          learningActivities: 'Portfolio curation and formative self-check.',
          resources: 'Learner portfolio folders, assessment rubrics',
          assessmentMethod: 'Portfolio rubric',
          remarks: '',
        },
      ];

  const weeks: SchemeOfWorkWeek[] = [];
  for (let i = 0; i < cleanCount; i += 1) {
    const row = baseRows[i % baseRows.length];
    weeks.push({
      weekNumber: i + 1,
      strand: row.strand,
      subStrand: i >= baseRows.length ? `${row.subStrand} (Consolidation)` : row.subStrand,
      learningOutcomes: row.learningOutcomes,
      keyInquiryQuestion: row.keyInquiryQuestion,
      learningActivities: row.learningActivities,
      resources: row.resources,
      assessmentMethod: row.assessmentMethod,
      remarks: row.remarks,
    });
  }
  return weeks;
}

function resolveExpectedCohortsForTeacher(
  tenant: Tenant,
  teacher: TeacherProfile,
  timetable: TenantWorkspaceData['timetable']
): Array<{ grade: string; section: string; subject: string }> {
  const out: Array<{ grade: string; section: string; subject: string }> = [];
  const seen = new Set<string>();
  const classes = teacher.assignedClasses || [];

  for (const c of classes) {
    const sections =
      c.section.trim().toLowerCase() === 'all streams'
        ? getStreamsForGrade(tenant, c.grade)
        : [c.section];
    const gradeSubs = getSubjectsForGrade(tenant, c.grade);
    let subs: string[] = [];
    if (!c.subject || c.subject === CLASS_TEACHER_SUBJECT_TOKEN) {
      subs = teacher.subjects.includes(CLASS_TEACHER_SUBJECT_TOKEN)
        ? gradeSubs.slice(0, 3)
        : teacher.subjects.filter((s) => gradeSubs.includes(s));
      if (subs.length === 0) subs = gradeSubs.slice(0, 2);
    } else {
      subs = [c.subject];
    }
    for (const sec of sections) {
      for (const sub of subs) {
        const key = `${c.grade}::${sec}::${sub}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ grade: c.grade, section: sec, subject: sub });
        }
      }
    }
  }

  if (out.length === 0) {
    for (const slot of timetable) {
      if (slot.teacherId !== teacher.id) continue;
      const key = `${slot.grade}::${slot.section}::${slot.subject}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ grade: slot.grade, section: slot.section, subject: slot.subject });
      }
    }
  }

  return out;
}

function isLateAgainstDate(submittedAt?: string, dueDate?: string): boolean {
  if (!submittedAt || !dueDate) return false;
  const subDay = submittedAt.slice(0, 10);
  return subDay > dueDate;
}

export function TeacherAcademicsModule({
  workspace,
  currentRole,
  currentUserId,
  currentUserEmail,
  readOnly = false,
  onRefresh,
  onNotify,
}: TeacherAcademicsModuleProps) {
  const { tenant, students, timetable } = workspace;
  const schemes = workspace.schemesOfWork || [];
  const lessonPlans = workspace.lessonPlans || [];

  const submissionConfig: Required<AcademicSubmissionDeadlineConfig> = {
    schemeDueDate: tenant.academicSubmissionConfig?.schemeDueDate || '2026-09-07',
    lessonPlanLeadDays: tenant.academicSubmissionConfig?.lessonPlanLeadDays ?? 1,
    lessonPlanCadence: tenant.academicSubmissionConfig?.lessonPlanCadence === 'Daily' ? 'Daily' : 'Weekly',
    currentWeekNumber: tenant.academicSubmissionConfig?.currentWeekNumber || 8,
    requireApprovalForParentVisibility:
      tenant.academicSubmissionConfig?.requireApprovalForParentVisibility !== false,
  };

  const isParentOrStudent = currentRole === 'Parent' || currentRole === 'Student';
  const isAdmin =
    currentRole === 'Developer' || currentRole === 'Super Admin' || currentRole === 'Admin';
  const isTeacher = currentRole === 'Teacher';
  const canAuthor = !readOnly && (isAdmin || isTeacher);

  const ownTeacherProfile = useMemo(() => {
    if (!isTeacher) return undefined;
    const normEmail = (currentUserEmail || '').trim().toLowerCase();
    if (normEmail) {
      const byEmail = tenant.teachers.find(
        (t) => (t.email || '').trim().toLowerCase() === normEmail
      );
      if (byEmail) return byEmail;
    }
    return undefined;
  }, [tenant.teachers, isTeacher, currentUserEmail]);

  const isOwnDoc = (doc: Pick<SchemeOfWork, 'teacherId' | 'createdByUserId'>) =>
    isAdmin ||
    Boolean(
      (ownTeacherProfile && doc.teacherId === ownTeacherProfile.id) ||
        doc.createdByUserId === currentUserId
    );

  // Navigation & filter state
  const [activeTab, setActiveTab] = useState<AcademicsTab>('schemes');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterGrade, setFilterGrade] = useState<string>('ALL');
  const [filterStream, setFilterStream] = useState<string>('ALL');
  const [filterSubject, setFilterSubject] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [filterTeacherId, setFilterTeacherId] = useState<string>('ALL');
  const [filterWeek, setFilterWeek] = useState<string>('ALL');

  // Parent / Student specific view state
  const [parentChildId, setParentChildId] = useState<string>(students[0]?.id || '');
  const [parentTab, setParentTab] = useState<'schemes' | 'lessons'>('schemes');
  const [expandedSchemeId, setExpandedSchemeId] = useState<string | null>(null);

  // Parent Preview filters (staff tab)
  const [previewGrade, setPreviewGrade] = useState<string>(tenant.grades[0] || 'Grade 7');
  const [previewStream, setPreviewStream] = useState<string>(
    getStreamsForGrade(tenant, tenant.grades[0] || 'Grade 7')[0] || 'A'
  );

  // Detail / Review modal state
  const [inspectScheme, setInspectScheme] = useState<SchemeOfWork | null>(null);
  const [inspectLessonPlan, setInspectLessonPlan] = useState<LessonPlan | null>(null);
  const [reviewFeedbackInput, setReviewFeedbackInput] = useState('');
  const [reviewShareWithParents, setReviewShareWithParents] = useState(true);
  const [submittingAction, setSubmittingAction] = useState(false);

  // Scheme Create/Edit Modal state
  const [schemeModalOpen, setSchemeModalOpen] = useState(false);
  const [editingSchemeId, setEditingSchemeId] = useState<string | undefined>(undefined);
  const [schemeGrade, setSchemeGrade] = useState(tenant.grades[0] || 'Grade 7');
  const [schemeSection, setSchemeSection] = useState(
    getStreamsForGrade(tenant, tenant.grades[0] || 'Grade 7')[0] || 'A'
  );
  const [schemeSubject, setSchemeSubject] = useState(
    getSubjectsForGrade(tenant, tenant.grades[0] || 'Grade 7')[0] || 'Mathematics'
  );
  const [schemeTeacherId, setSchemeTeacherId] = useState(
    ownTeacherProfile?.id || tenant.teachers[0]?.id || ''
  );
  const [schemeTitle, setSchemeTitle] = useState('');
  const [schemeRefBook, setSchemeRefBook] = useState('');
  const [schemeParentSummary, setSchemeParentSummary] = useState('');
  const [schemeWeeks, setSchemeWeeks] = useState<SchemeOfWorkWeek[]>([]);

  // Lesson Plan Create/Edit Modal state
  const [lpModalOpen, setLpModalOpen] = useState(false);
  const [editingLpId, setEditingLpId] = useState<string | undefined>(undefined);
  const [lpSchemeId, setLpSchemeId] = useState('');
  const [lpGrade, setLpGrade] = useState(tenant.grades[0] || 'Grade 7');
  const [lpSection, setLpSection] = useState(
    getStreamsForGrade(tenant, tenant.grades[0] || 'Grade 7')[0] || 'A'
  );
  const [lpSubject, setLpSubject] = useState(
    getSubjectsForGrade(tenant, tenant.grades[0] || 'Grade 7')[0] || 'Mathematics'
  );
  const [lpTeacherId, setLpTeacherId] = useState(
    ownTeacherProfile?.id || tenant.teachers[0]?.id || ''
  );
  const [lpWeekNumber, setLpWeekNumber] = useState(submissionConfig.currentWeekNumber);
  const [lpLessonDate, setLpLessonDate] = useState('2026-11-18');
  const [lpPeriodNumber, setLpPeriodNumber] = useState(1);
  const [lpDuration, setLpDuration] = useState(40);
  const [lpStrand, setLpStrand] = useState('');
  const [lpSubStrand, setLpSubStrand] = useState('');
  const [lpTitle, setLpTitle] = useState('');
  const [lpOutcomes, setLpOutcomes] = useState('');
  const [lpResources, setLpResources] = useState('');
  const [lpIntro, setLpIntro] = useState('');
  const [lpDev, setLpDev] = useState('');
  const [lpConclusion, setLpConclusion] = useState('');
  const [lpHomework, setLpHomework] = useState('');
  const [lpReflection, setLpReflection] = useState('');

  // Deadline Config Modal (Admin)
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [cfgDueDate, setCfgDueDate] = useState(submissionConfig.schemeDueDate);
  const [cfgLeadDays, setCfgLeadDays] = useState(submissionConfig.lessonPlanLeadDays);
  const [cfgCadence, setCfgCadence] = useState<'Weekly' | 'Daily'>(
    submissionConfig.lessonPlanCadence
  );
  const [cfgWeekNumber, setCfgWeekNumber] = useState(submissionConfig.currentWeekNumber);
  const [cfgRequireApproval, setCfgRequireApproval] = useState(
    submissionConfig.requireApprovalForParentVisibility
  );

  // Derived lists for filters & cohorts
  const availableGradesForEditor = useMemo(() => {
    if (!isTeacher || !ownTeacherProfile) return tenant.grades;
    const assigned = ownTeacherProfile.assignedClasses || [];
    if (assigned.length === 0) return tenant.grades;
    const set = new Set(assigned.map((c) => c.grade));
    const filtered = tenant.grades.filter((g) => set.has(g));
    return filtered.length > 0 ? filtered : tenant.grades;
  }, [isTeacher, ownTeacherProfile, tenant.grades]);

  const getAllowedSubjectsForEditor = (grade: string, section: string): string[] => {
    const gradeSubs = getSubjectsForGrade(tenant, grade);
    if (!isTeacher || !ownTeacherProfile) return gradeSubs;
    const resolvedSection =
      section === 'All Streams' ? getStreamsForGrade(tenant, grade)[0] || 'A' : section;
    const assignedSubs = getTeacherAssignedSubjectsForCohort(
      tenant,
      ownTeacherProfile,
      grade,
      resolvedSection,
      timetable
    );
    return assignedSubs.length > 0 ? assignedSubs : gradeSubs;
  };

  // Submission compliance summary across faculty
  const trackingSummary = useMemo(() => {
    const rows = tenant.teachers.map((tc) => {
      const expected = resolveExpectedCohortsForTeacher(tenant, tc, timetable);
      const tcSchemes = schemes.filter((s) => s.teacherId === tc.id);
      const tcPlans = lessonPlans.filter((l) => l.teacherId === tc.id);
      const activeWeekPlans = tcPlans.filter(
        (l) => l.weekNumber === submissionConfig.currentWeekNumber
      );

      let approvedCount = 0;
      let submittedCount = 0;
      let revisionCount = 0;
      let draftCount = 0;
      let lateCount = 0;

      for (const s of tcSchemes) {
        if (s.status === 'Approved') approvedCount += 1;
        else if (s.status === 'Submitted') submittedCount += 1;
        else if (s.status === 'Revision Requested') revisionCount += 1;
        else draftCount += 1;
        if (isLateAgainstDate(s.submittedAt, s.dueDate || submissionConfig.schemeDueDate)) {
          lateCount += 1;
        }
      }

      const missingCohorts = expected.filter(
        (exp) =>
          !tcSchemes.some(
            (s) =>
              s.grade === exp.grade &&
              (s.section === exp.section || s.section === 'All Streams') &&
              s.subject.toLowerCase() === exp.subject.toLowerCase()
          )
      );

      return {
        teacher: tc,
        expectedCount: expected.length,
        schemesCount: tcSchemes.length,
        approvedCount,
        submittedCount,
        revisionCount,
        draftCount,
        lateCount,
        activeWeekPlansCount: activeWeekPlans.length,
        totalPlansCount: tcPlans.length,
        missingCohorts,
      };
    });

    const filteredRows =
      isTeacher && ownTeacherProfile
        ? rows.filter((r) => r.teacher.id === ownTeacherProfile.id)
        : rows;

    const missingGaps = filteredRows.flatMap((r) =>
      r.missingCohorts.map((m) => ({
        teacher: r.teacher,
        grade: m.grade,
        section: m.section,
        subject: m.subject,
      }))
    );

    const totalExpected = filteredRows.reduce((s, r) => s + r.expectedCount, 0);
    const totalSubmittedOrApproved = filteredRows.reduce(
      (s, r) => s + r.approvedCount + r.submittedCount,
      0
    );

    return {
      rows: filteredRows,
      missingGaps,
      totalExpected,
      totalSubmittedOrApproved,
    };
  }, [
    tenant,
    timetable,
    schemes,
    lessonPlans,
    submissionConfig.currentWeekNumber,
    submissionConfig.schemeDueDate,
    isTeacher,
    ownTeacherProfile,
  ]);

  const kpis = useMemo(() => {
    const visibleSchemes = isTeacher && ownTeacherProfile
      ? schemes.filter(isOwnDoc)
      : schemes;
    const visiblePlans = isTeacher && ownTeacherProfile
      ? lessonPlans.filter(isOwnDoc)
      : lessonPlans;

    const submittedSchemes = visibleSchemes.filter(
      (s) => s.status === 'Approved' || s.status === 'Submitted'
    ).length;
    const pendingSchemes = visibleSchemes.filter((s) => s.status === 'Submitted').length;
    const pendingPlans = visiblePlans.filter((l) => l.status === 'Submitted').length;
    const revisionCount =
      visibleSchemes.filter((s) => s.status === 'Revision Requested').length +
      visiblePlans.filter((l) => l.status === 'Revision Requested').length;
    const activeWeekPlans = visiblePlans.filter(
      (l) => l.weekNumber === submissionConfig.currentWeekNumber
    ).length;
    const parentSharedCount =
      visibleSchemes.filter((s) => s.status === 'Approved' && s.parentVisible).length +
      visiblePlans.filter((l) => l.status === 'Approved' && l.parentVisible).length;

    return {
      submittedSchemes,
      totalSchemes: visibleSchemes.length,
      pendingReview: pendingSchemes + pendingPlans,
      revisionCount,
      activeWeekPlans,
      totalPlans: visiblePlans.length,
      parentSharedCount,
    };
  }, [schemes, lessonPlans, isTeacher, ownTeacherProfile, submissionConfig.currentWeekNumber]);

  const filteredSchemes = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return schemes.filter((s) => {
      if (filterGrade !== 'ALL' && s.grade !== filterGrade) return false;
      if (filterStream !== 'ALL' && s.section !== filterStream) return false;
      if (filterSubject !== 'ALL' && s.subject !== filterSubject) return false;
      if (filterStatus !== 'ALL' && s.status !== filterStatus) return false;
      if (filterTeacherId !== 'ALL' && s.teacherId !== filterTeacherId) return false;
      if (
        q &&
        !`${s.title} ${s.subject} ${s.teacherName} ${s.grade} ${s.section}`
          .toLowerCase()
          .includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [schemes, searchTerm, filterGrade, filterStream, filterSubject, filterStatus, filterTeacherId]);

  const filteredLessonPlans = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return lessonPlans.filter((lp) => {
      if (filterGrade !== 'ALL' && lp.grade !== filterGrade) return false;
      if (filterStream !== 'ALL' && lp.section !== filterStream) return false;
      if (filterSubject !== 'ALL' && lp.subject !== filterSubject) return false;
      if (filterStatus !== 'ALL' && lp.status !== filterStatus) return false;
      if (filterTeacherId !== 'ALL' && lp.teacherId !== filterTeacherId) return false;
      if (filterWeek !== 'ALL' && String(lp.weekNumber) !== filterWeek) return false;
      if (
        q &&
        !`${lp.lessonTitle} ${lp.strand} ${lp.subStrand} ${lp.subject} ${lp.teacherName}`
          .toLowerCase()
          .includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [
    lessonPlans,
    searchTerm,
    filterGrade,
    filterStream,
    filterSubject,
    filterStatus,
    filterTeacherId,
    filterWeek,
  ]);

  const distinctSubjects = useMemo(() => {
    const set = new Set<string>(tenant.subjects);
    schemes.forEach((s) => set.add(s.subject));
    lessonPlans.forEach((l) => set.add(l.subject));
    return Array.from(set).sort();
  }, [tenant.subjects, schemes, lessonPlans]);

  // Modal openers
  const openCreateSchemeModal = (prefill?: { grade?: string; section?: string; subject?: string }) => {
    const g = prefill?.grade || availableGradesForEditor[0] || tenant.grades[0] || 'Grade 7';
    const streams = getStreamsForGrade(tenant, g);
    const sec = prefill?.section || streams[0] || 'A';
    const allowedSubs = getAllowedSubjectsForEditor(g, sec);
    const sub = prefill?.subject || allowedSubs[0] || tenant.subjects[0] || 'Mathematics';
    setEditingSchemeId(undefined);
    setSchemeGrade(g);
    setSchemeSection(sec);
    setSchemeSubject(sub);
    setSchemeTeacherId(ownTeacherProfile?.id || tenant.teachers[0]?.id || '');
    setSchemeTitle(`${g} ${sec} ${sub} — ${tenant.currentTerm} Scheme of Work`);
    setSchemeRefBook('');
    setSchemeParentSummary('');
    setSchemeWeeks(generateClientSchemeWeeks(sub, 8));
    setSchemeModalOpen(true);
  };

  const openEditSchemeModal = (s: SchemeOfWork, asDuplicate = false) => {
    setEditingSchemeId(asDuplicate ? undefined : s.id);
    setSchemeGrade(s.grade);
    const streams = getStreamsForGrade(tenant, s.grade);
    const nextSec = asDuplicate
      ? streams.find((st) => st !== s.section) || s.section
      : s.section;
    setSchemeSection(nextSec);
    setSchemeSubject(s.subject);
    setSchemeTeacherId(s.teacherId);
    setSchemeTitle(
      asDuplicate ? `${s.grade} ${nextSec} ${s.subject} — ${s.term} Scheme of Work` : s.title
    );
    setSchemeRefBook(s.referenceBook || '');
    setSchemeParentSummary(s.parentSummary || '');
    setSchemeWeeks(s.weeks.map((w) => ({ ...w })));
    setSchemeModalOpen(true);
  };

  const openCreateLessonPlanModal = (linkedScheme?: SchemeOfWork) => {
    const g = linkedScheme?.grade || availableGradesForEditor[0] || tenant.grades[0] || 'Grade 7';
    const sec = linkedScheme?.section || getStreamsForGrade(tenant, g)[0] || 'A';
    const allowedSubs = getAllowedSubjectsForEditor(g, sec);
    const sub = linkedScheme?.subject || allowedSubs[0] || tenant.subjects[0] || 'Mathematics';
    const weekNum = submissionConfig.currentWeekNumber;
    const weekMatch = linkedScheme?.weeks.find((w) => w.weekNumber === weekNum) || linkedScheme?.weeks[0];

    setEditingLpId(undefined);
    setLpSchemeId(linkedScheme?.id || '');
    setLpGrade(g);
    setLpSection(sec);
    setLpSubject(sub);
    setLpTeacherId(linkedScheme?.teacherId || ownTeacherProfile?.id || tenant.teachers[0]?.id || '');
    setLpWeekNumber(weekNum);
    setLpLessonDate('2026-11-18');
    setLpPeriodNumber(1);
    setLpDuration(40);
    setLpStrand(weekMatch?.strand || 'Foundational Concepts');
    setLpSubStrand(weekMatch?.subStrand || 'Core Inquiry');
    setLpTitle(`${sub}: ${weekMatch?.subStrand || 'Core Lesson'}`);
    setLpOutcomes(
      weekMatch?.learningOutcomes ||
        'Demonstrate understanding of the core CBC competency and apply it in guided practice.'
    );
    setLpResources(weekMatch?.resources || 'KICD Learner Book, visual aids, exercise books');
    setLpIntro(
      weekMatch?.keyInquiryQuestion
        ? `5 min: Review prior knowledge using key inquiry question: "${weekMatch.keyInquiryQuestion}"`
        : '5 min: Recap previous lesson concepts and introduce the key inquiry question.'
    );
    setLpDev(
      weekMatch?.learningActivities ||
        '25 min: Teacher demonstration followed by collaborative group tasks and board checks.'
    );
    setLpConclusion('10 min: Plenary recap, learner exit check, and homework briefing.');
    setLpHomework('');
    setLpReflection('');
    setLpModalOpen(true);
  };

  const openEditLessonPlanModal = (lp: LessonPlan) => {
    setEditingLpId(lp.id);
    setLpSchemeId(lp.schemeOfWorkId || '');
    setLpGrade(lp.grade);
    setLpSection(lp.section);
    setLpSubject(lp.subject);
    setLpTeacherId(lp.teacherId);
    setLpWeekNumber(lp.weekNumber);
    setLpLessonDate(lp.lessonDate);
    setLpPeriodNumber(lp.periodNumber || 1);
    setLpDuration(lp.durationMinutes);
    setLpStrand(lp.strand);
    setLpSubStrand(lp.subStrand);
    setLpTitle(lp.lessonTitle);
    setLpOutcomes(lp.learningOutcomes);
    setLpResources(lp.learningResources);
    setLpIntro(lp.introductionActivity);
    setLpDev(lp.lessonDevelopment);
    setLpConclusion(lp.conclusionActivity);
    setLpHomework(lp.extendedHomework || '');
    setLpReflection(lp.teacherReflection || '');
    setLpModalOpen(true);
  };

  const handleApplyLinkedSchemeToLp = (schemeId: string, weekNum: number) => {
    setLpSchemeId(schemeId);
    const found = schemes.find((s) => s.id === schemeId);
    if (!found) return;
    setLpGrade(found.grade);
    setLpSection(found.section);
    setLpSubject(found.subject);
    const wk = found.weeks.find((w) => w.weekNumber === weekNum) || found.weeks[0];
    if (wk) {
      setLpStrand(wk.strand);
      setLpSubStrand(wk.subStrand);
      setLpTitle(`${found.subject}: ${wk.subStrand}`);
      setLpOutcomes(wk.learningOutcomes);
      setLpResources(wk.resources);
      if (wk.keyInquiryQuestion) {
        setLpIntro(`5 min: Explore key inquiry question: "${wk.keyInquiryQuestion}"`);
      }
      setLpDev(wk.learningActivities);
    }
  };

  // API Mutations
  const handleSaveScheme = async (submitNow: boolean) => {
    setSubmittingAction(true);
    try {
      await saasApi.saveSchemeOfWork(tenant.id, {
        id: editingSchemeId,
        grade: schemeGrade,
        section: schemeSection,
        subject: schemeSubject,
        teacherId: isAdmin ? schemeTeacherId || undefined : undefined,
        title: schemeTitle,
        referenceBook: schemeRefBook,
        parentSummary: schemeParentSummary,
        weeksCount: schemeWeeks.length,
        weeks: schemeWeeks,
        submitNow,
      });
      setSchemeModalOpen(false);
      onNotify(
        submitNow ? 'Scheme of Work submitted for academic review.' : 'Scheme of Work saved as draft.',
        'success'
      );
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not save Scheme of Work.', 'error');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleSaveLessonPlan = async (submitNow: boolean) => {
    setSubmittingAction(true);
    try {
      await saasApi.saveLessonPlan(tenant.id, {
        id: editingLpId,
        schemeOfWorkId: lpSchemeId || undefined,
        grade: lpGrade,
        section: lpSection,
        subject: lpSubject,
        teacherId: isAdmin ? lpTeacherId || undefined : undefined,
        weekNumber: lpWeekNumber,
        lessonDate: lpLessonDate,
        periodNumber: lpPeriodNumber,
        durationMinutes: lpDuration,
        strand: lpStrand,
        subStrand: lpSubStrand,
        lessonTitle: lpTitle,
        learningOutcomes: lpOutcomes,
        learningResources: lpResources,
        introductionActivity: lpIntro,
        lessonDevelopment: lpDev,
        conclusionActivity: lpConclusion,
        extendedHomework: lpHomework,
        teacherReflection: lpReflection,
        submitNow,
      });
      setLpModalOpen(false);
      onNotify(
        submitNow ? 'Lesson Plan submitted for review.' : 'Lesson Plan saved as draft.',
        'success'
      );
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not save Lesson Plan.', 'error');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleSubmitScheme = async (schemeId: string) => {
    setSubmittingAction(true);
    try {
      await saasApi.submitSchemeOfWork(tenant.id, schemeId);
      onNotify('Scheme of Work submitted for admin review.', 'success');
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Submission failed.', 'error');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleSubmitLessonPlan = async (lpId: string) => {
    setSubmittingAction(true);
    try {
      await saasApi.submitLessonPlan(tenant.id, lpId);
      onNotify('Lesson Plan submitted for admin review.', 'success');
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Submission failed.', 'error');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleReviewScheme = async (
    schemeId: string,
    decision: 'Approved' | 'Revision Requested'
  ) => {
    setSubmittingAction(true);
    try {
      const res = await saasApi.reviewSchemeOfWork(tenant.id, schemeId, {
        decision,
        reviewFeedback: reviewFeedbackInput,
        parentVisible: decision === 'Approved' ? reviewShareWithParents : false,
      });
      setInspectScheme(res.scheme);
      setReviewFeedbackInput('');
      onNotify(`Scheme marked as ${decision}.`, 'success');
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Review action failed.', 'error');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleReviewLessonPlan = async (
    lpId: string,
    decision: 'Approved' | 'Revision Requested'
  ) => {
    setSubmittingAction(true);
    try {
      const res = await saasApi.reviewLessonPlan(tenant.id, lpId, {
        decision,
        reviewFeedback: reviewFeedbackInput,
        parentVisible: decision === 'Approved' ? reviewShareWithParents : false,
      });
      setInspectLessonPlan(res.lessonPlan);
      setReviewFeedbackInput('');
      onNotify(`Lesson Plan marked as ${decision}.`, 'success');
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Review action failed.', 'error');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleToggleSchemeVisibility = async (s: SchemeOfWork) => {
    setSubmittingAction(true);
    try {
      const res = await saasApi.setSchemeParentVisibility(tenant.id, s.id, !s.parentVisible);
      if (inspectScheme?.id === s.id) setInspectScheme(res.scheme);
      onNotify(
        res.scheme.parentVisible
          ? 'Scheme is now visible on the Parent Portal.'
          : 'Scheme hidden from the Parent Portal.',
        'info'
      );
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Visibility update failed.', 'error');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleToggleLessonPlanVisibility = async (lp: LessonPlan) => {
    setSubmittingAction(true);
    try {
      const res = await saasApi.setLessonPlanParentVisibility(tenant.id, lp.id, !lp.parentVisible);
      if (inspectLessonPlan?.id === lp.id) setInspectLessonPlan(res.lessonPlan);
      onNotify(
        res.lessonPlan.parentVisible
          ? 'Lesson Plan is now visible on the Parent Portal.'
          : 'Lesson Plan hidden from the Parent Portal.',
        'info'
      );
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Visibility update failed.', 'error');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleDeleteScheme = async (schemeId: string) => {
    setSubmittingAction(true);
    try {
      await saasApi.deleteSchemeOfWork(tenant.id, schemeId);
      if (inspectScheme?.id === schemeId) setInspectScheme(null);
      onNotify('Scheme of Work deleted.', 'info');
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Delete failed.', 'error');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleDeleteLessonPlan = async (lpId: string) => {
    setSubmittingAction(true);
    try {
      await saasApi.deleteLessonPlan(tenant.id, lpId);
      if (inspectLessonPlan?.id === lpId) setInspectLessonPlan(null);
      onNotify('Lesson Plan deleted.', 'info');
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Delete failed.', 'error');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleSaveSubmissionConfig = async () => {
    setSubmittingAction(true);
    try {
      await saasApi.updateAcademicSubmissionConfig(tenant.id, {
        schemeDueDate: cfgDueDate,
        lessonPlanLeadDays: Number(cfgLeadDays),
        lessonPlanCadence: cfgCadence,
        currentWeekNumber: Number(cfgWeekNumber),
        requireApprovalForParentVisibility: cfgRequireApproval,
      });
      setConfigModalOpen(false);
      onNotify('Submission deadlines and parent-visibility governance updated.', 'success');
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not update configuration.', 'error');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleSendReminder = async (teacherIds?: string[], targetLabel?: string) => {
    setSubmittingAction(true);
    try {
      const res = await saasApi.sendAcademicSubmissionReminder(tenant.id, {
        teacherIds,
        targetLabel,
      });
      onNotify(
        `Reminder dispatched across ${res.recipientCount} teaching profile(s).`,
        'success'
      );
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to dispatch reminder.', 'error');
    } finally {
      setSubmittingAction(false);
    }
  };

  // =========================================================================
  // PARENT / STUDENT VIEW (Read-Only, Approved + Parent-Visible Only)
  // =========================================================================
  if (isParentOrStudent) {
    const activeChild =
      students.find((s) => s.id === parentChildId) || students[0] || null;
    const childSubjects = activeChild
      ? getStudentRegisteredSubjects(tenant, activeChild)
      : [];

    const childSchemes = activeChild
      ? schemes.filter(
          (s) =>
            s.status === 'Approved' &&
            s.parentVisible &&
            s.grade === activeChild.grade &&
            (s.section === activeChild.section || s.section === 'All Streams') &&
            childSubjects.includes(s.subject) &&
            (filterSubject === 'ALL' || s.subject === filterSubject)
        )
      : [];

    const childLessonPlans = activeChild
      ? lessonPlans.filter(
          (lp) =>
            lp.status === 'Approved' &&
            lp.parentVisible &&
            lp.grade === activeChild.grade &&
            (lp.section === activeChild.section || lp.section === 'All Streams') &&
            childSubjects.includes(lp.subject) &&
            (filterSubject === 'ALL' || lp.subject === filterSubject)
        )
      : [];

    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between no-print">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Curriculum Roadmap & Weekly Lesson Highlights
            </h1>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Approved term schemes of work and weekly learning summaries shared by your teachers ·{' '}
              {tenant.academicYear} ({tenant.currentTerm})
            </p>
          </div>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Printer className="h-3.5 w-3.5" />
            Print Summary
          </button>
        </div>

        {/* Child selector + subject filter */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 no-print dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center gap-3">
            {students.length > 1 && (
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Learner
                </label>
                <select
                  value={activeChild?.id || ''}
                  onChange={(e) => {
                    setParentChildId(e.target.value);
                    setFilterSubject('ALL');
                  }}
                  className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  {students.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.fullName} ({st.grade} {st.section})
                    </option>
                  ))}
                </select>
              </div>
            )}
            {activeChild && (
              <div>
                <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Class Cohort
                </span>
                <p className="mt-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
                  {activeChild.fullName} · {activeChild.grade} Stream {activeChild.section}
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <select
              value={filterSubject}
              onChange={(e) => setFilterSubject(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="ALL">All Registered Subjects</option>
              {childSubjects.map((sub) => (
                <option key={sub} value={sub}>
                  {sub}
                </option>
              ))}
            </select>

            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-800 dark:bg-slate-950">
              <button
                onClick={() => setParentTab('schemes')}
                className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                  parentTab === 'schemes'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Term Schemes ({childSchemes.length})
              </button>
              <button
                onClick={() => setParentTab('lessons')}
                className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                  parentTab === 'lessons'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Weekly Highlights ({childLessonPlans.length})
              </button>
            </div>
          </div>
        </div>

        {/* Printable Document Header */}
        <div className="hidden print:block rounded-xl border border-slate-200 bg-white p-6">
          <TenantDocumentHeader
            tenant={tenant}
            documentTitle="Parent Curriculum Overview"
            subtitle={
              activeChild
                ? `${activeChild.fullName} (${activeChild.grade} ${activeChild.section})`
                : undefined
            }
            rightMeta={[
              { label: 'Year', value: tenant.academicYear },
              { label: 'Term', value: tenant.currentTerm },
            ]}
          />
        </div>

        {!activeChild ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            No learner profile is currently linked to this account.
          </div>
        ) : parentTab === 'schemes' ? (
          childSchemes.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
              <BookOpen className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" />
              <p className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-200">
                No approved schemes shared for {activeChild.grade} {activeChild.section} yet
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Once subject teachers submit their schemes and the academic office approves them for
                parent viewing, weekly outlines will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {childSchemes.map((s) => {
                const isExpanded = expandedSchemeId === s.id;
                return (
                  <div
                    key={s.id}
                    className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                            {s.title}
                          </h3>
                          <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                            Approved Curriculum
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {s.subject} · Teacher: {s.teacherName} ·{' '}
                          <span className="font-mono tabular-nums">{s.weeksCount} Weeks</span>
                          {s.referenceBook ? ` · Core Text: ${s.referenceBook}` : ''}
                        </p>
                        {s.parentSummary && (
                          <p className="mt-2 text-xs text-slate-700 dark:text-slate-300">
                            {s.parentSummary}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => setExpandedSchemeId(isExpanded ? null : s.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 no-print dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        {isExpanded ? (
                          <>
                            <ChevronUp className="h-3.5 w-3.5" />
                            Hide Weekly Plan
                          </>
                        ) : (
                          <>
                            <ChevronDown className="h-3.5 w-3.5" />
                            View {s.weeks.length}-Week Outline
                          </>
                        )}
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-slate-100 overflow-x-auto dark:border-slate-800">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                            <tr>
                              <th className="px-4 py-2.5">Week</th>
                              <th className="px-4 py-2.5">Strand & Sub-Strand</th>
                              <th className="px-4 py-2.5">Learning Outcomes</th>
                              <th className="px-4 py-2.5">Resources & Activities</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {s.weeks.map((wk) => (
                              <tr key={wk.weekNumber} className="align-top">
                                <td className="px-4 py-3 font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                                  Wk {wk.weekNumber}
                                </td>
                                <td className="px-4 py-3">
                                  <p className="font-semibold text-slate-900 dark:text-slate-100">
                                    {wk.strand}
                                  </p>
                                  <p className="mt-0.5 text-slate-500 dark:text-slate-400">
                                    {wk.subStrand}
                                  </p>
                                </td>
                                <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                                  {wk.learningOutcomes}
                                </td>
                                <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                                  <p>{wk.learningActivities}</p>
                                  <p className="mt-1 text-[11px] text-slate-500">
                                    Materials: {wk.resources}
                                  </p>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        ) : childLessonPlans.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
            <FileText className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" />
            <p className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-200">
              No weekly lesson highlights published for {activeChild.grade} {activeChild.section} yet
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Approved lesson summaries and parent home follow-up prompts will appear here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {childLessonPlans.map((lp) => (
              <div
                key={lp.id}
                className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-[11px] font-medium text-slate-500 tabular-nums dark:text-slate-400">
                      Week {lp.weekNumber} · {lp.lessonDate} · {lp.subject}
                    </p>
                    <h3 className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100">
                      {lp.lessonTitle}
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {lp.strand} — {lp.subStrand} · Teacher: {lp.teacherName}
                    </p>
                  </div>
                  <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 shrink-0 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                    Approved
                  </span>
                </div>
                <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
                  <div>
                    <span className="font-semibold text-slate-700 dark:text-slate-200">
                      Learning Focus:{' '}
                    </span>
                    <span className="text-slate-600 dark:text-slate-400">{lp.learningOutcomes}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-700 dark:text-slate-200">
                      Required Materials:{' '}
                    </span>
                    <span className="text-slate-600 dark:text-slate-400">{lp.learningResources}</span>
                  </div>
                  {lp.extendedHomework && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-2.5 text-blue-950 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200">
                      <span className="font-semibold">Home Follow-Up / Homework: </span>
                      {lp.extendedHomework}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // STAFF WORKSPACE VIEW (Admin, Super Admin, Developer, Teacher, Registrar)
  // =========================================================================
  const previewCohortSchemes = schemes.filter(
    (s) =>
      s.status === 'Approved' &&
      s.parentVisible &&
      s.grade === previewGrade &&
      (s.section === previewStream || s.section === 'All Streams')
  );
  const previewCohortLessonPlans = lessonPlans.filter(
    (lp) =>
      lp.status === 'Approved' &&
      lp.parentVisible &&
      lp.grade === previewGrade &&
      (lp.section === previewStream || lp.section === 'All Streams')
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between no-print">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Teacher Academics — Schemes & Lesson Plans
          </h1>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {tenant.name} · {tenant.academicYear} ({tenant.currentTerm}) · Active Week{' '}
            <span className="font-mono font-semibold tabular-nums">
              Week {submissionConfig.currentWeekNumber}
            </span>{' '}
            · Scheme Cutoff{' '}
            <span className="font-mono font-semibold tabular-nums">
              {submissionConfig.schemeDueDate}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && !readOnly && (
            <>
              <button
                onClick={() => {
                  setCfgDueDate(submissionConfig.schemeDueDate);
                  setCfgLeadDays(submissionConfig.lessonPlanLeadDays);
                  setCfgCadence(submissionConfig.lessonPlanCadence);
                  setCfgWeekNumber(submissionConfig.currentWeekNumber);
                  setCfgRequireApproval(submissionConfig.requireApprovalForParentVisibility);
                  setConfigModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Submission Deadlines
              </button>
              <button
                disabled={submittingAction}
                onClick={() =>
                  handleSendReminder(
                    trackingSummary.missingGaps.map((g) => g.teacher.id),
                    'Faculty with pending schemes or active-week plans'
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Bell className="h-3.5 w-3.5" />
                Send Reminder
              </button>
            </>
          )}
          {canAuthor && (
            <>
              <button
                onClick={() => openCreateSchemeModal()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0 dark:bg-blue-600 dark:hover:bg-blue-500"
              >
                <Plus className="h-3.5 w-3.5" />
                New Scheme of Work
              </button>
              <button
                onClick={() => openCreateLessonPlanModal()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                <Plus className="h-3.5 w-3.5" />
                New Lesson Plan
              </button>
            </>
          )}
        </div>
      </div>

      {/* 4-Card KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 no-print">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold uppercase tracking-wide">Schemes Submitted</span>
            <BookOpen className="h-4 w-4 text-slate-400" />
          </div>
          <p className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
            {kpis.submittedSchemes}
            <span className="ml-1 text-sm font-normal text-slate-400">/ {kpis.totalSchemes}</span>
          </p>
          <p className="mt-1 text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
            {trackingSummary.totalExpected > 0
              ? `${Math.min(100, Math.round((trackingSummary.totalSubmittedOrApproved / trackingSummary.totalExpected) * 100))}% of assigned cohorts covered`
              : 'Cohort coverage active'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold uppercase tracking-wide">Pending Review</span>
            <Clock className="h-4 w-4 text-slate-400" />
          </div>
          <p className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
            {kpis.pendingReview}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
            {kpis.revisionCount} document(s) in revision requested
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold uppercase tracking-wide">
              Week {submissionConfig.currentWeekNumber} Lesson Plans
            </span>
            <FileCheck2 className="h-4 w-4 text-slate-400" />
          </div>
          <p className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
            {kpis.activeWeekPlans}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
            {kpis.totalPlans} total term lesson plans recorded
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold uppercase tracking-wide">Parent Portal Shared</span>
            <Eye className="h-4 w-4 text-slate-400" />
          </div>
          <p className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
            {kpis.parentSharedCount}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {submissionConfig.requireApprovalForParentVisibility
              ? 'Requires Admin approval before publishing'
              : 'Direct visibility enabled'}
          </p>
        </div>
      </div>

      {/* Sub-Navigation Tabs + Filter Bar */}
      <div className="space-y-4 no-print">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'schemes', label: `Schemes of Work (${schemes.length})`, icon: BookOpen },
                { id: 'lesson-plans', label: `Lesson Plans (${lessonPlans.length})`, icon: FileText },
                {
                  id: 'tracking',
                  label: `Submission Tracking (${trackingSummary.missingGaps.length} gaps)`,
                  icon: Users,
                },
                { id: 'parent-preview', label: 'Parent Portal Preview', icon: Eye },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-slate-900 text-white dark:bg-blue-600 dark:text-white'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {(activeTab === 'schemes' || activeTab === 'lesson-plans') && (
          <div className="grid grid-cols-1 gap-2.5 rounded-xl border border-slate-200 bg-white p-3.5 sm:grid-cols-2 lg:grid-cols-6 dark:border-slate-800 dark:bg-slate-900">
            <div className="relative lg:col-span-2">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search title, strand, subject, or teacher..."
                className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-800 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <select
              value={filterGrade}
              onChange={(e) => {
                setFilterGrade(e.target.value);
                setFilterStream('ALL');
              }}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="ALL">All Grades</option>
              {tenant.grades.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>

            <select
              value={filterSubject}
              onChange={(e) => setFilterSubject(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="ALL">All Subjects</option>
              {distinctSubjects.map((sub) => (
                <option key={sub} value={sub}>
                  {sub}
                </option>
              ))}
            </select>

            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="ALL">All Statuses</option>
              <option value="Approved">Approved</option>
              <option value="Submitted">Submitted</option>
              <option value="Revision Requested">Revision Requested</option>
              <option value="Draft">Draft</option>
            </select>

            {activeTab === 'lesson-plans' ? (
              <select
                value={filterWeek}
                onChange={(e) => setFilterWeek(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="ALL">All Weeks</option>
                {Array.from({ length: 14 }, (_, i) => i + 1).map((wk) => (
                  <option key={wk} value={String(wk)}>
                    Week {wk}
                  </option>
                ))}
              </select>
            ) : (
              <select
                value={filterTeacherId}
                onChange={(e) => setFilterTeacherId(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="ALL">All Teachers</option>
                {tenant.teachers.map((tc) => (
                  <option key={tc.id} value={tc.id}>
                    {tc.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      {/* TAB 1: SCHEMES OF WORK */}
      {activeTab === 'schemes' && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Scheme Title & Term</th>
                  <th className="px-4 py-3">Class & Subject</th>
                  <th className="px-4 py-3">Teacher</th>
                  <th className="px-4 py-3">Weeks</th>
                  <th className="px-4 py-3">Status & Timeliness</th>
                  <th className="px-4 py-3">Parent Portal</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredSchemes.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-12 text-center text-xs text-slate-500 dark:text-slate-400"
                    >
                      No Schemes of Work match the current filters.
                    </td>
                  </tr>
                ) : (
                  filteredSchemes.map((s) => {
                    const late = isLateAgainstDate(
                      s.submittedAt,
                      s.dueDate || submissionConfig.schemeDueDate
                    );
                    const editable = canAuthor && isOwnDoc(s);
                    return (
                      <tr
                        key={s.id}
                        className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                      >
                        <td className="px-4 py-3">
                          <button
                            onClick={() => {
                              setInspectScheme(s);
                              setReviewFeedbackInput(s.reviewFeedback || '');
                              setReviewShareWithParents(s.parentVisible || true);
                            }}
                            className="font-semibold text-slate-900 hover:text-blue-600 text-left dark:text-slate-100 dark:hover:text-blue-400"
                          >
                            {s.title}
                          </button>
                          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                            {s.academicYear} · {s.term}
                            {s.reviewFeedback && s.status === 'Revision Requested' && (
                              <span className="ml-2 text-amber-700 dark:text-amber-300">
                                Note: {s.reviewFeedback.slice(0, 60)}
                                {s.reviewFeedback.length > 60 ? '...' : ''}
                              </span>
                            )}
                          </p>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="font-medium text-slate-800 dark:text-slate-200">
                            {s.grade} · {s.section}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {s.subject}
                          </p>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-700 dark:text-slate-300">
                          {s.teacherName}
                        </td>
                        <td className="px-4 py-3 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                          {s.weeksCount} wks
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE_MAP[s.status]}`}
                          >
                            {s.status}
                          </span>
                          {s.submittedAt && (
                            <p className="mt-1 font-mono text-[10px] text-slate-500 tabular-nums dark:text-slate-400">
                              {s.submittedAt.slice(0, 10)} {late ? '(Late)' : '(On Time)'}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {s.status === 'Approved' ? (
                            editable ? (
                              <button
                                disabled={submittingAction}
                                onClick={() => handleToggleSchemeVisibility(s)}
                                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium whitespace-nowrap ${
                                  s.parentVisible
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                                    : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                }`}
                              >
                                {s.parentVisible ? (
                                  <>
                                    <Eye className="h-3 w-3" />
                                    Visible
                                  </>
                                ) : (
                                  <>
                                    <EyeOff className="h-3 w-3" />
                                    Hidden
                                  </>
                                )}
                              </button>
                            ) : (
                              <span className="text-[11px] text-slate-500">
                                {s.parentVisible ? 'Visible' : 'Hidden'}
                              </span>
                            )
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                              <Lock className="h-3 w-3" />
                              Needs Approval
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              onClick={() => {
                                setInspectScheme(s);
                                setReviewFeedbackInput(s.reviewFeedback || '');
                                setReviewShareWithParents(true);
                              }}
                              className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                            >
                              {isAdmin && s.status === 'Submitted' ? 'Review' : 'View'}
                            </button>
                            {editable && (
                              <>
                                <button
                                  onClick={() => openEditSchemeModal(s)}
                                  className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                                >
                                  Edit
                                </button>
                                <button
                                  title="Duplicate to another stream"
                                  onClick={() => openEditSchemeModal(s, true)}
                                  className="rounded-md border border-slate-200 p-1 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                                >
                                  <Copy className="h-3 w-3" />
                                </button>
                                {(s.status === 'Draft' || s.status === 'Revision Requested') && (
                                  <button
                                    disabled={submittingAction}
                                    onClick={() => handleSubmitScheme(s.id)}
                                    className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-500"
                                  >
                                    <Send className="h-3 w-3" />
                                    Submit
                                  </button>
                                )}
                                {(isAdmin || s.status !== 'Approved') && (
                                  <button
                                    disabled={submittingAction}
                                    onClick={() => handleDeleteScheme(s.id)}
                                    title="Delete scheme"
                                    className="rounded-md border border-slate-200 p-1 text-slate-500 hover:border-red-200 hover:text-red-600 dark:border-slate-700 dark:text-slate-400"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: LESSON PLANS */}
      {activeTab === 'lesson-plans' && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Lesson Title & Strand</th>
                  <th className="px-4 py-3">Class & Subject</th>
                  <th className="px-4 py-3">Schedule</th>
                  <th className="px-4 py-3">Teacher</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Parent Portal</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredLessonPlans.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-12 text-center text-xs text-slate-500 dark:text-slate-400"
                    >
                      No Lesson Plans match the current filters.
                    </td>
                  </tr>
                ) : (
                  filteredLessonPlans.map((lp) => {
                    const editable = canAuthor && isOwnDoc(lp);
                    return (
                      <tr
                        key={lp.id}
                        className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                      >
                        <td className="px-4 py-3">
                          <button
                            onClick={() => {
                              setInspectLessonPlan(lp);
                              setReviewFeedbackInput(lp.reviewFeedback || '');
                              setReviewShareWithParents(lp.parentVisible || true);
                            }}
                            className="font-semibold text-slate-900 hover:text-blue-600 text-left dark:text-slate-100 dark:hover:text-blue-400"
                          >
                            {lp.lessonTitle}
                          </button>
                          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                            {lp.strand} · {lp.subStrand}
                          </p>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="font-medium text-slate-800 dark:text-slate-200">
                            {lp.grade} · {lp.section}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {lp.subject}
                          </p>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap font-mono tabular-nums text-slate-700 dark:text-slate-300">
                          <p>
                            Wk {lp.weekNumber} · {lp.lessonDate}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {lp.periodNumber ? `Period ${lp.periodNumber} · ` : ''}
                            {lp.durationMinutes} min
                          </p>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-700 dark:text-slate-300">
                          {lp.teacherName}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE_MAP[lp.status]}`}
                          >
                            {lp.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {lp.status === 'Approved' ? (
                            editable ? (
                              <button
                                disabled={submittingAction}
                                onClick={() => handleToggleLessonPlanVisibility(lp)}
                                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium whitespace-nowrap ${
                                  lp.parentVisible
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                                    : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                }`}
                              >
                                {lp.parentVisible ? (
                                  <>
                                    <Eye className="h-3 w-3" />
                                    Visible
                                  </>
                                ) : (
                                  <>
                                    <EyeOff className="h-3 w-3" />
                                    Hidden
                                  </>
                                )}
                              </button>
                            ) : (
                              <span className="text-[11px] text-slate-500">
                                {lp.parentVisible ? 'Visible' : 'Hidden'}
                              </span>
                            )
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                              <Lock className="h-3 w-3" />
                              Needs Approval
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              onClick={() => {
                                setInspectLessonPlan(lp);
                                setReviewFeedbackInput(lp.reviewFeedback || '');
                                setReviewShareWithParents(true);
                              }}
                              className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                            >
                              {isAdmin && lp.status === 'Submitted' ? 'Review' : 'View'}
                            </button>
                            {editable && (
                              <>
                                <button
                                  onClick={() => openEditLessonPlanModal(lp)}
                                  className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                                >
                                  Edit
                                </button>
                                {(lp.status === 'Draft' || lp.status === 'Revision Requested') && (
                                  <button
                                    disabled={submittingAction}
                                    onClick={() => handleSubmitLessonPlan(lp.id)}
                                    className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-500"
                                  >
                                    <Send className="h-3 w-3" />
                                    Submit
                                  </button>
                                )}
                                {(isAdmin || lp.status !== 'Approved') && (
                                  <button
                                    disabled={submittingAction}
                                    onClick={() => handleDeleteLessonPlan(lp.id)}
                                    title="Delete lesson plan"
                                    className="rounded-md border border-slate-200 p-1 text-slate-500 hover:border-red-200 hover:text-red-600 dark:border-slate-700 dark:text-slate-400"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: SUBMISSION TRACKING */}
      {activeTab === 'tracking' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Faculty Submission Compliance Matrix
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Expected Schemes of Work vs Approved, Submitted, Revision, Missing & Active Week{' '}
                  {submissionConfig.currentWeekNumber} Lesson Plans
                </p>
              </div>
              <span className="font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
                Scheme Cutoff: {submissionConfig.schemeDueDate}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Teacher</th>
                    <th className="px-4 py-3">Expected Cohorts</th>
                    <th className="px-4 py-3">Approved</th>
                    <th className="px-4 py-3">Pending Review</th>
                    <th className="px-4 py-3">Revision / Draft</th>
                    <th className="px-4 py-3">Missing</th>
                    <th className="px-4 py-3">Late Submissions</th>
                    <th className="px-4 py-3">
                      Wk {submissionConfig.currentWeekNumber} Plans
                    </th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {trackingSummary.rows.map((row) => (
                    <tr
                      key={row.teacher.id}
                      className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40"
                    >
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900 dark:text-slate-100">
                          {row.teacher.name}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {row.teacher.department}
                        </p>
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums text-slate-800 dark:text-slate-200">
                        {row.expectedCount}
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold text-emerald-700 tabular-nums dark:text-emerald-400">
                        {row.approvedCount}
                      </td>
                      <td className="px-4 py-3 font-mono text-blue-700 tabular-nums dark:text-blue-400">
                        {row.submittedCount}
                      </td>
                      <td className="px-4 py-3 font-mono text-amber-700 tabular-nums dark:text-amber-400">
                        {row.revisionCount + row.draftCount}
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold tabular-nums">
                        <span
                          className={
                            row.missingCohorts.length > 0
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-slate-400'
                          }
                        >
                          {row.missingCohorts.length}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {row.lateCount}
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums text-slate-800 dark:text-slate-200">
                        {row.activeWeekPlansCount}{' '}
                        <span className="text-[11px] text-slate-400">
                          ({row.totalPlansCount} total)
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            onClick={() => {
                              setFilterTeacherId(row.teacher.id);
                              setActiveTab('schemes');
                            }}
                            className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                          >
                            View Docs
                          </button>
                          {isAdmin && !readOnly && row.missingCohorts.length > 0 && (
                            <button
                              disabled={submittingAction}
                              onClick={() => handleSendReminder([row.teacher.id], row.teacher.name)}
                              className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                            >
                              <Bell className="h-3 w-3" />
                              Remind
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {trackingSummary.missingGaps.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-800 dark:bg-slate-900">
              <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Missing Scheme Deliverables ({trackingSummary.missingGaps.length})
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Assigned class/subject combinations with no Scheme of Work started yet for{' '}
                  {tenant.currentTerm}
                </p>
              </div>
              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-2.5">Assigned Teacher</th>
                      <th className="px-4 py-2.5">Grade</th>
                      <th className="px-4 py-2.5">Stream</th>
                      <th className="px-4 py-2.5">Subject</th>
                      <th className="px-4 py-2.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {trackingSummary.missingGaps.slice(0, 60).map((gap, i) => (
                      <tr key={`${gap.teacher.id}-${gap.grade}-${gap.section}-${gap.subject}-${i}`}>
                        <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-200">
                          {gap.teacher.name}
                        </td>
                        <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300">
                          {gap.grade}
                        </td>
                        <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300">
                          Stream {gap.section}
                        </td>
                        <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300">
                          {gap.subject}
                        </td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          {canAuthor &&
                          (isAdmin || gap.teacher.id === ownTeacherProfile?.id) ? (
                            <button
                              onClick={() =>
                                openCreateSchemeModal({
                                  grade: gap.grade,
                                  section: gap.section,
                                  subject: gap.subject,
                                })
                              }
                              className="rounded-md bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-slate-800 dark:bg-blue-600"
                            >
                              Create Scheme
                            </button>
                          ) : (
                            <span className="text-[11px] text-slate-400">Awaiting teacher</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: PARENT PORTAL PREVIEW */}
      {activeTab === 'parent-preview' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Parent Portal Live Visibility Preview
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Only documents marked <strong className="font-semibold">Approved</strong> and{' '}
                <strong className="font-semibold">Parent Visible</strong> appear to guardians for the
                selected class cohort. Internal staff notes and private reflections are stripped.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={previewGrade}
                onChange={(e) => {
                  const nextG = e.target.value;
                  setPreviewGrade(nextG);
                  setPreviewStream(getStreamsForGrade(tenant, nextG)[0] || 'A');
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                {tenant.grades.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
              <select
                value={previewStream}
                onChange={(e) => setPreviewStream(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                {getStreamsForGrade(tenant, previewGrade).map((sec) => (
                  <option key={sec} value={sec}>
                    Stream {sec}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Published Schemes of Work ({previewCohortSchemes.length})
              </h3>
              {previewCohortSchemes.length === 0 ? (
                <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
                  No Approved + Parent-Visible schemes for {previewGrade} Stream {previewStream}.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
                  {previewCohortSchemes.map((s) => (
                    <li key={s.id} className="py-3">
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {s.title}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        {s.subject} · {s.teacherName} · {s.weeksCount} weeks
                      </p>
                      {s.parentSummary && (
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                          {s.parentSummary}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Published Weekly Lesson Highlights ({previewCohortLessonPlans.length})
              </h3>
              {previewCohortLessonPlans.length === 0 ? (
                <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
                  No Approved + Parent-Visible lesson plans for {previewGrade} Stream {previewStream}.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
                  {previewCohortLessonPlans.map((lp) => (
                    <li key={lp.id} className="py-3">
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        Week {lp.weekNumber}: {lp.lessonTitle}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        {lp.lessonDate} · {lp.subject} · {lp.teacherName}
                      </p>
                      {lp.extendedHomework && (
                        <p className="mt-1 text-xs text-blue-700 dark:text-blue-300">
                          Home Follow-Up: {lp.extendedHomework}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* DETAIL / ADMIN REVIEW / PRINT MODAL: SCHEME OF WORK */}
      {inspectScheme && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 no-print dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  {inspectScheme.title}
                </h2>
                <span
                  className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE_MAP[inspectScheme.status]}`}
                >
                  {inspectScheme.status}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print
                </button>
                <button
                  onClick={() => setInspectScheme(null)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <TenantDocumentHeader
                tenant={tenant}
                documentTitle="Scheme of Work"
                subtitle={`${inspectScheme.grade} (${inspectScheme.section}) · ${inspectScheme.subject}`}
                rightMeta={[
                  { label: 'Teacher', value: inspectScheme.teacherName },
                  { label: 'Term', value: `${inspectScheme.academicYear} ${inspectScheme.term}` },
                  { label: 'Status', value: inspectScheme.status },
                ]}
                compact
              />

              <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
                <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <span className="text-[11px] uppercase text-slate-500">Core Reference</span>
                  <p className="mt-1 font-medium text-slate-900 dark:text-slate-100">
                    {inspectScheme.referenceBook || 'KICD CBC Syllabus'}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <span className="text-[11px] uppercase text-slate-500">Submission</span>
                  <p className="mt-1 font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {inspectScheme.submittedAt
                      ? `Submitted ${inspectScheme.submittedAt.slice(0, 10)}`
                      : 'Not yet submitted'}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <span className="text-[11px] uppercase text-slate-500">Parent Portal</span>
                  <p className="mt-1 font-medium text-slate-900 dark:text-slate-100">
                    {inspectScheme.status === 'Approved' && inspectScheme.parentVisible
                      ? 'Published to Parents'
                      : 'Staff Only'}
                  </p>
                </div>
              </div>

              {inspectScheme.reviewFeedback && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-950">
                  <p className="font-semibold text-slate-800 dark:text-slate-200">
                    Academic Review Feedback ({inspectScheme.reviewedByName || 'Admin'})
                  </p>
                  <p className="mt-1 text-slate-600 dark:text-slate-400">
                    {inspectScheme.reviewFeedback}
                  </p>
                </div>
              )}

              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2.5">Wk</th>
                      <th className="px-3 py-2.5">Strand & Sub-Strand</th>
                      <th className="px-3 py-2.5">Learning Outcomes</th>
                      <th className="px-3 py-2.5">Activities & Resources</th>
                      <th className="px-3 py-2.5">Assessment</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {inspectScheme.weeks.map((wk) => (
                      <tr key={wk.weekNumber} className="align-top">
                        <td className="px-3 py-2.5 font-mono font-semibold tabular-nums">
                          {wk.weekNumber}
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">
                            {wk.strand}
                          </p>
                          <p className="text-slate-500">{wk.subStrand}</p>
                        </td>
                        <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300">
                          {wk.learningOutcomes}
                          {wk.keyInquiryQuestion && (
                            <p className="mt-1 text-[11px] text-slate-500">
                              Inquiry: {wk.keyInquiryQuestion}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300">
                          <p>{wk.learningActivities}</p>
                          <p className="mt-1 text-[11px] text-slate-500">{wk.resources}</p>
                        </td>
                        <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300">
                          {wk.assessmentMethod}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {isAdmin && !readOnly && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3 no-print dark:border-slate-800 dark:bg-slate-950">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                      Academic Admin Review & Approval
                    </h3>
                    <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={reviewShareWithParents}
                        onChange={(e) => setReviewShareWithParents(e.target.checked)}
                      />
                      Share on Parent Portal upon approval
                    </label>
                  </div>
                  <textarea
                    rows={2}
                    value={reviewFeedbackInput}
                    onChange={(e) => setReviewFeedbackInput(e.target.value)}
                    placeholder="Enter review notes (required when requesting revision)..."
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      disabled={submittingAction}
                      onClick={() => handleReviewScheme(inspectScheme.id, 'Revision Requested')}
                      className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                    >
                      Request Revision
                    </button>
                    <button
                      disabled={submittingAction}
                      onClick={() => handleReviewScheme(inspectScheme.id, 'Approved')}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Approve Scheme
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* DETAIL / ADMIN REVIEW / PRINT MODAL: LESSON PLAN */}
      {inspectLessonPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 no-print dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  {inspectLessonPlan.lessonTitle}
                </h2>
                <span
                  className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE_MAP[inspectLessonPlan.status]}`}
                >
                  {inspectLessonPlan.status}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print
                </button>
                <button
                  onClick={() => setInspectLessonPlan(null)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <TenantDocumentHeader
                tenant={tenant}
                documentTitle="CBC Lesson Plan"
                subtitle={`${inspectLessonPlan.grade} (${inspectLessonPlan.section}) · ${inspectLessonPlan.subject}`}
                rightMeta={[
                  { label: 'Teacher', value: inspectLessonPlan.teacherName },
                  { label: 'Week / Date', value: `Wk ${inspectLessonPlan.weekNumber} · ${inspectLessonPlan.lessonDate}` },
                  { label: 'Duration', value: `${inspectLessonPlan.durationMinutes} min` },
                ]}
                compact
              />

              <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <span className="text-[11px] uppercase text-slate-500">Strand & Sub-Strand</span>
                  <p className="mt-1 font-semibold text-slate-900 dark:text-slate-100">
                    {inspectLessonPlan.strand} — {inspectLessonPlan.subStrand}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <span className="text-[11px] uppercase text-slate-500">Learning Resources</span>
                  <p className="mt-1 text-slate-700 dark:text-slate-300">
                    {inspectLessonPlan.learningResources}
                  </p>
                </div>
              </div>

              <div className="space-y-2.5 text-xs">
                <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <p className="font-semibold text-slate-900 dark:text-slate-100">
                    Specific Learning Outcomes
                  </p>
                  <p className="mt-1 text-slate-700 dark:text-slate-300">
                    {inspectLessonPlan.learningOutcomes}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <p className="font-semibold text-slate-900 dark:text-slate-100">
                    1. Lesson Introduction
                  </p>
                  <p className="mt-1 text-slate-700 dark:text-slate-300">
                    {inspectLessonPlan.introductionActivity}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <p className="font-semibold text-slate-900 dark:text-slate-100">
                    2. Lesson Development
                  </p>
                  <p className="mt-1 text-slate-700 dark:text-slate-300">
                    {inspectLessonPlan.lessonDevelopment}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <p className="font-semibold text-slate-900 dark:text-slate-100">
                    3. Conclusion & Assessment
                  </p>
                  <p className="mt-1 text-slate-700 dark:text-slate-300">
                    {inspectLessonPlan.conclusionActivity}
                  </p>
                </div>
                {inspectLessonPlan.extendedHomework && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-3 dark:border-blue-900/60 dark:bg-blue-950/30">
                    <p className="font-semibold text-blue-950 dark:text-blue-200">
                      Extended Homework / Parent Follow-Up
                    </p>
                    <p className="mt-1 text-blue-900 dark:text-blue-300">
                      {inspectLessonPlan.extendedHomework}
                    </p>
                  </div>
                )}
                {inspectLessonPlan.teacherReflection && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                    <p className="font-semibold text-slate-800 dark:text-slate-200">
                      Private Teacher Reflection (Internal Staff Only)
                    </p>
                    <p className="mt-1 text-slate-600 dark:text-slate-400">
                      {inspectLessonPlan.teacherReflection}
                    </p>
                  </div>
                )}
              </div>

              {isAdmin && !readOnly && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3 no-print dark:border-slate-800 dark:bg-slate-950">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                      Academic Admin Review & Approval
                    </h3>
                    <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={reviewShareWithParents}
                        onChange={(e) => setReviewShareWithParents(e.target.checked)}
                      />
                      Share on Parent Portal upon approval
                    </label>
                  </div>
                  <textarea
                    rows={2}
                    value={reviewFeedbackInput}
                    onChange={(e) => setReviewFeedbackInput(e.target.value)}
                    placeholder="Enter review feedback (required when requesting revision)..."
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      disabled={submittingAction}
                      onClick={() =>
                        handleReviewLessonPlan(inspectLessonPlan.id, 'Revision Requested')
                      }
                      className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                    >
                      Request Revision
                    </button>
                    <button
                      disabled={submittingAction}
                      onClick={() => handleReviewLessonPlan(inspectLessonPlan.id, 'Approved')}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Approve Lesson Plan
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CREATE / EDIT SCHEME OF WORK MODAL */}
      {schemeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 no-print">
          <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {editingSchemeId ? 'Edit Scheme of Work' : 'Create Scheme of Work'}
              </h2>
              <button
                onClick={() => setSchemeModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300">
                    Grade
                  </label>
                  <select
                    value={schemeGrade}
                    onChange={(e) => {
                      const nextG = e.target.value;
                      const streams = getStreamsForGrade(tenant, nextG);
                      const nextSec = streams.includes(schemeSection)
                        ? schemeSection
                        : streams[0] || 'A';
                      const allowedSubs = getAllowedSubjectsForEditor(nextG, nextSec);
                      const nextSub = allowedSubs.includes(schemeSubject)
                        ? schemeSubject
                        : allowedSubs[0] || 'Mathematics';
                      setSchemeGrade(nextG);
                      setSchemeSection(nextSec);
                      setSchemeSubject(nextSub);
                      setSchemeTitle(`${nextG} ${nextSec} ${nextSub} — ${tenant.currentTerm} Scheme of Work`);
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    {availableGradesForEditor.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300">
                    Stream
                  </label>
                  <select
                    value={schemeSection}
                    onChange={(e) => {
                      const nextSec = e.target.value;
                      const allowedSubs = getAllowedSubjectsForEditor(schemeGrade, nextSec);
                      const nextSub = allowedSubs.includes(schemeSubject)
                        ? schemeSubject
                        : allowedSubs[0] || schemeSubject;
                      setSchemeSection(nextSec);
                      setSchemeSubject(nextSub);
                      setSchemeTitle(`${schemeGrade} ${nextSec} ${nextSub} — ${tenant.currentTerm} Scheme of Work`);
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    {getStreamsForGrade(tenant, schemeGrade).map((sec) => (
                      <option key={sec} value={sec}>
                        {sec}
                      </option>
                    ))}
                    <option value="All Streams">All Streams</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300">
                    Subject
                  </label>
                  <select
                    value={schemeSubject}
                    onChange={(e) => {
                      const nextSub = e.target.value;
                      setSchemeSubject(nextSub);
                      setSchemeTitle(`${schemeGrade} ${schemeSection} ${nextSub} — ${tenant.currentTerm} Scheme of Work`);
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    {getAllowedSubjectsForEditor(schemeGrade, schemeSection).map((sub) => (
                      <option key={sub} value={sub}>
                        {sub}
                      </option>
                    ))}
                  </select>
                </div>

                {isAdmin && (
                  <div>
                    <label className="block font-semibold text-slate-600 dark:text-slate-300">
                      Assigned Teacher
                    </label>
                    <select
                      value={schemeTeacherId}
                      onChange={(e) => setSchemeTeacherId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    >
                      {tenant.teachers.map((tc) => (
                        <option key={tc.id} value={tc.id}>
                          {tc.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300">
                    Scheme Title
                  </label>
                  <input
                    type="text"
                    value={schemeTitle}
                    onChange={(e) => setSchemeTitle(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300">
                    Core Reference Text (KICD)
                  </label>
                  <input
                    type="text"
                    value={schemeRefBook}
                    onChange={(e) => setSchemeRefBook(e.target.value)}
                    placeholder="e.g. KLB Top Scholar Grade 7"
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-600 dark:text-slate-300">
                  Parent Portal Overview Summary (optional)
                </label>
                <input
                  type="text"
                  value={schemeParentSummary}
                  onChange={(e) => setSchemeParentSummary(e.target.value)}
                  placeholder="Brief parent-friendly summary of key term themes..."
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
                <h3 className="font-bold text-slate-900 dark:text-slate-100">
                  Weekly Term Breakdown ({schemeWeeks.length} weeks)
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setSchemeWeeks(generateClientSchemeWeeks(schemeSubject, schemeWeeks.length || 8))
                    }
                    className="rounded-lg border border-slate-200 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
                  >
                    Auto-Fill CBC Template
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSchemeWeeks((prev) => [
                        ...prev,
                        {
                          weekNumber: prev.length + 1,
                          strand: '',
                          subStrand: '',
                          learningOutcomes: '',
                          keyInquiryQuestion: '',
                          learningActivities: '',
                          resources: '',
                          assessmentMethod: '',
                        },
                      ])
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Week
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {schemeWeeks.map((wk, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-slate-200 p-3 space-y-2 dark:border-slate-800"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-slate-800 tabular-nums dark:text-slate-200">
                        Week {wk.weekNumber}
                      </span>
                      {schemeWeeks.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setSchemeWeeks((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="text-slate-400 hover:text-red-600"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <input
                        type="text"
                        value={wk.strand}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSchemeWeeks((prev) =>
                            prev.map((item, i) => (i === idx ? { ...item, strand: val } : item))
                          );
                        }}
                        placeholder="Strand *"
                        className="rounded-md border border-slate-200 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                      <input
                        type="text"
                        value={wk.subStrand}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSchemeWeeks((prev) =>
                            prev.map((item, i) => (i === idx ? { ...item, subStrand: val } : item))
                          );
                        }}
                        placeholder="Sub-Strand *"
                        className="rounded-md border border-slate-200 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </div>
                    <input
                      type="text"
                      value={wk.learningOutcomes}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSchemeWeeks((prev) =>
                          prev.map((item, i) =>
                            i === idx ? { ...item, learningOutcomes: val } : item
                          )
                        );
                      }}
                      placeholder="Specific Learning Outcomes *"
                      className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <input
                        type="text"
                        value={wk.learningActivities}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSchemeWeeks((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, learningActivities: val } : item
                            )
                          );
                        }}
                        placeholder="Learning activities"
                        className="rounded-md border border-slate-200 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                      <input
                        type="text"
                        value={wk.resources}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSchemeWeeks((prev) =>
                            prev.map((item, i) => (i === idx ? { ...item, resources: val } : item))
                          );
                        }}
                        placeholder="Learning resources"
                        className="rounded-md border border-slate-200 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                      <input
                        type="text"
                        value={wk.assessmentMethod}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSchemeWeeks((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, assessmentMethod: val } : item
                            )
                          );
                        }}
                        placeholder="Assessment method"
                        className="rounded-md border border-slate-200 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-6 py-3.5 dark:border-slate-800">
              <button
                onClick={() => setSchemeModalOpen(false)}
                className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
              >
                Cancel
              </button>
              <button
                disabled={submittingAction}
                onClick={() => handleSaveScheme(false)}
                className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                Save as Draft
              </button>
              <button
                disabled={submittingAction}
                onClick={() => handleSaveScheme(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500"
              >
                <Send className="h-3.5 w-3.5" />
                Save & Submit for Review
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE / EDIT LESSON PLAN MODAL */}
      {lpModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 no-print">
          <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {editingLpId ? 'Edit Lesson Plan' : 'Create CBC Lesson Plan'}
              </h2>
              <button
                onClick={() => setLpModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-600 dark:text-slate-300">
                  Link to Scheme of Work (auto-populates strand & outcomes)
                </label>
                <select
                  value={lpSchemeId}
                  onChange={(e) => handleApplyLinkedSchemeToLp(e.target.value, lpWeekNumber)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="">Standalone Lesson Plan (no linked scheme)</option>
                  {schemes
                    .filter((s) => isAdmin || isOwnDoc(s))
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title} ({s.status})
                      </option>
                    ))}
                </select>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300">
                    Grade
                  </label>
                  <select
                    value={lpGrade}
                    onChange={(e) => {
                      const nextG = e.target.value;
                      const streams = getStreamsForGrade(tenant, nextG);
                      const nextSec = streams.includes(lpSection) ? lpSection : streams[0] || 'A';
                      const subs = getAllowedSubjectsForEditor(nextG, nextSec);
                      setLpGrade(nextG);
                      setLpSection(nextSec);
                      if (!subs.includes(lpSubject)) setLpSubject(subs[0] || lpSubject);
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    {availableGradesForEditor.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300">
                    Stream
                  </label>
                  <select
                    value={lpSection}
                    onChange={(e) => setLpSection(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    {getStreamsForGrade(tenant, lpGrade).map((sec) => (
                      <option key={sec} value={sec}>
                        {sec}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300">
                    Subject
                  </label>
                  <select
                    value={lpSubject}
                    onChange={(e) => setLpSubject(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    {getAllowedSubjectsForEditor(lpGrade, lpSection).map((sub) => (
                      <option key={sub} value={sub}>
                        {sub}
                      </option>
                    ))}
                  </select>
                </div>
                {isAdmin && (
                  <div>
                    <label className="block font-semibold text-slate-600 dark:text-slate-300">
                      Teacher
                    </label>
                    <select
                      value={lpTeacherId}
                      onChange={(e) => setLpTeacherId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    >
                      {tenant.teachers.map((tc) => (
                        <option key={tc.id} value={tc.id}>
                          {tc.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300">
                    Week #
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={14}
                    value={lpWeekNumber}
                    onChange={(e) => setLpWeekNumber(Number(e.target.value) || 1)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300">
                    Lesson Date
                  </label>
                  <input
                    type="date"
                    value={lpLessonDate}
                    onChange={(e) => setLpLessonDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300">
                    Period #
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={lpPeriodNumber}
                    onChange={(e) => setLpPeriodNumber(Number(e.target.value) || 1)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300">
                    Duration (min)
                  </label>
                  <input
                    type="number"
                    min={15}
                    max={180}
                    value={lpDuration}
                    onChange={(e) => setLpDuration(Number(e.target.value) || 40)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300">
                    Strand *
                  </label>
                  <input
                    type="text"
                    value={lpStrand}
                    onChange={(e) => setLpStrand(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300">
                    Sub-Strand *
                  </label>
                  <input
                    type="text"
                    value={lpSubStrand}
                    onChange={(e) => setLpSubStrand(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-600 dark:text-slate-300">
                  Lesson Title *
                </label>
                <input
                  type="text"
                  value={lpTitle}
                  onChange={(e) => setLpTitle(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-600 dark:text-slate-300">
                  Specific Learning Outcomes *
                </label>
                <textarea
                  rows={2}
                  value={lpOutcomes}
                  onChange={(e) => setLpOutcomes(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-600 dark:text-slate-300">
                  Learning Resources
                </label>
                <input
                  type="text"
                  value={lpResources}
                  onChange={(e) => setLpResources(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300">
                    Introduction *
                  </label>
                  <textarea
                    rows={3}
                    value={lpIntro}
                    onChange={(e) => setLpIntro(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300">
                    Lesson Development *
                  </label>
                  <textarea
                    rows={3}
                    value={lpDev}
                    onChange={(e) => setLpDev(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300">
                    Conclusion *
                  </label>
                  <textarea
                    rows={3}
                    value={lpConclusion}
                    onChange={(e) => setLpConclusion(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300">
                    Extended Homework / Parent Follow-Up (shared when visible)
                  </label>
                  <input
                    type="text"
                    value={lpHomework}
                    onChange={(e) => setLpHomework(e.target.value)}
                    placeholder="Optional home task for learners..."
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300">
                    Private Teacher Reflection (staff-only)
                  </label>
                  <input
                    type="text"
                    value={lpReflection}
                    onChange={(e) => setLpReflection(e.target.value)}
                    placeholder="Never shown to parents..."
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-6 py-3.5 dark:border-slate-800">
              <button
                onClick={() => setLpModalOpen(false)}
                className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
              >
                Cancel
              </button>
              <button
                disabled={submittingAction}
                onClick={() => handleSaveLessonPlan(false)}
                className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                Save as Draft
              </button>
              <button
                disabled={submittingAction}
                onClick={() => handleSaveLessonPlan(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500"
              >
                <Send className="h-3.5 w-3.5" />
                Save & Submit for Review
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DEADLINES & PARENT VISIBILITY GOVERNANCE MODAL (ADMIN) */}
      {configModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 no-print">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Submission Deadlines & Visibility Policy
              </h2>
              <button
                onClick={() => setConfigModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-600 dark:text-slate-300">
                  Term Schemes of Work Cutoff Date
                </label>
                <input
                  type="date"
                  value={cfgDueDate}
                  onChange={(e) => setCfgDueDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300">
                    Active Term Week
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={14}
                    value={cfgWeekNumber}
                    onChange={(e) => setCfgWeekNumber(Number(e.target.value) || 1)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300">
                    Lesson Plan Lead Days
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={14}
                    value={cfgLeadDays}
                    onChange={(e) => setCfgLeadDays(Number(e.target.value) || 0)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-600 dark:text-slate-300">
                  Lesson Plan Submission Cadence
                </label>
                <select
                  value={cfgCadence}
                  onChange={(e) =>
                    setCfgCadence(e.target.value === 'Daily' ? 'Daily' : 'Weekly')
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="Weekly">Weekly (Submit ahead of week)</option>
                  <option value="Daily">Daily (Submit ahead of lesson date)</option>
                </select>
              </div>

              <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <input
                  type="checkbox"
                  checked={cfgRequireApproval}
                  onChange={(e) => setCfgRequireApproval(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <strong className="block font-semibold text-slate-900 dark:text-slate-100">
                    Require Admin Approval for Parent Portal Visibility
                  </strong>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Recommended: only Approved documents marked Parent Visible can be seen by
                    parents and learners.
                  </span>
                </span>
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfigModalOpen(false)}
                className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                Cancel
              </button>
              <button
                disabled={submittingAction}
                onClick={handleSaveSubmissionConfig}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-blue-600"
              >
                Save Policy
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
