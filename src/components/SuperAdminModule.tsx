import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  Check,
  ExternalLink,
  Eye,
  History,
  ImagePlus,
  Palette,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import { saasApi } from '../lib/api';
import { formatCurrency } from '../lib/format';
import {
  getContrastForeground,
  getTenantInitials,
  hexToRgba,
  isLightColor,
  mixHex,
  normalizeHex,
  processLogoUploadFile,
} from '../lib/theme';
import {
  DEFAULT_TENANT_BRANDING,
  KENYAN_CBC_GRADES,
  KENYAN_CBC_SUBJECTS,
  TENANT_THEME_PRESETS,
  type AdminAuditAction,
  type AdminAuditEntry,
  type CurrencyCode,
  type SuperAdminTenantSummary,
  type Tenant,
  type TenantBranding,
  type TenantStatus,
  type TenantWorkspaceData,
  type UserRole,
} from '../shared/types';

interface SuperAdminModuleProps {
  workspace: TenantWorkspaceData;
  currentRole?: UserRole;
  onRefresh: () => Promise<void>;
  onPreviewBrandingChange?: (branding: TenantBranding | null) => void;
  onSwitchTenant: (tenantId: string, targetModule?: string) => void;
  onNotify: (title: string, tone?: 'success' | 'error') => void;
}

type SuperAdminTab = 'directory' | 'branding' | 'provision' | 'audit';

const AUDIT_ACTION_BADGES: Record<AdminAuditAction, string> = {
  PROVISION_TENANT:
    'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300',
  UPDATE_METADATA:
    'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300',
  CHANGE_STATUS:
    'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300',
  UPDATE_BRANDING:
    'border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-300',
  UPDATE_RESOURCES:
    'border-slate-200 bg-slate-100 text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
  DEPROVISION_TENANT:
    'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300',
};

const STATUS_BADGE_STYLES: Record<TenantStatus, string> = {
  Active:
    'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300',
  Trial:
    'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300',
  Suspended:
    'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300',
};

export function SuperAdminModule({
  workspace,
  currentRole = 'Super Admin',
  onRefresh,
  onPreviewBrandingChange,
  onSwitchTenant,
  onNotify,
}: SuperAdminModuleProps) {
  const [activeTab, setActiveTab] = useState<SuperAdminTab>('directory');
  const [summaries, setSummaries] = useState<SuperAdminTenantSummary[]>([]);
  const [loadingDirectory, setLoadingDirectory] = useState(true);
  const [auditLogs, setAuditLogs] = useState<AdminAuditEntry[]>([]);
  const [loadingAuditLogs, setLoadingAuditLogs] = useState(false);
  const [previewFullScreen, setPreviewFullScreen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [planFilter, setPlanFilter] = useState<'All' | 'Enterprise' | 'Growth'>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | TenantStatus>('All');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Customization editor state
  const [editingTenantId, setEditingTenantId] = useState<string>(workspace.tenant.id);
  const [editProfile, setEditProfile] = useState({
    name: workspace.tenant.name,
    location: workspace.tenant.location,
    curriculum: workspace.tenant.curriculum,
    academicYear: workspace.tenant.academicYear,
    currentTerm: workspace.tenant.currentTerm,
    currency: workspace.tenant.currency,
    plan: workspace.tenant.plan,
    status: (workspace.tenant.status || 'Active') as TenantStatus,
  });
  const [editBranding, setEditBranding] = useState({
    primaryColor: workspace.tenant.branding?.primaryColor || DEFAULT_TENANT_BRANDING.primaryColor,
    accentColor: workspace.tenant.branding?.accentColor || DEFAULT_TENANT_BRANDING.accentColor,
    sidebarColor: workspace.tenant.branding?.sidebarColor || '',
    logoDataUrl: workspace.tenant.branding?.logoDataUrl || '',
    tagline: workspace.tenant.branding?.tagline || '',
  });
  const [savingBranding, setSavingBranding] = useState(false);
  const editLogoInputRef = useRef<HTMLInputElement | null>(null);

  // Provision New Tenant state
  const [provisionForm, setProvisionForm] = useState({
    name: '',
    curriculum: 'Kenyan CBC (Playgroup – Grade 12)',
    academicYear: '2026–2027',
    currentTerm: 'Term 1',
    currency: 'KES' as CurrencyCode,
    plan: 'Enterprise' as 'Enterprise' | 'Growth',
    status: 'Active' as TenantStatus,
    location: '',
    gradesText: KENYAN_CBC_GRADES.join(', '),
    subjectsText: KENYAN_CBC_SUBJECTS.join(', '),
    roomsText: 'Room 101, Room 102, Science Lab, ICT Lab, Library',
    leadTeacherName: '',
    leadTeacherEmail: '',
    primaryColor: '#2563EB',
    accentColor: '#0284C7',
    sidebarColor: '',
    logoDataUrl: '',
    tagline: '',
  });
  const [provisioning, setProvisioning] = useState(false);
  const [switchAfterCreate, setSwitchAfterCreate] = useState(false);
  const provisionLogoInputRef = useRef<HTMLInputElement | null>(null);

  const loadDirectory = useCallback(async () => {
    setLoadingDirectory(true);
    try {
      const { summaries: list } = await saasApi.getSuperAdminTenants();
      setSummaries(list);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Unable to load tenant directory',
        'error'
      );
    } finally {
      setLoadingDirectory(false);
    }
  }, [onNotify]);

  const loadAuditLogs = useCallback(async () => {
    setLoadingAuditLogs(true);
    try {
      const { logs } = await saasApi.getAdminAuditLogs(60);
      setAuditLogs(logs);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Unable to load admin audit trail',
        'error'
      );
    } finally {
      setLoadingAuditLogs(false);
    }
  }, [onNotify]);

  useEffect(() => {
    loadDirectory();
  }, [loadDirectory, workspace.tenants.length, currentRole]);

  useEffect(() => {
    if (activeTab === 'audit') {
      loadAuditLogs();
    }
  }, [activeTab, loadAuditLogs]);

  useEffect(() => {
    if (!onPreviewBrandingChange) return;
    if (activeTab === 'branding' && previewFullScreen) {
      onPreviewBrandingChange({
        primaryColor: normalizeHex(editBranding.primaryColor, '#2563EB'),
        accentColor: normalizeHex(editBranding.accentColor, '#0F766E'),
        sidebarColor: editBranding.sidebarColor.trim()
          ? normalizeHex(editBranding.sidebarColor, '#0F172A')
          : '',
        logoDataUrl: editBranding.logoDataUrl,
        tagline: editBranding.tagline.trim(),
      });
    } else {
      onPreviewBrandingChange(null);
    }
  }, [activeTab, previewFullScreen, editBranding, onPreviewBrandingChange]);

  useEffect(() => {
    return () => {
      onPreviewBrandingChange?.(null);
    };
  }, [onPreviewBrandingChange]);

  const populateEditorFromTenant = useCallback((target: Tenant) => {
    setEditProfile({
      name: target.name,
      location: target.location,
      curriculum: target.curriculum,
      academicYear: target.academicYear,
      currentTerm: target.currentTerm,
      currency: target.currency,
      plan: target.plan,
      status: target.status || 'Active',
    });
    setEditBranding({
      primaryColor: target.branding?.primaryColor || DEFAULT_TENANT_BRANDING.primaryColor,
      accentColor: target.branding?.accentColor || DEFAULT_TENANT_BRANDING.accentColor,
      sidebarColor: target.branding?.sidebarColor || '',
      logoDataUrl: target.branding?.logoDataUrl || '',
      tagline: target.branding?.tagline || '',
    });
  }, []);

  // Sync selected tenant into editor when tenant list refreshes or user changes selection
  useEffect(() => {
    const found =
      summaries.find((s) => s.tenant.id === editingTenantId)?.tenant ||
      workspace.tenants.find((t) => t.id === editingTenantId) ||
      workspace.tenant;
    if (found) {
      if (found.id !== editingTenantId) setEditingTenantId(found.id);
      populateEditorFromTenant(found);
    }
  }, [editingTenantId, summaries, workspace.tenants, workspace.tenant, populateEditorFromTenant]);

  const platformMetrics = useMemo(() => {
    const totalTenants = summaries.length;
    const activeTenants = summaries.filter(
      (s) => (s.tenant.status || 'Active') === 'Active'
    ).length;
    const totalStudents = summaries.reduce((acc, s) => acc + s.studentCount, 0);
    const totalStaff = summaries.reduce(
      (acc, s) => acc + s.teacherCount + s.nonTeachingCount,
      0
    );
    const customBrandedCount = summaries.filter(
      (s) =>
        Boolean(s.tenant.branding?.logoDataUrl) ||
        (s.tenant.branding?.primaryColor &&
          s.tenant.branding.primaryColor.toUpperCase() !== '#2563EB')
    ).length;
    return {
      totalTenants,
      activeTenants,
      totalStudents,
      totalStaff,
      customBrandedCount,
    };
  }, [summaries]);

  const filteredSummaries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return summaries.filter(({ tenant }) => {
      if (planFilter !== 'All' && tenant.plan !== planFilter) return false;
      const st = tenant.status || 'Active';
      if (statusFilter !== 'All' && st !== statusFilter) return false;
      if (!q) return true;
      return (
        tenant.name.toLowerCase().includes(q) ||
        tenant.location.toLowerCase().includes(q) ||
        tenant.slug.toLowerCase().includes(q) ||
        tenant.curriculum.toLowerCase().includes(q)
      );
    });
  }, [summaries, searchQuery, planFilter, statusFilter]);

  async function handleLogoFileChange(
    file: File | undefined,
    target: 'edit' | 'provision'
  ) {
    if (!file) return;
    try {
      const dataUrl = await processLogoUploadFile(file);
      if (target === 'edit') {
        setEditBranding((prev) => ({ ...prev, logoDataUrl: dataUrl }));
      } else {
        setProvisionForm((prev) => ({ ...prev, logoDataUrl: dataUrl }));
      }
      onNotify(`Logo "${file.name}" ready.`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Unable to process logo file',
        'error'
      );
    }
  }

  async function handleSaveBranding(switchAfterSave = false) {
    if (!editProfile.name.trim()) {
      onNotify('School name cannot be empty.', 'error');
      return;
    }
    setSavingBranding(true);
    try {
      const primaryColor = normalizeHex(editBranding.primaryColor, '#2563EB');
      const accentColor = normalizeHex(editBranding.accentColor, '#0F766E');
      const sidebarColor = editBranding.sidebarColor.trim()
        ? normalizeHex(editBranding.sidebarColor, '#0F172A')
        : '';

      await saasApi.updateTenantBranding(editingTenantId, {
        name: editProfile.name.trim(),
        location: editProfile.location.trim(),
        curriculum: editProfile.curriculum.trim(),
        academicYear: editProfile.academicYear.trim(),
        currentTerm: editProfile.currentTerm.trim(),
        currency: editProfile.currency,
        plan: editProfile.plan,
        status: editProfile.status,
        branding: {
          primaryColor,
          accentColor,
          sidebarColor,
          logoDataUrl: editBranding.logoDataUrl,
          tagline: editBranding.tagline.trim(),
        },
      });
      await Promise.all([loadDirectory(), onRefresh()]);
      onNotify(`Updated theme, logo, and settings for ${editProfile.name.trim()}.`);
      if (switchAfterSave) {
        onSwitchTenant(editingTenantId, 'analytics');
      }
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to save tenant customization',
        'error'
      );
    } finally {
      setSavingBranding(false);
    }
  }

  async function handleQuickStatusChange(tenant: Tenant, nextStatus: TenantStatus) {
    try {
      await saasApi.updateTenant(tenant.id, { status: nextStatus });
      await Promise.all([loadDirectory(), onRefresh()]);
      onNotify(`${tenant.name} status updated to ${nextStatus}.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Status update failed', 'error');
    }
  }

  async function handleDeleteTenant(tenant: Tenant) {
    setDeletingId(tenant.id);
    try {
      const { remainingTenants } = await saasApi.deleteTenant(tenant.id);
      setConfirmDeleteId(null);
      if (tenant.id === workspace.tenant.id && remainingTenants[0]) {
        onSwitchTenant(remainingTenants[0].id, 'super-admin');
      }
      await Promise.all([loadDirectory(), onRefresh()]);
      onNotify(`Tenant "${tenant.name}" removed from platform.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not delete tenant', 'error');
    } finally {
      setDeletingId(null);
    }
  }

  async function handleProvisionNewTenant(e: React.FormEvent) {
    e.preventDefault();
    if (!provisionForm.name.trim()) {
      onNotify('Enter the new school / tenant name.', 'error');
      return;
    }
    setProvisioning(true);
    try {
      const { tenant: created } = await saasApi.createTenant({
        name: provisionForm.name.trim(),
        curriculum: provisionForm.curriculum.trim(),
        academicYear: provisionForm.academicYear.trim(),
        currentTerm: provisionForm.currentTerm.trim(),
        currency: provisionForm.currency,
        plan: provisionForm.plan,
        status: provisionForm.status,
        location: provisionForm.location.trim() || 'Nairobi, KE',
        branding: {
          primaryColor: normalizeHex(provisionForm.primaryColor, '#2563EB'),
          accentColor: normalizeHex(provisionForm.accentColor, '#0284C7'),
          sidebarColor: provisionForm.sidebarColor.trim()
            ? normalizeHex(provisionForm.sidebarColor, '#0F172A')
            : '',
          logoDataUrl: provisionForm.logoDataUrl,
          tagline: provisionForm.tagline.trim(),
        },
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
        leadTeacherName: provisionForm.leadTeacherName.trim() || 'Principal Admin',
        leadTeacherEmail: provisionForm.leadTeacherEmail.trim() || 'principal@school.ac.ke',
      });

      await Promise.all([loadDirectory(), onRefresh()]);
      setEditingTenantId(created.id);
      onNotify(`New tenant "${created.name}" provisioned with custom branding.`);
      setProvisionForm((prev) => ({
        ...prev,
        name: '',
        location: '',
        leadTeacherName: '',
        leadTeacherEmail: '',
        logoDataUrl: '',
        tagline: '',
      }));

      if (switchAfterCreate) {
        onSwitchTenant(created.id, 'analytics');
      } else {
        setActiveTab('directory');
      }
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Tenant provisioning failed',
        'error'
      );
    } finally {
      setProvisioning(false);
    }
  }

  const previewPrimary = normalizeHex(editBranding.primaryColor, '#2563EB');
  const previewAccent = normalizeHex(editBranding.accentColor, '#0F766E');
  const previewPrimaryFg = getContrastForeground(previewPrimary);
  const previewSidebarBg = editBranding.sidebarColor.trim()
    ? normalizeHex(editBranding.sidebarColor, '#0F172A')
    : mixHex(previewPrimary, '#FFFFFF', 0.88);
  const previewSidebarLight = isLightColor(previewSidebarBg);
  const previewCanvasBg = mixHex(previewPrimary, '#FFFFFF', 0.88);
  const previewCardBg = mixHex(previewPrimary, '#FFFFFF', 0.96);

  return (
    <div className="space-y-6">
      {/* Header & Workspace Tabs */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Multi-Tenant Platform Console</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{platformMetrics.totalTenants} Schools</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Super Admin Panel
          </h1>
          <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
            Add school tenants, manage plans & status, customize platform colour themes, and upload school logos.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          <button
            type="button"
            onClick={() => setActiveTab('directory')}
            className={`whitespace-nowrap shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === 'directory'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Tenants Directory
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('branding')}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === 'branding'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Palette className="h-3.5 w-3.5" />
            Theme & Logo
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('provision')}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === 'provision'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Plus className="h-3.5 w-3.5" />
            Add Tenant
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('audit')}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === 'audit'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <History className="h-3.5 w-3.5" />
            Service Audit Log
          </button>
        </div>
      </div>

      {/* Platform KPI Strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Total Tenants
          </p>
          <p className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
            {platformMetrics.totalTenants}
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums dark:text-slate-400">
            {platformMetrics.activeTenants} Active schools
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Platform Learners
          </p>
          <p className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
            {platformMetrics.totalStudents}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Across all school workspaces
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Total Faculty & Staff
          </p>
          <p className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
            {platformMetrics.totalStaff}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Teaching & non-teaching
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Custom Branded Schools
          </p>
          <p className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
            {platformMetrics.customBrandedCount}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Custom themes or uploaded logos
          </p>
        </div>
      </div>

      {activeTab === 'directory' ? (
        <div className="space-y-4">
          {/* Search & Filters */}
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-[240px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search school, city, slug..."
                  className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <select
                aria-label="Filter tenants by plan"
                value={planFilter}
                onChange={(e) =>
                  setPlanFilter(e.target.value as 'All' | 'Enterprise' | 'Growth')
                }
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="All">All Plans</option>
                <option value="Enterprise">Enterprise</option>
                <option value="Growth">Growth</option>
              </select>

              <select
                aria-label="Filter tenants by status"
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as 'All' | TenantStatus)
                }
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="All">All Statuses</option>
                <option value="Active">Active</option>
                <option value="Trial">Trial</option>
                <option value="Suspended">Suspended</option>
              </select>
            </div>

            <button
              type="button"
              onClick={() => setActiveTab('provision')}
              className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-700"
            >
              <Plus className="h-3.5 w-3.5" />
              Add New Tenant
            </button>
          </div>

          {/* Tenant Table */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3">School Tenant</th>
                    <th className="px-4 py-3">Curriculum & Term</th>
                    <th className="px-4 py-3">Plan & Status</th>
                    <th className="px-4 py-3">Theme Palette</th>
                    <th className="px-4 py-3 text-right">Learners / Staff</th>
                    <th className="px-4 py-3 text-right">Fee Collected</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {loadingDirectory ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-12 text-center text-xs text-slate-500 dark:text-slate-400"
                      >
                        Loading school tenants...
                      </td>
                    </tr>
                  ) : filteredSummaries.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-12 text-center text-xs text-slate-500 dark:text-slate-400"
                      >
                        No school tenants match the active search or filter criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredSummaries.map((item) => {
                      const { tenant } = item;
                      const primary = normalizeHex(
                        tenant.branding?.primaryColor,
                        DEFAULT_TENANT_BRANDING.primaryColor
                      );
                      const accent = normalizeHex(
                        tenant.branding?.accentColor,
                        DEFAULT_TENANT_BRANDING.accentColor
                      );
                      const status: TenantStatus = tenant.status || 'Active';
                      const isCurrent = tenant.id === workspace.tenant.id;
                      const confirmingDelete = confirmDeleteId === tenant.id;

                      return (
                        <tr
                          key={tenant.id}
                          className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30"
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              {tenant.branding?.logoDataUrl ? (
                                <img
                                  src={tenant.branding.logoDataUrl}
                                  alt={`${tenant.name} logo`}
                                  referrerPolicy="no-referrer"
                                  className="h-9 w-9 shrink-0 rounded-lg border border-slate-200 bg-white object-contain p-0.5 dark:border-slate-700"
                                />
                              ) : (
                                <div
                                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold"
                                  style={{
                                    backgroundColor: primary,
                                    color: getContrastForeground(primary),
                                  }}
                                >
                                  {getTenantInitials(tenant.name)}
                                </div>
                              )}
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="truncate font-semibold text-slate-900 dark:text-slate-100">
                                    {tenant.name}
                                  </span>
                                  {isCurrent && (
                                    <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                                      Current
                                    </span>
                                  )}
                                </div>
                                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                                  {tenant.location} ·{' '}
                                  <span className="font-mono">{tenant.slug}</span>
                                </p>
                              </div>
                            </div>
                          </td>

                          <td className="px-4 py-3 text-xs text-slate-700 dark:text-slate-300">
                            <div className="font-medium">{tenant.curriculum}</div>
                            <div className="mt-0.5 text-slate-500 dark:text-slate-400">
                              {tenant.academicYear} · {tenant.currentTerm}
                            </div>
                          </td>

                          <td className="px-4 py-3 text-xs">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-slate-700 dark:text-slate-300">
                                {tenant.plan}
                              </span>
                              <select
                                aria-label={`Status for ${tenant.name}`}
                                value={status}
                                onChange={(e) =>
                                  handleQuickStatusChange(
                                    tenant,
                                    e.target.value as TenantStatus
                                  )
                                }
                                className={`rounded border px-2 py-0.5 text-[11px] font-semibold focus:outline-none ${STATUS_BADGE_STYLES[status]}`}
                              >
                                <option value="Active">Active</option>
                                <option value="Trial">Trial</option>
                                <option value="Suspended">Suspended</option>
                              </select>
                            </div>
                          </td>

                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span
                                className="h-5 w-5 rounded border border-slate-200 dark:border-slate-700"
                                style={{ backgroundColor: primary }}
                                title={`Primary: ${primary}`}
                              />
                              <span
                                className="h-5 w-5 rounded border border-slate-200 dark:border-slate-700"
                                style={{ backgroundColor: accent }}
                                title={`Accent: ${accent}`}
                              />
                              <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                                {primary}
                              </span>
                            </div>
                          </td>

                          <td className="px-4 py-3 text-right font-mono text-xs text-slate-700 tabular-nums dark:text-slate-300">
                            <div>{item.studentCount} learners</div>
                            <div className="text-slate-500 dark:text-slate-400">
                              {item.teacherCount}T · {item.nonTeachingCount}NT
                            </div>
                          </td>

                          <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              {formatCurrency(item.totalCollected, tenant.currency)}
                            </div>
                            <div className="text-slate-500 dark:text-slate-400">
                              of {formatCurrency(item.totalBilled, tenant.currency)}
                            </div>
                          </td>

                          <td className="px-4 py-3 text-right">
                            {confirmingDelete ? (
                              <div className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  disabled={deletingId === tenant.id}
                                  onClick={() => handleDeleteTenant(tenant)}
                                  className="rounded border border-red-300 bg-red-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-700 disabled:opacity-50"
                                >
                                  {deletingId === tenant.id ? 'Removing...' : 'Confirm'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingTenantId(tenant.id);
                                    populateEditorFromTenant(tenant);
                                    setActiveTab('branding');
                                  }}
                                  className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                                >
                                  <Palette className="h-3 w-3" />
                                  Customize
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onSwitchTenant(tenant.id, 'analytics')}
                                  className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                  Open
                                </button>
                                {summaries.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteId(tenant.id)}
                                    aria-label={`Delete ${tenant.name}`}
                                    className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : activeTab === 'branding' ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left Column: Tenant Profile, Logo Upload, & Colour Theme Controls */}
          <div className="space-y-6 lg:col-span-7">
            {/* Target Tenant Selector */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Select Tenant to Customize
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Changes update the selected school&apos;s workspace logo, theme palette, and configuration.
                  </p>
                </div>
                <select
                  aria-label="Select tenant to customize"
                  value={editingTenantId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setEditingTenantId(nextId);
                    const found =
                      summaries.find((s) => s.tenant.id === nextId)?.tenant ||
                      workspace.tenants.find((t) => t.id === nextId);
                    if (found) populateEditorFromTenant(found);
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  {workspace.tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.location})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Logo Uploader */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ImagePlus className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      School Logo & Wordmark Identity
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Upload PNG, JPG, WEBP, or SVG crest/logo. Appears in sidebar navigation and workspace header.
                    </p>
                  </div>
                </div>
                {editBranding.logoDataUrl && (
                  <button
                    type="button"
                    onClick={() => setEditBranding((prev) => ({ ...prev, logoDataUrl: '' }))}
                    className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                  >
                    Remove Logo
                  </button>
                )}
              </div>

              <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex items-center gap-3">
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-700">
                    {editBranding.logoDataUrl ? (
                      <img
                        src={editBranding.logoDataUrl}
                        alt="Light background logo preview"
                        referrerPolicy="no-referrer"
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : (
                      <span
                        className="flex h-12 w-12 items-center justify-center rounded-lg text-sm font-bold"
                        style={{
                          backgroundColor: previewPrimary,
                          color: previewPrimaryFg,
                        }}
                      >
                        {getTenantInitials(editProfile.name || 'School')}
                      </span>
                    )}
                  </div>
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 p-2">
                    {editBranding.logoDataUrl ? (
                      <img
                        src={editBranding.logoDataUrl}
                        alt="Dark background logo preview"
                        referrerPolicy="no-referrer"
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : (
                      <span
                        className="flex h-12 w-12 items-center justify-center rounded-lg text-sm font-bold"
                        style={{
                          backgroundColor: previewPrimary,
                          color: previewPrimaryFg,
                        }}
                      >
                        {getTenantInitials(editProfile.name || 'School')}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex-1 space-y-2.5">
                  <input
                    ref={editLogoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    onChange={(e) => {
                      handleLogoFileChange(e.target.files?.[0], 'edit');
                      e.target.value = '';
                    }}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => editLogoInputRef.current?.click()}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Upload School Logo
                  </button>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                      School Tagline / Motto
                    </label>
                    <input
                      type="text"
                      value={editBranding.tagline}
                      onChange={(e) =>
                        setEditBranding((prev) => ({ ...prev, tagline: e.target.value }))
                      }
                      placeholder="e.g. Strive for Excellence"
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Colour Theme Studio */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Palette className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Platform Colour Theme
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Pick a curated palette or choose custom hex colours for primary actions, active navigation, and sidebar surface.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setEditBranding((prev) => ({
                      ...prev,
                      primaryColor: DEFAULT_TENANT_BRANDING.primaryColor,
                      accentColor: DEFAULT_TENANT_BRANDING.accentColor,
                      sidebarColor: '',
                    }))
                  }
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  <RotateCcw className="h-3 w-3" />
                  Reset Colors
                </button>
              </div>

              {/* Preset Swatches */}
              <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {TENANT_THEME_PRESETS.map((preset) => {
                  const isSelected =
                    normalizeHex(editBranding.primaryColor) === preset.primaryColor &&
                    normalizeHex(editBranding.accentColor) === preset.accentColor &&
                    (editBranding.sidebarColor || '') === preset.sidebarColor;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() =>
                        setEditBranding((prev) => ({
                          ...prev,
                          primaryColor: preset.primaryColor,
                          accentColor: preset.accentColor,
                          sidebarColor: preset.sidebarColor,
                        }))
                      }
                      className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                        isSelected
                          ? 'border-slate-900 bg-slate-50 font-semibold text-slate-900 dark:border-slate-200 dark:bg-slate-800 dark:text-slate-100'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span className="truncate">{preset.name}</span>
                      <span className="ml-2 flex shrink-0 items-center gap-1">
                        <span
                          className="h-3.5 w-3.5 rounded-sm border border-black/10"
                          style={{ backgroundColor: preset.primaryColor }}
                        />
                        <span
                          className="h-3.5 w-3.5 rounded-sm border border-black/10"
                          style={{ backgroundColor: preset.accentColor }}
                        />
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Custom Hex Pickers */}
              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Primary Brand Colour
                  </label>
                  <div className="mt-1.5 flex items-center gap-2">
                    <input
                      type="color"
                      aria-label="Primary brand color picker"
                      value={previewPrimary}
                      onChange={(e) =>
                        setEditBranding((prev) => ({
                          ...prev,
                          primaryColor: e.target.value.toUpperCase(),
                        }))
                      }
                      className="h-9 w-11 shrink-0 cursor-pointer rounded border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-800"
                    />
                    <input
                      type="text"
                      value={editBranding.primaryColor}
                      onChange={(e) =>
                        setEditBranding((prev) => ({ ...prev, primaryColor: e.target.value }))
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 uppercase dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Secondary Accent Colour
                  </label>
                  <div className="mt-1.5 flex items-center gap-2">
                    <input
                      type="color"
                      aria-label="Secondary accent color picker"
                      value={previewAccent}
                      onChange={(e) =>
                        setEditBranding((prev) => ({
                          ...prev,
                          accentColor: e.target.value.toUpperCase(),
                        }))
                      }
                      className="h-9 w-11 shrink-0 cursor-pointer rounded border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-800"
                    />
                    <input
                      type="text"
                      value={editBranding.accentColor}
                      onChange={(e) =>
                        setEditBranding((prev) => ({ ...prev, accentColor: e.target.value }))
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 uppercase dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Sidebar Surface (Optional)
                    </label>
                    {editBranding.sidebarColor && (
                      <button
                        type="button"
                        onClick={() =>
                          setEditBranding((prev) => ({ ...prev, sidebarColor: '' }))
                        }
                        className="text-[11px] text-slate-500 hover:underline dark:text-slate-400"
                      >
                        Neutral
                      </button>
                    )}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <input
                      type="color"
                      aria-label="Sidebar background color picker"
                      value={
                        editBranding.sidebarColor
                          ? normalizeHex(editBranding.sidebarColor, '#0F172A')
                          : '#0F172A'
                      }
                      onChange={(e) =>
                        setEditBranding((prev) => ({
                          ...prev,
                          sidebarColor: e.target.value.toUpperCase(),
                        }))
                      }
                      className="h-9 w-11 shrink-0 cursor-pointer rounded border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-800"
                    />
                    <input
                      type="text"
                      value={editBranding.sidebarColor}
                      placeholder="Default neutral"
                      onChange={(e) =>
                        setEditBranding((prev) => ({ ...prev, sidebarColor: e.target.value }))
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 uppercase placeholder:normal-case dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Tenant Metadata & Lifecycle */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Tenant Profile, Plan & Status
              </h2>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    School Name
                  </label>
                  <input
                    type="text"
                    value={editProfile.name}
                    onChange={(e) =>
                      setEditProfile((prev) => ({ ...prev, name: e.target.value }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Location / City
                  </label>
                  <input
                    type="text"
                    value={editProfile.location}
                    onChange={(e) =>
                      setEditProfile((prev) => ({ ...prev, location: e.target.value }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Curriculum
                  </label>
                  <input
                    type="text"
                    value={editProfile.curriculum}
                    onChange={(e) =>
                      setEditProfile((prev) => ({ ...prev, curriculum: e.target.value }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    SaaS Plan
                  </label>
                  <select
                    value={editProfile.plan}
                    onChange={(e) =>
                      setEditProfile((prev) => ({
                        ...prev,
                        plan: e.target.value as 'Enterprise' | 'Growth',
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value="Enterprise">Enterprise</option>
                    <option value="Growth">Growth</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Tenant Status
                  </label>
                  <select
                    value={editProfile.status}
                    onChange={(e) =>
                      setEditProfile((prev) => ({
                        ...prev,
                        status: e.target.value as TenantStatus,
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value="Active">Active</option>
                    <option value="Trial">Trial</option>
                    <option value="Suspended">Suspended</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Academic Year
                  </label>
                  <input
                    type="text"
                    value={editProfile.academicYear}
                    onChange={(e) =>
                      setEditProfile((prev) => ({ ...prev, academicYear: e.target.value }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Active Term & Currency
                  </label>
                  <div className="mt-1 flex gap-2">
                    <input
                      type="text"
                      value={editProfile.currentTerm}
                      onChange={(e) =>
                        setEditProfile((prev) => ({ ...prev, currentTerm: e.target.value }))
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                    <select
                      value={editProfile.currency}
                      onChange={(e) =>
                        setEditProfile((prev) => ({
                          ...prev,
                          currency: e.target.value as CurrencyCode,
                        }))
                      }
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    >
                      <option value="KES">KES (KSh)</option>
                      <option value="USD">USD ($)</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-end gap-2.5 border-t border-slate-100 pt-4 dark:border-slate-800">
                <button
                  type="button"
                  disabled={savingBranding}
                  onClick={() => handleSaveBranding(false)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  <Check className="h-3.5 w-3.5" />
                  {savingBranding ? 'Saving...' : 'Save Customization'}
                </button>
                <button
                  type="button"
                  disabled={savingBranding}
                  onClick={() => handleSaveBranding(true)}
                  style={{ backgroundColor: previewPrimary, color: previewPrimaryFg }}
                  className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium hover:opacity-90 disabled:opacity-50"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {savingBranding ? 'Saving...' : 'Save & Open School Portal'}
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Live Tenant Portal Preview */}
          <div className="lg:col-span-5">
            <div className="sticky top-24 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Live Tenant Portal Preview
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Full-screen theme across sidebar, header, canvas, and cards
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPreviewFullScreen((v) => !v)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    previewFullScreen
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                  }`}
                >
                  <Eye className="h-3 w-3" />
                  {previewFullScreen ? 'Full-Screen Preview On' : 'Preview Full Screen'}
                </button>
              </div>

              {/* Mini Mock Shell */}
              <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
                <div
                  className="h-1 w-full"
                  style={{
                    background: `linear-gradient(90deg, ${previewPrimary}, ${previewAccent})`,
                  }}
                />
                <div className="grid grid-cols-12">
                  {/* Mini Sidebar */}
                  <div
                    className="col-span-5 border-r p-3"
                    style={{
                      backgroundColor: previewSidebarBg,
                      borderColor: previewSidebarLight
                        ? '#E2E8F0'
                        : 'rgba(255,255,255,0.12)',
                      color: previewSidebarLight ? '#0F172A' : '#F8FAFC',
                    }}
                  >
                    <div className="flex items-center gap-2 border-b pb-2.5" style={{ borderColor: previewSidebarLight ? '#E2E8F0' : 'rgba(255,255,255,0.12)' }}>
                      {editBranding.logoDataUrl ? (
                        <img
                          src={editBranding.logoDataUrl}
                          alt="Preview school logo"
                          referrerPolicy="no-referrer"
                          className="h-8 w-8 shrink-0 rounded-md bg-white object-contain p-0.5"
                        />
                      ) : (
                        <div
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[11px] font-bold"
                          style={{
                            backgroundColor: previewPrimary,
                            color: previewPrimaryFg,
                          }}
                        >
                          {getTenantInitials(editProfile.name || 'School')}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold">
                          {editProfile.name || 'School Name'}
                        </p>
                        <p
                          className="truncate text-[10px]"
                          style={{
                            color: previewSidebarLight ? '#64748B' : 'rgba(248,250,252,0.72)',
                          }}
                        >
                          {editBranding.tagline || editProfile.location}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 space-y-1 text-[11px]">
                      <div
                        className="rounded-md px-2.5 py-1.5 font-semibold"
                        style={{
                          backgroundColor: previewSidebarLight
                            ? hexToRgba(previewPrimary, 0.12)
                            : hexToRgba('#FFFFFF', 0.14),
                          color: previewSidebarLight ? previewPrimary : '#FFFFFF',
                        }}
                      >
                        Analytics
                      </div>
                      <div
                        className="px-2.5 py-1.5"
                        style={{
                          color: previewSidebarLight ? '#475569' : 'rgba(248,250,252,0.76)',
                        }}
                      >
                        Attendance
                      </div>
                      <div
                        className="px-2.5 py-1.5"
                        style={{
                          color: previewSidebarLight ? '#475569' : 'rgba(248,250,252,0.76)',
                        }}
                      >
                        Exams & Grades
                      </div>
                      <div
                        className="px-2.5 py-1.5"
                        style={{
                          color: previewSidebarLight ? '#475569' : 'rgba(248,250,252,0.76)',
                        }}
                      >
                        Fees & Billing
                      </div>
                    </div>
                  </div>

                  {/* Mini Content Canvas */}
                  <div
                    className="col-span-7 p-3"
                    style={{ backgroundColor: previewCanvasBg }}
                  >
                    <div
                      className="flex items-center justify-between border-b pb-2"
                      style={{ borderColor: hexToRgba(previewPrimary, 0.2) }}
                    >
                      <span className="truncate text-[11px] font-semibold text-slate-900">
                        {editProfile.name}
                      </span>
                      <span className="text-[10px] font-medium text-slate-600">
                        {editProfile.currentTerm}
                      </span>
                    </div>

                    <div className="mt-3 space-y-2.5">
                      <div
                        className="rounded-lg border p-2.5"
                        style={{
                          backgroundColor: previewCardBg,
                          borderColor: hexToRgba(previewPrimary, 0.2),
                        }}
                      >
                        <p className="text-[10px] text-slate-600">
                          Attendance Benchmark
                        </p>
                        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full"
                            style={{ width: '82%', backgroundColor: previewPrimary }}
                          />
                        </div>
                        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full"
                            style={{ width: '68%', backgroundColor: previewAccent }}
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block rounded-md px-2.5 py-1 text-[11px] font-medium"
                          style={{
                            backgroundColor: previewPrimary,
                            color: previewPrimaryFg,
                          }}
                        >
                          Primary Action
                        </span>
                        <span
                          className="inline-block rounded-md border px-2 py-1 text-[11px] font-medium"
                          style={{
                            borderColor: hexToRgba(previewAccent, 0.35),
                            backgroundColor: hexToRgba(previewAccent, 0.1),
                            color: previewAccent,
                          }}
                        >
                          Accent State
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-1.5 text-xs text-slate-500 dark:text-slate-400">
                <div className="flex items-center justify-between">
                  <span>Primary Action Colour</span>
                  <span className="font-mono text-slate-800 dark:text-slate-200">
                    {previewPrimary}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Secondary Accent Colour</span>
                  <span className="font-mono text-slate-800 dark:text-slate-200">
                    {previewAccent}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Sidebar Surface</span>
                  <span className="font-mono text-slate-800 dark:text-slate-200">
                    {editBranding.sidebarColor ? previewSidebarBg : `${previewSidebarBg} (Auto)`}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : activeTab === 'provision' ? (
        <form
          onSubmit={handleProvisionNewTenant}
          className="grid grid-cols-1 gap-6 lg:grid-cols-12"
        >
          {/* Left: Tenant Details */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-7 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                New School Tenant Details
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Creates a fully isolated school tenant with CBC/8-4-4 grading, fee schedules, staff rosters, and custom branding.
            </p>

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Institution / School Name
                </label>
                <input
                  required
                  type="text"
                  value={provisionForm.name}
                  onChange={(e) =>
                    setProvisionForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder="e.g. Strathmore Ridge Academy"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  City / Location
                </label>
                <input
                  type="text"
                  value={provisionForm.location}
                  onChange={(e) =>
                    setProvisionForm((prev) => ({ ...prev, location: e.target.value }))
                  }
                  placeholder="e.g. Nakuru, KE"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Curriculum
                </label>
                <input
                  type="text"
                  value={provisionForm.curriculum}
                  onChange={(e) =>
                    setProvisionForm((prev) => ({ ...prev, curriculum: e.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  SaaS Plan
                </label>
                <select
                  value={provisionForm.plan}
                  onChange={(e) =>
                    setProvisionForm((prev) => ({
                      ...prev,
                      plan: e.target.value as 'Enterprise' | 'Growth',
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="Enterprise">Enterprise</option>
                  <option value="Growth">Growth</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Initial Status
                </label>
                <select
                  value={provisionForm.status}
                  onChange={(e) =>
                    setProvisionForm((prev) => ({
                      ...prev,
                      status: e.target.value as TenantStatus,
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="Active">Active</option>
                  <option value="Trial">Trial</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Academic Year & Term
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    type="text"
                    value={provisionForm.academicYear}
                    onChange={(e) =>
                      setProvisionForm((prev) => ({
                        ...prev,
                        academicYear: e.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                  <input
                    type="text"
                    value={provisionForm.currentTerm}
                    onChange={(e) =>
                      setProvisionForm((prev) => ({
                        ...prev,
                        currentTerm: e.target.value,
                      }))
                    }
                    className="w-28 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Currency
                </label>
                <select
                  value={provisionForm.currency}
                  onChange={(e) =>
                    setProvisionForm((prev) => ({
                      ...prev,
                      currency: e.target.value as CurrencyCode,
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="KES">KES (Kenya Shilling)</option>
                  <option value="USD">USD (US Dollar)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Lead Principal Name
                </label>
                <input
                  type="text"
                  value={provisionForm.leadTeacherName}
                  onChange={(e) =>
                    setProvisionForm((prev) => ({
                      ...prev,
                      leadTeacherName: e.target.value,
                    }))
                  }
                  placeholder="e.g. Dr. Margaret Karanja"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Lead Principal Email
                </label>
                <input
                  type="email"
                  value={provisionForm.leadTeacherEmail}
                  onChange={(e) =>
                    setProvisionForm((prev) => ({
                      ...prev,
                      leadTeacherEmail: e.target.value,
                    }))
                  }
                  placeholder="principal@school.ac.ke"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Grades (comma-separated)
                </label>
                <input
                  type="text"
                  value={provisionForm.gradesText}
                  onChange={(e) =>
                    setProvisionForm((prev) => ({
                      ...prev,
                      gradesText: e.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
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
                    setProvisionForm((prev) => ({
                      ...prev,
                      subjectsText: e.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
            </div>
          </div>

          {/* Right: Initial Branding & Logo Upload */}
          <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-6 lg:col-span-5 dark:border-slate-800 dark:bg-slate-900">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Initial Brand Theme & Logo
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Upload the school logo and select their brand colours before launching.
              </p>
            </div>

            {/* Logo Uploader */}
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 p-1.5 dark:border-slate-700 dark:bg-slate-800">
                {provisionForm.logoDataUrl ? (
                  <img
                    src={provisionForm.logoDataUrl}
                    alt="New tenant logo preview"
                    referrerPolicy="no-referrer"
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <span
                    className="flex h-11 w-11 items-center justify-center rounded-lg text-xs font-bold"
                    style={{
                      backgroundColor: normalizeHex(provisionForm.primaryColor),
                      color: getContrastForeground(normalizeHex(provisionForm.primaryColor)),
                    }}
                  >
                    {getTenantInitials(provisionForm.name || 'New School')}
                  </span>
                )}
              </div>
              <div className="space-y-1.5">
                <input
                  ref={provisionLogoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={(e) => {
                    handleLogoFileChange(e.target.files?.[0], 'provision');
                    e.target.value = '';
                  }}
                  className="hidden"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => provisionLogoInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Upload Logo
                  </button>
                  {provisionForm.logoDataUrl && (
                    <button
                      type="button"
                      onClick={() =>
                        setProvisionForm((prev) => ({ ...prev, logoDataUrl: '' }))
                      }
                      className="text-xs text-red-600 hover:underline dark:text-red-400"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  PNG, JPG, WEBP, or SVG up to 4 MB.
                </p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                School Tagline
              </label>
              <input
                type="text"
                value={provisionForm.tagline}
                onChange={(e) =>
                  setProvisionForm((prev) => ({ ...prev, tagline: e.target.value }))
                }
                placeholder="e.g. Knowledge & Character"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>

            {/* Preset Selector */}
            <div>
              <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Theme Preset
              </span>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {TENANT_THEME_PRESETS.map((preset) => {
                  const selected =
                    normalizeHex(provisionForm.primaryColor) === preset.primaryColor &&
                    provisionForm.sidebarColor === preset.sidebarColor;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() =>
                        setProvisionForm((prev) => ({
                          ...prev,
                          primaryColor: preset.primaryColor,
                          accentColor: preset.accentColor,
                          sidebarColor: preset.sidebarColor,
                        }))
                      }
                      className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs ${
                        selected
                          ? 'border-slate-900 bg-slate-50 font-semibold text-slate-900 dark:border-slate-200 dark:bg-slate-800 dark:text-slate-100'
                          : 'border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <span className="truncate">{preset.name}</span>
                      <span
                        className="ml-1.5 h-3.5 w-3.5 shrink-0 rounded-sm"
                        style={{ backgroundColor: preset.primaryColor }}
                      />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Primary Colour
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="color"
                    value={normalizeHex(provisionForm.primaryColor)}
                    onChange={(e) =>
                      setProvisionForm((prev) => ({
                        ...prev,
                        primaryColor: e.target.value.toUpperCase(),
                      }))
                    }
                    className="h-8 w-10 shrink-0 cursor-pointer rounded border border-slate-200 p-0.5 dark:border-slate-700"
                  />
                  <input
                    type="text"
                    value={provisionForm.primaryColor}
                    onChange={(e) =>
                      setProvisionForm((prev) => ({
                        ...prev,
                        primaryColor: e.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 font-mono text-xs uppercase dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Accent Colour
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="color"
                    value={normalizeHex(provisionForm.accentColor)}
                    onChange={(e) =>
                      setProvisionForm((prev) => ({
                        ...prev,
                        accentColor: e.target.value.toUpperCase(),
                      }))
                    }
                    className="h-8 w-10 shrink-0 cursor-pointer rounded border border-slate-200 p-0.5 dark:border-slate-700"
                  />
                  <input
                    type="text"
                    value={provisionForm.accentColor}
                    onChange={(e) =>
                      setProvisionForm((prev) => ({
                        ...prev,
                        accentColor: e.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 font-mono text-xs uppercase dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
              <input
                type="checkbox"
                checked={switchAfterCreate}
                onChange={(e) => setSwitchAfterCreate(e.target.checked)}
                className="h-3.5 w-3.5 rounded accent-blue-600"
              />
              Switch directly into the newly provisioned tenant workspace
            </label>

            <button
              type="submit"
              disabled={provisioning}
              style={{
                backgroundColor: normalizeHex(provisionForm.primaryColor),
                color: getContrastForeground(normalizeHex(provisionForm.primaryColor)),
              }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {provisioning ? 'Provisioning Tenant...' : 'Create Branded School Tenant'}
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-900">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Backend Admin Service Audit Trail
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                All tenant provisioning, metadata updates, branding changes, and deprovisioning events executed through the authenticated backend service layer.
              </p>
            </div>
            <button
              type="button"
              onClick={loadAuditLogs}
              disabled={loadingAuditLogs}
              className="inline-flex items-center gap-1.5 self-start rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingAuditLogs ? 'animate-spin' : ''}`} />
              Refresh Log
            </button>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Timestamp</th>
                    <th className="px-4 py-3">Operation</th>
                    <th className="px-4 py-3">Authenticated Actor</th>
                    <th className="px-4 py-3">Target Tenant</th>
                    <th className="px-4 py-3">Service Summary</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {loadingAuditLogs ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-10 text-center text-slate-500 dark:text-slate-400"
                      >
                        Loading admin service audit records...
                      </td>
                    </tr>
                  ) : auditLogs.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-10 text-center text-slate-500 dark:text-slate-400"
                      >
                        No administrative provisioning or metadata operations recorded yet. Create, update, or customize a tenant to generate verified service logs.
                      </td>
                    </tr>
                  ) : (
                    auditLogs.map((entry) => (
                      <tr key={entry.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                          {new Date(entry.timestamp).toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block rounded border px-2 py-0.5 font-mono text-[11px] font-semibold ${
                              AUDIT_ACTION_BADGES[entry.action]
                            }`}
                          >
                            {entry.action}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                          <div className="font-semibold">{entry.actorRole}</div>
                          <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                            {entry.actorEmail}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                          {entry.tenantName}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                          {entry.summary}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
