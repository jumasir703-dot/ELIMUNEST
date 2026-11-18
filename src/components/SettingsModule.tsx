import { useCallback, useEffect, useState } from 'react';
import {
  Building2,
  Check,
  Copy,
  KeyRound,
  Lock,
  Plus,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { saasApi } from '../lib/api';
import {
  ALL_TENANT_MODULES,
  DEFAULT_ROLE_MODULES,
  getEffectiveUserModules,
  KENYAN_CBC_GRADES,
  KENYAN_CBC_SUBJECTS,
  suggestNameEmailLocalPart,
  type CurrencyCode,
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

  const [tenantUsers, setTenantUsers] = useState<TenantUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [staffFullName, setStaffFullName] = useState('');
  const [staffEmailHandle, setStaffEmailHandle] = useState('');
  const [staffHandleEdited, setStaffHandleEdited] = useState(false);
  const [staffPhone, setStaffPhone] = useState('');
  const [staffRole, setStaffRole] = useState<UserRole>('Teacher');
  const [staffModules, setStaffModules] = useState<TenantModulePermission[]>(
    DEFAULT_ROLE_MODULES.Teacher
  );
  const [creatingStaff, setCreatingStaff] = useState(false);
  const [issuedStaffOtp, setIssuedStaffOtp] = useState<{
    fullName: string;
    email: string;
    role: UserRole;
    oneTimePassword: string;
  } | null>(null);
  const [copiedStaffOtp, setCopiedStaffOtp] = useState(false);

  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<UserRole>('Teacher');
  const [editModules, setEditModules] = useState<TenantModulePermission[]>([]);
  const [editStatus, setEditStatus] = useState<'Active' | 'Disabled'>('Active');
  const [savingUserAccess, setSavingUserAccess] = useState(false);

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

  useEffect(() => {
    if (!staffHandleEdited) {
      setStaffEmailHandle(suggestNameEmailLocalPart(staffFullName));
    }
  }, [staffFullName, staffHandleEdited]);

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

  async function handleCreateStaffUser(e: React.FormEvent) {
    e.preventDefault();
    setCreatingStaff(true);
    setCopiedStaffOtp(false);
    try {
      const local = staffEmailHandle.trim().toLowerCase().replace(/@.*$/, '');
      const res = await saasApi.createTenantStaffUser(tenant.id, {
        fullName: staffFullName.trim(),
        email: `${local}@${domainSuffix}`,
        phone: staffPhone.trim() || undefined,
        role: staffRole,
        allowedModules: staffModules,
      });
      setIssuedStaffOtp({
        fullName: res.user.fullName,
        email: res.user.email,
        role: res.user.role,
        oneTimePassword: res.oneTimePassword,
      });
      setStaffFullName('');
      setStaffEmailHandle('');
      setStaffHandleEdited(false);
      setStaffPhone('');
      setStaffRole('Teacher');
      setStaffModules(DEFAULT_ROLE_MODULES.Teacher);
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
    setEditModules(getEffectiveUserModules(u));
    setEditStatus(u.status);
  }

  async function handleSaveUserAccess(targetUser: TenantUser, resetOtp = false) {
    setSavingUserAccess(true);
    setCopiedStaffOtp(false);
    try {
      const res = await saasApi.updateTenantUserAccess(tenant.id, targetUser.id, {
        role: editRole,
        allowedModules: editModules,
        status: editStatus,
        resetOneTimePassword: resetOtp,
      });
      if (res.oneTimePassword) {
        setIssuedStaffOtp({
          fullName: res.user.fullName,
          email: res.user.email,
          role: res.user.role,
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
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                  @{domainSuffix}
                </span>
                {canMutateTenant && (
                  <button
                    type="button"
                    onClick={() => setShowAddStaff((v) => !v)}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    {showAddStaff ? 'Cancel' : 'Add Staff'}
                  </button>
                )}
              </div>
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Assign roles and control which modules each staff member can access at {tenant.name}.
            </p>

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
                      Staff Full Name
                    </label>
                    <input
                      type="text"
                      required
                      value={staffFullName}
                      onChange={(e) => setStaffFullName(e.target.value)}
                      placeholder="e.g. Jane Wanjiku"
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300">
                      Staff Role
                    </label>
                    <select
                      value={staffRole}
                      onChange={(e) => {
                        const nextRole = e.target.value as UserRole;
                        setStaffRole(nextRole);
                        setStaffModules([...(DEFAULT_ROLE_MODULES[nextRole] || ['analytics'])]);
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      {STAFF_ROLE_OPTIONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
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
                              {u.role}
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
                                value={editRole}
                                disabled={isSelf}
                                onChange={(e) => {
                                  const nextRole = e.target.value as UserRole;
                                  setEditRole(nextRole);
                                }}
                                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                              >
                                {STAFF_ROLE_OPTIONS.map((r) => (
                                  <option key={r} value={r}>
                                    {r}
                                  </option>
                                ))}
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
                                  setEditModules([...(DEFAULT_ROLE_MODULES[editRole] || ['analytics'])])
                                }
                                className="text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
                              >
                                Apply {editRole} Defaults
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
    </div>
  );
}
