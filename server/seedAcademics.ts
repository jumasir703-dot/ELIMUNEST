import {
  CLASS_TEACHER_SUBJECT_TOKEN,
  computeAssessmentGrade,
  getStreamsForGrade,
  getStudentRegisteredSubjects,
  getSubjectsForGrade,
  type AcademicSubmissionDeadlineConfig,
  type CbcLearnerMasteryLevel,
  type LearnerProgressiveEntry,
  type LessonNote,
  type LessonPlan,
  type ProgressiveReportSubjectScore,
  type RecordOfWork,
  type RecordOfWorkCoverageStatus,
  type SchemeOfWork,
  type SchemeOfWorkWeek,
  type Student,
  type TeacherLessonAttendanceRecord,
  type TeacherProfile,
  type Tenant,
  type TimetableSlot,
} from '../src/shared/types.ts';

interface SubjectStrandTemplate {
  referenceBook: string;
  strands: Array<{
    strand: string;
    subStrand: string;
    outcomes: string;
    inquiry: string;
    activities: string;
    resources: string;
    assessment: string;
    homework: string;
  }>;
}

const SUBJECT_STRAND_BANK: Array<{ match: RegExp; template: SubjectStrandTemplate }> = [
  {
    match: /math/i,
    template: {
      referenceBook: 'KLB Top Scholar Mathematics (KICD Approved)',
      strands: [
        {
          strand: 'Numbers & Operations',
          subStrand: 'Fractions, Ratios & Percentages',
          outcomes: 'Convert between fractions, decimals and percentages and solve real-life consumer word problems.',
          inquiry: 'How do percentages help compare discounts and exam results?',
          activities: 'Group fraction-strip matching, supermarket discount calculations, guided board practice.',
          resources: 'KICD Learner Book, place-value charts, fraction cards, digital calculator.',
          assessment: 'Written exercise & observation checklist',
          homework: 'Complete Exercise 3.2 Nos. 1–6 on household budget percentages with parent check.',
        },
        {
          strand: 'Algebra',
          subStrand: 'Linear Equations & Expressions',
          outcomes: 'Formulate and solve single-variable linear equations from word scenarios.',
          inquiry: 'How can an unknown quantity be represented symbolically?',
          activities: 'Balance-scale model activity, peer equation formulation, quick oral drill.',
          resources: 'Algebra tiles, chalkboard diagrams, learner workbooks.',
          assessment: 'Exit ticket & rubric',
          homework: 'Formulate 3 real-life linear equations from shopping receipts.',
        },
        {
          strand: 'Measurements',
          subStrand: 'Perimeter, Area & Volume',
          outcomes: 'Calculate perimeter and area of composite polygons and volume of cuboids.',
          inquiry: 'Why do builders measure perimeter before fencing a compound?',
          activities: 'Measuring classroom floor tiles with tape measures, scale drawing.',
          resources: 'Metre rule, tape measure, grid paper, 3D solid models.',
          assessment: 'Practical measurement task',
          homework: 'Measure and compute the area of your study table at home.',
        },
        {
          strand: 'Data Handling',
          subStrand: 'Bar Graphs & Mean Interpretation',
          outcomes: 'Collect, tabulate and interpret frequency tables and bar graphs.',
          inquiry: 'What makes a visual chart easier to interpret than a raw list of numbers?',
          activities: 'Class shoe-size survey, plotting scaled bar charts on graph paper.',
          resources: 'Graph books, coloured pencils, sample weather charts.',
          assessment: 'Chart accuracy portfolio',
          homework: 'Record daily water/step counts for 3 days and draw a simple bar graph.',
        },
      ],
    },
  },
  {
    match: /english|language/i,
    template: {
      referenceBook: 'Oxford Head Start English CBC Edition',
      strands: [
        {
          strand: 'Listening & Speaking',
          subStrand: 'Etiquette, Debates & Oral Comprehension',
          outcomes: 'Respond courteously in dialogue and deliver a 2-minute structured viewpoint.',
          inquiry: 'How does active listening strengthen respectful classroom debate?',
          activities: 'Think-pair-share dialogue, moderated mini-debate, pronunciation drills.',
          resources: 'Audio dialogue clips, cue cards, KICD English Reader.',
          assessment: 'Oral fluency rubric',
          homework: 'Read aloud pages 24–26 to a guardian and summarise the main idea.',
        },
        {
          strand: 'Reading',
          subStrand: 'Comprehension & Vocabulary Inference',
          outcomes: 'Identify main ideas, infer unfamiliar vocabulary in context, and answer comprehension items.',
          inquiry: 'What clues in a paragraph reveal a word’s meaning without a dictionary?',
          activities: 'Silent timed reading, context-clue highlighting, guided questioning.',
          resources: 'Class reader, dictionary, comprehension passage handouts.',
          assessment: 'Written comprehension check',
          homework: 'List 5 new words from your library book and use each in a sentence.',
        },
        {
          strand: 'Grammar in Use',
          subStrand: 'Tenses, Prepositions & Conjunctions',
          outcomes: 'Construct grammatically accurate compound sentences using appropriate tenses and connectors.',
          inquiry: 'How do conjunctions clarify cause and sequence in writing?',
          activities: 'Sentence-strip joining game, peer editing of short paragraphs.',
          resources: 'Grammar reference charts, sentence cards.',
          assessment: 'Gap-fill quiz & peer review',
          homework: 'Rewrite 6 simple sentences into 3 compound sentences.',
        },
        {
          strand: 'Writing',
          subStrand: 'Narrative & Functional Composition',
          outcomes: 'Plan, draft, and proofread a coherent friendly letter or short narrative.',
          inquiry: 'Why is outlining before writing essential for clear storytelling?',
          activities: 'Mind-map brainstorming, drafted paragraph workshop, teacher conferencing.',
          resources: 'Writing rubric, sample model letters, exercise books.',
          assessment: 'Composition grading rubric',
          homework: 'Write a 120-word letter telling a relative about a school project.',
        },
      ],
    },
  },
  {
    match: /kiswahili/i,
    template: {
      referenceBook: 'Longhorn Kiswahili Dadisi (KICD)',
      strands: [
        {
          strand: 'Kusikiliza na Kuzungumza',
          subStrand: 'Maamkizi, Adabu na Mazungumzo',
          outcomes: 'Kutumia maamkizi na lugha ya heshima katika miktadha mbalimbali.',
          inquiry: 'Kwa nini ni muhimu kutumia lugha ya adabu tunapozungumza na wakubwa?',
          activities: 'Igizo la mazungumzo ya sokoni na shuleni, maswali ya papo kwa hapo.',
          resources: 'Kitabu cha Mwanafunzi, kadi za maneno, chati ya maamkizi.',
          assessment: 'Orodha hakiki ya mazungumzo',
          homework: 'Fanya mazungumzo mafupi ya Kiswahili sanifu nyumbani kuhusu usafi.',
        },
        {
          strand: 'Kusoma',
          subStrand: 'Ufahamu na Msamiati',
          outcomes: 'Kusoma kifungu kwa ufasaha na kujibu maswali ya ufahamu kwa usahihi.',
          inquiry: 'Tunawezaje kutambua ujumbe mkuu katika hadithi fupi?',
          activities: 'Usomaji wa sauti kwa zamu, kutambua msamiati mpya.',
          resources: 'Hadithi teule, kamusi ya Kiswahili.',
          assessment: 'Maswali ya ufahamu',
          homework: 'Soma ukurasa wa 18–19 na uandike maana ya maneno manne mapya.',
        },
        {
          strand: 'Sarufi',
          subStrand: 'Ngeli za Nomino na Nyakati',
          outcomes: 'Kutunga sentensi sahihi kwa kuzingatia upatanisho wa kisarufi na nyakati.',
          inquiry: 'Upatanisho wa ngeli hubadilisha vipi maana ya sentensi?',
          activities: 'Kuchanganua sentensi ubaoni, mchezo wa kuunganisha kadi.',
          resources: 'Chati ya ngeli, mbao na chaki.',
          assessment: 'Zoezi la sarufi',
          homework: 'Tunga sentensi tano ukitumia ngeli ya KI-VI.',
        },
        {
          strand: 'Kuandika',
          subStrand: 'Insha ya Masimulizi na Barua',
          outcomes: 'Kuandika insha yenye mpangilio mzuri wa aya na tahajia sahihi.',
          inquiry: 'Mpangilio wa aya unasaidia vipi msomaji kuelewa insha?',
          activities: 'Kuandaa vidokezo, kuandika rasimu na kuhakiki kazi ya mwenzako.',
          resources: 'Kielelezo cha insha, daftari la uandishi.',
          assessment: 'Rubriki ya uandishi',
          homework: 'Andika aya mbili kuhusu siku ya michezo shuleni.',
        },
      ],
    },
  },
  {
    match: /science|biology|chemistry|physics|environment/i,
    template: {
      referenceBook: 'Spotlight Integrated Science & Lab Manual (KICD)',
      strands: [
        {
          strand: 'Scientific Investigation',
          subStrand: 'Laboratory Safety & Apparatus Handling',
          outcomes: 'Identify common laboratory apparatus, observe safety symbols, and record accurate observations.',
          inquiry: 'How do safety protocols protect learners during science practicals?',
          activities: 'Lab station tour, sketching apparatus, hazard-symbol matching.',
          resources: 'Beakers, measuring cylinders, safety goggles, hazard chart.',
          assessment: 'Practical observation checklist',
          homework: 'Identify 3 household safety labels at home and note their precautions.',
        },
        {
          strand: 'Living Things & Environment',
          subStrand: 'Plant Nutrition & Ecosystem Balance',
          outcomes: 'Explain requirements for photosynthesis and classify producers and consumers in local habitats.',
          inquiry: 'Why are green plants essential to every food web?',
          activities: 'Leaf observation walk, food-chain poster construction.',
          resources: 'Hand lenses, specimen leaves, chart paper.',
          assessment: 'Project poster & oral defence',
          homework: 'Sketch a 4-step food chain observed in your neighbourhood.',
        },
        {
          strand: 'Matter & Mixtures',
          subStrand: 'Separation of Mixtures',
          outcomes: 'Demonstrate filtration, decantation, and evaporation to separate everyday mixtures.',
          inquiry: 'Which physical property determines the best method to separate a mixture?',
          activities: 'Guided sand-salt-water separation experiment in small groups.',
          resources: 'Filter paper, funnel, evaporating dish, table salt, clean sand.',
          assessment: 'Lab worksheet & rubric',
          homework: 'Write a 4-step summary of how clean drinking water is filtered.',
        },
        {
          strand: 'Energy & Forces',
          subStrand: 'Simple Circuits & Renewable Energy',
          outcomes: 'Assemble a simple series circuit and explain solar energy applications.',
          inquiry: 'Why does a break anywhere in a series circuit stop the bulb from lighting?',
          activities: 'Dry-cell, switch, and bulb assembly; renewable energy discussion.',
          resources: 'Dry cells, connecting wires, switches, miniature bulbs.',
          assessment: 'Practical circuit check',
          homework: 'List 4 appliances at home and state whether they use mains or battery power.',
        },
      ],
    },
  },
];

const DEFAULT_TEMPLATE: SubjectStrandTemplate = {
  referenceBook: 'KICD Competency-Based Curriculum Resource Pack',
  strands: [
    {
      strand: 'Foundational Concepts',
      subStrand: 'Core Knowledge & Real-World Context',
      outcomes: 'Demonstrate foundational understanding and apply key terminology in guided tasks.',
      inquiry: 'How does this topic connect to everyday community life?',
      activities: 'Guided inquiry discussion, collaborative group task, showcase.',
      resources: 'KICD Learner Book, visual charts, project materials.',
      assessment: 'Observation checklist & class exercise',
      homework: 'Discuss today’s core concept with a guardian and bring one real-life example.',
    },
    {
      strand: 'Applied Practice',
      subStrand: 'Collaborative Problem Solving',
      outcomes: 'Work collaboratively to design a practical solution and present findings clearly.',
      inquiry: 'What steps ensure accuracy and teamwork during practical tasks?',
      activities: 'Hands-on workstation activity, peer feedback circle.',
      resources: 'Activity worksheets, manipulatives, presentation board.',
      assessment: 'Performance rubric',
      homework: 'Complete reflection prompt #2 in your exercise book.',
    },
    {
      strand: 'Critical Inquiry',
      subStrand: 'Case Study & Reflection',
      outcomes: 'Analyse a local case study and propose sustainable improvements.',
      inquiry: 'How can evidence help us make better decisions?',
      activities: 'Case study reading, structured group summary.',
      resources: 'Printed case-study cards, reference atlas/texts.',
      assessment: 'Written summary check',
      homework: 'Prepare 3 questions for next week’s class discussion.',
    },
    {
      strand: 'Community & Assessment',
      subStrand: 'Project Portfolio Review',
      outcomes: 'Synthesise term competencies into a neat learner portfolio entry.',
      inquiry: 'What new skill have you mastered this term?',
      activities: 'Portfolio assembly, formative quiz, self-assessment.',
      resources: 'Learner portfolio folders, assessment rubrics.',
      assessment: 'Formative portfolio rubric',
      homework: 'Share your portfolio progress with your parent/guardian.',
    },
  ],
};

function resolveTemplate(subject: string): SubjectStrandTemplate {
  const hit = SUBJECT_STRAND_BANK.find((b) => b.match.test(subject));
  return hit ? hit.template : DEFAULT_TEMPLATE;
}

export function buildWeeksFromSubjectTemplate(subject: string, weeksCount = 8): SchemeOfWorkWeek[] {
  const tpl = resolveTemplate(subject);
  const count = Math.max(1, Math.min(14, Math.round(weeksCount)));
  const weeks: SchemeOfWorkWeek[] = [];
  for (let w = 1; w <= count; w += 1) {
    const item = tpl.strands[(w - 1) % tpl.strands.length];
    weeks.push({
      weekNumber: w,
      strand: item.strand,
      subStrand: w > tpl.strands.length ? `${item.subStrand} (Consolidation)` : item.subStrand,
      learningOutcomes: item.outcomes,
      keyInquiryQuestion: item.inquiry,
      learningActivities: item.activities,
      resources: item.resources,
      assessmentMethod: item.assessment,
      remarks: w <= 6 ? 'Taught as scheduled' : '',
    });
  }
  return weeks;
}

export function getDefaultAcademicSubmissionConfig(
  tenant?: Pick<Tenant, 'academicSubmissionConfig'> | null
): Required<AcademicSubmissionDeadlineConfig> {
  const cfg = tenant?.academicSubmissionConfig;
  return {
    schemeDueDate: cfg?.schemeDueDate || '2026-09-07',
    lessonPlanLeadDays:
      typeof cfg?.lessonPlanLeadDays === 'number' && Number.isFinite(cfg.lessonPlanLeadDays)
        ? cfg.lessonPlanLeadDays
        : 1,
    lessonPlanCadence: cfg?.lessonPlanCadence === 'Daily' ? 'Daily' : 'Weekly',
    currentWeekNumber:
      typeof cfg?.currentWeekNumber === 'number' && cfg.currentWeekNumber >= 1
        ? cfg.currentWeekNumber
        : 8,
    requireApprovalForParentVisibility: cfg?.requireApprovalForParentVisibility !== false,
  };
}

function resolveTeacherPairsForSeed(
  tenant: Tenant,
  teacher: TeacherProfile,
  timetable: TimetableSlot[] = []
): Array<{ grade: string; section: string; subject: string }> {
  const out: Array<{ grade: string; section: string; subject: string }> = [];
  const seen = new Set<string>();
  const classes = teacher.assignedClasses || [];

  for (const c of classes) {
    const sections =
      c.section.toLowerCase() === 'all streams'
        ? getStreamsForGrade(tenant, c.grade)
        : [c.section];
    const gradeSubs = getSubjectsForGrade(tenant, c.grade);
    let subs: string[] = [];
    if (!c.subject || c.subject === CLASS_TEACHER_SUBJECT_TOKEN) {
      subs = teacher.subjects.includes(CLASS_TEACHER_SUBJECT_TOKEN)
        ? gradeSubs.slice(0, 2)
        : teacher.subjects.filter((s) => gradeSubs.includes(s)).slice(0, 2);
      if (subs.length === 0) subs = gradeSubs.slice(0, 2);
    } else {
      subs = [c.subject];
    }
    for (const sec of sections.slice(0, 2)) {
      for (const sub of subs) {
        const key = `${c.grade}::${sec}::${sub}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ grade: c.grade, section: sec, subject: sub });
        }
      }
    }
  }

  if (out.length === 0 && timetable.length > 0) {
    for (const slot of timetable) {
      if (slot.tenantId !== tenant.id || slot.teacherId !== teacher.id) continue;
      const key = `${slot.grade}::${slot.section}::${slot.subject}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ grade: slot.grade, section: slot.section, subject: slot.subject });
      }
    }
  }

  if (out.length === 0) {
    const grade = tenant.grades[0] || 'Grade 7';
    const sec = getStreamsForGrade(tenant, grade)[0] || 'A';
    const gradeSubs = getSubjectsForGrade(tenant, grade);
    const sub =
      teacher.subjects.find((s) => s !== CLASS_TEACHER_SUBJECT_TOKEN && gradeSubs.includes(s)) ||
      gradeSubs[0] ||
      'Mathematics';
    out.push({ grade, section: sec, subject: sub });
  }

  return out;
}

export function buildDefaultAcademicsForTenant(
  tenant: Tenant,
  options?: { maxTeachers?: number; timetable?: TimetableSlot[] }
): {
  schemesOfWork: SchemeOfWork[];
  lessonPlans: LessonPlan[];
  recordsOfWork: RecordOfWork[];
  lessonNotes: LessonNote[];
  config: AcademicSubmissionDeadlineConfig;
} {
  const config = getDefaultAcademicSubmissionConfig(tenant);
  const term = tenant.currentTerm || 'Term 1';
  const academicYear = tenant.academicYear || '2026–2027';
  const reviewerName = tenant.teachers?.[0]?.name || 'School Principal';
  const schemesOfWork: SchemeOfWork[] = [];
  const lessonPlans: LessonPlan[] = [];
  const recordsOfWork: RecordOfWork[] = [];
  const lessonNotes: LessonNote[] = [];

  const teacherLimit = options?.maxTeachers ?? (tenant.teachers.length > 20 ? 18 : tenant.teachers.length);
  // Always ensure named portal teachers (like Tabitha, John, Juma, Kamau, Priya) are included first
  const priorityEmails = new Set([
    'juma.j@straphael.ac.ke',
    'tabitha.wanjala@straphael.ac.ke',
    'john.kiprotich@straphael.ac.ke',
    'kamau.njoroge@oakridge.ac.ke',
    'priya.nair@stjude.ac.ke',
  ]);
  const orderedTeachers = [
    ...tenant.teachers.filter((t) => priorityEmails.has((t.email || '').toLowerCase())),
    ...tenant.teachers.filter((t) => !priorityEmails.has((t.email || '').toLowerCase())),
  ].slice(0, teacherLimit);

  orderedTeachers.forEach((teacher, tIdx) => {
    const pairs = resolveTeacherPairsForSeed(tenant, teacher, options?.timetable || []);
    // Keep 1-3 schemes per teacher so submission tracking shows rich Approved, Submitted, Revision, Draft AND some Missing gaps
    const limitForTeacher =
      priorityEmails.has((teacher.email || '').toLowerCase())
        ? Math.min(3, pairs.length)
        : tIdx % 5 === 4
        ? 0 // Deliberately leave a few teachers with missing schemes for Submission Tracking
        : Math.min(2, pairs.length);

    for (let pIdx = 0; pIdx < limitForTeacher; pIdx += 1) {
      const { grade, section, subject } = pairs[pIdx];
      const tpl = resolveTemplate(subject);
      const weeks = buildWeeksFromSubjectTemplate(subject, 8);
      const mod = (tIdx + pIdx) % 6;
      const isPriority = priorityEmails.has((teacher.email || '').toLowerCase());
      const status: SchemeOfWork['status'] = isPriority
        ? pIdx === 0
          ? 'Approved'
          : pIdx === 1
          ? 'Submitted'
          : 'Revision Requested'
        : mod <= 2
        ? 'Approved'
        : mod === 3
        ? 'Submitted'
        : mod === 4
        ? 'Revision Requested'
        : 'Draft';

      const parentVisible = status === 'Approved' && (isPriority || mod !== 2);
      const isLateSubmission = tIdx % 4 === 2;
      const submittedAt =
        status === 'Draft'
          ? undefined
          : isLateSubmission
          ? '2026-09-10T11:20:00Z'
          : '2026-09-04T09:15:00Z';
      const reviewedAt =
        status === 'Approved' || status === 'Revision Requested'
          ? '2026-09-06T14:30:00Z'
          : undefined;

      const schemeId = `sow-${tenant.id.replace(/[^a-z0-9]/gi, '').slice(0, 10)}-${tIdx + 1}-${pIdx + 1}`;
      schemesOfWork.push({
        id: schemeId,
        tenantId: tenant.id,
        academicYear,
        term,
        grade,
        section,
        subject,
        teacherId: teacher.id,
        teacherName: teacher.name,
        title: `${grade} ${section} ${subject} — ${term} Scheme of Work`,
        referenceBook: tpl.referenceBook,
        weeksCount: weeks.length,
        weeks,
        status,
        parentVisible,
        parentSummary: `${term} curriculum roadmap covering ${weeks
          .slice(0, 3)
          .map((w) => w.strand)
          .join(', ')} with weekly formative checks.`,
        dueDate: config.schemeDueDate,
        submittedAt,
        reviewedByName: reviewedAt ? reviewerName : undefined,
        reviewedAt,
        reviewFeedback:
          status === 'Revision Requested'
            ? 'Please expand Week 4 practical resources and align key inquiry questions with KICD strand phrasing.'
            : status === 'Approved'
            ? 'Well structured CBC alignment. Approved for term delivery.'
            : undefined,
        createdAt: '2026-09-02T08:00:00Z',
        updatedAt: reviewedAt || submittedAt || '2026-09-03T10:00:00Z',
      });

      // Create 1-2 lesson plans per scheme (covering active week 8 + week 7)
      const lpWeek = config.currentWeekNumber;
      const strandObj = tpl.strands[(pIdx + tIdx) % tpl.strands.length];
      const lpStatus: LessonPlan['status'] =
        status === 'Approved'
          ? 'Approved'
          : status === 'Submitted'
          ? 'Submitted'
          : status === 'Revision Requested'
          ? 'Revision Requested'
          : 'Draft';

      lessonPlans.push({
        id: `lp-${tenant.id.replace(/[^a-z0-9]/gi, '').slice(0, 10)}-${tIdx + 1}-${pIdx + 1}-w${lpWeek}`,
        tenantId: tenant.id,
        schemeOfWorkId: schemeId,
        academicYear,
        term,
        weekNumber: lpWeek,
        lessonDate: `2026-11-${String(16 + ((tIdx + pIdx) % 5)).padStart(2, '0')}`,
        periodNumber: ((tIdx + pIdx) % 6) + 1,
        durationMinutes: 40,
        grade,
        section,
        subject,
        teacherId: teacher.id,
        teacherName: teacher.name,
        strand: strandObj.strand,
        subStrand: strandObj.subStrand,
        lessonTitle: `${subject}: ${strandObj.subStrand}`,
        learningOutcomes: strandObj.outcomes,
        learningResources: strandObj.resources,
        introductionActivity: `5 min: Review prior knowledge using the key inquiry question: "${strandObj.inquiry}"`,
        lessonDevelopment: `25 min: ${strandObj.activities} Guided group coaching and differentiated support.`,
        conclusionActivity: `10 min: ${strandObj.assessment} and recap of key takeaways.`,
        extendedHomework: strandObj.homework,
        teacherReflection: 'Learners engaged strongly during group work; allow 5 extra minutes for slower writers.',
        status: lpStatus,
        parentVisible: lpStatus === 'Approved' && parentVisible,
        dueDate: '2026-11-15',
        submittedAt: lpStatus === 'Draft' ? undefined : '2026-11-14T16:10:00Z',
        reviewedByName:
          lpStatus === 'Approved' || lpStatus === 'Revision Requested' ? reviewerName : undefined,
        reviewedAt:
          lpStatus === 'Approved' || lpStatus === 'Revision Requested'
            ? '2026-11-15T08:45:00Z'
            : undefined,
        reviewFeedback:
          lpStatus === 'Revision Requested'
            ? 'Include explicit differentiated support activity for learners approaching expectations.'
            : lpStatus === 'Approved'
            ? 'Clear lesson pacing and parent homework prompt. Approved.'
            : undefined,
        createdAt: '2026-11-13T09:00:00Z',
        updatedAt: '2026-11-15T08:45:00Z',
      });

      const masteryLevels: CbcLearnerMasteryLevel[] = [
        'Meeting Expectations',
        'Exceeding Expectations',
        'Approaching Expectations',
      ];
      const coverageStatuses: RecordOfWorkCoverageStatus[] = [
        'Completed',
        'Completed',
        'Partially Covered',
        'Carried Forward',
      ];

      // Completed prior week (Week currentWeekNumber - 1) + active week record
      const prevWeek = Math.max(1, lpWeek - 1);
      const prevWeekObj = weeks.find((w) => w.weekNumber === prevWeek) || weeks[0];
      const activeWeekObj = weeks.find((w) => w.weekNumber === lpWeek) || weeks[weeks.length - 1];
      const idSlug = tenant.id.replace(/[^a-z0-9]/gi, '').slice(0, 10);

      recordsOfWork.push({
        id: `row-${idSlug}-${tIdx + 1}-${pIdx + 1}-w${prevWeek}`,
        tenantId: tenant.id,
        schemeOfWorkId: schemeId,
        academicYear,
        term,
        weekNumber: prevWeek,
        dateCovered: `2026-11-${String(9 + ((tIdx + pIdx) % 5)).padStart(2, '0')}`,
        grade,
        section,
        subject,
        teacherId: teacher.id,
        teacherName: teacher.name,
        strand: prevWeekObj.strand,
        subStrand: prevWeekObj.subStrand,
        workCovered: `Covered ${prevWeekObj.subStrand}: ${prevWeekObj.learningActivities}`,
        lessonsTaughtCount: 4,
        lessonsPlannedCount: 4,
        learnerMastery: masteryLevels[(tIdx + pIdx) % 2],
        coverageStatus: 'Completed',
        challengesAndRemediation:
          'Three learners needed additional guided practice; scheduled short peer-coaching recap at the start of Week 8.',
        remarks: 'Syllabus pacing on track for Term assessment.',
        parentSummary: `Completed ${prevWeekObj.strand} (${prevWeekObj.subStrand}) with practical class exercises.`,
        status: 'Approved',
        parentVisible: parentVisible || pIdx === 0,
        dueDate: '2026-11-13',
        submittedAt: '2026-11-13T15:30:00Z',
        reviewedByName: reviewerName,
        reviewedAt: '2026-11-14T09:10:00Z',
        reviewFeedback: 'Weekly coverage verified against Scheme of Work.',
        createdAt: '2026-11-13T15:00:00Z',
        updatedAt: '2026-11-14T09:10:00Z',
      });

      const activeCovStatus = coverageStatuses[(tIdx + pIdx) % coverageStatuses.length];
      recordsOfWork.push({
        id: `row-${idSlug}-${tIdx + 1}-${pIdx + 1}-w${lpWeek}`,
        tenantId: tenant.id,
        schemeOfWorkId: schemeId,
        lessonPlanId: `lp-${idSlug}-${tIdx + 1}-${pIdx + 1}-w${lpWeek}`,
        academicYear,
        term,
        weekNumber: lpWeek,
        dateCovered: `2026-11-${String(16 + ((tIdx + pIdx) % 5)).padStart(2, '0')}`,
        grade,
        section,
        subject,
        teacherId: teacher.id,
        teacherName: teacher.name,
        strand: activeWeekObj.strand,
        subStrand: activeWeekObj.subStrand,
        workCovered:
          activeCovStatus === 'Completed'
            ? `Taught ${activeWeekObj.subStrand} and assessed learners using ${activeWeekObj.assessmentMethod}.`
            : activeCovStatus === 'Partially Covered'
            ? `Introduced ${activeWeekObj.subStrand}; practical demonstration completed, remaining drill items scheduled next period.`
            : `Carried forward ${activeWeekObj.subStrand} due to mid-week co-curricular assembly; reschedule in Lesson 1 next week.`,
        lessonsTaughtCount: activeCovStatus === 'Completed' ? 4 : activeCovStatus === 'Partially Covered' ? 3 : 1,
        lessonsPlannedCount: 4,
        learnerMastery: masteryLevels[(tIdx + pIdx + 1) % masteryLevels.length],
        coverageStatus: activeCovStatus,
        challengesAndRemediation:
          activeCovStatus === 'Completed'
            ? 'All core competencies demonstrated; extension prompts given to early finishers.'
            : 'Schedule 15-minute consolidation recap before moving to next sub-strand.',
        remarks:
          activeCovStatus === 'Completed'
            ? 'Covered as scheduled.'
            : 'Carry forward remainder to next week.',
        parentSummary: `Week ${lpWeek} focus on ${activeWeekObj.subStrand} (${activeCovStatus.toLowerCase()}).`,
        status: lpStatus,
        parentVisible: lpStatus === 'Approved' && parentVisible,
        dueDate: '2026-11-20',
        submittedAt: lpStatus === 'Draft' ? undefined : '2026-11-20T16:00:00Z',
        reviewedByName:
          lpStatus === 'Approved' || lpStatus === 'Revision Requested' ? reviewerName : undefined,
        reviewedAt:
          lpStatus === 'Approved' || lpStatus === 'Revision Requested'
            ? '2026-11-21T09:00:00Z'
            : undefined,
        reviewFeedback:
          lpStatus === 'Revision Requested'
            ? 'Please specify exact remedial plan for learners approaching expectations.'
            : lpStatus === 'Approved'
            ? 'Coverage logged and verified.'
            : undefined,
        createdAt: '2026-11-19T14:00:00Z',
        updatedAt: '2026-11-21T09:00:00Z',
      });

      const noteIdSlug = tenant.id.replace(/[^a-z0-9]/gi, '').slice(0, 10);
      const linkedLpId = `lp-${noteIdSlug}-${tIdx + 1}-${pIdx + 1}-w${lpWeek}`;
      const noteDate = `2026-11-${String(16 + ((tIdx + pIdx) % 5)).padStart(2, '0')}`;
      const noteSubmitted = lpStatus === 'Approved' || lpStatus === 'Submitted';
      lessonNotes.push({
        id: `ln-${noteIdSlug}-${tIdx + 1}-${pIdx + 1}-w${lpWeek}`,
        tenantId: tenant.id,
        schemeOfWorkId: schemeId,
        lessonPlanId: linkedLpId,
        academicYear,
        term,
        weekNumber: lpWeek,
        lessonDate: noteDate,
        grade,
        section,
        subject,
        teacherId: teacher.id,
        teacherName: teacher.name,
        submissionStatus: noteSubmitted ? 'Submitted' : 'Not Submitted',
        remarks: noteSubmitted
          ? 'Lesson notes file checked and verified for Week ' + lpWeek + '.'
          : 'Pending final example sheets; expected before Friday check.',
        status: noteSubmitted ? 'Submitted' : 'Draft',
        parentVisible: false,
        dueDate: '2026-11-16',
        submittedAt: noteSubmitted ? '2026-11-15T17:20:00Z' : undefined,
        createdAt: '2026-11-15T14:00:00Z',
        updatedAt: '2026-11-16T08:30:00Z',
      });
    }
  });

  return { schemesOfWork, lessonPlans, recordsOfWork, lessonNotes, config };
}

export function buildDefaultTeacherLessonAttendanceForTenant(
  tenant: Tenant,
  timetable: TimetableSlot[]
): TeacherLessonAttendanceRecord[] {
  const tenantSlots = timetable.filter((s) => s.tenantId === tenant.id);
  const mondaySlots = tenantSlots.filter((s) => s.day === 'Monday').slice(0, 10);
  if (mondaySlots.length === 0 || tenant.teachers.length === 0) return [];

  const sampleDate = '2026-11-16'; // Monday
  const slug = tenant.id.replace(/[^a-z0-9]/gi, '').slice(0, 8);

  return mondaySlots.map((slot, idx) => {
    const delegateTeacher =
      tenant.teachers.find((t) => t.id !== slot.teacherId) || tenant.teachers[0];
    const mode = idx % 5;
    if (mode === 1 && delegateTeacher && delegateTeacher.id !== slot.teacherId) {
      return {
        id: `tla-${slug}-${idx + 1}`,
        tenantId: tenant.id,
        date: sampleDate,
        dayOfWeek: slot.day,
        timetableSlotId: slot.id,
        periodNumber: slot.period,
        timeSlot: `${slot.startTime}–${slot.endTime}`,
        grade: slot.grade,
        section: slot.section,
        subject: slot.subject,
        scheduledTeacherId: slot.teacherId,
        scheduledTeacherName: slot.teacherName,
        status: 'Delegated',
        delegatedTeacherId: delegateTeacher.id,
        delegatedTeacherName: delegateTeacher.name,
        delegationNotes: 'Mandated while scheduled teacher attends sub-county CBC workshop.',
        topicCovered: `${slot.subject} guided problem solving & workbook check`,
        remarks: `Mandate formally assigned to ${delegateTeacher.name}.`,
        recordedBy: 'Academic Office',
        createdAt: '2026-11-16T08:15:00Z',
        updatedAt: '2026-11-16T08:15:00Z',
      };
    }
    if (mode === 2) {
      return {
        id: `tla-${slug}-${idx + 1}`,
        tenantId: tenant.id,
        date: sampleDate,
        dayOfWeek: slot.day,
        timetableSlotId: slot.id,
        periodNumber: slot.period,
        timeSlot: `${slot.startTime}–${slot.endTime}`,
        grade: slot.grade,
        section: slot.section,
        subject: slot.subject,
        scheduledTeacherId: slot.teacherId,
        scheduledTeacherName: slot.teacherName,
        status: 'Recovered',
        originalMissedDate: '2026-11-12',
        recoveredDate: sampleDate,
        recoveredPeriod: slot.period,
        recoveredByTeacherId: slot.teacherId,
        recoveredByTeacherName: slot.teacherName,
        topicCovered: `Make-up lesson covering missed ${slot.subject} strand`,
        remarks: 'Recovered afternoon remedial block; full syllabus parity restored.',
        recordedBy: slot.teacherName,
        createdAt: '2026-11-16T15:30:00Z',
        updatedAt: '2026-11-16T15:30:00Z',
      };
    }
    if (mode === 4) {
      return {
        id: `tla-${slug}-${idx + 1}`,
        tenantId: tenant.id,
        date: sampleDate,
        dayOfWeek: slot.day,
        timetableSlotId: slot.id,
        periodNumber: slot.period,
        timeSlot: `${slot.startTime}–${slot.endTime}`,
        grade: slot.grade,
        section: slot.section,
        subject: slot.subject,
        scheduledTeacherId: slot.teacherId,
        scheduledTeacherName: slot.teacherName,
        status: 'Missed',
        remarks: 'Class rescheduled for recovery later in the week.',
        recordedBy: 'Academic Office',
        createdAt: '2026-11-16T12:00:00Z',
        updatedAt: '2026-11-16T12:00:00Z',
      };
    }
    return {
      id: `tla-${slug}-${idx + 1}`,
      tenantId: tenant.id,
      date: sampleDate,
      dayOfWeek: slot.day,
      timetableSlotId: slot.id,
      periodNumber: slot.period,
      timeSlot: `${slot.startTime}–${slot.endTime}`,
      grade: slot.grade,
      section: slot.section,
      subject: slot.subject,
      scheduledTeacherId: slot.teacherId,
      scheduledTeacherName: slot.teacherName,
      status: 'Attended',
      topicCovered: `${slot.subject} scheduled curriculum lesson delivered`,
      remarks: 'Conducted on schedule.',
      recordedBy: slot.teacherName,
      createdAt: '2026-11-16T09:00:00Z',
      updatedAt: '2026-11-16T09:00:00Z',
    };
  });
}

export function buildDefaultProgressiveReportsForTenant(
  tenant: Tenant,
  students: Student[]
): LearnerProgressiveEntry[] {
  const tenantActive = students.filter((s) => s.tenantId === tenant.id && !s.deleted);
  const parentLinked = tenantActive.filter((s) => Boolean(s.parentUserId));
  const seenIds = new Set<string>();
  const activeStudents: Student[] = [];
  for (const stu of [...parentLinked, ...tenantActive.slice(0, 12)]) {
    if (seenIds.has(stu.id)) continue;
    seenIds.add(stu.id);
    activeStudents.push(stu);
  }
  if (activeStudents.length === 0) return [];

  const slug = tenant.id.replace(/[^a-z0-9]/gi, '').slice(0, 8);
  const checkpoints = [
    {
      label: 'CAT 1 Formative Check',
      date: '2026-09-25',
      term: tenant.currentTerm || 'Term 1',
      academicYear: tenant.academicYear || '2026–2027',
      seq: 1,
      offset: -4,
      source: 'import' as const,
    },
    {
      label: 'CAT 2 Progressive Review',
      date: '2026-10-30',
      term: tenant.currentTerm || 'Term 1',
      academicYear: tenant.academicYear || '2026–2027',
      seq: 2,
      offset: 2,
      source: 'manual' as const,
    },
  ];

  const entries: LearnerProgressiveEntry[] = [];
  activeStudents.forEach((stu, sIdx) => {
    const subs = getStudentRegisteredSubjects(tenant, stu).slice(0, 6);
    if (subs.length === 0) return;

    checkpoints.forEach((cp, cIdx) => {
      const subjectRows: ProgressiveReportSubjectScore[] = subs.map((sub, subIdx) => {
        const base = 66 + ((sIdx * 5 + subIdx * 3) % 26) + cp.offset;
        const clamped = Math.max(38, Math.min(98, base));
        const graded = computeAssessmentGrade(clamped, stu.grade);
        const mastery: CbcLearnerMasteryLevel =
          clamped >= 80
            ? 'Exceeding Expectations'
            : clamped >= 65
            ? 'Meeting Expectations'
            : clamped >= 50
            ? 'Approaching Expectations'
            : 'Below Expectations';
        return {
          subject: sub,
          score: clamped,
          maxScore: 100,
          resultStatus: 'Scored',
          letterGrade: graded.letterGrade,
          gpaPoints: graded.gpaPoints,
          masteryLevel: mastery,
          remarks: clamped >= 80 ? 'Strong mastery demonstrated' : 'Steady term growth',
        };
      });

      const totalScore = subjectRows.reduce((sum, r) => sum + (r.score ?? 0), 0);
      const maxPossible = subjectRows.length * 100;
      const meanScore = Number((totalScore / subjectRows.length).toFixed(1));
      const meanGraded = computeAssessmentGrade(meanScore, stu.grade);

      entries.push({
        id: `prog-${slug}-${stu.id.slice(-6)}-${cIdx + 1}`,
        tenantId: tenant.id,
        studentId: stu.id,
        studentName: stu.fullName,
        studentCode: stu.studentCode,
        grade: stu.grade,
        section: stu.section,
        academicYear: cp.academicYear,
        term: cp.term,
        assessmentLabel: cp.label,
        assessmentDate: cp.date,
        sequenceOrder: cp.seq,
        subjects: subjectRows,
        totalScore,
        maxPossible,
        meanScore,
        meanGrade: meanGraded.letterGrade,
        classTeacherRemarks:
          cIdx === 1
            ? 'Notable upward trajectory between CAT 1 and CAT 2 checkpoints.'
            : 'Solid early-term foundation; continue consistent homework follow-up.',
        source: cp.source,
        recordedByName: tenant.teachers[0]?.name || 'Academic Office',
        createdAt: `${cp.date}T12:00:00Z`,
        updatedAt: `${cp.date}T12:00:00Z`,
      });
    });
  });

  return entries;
}
