import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CalendarCog,
  Check,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Users,
  Wand2,
  X,
} from 'lucide-react';
import { saasApi } from '../lib/api';
import { DaySchedulePanel } from './timetable/DaySchedulePanel';
import { LessonCardsPanel } from './timetable/LessonCardsPanel';
import { SolveDialog } from './timetable/SolveDialog';
import { SubjectConstraintsPanel } from './timetable/SubjectConstraintsPanel';
import { TeacherAvailabilityPanel } from './timetable/TeacherAvailabilityPanel';
import {
  areSubjectsInSameOptionalGroup,
  CLASS_TEACHER_SUBJECT_TOKEN,
  DEFAULT_DAY_CLOSING_NOTE,
  DEFAULT_DAY_OPENING_NOTE,
  findOptionalGroupForSubject,
  getClusterForGrade,
  getLessonsPerWeekForSubject,
  getStreamsForGrade,
  getSubjectsForGrade,
  getSubjectsForLevel,
  getTenantBellSchedule,
  getTenantLessonRows,
  getTenantPeriodTimes,
  isSingleTeacherGrade,
  isSlotWithinSubjectTimeWindow,
  KENYAN_CBC_CLUSTERS,
  KENYAN_CBC_LEVEL_SUBJECTS,
  resolveSubjectConstraint,
  type CbcClusterDefinition,
  type CbcClusterId,
  type DayOfWeek,
  type TeacherClassAssignment,
  type TeacherProfile,
  type TenantWorkspaceData,
  type TimetableSlot,
  type UserRole,
} from '../shared/types';

interface TimetableModuleProps {
  workspace: TenantWorkspaceData;
  currentRole?: UserRole;
  canEdit?: boolean;
  onRefresh: () => Promise<void>;
  onNotify: (title: string, tone?: 'success' | 'error') => void;
}

interface EditableSubjectRow {
  original: string | null;
  value: string;
  lessonsPerWeek: number;
}

const DAYS: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

export function TimetableModule({
  workspace,
  currentRole = 'Admin',
  canEdit = true,
  onRefresh,
  onNotify,
}: TimetableModuleProps) {
  const { tenant, timetable } = workspace;
  const isReadOnlyViewer = !canEdit || currentRole === 'Parent' || currentRole === 'Student';
  const bellSchedule = useMemo(() => getTenantBellSchedule(tenant), [tenant]);
  const lessonRows = useMemo(() => getTenantLessonRows(tenant), [tenant]);
  const periodTimes = useMemo(() => getTenantPeriodTimes(tenant), [tenant]);
  const weeklySlotsCap = Math.max(1, lessonRows.length * 5);

  const defaultGrade = tenant.grades.includes('Grade 9')
    ? 'Grade 9'
    : tenant.grades[0] || 'Grade 9';
  const defaultStreams = getStreamsForGrade(tenant, defaultGrade);

  const [activeTab, setActiveTab] = useState<'grid' | 'lessons' | 'constraints' | 'teachers'>('grid');
  const [constraintSection, setConstraintSection] = useState<'subjects' | 'schedule' | 'teachers'>('subjects');
  const [solveOpen, setSolveOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'grade' | 'teacher' | 'room'>('grade');
  const [selectedGrade, setSelectedGrade] = useState<string>(defaultGrade);
  const [selectedSection, setSelectedSection] = useState<string>(defaultStreams[0] || 'A');
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>(
    tenant.teachers[0]?.id || ''
  );
  const [selectedRoom, setSelectedRoom] = useState<string>(tenant.rooms[0] || '');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [slotForm, setSlotForm] = useState({
    day: 'Monday' as DayOfWeek,
    period: 1,
    grade: defaultGrade,
    section: defaultStreams[0] || 'A',
    subject: tenant.subjects[0] || 'Mathematics',
    teacherId: tenant.teachers[0]?.id || '',
    room: tenant.rooms[0] || 'Room 101',
  });

  // Generator Modal State
  const [generateModalOpen, setGenerateModalOpen] = useState(false);
  const [genScope, setGenScope] = useState<'cohort' | 'grade' | 'cluster' | 'school'>('cluster');
  const [genSelectedGrades, setGenSelectedGrades] = useState<string[]>(() => {
    const initialCluster = KENYAN_CBC_CLUSTERS.find((c) =>
      c.grades.includes(defaultGrade)
    );
    return (initialCluster?.grades || [defaultGrade]).filter((g) =>
      tenant.grades.includes(g)
    );
  });
  const [genLessonsPerCohort, setGenLessonsPerCohort] = useState<number>(0);
  const [genReplaceExisting, setGenReplaceExisting] = useState<boolean>(true);
  const [generating, setGenerating] = useState(false);

  // Full Subject Customization Modal State (Per CBC Curriculum Level)
  const [coverageLevel, setCoverageLevel] = useState<CbcClusterId>(() =>
    getClusterForGrade(defaultGrade)
  );
  const [subjectsModalOpen, setSubjectsModalOpen] = useState(false);
  const [editingLevel, setEditingLevel] = useState<CbcClusterId>(() =>
    getClusterForGrade(defaultGrade)
  );
  const [draftByLevel, setDraftByLevel] = useState<
    Partial<Record<CbcClusterId, EditableSubjectRow[]>>
  >({});
  const [dirtyLevels, setDirtyLevels] = useState<CbcClusterId[]>([]);
  const [newCatalogSubject, setNewCatalogSubject] = useState('');
  const [newCatalogLessons, setNewCatalogLessons] = useState<number>(3);
  const [subjectsSaving, setSubjectsSaving] = useState(false);

  const subjectRows: EditableSubjectRow[] = useMemo(() => {
    const existing = draftByLevel[editingLevel];
    if (existing) return existing;
    return getSubjectsForLevel(tenant, editingLevel).map((sub) => ({
      original: sub,
      value: sub,
      lessonsPerWeek: getLessonsPerWeekForSubject(tenant, sub, editingLevel),
    }));
  }, [draftByLevel, editingLevel, tenant]);

  // Teachers, Contacts, Grade/Stream & Subjects Form State
  const [editingTeacherId, setEditingTeacherId] = useState<string | null>(null);
  const [teacherName, setTeacherName] = useState('');
  const [teacherPhone, setTeacherPhone] = useState('+254 7');
  const [teacherEmail, setTeacherEmail] = useState('');
  const [teacherDepartment, setTeacherDepartment] = useState('');
  const [teacherSubjects, setTeacherSubjects] = useState<string[]>(
    tenant.subjects[0] ? [tenant.subjects[0]] : []
  );
  const [teacherClasses, setTeacherClasses] = useState<TeacherClassAssignment[]>([]);
  const [openToAllClasses, setOpenToAllClasses] = useState<boolean>(false);
  const [subjectsTouchedManually, setSubjectsTouchedManually] = useState<boolean>(false);
  const [pickerGrade, setPickerGrade] = useState<string>(defaultGrade);
  const [pickerSection, setPickerSection] = useState<string>(defaultStreams[0] || 'A');
  const [pickerSubject, setPickerSubject] = useState<string>(
    isSingleTeacherGrade(defaultGrade)
      ? CLASS_TEACHER_SUBJECT_TOKEN
      : getSubjectsForGrade(tenant, defaultGrade)[0] || tenant.subjects[0] || ''
  );
  const [customSubjectInput, setCustomSubjectInput] = useState('');
  const [teacherSaving, setTeacherSaving] = useState(false);

  const activeToolbarStreams = useMemo(
    () => getStreamsForGrade(tenant, selectedGrade),
    [tenant, selectedGrade]
  );
  const activeModalStreams = useMemo(
    () => getStreamsForGrade(tenant, slotForm.grade),
    [tenant, slotForm.grade]
  );
  const activePickerStreams = useMemo(
    () => getStreamsForGrade(tenant, pickerGrade),
    [tenant, pickerGrade]
  );

  const pickerCluster = useMemo(() => {
    const id = getClusterForGrade(pickerGrade);
    return KENYAN_CBC_CLUSTERS.find((c) => c.id === id) || KENYAN_CBC_CLUSTERS[3];
  }, [pickerGrade]);

  const pickerLevelSubjects = useMemo(
    () => getSubjectsForLevel(tenant, pickerCluster.id),
    [tenant, pickerCluster.id]
  );

  const slotCluster = useMemo(() => {
    const id = getClusterForGrade(slotForm.grade);
    return KENYAN_CBC_CLUSTERS.find((c) => c.id === id) || KENYAN_CBC_CLUSTERS[3];
  }, [slotForm.grade]);

  const slotLevelSubjects = useMemo(
    () => getSubjectsForLevel(tenant, slotCluster.id),
    [tenant, slotCluster.id]
  );

  // Combine tenant subjects + any subjects assigned to teachers/selected, ordered with pickerGrade's level subjects first
  const allSubjectChoices = useMemo(() => {
    const ordered = new Set<string>(pickerLevelSubjects);
    tenant.subjects.forEach((s) => ordered.add(s));
    tenant.teachers.forEach((t) =>
      t.subjects.forEach((s) => {
        if (s !== CLASS_TEACHER_SUBJECT_TOKEN) ordered.add(s);
      })
    );
    teacherSubjects.forEach((s) => {
      if (s !== CLASS_TEACHER_SUBJECT_TOKEN) ordered.add(s);
    });
    if (pickerSubject && pickerSubject !== CLASS_TEACHER_SUBJECT_TOKEN) {
      ordered.add(pickerSubject);
    }
    return Array.from(ordered);
  }, [pickerLevelSubjects, tenant.subjects, tenant.teachers, teacherSubjects, pickerSubject]);

  const pickerIsSingleTeacher = useMemo(
    () => isSingleTeacherGrade(pickerGrade),
    [pickerGrade]
  );

  const genTargetGrades = useMemo(() => {
    if (genScope === 'school') return tenant.grades;
    if (genScope === 'cluster') {
      return tenant.grades.filter((g) => genSelectedGrades.includes(g));
    }
    if (genScope === 'grade') return [selectedGrade];
    return [selectedGrade];
  }, [genScope, tenant.grades, genSelectedGrades, selectedGrade]);

  const genIncludesSingleTeacherGrades = useMemo(
    () => genTargetGrades.some((g) => isSingleTeacherGrade(g)),
    [genTargetGrades]
  );

  const genIncludesSpecialistGrades = useMemo(
    () => genTargetGrades.some((g) => !isSingleTeacherGrade(g)),
    [genTargetGrades]
  );

  const genTargetStreamCount = useMemo(() => {
    if (genScope === 'cohort') return 1;
    return genTargetGrades.reduce(
      (sum, g) => sum + getStreamsForGrade(tenant, g).length,
      0
    );
  }, [genScope, genTargetGrades, tenant]);

  // Weekly lesson counts per teacher
  const teacherWeeklyLoad = useMemo(() => {
    const map = new Map<string, number>();
    tenant.teachers.forEach((t) => map.set(t.id, 0));
    timetable.forEach((slot) => {
      map.set(slot.teacherId, (map.get(slot.teacherId) || 0) + 1);
    });
    return map;
  }, [tenant.teachers, timetable]);

  // Subject coverage report & weekly lesson summary for the selected CBC level tab
  const coverageCluster = useMemo(
    () => KENYAN_CBC_CLUSTERS.find((c) => c.id === coverageLevel) || KENYAN_CBC_CLUSTERS[3],
    [coverageLevel]
  );

  const subjectCoverage = useMemo(() => {
    const levelSubs = getSubjectsForLevel(tenant, coverageLevel);
    return levelSubs.map((subject) => {
      const assigned = tenant.teachers.filter((t) =>
        t.subjects.some((ts) => ts.toLowerCase() === subject.toLowerCase())
      );
      const lessonsPerWeek = getLessonsPerWeekForSubject(tenant, subject, coverageLevel);
      return { subject, teachers: assigned, lessonsPerWeek };
    });
  }, [tenant, coverageLevel]);

  const totalConfiguredLessons = useMemo(
    () => subjectCoverage.reduce((sum, item) => sum + item.lessonsPerWeek, 0),
    [subjectCoverage]
  );

  const modalTotalSubjectLessons = useMemo(
    () => subjectRows.reduce((sum, row) => sum + row.lessonsPerWeek, 0),
    [subjectRows]
  );

  const genUncoveredSubjects = useMemo(() => {
    const specialistClusters = Array.from(
      new Set(
        genTargetGrades
          .filter((g) => !isSingleTeacherGrade(g))
          .map((g) => getClusterForGrade(g))
      )
    );
    const missing = new Set<string>();
    specialistClusters.forEach((cid) => {
      getSubjectsForLevel(tenant, cid).forEach((sub) => {
        const hasTeacher = tenant.teachers.some((t) =>
          t.subjects.some((ts) => ts.toLowerCase() === sub.toLowerCase())
        );
        if (!hasTeacher) missing.add(sub);
      });
    });
    return Array.from(missing);
  }, [genTargetGrades, tenant]);

  const genLevelLessonsLabel = useMemo(() => {
    const clusters = Array.from(
      new Set(genTargetGrades.map((g) => getClusterForGrade(g)))
    );
    if (clusters.length === 0) return `${Math.min(weeklySlotsCap, totalConfiguredLessons)} lessons / week`;
    const totals = clusters.map((cid) =>
      Math.min(
        weeklySlotsCap,
        getSubjectsForLevel(tenant, cid).reduce(
          (sum, sub) => sum + getLessonsPerWeekForSubject(tenant, sub, cid),
          0
        )
      )
    );
    const min = Math.min(...totals);
    const max = Math.max(...totals);
    return min === max ? `${min} lessons / week` : `${min}–${max} lessons / week by level`;
  }, [genTargetGrades, tenant, totalConfiguredLessons, weeklySlotsCap]);

  const uncoveredSubjects = useMemo(
    () =>
      coverageCluster.singleClassTeacher
        ? []
        : subjectCoverage.filter((item) => item.teachers.length === 0).map((i) => i.subject),
    [coverageCluster, subjectCoverage]
  );

  // Live conflict checker before saving a manual slot
  const liveConflict = useMemo(() => {
    const times = periodTimes[slotForm.period];
    if (!times) {
      return `Lesson ${slotForm.period} is not configured in this school's bell schedule.`;
    }
    const subRule = resolveSubjectConstraint(tenant, slotForm.grade, slotForm.subject);
    const winCheck = isSlotWithinSubjectTimeWindow(times, subRule);
    if (!winCheck.ok) {
      return `${slotForm.subject}: ${winCheck.reason}`;
    }

    const teacher = tenant.teachers.find((t) => t.id === slotForm.teacherId);
    if (teacher) {
      if ((teacher.unavailable || []).some((u) => u.day === slotForm.day && u.period === slotForm.period)) {
        return `${teacher.name} is marked unavailable on ${slotForm.day} Lesson ${slotForm.period}.`;
      }
      if (teacher.maxLessonsPerDay) {
        const dayLoad = timetable.filter(
          (s) => s.teacherId === teacher.id && s.day === slotForm.day && s.id !== editingSlotId
        ).length;
        if (dayLoad >= teacher.maxLessonsPerDay) {
          return `${teacher.name} already has ${dayLoad} lesson(s) on ${slotForm.day} (daily limit ${teacher.maxLessonsPerDay}).`;
        }
      }
    }

    const others = timetable.filter(
      (s) => s.day === slotForm.day && s.period === slotForm.period && s.id !== editingSlotId
    );
    const classSlots = others.filter(
      (s) => s.grade === slotForm.grade && s.section === slotForm.section
    );
    const classClash = classSlots.find(
      (s) =>
        s.subject.trim().toLowerCase() === slotForm.subject.trim().toLowerCase() ||
        !areSubjectsInSameOptionalGroup(tenant, slotForm.grade, s.subject, slotForm.subject)
    );
    if (classClash) {
      return `${slotForm.grade} Stream ${slotForm.section} already has ${classClash.subject} in Lesson ${slotForm.period}.`;
    }
    const teacherClash = others.find((s) => s.teacherId === slotForm.teacherId);
    if (teacherClash) {
      return `${teacherClash.teacherName} is already teaching ${teacherClash.grade} Stream ${teacherClash.section} (${teacherClash.subject}).`;
    }
    const roomClash = others.find((s) => s.room === slotForm.room);
    if (roomClash) {
      return `${slotForm.room} is already occupied by ${roomClash.grade} Stream ${roomClash.section} (${roomClash.subject}).`;
    }
    return null;
  }, [timetable, slotForm, editingSlotId, periodTimes, tenant]);

  const filteredSlots = useMemo(() => {
    if (viewMode === 'grade') {
      return timetable.filter(
        (s) => s.grade === selectedGrade && s.section === selectedSection
      );
    }
    if (viewMode === 'teacher') {
      return timetable.filter((s) => s.teacherId === selectedTeacherId);
    }
    return timetable.filter((s) => s.room === selectedRoom);
  }, [timetable, viewMode, selectedGrade, selectedSection, selectedTeacherId, selectedRoom]);

  const qualifiedTeachersForModalSubject = useMemo(() => {
    return tenant.teachers.filter((t) =>
      t.subjects.some((ts) => ts.toLowerCase() === slotForm.subject.toLowerCase())
    );
  }, [tenant.teachers, slotForm.subject]);

  const openCreateAt = (day: DayOfWeek, period: number) => {
    setEditingSlotId(null);
    const levelSubs = getSubjectsForGrade(tenant, selectedGrade);
    const initialSubject = levelSubs[0] || tenant.subjects[0] || '';
    const qualified = tenant.teachers.find((t) =>
      t.subjects.some((ts) => ts.toLowerCase() === initialSubject.toLowerCase())
    );
    setSlotForm({
      day,
      period,
      grade: selectedGrade,
      section: selectedSection,
      subject: initialSubject,
      teacherId:
        viewMode === 'teacher' && selectedTeacherId
          ? selectedTeacherId
          : qualified?.id || tenant.teachers[0]?.id || '',
      room: viewMode === 'room' && selectedRoom ? selectedRoom : tenant.rooms[0] || '',
    });
    setModalOpen(true);
  };

  const openEdit = (slot: TimetableSlot) => {
    setEditingSlotId(slot.id);
    setSlotForm({
      day: slot.day,
      period: slot.period,
      grade: slot.grade,
      section: slot.section,
      subject: slot.subject,
      teacherId: slot.teacherId,
      room: slot.room,
    });
    setModalOpen(true);
  };

  async function handleSaveSlot(e: React.FormEvent) {
    e.preventDefault();
    if (liveConflict) {
      onNotify(liveConflict, 'error');
      return;
    }
    setSaving(true);
    try {
      if (editingSlotId) {
        await saasApi.updateTimetableSlot(tenant.id, editingSlotId, slotForm);
        onNotify('Lesson updated on timetable.');
      } else {
        await saasApi.createTimetableSlot(tenant.id, slotForm);
        onNotify('Lesson scheduled on timetable.');
      }
      await onRefresh();
      setModalOpen(false);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Conflict detected', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteSlot(slotId: string) {
    setSaving(true);
    try {
      await saasApi.deleteTimetableSlot(tenant.id, slotId);
      await onRefresh();
      setModalOpen(false);
      onNotify('Lesson removed from timetable.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to remove lesson', 'error');
    } finally {
      setSaving(false);
    }
  }

  function toggleClusterGrades(cluster: CbcClusterDefinition) {
    const clusterGradesInTenant = tenant.grades.filter((g) =>
      cluster.grades.some((cg) => cg.toLowerCase() === g.toLowerCase())
    );
    if (clusterGradesInTenant.length === 0) return;
    setGenSelectedGrades((prev) => {
      const allPresent = clusterGradesInTenant.every((g) => prev.includes(g));
      if (allPresent) {
        return prev.filter((g) => !clusterGradesInTenant.includes(g));
      }
      return Array.from(new Set([...prev, ...clusterGradesInTenant]));
    });
  }

  function toggleCustomGrade(grade: string) {
    setGenSelectedGrades((prev) =>
      prev.includes(grade) ? prev.filter((g) => g !== grade) : [...prev, grade]
    );
  }

  async function setLocked(slotIds: string[], locked: boolean) {
    if (slotIds.length === 0) return;
    try {
      await saasApi.setTimetableLocked(tenant.id, { slotIds, locked });
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not update lock.', 'error');
    }
  }

  async function handleGenerateTimetable(e: React.FormEvent) {
    e.preventDefault();
    if (genScope === 'cluster' && genTargetGrades.length === 0) {
      onNotify('Select at least one CBC cluster or custom grade to generate.', 'error');
      return;
    }
    setGenerating(true);
    try {
      const res = await saasApi.generateTimetable(tenant.id, {
        scope: genScope,
        grade: selectedGrade,
        section: selectedSection,
        grades: genScope === 'cluster' ? genTargetGrades : undefined,
        replaceExisting: genReplaceExisting,
        lessonsPerCohort: genLessonsPerCohort > 0 ? genLessonsPerCohort : undefined,
        respectSubjectCounts: genLessonsPerCohort === 0,
      });
      await onRefresh();
      setGenerateModalOpen(false);
      setActiveTab('grid');
      if (
        genScope === 'cluster' &&
        genTargetGrades.length > 0 &&
        !genTargetGrades.includes(selectedGrade)
      ) {
        const firstGenGrade = genTargetGrades[0];
        const firstStreams = getStreamsForGrade(tenant, firstGenGrade);
        setSelectedGrade(firstGenGrade);
        setSelectedSection(firstStreams[0] || 'A');
      }
      const skipMsg =
        res.skippedSubjects.length > 0
          ? ` (Skipped unassigned: ${res.skippedSubjects.join(', ')})`
          : '';
      const singleTeacherNote =
        res.singleTeacherCohorts && res.singleTeacherCohorts.length > 0
          ? ` · ${res.singleTeacherCohorts.length} Pre-School/Lower Primary stream(s) assigned 1 class teacher for all subjects`
          : '';
      onNotify(
        `Generated ${res.createdCount} clash-free lessons across ${res.cohortsScheduled} stream(s)${singleTeacherNote}${skipMsg}.`
      );
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to generate timetable',
        'error'
      );
    } finally {
      setGenerating(false);
    }
  }

  // Subject Catalog Customization Handlers (Per CBC Curriculum Level)
  function updateActiveLevelRows(
    updater: (rows: EditableSubjectRow[]) => EditableSubjectRow[]
  ) {
    setDraftByLevel((prev) => {
      const current =
        prev[editingLevel] ||
        getSubjectsForLevel(tenant, editingLevel).map((sub) => ({
          original: sub,
          value: sub,
          lessonsPerWeek: getLessonsPerWeekForSubject(tenant, sub, editingLevel),
        }));
      return { ...prev, [editingLevel]: updater(current) };
    });
    setDirtyLevels((prev) => (prev.includes(editingLevel) ? prev : [...prev, editingLevel]));
  }

  function openSubjectsEditor(initialLevel?: CbcClusterId) {
    const startLevel = initialLevel || coverageLevel || getClusterForGrade(selectedGrade);
    const initialDrafts: Partial<Record<CbcClusterId, EditableSubjectRow[]>> = {};
    KENYAN_CBC_CLUSTERS.forEach((c) => {
      initialDrafts[c.id] = getSubjectsForLevel(tenant, c.id).map((sub) => ({
        original: sub,
        value: sub,
        lessonsPerWeek: getLessonsPerWeekForSubject(tenant, sub, c.id),
      }));
    });
    setEditingLevel(startLevel);
    setDraftByLevel(initialDrafts);
    setDirtyLevels([]);
    setNewCatalogSubject('');
    setNewCatalogLessons(3);
    setSubjectsModalOpen(true);
  }

  function handleResetLevelToKicdDefault() {
    const presets = KENYAN_CBC_LEVEL_SUBJECTS[editingLevel];
    setDraftByLevel((prev) => ({
      ...prev,
      [editingLevel]: presets.map((item) => ({
        original: item.name,
        value: item.name,
        lessonsPerWeek: item.lessonsPerWeek,
      })),
    }));
    setDirtyLevels((prev) => (prev.includes(editingLevel) ? prev : [...prev, editingLevel]));
  }

  function handleAddCatalogSubject() {
    const trimmed = newCatalogSubject.trim();
    if (!trimmed) return;
    if (
      subjectRows.some(
        (r) => r.value.trim().toLowerCase() === trimmed.toLowerCase()
      )
    ) {
      onNotify(`Subject "${trimmed}" already exists in this level.`, 'error');
      return;
    }
    updateActiveLevelRows((prev) => [
      ...prev,
      { original: null, value: trimmed, lessonsPerWeek: newCatalogLessons },
    ]);
    setNewCatalogSubject('');
    setNewCatalogLessons(3);
  }

  async function handleSaveSubjectsCatalog(e: React.FormEvent) {
    e.preventDefault();
    const levelsToSave: CbcClusterId[] =
      dirtyLevels.length > 0 ? dirtyLevels : [editingLevel];

    for (const lvl of levelsToSave) {
      const rows = draftByLevel[lvl] || [];
      const cleaned = rows.map((r) => r.value.trim()).filter(Boolean);
      const lvlDef = KENYAN_CBC_CLUSTERS.find((c) => c.id === lvl);
      if (cleaned.length === 0) {
        onNotify(`Keep at least one subject for ${lvlDef?.label || lvl}.`, 'error');
        setEditingLevel(lvl);
        return;
      }
      const seen = new Set<string>();
      for (const sub of cleaned) {
        const low = sub.toLowerCase();
        if (seen.has(low)) {
          onNotify(`Duplicate subject name "${sub}" in ${lvlDef?.label || lvl}.`, 'error');
          setEditingLevel(lvl);
          return;
        }
        seen.add(low);
      }
    }

    setSubjectsSaving(true);
    try {
      let latestTenant = tenant;
      const allRenames: Record<string, string> = {};
      for (const lvl of levelsToSave) {
        const rows = (draftByLevel[lvl] || [])
          .map((r) => ({ ...r, trimmed: r.value.trim() }))
          .filter((r) => Boolean(r.trimmed));
        const cleaned = rows.map((r) => r.trimmed);
        const renames: Record<string, string> = {};
        const subjectWeeklyLessons: Record<string, number> = {};
        rows.forEach((row) => {
          if (row.original && row.original !== row.trimmed) {
            renames[row.original] = row.trimmed;
            allRenames[row.original] = row.trimmed;
          }
          subjectWeeklyLessons[row.trimmed] = row.lessonsPerWeek;
        });

        const res = await saasApi.updateSubjects(tenant.id, {
          level: lvl,
          subjects: cleaned,
          renames,
          subjectWeeklyLessons,
        });
        latestTenant = res.tenant;
      }
      await onRefresh();
      setCoverageLevel(editingLevel);
      setTeacherSubjects((prev) => {
        const remapped = prev
          .map((s) => allRenames[s] || s)
          .filter((s) => latestTenant.subjects.includes(s));
        return remapped.length > 0
          ? Array.from(new Set(remapped))
          : latestTenant.subjects[0]
          ? [latestTenant.subjects[0]]
          : [];
      });
      setPickerSubject((prev) => {
        if (prev === CLASS_TEACHER_SUBJECT_TOKEN) return prev;
        const mapped = allRenames[prev] || prev;
        return latestTenant.subjects.includes(mapped)
          ? mapped
          : latestTenant.subjects[0] || '';
      });
      setSubjectsModalOpen(false);
      const activeLabel =
        KENYAN_CBC_CLUSTERS.find((c) => c.id === editingLevel)?.label || 'Level';
      onNotify(
        levelsToSave.length > 1
          ? `Saved curriculum subjects & weekly lessons across ${levelsToSave.length} CBC levels.`
          : `Saved ${activeLabel} curriculum (${subjectRows.length} subjects · ${modalTotalSubjectLessons} lessons/week).`
      );
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to save subjects catalog',
        'error'
      );
    } finally {
      setSubjectsSaving(false);
    }
  }

  // Teacher & Class Allocation Handlers
  function resetTeacherForm() {
    const firstSub = tenant.subjects[0] || '';
    setEditingTeacherId(null);
    setTeacherName('');
    setTeacherPhone('+254 7');
    setTeacherEmail('');
    setTeacherDepartment('');
    setTeacherSubjects(firstSub ? [firstSub] : []);
    setTeacherClasses([]);
    setOpenToAllClasses(false);
    setSubjectsTouchedManually(false);
    setPickerGrade(selectedGrade);
    setPickerSection(selectedSection);
    setPickerSubject(firstSub);
    setCustomSubjectInput('');
  }

  function startEditTeacher(teacher: TeacherProfile) {
    const existingClasses = Array.isArray(teacher.assignedClasses)
      ? [...teacher.assignedClasses]
      : [];
    const firstClass = existingClasses[0];
    setEditingTeacherId(teacher.id);
    setTeacherName(teacher.name);
    setTeacherPhone(teacher.phone || '+254 7');
    setTeacherEmail(teacher.email);
    setTeacherDepartment(teacher.department);
    setTeacherSubjects([...teacher.subjects]);
    setTeacherClasses(existingClasses);
    setOpenToAllClasses(existingClasses.length === 0);
    setSubjectsTouchedManually(true);
    setPickerGrade(firstClass?.grade || selectedGrade);
    setPickerSection(firstClass?.section || selectedSection);
    setPickerSubject(firstClass?.subject || teacher.subjects[0] || tenant.subjects[0] || '');
    setCustomSubjectInput('');
  }

  function handlePickerSubjectChange(nextSubject: string) {
    setPickerSubject(nextSubject);
    if (!subjectsTouchedManually && teacherClasses.length === 0) {
      setTeacherSubjects(nextSubject ? [nextSubject] : []);
    } else if (nextSubject && !teacherSubjects.includes(nextSubject)) {
      setTeacherSubjects((prev) => [...prev, nextSubject]);
    }
  }

  function handleAddClassToTeacher() {
    const subjectVal = pickerSubject.trim() || undefined;
    const exists = teacherClasses.some(
      (c) =>
        c.grade === pickerGrade &&
        c.section === pickerSection &&
        (c.subject || '') === (subjectVal || '')
    );
    if (exists) {
      onNotify(
        `${pickerGrade} (${pickerSection})${subjectVal ? ` · ${subjectVal}` : ''} is already assigned.`,
        'error'
      );
      return;
    }
    setOpenToAllClasses(false);
    setTeacherClasses((prev) => [
      ...prev,
      subjectVal
        ? { grade: pickerGrade, section: pickerSection, subject: subjectVal }
        : { grade: pickerGrade, section: pickerSection },
    ]);
    if (subjectVal && !teacherSubjects.includes(subjectVal)) {
      setTeacherSubjects((prev) => [...prev, subjectVal]);
    }
  }

  function toggleSubjectSelection(subject: string) {
    setSubjectsTouchedManually(true);
    setTeacherSubjects((prev) =>
      prev.includes(subject) ? prev.filter((s) => s !== subject) : [...prev, subject]
    );
  }

  function handleAddCustomSubject() {
    const trimmed = customSubjectInput.trim();
    if (!trimmed) return;
    const match = allSubjectChoices.find(
      (s) => s.toLowerCase() === trimmed.toLowerCase()
    );
    const canonical = match || trimmed;
    setSubjectsTouchedManually(true);
    if (!teacherSubjects.includes(canonical)) {
      setTeacherSubjects((prev) => [...prev, canonical]);
    }
    setPickerSubject(canonical);
    setCustomSubjectInput('');
  }

  async function handleSaveTeacher(e: React.FormEvent) {
    e.preventDefault();
    if (!teacherName.trim()) {
      onNotify('Enter the teacher full name.', 'error');
      return;
    }
    if (!teacherPhone.trim() || teacherPhone.trim().length < 7) {
      onNotify('Enter a valid contact phone number for the teacher.', 'error');
      return;
    }

    const finalClasses: TeacherClassAssignment[] = openToAllClasses
      ? []
      : teacherClasses.length > 0
      ? teacherClasses
      : [
          pickerSubject.trim()
            ? {
                grade: pickerGrade,
                section: pickerSection,
                subject: pickerSubject.trim(),
              }
            : { grade: pickerGrade, section: pickerSection },
        ];

    const finalSubjects = Array.from(
      new Set([
        ...teacherSubjects,
        ...finalClasses.map((c) => c.subject || '').filter(Boolean),
      ])
    );

    if (finalSubjects.length === 0) {
      onNotify('Select at least one subject that this teacher teaches.', 'error');
      return;
    }
    setTeacherSaving(true);
    try {
      if (editingTeacherId) {
        await saasApi.updateTeacher(tenant.id, editingTeacherId, {
          name: teacherName.trim(),
          phone: teacherPhone.trim(),
          email: teacherEmail.trim(),
          department: teacherDepartment.trim(),
          subjects: finalSubjects,
          assignedClasses: finalClasses,
        });
        onNotify(`Updated ${teacherName.trim()} (${teacherPhone.trim()}).`);
      } else {
        await saasApi.addTeacher(tenant.id, {
          name: teacherName.trim(),
          phone: teacherPhone.trim(),
          email: teacherEmail.trim(),
          department: teacherDepartment.trim(),
          subjects: finalSubjects,
          assignedClasses: finalClasses,
        });
        onNotify(
          `Added ${teacherName.trim()} (${finalSubjects.join(', ')}) for timetable generation.`
        );
      }
      await onRefresh();
      resetTeacherForm();
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to save teacher allocation',
        'error'
      );
    } finally {
      setTeacherSaving(false);
    }
  }

  async function handleDeleteTeacher(teacher: TeacherProfile) {
    setTeacherSaving(true);
    try {
      await saasApi.deleteTeacher(tenant.id, teacher.id);
      if (editingTeacherId === teacher.id) {
        resetTeacherForm();
      }
      await onRefresh();
      onNotify(`Removed ${teacher.name} from faculty allocation.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to remove teacher', 'error');
    } finally {
      setTeacherSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            School Timetable
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {lessonRows.length}-lesson daily schedule ({lessonRows[0]?.startTime || '08:00'} – {lessonRows[lessonRows.length - 1]?.endTime || '15:20'}), subject constraints & optional groups, teacher allocation, and clash-free generation.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isReadOnlyViewer && (
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
              <button
                onClick={() => setActiveTab('grid')}
                className={`whitespace-nowrap shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === 'grid'
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                Weekly Timetable
              </button>
              <button
                onClick={() => setActiveTab('lessons')}
                className={`whitespace-nowrap shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === 'lessons'
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                Lessons ({(tenant.timetableLessons ?? []).length})
              </button>
              <button
                onClick={() => setActiveTab('constraints')}
                className={`whitespace-nowrap shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === 'constraints'
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                Constraints
              </button>
              <button
                onClick={() => setActiveTab('teachers')}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === 'teachers'
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <Users className="h-3.5 w-3.5" />
                Teachers & Subjects ({tenant.teachers.length})
              </button>
            </div>
          )}

          {!isReadOnlyViewer && (
            <>
              <button
                onClick={() => openSubjectsEditor()}
                className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <BookOpen className="h-4 w-4" />
                Customize Subjects
              </button>

              <button
                onClick={() => setSolveOpen(true)}
                className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-emerald-700"
              >
                <Wand2 className="h-4 w-4" />
                Solve Timetable
              </button>

              <button
                onClick={() => setGenerateModalOpen(true)}
                className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border border-blue-200 bg-blue-50/80 px-3.5 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-800/70 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60"
              >
                <CalendarCog className="h-4 w-4" />
                Quick Generate
              </button>

              <button
                onClick={() => openCreateAt('Monday', 1)}
                className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                <Plus className="h-4 w-4" />
                Schedule Lesson
              </button>
            </>
          )}
        </div>
      </div>

      {!canEdit && currentRole !== 'Parent' && currentRole !== 'Student' && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-xs text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300">
          <span className="font-semibold">Read-Only Access:</span> Your account has view-only permissions for Timetable. Editing slots, customizing subjects, and running the solver are disabled.
        </div>
      )}

      {activeTab === 'grid' ? (
        <>
          {/* View Mode & Cohort Filter Toolbar */}
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
              {(
                [
                  { id: 'grade', label: 'By Grade & Stream' },
                  { id: 'teacher', label: 'By Teacher' },
                  { id: 'room', label: 'By Room' },
                ] as const
              ).map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => setViewMode(mode.id)}
                  className={`whitespace-nowrap shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    viewMode === mode.id
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {viewMode === 'grade' && (
                <>
                  <select
                    value={selectedGrade}
                    onChange={(e) => {
                      const nextGrade = e.target.value;
                      const nextStreams = getStreamsForGrade(tenant, nextGrade);
                      setSelectedGrade(nextGrade);
                      if (!nextStreams.includes(selectedSection)) {
                        setSelectedSection(nextStreams[0] || 'A');
                      }
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {tenant.grades.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                  <select
                    value={selectedSection}
                    onChange={(e) => setSelectedSection(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {activeToolbarStreams.map((sec) => (
                      <option key={sec} value={sec}>
                        Stream {sec}
                      </option>
                    ))}
                  </select>
                </>
              )}

              {viewMode === 'teacher' && (
                <select
                  value={selectedTeacherId}
                  onChange={(e) => setSelectedTeacherId(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  {tenant.teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.subjects.join(', ')})
                    </option>
                  ))}
                </select>
              )}

              {viewMode === 'room' && (
                <select
                  value={selectedRoom}
                  onChange={(e) => setSelectedRoom(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  {tenant.rooms.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Weekly Timetable Grid */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/70 px-4 py-2.5 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
              <span className="font-medium text-slate-700 dark:text-slate-300">
                {(tenant.dayOpeningNote !== undefined ? tenant.dayOpeningNote : DEFAULT_DAY_OPENING_NOTE) ||
                  `${lessonRows.length}-Period Daily Timetable`}
              </span>
              <span className="flex items-center gap-3">
                {!isReadOnlyViewer && (
                  <>
                    <button
                      onClick={() => setLocked(filteredSlots.map((x) => x.id), true)}
                      className="inline-flex items-center gap-1 font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                    >
                      <Lock className="h-3 w-3" /> Lock all
                    </button>
                    <button
                      onClick={() => setLocked(filteredSlots.map((x) => x.id), false)}
                      className="inline-flex items-center gap-1 font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                    >
                      <LockOpen className="h-3 w-3" /> Unlock all
                    </button>
                  </>
                )}
                <span className="font-mono tabular-nums">{filteredSlots.length} lessons scheduled</span>
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                    <th className="w-36 border-r border-slate-200 px-4 py-3 dark:border-slate-800">
                      Lesson & Time
                    </th>
                    {DAYS.map((day) => (
                      <th
                        key={day}
                        className="border-r border-slate-200 px-4 py-3 last:border-r-0 dark:border-slate-800"
                      >
                        {day}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {bellSchedule.map((row, rowIdx) => {
                    if (row.kind === 'break') {
                      return (
                        <tr
                          key={`break-${row.id || rowIdx}`}
                          className="bg-amber-50/50 dark:bg-amber-950/20"
                        >
                          <td className="border-r border-slate-200 px-4 py-2 dark:border-slate-800">
                            <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                              {row.label}
                            </p>
                            <p className="font-mono text-[11px] text-amber-700/80 tabular-nums dark:text-amber-400/80">
                              {row.time}
                            </p>
                          </td>
                          <td
                            colSpan={5}
                            className="px-4 py-2 text-center text-xs font-medium tracking-wide text-amber-800/80 uppercase dark:text-amber-300/80"
                          >
                            {row.label} · {row.time}
                          </td>
                        </tr>
                      );
                    }

                    const period = row.period as number;
                    return (
                      <tr key={`lesson-${period}`}>
                        <td className="border-r border-slate-200 bg-slate-50/40 px-4 py-3 align-top dark:border-slate-800 dark:bg-slate-900/30">
                          <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                            {row.label}
                          </p>
                          <p className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                            {row.time}
                          </p>
                        </td>
                        {DAYS.map((day) => {
                          const cellSlots = filteredSlots.filter(
                            (s) => s.day === day && s.period === period
                          );
                          const hasOptionalInCell =
                            viewMode === 'grade' &&
                            cellSlots.some((s) =>
                              Boolean(findOptionalGroupForSubject(tenant, s.grade, s.subject))
                            );
                          return (
                            <td
                              key={day}
                              className="border-r border-slate-200 p-2 align-top last:border-r-0 dark:border-slate-800"
                            >
                              {cellSlots.length > 0 ? (
                                <div className="space-y-1.5">
                                  {cellSlots.map((slot) => {
                                    const optGroup = findOptionalGroupForSubject(
                                      tenant,
                                      slot.grade,
                                      slot.subject
                                    );
                                    return (
                                      <div key={slot.id} className="relative">
                                        <button
                                          type="button"
                                          disabled={isReadOnlyViewer}
                                          onClick={() => {
                                            if (!isReadOnlyViewer) openEdit(slot);
                                          }}
                                          className={`w-full rounded-lg border p-2.5 text-left transition-colors ${
                                            optGroup
                                              ? 'border-emerald-200 bg-emerald-50/50 hover:border-emerald-400 dark:border-emerald-900/60 dark:bg-emerald-950/25 dark:hover:border-emerald-600'
                                              : 'border-slate-200 bg-slate-50/80 hover:border-blue-400 hover:bg-blue-50/50 dark:border-slate-700/80 dark:bg-slate-800/70 dark:hover:border-blue-500 dark:hover:bg-slate-800'
                                          } disabled:cursor-default`}
                                        >
                                          <p className="truncate pr-5 text-xs font-semibold text-slate-900 dark:text-slate-100">
                                            {slot.subject}
                                          </p>
                                          <p className="mt-1 truncate text-[11px] text-slate-600 dark:text-slate-400">
                                            {viewMode === 'grade'
                                              ? slot.teacherName
                                              : `${slot.grade} · Stream ${slot.section}`}
                                          </p>
                                          <div className="mt-0.5 flex items-center justify-between gap-1">
                                            <span className="truncate font-mono text-[11px] text-blue-700 dark:text-blue-400">
                                              {slot.room}
                                            </span>
                                            {optGroup && (
                                              <span className="shrink-0 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                                                {optGroup.name}
                                              </span>
                                            )}
                                          </div>
                                        </button>
                                        {!isReadOnlyViewer && (
                                          <button
                                            onClick={() => setLocked([slot.id], !slot.locked)}
                                            aria-label={slot.locked ? 'Unlock lesson' : 'Lock lesson in place'}
                                            title={slot.locked ? 'Locked: the solver will not move this lesson' : 'Lock this lesson in place'}
                                            className={`absolute top-1.5 right-1.5 rounded p-1 ${
                                              slot.locked
                                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'
                                                : 'text-slate-300 hover:bg-slate-200 hover:text-slate-600 dark:text-slate-600 dark:hover:bg-slate-700'
                                            }`}
                                          >
                                            {slot.locked ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}
                                          </button>
                                        )}
                                      </div>
                                    );
                                  })}
                                  {!isReadOnlyViewer && hasOptionalInCell && (
                                    <button
                                      type="button"
                                      onClick={() => openCreateAt(day, period)}
                                      className="w-full rounded border border-dashed border-emerald-300/70 py-1 text-[10px] font-medium text-emerald-700 hover:bg-emerald-50/70 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
                                    >
                                      + Add Parallel Option
                                    </button>
                                  )}
                                </div>
                              ) : isReadOnlyViewer ? (
                                <div className="flex h-14 w-full items-center justify-center text-xs text-slate-300 dark:text-slate-700">
                                  —
                                </div>
                              ) : (
                                <button
                                  onClick={() => openCreateAt(day, period)}
                                  className="flex h-16 w-full items-center justify-center rounded-lg border border-dashed border-transparent text-xs text-slate-400 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-600 dark:hover:border-slate-700 dark:hover:bg-slate-800/40 dark:hover:text-slate-300"
                                >
                                  + Assign
                                </button>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {(tenant.dayClosingNote !== undefined ? tenant.dayClosingNote : DEFAULT_DAY_CLOSING_NOTE) && (
              <div className="border-t border-slate-200 bg-slate-50/70 px-4 py-2.5 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                {tenant.dayClosingNote !== undefined ? tenant.dayClosingNote : DEFAULT_DAY_CLOSING_NOTE}
              </div>
            )}
          </div>
        </>
      ) : activeTab === 'lessons' ? (
        <LessonCardsPanel workspace={workspace} onRefresh={onRefresh} onNotify={onNotify} />
      ) : activeTab === 'constraints' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1.5 dark:border-slate-800 dark:bg-slate-900">
            {(
              [
                { id: 'subjects', label: 'Subject Rules & Optional Groups' },
                { id: 'schedule', label: 'School Day Schedule & Bell Times' },
                { id: 'teachers', label: 'Teacher Availability & Daily Caps' },
              ] as const
            ).map((sub) => (
              <button
                key={sub.id}
                type="button"
                onClick={() => setConstraintSection(sub.id)}
                className={`rounded-lg px-3.5 py-2 text-xs font-medium transition-colors ${
                  constraintSection === sub.id
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'
                }`}
              >
                {sub.label}
              </button>
            ))}
          </div>

          {constraintSection === 'subjects' ? (
            <SubjectConstraintsPanel workspace={workspace} onRefresh={onRefresh} onNotify={onNotify} />
          ) : constraintSection === 'schedule' ? (
            <DaySchedulePanel workspace={workspace} onRefresh={onRefresh} onNotify={onNotify} />
          ) : (
            <TeacherAvailabilityPanel workspace={workspace} onRefresh={onRefresh} onNotify={onNotify} />
          )}
        </div>
      ) : (
        /* Teachers, Contacts, Class & Subject Allocation Section */
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Add / Edit Teacher Form */}
          <form
            onSubmit={handleSaveTeacher}
            className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-5 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  {editingTeacherId ? 'Edit Teacher Allocation' : 'Add Teacher, Classes & Subjects'}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Assign teacher contact details, the Grades & Streams they handle, and their CBC subjects.
                </p>
              </div>
              {editingTeacherId && (
                <button
                  type="button"
                  onClick={resetTeacherForm}
                  className="text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  Cancel Edit
                </button>
              )}
            </div>

            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Teacher Full Name
                  </label>
                  <input
                    required
                    type="text"
                    value={teacherName}
                    onChange={(e) => setTeacherName(e.target.value)}
                    placeholder="e.g. Mr. Daniel Kiprop"
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Department
                  </label>
                  <input
                    type="text"
                    value={teacherDepartment}
                    onChange={(e) => setTeacherDepartment(e.target.value)}
                    placeholder="e.g. Sciences"
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              {/* Contacts: Phone + Email */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Contact Phone No.
                  </label>
                  <input
                    required
                    type="tel"
                    value={teacherPhone}
                    onChange={(e) => setTeacherPhone(e.target.value)}
                    placeholder="+254 712 345 678"
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Email (optional)
                  </label>
                  <input
                    type="email"
                    value={teacherEmail}
                    onChange={(e) => setTeacherEmail(e.target.value)}
                    placeholder="Auto if blank"
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              {/* Grades, Streams & Subject Handled */}
              <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-900/50">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Grades & Stream Handled
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setTeacherClasses([]);
                      setOpenToAllClasses(true);
                    }}
                    className={`text-[11px] font-medium ${
                      openToAllClasses
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    {openToAllClasses ? 'All Grades & Streams Active' : 'Set to All Grades'}
                  </button>
                </div>

                {/* Ordered Dropdowns: 1. Grade -> 2. Stream -> 3. Subject Taught */}
                <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                      Grade
                    </label>
                    <select
                      aria-label="Grade"
                      value={pickerGrade}
                      onChange={(e) => {
                        const nextG = e.target.value;
                        const nextStreams = getStreamsForGrade(tenant, nextG);
                        const nextLevelSubs = getSubjectsForGrade(tenant, nextG);
                        setPickerGrade(nextG);
                        setOpenToAllClasses(false);
                        if (pickerSection !== 'All Streams' && !nextStreams.includes(pickerSection)) {
                          setPickerSection(nextStreams[0] || 'A');
                        }
                        if (isSingleTeacherGrade(nextG)) {
                          setPickerSubject(CLASS_TEACHER_SUBJECT_TOKEN);
                        } else if (
                          pickerSubject === CLASS_TEACHER_SUBJECT_TOKEN ||
                          !nextLevelSubs.includes(pickerSubject)
                        ) {
                          setPickerSubject(nextLevelSubs[0] || tenant.subjects[0] || '');
                        }
                      }}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    >
                      {tenant.grades.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                      Stream
                    </label>
                    <select
                      aria-label="Stream"
                      value={pickerSection}
                      onChange={(e) => {
                        setPickerSection(e.target.value);
                        setOpenToAllClasses(false);
                      }}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    >
                      <option value="All Streams">All Streams</option>
                      {activePickerStreams.map((sec) => (
                        <option key={sec} value={sec}>
                          Stream {sec}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                      Subject Taught
                    </label>
                    <select
                      aria-label="Subject Taught"
                      value={pickerSubject}
                      onChange={(e) => {
                        setOpenToAllClasses(false);
                        handlePickerSubjectChange(e.target.value);
                      }}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    >
                      {pickerIsSingleTeacher && (
                        <option value={CLASS_TEACHER_SUBJECT_TOKEN}>
                          All Subjects (Class Teacher)
                        </option>
                      )}
                      <optgroup label={`${pickerCluster.label} (${pickerCluster.rangeLabel})`}>
                        {pickerLevelSubjects.map((sub) => (
                          <option key={sub} value={sub}>
                            {sub}
                          </option>
                        ))}
                      </optgroup>
                      {allSubjectChoices.some((s) => !pickerLevelSubjects.includes(s)) && (
                        <optgroup label="Other School Subjects">
                          {allSubjectChoices
                            .filter((s) => !pickerLevelSubjects.includes(s))
                            .map((sub) => (
                              <option key={sub} value={sub}>
                                {sub}
                              </option>
                            ))}
                        </optgroup>
                      )}
                    </select>
                  </div>
                </div>

                {pickerIsSingleTeacher && (
                  <p className="mt-2 text-[11px] font-medium text-blue-700 dark:text-blue-400">
                    Pre-School (Playgroup–PP2) & Lower Primary (Grade 1–3): 1 class teacher handles all subjects for the assigned stream.
                  </p>
                )}

                <div className="mt-2.5 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    {openToAllClasses
                      ? 'Open to all grades & streams during timetable generation.'
                      : teacherClasses.length === 0
                      ? `Selected: ${pickerGrade} · ${
                          pickerSection === 'All Streams' ? 'All Streams' : `Stream ${pickerSection}`
                        }${pickerSubject ? ` · ${pickerSubject}` : ''}`
                      : `${teacherClasses.length} class & subject allocation(s) added`}
                  </span>
                  <button
                    type="button"
                    onClick={handleAddClassToTeacher}
                    className="whitespace-nowrap shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    + Assign Another
                  </button>
                </div>

                {teacherClasses.length > 0 && (
                  <div className="mt-2.5 space-y-1.5">
                    {teacherClasses.map((cls, idx) => (
                      <div
                        key={`${cls.grade}-${cls.section}-${cls.subject || ''}-${idx}`}
                        className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"
                      >
                        <span className="font-medium text-slate-800 dark:text-slate-200">
                          {cls.grade} ·{' '}
                          {cls.section === 'All Streams' ? 'All Streams' : `Stream ${cls.section}`}
                          {cls.subject ? ` · ${cls.subject}` : ''}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setTeacherClasses((prev) => prev.filter((_, i) => i !== idx))
                          }
                          aria-label="Remove class assignment"
                          className="text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Subjects Taught */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Subjects Taught ({teacherSubjects.length} selected)
                  </label>
                  <button
                    type="button"
                    onClick={() => openSubjectsEditor(pickerCluster.id)}
                    className="text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Customize {pickerCluster.label} Subjects
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {allSubjectChoices.map((sub) => {
                    const checked = teacherSubjects.includes(sub);
                    return (
                      <button
                        key={sub}
                        type="button"
                        onClick={() => toggleSubjectSelection(sub)}
                        className={`flex items-center justify-between rounded-lg border px-2.5 py-2 text-left text-xs font-medium transition-colors ${
                          checked
                            ? 'border-blue-600 bg-blue-50 text-blue-800 dark:border-blue-500 dark:bg-blue-950/50 dark:text-blue-300'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700/60'
                        }`}
                      >
                        <span className="truncate pr-2">{sub}</span>
                        {checked && <Check className="h-3.5 w-3.5 shrink-0" />}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-3 flex gap-2">
                  <input
                    type="text"
                    value={customSubjectInput}
                    onChange={(e) => setCustomSubjectInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddCustomSubject();
                      }
                    }}
                    placeholder="Quick add custom subject (e.g. French, Music)"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={handleAddCustomSubject}
                    className="shrink-0 whitespace-nowrap rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    + Subject
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={teacherSaving}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                {teacherSaving
                  ? 'Saving...'
                  : editingTeacherId
                  ? 'Update Teacher Allocation'
                  : 'Add Teacher & Assign Classes'}
              </button>
            </div>
          </form>

          {/* Faculty List + Subject Coverage Table */}
          <div className="space-y-6 lg:col-span-7">
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
                <div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    Teaching Staff, Contacts & Class Allocations
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    The timetable generator pulls teachers automatically based on their assigned classes and subjects.
                  </p>
                </div>
                <button
                  onClick={() => setGenerateModalOpen(true)}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
                >
                  <CalendarCog className="h-3.5 w-3.5" />
                  Generate Now
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Teacher</th>
                      <th className="px-4 py-3">Contacts</th>
                      <th className="px-4 py-3">Grade & Stream</th>
                      <th className="px-4 py-3">Subjects Taught</th>
                      <th className="px-4 py-3 text-right">Lessons</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {tenant.teachers.map((t) => {
                      const load = teacherWeeklyLoad.get(t.id) || 0;
                      const classes = t.assignedClasses || [];
                      return (
                        <tr key={t.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                          <td className="px-4 py-3 align-top">
                            <p className="font-medium text-slate-900 dark:text-slate-100">
                              {t.name}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {t.department}
                            </p>
                          </td>
                          <td className="px-4 py-3 align-top text-xs">
                            <p className="font-mono text-slate-800 tabular-nums dark:text-slate-200">
                              {t.phone || '—'}
                            </p>
                            <p className="mt-0.5 text-slate-500 dark:text-slate-400">
                              {t.email}
                            </p>
                          </td>
                          <td className="px-4 py-3 align-top text-xs text-slate-700 dark:text-slate-300">
                            {classes.length > 0
                              ? classes
                                  .map((c) => {
                                    const base =
                                      c.section === 'All Streams'
                                        ? `${c.grade} (All Streams)`
                                        : `${c.grade} · Stream ${c.section}`;
                                    return c.subject ? `${base} [${c.subject}]` : base;
                                  })
                                  .join(', ')
                              : 'All Grades & Streams'}
                          </td>
                          <td className="px-4 py-3 align-top text-xs text-slate-700 dark:text-slate-300">
                            {t.subjects.length > 0 ? t.subjects.join(', ') : 'Unassigned'}
                          </td>
                          <td className="px-4 py-3 align-top text-right font-mono text-xs text-slate-700 tabular-nums dark:text-slate-300">
                            {load}
                          </td>
                          <td className="px-4 py-3 align-top text-right">
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => startEditTeacher(t)}
                                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                              >
                                <Pencil className="h-3 w-3" />
                                Edit
                              </button>
                              <button
                                type="button"
                                disabled={tenant.teachers.length <= 1 || teacherSaving}
                                onClick={() => handleDeleteTeacher(t)}
                                aria-label={`Remove ${t.name}`}
                                className="text-slate-400 hover:text-red-600 disabled:opacity-30 dark:hover:text-red-400"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Kenyan CBC Curriculum Subjects & Coverage Readiness by Level */}
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Kenyan CBC Curriculum Subjects & Coverage ({coverageCluster.label})
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {coverageCluster.singleClassTeacher
                      ? `${coverageCluster.rangeLabel}: ${subjectCoverage.length} KICD learning areas (${totalConfiguredLessons} lessons/wk) · 1 class teacher handles all subjects per stream.`
                      : uncoveredSubjects.length === 0
                      ? `${coverageCluster.rangeLabel}: All ${subjectCoverage.length} learning areas (${totalConfiguredLessons} lessons/wk) have assigned teachers.`
                      : `${uncoveredSubjects.length} subject(s) in ${coverageCluster.label} still need a teacher assigned before generation.`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openSubjectsEditor(coverageLevel)}
                  className="whitespace-nowrap shrink-0 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                >
                  Edit {coverageCluster.label} Subjects
                </button>
              </div>
              <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50/70 px-4 py-2 dark:border-slate-800 dark:bg-slate-900/50">
                {KENYAN_CBC_CLUSTERS.map((cluster) => (
                  <button
                    key={cluster.id}
                    type="button"
                    onClick={() => setCoverageLevel(cluster.id)}
                    className={`whitespace-nowrap shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      coverageLevel === cluster.id
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    {cluster.label}
                  </button>
                ))}
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {subjectCoverage.map((row) => (
                  <div
                    key={row.subject}
                    className="flex items-center justify-between gap-3 px-5 py-2.5 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {row.subject}
                      </span>
                      <span className="font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                        ({row.lessonsPerWeek} lessons/wk)
                      </span>
                    </div>
                    <span
                      className={
                        coverageCluster.singleClassTeacher || row.teachers.length > 0
                          ? 'text-slate-600 dark:text-slate-400'
                          : 'font-medium text-amber-700 dark:text-amber-400'
                      }
                    >
                      {coverageCluster.singleClassTeacher
                        ? 'Class Teacher (All Subjects)'
                        : row.teachers.length > 0
                        ? row.teachers.map((t) => t.name).join(', ')
                        : 'No teacher assigned'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Full Subject Customization Modal (Per CBC Level) */}
      {subjectsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  Customize Kenyan Curriculum Subjects & Weekly Lessons
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Configure KICD learning areas and weekly lesson counts independently for each CBC & Senior School level.
                </p>
              </div>
              <button
                onClick={() => setSubjectsModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* CBC Level Selector Tabs */}
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/70 px-6 py-2.5 dark:border-slate-800 dark:bg-slate-900/50">
              <div className="flex items-center gap-1 overflow-x-auto">
                {KENYAN_CBC_CLUSTERS.map((cluster) => {
                  const isActive = editingLevel === cluster.id;
                  const isDirty = dirtyLevels.includes(cluster.id);
                  return (
                    <button
                      key={cluster.id}
                      type="button"
                      onClick={() => setEditingLevel(cluster.id)}
                      className={`whitespace-nowrap shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        isActive
                          ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                          : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                      }`}
                    >
                      {cluster.label}
                      {isDirty ? ' *' : ''}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={handleResetLevelToKicdDefault}
                className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <RotateCcw className="h-3 w-3" />
                KICD Default
              </button>
            </div>

            <form onSubmit={handleSaveSubjectsCatalog} className="flex min-h-0 flex-1 flex-col">
              <div className="border-b border-slate-100 bg-slate-50/40 px-6 py-3 dark:border-slate-800 dark:bg-slate-900/30">
                <div className="flex flex-wrap gap-2 sm:flex-nowrap">
                  <input
                    type="text"
                    value={newCatalogSubject}
                    onChange={(e) => setNewCatalogSubject(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddCatalogSubject();
                      }
                    }}
                    placeholder={`Add subject to ${KENYAN_CBC_CLUSTERS.find((c) => c.id === editingLevel)?.label || 'level'} (e.g. French, German)`}
                    className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                  <select
                    aria-label="New subject lessons per week"
                    value={newCatalogLessons}
                    onChange={(e) => setNewCatalogLessons(Number(e.target.value))}
                    className="w-36 shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono text-xs text-slate-800 tabular-nums dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                      <option key={n} value={n}>
                        {n === 0 ? '0 (Optional)' : `${n} lesson${n === 1 ? '' : 's'}/wk`}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleAddCatalogSubject}
                    className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add
                  </button>
                </div>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto px-6 py-4">
                <div className="flex items-center justify-between px-1 pb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
                  <span>
                    {KENYAN_CBC_CLUSTERS.find((c) => c.id === editingLevel)?.label} (
                    {KENYAN_CBC_CLUSTERS.find((c) => c.id === editingLevel)?.rangeLabel})
                  </span>
                  <span className="pr-10">Lessons / Week</span>
                </div>
                {subjectRows.map((row, idx) => (
                  <div key={`${editingLevel}-${idx}`} className="flex items-center gap-2">
                    <input
                      type="text"
                      required
                      value={row.value}
                      onChange={(e) =>
                        updateActiveLevelRows((prev) =>
                          prev.map((item, i) =>
                            i === idx ? { ...item, value: e.target.value } : item
                          )
                        )
                      }
                      aria-label={`Subject ${idx + 1}`}
                      className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                    <select
                      aria-label={`Lessons per week for ${row.value || `Subject ${idx + 1}`}`}
                      value={row.lessonsPerWeek}
                      onChange={(e) => {
                        const count = Number(e.target.value);
                        updateActiveLevelRows((prev) =>
                          prev.map((item, i) =>
                            i === idx ? { ...item, lessonsPerWeek: count } : item
                          )
                        );
                      }}
                      className="w-36 shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono text-xs text-slate-800 tabular-nums dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    >
                      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                        <option key={n} value={n}>
                          {n === 0 ? '0 (Exclude)' : `${n} lesson${n === 1 ? '' : 's'}/wk`}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={subjectRows.length <= 1}
                      onClick={() =>
                        updateActiveLevelRows((prev) => prev.filter((_, i) => i !== idx))
                      }
                      aria-label="Remove subject"
                      className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:border-red-200 hover:text-red-600 disabled:opacity-30 dark:border-slate-700 dark:text-slate-400 dark:hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
                <div>
                  <span className="font-mono text-xs text-slate-700 tabular-nums dark:text-slate-300">
                    {subjectRows.length} subjects · {modalTotalSubjectLessons} lessons/week
                  </span>
                  {modalTotalSubjectLessons > weeklySlotsCap && (
                    <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                      Exceeds {weeklySlotsCap} weekly timetable periods; first {weeklySlotsCap} interleaved lessons will fit (optional groups run in parallel).
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSubjectsModalOpen(false)}
                    className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={subjectsSaving}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {subjectsSaving ? 'Saving...' : 'Save Subjects'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Generate Timetable Modal */}
      {solveOpen && (
        <SolveDialog
          workspace={workspace}
          onClose={() => setSolveOpen(false)}
          onRefresh={onRefresh}
          onNotify={onNotify}
        />
      )}

      {generateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  Generate School Timetable
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Select CBC clusters, custom grades, or a specific stream. Pre-School & Lower Primary automatically assign 1 teacher for all subjects per stream.
                </p>
              </div>
              <button
                onClick={() => setGenerateModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {genIncludesSpecialistGrades && genUncoveredSubjects.length > 0 && (
              <div className="mt-4 flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                <div>
                  <p className="font-semibold">Unassigned Subjects Will Be Skipped (Grade 4–12):</p>
                  <p className="mt-0.5">{genUncoveredSubjects.join(', ')}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setGenerateModalOpen(false);
                    setActiveTab('teachers');
                  }}
                  className="shrink-0 font-medium underline"
                >
                  Assign Teachers
                </button>
              </div>
            )}

            <form onSubmit={handleGenerateTimetable} className="mt-4 space-y-4 overflow-y-auto pr-1">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Generation Scope
                </label>
                <select
                  value={genScope}
                  onChange={(e) =>
                    setGenScope(
                      e.target.value as 'cohort' | 'grade' | 'cluster' | 'school'
                    )
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="cluster">
                    CBC Cluster(s) & Custom Grade Selection
                  </option>
                  <option value="cohort">
                    Single Stream ({selectedGrade} · Stream {selectedSection})
                  </option>
                  <option value="grade">
                    All Streams in {selectedGrade} ({getStreamsForGrade(tenant, selectedGrade).join(', ')})
                  </option>
                  <option value="school">
                    Entire School ({tenant.grades.length} Grades across all Streams)
                  </option>
                </select>
              </div>

              {genScope === 'cluster' && (
                <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-900/50">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                        CBC Clusters
                      </span>
                      <div className="flex items-center gap-3 text-[11px] font-medium">
                        <button
                          type="button"
                          onClick={() => setGenSelectedGrades([...tenant.grades])}
                          className="text-blue-600 hover:underline dark:text-blue-400"
                        >
                          Select All
                        </button>
                        <button
                          type="button"
                          onClick={() => setGenSelectedGrades([])}
                          className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {KENYAN_CBC_CLUSTERS.map((cluster) => {
                        const available = tenant.grades.filter((g) =>
                          cluster.grades.some((cg) => cg.toLowerCase() === g.toLowerCase())
                        );
                        if (available.length === 0) return null;
                        const allChecked = available.every((g) =>
                          genSelectedGrades.includes(g)
                        );
                        const someChecked =
                          !allChecked &&
                          available.some((g) => genSelectedGrades.includes(g));
                        return (
                          <button
                            key={cluster.id}
                            type="button"
                            onClick={() => toggleClusterGrades(cluster)}
                            className={`flex items-start justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                              allChecked
                                ? 'border-blue-600 bg-blue-50/80 text-blue-900 dark:border-blue-500 dark:bg-blue-950/50 dark:text-blue-200'
                                : someChecked
                                ? 'border-blue-300 bg-blue-50/40 text-slate-800 dark:border-blue-800 dark:bg-blue-950/20 dark:text-slate-200'
                                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            <div>
                              <p className="text-xs font-semibold">
                                {cluster.label}{' '}
                                <span className="font-normal text-slate-500 dark:text-slate-400">
                                  ({cluster.rangeLabel})
                                </span>
                              </p>
                              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                {cluster.singleClassTeacher
                                  ? '1 class teacher · all subjects'
                                  : 'Subject specialist teachers'}
                              </p>
                            </div>
                            <span
                              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                                allChecked
                                  ? 'border-blue-600 bg-blue-600 text-white'
                                  : someChecked
                                  ? 'border-blue-500 bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200'
                                  : 'border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900'
                              }`}
                            >
                              {allChecked ? '✓' : someChecked ? '–' : ''}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                        Custom Grades
                      </span>
                      <span className="font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                        {genTargetGrades.length} grade(s) · {genTargetStreamCount} stream(s)
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                      {tenant.grades.map((g) => {
                        const checked = genSelectedGrades.includes(g);
                        return (
                          <button
                            key={g}
                            type="button"
                            onClick={() => toggleCustomGrade(g)}
                            className={`flex items-center justify-between rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                              checked
                                ? 'border-blue-600 bg-blue-50 text-blue-800 dark:border-blue-500 dark:bg-blue-950/50 dark:text-blue-300'
                                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            <span className="truncate">{g}</span>
                            {checked && <Check className="h-3 w-3 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {genIncludesSingleTeacherGrades && (
                <div className="rounded-lg border border-blue-200 bg-blue-50/70 px-3 py-2.5 text-xs text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200">
                  <span className="font-semibold">Class-Teacher Rule Active:</span> Pre-School (Playgroup–PP2) and Lower Primary (Grade 1–3) streams assign <span className="font-semibold">1 class teacher</span> to handle all subjects per stream.
                </div>
              )}

              <div>
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Weekly Lessons per Stream (Max {weeklySlotsCap})
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const firstCluster =
                        genTargetGrades.length > 0
                          ? getClusterForGrade(genTargetGrades[0])
                          : undefined;
                      setGenerateModalOpen(false);
                      openSubjectsEditor(firstCluster);
                    }}
                    className="text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Edit Subject Lesson Counts
                  </button>
                </div>
                <select
                  value={genLessonsPerCohort}
                  onChange={(e) => setGenLessonsPerCohort(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm tabular-nums dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value={0}>
                    Use Configured Level Subject Counts ({genLevelLessonsLabel})
                  </option>
                  <option value={25}>25 lessons / week cap (Early Years Playgroup–PP2)</option>
                  <option value={29}>29 lessons / week cap (Lower Primary Grade 1–3)</option>
                  <option value={34}>34 lessons / week cap (Upper Primary Grade 4–6)</option>
                  <option value={39}>39 lessons / week cap (Junior School Grade 7–9)</option>
                  <option value={weeklySlotsCap}>{weeklySlotsCap} lessons / week cap (Full {lessonRows.length}-Lesson Week)</option>
                </select>
              </div>

              <label className="flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={genReplaceExisting}
                  onChange={(e) => setGenReplaceExisting(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                Replace existing timetable lessons inside the selected scope
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setGenerateModalOpen(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={generating || (genScope === 'cluster' && genTargetGrades.length === 0)}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {generating
                    ? 'Generating...'
                    : `Run Generator (${genTargetStreamCount} Stream${genTargetStreamCount === 1 ? '' : 's'})`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create / Edit Single Lesson Slot Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                {editingSlotId ? 'Edit Scheduled Lesson' : 'Schedule Timetable Lesson'}
              </h2>
              <button
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {liveConflict && (
              <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{liveConflict}</span>
              </div>
            )}

            <form onSubmit={handleSaveSlot} className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Day
                </label>
                <select
                  value={slotForm.day}
                  onChange={(e) => setSlotForm({ ...slotForm, day: e.target.value as DayOfWeek })}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  {DAYS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Lesson Slot
                </label>
                <select
                  value={slotForm.period}
                  onChange={(e) => setSlotForm({ ...slotForm, period: Number(e.target.value) })}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  {lessonRows.map((row) => (
                    <option key={row.period} value={row.period}>
                      {row.label} ({row.time})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Grade
                </label>
                <select
                  value={slotForm.grade}
                  onChange={(e) => {
                    const nextGrade = e.target.value;
                    const nextStreams = getStreamsForGrade(tenant, nextGrade);
                    const nextLevelSubs = getSubjectsForGrade(tenant, nextGrade);
                    const nextSubject = nextLevelSubs.includes(slotForm.subject)
                      ? slotForm.subject
                      : nextLevelSubs[0] || slotForm.subject;
                    setSlotForm({
                      ...slotForm,
                      grade: nextGrade,
                      section: nextStreams.includes(slotForm.section)
                        ? slotForm.section
                        : nextStreams[0] || 'A',
                      subject: nextSubject,
                    });
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  {tenant.grades.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Stream
                </label>
                <select
                  value={slotForm.section}
                  onChange={(e) => setSlotForm({ ...slotForm, section: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  {activeModalStreams.map((s) => (
                    <option key={s} value={s}>
                      Stream {s}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Subject ({slotCluster.label})
                </label>
                <select
                  value={slotForm.subject}
                  onChange={(e) => {
                    const nextSubject = e.target.value;
                    const matchedTeacher = tenant.teachers.find((t) =>
                      t.subjects.some((ts) => ts.toLowerCase() === nextSubject.toLowerCase())
                    );
                    setSlotForm({
                      ...slotForm,
                      subject: nextSubject,
                      teacherId: matchedTeacher ? matchedTeacher.id : slotForm.teacherId,
                    });
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <optgroup label={`${slotCluster.label} (${slotCluster.rangeLabel})`}>
                    {slotLevelSubjects.map((sub) => (
                      <option key={sub} value={sub}>
                        {sub}
                      </option>
                    ))}
                  </optgroup>
                  {tenant.subjects.some((s) => !slotLevelSubjects.includes(s)) && (
                    <optgroup label="Other School Subjects">
                      {tenant.subjects
                        .filter((s) => !slotLevelSubjects.includes(s))
                        .map((sub) => (
                          <option key={sub} value={sub}>
                            {sub}
                          </option>
                        ))}
                    </optgroup>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Subject Teacher
                </label>
                <select
                  value={slotForm.teacherId}
                  onChange={(e) => setSlotForm({ ...slotForm, teacherId: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  {qualifiedTeachersForModalSubject.length > 0 && (
                    <optgroup label={`Qualified for ${slotForm.subject}`}>
                      {qualifiedTeachersForModalSubject.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="All Teaching Staff">
                    {tenant.teachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.subjects.join(', ')})
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Room / Laboratory
                </label>
                <select
                  value={slotForm.room}
                  onChange={(e) => setSlotForm({ ...slotForm, room: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  {tenant.rooms.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-span-2 flex items-center justify-between pt-3">
                {editingSlotId ? (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => handleDeleteSlot(editingSlotId)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/30"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove Lesson
                  </button>
                ) : (
                  <span />
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving || Boolean(liveConflict)}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : editingSlotId ? 'Update Lesson' : 'Save Lesson'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
