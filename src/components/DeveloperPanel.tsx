import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  Database,
  Download,
  Eye,
  KeyRound,
  Landmark,
  Layers,
  Lock,
  LogOut,
  Moon,
  Plus,
  Power,
  RefreshCw,
  Save,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sun,
  Terminal,
  Upload,
  UserCheck,
  Users,
} from 'lucide-react';
import { isDeveloperRoleClient, saasApi } from '../lib/api';
import { getContrastForeground, getTenantInitials, normalizeHex } from '../lib/theme';
import {
  DEFAULT_TIER_LEARNER_CAPS,
  deriveSchoolEmailDomain,
  sanitizeSchoolEmailDomain,
  suggestNameEmailLocalPart,
  TENANT_THEME_PRESETS,
  TIER_SUBSCRIPTION_CATALOG,
  type AdminAuditEntry,
  type AuthSessionInfo,
  type CurrencyCode,
  type DevImpersonationTarget,
  type DevPlatformTelemetry,
  type DevTenantTelemetryRow,
  type PayeBand,
  type PayrollStatutoryRateSchedule,
  type SubscriptionCycle,
  type TenantPlan,
  type TenantStatus,
} from '../shared/types';

export type DevRouteSection =
  | 'telemetry'
  | 'onboarding'
  | 'subscriptions'
  | 'impersonation'
  | 'statutory-rates';

interface DeveloperPanelProps {
  section: DevRouteSection;
  onSelectSection: (section: DevRouteSection) => void;
  onExitToSchoolPortal: () => void;
  authSession: AuthSessionInfo | null;
  onAuthenticated: (session: AuthSessionInfo) => void;
  onImpersonationStarted: (session: AuthSessionInfo) => void;
  onExitImpersonation: () => Promise<void>;
  onSignOut: () => Promise<void>;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onNotify: (msg: string, tone?: 'success' | 'error' | 'info') => void;
}

const DEV_SECTIONS: Array<{
  id: DevRouteSection;
  path: string;
  label: string;
  shortLabel: string;
  icon: typeof Activity;
}> = [
  {
    id: 'telemetry',
    path: '/dev/telemetry',
    label: 'Global Telemetry & DB',
    shortLabel: 'Telemetry',
    icon: Activity,
  },
  {
    id: 'onboarding',
    path: '/dev/onboarding',
    label: 'Tenant Onboarding',
    shortLabel: 'Onboarding',
    icon: Building2,
  },
  {
    id: 'subscriptions',
    path: '/dev/subscriptions',
    label: 'Subscriptions & Kill Switch',
    shortLabel: 'Subscriptions',
    icon: Layers,
  },
  {
    id: 'impersonation',
    path: '/dev/impersonation',
    label: 'Safe Impersonation',
    shortLabel: 'Impersonation',
    icon: UserCheck,
  },
  {
    id: 'statutory-rates',
    path: '/dev/statutory-rates',
    label: 'Statutory Payroll Rates',
    shortLabel: 'Statutory Rates',
    icon: Landmark,
  },
];

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatTimestamp(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function DeveloperPanel({
  section,
  onSelectSection,
  onExitToSchoolPortal,
  authSession,
  onAuthenticated,
  onImpersonationStarted,
  onExitImpersonation,
  onSignOut,
  darkMode,
  onToggleDarkMode,
  onNotify,
}: DeveloperPanelProps) {
  const [telemetry, setTelemetry] = useState<DevPlatformTelemetry | null>(null);
  const [targets, setTargets] = useState<DevImpersonationTarget[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Telemetry & Subscriptions filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | TenantStatus>('All');

  // Module 1: Onboarding form state
  const [obName, setObName] = useState('');
  const [obDomain, setObDomain] = useState('');
  const [obDomainEdited, setObDomainEdited] = useState(false);
  const [obLocation, setObLocation] = useState('Nairobi, KE');
  const [obCurriculum, setObCurriculum] = useState('Kenyan CBC (Playgroup – Grade 12)');
  const [obCurrency, setObCurrency] = useState<CurrencyCode>('KES');
  const [obPlan, setObPlan] = useState<TenantPlan>('Growth');
  const [obCap, setObCap] = useState<number>(DEFAULT_TIER_LEARNER_CAPS.Growth);
  const [obCapEdited, setObCapEdited] = useState(false);
  const [obCycle, setObCycle] = useState<SubscriptionCycle>('Annual');
  const [obStatus, setObStatus] = useState<TenantStatus>('Active');
  const [obPrimaryColor, setObPrimaryColor] = useState('#2563EB');
  const [obAccentColor, setObAccentColor] = useState('#0284C7');
  const [obAdminName, setObAdminName] = useState('');
  const [obAdminLocal, setObAdminLocal] = useState('');
  const [obAdminLocalEdited, setObAdminLocalEdited] = useState(false);
  const [obAdminPhone, setObAdminPhone] = useState('');
  const [obContactPhone, setObContactPhone] = useState('');
  const [obContactEmail, setObContactEmail] = useState('');
  const [obPostalAddress, setObPostalAddress] = useState('');
  const [obSubmitting, setObSubmitting] = useState(false);
  const [copiedOtp, setCopiedOtp] = useState(false);
  const [lastProvisioned, setLastProvisioned] = useState<{
    schoolName: string;
    tenantId: string;
    domain: string;
    adminEmail: string;
    oneTimePassword: string;
    plan: TenantPlan;
    learnerCap: number;
  } | null>(null);

  // Module 2: Subscriptions & Kill Switch state
  const [selectedSubTenantId, setSelectedSubTenantId] = useState<string>('');
  const [editPlan, setEditPlan] = useState<TenantPlan>('Growth');
  const [editCap, setEditCap] = useState<number>(600);
  const [editCycle, setEditCycle] = useState<SubscriptionCycle>('Annual');
  const [editRenewalDate, setEditRenewalDate] = useState('2027-08-31');
  const [subSaving, setSubSaving] = useState(false);
  const [killReason, setKillReason] = useState('');
  const [confirmKillTenantId, setConfirmKillTenantId] = useState<string | null>(null);

  // Module 3: Safe Impersonation state
  const [impTenantId, setImpTenantId] = useState<string>('');
  const [impUserId, setImpUserId] = useState<string>('');
  const [impReadOnly, setImpReadOnly] = useState<boolean>(true);
  const [impLaunching, setImpLaunching] = useState<boolean>(false);

  // Database Snapshot Export / Restore
  const [dbBackupBusy, setDbBackupBusy] = useState<boolean>(false);
  const dbRestoreInputRef = useRef<HTMLInputElement | null>(null);

  // Module 5: Dated Payroll Statutory Schedules
  const [statutorySchedules, setStatutorySchedules] = useState<PayrollStatutoryRateSchedule[]>([]);
  const [statForm, setStatForm] = useState<{
    id?: string;
    effectiveFrom: string;
    label: string;
    nssfLowerLimit: number;
    nssfUpperLimit: number;
    nssfRatePct: number;
    nssfMaxEmployee: number;
    shifRatePct: number;
    shifMin: number;
    housingLevyRatePct: number;
    nitaLevy: number;
    personalRelief: number;
  }>({
    effectiveFrom: '2026-02-01',
    label: 'Kenya Statutory Schedule (Feb 2026)',
    nssfLowerLimit: 9000,
    nssfUpperLimit: 108000,
    nssfRatePct: 6,
    nssfMaxEmployee: 6480,
    shifRatePct: 2.75,
    shifMin: 300,
    housingLevyRatePct: 1.5,
    nitaLevy: 50,
    personalRelief: 2400,
  });
  const [statBands, setStatBands] = useState<Array<{ limit: string; ratePct: number }>>([
    { limit: '24000', ratePct: 10 },
    { limit: '8333', ratePct: 25 },
    { limit: '467667', ratePct: 30 },
    { limit: '300000', ratePct: 32.5 },
    { limit: '', ratePct: 35 },
  ]);
  const [statSaving, setStatSaving] = useState(false);

  const isAuthorizedDeveloper = Boolean(
    authSession && !authSession.impersonator && isDeveloperRoleClient(authSession.user.role)
  );

  useEffect(() => {
    if (!obDomainEdited) {
      setObDomain(obName.trim() ? deriveSchoolEmailDomain(obName) : '');
    }
  }, [obName, obDomainEdited]);

  useEffect(() => {
    if (!obCapEdited) {
      setObCap(DEFAULT_TIER_LEARNER_CAPS[obPlan]);
    }
  }, [obPlan, obCapEdited]);

  useEffect(() => {
    if (!obAdminLocalEdited) {
      setObAdminLocal(suggestNameEmailLocalPart(obAdminName));
    }
  }, [obAdminName, obAdminLocalEdited]);

  function loadStatutoryScheduleIntoForm(s: PayrollStatutoryRateSchedule) {
    setStatForm({
      id: s.id,
      effectiveFrom: s.effectiveFrom,
      label: s.label,
      nssfLowerLimit: s.nssfLowerLimit,
      nssfUpperLimit: s.nssfUpperLimit,
      nssfRatePct: Math.round(s.nssfRate * 10000) / 100,
      nssfMaxEmployee: s.nssfMaxEmployee,
      shifRatePct: Math.round(s.shifRate * 10000) / 100,
      shifMin: s.shifMin,
      housingLevyRatePct: Math.round(s.housingLevyRate * 10000) / 100,
      nitaLevy: s.nitaLevy,
      personalRelief: s.personalRelief,
    });
    setStatBands(
      s.payeBands.map((b) => ({
        limit: b.limit === null ? '' : String(b.limit),
        ratePct: Math.round(b.rate * 10000) / 100,
      }))
    );
  }

  const loadControlPlaneData = useCallback(async () => {
    if (!isAuthorizedDeveloper) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [telRes, targetRes, logRes, statRes] = await Promise.all([
        saasApi.getDevTelemetry(),
        saasApi.getDevImpersonationTargets(),
        saasApi.getDevAuditLogs(80),
        saasApi.getDevStatutoryRates(),
      ]);
      setTelemetry(telRes.telemetry);
      setTargets(targetRes.targets);
      setAuditLogs(logRes.logs);
      setStatutorySchedules(statRes.schedules);
      if (statRes.schedules.length > 0) {
        loadStatutoryScheduleIntoForm(statRes.schedules[0]);
      }

      if (telRes.telemetry.tenantRows.length > 0) {
        setSelectedSubTenantId((prev) =>
          prev && telRes.telemetry.tenantRows.some((r) => r.tenant.id === prev)
            ? prev
            : telRes.telemetry.tenantRows[0].tenant.id
        );
      }
      if (targetRes.targets.length > 0) {
        setImpTenantId((prev) =>
          prev && targetRes.targets.some((t) => t.tenantId === prev)
            ? prev
            : targetRes.targets[0].tenantId
        );
      }
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Unable to load Developer Control Plane data.'
      );
    } finally {
      setLoading(false);
    }
  }, [isAuthorizedDeveloper]);

  useEffect(() => {
    loadControlPlaneData();
  }, [loadControlPlaneData]);

  const selectedSubRow: DevTenantTelemetryRow | undefined = useMemo(
    () => telemetry?.tenantRows.find((r) => r.tenant.id === selectedSubTenantId),
    [telemetry, selectedSubTenantId]
  );

  useEffect(() => {
    if (!selectedSubRow) return;
    setEditPlan(selectedSubRow.tenant.plan);
    setEditCap(selectedSubRow.learnerCap);
    setEditCycle(selectedSubRow.tenant.subscriptionCycle || 'Annual');
    setEditRenewalDate(selectedSubRow.tenant.renewalDate || '2027-08-31');
    setKillReason(selectedSubRow.tenant.suspensionReason || '');
    setConfirmKillTenantId(null);
  }, [selectedSubRow]);

  const selectedImpTarget = useMemo(
    () => targets.find((t) => t.tenantId === impTenantId) || targets[0],
    [targets, impTenantId]
  );

  useEffect(() => {
    if (!selectedImpTarget) return;
    const activeUsers = selectedImpTarget.users.filter((u) => u.status === 'Active');
    if (activeUsers.length === 0) {
      setImpUserId('');
      return;
    }
    setImpUserId((prev) => {
      if (prev && activeUsers.some((u) => u.id === prev)) return prev;
      const preferred =
        activeUsers.find((u) => u.role === 'Admin') ||
        activeUsers.find((u) => u.role === 'Bursar') ||
        activeUsers[0];
      return preferred.id;
    });
  }, [selectedImpTarget]);

  const filteredTenantRows = useMemo(() => {
    const rows = telemetry?.tenantRows || [];
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((row) => {
      const status = row.tenant.status || 'Active';
      if (statusFilter !== 'All' && status !== statusFilter) return false;
      if (!q) return true;
      return (
        row.tenant.name.toLowerCase().includes(q) ||
        (row.tenant.emailDomain || '').toLowerCase().includes(q) ||
        row.tenant.location.toLowerCase().includes(q) ||
        row.tenant.plan.toLowerCase().includes(q)
      );
    });
  }, [telemetry, searchQuery, statusFilter]);

  async function handleCopyOtp(value: string) {
    try {
      await navigator.clipboard?.writeText(value);
      setCopiedOtp(true);
      onNotify('Copied 1-time password to clipboard', 'success');
      setTimeout(() => setCopiedOtp(false), 2500);
    } catch {
      onNotify('Copy the generated 1-time password manually.', 'info');
    }
  }

  async function handleOnboardSubmit(e: React.FormEvent) {
    e.preventDefault();
    setObSubmitting(true);
    setCopiedOtp(false);
    try {
      const cleanDomain = sanitizeSchoolEmailDomain(obDomain);
      const localPart = obAdminLocal.trim().toLowerCase().replace(/@.*$/, '');
      const res = await saasApi.devOnboardTenant({
        name: obName.trim(),
        emailDomain: cleanDomain,
        location: obLocation.trim(),
        contactEmail: obContactEmail.trim() || undefined,
        contactPhone: obContactPhone.trim() || undefined,
        postalAddress: obPostalAddress.trim() || undefined,
        curriculum: obCurriculum.trim(),
        currency: obCurrency,
        plan: obPlan,
        status: obStatus,
        learnerCap: Number(obCap) || DEFAULT_TIER_LEARNER_CAPS[obPlan],
        subscriptionCycle: obCycle,
        branding: {
          primaryColor: obPrimaryColor,
          accentColor: obAccentColor,
        },
        adminFullName: obAdminName.trim() || 'Principal Administrator',
        adminEmail: localPart ? `${localPart}@${cleanDomain}` : undefined,
        adminPhone: obAdminPhone.trim() || undefined,
      });

      setLastProvisioned({
        schoolName: res.tenant.name,
        tenantId: res.tenant.id,
        domain: res.tenant.emailDomain || cleanDomain,
        adminEmail: res.adminUser.email,
        oneTimePassword: res.adminUser.oneTimePassword,
        plan: res.tenant.plan,
        learnerCap: res.tenant.learnerCap || DEFAULT_TIER_LEARNER_CAPS[res.tenant.plan],
      });
      setObName('');
      setObDomain('');
      setObDomainEdited(false);
      setObAdminName('');
      setObAdminLocal('');
      setObAdminLocalEdited(false);
      setObAdminPhone('');
      setObContactPhone('');
      setObContactEmail('');
      setObPostalAddress('');
      onNotify(`Provisioned ${res.tenant.name} (@${res.tenant.emailDomain}) with 1-time password`, 'success');
      await loadControlPlaneData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Tenant onboarding failed.', 'error');
    } finally {
      setObSubmitting(false);
    }
  }

  async function handleSaveSubscription(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSubRow) return;
    setSubSaving(true);
    try {
      await saasApi.devUpdateSubscription(selectedSubRow.tenant.id, {
        plan: editPlan,
        learnerCap: Number(editCap),
        subscriptionCycle: editCycle,
        renewalDate: editRenewalDate,
      });
      onNotify(
        `Updated ${selectedSubRow.tenant.name} tier (${editPlan}) & learner cap (${editCap})`,
        'success'
      );
      await loadControlPlaneData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to update subscription.', 'error');
    } finally {
      setSubSaving(false);
    }
  }

  async function handleKillSwitch(tenantId: string, targetStatus: TenantStatus, reason?: string) {
    setSubSaving(true);
    try {
      const res = await saasApi.devToggleKillSwitch(tenantId, {
        status: targetStatus,
        reason,
      });
      setConfirmKillTenantId(null);
      onNotify(
        targetStatus === 'Suspended'
          ? `Kill switch engaged for ${res.tenant.name}`
          : `Restored workspace access for ${res.tenant.name}`,
        targetStatus === 'Suspended' ? 'info' : 'success'
      );
      await loadControlPlaneData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Kill switch update failed.', 'error');
    } finally {
      setSubSaving(false);
    }
  }

  async function handleLaunchImpersonation() {
    if (!selectedImpTarget) return;
    setImpLaunching(true);
    try {
      const res = await saasApi.devStartImpersonation({
        tenantId: selectedImpTarget.tenantId,
        userId: impUserId || undefined,
        readOnly: impReadOnly,
      });
      onNotify(
        `Impersonating ${res.session.user.fullName} @ ${selectedImpTarget.tenantName} (${impReadOnly ? 'Read-Only' : 'Full Support'})`,
        'info'
      );
      onImpersonationStarted(res.session);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to start impersonation.', 'error');
    } finally {
      setImpLaunching(false);
    }
  }

  async function handleExportDatabaseSnapshot() {
    setDbBackupBusy(true);
    try {
      const snapshot = await saasApi.devExportDatabase();
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = snapshot.fileName || `elimunest-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      onNotify('Downloaded full platform database snapshot (.json).', 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Database export failed.', 'error');
    } finally {
      setDbBackupBusy(false);
    }
  }

  async function handleRestoreDatabaseFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setDbBackupBusy(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const res = await saasApi.devRestoreDatabase(parsed);
      onNotify(
        `Restored ${res.restoredTenants} tenants, ${res.restoredUsers} accounts, and ${res.restoredStudents} learners.`,
        'success'
      );
      await loadControlPlaneData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Database snapshot restore failed.', 'error');
    } finally {
      setDbBackupBusy(false);
    }
  }

  async function handleSaveStatutorySchedule(e: React.FormEvent) {
    e.preventDefault();
    const parsedBands: PayeBand[] = statBands.map((b) => ({
      limit: b.limit.trim() === '' ? null : Number(b.limit),
      rate: Number(b.ratePct) / 100,
    }));
    if (
      parsedBands.some(
        (b) => (b.limit !== null && (!Number.isFinite(b.limit) || b.limit <= 0)) || !Number.isFinite(b.rate) || b.rate < 0 || b.rate > 1
      )
    ) {
      onNotify('Invalid PAYE band limits or tax percentages.', 'error');
      return;
    }
    setStatSaving(true);
    try {
      const res = await saasApi.saveDevStatutoryRate({
        id: statForm.id,
        effectiveFrom: statForm.effectiveFrom,
        label: statForm.label.trim(),
        currency: 'KES',
        nssfLowerLimit: Number(statForm.nssfLowerLimit),
        nssfUpperLimit: Number(statForm.nssfUpperLimit),
        nssfRate: Number(statForm.nssfRatePct) / 100,
        nssfMaxEmployee: Number(statForm.nssfMaxEmployee),
        shifRate: Number(statForm.shifRatePct) / 100,
        shifMin: Number(statForm.shifMin),
        housingLevyRate: Number(statForm.housingLevyRatePct) / 100,
        nitaLevy: Number(statForm.nitaLevy),
        personalRelief: Number(statForm.personalRelief),
        payeBands: parsedBands,
      });
      onNotify(
        `Saved statutory rate schedule "${res.schedule.label}" (effective ${res.schedule.effectiveFrom}).`,
        'success'
      );
      await loadControlPlaneData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to save statutory schedule.', 'error');
    } finally {
      setStatSaving(false);
    }
  }

  // CASE 1: Active Impersonation session (requires exiting impersonation before /dev)
  if (authSession?.impersonator) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4 sm:px-8">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-white dark:bg-blue-600">
                <Terminal className="h-4 w-4" />
              </div>
              <div>
                <span className="font-display text-sm font-bold tracking-tight">
                  elimuNest // DEV
                </span>
                <span className="ml-2 font-mono text-xs text-slate-500 dark:text-slate-400">
                  /dev Control Plane Gate
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onExitToSchoolPortal}
                className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                School Portal
              </button>
              <button
                type="button"
                onClick={() => onSignOut()}
                className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign Out
              </button>
              <button
                type="button"
                onClick={onToggleDarkMode}
                aria-label="Toggle theme"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-xl px-4 py-12 sm:px-6">
          <div className="rounded-xl border border-amber-300 bg-white p-6 dark:border-amber-800 dark:bg-slate-900">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <h1 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                  Active Tenant Support Impersonation Detected
                </h1>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  For privilege isolation, <span className="font-mono">/dev</span> endpoints reject
                  requests while a tenant impersonation token is active. Exit impersonation first to
                  restore your Developer session.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onExitImpersonation()}
                    className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-700"
                  >
                    Exit Impersonation & Unlock /dev
                  </button>
                  <button
                    type="button"
                    onClick={onExitToSchoolPortal}
                    className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    Continue in Tenant View
                  </button>
                  <button
                    type="button"
                    onClick={() => onSignOut()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    Sign Out
                  </button>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!authSession) {
    return null;
  }

  // CASE 2: Signed-in School Role lacking Developer RBAC -> Strict 403 Gate
  if (!isAuthorizedDeveloper) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4 sm:px-8">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-white dark:bg-blue-600">
                <Terminal className="h-4 w-4" />
              </div>
              <span className="font-display text-sm font-bold tracking-tight">
                elimuNest // DEV
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onExitToSchoolPortal}
                className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                School Portal
              </button>
              <button
                type="button"
                onClick={() => onSignOut()}
                className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign Out
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-xl px-4 py-16">
          <div className="rounded-xl border border-red-200 bg-white p-8 dark:border-red-900/70 dark:bg-slate-900">
            <div className="flex items-center gap-2.5 text-red-600 dark:text-red-400">
              <ShieldAlert className="h-6 w-6" />
              <span className="font-mono text-xs font-bold uppercase tracking-wider">
                403 Forbidden · RBAC Middleware Guard
              </span>
            </div>
            <h1 className="mt-3 font-display text-xl font-bold">
              Developer Panel Access Restricted
            </h1>
            <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              Your active account <span className="font-mono font-semibold">{authSession.user.email}</span>{' '}
              carries school role <span className="font-mono font-semibold">{authSession.user.role}</span>,
              which holds zero claims for <span className="font-mono">/dev/*</span> routes and{' '}
              <span className="font-mono">/api/dev/*</span> middleware endpoints.
            </p>

            <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3.5 font-mono text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
              <div>Required claims: dev:tenants, dev:subscriptions, dev:impersonate, dev:telemetry</div>
              <div className="mt-1">Granted to "{authSession.user.role}": [none]</div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={onExitToSchoolPortal}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Return to School Portal
              </button>
              <button
                type="button"
                onClick={() => onSignOut()}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign Out & Switch Account
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const activeSectionMeta = DEV_SECTIONS.find((s) => s.id === section) || DEV_SECTIONS[0];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Left Developer Control Sidebar (256px) */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-slate-200 bg-slate-900 text-slate-100 lg:flex dark:border-slate-800 dark:bg-slate-950">
        <div className="h-1 w-full bg-blue-600" />
        <div className="flex h-16 items-center gap-3 border-b border-slate-800 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
            <Terminal className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="font-display text-sm font-bold tracking-tight">elimuNest // DEV</div>
            <div className="truncate font-mono text-[11px] text-slate-400">
              Platform Control Plane
            </div>
          </div>
        </div>

        {/* RBAC Verified Principal */}
        <div className="border-b border-slate-800 p-4">
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2.5">
            <div className="flex items-center justify-between text-[11px] text-emerald-400">
              <span className="font-mono font-semibold">{authSession.user.role}</span>
              <span className="font-mono text-slate-400">RBAC Verified</span>
            </div>
            <p className="mt-1 truncate text-xs font-semibold text-white">
              {authSession.user.fullName}
            </p>
            <p className="truncate font-mono text-[11px] text-slate-400">
              {authSession.user.email}
            </p>
          </div>
        </div>

        {/* Dedicated /dev Route Modules */}
        <nav className="flex-1 space-y-1 p-3" aria-label="Developer Control Plane modules">
          {DEV_SECTIONS.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectSection(item.id)}
                className={`flex w-full items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2.5 text-left text-xs transition-colors ${
                  active
                    ? 'bg-blue-600 font-semibold text-white'
                    : 'font-medium text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="space-y-2 border-t border-slate-800 p-4">
          <button
            type="button"
            onClick={onExitToSchoolPortal}
            className="flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            School Portal (/)
          </button>
          <button
            type="button"
            onClick={() => onSignOut()}
            className="flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-slate-800 px-3 py-2 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Control Plane Viewport */}
      <div className="flex min-h-screen flex-col lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-8 dark:border-slate-800 dark:bg-slate-900/95">
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-xs sm:text-sm">
            <span className="font-mono text-slate-400">/dev</span>
            <span className="text-slate-300 dark:text-slate-700">/</span>
            <span className="truncate font-semibold text-slate-900 dark:text-slate-100">
              {activeSectionMeta.label}
            </span>
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => loadControlPlaneData()}
              disabled={loading}
              className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh Telemetry</span>
            </button>
            <button
              type="button"
              onClick={onExitToSchoolPortal}
              className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 lg:hidden dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              School Portal
            </button>
            <button
              type="button"
              onClick={() => onSignOut()}
              className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Sign Out</span>
            </button>
            <button
              type="button"
              onClick={onToggleDarkMode}
              aria-label="Toggle theme"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </header>

        {/* Mobile / Tablet Route Tab Strip */}
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-4 py-2 lg:hidden dark:border-slate-800 dark:bg-slate-900">
          {DEV_SECTIONS.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectSection(item.id)}
                className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium ${
                  active
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.shortLabel}
              </button>
            );
          })}
        </div>

        <main className="mx-auto w-full max-w-[1360px] flex-1 space-y-6 p-4 sm:p-8">
          {loadError && (
            <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
              <span>{loadError}</span>
              <button
                type="button"
                onClick={() => loadControlPlaneData()}
                className="font-semibold underline"
              >
                Retry
              </button>
            </div>
          )}

          {/* ============================================================
              MODULE 1: GLOBAL METRICS & TELEMETRY (/dev/telemetry)
             ============================================================ */}
          {section === 'telemetry' && (
            <div className="space-y-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h1 className="font-display text-xl font-bold tracking-tight">
                    Global Platform Telemetry & Database Health
                  </h1>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Real-time tenant status distribution, platform-wide learner utilization across all
                    campuses, and storage metrics from <span className="font-mono">elimunest-db.json</span>.
                  </p>
                </div>
                {telemetry && (
                  <span className="font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                    Snapshot: {formatTimestamp(telemetry.generatedAt)}
                  </span>
                )}
              </div>

              {loading && !telemetry ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="h-28 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                    />
                  ))}
                </div>
              ) : telemetry ? (
                <>
                  {/* Top KPI Summary Grid */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                      <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                        <span>School Tenants</span>
                        <Building2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div className="mt-2 font-mono text-2xl font-bold tabular-nums">
                        {telemetry.tenants.total}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums">
                        <span className="text-emerald-700 dark:text-emerald-400">
                          {telemetry.tenants.active} Active
                        </span>
                        <span className="text-amber-700 dark:text-amber-400">
                          {telemetry.tenants.trial} Trial
                        </span>
                        <span className="text-red-700 dark:text-red-400">
                          {telemetry.tenants.suspended} Suspended
                        </span>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                      <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                        <span>Platform Learners</span>
                        <Users className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <div className="mt-2 font-mono text-2xl font-bold tabular-nums">
                        {telemetry.learners.totalEnrolled.toLocaleString()}
                      </div>
                      <div className="mt-2 font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                        {telemetry.learners.activeLearners} active · {telemetry.learners.totalCapacity.toLocaleString()} cap (
                        {telemetry.learners.globalUtilizationPct}%)
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                      <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                        <span>Database Storage Size</span>
                        <Database className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                      </div>
                      <div className="mt-2 font-mono text-2xl font-bold tabular-nums">
                        {formatBytes(telemetry.database.diskBytes)}
                      </div>
                      <div className="mt-2 font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                        {telemetry.database.totalRecords.toLocaleString()} records ·{' '}
                        {telemetry.database.collections.length} collections
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                      <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                        <span>Runtime & Sockets</span>
                        <Server className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                      </div>
                      <div className="mt-2 font-mono text-2xl font-bold tabular-nums">
                        {formatBytes(telemetry.runtime.heapUsedBytes)}
                      </div>
                      <div className="mt-2 font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                        Up {formatDuration(telemetry.runtime.uptimeSeconds)} ·{' '}
                        {telemetry.runtime.wsConnectedClients} WS · {telemetry.runtime.nodeVersion}
                      </div>
                    </div>
                  </div>

                  {/* Tenant Fleet Health & Learner Cap Utilization Table */}
                  <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
                      <div>
                        <h2 className="font-display text-sm font-bold">
                          Tenant Status & Learner Utilization Matrix
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Tier plans: {telemetry.tenants.byPlan.Enterprise} Enterprise ·{' '}
                          {telemetry.tenants.byPlan.Growth} Growth · {telemetry.tenants.byPlan.Starter}{' '}
                          Starter
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="search"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Filter school or domain..."
                          className="h-9 w-48 rounded-lg border border-slate-200 bg-white px-3 text-xs focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                        />
                        <div className="flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
                          {(['All', 'Active', 'Trial', 'Suspended'] as const).map((st) => (
                            <button
                              key={st}
                              type="button"
                              onClick={() => setStatusFilter(st)}
                              className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${
                                statusFilter === st
                                  ? 'bg-slate-900 text-white dark:bg-blue-600'
                                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                              }`}
                            >
                              {st}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                          <tr>
                            <th className="px-5 py-3">School Tenant</th>
                            <th className="px-4 py-3">Tier</th>
                            <th className="px-4 py-3">Status</th>
                            <th className="px-4 py-3 text-right">Learners / Cap</th>
                            <th className="px-4 py-3">Utilization</th>
                            <th className="px-4 py-3 text-right">Users</th>
                            <th className="px-4 py-3 text-right">Payload Footprint</th>
                            <th className="px-5 py-3 text-right">Quick Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {filteredTenantRows.map((row) => {
                            const status = row.tenant.status || 'Active';
                            const primaryHex = normalizeHex(
                              row.tenant.branding?.primaryColor,
                              '#2563EB'
                            );
                            return (
                              <tr
                                key={row.tenant.id}
                                className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                              >
                                <td className="px-5 py-3">
                                  <div className="flex items-center gap-2.5">
                                    <div
                                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-bold"
                                      style={{
                                        backgroundColor: primaryHex,
                                        color: getContrastForeground(primaryHex),
                                      }}
                                    >
                                      {getTenantInitials(row.tenant.name)}
                                    </div>
                                    <div className="min-w-0">
                                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                                        {row.tenant.name}
                                      </div>
                                      <div className="font-mono text-[11px] text-slate-500">
                                        @{row.tenant.emailDomain || row.tenant.slug} · {row.tenant.location}
                                      </div>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-4 py-3 font-medium">{row.tenant.plan}</td>
                                <td className="px-4 py-3">
                                  <span
                                    className={`font-mono text-[11px] font-semibold ${
                                      status === 'Suspended'
                                        ? 'text-red-700 dark:text-red-400'
                                        : status === 'Trial'
                                        ? 'text-amber-700 dark:text-amber-400'
                                        : 'text-emerald-700 dark:text-emerald-400'
                                    }`}
                                  >
                                    {status}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-right font-mono tabular-nums">
                                  {row.totalLearners.toLocaleString()} / {row.learnerCap.toLocaleString()}
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-2">
                                    <div className="h-1.5 w-20 overflow-hidden rounded-sm bg-slate-200 dark:bg-slate-800">
                                      <div
                                        className={`h-full ${
                                          row.utilizationPct >= 90
                                            ? 'bg-red-600'
                                            : row.utilizationPct >= 70
                                            ? 'bg-amber-500'
                                            : 'bg-blue-600'
                                        }`}
                                        style={{ width: `${Math.min(100, row.utilizationPct)}%` }}
                                      />
                                    </div>
                                    <span className="font-mono text-[11px] tabular-nums">
                                      {row.utilizationPct}%
                                    </span>
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-right font-mono tabular-nums">
                                  {row.staffUsersCount}
                                </td>
                                <td className="px-4 py-3 text-right font-mono tabular-nums">
                                  {formatBytes(row.estimatedDataBytes)}
                                </td>
                                <td className="px-5 py-3 text-right">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedSubTenantId(row.tenant.id);
                                      onSelectSection('subscriptions');
                                    }}
                                    className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                                  >
                                    Manage
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Storage Durability & Snapshot Controls Banner */}
                  {telemetry.database.persistentStorage === false && (
                    <div className="rounded-xl border border-amber-300 bg-amber-50/80 px-5 py-4 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-start gap-2.5">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                          <div>
                            <p className="font-semibold">
                              Ephemeral Deployment Storage Active ({telemetry.database.storageMode})
                            </p>
                            <p className="mt-0.5 text-[11px] leading-relaxed text-amber-900/90 dark:text-amber-200/90">
                              On serverless instances without <span className="font-mono">DATA_DIR</span> or{' '}
                              <span className="font-mono">KV_REST_API_URL</span> +{' '}
                              <span className="font-mono">KV_REST_API_TOKEN</span>, pushing new code resets{' '}
                              <span className="font-mono">/tmp</span>. Set those env vars (and{' '}
                              <span className="font-mono">AUTH_SESSION_SECRET</span>) or export a DB snapshot before redeploying.
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={handleExportDatabaseSnapshot}
                          disabled={dbBackupBusy}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:bg-slate-900 dark:text-amber-200"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Export DB Backup
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Database Storage Breakdown + Developer Audit Feed */}
                  <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                    <div className="rounded-xl border border-slate-200 bg-white xl:col-span-7 dark:border-slate-800 dark:bg-slate-900">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
                        <div>
                          <h2 className="font-display text-sm font-bold">
                            Database Collections & Record Size Breakdown
                          </h2>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {telemetry.database.engine} · {telemetry.database.storageMode || 'Local JSON Store'} ·{' '}
                            {telemetry.database.filePathName} ·{' '}
                            <span className="font-mono tabular-nums">
                              {formatBytes(telemetry.database.serializedBytes)} raw JSON
                            </span>
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            ref={dbRestoreInputRef}
                            type="file"
                            accept=".json,application/json"
                            onChange={handleRestoreDatabaseFile}
                            className="hidden"
                          />
                          <button
                            type="button"
                            onClick={handleExportDatabaseSnapshot}
                            disabled={dbBackupBusy}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                          >
                            <Download className="h-3.5 w-3.5" />
                            Export Snapshot
                          </button>
                          <button
                            type="button"
                            onClick={() => dbRestoreInputRef.current?.click()}
                            disabled={dbBackupBusy}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                          >
                            <Upload className="h-3.5 w-3.5" />
                            Restore Snapshot
                          </button>
                        </div>
                      </div>
                      <div className="max-h-96 overflow-y-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                            <tr>
                              <th className="px-5 py-2.5">Collection</th>
                              <th className="px-4 py-2.5 text-right">Records</th>
                              <th className="px-4 py-2.5 text-right">Bytes</th>
                              <th className="px-5 py-2.5">Share</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {telemetry.database.collections.map((col) => {
                              const sharePct =
                                telemetry.database.serializedBytes > 0
                                  ? Math.round(
                                      (col.bytes / telemetry.database.serializedBytes) * 1000
                                    ) / 10
                                  : 0;
                              return (
                                <tr key={col.collection}>
                                  <td className="px-5 py-2 font-mono font-medium">
                                    {col.collection}
                                  </td>
                                  <td className="px-4 py-2 text-right font-mono tabular-nums">
                                    {col.records.toLocaleString()}
                                  </td>
                                  <td className="px-4 py-2 text-right font-mono tabular-nums">
                                    {formatBytes(col.bytes)}
                                  </td>
                                  <td className="px-5 py-2">
                                    <div className="flex items-center gap-2">
                                      <div className="h-1.5 w-20 overflow-hidden rounded-sm bg-slate-200 dark:bg-slate-800">
                                        <div
                                          className="h-full bg-indigo-600"
                                          style={{ width: `${Math.min(100, sharePct)}%` }}
                                        />
                                      </div>
                                      <span className="font-mono text-[11px] tabular-nums">
                                        {sharePct}%
                                      </span>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white xl:col-span-5 dark:border-slate-800 dark:bg-slate-900">
                      <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
                        <h2 className="font-display text-sm font-bold">
                          Control Plane Security & Audit Trail
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Immutable log of provisioning, tier edits, kill switches & impersonation.
                        </p>
                      </div>
                      <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto px-5 dark:divide-slate-800">
                        {auditLogs.length === 0 ? (
                          <p className="py-10 text-center text-xs text-slate-500">
                            No developer control actions recorded yet.
                          </p>
                        ) : (
                          auditLogs.slice(0, 25).map((entry) => (
                            <div key={entry.id} className="py-3 text-xs">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-[11px] font-bold text-blue-600 dark:text-blue-400">
                                  {entry.action}
                                </span>
                                <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                                  {formatTimestamp(entry.timestamp)}
                                </span>
                              </div>
                              <p className="mt-1 text-slate-700 dark:text-slate-300">
                                {entry.summary}
                              </p>
                              <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                                {entry.actorRole} ({entry.actorEmail})
                              </p>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          )}

          {/* ============================================================
              MODULE 2: TENANT ONBOARDING & PROVISIONING (/dev/onboarding)
             ============================================================ */}
          {section === 'onboarding' && (
            <div className="space-y-6">
              <div>
                <h1 className="font-display text-xl font-bold tracking-tight">
                  Tenant Onboarding & Isolated Provisioning
                </h1>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Provision a new isolated school campus, bind its institutional{' '}
                  <span className="font-mono">@theirschool</span> domain, assign subscription caps, and
                  create the initial School Admin account.
                </p>
              </div>

              {lastProvisioned && (
                <div className="rounded-xl border border-emerald-300 bg-emerald-50/70 p-4 dark:border-emerald-800 dark:bg-emerald-950/30">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <div className="space-y-1.5 text-xs">
                        <div className="font-semibold text-emerald-950 dark:text-emerald-200">
                          Provisioned {lastProvisioned.schoolName} ({lastProvisioned.tenantId})
                        </div>
                        <div className="font-mono text-emerald-800 dark:text-emerald-300">
                          Domain: @{lastProvisioned.domain} · {lastProvisioned.plan} (
                          {lastProvisioned.learnerCap} learner cap)
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-emerald-300/80 bg-white px-3 py-2 dark:border-emerald-800 dark:bg-slate-900">
                          <div>
                            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                              Admin Login:
                            </span>{' '}
                            <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                              {lastProvisioned.adminEmail}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                              1-Time Password:
                            </span>
                            <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono font-bold text-emerald-700 dark:border-slate-700 dark:bg-slate-950 dark:text-emerald-300">
                              {lastProvisioned.oneTimePassword}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopyOtp(lastProvisioned.oneTimePassword)}
                              className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                            >
                              {copiedOtp ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                              {copiedOtp ? 'Copied' : 'Copy'}
                            </button>
                          </div>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400">
                            School Admin will be prompted to set a permanent password on first login.
                          </span>
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setImpTenantId(lastProvisioned.tenantId);
                        onSelectSection('impersonation');
                      }}
                      className="shrink-0 whitespace-nowrap rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800"
                    >
                      Impersonate School
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <form
                  onSubmit={handleOnboardSubmit}
                  className="space-y-5 rounded-xl border border-slate-200 bg-white p-6 lg:col-span-8 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        School / Tenant Name
                      </label>
                      <input
                        type="text"
                        required
                        value={obName}
                        onChange={(e) => setObName(e.target.value)}
                        placeholder="e.g. Rift Valley Preparatory"
                        className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Institutional Email Domain
                      </label>
                      <div className="mt-1.5 flex overflow-hidden rounded-lg border border-slate-200 focus-within:border-blue-500 dark:border-slate-700">
                        <span className="flex items-center border-r border-slate-200 bg-slate-100 px-3 font-mono text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          @
                        </span>
                        <input
                          type="text"
                          required
                          value={obDomain}
                          onChange={(e) => {
                            setObDomainEdited(true);
                            setObDomain(e.target.value);
                          }}
                          placeholder="riftvalleyprep.ac.ke"
                          className="min-w-0 flex-1 bg-white px-3 py-2 font-mono text-sm focus:outline-none dark:bg-slate-950"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Location / County
                      </label>
                      <input
                        type="text"
                        value={obLocation}
                        onChange={(e) => setObLocation(e.target.value)}
                        className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Curriculum
                      </label>
                      <input
                        type="text"
                        value={obCurriculum}
                        onChange={(e) => setObCurriculum(e.target.value)}
                        className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Billing Currency
                      </label>
                      <select
                        value={obCurrency}
                        onChange={(e) => setObCurrency(e.target.value as CurrencyCode)}
                        className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                      >
                        <option value="KES">KES — Kenya Shilling (Default)</option>
                        <option value="USD">USD — US Dollar</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        School Phone (Printed Docs)
                      </label>
                      <input
                        type="tel"
                        value={obContactPhone}
                        onChange={(e) => setObContactPhone(e.target.value)}
                        placeholder="+254 712 000 000"
                        className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        School Contact Email
                      </label>
                      <input
                        type="email"
                        value={obContactEmail}
                        onChange={(e) => setObContactEmail(e.target.value)}
                        placeholder={`info@${obDomain || 'school.ac.ke'}`}
                        className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Postal Address
                      </label>
                      <input
                        type="text"
                        value={obPostalAddress}
                        onChange={(e) => setObPostalAddress(e.target.value)}
                        placeholder="P.O. Box 450, Nakuru"
                        className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Subscription Tier
                      </label>
                      <select
                        value={obPlan}
                        onChange={(e) => {
                          setObCapEdited(false);
                          setObPlan(e.target.value as TenantPlan);
                        }}
                        className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                      >
                        <option value="Starter">Starter (150 default cap)</option>
                        <option value="Growth">Growth (600 default cap)</option>
                        <option value="Enterprise">Enterprise (2500 default cap)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Learner Cap
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={50000}
                        required
                        value={obCap}
                        onChange={(e) => {
                          setObCapEdited(true);
                          setObCap(Number(e.target.value));
                        }}
                        className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm tabular-nums focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Billing Cycle
                      </label>
                      <select
                        value={obCycle}
                        onChange={(e) => setObCycle(e.target.value as SubscriptionCycle)}
                        className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                      >
                        <option value="Annual">Annual</option>
                        <option value="Monthly">Monthly</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Initial Status
                      </label>
                      <select
                        value={obStatus}
                        onChange={(e) => setObStatus(e.target.value as TenantStatus)}
                        className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                      >
                        <option value="Active">Active</option>
                        <option value="Trial">Trial</option>
                      </select>
                    </div>
                  </div>

                  {/* Theme Swatches */}
                  <div>
                    <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Campus Theme Preset
                    </span>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {TENANT_THEME_PRESETS.slice(0, 5).map((preset) => {
                        const active =
                          obPrimaryColor.toUpperCase() === preset.primaryColor.toUpperCase();
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => {
                              setObPrimaryColor(preset.primaryColor);
                              setObAccentColor(preset.accentColor);
                            }}
                            className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                              active
                                ? 'border-blue-500 bg-blue-50/70 dark:border-blue-400 dark:bg-blue-950/30'
                                : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800'
                            }`}
                          >
                            <span
                              className="h-3 w-3 rounded-sm"
                              style={{ backgroundColor: preset.primaryColor }}
                            />
                            {preset.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
                    <div className="text-xs font-semibold">Initial School Administrator Account</div>
                    <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                          Admin Full Name
                        </label>
                        <input
                          type="text"
                          required
                          value={obAdminName}
                          onChange={(e) => setObAdminName(e.target.value)}
                          placeholder="e.g. Joyce Mutai"
                          className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                          Admin Handle (@{obDomain || 'school'})
                        </label>
                        <input
                          type="text"
                          required
                          value={obAdminLocal}
                          onChange={(e) => {
                            setObAdminLocalEdited(true);
                            setObAdminLocal(
                              e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '')
                            );
                          }}
                          placeholder="joyce.mutai"
                          className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                          Admin Recovery Phone
                        </label>
                        <input
                          type="tel"
                          value={obAdminPhone}
                          onChange={(e) => setObAdminPhone(e.target.value)}
                          placeholder="+254 712 345 678"
                          className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                          Initial Password Policy
                        </label>
                        <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                          <KeyRound className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
                          <span>Auto-generated 1-time OTP</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={obSubmitting}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    <span>
                      {obSubmitting ? 'Provisioning Tenant...' : 'Provision Isolated School Tenant'}
                    </span>
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </form>

                {/* Active Tenants Inventory Sidebar */}
                <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-4 dark:border-slate-800 dark:bg-slate-900">
                  <h2 className="font-display text-sm font-bold">Provisioned Campuses</h2>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    Each tenant maintains isolated records & email domain validation.
                  </p>
                  <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
                    {(telemetry?.tenantRows || []).map((row) => (
                      <div key={row.tenant.id} className="py-3 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold">{row.tenant.name}</span>
                          <span className="font-mono text-[11px] text-slate-500">
                            {row.tenant.plan}
                          </span>
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] text-slate-500">
                          @{row.tenant.emailDomain} · {row.totalLearners}/{row.learnerCap} learners
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================
              MODULE 3: SUBSCRIPTION & TIER LIFECYCLE + KILL SWITCH
             ============================================================ */}
          {section === 'subscriptions' && (
            <div className="space-y-6">
              <div>
                <h1 className="font-display text-xl font-bold tracking-tight">
                  Subscription Lifecycle, Learner Caps & Account Kill Switch
                </h1>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Assign tiers, adjust active learner capacity limits enforced at admission time, and
                  immediately suspend or restore tenant API access.
                </p>
              </div>

              {/* Concrete Tier Catalog Strip */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {(['Starter', 'Growth', 'Enterprise'] as TenantPlan[]).map((tierKey) => {
                  const tier = TIER_SUBSCRIPTION_CATALOG[tierKey];
                  const count = telemetry?.tenants.byPlan[tierKey] ?? 0;
                  return (
                    <div
                      key={tierKey}
                      className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-display text-sm font-bold">{tierKey}</span>
                        <span className="font-mono text-xs text-slate-500 tabular-nums">
                          {count} {count === 1 ? 'school' : 'schools'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {tier.audience}
                      </p>
                      <div className="mt-3 flex items-baseline justify-between border-t border-slate-100 pt-2.5 font-mono text-xs tabular-nums dark:border-slate-800">
                        <span>Cap: {tier.defaultCap.toLocaleString()} learners</span>
                        <span className="font-semibold">
                          KES {tier.monthlyKes.toLocaleString()}/mo
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                {/* Tenant Selector List */}
                <div className="rounded-xl border border-slate-200 bg-white lg:col-span-7 dark:border-slate-800 dark:bg-slate-900">
                  <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
                    <h2 className="font-display text-sm font-bold">Select Tenant to Manage</h2>
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {(telemetry?.tenantRows || []).map((row) => {
                      const selected = row.tenant.id === selectedSubTenantId;
                      const isSuspended = row.tenant.status === 'Suspended';
                      return (
                        <button
                          key={row.tenant.id}
                          type="button"
                          onClick={() => setSelectedSubTenantId(row.tenant.id)}
                          className={`flex w-full items-center justify-between gap-4 px-5 py-3.5 text-left text-xs transition-colors ${
                            selected
                              ? 'bg-blue-50/70 dark:bg-blue-950/30'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="truncate font-semibold text-slate-900 dark:text-slate-100">
                                {row.tenant.name}
                              </span>
                              <span
                                className={`font-mono text-[11px] font-semibold ${
                                  isSuspended
                                    ? 'text-red-600 dark:text-red-400'
                                    : row.tenant.status === 'Trial'
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : 'text-emerald-600 dark:text-emerald-400'
                                }`}
                              >
                                [{row.tenant.status || 'Active'}]
                              </span>
                            </div>
                            <div className="mt-1 font-mono text-[11px] text-slate-500">
                              {row.tenant.plan} · {row.tenant.subscriptionCycle || 'Annual'} · Cap{' '}
                              {row.totalLearners}/{row.learnerCap} ({row.utilizationPct}%)
                            </div>
                          </div>
                          <Sliders className="h-4 w-4 shrink-0 text-slate-400" />
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Selected Tenant Lifecycle & Kill Switch Control Panel */}
                {selectedSubRow && (
                  <div className="space-y-5 lg:col-span-5">
                    <form
                      onSubmit={handleSaveSubscription}
                      className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div>
                        <h2 className="font-display text-sm font-bold">
                          Tier & Cap Allocation · {selectedSubRow.tenant.name}
                        </h2>
                        <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                          Current utilization: {selectedSubRow.totalLearners} /{' '}
                          {selectedSubRow.learnerCap} enrolled learners
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                            Assigned Tier
                          </label>
                          <select
                            value={editPlan}
                            onChange={(e) => {
                              const nextPlan = e.target.value as TenantPlan;
                              setEditPlan(nextPlan);
                              setEditCap(DEFAULT_TIER_LEARNER_CAPS[nextPlan]);
                            }}
                            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                          >
                            <option value="Starter">Starter</option>
                            <option value="Growth">Growth</option>
                            <option value="Enterprise">Enterprise</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                            Learner Cap
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={50000}
                            value={editCap}
                            onChange={(e) => setEditCap(Number(e.target.value))}
                            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs tabular-nums dark:border-slate-700 dark:bg-slate-950"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                            Billing Cycle
                          </label>
                          <select
                            value={editCycle}
                            onChange={(e) => setEditCycle(e.target.value as SubscriptionCycle)}
                            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                          >
                            <option value="Annual">Annual</option>
                            <option value="Monthly">Monthly</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                            Renewal Date
                          </label>
                          <input
                            type="date"
                            value={editRenewalDate}
                            onChange={(e) => setEditRenewalDate(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                          />
                        </div>
                      </div>

                      {editCap < selectedSubRow.totalLearners && (
                        <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                          Notice: Cap ({editCap}) is below current enrolled count (
                          {selectedSubRow.totalLearners}). New admissions/enrollments will be blocked
                          until raised.
                        </p>
                      )}

                      <button
                        type="submit"
                        disabled={subSaving}
                        className="w-full rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {subSaving ? 'Saving Lifecycle...' : 'Save Tier & Learner Cap'}
                      </button>
                    </form>

                    {/* Account Suspension / Kill Switch */}
                    <div className="space-y-3 rounded-xl border border-red-200 bg-white p-5 dark:border-red-900/60 dark:bg-slate-900">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-bold text-red-700 dark:text-red-400">
                          <Power className="h-4 w-4" />
                          Tenant Kill Switch
                        </div>
                        <span className="font-mono text-[11px] font-semibold">
                          State: {selectedSubRow.tenant.status || 'Active'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        Suspending immediately revokes all school staff login and live API access for{' '}
                        <span className="font-semibold">{selectedSubRow.tenant.name}</span>.
                      </p>

                      {selectedSubRow.tenant.status === 'Suspended' ? (
                        <div className="space-y-3">
                          {selectedSubRow.tenant.suspensionReason && (
                            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                              Reason: {selectedSubRow.tenant.suspensionReason}
                            </div>
                          )}
                          <button
                            type="button"
                            disabled={subSaving}
                            onClick={() => handleKillSwitch(selectedSubRow.tenant.id, 'Active')}
                            className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            Restore Tenant Access (Set Active)
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <input
                            type="text"
                            value={killReason}
                            onChange={(e) => setKillReason(e.target.value)}
                            placeholder="Suspension reason (e.g. Non-payment / security hold)"
                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                          />
                          {confirmKillTenantId === selectedSubRow.tenant.id ? (
                            <div className="flex gap-2">
                              <button
                                type="button"
                                disabled={subSaving}
                                onClick={() =>
                                  handleKillSwitch(selectedSubRow.tenant.id, 'Suspended', killReason)
                                }
                                className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                              >
                                Confirm Engage Kill Switch
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmKillTenantId(null)}
                                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium dark:border-slate-700"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmKillTenantId(selectedSubRow.tenant.id)}
                              className="w-full rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300"
                            >
                              Engage Kill Switch (Suspend Tenant)
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ============================================================
              MODULE 4: SAFE IMPERSONATION TOOL (/dev/impersonation)
             ============================================================ */}
          {section === 'impersonation' && (
            <div className="space-y-6">
              <div>
                <h1 className="font-display text-xl font-bold tracking-tight">
                  Safe Support Impersonation Tool
                </h1>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Issue a time-boxed (1 hour), audited support token to inspect any school workspace as
                  a target user. Read-Only mode blocks all mutating API writes in backend middleware.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                {/* School Directory Column */}
                <div className="rounded-xl border border-slate-200 bg-white lg:col-span-6 dark:border-slate-800 dark:bg-slate-900">
                  <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
                    <h2 className="font-display text-sm font-bold">1. Select Target School</h2>
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {targets.map((target) => {
                      const active = target.tenantId === selectedImpTarget?.tenantId;
                      return (
                        <button
                          key={target.tenantId}
                          type="button"
                          onClick={() => setImpTenantId(target.tenantId)}
                          className={`flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left text-xs ${
                            active
                              ? 'bg-blue-50/70 dark:bg-blue-950/30'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              {target.tenantName}
                            </div>
                            <div className="mt-0.5 font-mono text-[11px] text-slate-500">
                              @{target.emailDomain} · {target.plan} · {target.users.length} accounts
                            </div>
                          </div>
                          <span
                            className={`font-mono text-[11px] font-semibold ${
                              target.status === 'Suspended'
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-emerald-600 dark:text-emerald-400'
                            }`}
                          >
                            {target.status}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Account + Safety Mode Config Column */}
                {selectedImpTarget && (
                  <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-6 lg:col-span-6 dark:border-slate-800 dark:bg-slate-900">
                    <div>
                      <h2 className="font-display text-sm font-bold">
                        2. Configure Support Session · {selectedImpTarget.tenantName}
                      </h2>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        Your Developer credentials remain backed up so you can return cleanly to{' '}
                        <span className="font-mono">/dev</span> anytime.
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Target School Staff Account
                      </label>
                      <select
                        value={impUserId}
                        onChange={(e) => setImpUserId(e.target.value)}
                        className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                      >
                        {selectedImpTarget.users.filter((u) => u.status === 'Active').length === 0 ? (
                          <option value="">Auto-provision Support Admin on Launch</option>
                        ) : (
                          selectedImpTarget.users
                            .filter((u) => u.status === 'Active')
                            .map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.fullName} — {u.role} ({u.email})
                              </option>
                            ))
                        )}
                      </select>
                    </div>

                    <div className="space-y-2.5">
                      <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Isolation Safety Guard
                      </span>
                      <label
                        className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-xs ${
                          impReadOnly
                            ? 'border-blue-500 bg-blue-50/60 dark:border-blue-400 dark:bg-blue-950/30'
                            : 'border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        <input
                          type="radio"
                          name="imp-mode"
                          checked={impReadOnly}
                          onChange={() => setImpReadOnly(true)}
                          className="mt-0.5"
                        />
                        <div>
                          <div className="flex items-center gap-1.5 font-semibold">
                            <Eye className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                            Read-Only Support Mode (Recommended)
                          </div>
                          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                            Inspect records safely. Backend middleware rejects all write mutations
                            with HTTP 403.
                          </p>
                        </div>
                      </label>

                      <label
                        className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-xs ${
                          !impReadOnly
                            ? 'border-amber-500 bg-amber-50/60 dark:border-amber-500 dark:bg-amber-950/30'
                            : 'border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        <input
                          type="radio"
                          name="imp-mode"
                          checked={!impReadOnly}
                          onChange={() => setImpReadOnly(false)}
                          className="mt-0.5"
                        />
                        <div>
                          <div className="flex items-center gap-1.5 font-semibold">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                            Full Support Write Mode
                          </div>
                          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                            Permits edits on behalf of the school for urgent operational fixes. Every
                            session is logged in the audit trail.
                          </p>
                        </div>
                      </label>
                    </div>

                    <button
                      type="button"
                      disabled={impLaunching}
                      onClick={handleLaunchImpersonation}
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-700"
                    >
                      <UserCheck className="h-4 w-4" />
                      {impLaunching
                        ? 'Issuing Scoped Support Token...'
                        : 'Launch Audited Tenant Impersonation'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ============================================================
              MODULE 5: STATUTORY PAYROLL RATES (/dev/statutory-rates)
             ============================================================ */}
          {section === 'statutory-rates' && (
            <div className="space-y-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h1 className="font-display text-xl font-bold tracking-tight">
                    Kenya Statutory Payroll Rate Schedules
                  </h1>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Manage dated statutory configurations for NSSF, SHIF (pre-PAYE deductible), Affordable Housing Levy (employee &amp; employer match), NITA Levy, Personal Relief, and KRA PAYE bands.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setStatForm({
                      id: undefined,
                      effectiveFrom: new Date().toISOString().slice(0, 10),
                      label: 'Updated Kenya Statutory Schedule',
                      nssfLowerLimit: 9000,
                      nssfUpperLimit: 108000,
                      nssfRatePct: 6,
                      nssfMaxEmployee: 6480,
                      shifRatePct: 2.75,
                      shifMin: 300,
                      housingLevyRatePct: 1.5,
                      nitaLevy: 50,
                      personalRelief: 2400,
                    });
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New Effective-Dated Schedule
                </button>
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                {/* Schedules History List */}
                <div className="rounded-xl border border-slate-200 bg-white lg:col-span-5 dark:border-slate-800 dark:bg-slate-900">
                  <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
                    <h2 className="font-display text-sm font-bold">Dated Rate Schedules</h2>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      Pay periods resolve the latest schedule whose effective date is on or before the pay month.
                    </p>
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {statutorySchedules.length === 0 ? (
                      <p className="p-6 text-center text-xs text-slate-500">
                        No statutory schedules loaded.
                      </p>
                    ) : (
                      statutorySchedules.map((sched, idx) => {
                        const isEditing = statForm.id === sched.id;
                        return (
                          <button
                            key={sched.id}
                            type="button"
                            onClick={() => loadStatutoryScheduleIntoForm(sched)}
                            className={`block w-full px-5 py-4 text-left text-xs transition-colors ${
                              isEditing
                                ? 'bg-blue-50/70 dark:bg-blue-950/30'
                                : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-slate-900 dark:text-slate-100">
                                {sched.label}
                              </span>
                              <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                                {idx === 0 ? 'Active Latest' : `Effective ${sched.effectiveFrom}`}
                              </span>
                            </div>
                            <div className="mt-1.5 grid grid-cols-2 gap-1 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                              <span>Effective: {sched.effectiveFrom}</span>
                              <span>NSSF Max: KES {sched.nssfMaxEmployee.toLocaleString()}</span>
                              <span>SHIF: {(sched.shifRate * 100).toFixed(2)}% (min {sched.shifMin})</span>
                              <span>AHL: {(sched.housingLevyRate * 100).toFixed(2)}% + Match</span>
                              <span>Relief: KES {sched.personalRelief.toLocaleString()}</span>
                              <span>NITA: KES {sched.nitaLevy.toLocaleString()}</span>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Editor Form */}
                <form
                  onSubmit={handleSaveStatutorySchedule}
                  className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 lg:col-span-7 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="font-display text-sm font-bold">
                        {statForm.id ? `Edit Schedule (${statForm.id})` : 'Create New Statutory Schedule'}
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        SHIF &amp; Housing Levy are deducted before computing KRA PAYE bands.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Schedule Label
                      </label>
                      <input
                        type="text"
                        required
                        value={statForm.label}
                        onChange={(e) => setStatForm({ ...statForm, label: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Effective From
                      </label>
                      <input
                        type="date"
                        required
                        value={statForm.effectiveFrom}
                        onChange={(e) => setStatForm({ ...statForm, effectiveFrom: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                        NSSF LEL (KES)
                      </label>
                      <input
                        type="number"
                        min={0}
                        required
                        value={statForm.nssfLowerLimit}
                        onChange={(e) => setStatForm({ ...statForm, nssfLowerLimit: Number(e.target.value) })}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                        NSSF UEL (KES)
                      </label>
                      <input
                        type="number"
                        min={0}
                        required
                        value={statForm.nssfUpperLimit}
                        onChange={(e) => setStatForm({ ...statForm, nssfUpperLimit: Number(e.target.value) })}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                        NSSF Rate (%)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        max={50}
                        required
                        value={statForm.nssfRatePct}
                        onChange={(e) => setStatForm({ ...statForm, nssfRatePct: Number(e.target.value) })}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                        NSSF Max EE (KES)
                      </label>
                      <input
                        type="number"
                        min={0}
                        required
                        value={statForm.nssfMaxEmployee}
                        onChange={(e) => setStatForm({ ...statForm, nssfMaxEmployee: Number(e.target.value) })}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                        SHIF Rate (%)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        max={25}
                        required
                        value={statForm.shifRatePct}
                        onChange={(e) => setStatForm({ ...statForm, shifRatePct: Number(e.target.value) })}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                        SHIF Min (KES)
                      </label>
                      <input
                        type="number"
                        min={0}
                        required
                        value={statForm.shifMin}
                        onChange={(e) => setStatForm({ ...statForm, shifMin: Number(e.target.value) })}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                        Housing Levy (%)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        max={25}
                        required
                        value={statForm.housingLevyRatePct}
                        onChange={(e) =>
                          setStatForm({ ...statForm, housingLevyRatePct: Number(e.target.value) })
                        }
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                        NITA Levy (KES)
                      </label>
                      <input
                        type="number"
                        min={0}
                        required
                        value={statForm.nitaLevy}
                        onChange={(e) => setStatForm({ ...statForm, nitaLevy: Number(e.target.value) })}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                        Personal Relief
                      </label>
                      <input
                        type="number"
                        min={0}
                        required
                        value={statForm.personalRelief}
                        onChange={(e) => setStatForm({ ...statForm, personalRelief: Number(e.target.value) })}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                  </div>

                  {/* PAYE Bands Editor */}
                  <div className="border-t border-slate-200 pt-3 dark:border-slate-800">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Monthly KRA PAYE Tax Bands (Incremental Width &amp; Rate %)
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setStatBands((prev) => [...prev, { limit: '', ratePct: 35 }])
                        }
                        className="text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400"
                      >
                        + Add Band
                      </button>
                    </div>
                    <div className="space-y-2">
                      {statBands.map((band, idx) => (
                        <div key={idx} className="grid grid-cols-12 items-center gap-2 text-xs">
                          <span className="col-span-3 font-mono text-[11px] text-slate-500">
                            Band {idx + 1}
                          </span>
                          <div className="col-span-5">
                            <input
                              type="number"
                              min={1}
                              value={band.limit}
                              placeholder="Blank = Excess above"
                              onChange={(e) =>
                                setStatBands((prev) =>
                                  prev.map((item, i) =>
                                    i === idx ? { ...item, limit: e.target.value } : item
                                  )
                                )
                              }
                              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                            />
                          </div>
                          <div className="col-span-3 flex items-center gap-1">
                            <input
                              type="number"
                              step="0.1"
                              min={0}
                              max={100}
                              required
                              value={band.ratePct}
                              onChange={(e) =>
                                setStatBands((prev) =>
                                  prev.map((item, i) =>
                                    i === idx ? { ...item, ratePct: Number(e.target.value) } : item
                                  )
                                )
                              }
                              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                            />
                            <span className="font-mono text-slate-500">%</span>
                          </div>
                          <div className="col-span-1 text-right">
                            {statBands.length > 1 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setStatBands((prev) => prev.filter((_, i) => i !== idx))
                                }
                                className="text-xs font-semibold text-red-600 hover:underline"
                              >
                                ×
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={statSaving}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Save className="h-3.5 w-3.5" />
                    {statSaving ? 'Saving Schedule...' : 'Save Statutory Schedule'}
                  </button>
                </form>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
