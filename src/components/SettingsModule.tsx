import { useState } from 'react';
import { Building2, Lock, Plus } from 'lucide-react';
import { saasApi } from '../lib/api';
import {
  KENYAN_CBC_GRADES,
  KENYAN_CBC_SUBJECTS,
  type CurrencyCode,
  type TenantWorkspaceData,
  type UserRole,
} from '../shared/types';

interface SettingsModuleProps {
  workspace: TenantWorkspaceData;
  currentRole: UserRole;
  onRefresh: () => Promise<void>;
  onSwitchTenant: (tenantId: string) => void;
  onNotify: (title: string, tone?: 'success' | 'error') => void;
}

export function SettingsModule({
  workspace,
  currentRole,
  onRefresh,
  onSwitchTenant,
  onNotify,
}: SettingsModuleProps) {
  const { tenant } = workspace;
  const canMutateTenant = currentRole === 'Admin' || currentRole === 'Super Admin';

  const [tenantForm, setTenantForm] = useState({
    name: tenant.name,
    curriculum: tenant.curriculum,
    academicYear: tenant.academicYear,
    currentTerm: tenant.currentTerm,
    currency: tenant.currency,
    location: tenant.location,
  });

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
        leadTeacherEmail: provisionForm.leadTeacherEmail || 'principal@school.edu',
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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Tenant Administration & Provisioning
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Configure {tenant.name} academic parameters, manage faculty/rooms/subjects, or spin up an isolated new school tenant.
        </p>
      </div>

      {!canMutateTenant && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          <Lock className="h-4 w-4 shrink-0" />
          <span>
            Tenant provisioning and metadata updates are protected by the backend Admin Service Layer. Switch Operator Role to <strong>Admin</strong> or <strong>Super Admin</strong> to save changes.
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
            Tenant ID: {tenant.id} · Slug: {tenant.slug}
          </p>

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
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

        {/* Provision New School Tenant */}
        <form
          onSubmit={handleProvisionTenant}
          className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-6 dark:border-slate-800 dark:bg-slate-900"
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
                placeholder="e.g. Seattle, WA"
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
      </div>
    </div>
  );
}
