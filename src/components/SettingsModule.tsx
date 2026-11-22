import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  Copy,
  GraduationCap,
  KeyRound,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { saasApi } from '../lib/api';
import {
  ALL_TENANT_MODULES,
  getDefaultModulesForTenantRole,
  getEffectiveUserModules,
  KENYAN_CBC_GRADES,
  KENYAN_CBC_SUBJECTS,
  suggestNameEmailLocalPart,
  type AcademicTerm,
  type CurrencyCode,
  type CustomRoleDefinition,
  type TenantModulePermission,
  type TenantUser,
  type TenantWorkspaceData,
  type UserRole,
} from '../shared/types';

interface SettingsModuleProps {
  workspace: TenantWorkspaceData;
  currentRole: UserRole;
  currentUserId?: string;
  onRefresh: () => Promise<void>;
  onSwitchTenant: (tenantId: string) => void;
  onNotify: (title: string, tone?: 'success' | 'error') => void;
}

const STAFF_ROLE_OPTIONS: UserRole[] = [
  'Super Admin',
  'Admin',
  'Registrar',
  'Teacher',
  'Bursar',
  'Parent',
];

const CUSTOMIZABLE_BUILTIN_ROLES: UserRole[] = [
  'Admin',
  'Registrar',
  'Teacher',
  'Bursar',
  'Parent',
  'Super Admin',
];

function inferSuggestedRoleForNonTeaching(designation: string): UserRole {
  const norm = designation.toLowerCase();
  if (/(bursar|account|finance|cashier|treasurer)/i.test(norm)) return 'Bursar';
  if (/(principal|head|director|admin|deputy)/i.test(norm)) return 'Admin';
  if (/(registrar|secretary|admission|clerk|front office)/i.test(norm)) return 'Registrar';
  return 'Registrar';
}

function encodeRoleChoice(role: UserRole, customRoleId?: string): string {
  return customRoleId ? `custom:${customRoleId}` : role;
}

export function SettingsModule({
  workspace,
  currentRole,
  currentUserId,
  onRefresh,
  onSwitchTenant,
  onNotify,
}: SettingsModuleProps) {
  const { tenant } = workspace;
  const canMutateTenant =
    currentRole === 'Admin' || currentRole === 'Super Admin' || currentRole === 'Developer';
  const isDeveloper = currentRole === 'Developer';
  const domainSuffix = tenant.emailDomain || `${tenant.slug}.ac.ke`;

  const customRoles: CustomRoleDefinition[] = useMemo(
    () => tenant.customRoles || [],
    [tenant.customRoles]
  );

  const [tenantUsers, setTenantUsers] = useState<TenantUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [selectedStaffKey, setSelectedStaffKey] = useState<string>('__manual__');
  const [staffFullName, setStaffFullName] = useState('');
  const [staffEmailHandle, setStaffEmailHandle] = useState('');
  const [staffHandleEdited, setStaffHandleEdited] = useState(false);
  const [staffPhone, setStaffPhone] = useState('');
  const [staffRole, setStaffRole] = useState<UserRole>('Teacher');
  const [staffCustomRoleId, setStaffCustomRoleId] = useState<string>('');
  const [staffModules, setStaffModules] = useState<TenantModulePermission[]>(() =>
    getDefaultModulesForTenantRole(tenant, 'Teacher')
  );
  const [creatingStaff, setCreatingStaff] = useState(false);
  const [issuedStaffOtp, setIssuedStaffOtp] = useState<{
    fullName: string;
    email: string;
    role: string;
    oneTimePassword: string;
  } | null>(null);
  const [copiedStaffOtp, setCopiedStaffOtp] = useState(false);

  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<UserRole>('Teacher');
  const [editCustomRoleId, setEditCustomRoleId] = useState<string>('');
  const [editModules, setEditModules] = useState<TenantModulePermission[]>([]);
  const [editStatus, setEditStatus] = useState<'Active' | 'Disabled'>('Active');
  const [savingUserAccess, setSavingUserAccess] = useState(false);

  // Role & Permissions customization panel state
  const [showManageRoles, setShowManageRoles] = useState(false);
  const [roleEditorMode, setRoleEditorMode] = useState<'custom' | 'builtin'>('custom');
  const [editingCustomRoleId, setEditingCustomRoleId] = useState<string | null>(null);
  const [customRoleName, setCustomRoleName] = useState('');
  const [customRoleBase, setCustomRoleBase] = useState<UserRole>('Teacher');
  const [customRoleDesc, setCustomRoleDesc] = useState('');
  const [customRoleModules, setCustomRoleModules] = useState<TenantModulePermission[]>(() =>
    getDefaultModulesForTenantRole(tenant, 'Teacher')
  );
  const [syncRoleToExisting, setSyncRoleToExisting] = useState(true);
  const [builtInTargetRole, setBuiltInTargetRole] = useState<UserRole>('Teacher');
  const [builtInModulesDraft, setBuiltInModulesDraft] = useState<TenantModulePermission[]>(() =>
    getDefaultModulesForTenantRole(tenant, 'Teacher')
  );
  const [savingRoleConfig, setSavingRoleConfig] = useState(false);

  const [tenantForm, setTenantForm] = useState({
    name: tenant.name,
    emailDomain: tenant.emailDomain || '',
    curriculum: tenant.curriculum,
    academicYear: tenant.academicYear,
    currentTerm: tenant.currentTerm,
    currency: tenant.currency,
    location: tenant.location,
    contactEmail: tenant.contactEmail || '',
    contactPhone: tenant.contactPhone || '',
    postalAddress: tenant.postalAddress || '',
  });

  useEffect(() => {
    setTenantForm({
      name: tenant.name,
      emailDomain: tenant.emailDomain || '',
      curriculum: tenant.curriculum,
      academicYear: tenant.academicYear,
      currentTerm: tenant.currentTerm,
      currency: tenant.currency,
      location: tenant.location,
      contactEmail: tenant.contactEmail || '',
      contactPhone: tenant.contactPhone || '',
      postalAddress: tenant.postalAddress || '',
    });
  }, [tenant]);

  const staffDirectory = useMemo(() => {
    const provisionedEmails = new Set(tenantUsers.map((u) => u.email.trim().toLowerCase()));
    const provisionedNames = new Set(tenantUsers.map((u) => u.fullName.trim().toLowerCase()));
    const teaching = (tenant.teachers || []).map((t) => {
      const email = (t.email || '').trim();
      const hasAccount =
        (email && provisionedEmails.has(email.toLowerCase())) ||
        provisionedNames.has(t.name.trim().toLowerCase());
      return {
        key: `teacher:${t.id}`,
        category: 'Teaching' as const,
        id: t.id,
        name: t.name,
        email,
        phone: t.phone || '',
        designation: t.department ? `Teaching · ${t.department}` : 'Teaching Staff',
        suggestedRole: 'Teacher' as UserRole,
        hasAccount,
      };
    });
    const nonTeaching = (tenant.nonTeachingStaff || []).map((n) => {
      const email = (n.email || '').trim();
      const hasAccount =
        (email && provisionedEmails.has(email.toLowerCase())) ||
        provisionedNames.has(n.name.trim().toLowerCase());
      return {
        key: `nonteaching:${n.id}`,
        category: 'Non-Teaching' as const,
        id: n.id,
        name: n.name,
        email,
        phone: n.phone || '',
        designation: n.role || n.department || 'Support Staff',
        suggestedRole: inferSuggestedRoleForNonTeaching(n.role || n.department || ''),
        hasAccount,
      };
    });
    return { teaching, nonTeaching, all: [...teaching, ...nonTeaching] };
  }, [tenant.teachers, tenant.nonTeachingStaff, tenantUsers]);

  const applyStaffDirectorySelection = useCallback(
    (key: string) => {
      setSelectedStaffKey(key);
      if (key === '__manual__') {
        setStaffFullName('');
        setStaffEmailHandle('');
        setStaffHandleEdited(false);
        setStaffPhone('');
        return;
      }
      const member = staffDirectory.all.find((m) => m.key === key);
      if (!member) return;
      setStaffFullName(member.name);
      setStaffPhone(member.phone || '');
      setStaffHandleEdited(false);
      const expectedSuffix = `@${domainSuffix.toLowerCase()}`;
      const memberEmail = member.email.toLowerCase();
      if (memberEmail && memberEmail.endsWith(expectedSuffix)) {
        setStaffEmailHandle(memberEmail.slice(0, memberEmail.length - expectedSuffix.length));
      } else {
        setStaffEmailHandle(suggestNameEmailLocalPart(member.name));
      }
      setStaffRole(member.suggestedRole);
      setStaffCustomRoleId('');
      setStaffModules(getDefaultModulesForTenantRole(tenant, member.suggestedRole));
    },
    [staffDirectory.all, domainSuffix, tenant]
  );

  useEffect(() => {
    if (selectedStaffKey === '__manual__' && !staffHandleEdited) {
      setStaffEmailHandle(suggestNameEmailLocalPart(staffFullName));
    }
  }, [selectedStaffKey, staffFullName, staffHandleEdited]);

  useEffect(() => {
    setBuiltInModulesDraft(getDefaultModulesForTenantRole(tenant, builtInTargetRole));
  }, [tenant, builtInTargetRole]);

  const loadTenantUsers = useCallback(async () => {
    if (!canMutateTenant) return;
    setLoadingUsers(true);
    try {
      const { users } = await saasApi.listTenantUsers(tenant.id);
      setTenantUsers(users);
    } catch {
      // ignore if restricted
    } finally {
      setLoadingUsers(false);
    }
  }, [tenant.id, canMutateTenant]);

  useEffect(() => {
    loadTenantUsers();
  }, [loadTenantUsers]);

  const [newTeacher, setNewTeacher] = useState({ name: '', phone: '', email: '', department: '' });
  const [newRoom, setNewRoom] = useState('');
  const [newSubject, setNewSubject] = useState('');
  const [saving, setSaving] = useState(false);

  // Academic Calendar & Student Portal State
  const academicYears = workspace.academicYears || [];
  const academicTerms = workspace.academicTerms || [];
  const [newYearForm, setNewYearForm] = useState({
    name: `${new Date().getFullYear() + 1}`,
    startDate: `${new Date().getFullYear() + 1}-01-05`,
    endDate: `${new Date().getFullYear() + 1}-11-30`,
    setAsCurrent: false,
  });
  const [newTermForm, setNewTermForm] = useState({
    academicYearId: academicYears.find((y) => y.isCurrent)?.id || academicYears[0]?.id || '',
    name: 'Term 2',
    startDate: `${new Date().getFullYear()}-05-04`,
    endDate: `${new Date().getFullYear()}-08-07`,
    setAsCurrent: false,
  });
  const [calendarSaving, setCalendarSaving] = useState(false);
  const [reopenTermTarget, setReopenTermTarget] = useState<AcademicTerm | null>(null);
  const [reopenReason, setReopenReason] = useState('');
  const [togglingPortal, setTogglingPortal] = useState(false);

  useEffect(() => {
    if (!newTermForm.academicYearId && academicYears.length > 0) {
      setNewTermForm((prev) => ({
        ...prev,
        academicYearId: academicYears.find((y) => y.isCurrent)?.id || academicYears[0].id,
      }));
    }
  }, [academicYears, newTermForm.academicYearId]);

  const [provisionForm, setProvisionForm] = useState({
    name: '',
    curriculum: 'Kenyan CBC (Playgroup – Grade 12)',
    academicYear: '2026–2027',
    currentTerm: 'Term 1',
    currency: 'KES' as CurrencyCode,
    plan: 'Enterprise' as 'Enterprise' | 'Growth',
    location: '',
    gradesText: KENYAN_CBC_GRADES.join(', '),
    subjectsText: KENYAN_CBC_SUBJECTS.join(', '),
    roomsText: 'Room 101, Room 102, Science Lab, ICT Lab',
    leadTeacherName: '',
    leadTeacherEmail: '',
  });

  async function handleSaveTenant(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await saasApi.updateTenant(tenant.id, tenantForm);
      await onRefresh();
      onNotify('School tenant settings updated.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Update failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleAddResource(payload: {
    addTeacher?: { name: string; phone?: string; email: string; department: string };
    addRoom?: string;
    addSubject?: string;
  }) {
    try {
      await saasApi.updateTenant(tenant.id, payload);
      await onRefresh();
      setNewTeacher({ name: '', phone: '', email: '', department: '' });
      setNewRoom('');
      setNewSubject('');
      onNotify('School catalog updated.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to add item', 'error');
    }
  }

  async function handleProvisionTenant(e: React.FormEvent) {
    e.preventDefault();
    if (!provisionForm.name.trim()) return;
    setSaving(true);
    try {
      const { tenant: created } = await saasApi.createTenant({
        name: provisionForm.name,
        curriculum: provisionForm.curriculum,
        academicYear: provisionForm.academicYear,
        currentTerm: provisionForm.currentTerm,
        currency: provisionForm.currency,
        plan: provisionForm.plan,
        location: provisionForm.location,
        grades: provisionForm.gradesText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        subjects: provisionForm.subjectsText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        rooms: provisionForm.roomsText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        leadTeacherName: provisionForm.leadTeacherName || 'Principal Admin',
        leadTeacherEmail: provisionForm.leadTeacherEmail || 'principal@school.ac.ke',
      });
      onSwitchTenant(created.id);
      setProvisionForm({ ...provisionForm, name: '', location: '', leadTeacherName: '', leadTeacherEmail: '' });
      onNotify(`Tenant "${created.name}" provisioned and activated.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Provisioning failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  function toggleModuleSelection(
    list: TenantModulePermission[],
    modId: TenantModulePermission,
    roleForRule: UserRole
  ): TenantModulePermission[] {
    if (roleForRule === 'Admin' && modId === 'settings') {
      return list.includes('settings') ? list : [...list, 'settings'];
    }
    return list.includes(modId) ? list.filter((m) => m !== modId) : [...list, modId];
  }

  async function handleCopyStaffOtp(val: string) {
    try {
      await navigator.clipboard?.writeText(val);
      setCopiedStaffOtp(true);
      onNotify('Copied 1-time password.');
      setTimeout(() => setCopiedStaffOtp(false), 2500);
    } catch {
      onNotify('Copy the generated 1-time password manually.', 'error');
    }
  }

  function resolveRoleChoice(value: string): {
    role: UserRole;
    customRoleId: string;
    modules: TenantModulePermission[];
  } {
    if (value.startsWith('custom:')) {
      const id = value.slice('custom:'.length);
      const found = customRoles.find((r) => r.id === id);
      if (found) {
        return {
          role: found.baseRole,
          customRoleId: found.id,
          modules: getDefaultModulesForTenantRole(tenant, found.baseRole, found.id),
        };
      }
    }
    const role = value as UserRole;
    return {
      role,
      customRoleId: '',
      modules: getDefaultModulesForTenantRole(tenant, role),
    };
  }

  function handleOpenAddStaff() {
    if (showAddStaff) {
      setShowAddStaff(false);
      return;
    }
    const firstUnprovisioned =
      staffDirectory.all.find((m) => !m.hasAccount) || staffDirectory.all[0];
    if (firstUnprovisioned) {
      applyStaffDirectorySelection(firstUnprovisioned.key);
    } else {
      applyStaffDirectorySelection('__manual__');
    }
    setShowAddStaff(true);
  }

  async function handleCreateStaffUser(e: React.FormEvent) {
    e.preventDefault();
    if (!staffFullName.trim()) {
      onNotify('Select a staff member or enter their full name.', 'error');
      return;
    }
    setCreatingStaff(true);
    setCopiedStaffOtp(false);
    try {
      const local = staffEmailHandle.trim().toLowerCase().replace(/@.*$/, '');
      const res = await saasApi.createTenantStaffUser(tenant.id, {
        fullName: staffFullName.trim(),
        email: `${local}@${domainSuffix}`,
        phone: staffPhone.trim() || undefined,
        role: staffRole,
        customRoleId: staffCustomRoleId || undefined,
        allowedModules: staffModules,
      });
      setIssuedStaffOtp({
        fullName: res.user.fullName,
        email: res.user.email,
        role: res.user.roleLabel || res.user.role,
        oneTimePassword: res.oneTimePassword,
      });
      setStaffFullName('');
      setStaffEmailHandle('');
      setStaffHandleEdited(false);
      setStaffPhone('');
      setSelectedStaffKey('__manual__');
      setStaffRole('Teacher');
      setStaffCustomRoleId('');
      setStaffModules(getDefaultModulesForTenantRole(tenant, 'Teacher'));
      setShowAddStaff(false);
      await loadTenantUsers();
      onNotify(`Added ${res.user.fullName} with 1-time password.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to add staff account.', 'error');
    } finally {
      setCreatingStaff(false);
    }
  }

  function beginEditUserAccess(u: TenantUser) {
    if (editingUserId === u.id) {
      setEditingUserId(null);
      return;
    }
    setEditingUserId(u.id);
    setEditRole(u.role);
    setEditCustomRoleId(u.customRoleId || '');
    setEditModules(getEffectiveUserModules(u));
    setEditStatus(u.status);
  }

  async function handleSaveUserAccess(targetUser: TenantUser, resetOtp = false) {
    setSavingUserAccess(true);
    setCopiedStaffOtp(false);
    try {
      const res = await saasApi.updateTenantUserAccess(tenant.id, targetUser.id, {
        role: editRole,
        customRoleId: editCustomRoleId || undefined,
        allowedModules: editModules,
        status: editStatus,
        resetOneTimePassword: resetOtp,
      });
      if (res.oneTimePassword) {
        setIssuedStaffOtp({
          fullName: res.user.fullName,
          email: res.user.email,
          role: res.user.roleLabel || res.user.role,
          oneTimePassword: res.oneTimePassword,
        });
      }
      await loadTenantUsers();
      if (!resetOtp) {
        setEditingUserId(null);
      }
      onNotify(
        resetOtp
          ? `Issued fresh 1-time password for ${res.user.fullName}.`
          : `Updated access rights for ${res.user.fullName}.`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to update access rights.', 'error');
    } finally {
      setSavingUserAccess(false);
    }
  }

  function startNewCustomRole() {
    setRoleEditorMode('custom');
    setEditingCustomRoleId(null);
    setCustomRoleName('');
    setCustomRoleBase('Teacher');
    setCustomRoleDesc('');
    setCustomRoleModules(getDefaultModulesForTenantRole(tenant, 'Teacher'));
    setSyncRoleToExisting(true);
  }

  function startEditCustomRole(cr: CustomRoleDefinition) {
    setRoleEditorMode('custom');
    setEditingCustomRoleId(cr.id);
    setCustomRoleName(cr.name);
    setCustomRoleBase(cr.baseRole);
    setCustomRoleDesc(cr.description || '');
    setCustomRoleModules([...cr.defaultModules]);
    setSyncRoleToExisting(true);
  }

  async function handleSaveCustomRole(e: React.FormEvent) {
    e.preventDefault();
    if (!customRoleName.trim()) {
      onNotify('Enter a role name.', 'error');
      return;
    }
    setSavingRoleConfig(true);
    try {
      const res = await saasApi.upsertCustomRole(tenant.id, {
        id: editingCustomRoleId || undefined,
        name: customRoleName.trim(),
        baseRole: customRoleBase,
        defaultModules: customRoleModules,
        description: customRoleDesc.trim() || undefined,
        syncExistingUsers: syncRoleToExisting,
      });
      await onRefresh();
      await loadTenantUsers();
      onNotify(
        editingCustomRoleId
          ? `Updated custom role "${res.customRole.name}"${res.updatedUsersCount > 0 ? ` (synced ${res.updatedUsersCount} account(s))` : ''}.`
          : `Created custom role "${res.customRole.name}".`
      );
      startNewCustomRole();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save custom role.', 'error');
    } finally {
      setSavingRoleConfig(false);
    }
  }

  async function handleDeleteCustomRole(cr: CustomRoleDefinition) {
    setSavingRoleConfig(true);
    try {
      await saasApi.deleteCustomRole(tenant.id, cr.id);
      await onRefresh();
      if (editingCustomRoleId === cr.id) {
        startNewCustomRole();
      }
      onNotify(`Deleted custom role "${cr.name}".`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to delete custom role.', 'error');
    } finally {
      setSavingRoleConfig(false);
    }
  }

  async function handleSaveBuiltInRoleModules(e: React.FormEvent) {
    e.preventDefault();
    setSavingRoleConfig(true);
    try {
      const res = await saasApi.updateBuiltInRoleModules(tenant.id, builtInTargetRole, {
        defaultModules: builtInModulesDraft,
        syncExistingUsers: syncRoleToExisting,
      });
      await onRefresh();
      await loadTenantUsers();
      onNotify(
        `Saved ${builtInTargetRole} role permissions${res.updatedUsersCount > 0 ? ` (synced ${res.updatedUsersCount} account(s))` : ''}.`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save built-in role.', 'error');
    } finally {
      setSavingRoleConfig(false);
    }
  }

  async function handleToggleStudentPortal() {
    setTogglingPortal(true);
    try {
      const nextState = !tenant.studentPortalEnabled;
      await saasApi.updateTenantStudentPortal(tenant.id, nextState);
      await onRefresh();
      onNotify(
        nextState
          ? `Student Portal enabled for ${tenant.name}. You can now issue student logins in Admissions.`
          : `Student Portal disabled for ${tenant.name}. Active student sessions were signed out.`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to update Student Portal setting.', 'error');
    } finally {
      setTogglingPortal(false);
    }
  }

  async function handleCreateAcademicYear(e: React.FormEvent) {
    e.preventDefault();
    setCalendarSaving(true);
    try {
      const { year } = await saasApi.createAcademicYear(tenant.id, newYearForm);
      setNewTermForm((prev) => ({ ...prev, academicYearId: year.id }));
      await onRefresh();
      onNotify(`Academic year "${year.name}" created.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to create academic year.', 'error');
    } finally {
      setCalendarSaving(false);
    }
  }

  async function handleCreateAcademicTerm(e: React.FormEvent) {
    e.preventDefault();
    if (!newTermForm.academicYearId) {
      onNotify('Create or select an Academic Year first.', 'error');
      return;
    }
    setCalendarSaving(true);
    try {
      const { term } = await saasApi.createAcademicTerm(tenant.id, newTermForm);
      await onRefresh();
      onNotify(`Academic term "${term.name}" added.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to create academic term.', 'error');
    } finally {
      setCalendarSaving(false);
    }
  }

  async function handleSetCurrentTerm(term: AcademicTerm) {
    setCalendarSaving(true);
    try {
      await saasApi.setCurrentAcademicTerm(tenant.id, term.id);
      await onRefresh();
      onNotify(`Active term switched to "${term.name}".`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to set active term.', 'error');
    } finally {
      setCalendarSaving(false);
    }
  }

  async function handleCloseTerm(term: AcademicTerm) {
    setCalendarSaving(true);
    try {
      await saasApi.closeAcademicTerm(tenant.id, term.id);
      await onRefresh();
      onNotify(`Closed "${term.name}". Exams, attendance, and fee edits for this term are now locked.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to close term.', 'error');
    } finally {
      setCalendarSaving(false);
    }
  }

  async function handleConfirmReopenTerm(e: React.FormEvent) {
    e.preventDefault();
    if (!reopenTermTarget) return;
    setCalendarSaving(true);
    try {
      await saasApi.reopenAcademicTerm(tenant.id, reopenTermTarget.id, reopenReason);
      await onRefresh();
      onNotify(`Reopened "${reopenTermTarget.name}" (audit log recorded).`);
      setReopenTermTarget(null);
      setReopenReason('');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to reopen term.', 'error');
    } finally {
      setCalendarSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          {isDeveloper ? 'Tenant Administration & Provisioning' : 'School Settings & Access Control'}
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {isDeveloper
            ? `Configure ${tenant.name} academic parameters, manage faculty/rooms/subjects, or spin up an isolated new school tenant.`
            : `Configure ${tenant.name} academic parameters, manage faculty/rooms/subjects, and assign staff access rights.`}
        </p>
      </div>

      {!canMutateTenant && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          <Lock className="h-4 w-4 shrink-0" />
          <span>
            Tenant governance and metadata updates are protected by the backend Admin Service Layer. Sign in with an <strong>Admin</strong> or <strong>Super Admin</strong> institutional account to save changes.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Current Tenant Settings */}
        <form
          onSubmit={handleSaveTenant}
          className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-6 dark:border-slate-800 dark:bg-slate-900"
        >
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Active School Configuration
          </h2>
          <p className="mt-0.5 font-mono text-xs text-slate-500 dark:text-slate-400">
            Tenant ID: {tenant.id} · Domain: @{tenant.emailDomain || `${tenant.slug}.ac.ke`}
          </p>

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Institution Name
              </label>
              <input
                type="text"
                value={tenantForm.name}
                onChange={(e) => setTenantForm({ ...tenantForm, name: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                School Email Domain (@school)
              </label>
              <input
                type="text"
                value={tenantForm.emailDomain}
                onChange={(e) => setTenantForm({ ...tenantForm, emailDomain: e.target.value })}
                placeholder="oakridge.ac.ke"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Curriculum Standard
              </label>
              <input
                type="text"
                value={tenantForm.curriculum}
                onChange={(e) => setTenantForm({ ...tenantForm, curriculum: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Location
              </label>
              <input
                type="text"
                value={tenantForm.location}
                onChange={(e) => setTenantForm({ ...tenantForm, location: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Academic Year
              </label>
              <input
                type="text"
                value={tenantForm.academicYear}
                onChange={(e) => setTenantForm({ ...tenantForm, academicYear: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Active Term
              </label>
              <input
                type="text"
                value={tenantForm.currentTerm}
                onChange={(e) => setTenantForm({ ...tenantForm, currentTerm: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Billing Currency
              </label>
              <select
                value={tenantForm.currency}
                onChange={(e) =>
                  setTenantForm({
                    ...tenantForm,
                    currency: e.target.value as CurrencyCode,
                  })
                }
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="KES">KES (Kenya Shilling)</option>
                <option value="USD">USD (US Dollar)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                School Contact Phone (Printed Docs)
              </label>
              <input
                type="tel"
                value={tenantForm.contactPhone}
                onChange={(e) => setTenantForm({ ...tenantForm, contactPhone: e.target.value })}
                placeholder="+254 712 408 100"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Official Contact Email (Printed Docs)
              </label>
              <input
                type="email"
                value={tenantForm.contactEmail}
                onChange={(e) => setTenantForm({ ...tenantForm, contactEmail: e.target.value })}
                placeholder={`info@${domainSuffix}`}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Postal Address (Letterhead &amp; Statements)
              </label>
              <input
                type="text"
                value={tenantForm.postalAddress}
                onChange={(e) => setTenantForm({ ...tenantForm, postalAddress: e.target.value })}
                placeholder="P.O. Box 14820-00800, Westlands, Nairobi"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={saving || !canMutateTenant}
            className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Tenant Configuration'}
          </button>

          {/* Faculty & Room Catalog Adders */}
          <div className="mt-7 space-y-4 border-t border-slate-100 pt-5 dark:border-slate-800">
            <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Quick Add Faculty, Rooms & Subjects
            </h3>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
              <input
                type="text"
                value={newTeacher.name}
                onChange={(e) => setNewTeacher({ ...newTeacher, name: e.target.value })}
                placeholder="Faculty name"
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
              <input
                type="tel"
                value={newTeacher.phone}
                onChange={(e) => setNewTeacher({ ...newTeacher, phone: e.target.value })}
                placeholder="Phone (+254 7...)"
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
              <input
                type="text"
                value={newTeacher.department}
                onChange={(e) => setNewTeacher({ ...newTeacher, department: e.target.value })}
                placeholder="Department"
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
              <button
                type="button"
                disabled={!canMutateTenant}
                onClick={() => {
                  if (newTeacher.name.trim()) handleAddResource({ addTeacher: newTeacher });
                }}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                + Add Faculty
              </button>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newRoom}
                  onChange={(e) => setNewRoom(e.target.value)}
                  placeholder="New room (e.g. Lab D4)"
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
                <button
                  type="button"
                  disabled={!canMutateTenant}
                  onClick={() => {
                    if (newRoom.trim()) handleAddResource({ addRoom: newRoom });
                  }}
                  className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  + Room
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  placeholder="New subject (e.g. Economics)"
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
                <button
                  type="button"
                  disabled={!canMutateTenant}
                  onClick={() => {
                    if (newSubject.trim()) handleAddResource({ addSubject: newSubject });
                  }}
                  className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  + Subject
                </button>
              </div>
            </div>
          </div>
        </form>

        {/* School Staff Accounts & Granular Access Rights */}
        <div className="space-y-6 lg:col-span-6">
          <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Staff Accounts & Access Rights
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                  @{domainSuffix}
                </span>
                {canMutateTenant && (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowManageRoles((v) => !v)}
                      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                        showManageRoles
                          ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/40 dark:text-blue-300'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      {showManageRoles ? 'Close Roles' : `Manage Roles (${customRoles.length})`}
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenAddStaff}
                      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      {showAddStaff ? 'Cancel' : 'Add Staff'}
                    </button>
                  </>
                )}
              </div>
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Select staff from your school directory, create or customize roles, and control module access at {tenant.name}.
            </p>

            {canMutateTenant && showManageRoles && (
              <div className="mt-4 space-y-4 rounded-lg border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      Roles &amp; Access Templates
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Create custom school roles (e.g. Deputy Principal, Senior Accountant, Librarian) or customize built-in role permissions.
                    </p>
                  </div>
                  <div className="inline-flex rounded-lg bg-slate-200/70 p-0.5 dark:bg-slate-800">
                    <button
                      type="button"
                      onClick={() => setRoleEditorMode('custom')}
                      className={`whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                        roleEditorMode === 'custom'
                          ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      Custom Roles ({customRoles.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setRoleEditorMode('builtin')}
                      className={`whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                        roleEditorMode === 'builtin'
                          ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      Customize Built-in Roles
                    </button>
                  </div>
                </div>

                {roleEditorMode === 'custom' ? (
                  <div className="space-y-4">
                    {customRoles.length > 0 && (
                      <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
                        {customRoles.map((cr) => (
                          <div
                            key={cr.id}
                            className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-xs"
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-slate-900 dark:text-slate-100">
                                  {cr.name}
                                </span>
                                <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                                  Tier: {cr.baseRole}
                                </span>
                              </div>
                              {cr.description && (
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                  {cr.description}
                                </p>
                              )}
                              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                Modules:{' '}
                                {cr.defaultModules
                                  .map(
                                    (id) => ALL_TENANT_MODULES.find((m) => m.id === id)?.label || id
                                  )
                                  .join(', ')}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => startEditCustomRole(cr)}
                                className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                              >
                                <Pencil className="h-3 w-3" />
                                Edit
                              </button>
                              <button
                                type="button"
                                disabled={savingRoleConfig}
                                onClick={() => handleDeleteCustomRole(cr)}
                                className="inline-flex items-center gap-1 rounded border border-rose-200 px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-950/40"
                              >
                                <Trash2 className="h-3 w-3" />
                                Delete
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <form onSubmit={handleSaveCustomRole} className="space-y-3 border-t border-slate-200 pt-3 dark:border-slate-800">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {editingCustomRoleId ? 'Edit Custom Role' : 'Create New Custom Role'}
                        </span>
                        {editingCustomRoleId && (
                          <button
                            type="button"
                            onClick={startNewCustomRole}
                            className="text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
                          >
                            + New Role Instead
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300">
                            Role Name *
                          </label>
                          <input
                            type="text"
                            required
                            value={customRoleName}
                            onChange={(e) => setCustomRoleName(e.target.value)}
                            placeholder="e.g. Deputy Principal, Lab Technician, Matron"
                            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300">
                            Base Capability Tier
                          </label>
                          <select
                            value={customRoleBase}
                            onChange={(e) => {
                              const nextBase = e.target.value as UserRole;
                              setCustomRoleBase(nextBase);
                              if (!editingCustomRoleId) {
                                setCustomRoleModules(
                                  getDefaultModulesForTenantRole(tenant, nextBase)
                                );
                              } else if (nextBase === 'Admin' && !customRoleModules.includes('settings')) {
                                setCustomRoleModules([...customRoleModules, 'settings']);
                              }
                            }}
                            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                          >
                            {CUSTOMIZABLE_BUILTIN_ROLES.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300">
                          Role Description (Optional)
                        </label>
                        <input
                          type="text"
                          value={customRoleDesc}
                          onChange={(e) => setCustomRoleDesc(e.target.value)}
                          placeholder="e.g. Handles discipline, timetables, and attendance oversight"
                          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        />
                      </div>
                      <div>
                        <span className="block text-[11px] font-medium text-slate-700 dark:text-slate-300">
                          Default Module Permissions
                        </span>
                        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                          {ALL_TENANT_MODULES.map((mod) => {
                            const checked = customRoleModules.includes(mod.id);
                            const locked = customRoleBase === 'Admin' && mod.id === 'settings';
                            return (
                              <label
                                key={mod.id}
                                className="flex cursor-pointer items-center gap-2 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={locked}
                                  onChange={() =>
                                    setCustomRoleModules((prev) =>
                                      toggleModuleSelection(prev, mod.id, customRoleBase)
                                    )
                                  }
                                  className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                                />
                                <span className="truncate">{mod.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <label className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={syncRoleToExisting}
                            onChange={(e) => setSyncRoleToExisting(e.target.checked)}
                            className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                          />
                          <span>Apply updated modules to existing accounts with this role</span>
                        </label>
                        <button
                          type="submit"
                          disabled={savingRoleConfig}
                          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          <ShieldCheck className="h-3.5 w-3.5" />
                          {savingRoleConfig
                            ? 'Saving...'
                            : editingCustomRoleId
                            ? 'Update Custom Role'
                            : 'Create Custom Role'}
                        </button>
                      </div>
                    </form>
                  </div>
                ) : (
                  <form onSubmit={handleSaveBuiltInRoleModules} className="space-y-3 border-t border-slate-200 pt-3 dark:border-slate-800">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300">
                        Built-in Role to Customize
                      </label>
                      <select
                        value={builtInTargetRole}
                        onChange={(e) => setBuiltInTargetRole(e.target.value as UserRole)}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      >
                        {CUSTOMIZABLE_BUILTIN_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <span className="block text-[11px] font-medium text-slate-700 dark:text-slate-300">
                        Module Permissions for {builtInTargetRole}
                      </span>
                      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                        {ALL_TENANT_MODULES.map((mod) => {
                          const checked = builtInModulesDraft.includes(mod.id);
                          const locked = builtInTargetRole === 'Admin' && mod.id === 'settings';
                          return (
                            <label
                              key={mod.id}
                              className="flex cursor-pointer items-center gap-2 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={locked}
                                onChange={() =>
                                  setBuiltInModulesDraft((prev) =>
                                    toggleModuleSelection(prev, mod.id, builtInTargetRole)
                                  )
                                }
                                className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                              />
                              <span className="truncate">{mod.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <label className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={syncRoleToExisting}
                          onChange={(e) => setSyncRoleToExisting(e.target.checked)}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                        />
                        <span>Sync permissions to existing {builtInTargetRole} accounts</span>
                      </label>
                      <button
                        type="submit"
                        disabled={savingRoleConfig}
                        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                        {savingRoleConfig ? 'Saving...' : `Save ${builtInTargetRole} Permissions`}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {issuedStaffOtp && (
              <div className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50/70 p-3.5 text-xs dark:border-emerald-800 dark:bg-emerald-950/30">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-emerald-950 dark:text-emerald-200">
                    1-Time Password Ready — {issuedStaffOtp.fullName} ({issuedStaffOtp.role})
                  </div>
                  <button
                    type="button"
                    onClick={() => setIssuedStaffOtp(null)}
                    className="text-[11px] font-medium text-emerald-800 hover:underline dark:text-emerald-300"
                  >
                    Dismiss
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-slate-800 dark:text-slate-200">
                    {issuedStaffOtp.email}
                  </span>
                  <span className="text-slate-400">·</span>
                  <span className="rounded border border-emerald-300 bg-white px-2 py-0.5 font-mono font-bold text-emerald-700 dark:border-emerald-700 dark:bg-slate-900 dark:text-emerald-300">
                    {issuedStaffOtp.oneTimePassword}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopyStaffOtp(issuedStaffOtp.oneTimePassword)}
                    className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    {copiedStaffOtp ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copiedStaffOtp ? 'Copied' : 'Copy OTP'}
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-emerald-800 dark:text-emerald-300">
                  Staff member will be prompted to set a permanent password on their first login.
                </p>
              </div>
            )}

            {canMutateTenant && showAddStaff && (
              <form
                onSubmit={handleCreateStaffUser}
                className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/60"
              >
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Provision Staff Account & Assign Access Rights
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300">
                      Staff Member ({staffDirectory.all.length} in directory)
                    </label>
                    <select
                      value={selectedStaffKey}
                      onChange={(e) => applyStaffDirectorySelection(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      {staffDirectory.teaching.length > 0 && (
                        <optgroup label={`Teaching Staff (${staffDirectory.teaching.length})`}>
                          {staffDirectory.teaching.map((m) => (
                            <option key={m.key} value={m.key}>
                              {m.name} — {m.designation}
                              {m.hasAccount ? ' (Account Exists)' : ''}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {staffDirectory.nonTeaching.length > 0 && (
                        <optgroup label={`Non-Teaching / Support Staff (${staffDirectory.nonTeaching.length})`}>
                          {staffDirectory.nonTeaching.map((m) => (
                            <option key={m.key} value={m.key}>
                              {m.name} — {m.designation}
                              {m.hasAccount ? ' (Account Exists)' : ''}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <option value="__manual__">Other / Enter Person Manually...</option>
                    </select>
                    {selectedStaffKey === '__manual__' && (
                      <input
                        type="text"
                        required
                        value={staffFullName}
                        onChange={(e) => setStaffFullName(e.target.value)}
                        placeholder="e.g. Jane Wanjiku"
                        className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                    )}
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300">
                      Staff Role
                    </label>
                    <select
                      value={encodeRoleChoice(staffRole, staffCustomRoleId)}
                      onChange={(e) => {
                        const resolved = resolveRoleChoice(e.target.value);
                        setStaffRole(resolved.role);
                        setStaffCustomRoleId(resolved.customRoleId);
                        setStaffModules(resolved.modules);
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      <optgroup label="Built-in Roles">
                        {STAFF_ROLE_OPTIONS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </optgroup>
                      {customRoles.length > 0 && (
                        <optgroup label="Custom Roles">
                          {customRoles.map((cr) => (
                            <option key={cr.id} value={`custom:${cr.id}`}>
                              {cr.name} ({cr.baseRole})
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300">
                      School Email
                    </label>
                    <div className="mt-1 flex overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                      <input
                        type="text"
                        required
                        value={staffEmailHandle}
                        onChange={(e) => {
                          setStaffHandleEdited(true);
                          setStaffEmailHandle(
                            e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '')
                          );
                        }}
                        placeholder="jane.wanjiku"
                        className="min-w-0 flex-1 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:outline-none dark:bg-slate-900 dark:text-slate-100"
                      />
                      <span className="flex shrink-0 items-center border-l border-slate-200 bg-slate-100 px-2.5 font-mono text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        @{domainSuffix}
                      </span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300">
                      Recovery Phone (Password Reset)
                    </label>
                    <input
                      type="tel"
                      value={staffPhone}
                      onChange={(e) => setStaffPhone(e.target.value)}
                      placeholder="+254 712 345 678"
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>

                <div>
                  <span className="block text-[11px] font-medium text-slate-700 dark:text-slate-300">
                    Module Access Rights
                  </span>
                  <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                    {ALL_TENANT_MODULES.map((mod) => {
                      const checked = staffModules.includes(mod.id);
                      const locked = staffRole === 'Admin' && mod.id === 'settings';
                      return (
                        <label
                          key={mod.id}
                          className="flex cursor-pointer items-center gap-2 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={locked}
                            onChange={() =>
                              setStaffModules((prev) =>
                                toggleModuleSelection(prev, mod.id, staffRole)
                              )
                            }
                            className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                          />
                          <span className="truncate">{mod.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    A 1-time password will be auto-generated.
                  </span>
                  <button
                    type="submit"
                    disabled={creatingStaff}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {creatingStaff ? 'Creating...' : 'Create Staff Account'}
                  </button>
                </div>
              </form>
            )}

            {!canMutateTenant ? (
              <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                Sign in with a School Admin account to manage staff accounts and access rights.
              </p>
            ) : loadingUsers ? (
              <div className="mt-4 space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
                ))}
              </div>
            ) : tenantUsers.length === 0 ? (
              <p className="mt-4 text-xs text-slate-500">No user accounts registered yet.</p>
            ) : (
              <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
                {tenantUsers.map((u) => {
                  const userMods = getEffectiveUserModules(u);
                  const isEditing = editingUserId === u.id;
                  const isSelf = Boolean(currentUserId && u.id === currentUserId);
                  return (
                    <div key={u.id} className="py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                              {u.fullName}
                            </p>
                            <span className="font-mono text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                              {u.roleLabel || u.role}
                            </span>
                            {u.status === 'Disabled' && (
                              <span className="font-mono text-[11px] font-semibold text-red-600 dark:text-red-400">
                                Disabled
                              </span>
                            )}
                            {u.mustChangePassword && (
                              <span className="font-mono text-[11px] text-amber-600 dark:text-amber-400">
                                OTP Pending
                              </span>
                            )}
                          </div>
                          <p className="truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
                            {u.email}
                            {u.phone ? ` · ${u.phone}` : ''}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                            Access:{' '}
                            {userMods.length === ALL_TENANT_MODULES.length
                              ? 'All Modules'
                              : userMods.length === 0
                              ? 'No modules assigned'
                              : userMods
                                  .map(
                                    (id) => ALL_TENANT_MODULES.find((m) => m.id === id)?.label || id
                                  )
                                  .join(', ')}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => beginEditUserAccess(u)}
                          className="shrink-0 whitespace-nowrap rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          {isEditing ? 'Close' : 'Assign Rights'}
                        </button>
                      </div>

                      {isEditing && (
                        <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60">
                          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                            <div>
                              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                                Assigned Role
                              </label>
                              <select
                                value={encodeRoleChoice(editRole, editCustomRoleId)}
                                disabled={isSelf}
                                onChange={(e) => {
                                  const resolved = resolveRoleChoice(e.target.value);
                                  setEditRole(resolved.role);
                                  setEditCustomRoleId(resolved.customRoleId);
                                  setEditModules(resolved.modules);
                                }}
                                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                              >
                                <optgroup label="Built-in Roles">
                                  {STAFF_ROLE_OPTIONS.map((r) => (
                                    <option key={r} value={r}>
                                      {r}
                                    </option>
                                  ))}
                                </optgroup>
                                {customRoles.length > 0 && (
                                  <optgroup label="Custom Roles">
                                    {customRoles.map((cr) => (
                                      <option key={cr.id} value={`custom:${cr.id}`}>
                                        {cr.name} ({cr.baseRole})
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                              </select>
                            </div>
                            <div>
                              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                                Account Status
                              </label>
                              <select
                                value={editStatus}
                                disabled={isSelf}
                                onChange={(e) =>
                                  setEditStatus(e.target.value as 'Active' | 'Disabled')
                                }
                                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                              >
                                <option value="Active">Active</option>
                                <option value="Disabled">Disabled</option>
                              </select>
                            </div>
                          </div>

                          <div>
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                                Permitted School Modules
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setEditModules(
                                    getDefaultModulesForTenantRole(
                                      tenant,
                                      editRole,
                                      editCustomRoleId || undefined
                                    )
                                  )
                                }
                                className="text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
                              >
                                Apply{' '}
                                {editCustomRoleId
                                  ? customRoles.find((c) => c.id === editCustomRoleId)?.name || editRole
                                  : editRole}{' '}
                                Defaults
                              </button>
                            </div>
                            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                              {ALL_TENANT_MODULES.map((mod) => {
                                const checked = editModules.includes(mod.id);
                                const locked = editRole === 'Admin' && mod.id === 'settings';
                                return (
                                  <label
                                    key={mod.id}
                                    className="flex cursor-pointer items-center gap-2 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      disabled={locked}
                                      onChange={() =>
                                        setEditModules((prev) =>
                                          toggleModuleSelection(prev, mod.id, editRole)
                                        )
                                      }
                                      className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                                    />
                                    <span className="truncate">{mod.label}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                            {!isSelf ? (
                              <button
                                type="button"
                                disabled={savingUserAccess}
                                onClick={() => handleSaveUserAccess(u, true)}
                                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                              >
                                <KeyRound className="h-3 w-3" />
                                Issue 1-Time Password
                              </button>
                            ) : (
                              <span className="text-[11px] text-slate-400">Current signed-in Admin</span>
                            )}
                            <button
                              type="button"
                              disabled={savingUserAccess}
                              onClick={() => handleSaveUserAccess(u, false)}
                              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                              <ShieldCheck className="h-3.5 w-3.5" />
                              {savingUserAccess ? 'Saving...' : 'Save Access Rights'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {isDeveloper && (
            <form
              onSubmit={handleProvisionTenant}
              className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Provision New School Tenant
                </h2>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Create a completely isolated multi-tenant workspace with dedicated students, timetables, ledgers, and WebSocket room.
              </p>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    School / Institution Name
                  </label>
                  <input
                    required
                    type="text"
                    value={provisionForm.name}
                    onChange={(e) => setProvisionForm({ ...provisionForm, name: e.target.value })}
                    placeholder="e.g. Meridian International Academy"
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Curriculum
                  </label>
                  <input
                    type="text"
                    value={provisionForm.curriculum}
                    onChange={(e) => setProvisionForm({ ...provisionForm, curriculum: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    City / Campus
                  </label>
                  <input
                    type="text"
                    value={provisionForm.location}
                    onChange={(e) => setProvisionForm({ ...provisionForm, location: e.target.value })}
                    placeholder="e.g. Nairobi, KE"
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    SaaS Plan
                  </label>
                  <select
                    value={provisionForm.plan}
                    onChange={(e) =>
                      setProvisionForm({
                        ...provisionForm,
                        plan: e.target.value as 'Enterprise' | 'Growth',
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value="Enterprise">Enterprise</option>
                    <option value="Growth">Growth</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Currency
                  </label>
                  <select
                    value={provisionForm.currency}
                    onChange={(e) =>
                      setProvisionForm({
                        ...provisionForm,
                        currency: e.target.value as CurrencyCode,
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value="KES">KES (Kenya Shilling)</option>
                    <option value="USD">USD (US Dollar)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Lead Principal / Faculty
                  </label>
                  <input
                    type="text"
                    value={provisionForm.leadTeacherName}
                    onChange={(e) =>
                      setProvisionForm({ ...provisionForm, leadTeacherName: e.target.value })
                    }
                    placeholder="e.g. Dr. Evelyn Hart"
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Grades (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={provisionForm.gradesText}
                    onChange={(e) =>
                      setProvisionForm({ ...provisionForm, gradesText: e.target.value })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Core Subjects (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={provisionForm.subjectsText}
                    onChange={(e) =>
                      setProvisionForm({ ...provisionForm, subjectsText: e.target.value })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={saving || !canMutateTenant}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
              >
                <Plus className="h-4 w-4" />
                {saving ? 'Provisioning...' : 'Provision Isolated Tenant'}
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Academic Years & Terms Calendar + Student Portal Section */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Academic Calendar & Term Lock Controls */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-8 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Academic Years & Terms Calendar
                </h2>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Link invoices, exam cycles, and attendance registers to formal school terms. Closing a term locks all exam scores, attendance marks, and fee adjustments for that term.
              </p>
            </div>
            <span className="font-mono text-xs text-slate-600 dark:text-slate-300">
              Current: {tenant.academicYear} · {tenant.currentTerm}
            </span>
          </div>

          <div className="mt-5 space-y-4">
            {academicYears.length === 0 ? (
              <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950">
                No academic years configured yet. Create your first academic year below.
              </p>
            ) : (
              academicYears.map((yr) => {
                const yearTerms = academicTerms.filter((t) => t.academicYearId === yr.id);
                return (
                  <div
                    key={yr.id}
                    className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-950/50"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                          {yr.name}
                        </span>
                        {yr.isCurrent && (
                          <span className="rounded bg-blue-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                            Current Year
                          </span>
                        )}
                        <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                          {yr.startDate} → {yr.endDate}
                        </span>
                      </div>
                      <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                        {yearTerms.length} {yearTerms.length === 1 ? 'term' : 'terms'}
                      </span>
                    </div>

                    <div className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
                      {yearTerms.length === 0 ? (
                        <div className="px-3 py-2.5 text-xs text-slate-500">
                          No terms added under {yr.name} yet.
                        </div>
                      ) : (
                        yearTerms.map((term) => {
                          const isClosed = term.status === 'Closed';
                          return (
                            <div
                              key={term.id}
                              className="flex flex-col gap-2 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                                    {term.name}
                                  </span>
                                  {term.isCurrent && (
                                    <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                                      <CheckCircle2 className="h-3 w-3" />
                                      Current
                                    </span>
                                  )}
                                  <span
                                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                                      isClosed
                                        ? 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                                        : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                    }`}
                                  >
                                    {isClosed ? <Lock className="h-2.5 w-2.5" /> : null}
                                    {term.status}
                                  </span>
                                </div>
                                <p className="mt-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                                  {term.startDate} to {term.endDate}
                                  {isClosed && term.closedBy ? ` · Locked by ${term.closedBy}` : ''}
                                  {!isClosed && term.reopenedBy
                                    ? ` · Reopened by ${term.reopenedBy}${term.reopenReason ? ` (${term.reopenReason})` : ''}`
                                    : ''}
                                </p>
                              </div>

                              {canMutateTenant && (
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {!term.isCurrent && (
                                    <button
                                      type="button"
                                      disabled={calendarSaving}
                                      onClick={() => handleSetCurrentTerm(term)}
                                      className="rounded border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                                    >
                                      Set Current
                                    </button>
                                  )}
                                  {isClosed ? (
                                    <button
                                      type="button"
                                      disabled={calendarSaving}
                                      onClick={() => {
                                        setReopenTermTarget(term);
                                        setReopenReason('');
                                      }}
                                      className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                                    >
                                      <LockOpen className="h-3 w-3" />
                                      Reopen Term
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={calendarSaving}
                                      onClick={() => handleCloseTerm(term)}
                                      className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
                                    >
                                      <Lock className="h-3 w-3" />
                                      Close &amp; Lock
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {canMutateTenant && (
            <div className="mt-5 grid grid-cols-1 gap-4 border-t border-slate-100 pt-5 sm:grid-cols-2 dark:border-slate-800">
              <form
                onSubmit={handleCreateAcademicYear}
                className="space-y-2.5 rounded-lg border border-slate-200 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-950/40"
              >
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Add Academic Year
                </div>
                <input
                  type="text"
                  required
                  value={newYearForm.name}
                  onChange={(e) => setNewYearForm({ ...newYearForm, name: e.target.value })}
                  placeholder="e.g. 2027"
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    required
                    value={newYearForm.startDate}
                    onChange={(e) => setNewYearForm({ ...newYearForm, startDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                  <input
                    type="date"
                    required
                    value={newYearForm.endDate}
                    onChange={(e) => setNewYearForm({ ...newYearForm, endDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
                <label className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={newYearForm.setAsCurrent}
                    onChange={(e) =>
                      setNewYearForm({ ...newYearForm, setAsCurrent: e.target.checked })
                    }
                    className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                  />
                  Set as current academic year
                </label>
                <button
                  type="submit"
                  disabled={calendarSaving}
                  className="w-full rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
                >
                  + Create Academic Year
                </button>
              </form>

              <form
                onSubmit={handleCreateAcademicTerm}
                className="space-y-2.5 rounded-lg border border-slate-200 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-950/40"
              >
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Add Term to Academic Year
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={newTermForm.academicYearId}
                    onChange={(e) =>
                      setNewTermForm({ ...newTermForm, academicYearId: e.target.value })
                    }
                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    {academicYears.map((y) => (
                      <option key={y.id} value={y.id}>
                        {y.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    required
                    value={newTermForm.name}
                    onChange={(e) => setNewTermForm({ ...newTermForm, name: e.target.value })}
                    placeholder="Term 2"
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    required
                    value={newTermForm.startDate}
                    onChange={(e) => setNewTermForm({ ...newTermForm, startDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                  <input
                    type="date"
                    required
                    value={newTermForm.endDate}
                    onChange={(e) => setNewTermForm({ ...newTermForm, endDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
                <label className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={newTermForm.setAsCurrent}
                    onChange={(e) =>
                      setNewTermForm({ ...newTermForm, setAsCurrent: e.target.checked })
                    }
                    className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                  />
                  Set as current term immediately
                </label>
                <button
                  type="submit"
                  disabled={calendarSaving || academicYears.length === 0}
                  className="w-full rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  + Add Academic Term
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Optional Student Portal Setting */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <GraduationCap className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Student Read-Only Portal
            </h2>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            Optionally allow enrolled learners at {tenant.name} to sign in with their own read-only Student account to view their class timetable, published exam results, attendance log, and school announcements.
          </p>

          <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/50">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Student Login Access
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                  Status: {tenant.studentPortalEnabled ? 'Enabled' : 'Disabled'}
                </p>
              </div>
              <button
                type="button"
                disabled={!canMutateTenant || togglingPortal}
                onClick={handleToggleStudentPortal}
                className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors disabled:opacity-50 ${
                  tenant.studentPortalEnabled
                    ? 'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {togglingPortal
                  ? 'Updating...'
                  : tenant.studentPortalEnabled
                  ? 'Disable Portal'
                  : 'Enable Portal'}
              </button>
            </div>
            <ul className="mt-3 space-y-1 text-[11px] text-slate-600 dark:text-slate-400">
              <li>• Strictly read-only — students cannot modify any data.</li>
              <li>• Finance, fee ledgers, payroll, and other learners remain hidden.</li>
              <li>• Turning off immediately signs out all active Student sessions.</li>
              <li>• Issue student logins from the Student Directory in Admissions.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Reopen Closed Term Modal */}
      {reopenTermTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Reopen Closed Term — {reopenTermTarget.name}
              </h3>
              <button
                type="button"
                onClick={() => setReopenTermTarget(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
              Reopening a closed term unlocks exam scores, attendance logs, and fee records for this term. Your reason will be permanently recorded in the school audit trail.
            </p>
            <form onSubmit={handleConfirmReopenTerm} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Audit Reason (Required)
                </label>
                <textarea
                  required
                  minLength={3}
                  rows={3}
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  placeholder="e.g. Correcting KNEC moderation remark for Grade 9 Science"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReopenTermTarget(null)}
                  className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={calendarSaving || reopenReason.trim().length < 3}
                  className="rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {calendarSaving ? 'Reopening...' : 'Confirm Reopen Term'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
