import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  Building2,
  CalendarClock,
  CheckSquare,
  Eye,
  EyeOff,
  GraduationCap,
  KeyRound,
  Landmark,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  Terminal,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { AuthPortal } from './components/AuthPortal';
import type { DevRouteSection } from './components/DeveloperPanel';

const AnalyticsDashboard = lazy(() =>
  import('./components/AnalyticsDashboard').then((m) => ({ default: m.AnalyticsDashboard }))
);
const AdmissionsModule = lazy(() =>
  import('./components/AdmissionsModule').then((m) => ({ default: m.AdmissionsModule }))
);
const AttendanceModule = lazy(() =>
  import('./components/AttendanceModule').then((m) => ({ default: m.AttendanceModule }))
);
const CommunicationsModule = lazy(() =>
  import('./components/CommunicationsModule').then((m) => ({ default: m.CommunicationsModule }))
);
const DeveloperPanel = lazy(() =>
  import('./components/DeveloperPanel').then((m) => ({ default: m.DeveloperPanel }))
);
const ExamsModule = lazy(() =>
  import('./components/ExamsModule').then((m) => ({ default: m.ExamsModule }))
);
const FinanceModule = lazy(() =>
  import('./components/FinanceModule').then((m) => ({ default: m.FinanceModule }))
);
const SettingsModule = lazy(() =>
  import('./components/SettingsModule').then((m) => ({ default: m.SettingsModule }))
);
const SuperAdminModule = lazy(() =>
  import('./components/SuperAdminModule').then((m) => ({ default: m.SuperAdminModule }))
);
const TimetableModule = lazy(() =>
  import('./components/TimetableModule').then((m) => ({ default: m.TimetableModule }))
);
import {
  isDeveloperRoleClient,
  saasApi,
  setUnauthorizedHandler,
  useTenantSocket,
} from './lib/api';
import { formatTimeAgo } from './lib/format';
import {
  getContrastForeground,
  getTenantBrandingCssVars,
  getTenantInitials,
  normalizeHex,
  resolveTenantSidebarTheme,
} from './lib/theme';
import {
  DEFAULT_TENANT_BRANDING,
  getEffectiveUserModules,
  PASSWORD_MIN_LENGTH,
  validatePasswordStrength,
  type AuthSessionInfo,
  type NotificationItem,
  type TenantBranding,
  type TenantModulePermission,
  type TenantWorkspaceData,
  type UserRole,
  type WsServerEvent,
} from './shared/types';

type ModuleId =
  | 'analytics'
  | 'admissions'
  | 'timetable'
  | 'attendance'
  | 'exams'
  | 'fees'
  | 'communications'
  | 'settings'
  | 'super-admin';

const NAV_ITEMS: Array<{ id: ModuleId; label: string; icon: typeof BarChart3; adminOnly?: boolean }> = [
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'admissions', label: 'Admissions', icon: UserPlus },
  { id: 'timetable', label: 'Timetable', icon: CalendarClock },
  { id: 'attendance', label: 'Attendance', icon: CheckSquare },
  { id: 'exams', label: 'Exams & Grades', icon: GraduationCap },
  { id: 'fees', label: 'Finance & Accounting', icon: Landmark },
  { id: 'communications', label: 'Communications', icon: MessageSquare },
  { id: 'settings', label: 'School Settings', icon: Settings },
  { id: 'super-admin', label: 'Super Admin', icon: ShieldCheck, adminOnly: true },
];

interface ToastItem {
  id: string;
  title: string;
  tone: 'success' | 'error' | 'info';
}

function parseDevRoutePath(pathname: string): {
  isDevRoute: boolean;
  devSection: DevRouteSection;
} {
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (clean === '/dev' || clean === '/dev/telemetry') {
    return { isDevRoute: true, devSection: 'telemetry' };
  }
  if (clean === '/dev/onboarding') {
    return { isDevRoute: true, devSection: 'onboarding' };
  }
  if (clean === '/dev/subscriptions') {
    return { isDevRoute: true, devSection: 'subscriptions' };
  }
  if (clean === '/dev/impersonation') {
    return { isDevRoute: true, devSection: 'impersonation' };
  }
  if (clean === '/dev/statutory-rates') {
    return { isDevRoute: true, devSection: 'statutory-rates' };
  }
  if (clean.startsWith('/dev/')) {
    return { isDevRoute: true, devSection: 'telemetry' };
  }
  return { isDevRoute: false, devSection: 'telemetry' };
}

export default function App() {
  const [routePath, setRoutePath] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.pathname : '/'
  );
  const routeInfo = useMemo(() => parseDevRoutePath(routePath), [routePath]);

  const navigatePath = useCallback((nextPath: string) => {
    if (typeof window !== 'undefined' && window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath);
    }
    setRoutePath(nextPath);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setRoutePath(window.location.pathname);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const [authSession, setAuthSession] = useState<AuthSessionInfo | null>(() =>
    saasApi.getPersistedAuthSession()
  );
  const [authChecking, setAuthChecking] = useState<boolean>(() =>
    Boolean(saasApi.getPersistedAuthSession())
  );

  const [tenantId, setTenantId] = useState<string>(() => {
    const initial = saasApi.getPersistedAuthSession();
    if (!initial) return '';
    return isDeveloperRoleClient(initial.user.role) && !initial.impersonator
      ? 'tenant-oakridge'
      : initial.user.tenantId;
  });
  const [activeModule, setActiveModule] = useState<ModuleId>('analytics');
  const [workspace, setWorkspace] = useState<TenantWorkspaceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifDrawerOpen, setNotifDrawerOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [previewBrandingOverride, setPreviewBrandingOverride] = useState<TenantBranding | null>(null);

  // Forced password rotation state for 1-time password accounts
  const [otpCurrentPassword, setOtpCurrentPassword] = useState('');
  const [otpNewPassword, setOtpNewPassword] = useState('');
  const [otpConfirmPassword, setOtpConfirmPassword] = useState('');
  const [otpShowPasswords, setOtpShowPasswords] = useState(false);
  const [otpSubmitting, setOtpSubmitting] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);

  const currentRole: UserRole = authSession?.user.role || 'Teacher';
  const requiresPasswordChange = Boolean(
    authSession && !authSession.impersonator && authSession.user.mustChangePassword
  );
  const isPlatformSuperAdmin = Boolean(
    authSession && isDeveloperRoleClient(authSession.user.role) && !authSession.impersonator
  );
  const canAccessSuperAdmin =
    !authSession?.impersonator &&
    (currentRole === 'Developer' || currentRole === 'Super Admin' || currentRole === 'Admin');
  const effectiveModules = useMemo(
    () => getEffectiveUserModules(authSession?.user),
    [authSession?.user]
  );

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [darkMode]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAuthSession(null);
      setWorkspace(null);
      setTenantId('');
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    let active = true;
    const stored = saasApi.getPersistedAuthSession();
    if (!stored) {
      setAuthChecking(false);
      return;
    }
    saasApi
      .verifyAuthSession()
      .then((verified) => {
        if (!active) return;
        if (!verified) {
          setAuthSession(null);
          setWorkspace(null);
          setTenantId('');
        } else {
          setAuthSession(verified);
          setTenantId((prev) =>
            isDeveloperRoleClient(verified.user.role) && !verified.impersonator
              ? prev || 'tenant-oakridge'
              : verified.user.tenantId
          );
        }
      })
      .finally(() => {
        if (active) setAuthChecking(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setPreviewBrandingOverride(null);
  }, [tenantId, activeModule]);

  const pushToast = useCallback((title: string, tone: 'success' | 'error' | 'info' = 'success') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-3), { id, title, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const loadWorkspace = useCallback(async (targetTenantId: string, silent = false) => {
    if (!targetTenantId) return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await saasApi.getWorkspace(targetTenantId);
      setWorkspace(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load workspace data');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authSession || !tenantId || requiresPasswordChange || routeInfo.isDevRoute) return;
    loadWorkspace(tenantId);
  }, [authSession, tenantId, requiresPasswordChange, routeInfo.isDevRoute, loadWorkspace]);

  const handleWsEvent = useCallback(
    (event: WsServerEvent) => {
      if (!authSession || !tenantId || requiresPasswordChange) return;
      if (event.tenantId && event.tenantId !== tenantId) return;

      if (event.type === 'notification:new') {
        const notif = event.payload as NotificationItem | undefined;
        if (notif) {
          pushToast(notif.title, 'info');
        }
        loadWorkspace(tenantId, true);
      } else if (
        event.type === 'workspace:sync' ||
        event.type === 'message:new' ||
        event.type === 'announcement:new'
      ) {
        loadWorkspace(tenantId, true);
      }
    },
    [authSession, tenantId, requiresPasswordChange, loadWorkspace, pushToast]
  );

  const { connected: wsConnected } = useTenantSocket(
    authSession && !requiresPasswordChange ? tenantId : '',
    handleWsEvent,
    authSession?.token
  );

  const unreadCount = useMemo(
    () => workspace?.notifications.filter((n) => !n.read).length ?? 0,
    [workspace]
  );

  const visibleNavItems = useMemo(
    () =>
      NAV_ITEMS.filter((item) => {
        if (item.id === 'super-admin') return canAccessSuperAdmin;
        return effectiveModules.includes(item.id as TenantModulePermission);
      }),
    [canAccessSuperAdmin, effectiveModules]
  );

  useEffect(() => {
    if (visibleNavItems.length === 0) return;
    if (!visibleNavItems.some((item) => item.id === activeModule)) {
      setActiveModule(visibleNavItems[0].id);
    }
  }, [activeModule, visibleNavItems]);

  const activeNavLabel =
    NAV_ITEMS.find((n) => n.id === activeModule)?.label || visibleNavItems[0]?.label || 'Workspace';

  const activeBranding =
    activeModule === 'super-admin' && previewBrandingOverride
      ? previewBrandingOverride
      : workspace?.tenant.branding;
  const brandVars = useMemo(
    () => getTenantBrandingCssVars(activeBranding, darkMode),
    [activeBranding, darkMode]
  );
  const sidebarTheme = useMemo(
    () => resolveTenantSidebarTheme(activeBranding, darkMode),
    [activeBranding, darkMode]
  );
  const activePrimaryHex = normalizeHex(
    activeBranding?.primaryColor,
    DEFAULT_TENANT_BRANDING.primaryColor
  );

  useEffect(() => {
    if (!authSession) return;
    const rootStyle = document.documentElement.style;
    const entries = Object.entries(brandVars);
    entries.forEach(([key, value]) => {
      rootStyle.setProperty(key, value);
    });
  }, [authSession, brandVars]);

  function handleAuthenticated(session: AuthSessionInfo) {
    setAuthSession(session);
    setAuthChecking(false);
    setWorkspace(null);
    setError(null);
    setOtpCurrentPassword('');
    setOtpNewPassword('');
    setOtpConfirmPassword('');
    setOtpError(null);

    if (session.user.mustChangePassword && !session.impersonator) {
      return;
    }

    if (isDeveloperRoleClient(session.user.role) && !session.impersonator) {
      setTenantId('tenant-oakridge');
      setActiveModule('analytics');
      navigatePath('/dev/telemetry');
    } else {
      const allowed = getEffectiveUserModules(session.user);
      setTenantId(session.user.tenantId);
      setActiveModule(allowed[0] || 'analytics');
      if (routeInfo.isDevRoute) {
        navigatePath('/');
      }
    }
    pushToast(`Signed in as ${session.user.fullName} (${session.user.email})`, 'success');
  }

  async function handleOtpPasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setOtpError(null);
    if (!otpCurrentPassword) {
      setOtpError('Enter the 1-time password provided to you.');
      return;
    }
    const passwordPolicyErr = validatePasswordStrength(otpNewPassword);
    if (passwordPolicyErr) {
      setOtpError(passwordPolicyErr);
      return;
    }
    if (otpNewPassword !== otpConfirmPassword) {
      setOtpError('Password confirmation does not match.');
      return;
    }
    setOtpSubmitting(true);
    try {
      const updatedSession = await saasApi.changePassword({
        currentPassword: otpCurrentPassword,
        newPassword: otpNewPassword,
      });
      handleAuthenticated(updatedSession);
      pushToast('Password updated. Welcome to your workspace.', 'success');
    } catch (err) {
      setOtpError(err instanceof Error ? err.message : 'Unable to update password.');
    } finally {
      setOtpSubmitting(false);
    }
  }

  function handleImpersonationStarted(session: AuthSessionInfo) {
    setAuthSession(session);
    setWorkspace(null);
    setError(null);
    setTenantId(session.user.tenantId);
    const allowed = getEffectiveUserModules(session.user);
    setActiveModule(allowed[0] || 'analytics');
    navigatePath('/');
  }

  async function handleExitImpersonation() {
    const restored = await saasApi.devExitImpersonation();
    setWorkspace(null);
    setError(null);
    if (restored) {
      setAuthSession(restored);
      setTenantId('tenant-oakridge');
      navigatePath('/dev/impersonation');
      pushToast(`Returned to Developer Control Plane (${restored.user.email})`, 'info');
    } else {
      setAuthSession(null);
      navigatePath('/');
    }
  }

  async function handleSignOut() {
    await saasApi.logout();
    setAuthSession(null);
    setWorkspace(null);
    setTenantId('');
    setActiveModule('analytics');
    setMobileMenuOpen(false);
    setNotifDrawerOpen(false);
    setOtpCurrentPassword('');
    setOtpNewPassword('');
    setOtpConfirmPassword('');
    setOtpError(null);
    navigatePath('/');
  }

  const handleNavigate = (mod: string) => {
    const valid = visibleNavItems.find((n) => n.id === mod);
    if (valid) {
      setActiveModule(valid.id);
      setMobileMenuOpen(false);
      setNotifDrawerOpen(false);
    }
  };

  async function handleMarkAllRead() {
    if (!workspace) return;
    await saasApi.markNotificationsRead(workspace.tenant.id);
    await loadWorkspace(workspace.tenant.id, true);
  }

  if (authChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="w-72 space-y-3 text-center">
          <div className="mx-auto h-10 w-10 animate-pulse rounded-lg bg-blue-600/20" />
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Verifying your session...
          </p>
        </div>
      </div>
    );
  }

  if (!authSession) {
    return (
      <AuthPortal
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((d) => !d)}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  if (requiresPasswordChange) {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-10 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <button
          type="button"
          onClick={() => setDarkMode((d) => !d)}
          aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
          className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-7 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white">
              <KeyRound className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-lg font-bold tracking-tight">
                Change 1-Time Password
              </h1>
              <p className="truncate font-mono text-xs text-slate-500 dark:text-slate-400">
                {authSession.user.email}
              </p>
            </div>
          </div>

          <p className="mt-4 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            Your account was provisioned with a temporary 1-time password. Set a permanent password
            to unlock {authSession.tenantName || 'your workspace'}.
          </p>

          {otpError && (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
            >
              {otpError}
            </div>
          )}

          <form onSubmit={handleOtpPasswordChange} className="mt-5 space-y-4">
            <div>
              <label
                htmlFor="otp-current"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Current 1-Time Password
              </label>
              <input
                id="otp-current"
                type={otpShowPasswords ? 'text' : 'password'}
                required
                autoFocus
                value={otpCurrentPassword}
                onChange={(e) => setOtpCurrentPassword(e.target.value)}
                placeholder="Enter your temporary password"
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 font-mono text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <div>
              <label
                htmlFor="otp-new"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                New Password (min. {PASSWORD_MIN_LENGTH} chars, letter + number)
              </label>
              <div className="relative mt-1.5">
                <input
                  id="otp-new"
                  type={otpShowPasswords ? 'text' : 'password'}
                  required
                  minLength={PASSWORD_MIN_LENGTH}
                  value={otpNewPassword}
                  onChange={(e) => setOtpNewPassword(e.target.value)}
                  placeholder="Create a strong password"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 pr-10 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <button
                  type="button"
                  onClick={() => setOtpShowPasswords((v) => !v)}
                  aria-label={otpShowPasswords ? 'Hide passwords' : 'Show passwords'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  {otpShowPasswords ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="otp-confirm"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Confirm New Password
              </label>
              <input
                id="otp-confirm"
                type={otpShowPasswords ? 'text' : 'password'}
                required
                minLength={PASSWORD_MIN_LENGTH}
                value={otpConfirmPassword}
                onChange={(e) => setOtpConfirmPassword(e.target.value)}
                placeholder="Repeat new password"
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <button
                type="button"
                onClick={handleSignOut}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </button>
              <button
                type="submit"
                disabled={otpSubmitting}
                className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <span>{otpSubmitting ? 'Updating...' : 'Set Password & Continue'}</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  if (routeInfo.isDevRoute) {
    return (
      <>
        <Suspense
          fallback={
            <div className="flex min-h-screen items-center justify-center bg-slate-950 text-xs text-slate-400">
              Loading Developer Console...
            </div>
          }
        >
          <DeveloperPanel
            section={routeInfo.devSection}
            onSelectSection={(sec) =>
              navigatePath(sec === 'telemetry' ? '/dev/telemetry' : `/dev/${sec}`)
            }
            onExitToSchoolPortal={() => navigatePath('/')}
            authSession={authSession}
            onAuthenticated={handleAuthenticated}
            onImpersonationStarted={handleImpersonationStarted}
            onExitImpersonation={handleExitImpersonation}
            onSignOut={handleSignOut}
            darkMode={darkMode}
            onToggleDarkMode={() => setDarkMode((d) => !d)}
            onNotify={pushToast}
          />
        </Suspense>
        {toasts.length > 0 && (
          <div className="fixed bottom-5 right-5 z-50 flex max-w-sm flex-col gap-2 no-print">
            {toasts.map((t) => (
              <div
                key={t.id}
                className={`rounded-lg border px-4 py-3 text-xs font-medium shadow-lg transition-all duration-150 ${
                  t.tone === 'error'
                    ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100'
                    : 'border-slate-200 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'
                }`}
              >
                {t.title}
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <div
      style={brandVars as CSSProperties}
      className="tenant-themed-app min-h-screen text-slate-900 dark:text-slate-100"
    >
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          onClick={() => setMobileMenuOpen(false)}
          className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden"
        />
      )}

      {/* Left Sidebar Navigation (256px) */}
      <aside
        style={{
          backgroundColor: sidebarTheme.backgroundColor,
          borderColor: sidebarTheme.borderColor,
          color: sidebarTheme.textColor,
        }}
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r transition-all duration-200 lg:translate-x-0 no-print ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="tenant-brand-stripe h-1 w-full shrink-0" />
        {/* Brand Lockup (Active Tenant Logo + Wordmark) */}
        <div
          style={{ borderColor: sidebarTheme.borderColor }}
          className="flex h-16 items-center justify-between gap-2 border-b px-4"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            {activeBranding?.logoDataUrl ? (
              <img
                src={activeBranding.logoDataUrl}
                alt={`${workspace?.tenant.name || 'School'} logo`}
                referrerPolicy="no-referrer"
                className="tenant-pure-white h-9 w-9 shrink-0 rounded-lg border border-black/10 bg-white object-contain p-0.5"
              />
            ) : (
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold"
                style={{
                  backgroundColor: activePrimaryHex,
                  color: getContrastForeground(activePrimaryHex),
                }}
              >
                {getTenantInitials(workspace?.tenant.name || authSession.tenantName || 'elimuNest')}
              </div>
            )}
            <div className="min-w-0">
              <span className="block truncate font-display text-sm font-bold tracking-tight">
                {workspace?.tenant.name || authSession.tenantName || 'elimuNest'}
              </span>
              <span
                style={{ color: sidebarTheme.mutedColor }}
                className="block truncate text-[11px]"
              >
                {activeBranding?.tagline ||
                  (workspace?.tenant.emailDomain ? `@${workspace.tenant.emailDomain}` : 'elimuNest Platform')}
              </span>
            </div>
          </div>
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="rounded-lg p-1 opacity-75 hover:opacity-100 lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Authenticated School Context & Signed-In Account */}
        <div
          style={{ borderColor: sidebarTheme.borderColor }}
          className="space-y-3 border-b p-4"
        >
          {isPlatformSuperAdmin ? (
            <div>
              <label
                htmlFor="tenant-select"
                style={{ color: sidebarTheme.mutedColor }}
                className="flex items-center gap-1.5 text-xs font-medium"
              >
                <Building2 className="h-3.5 w-3.5" />
                Active School Tenant
              </label>
              <select
                id="tenant-select"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                style={{
                  backgroundColor: sidebarTheme.inputBg,
                  borderColor: sidebarTheme.inputBorder,
                  color: sidebarTheme.textColor,
                }}
                className="mt-1.5 w-full rounded-lg border px-2.5 py-2 text-xs font-semibold focus:outline-none"
              >
                {(workspace?.tenants || []).map((t) => (
                  <option key={t.id} value={t.id} className="text-slate-900">
                    {t.name}
                  </option>
                ))}
                {!workspace && <option value="tenant-oakridge">Oakridge Preparatory Academy</option>}
              </select>
              {workspace && (
                <p
                  style={{ color: sidebarTheme.mutedColor }}
                  className="mt-1.5 truncate text-[11px]"
                >
                  {workspace.tenant.location} · @{workspace.tenant.emailDomain || 'school'}
                </p>
              )}
            </div>
          ) : (
            <div
              style={{
                backgroundColor: sidebarTheme.inputBg,
                borderColor: sidebarTheme.inputBorder,
              }}
              className="rounded-lg border px-3 py-2"
            >
              <div
                style={{ color: sidebarTheme.mutedColor }}
                className="flex items-center gap-1.5 text-[11px] font-medium"
              >
                <Building2 className="h-3.5 w-3.5" />
                Isolated School Workspace
              </div>
              <p className="mt-0.5 truncate text-xs font-semibold">
                {workspace?.tenant.name || authSession.tenantName}
              </p>
              <p style={{ color: sidebarTheme.mutedColor }} className="truncate font-mono text-[11px]">
                @{workspace?.tenant.emailDomain || authSession.emailDomain || 'school'}
              </p>
            </div>
          )}

          <div
            style={{
              backgroundColor: sidebarTheme.inputBg,
              borderColor: sidebarTheme.inputBorder,
            }}
            className="rounded-lg border px-3 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span
                style={{ color: sidebarTheme.mutedColor }}
                className="flex items-center gap-1 text-[11px] font-medium"
              >
                <UserCheck className="h-3 w-3" />
                {authSession.user.roleLabel || authSession.user.role}
              </span>
              <button
                type="button"
                onClick={handleSignOut}
                className="text-[11px] font-semibold opacity-80 hover:underline hover:opacity-100"
              >
                Sign out
              </button>
            </div>
            <p className="mt-0.5 truncate text-xs font-semibold">{authSession.user.fullName}</p>
            <p style={{ color: sidebarTheme.mutedColor }} className="truncate font-mono text-[11px]">
              {authSession.user.email}
            </p>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Main modules">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = activeModule === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNavigate(item.id)}
                style={
                  active
                    ? {
                        backgroundColor: sidebarTheme.activeBg,
                        color: sidebarTheme.activeFg,
                      }
                    : {
                        color: sidebarTheme.mutedColor,
                      }
                }
                className={`flex w-full items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                  active
                    ? 'font-semibold'
                    : sidebarTheme.isLight
                    ? 'font-medium hover:bg-black/5'
                    : 'font-medium hover:bg-white/10'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Footer Provision Link */}
        <div
          style={{ borderColor: sidebarTheme.borderColor }}
          className="space-y-2 border-t p-4"
        >
          {isPlatformSuperAdmin && (
            <button
              type="button"
              onClick={() => navigatePath('/dev/telemetry')}
              style={{
                borderColor: sidebarTheme.inputBorder,
                color: sidebarTheme.textColor,
              }}
              className={`flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 font-mono text-xs font-semibold transition-colors ${
                sidebarTheme.isLight ? 'hover:bg-black/5' : 'hover:bg-white/10'
              }`}
            >
              <Terminal className="h-3.5 w-3.5" />
              Developer Panel (/dev)
            </button>
          )}
          {(canAccessSuperAdmin || effectiveModules.includes('settings')) && (
            <button
              onClick={() =>
                handleNavigate(canAccessSuperAdmin ? 'super-admin' : 'settings')
              }
              style={{
                borderColor: sidebarTheme.inputBorder,
                color: sidebarTheme.textColor,
              }}
              className={`w-full rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                sidebarTheme.isLight ? 'hover:bg-black/5' : 'hover:bg-white/10'
              }`}
            >
              {isPlatformSuperAdmin
                ? 'Multi-Tenant Quick Admin'
                : canAccessSuperAdmin
                ? 'School Theme & Admin'
                : 'School Settings'}
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-h-screen flex-col lg:pl-64">
        <div className="tenant-brand-stripe h-1 w-full shrink-0 no-print" />
        {/* Support Impersonation Active Banner */}
        {authSession.impersonator && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-950 sm:px-8 no-print dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-100">
            <div className="flex min-w-0 items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
              <span className="truncate">
                <strong className="font-semibold">Support Impersonation Active:</strong> Viewing{' '}
                <span className="font-semibold">{workspace?.tenant.name || authSession.tenantName}</span>{' '}
                as <span className="font-mono">{authSession.user.email}</span> ({authSession.user.roleLabel || authSession.user.role}) ·{' '}
                <span className="font-mono font-semibold">
                  {authSession.impersonator.readOnly ? 'Read-Only Safe Mode' : 'Full Support Write Mode'}
                </span>{' '}
                · Operator: {authSession.impersonator.email}
              </span>
            </div>
            <button
              type="button"
              onClick={() => handleExitImpersonation()}
              className="shrink-0 whitespace-nowrap rounded-lg bg-amber-900 px-3 py-1 font-semibold text-white hover:bg-amber-950 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400"
            >
              Exit Impersonation → /dev
            </button>
          </div>
        )}
        {/* Top Header Contract */}
        <header className="tenant-header-bar sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b px-4 backdrop-blur sm:px-8 no-print">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden dark:text-slate-300 dark:hover:bg-slate-800"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>

            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm">
              {activeBranding?.logoDataUrl && (
                <img
                  src={activeBranding.logoDataUrl}
                  alt={`${workspace?.tenant.name || 'School'} logo`}
                  referrerPolicy="no-referrer"
                  className="tenant-pure-white h-6 w-6 shrink-0 rounded border border-slate-200 bg-white object-contain p-0.5 dark:border-slate-700"
                />
              )}
              <span className="hidden text-slate-400 sm:inline">elimuNest</span>
              <span className="hidden text-slate-300 sm:inline dark:text-slate-700">/</span>
              <span className="truncate font-medium text-slate-600 dark:text-slate-400">
                {workspace?.tenant.name || authSession.tenantName || 'Loading...'}
              </span>
              <span className="text-slate-300 dark:text-slate-700">/</span>
              <span className="whitespace-nowrap font-semibold text-slate-900 dark:text-slate-100">
                {activeNavLabel}
              </span>
            </nav>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isPlatformSuperAdmin && (
              <button
                type="button"
                onClick={() => navigatePath('/dev/telemetry')}
                className="hidden h-10 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 px-3 font-mono text-xs font-semibold text-slate-700 hover:bg-slate-50 md:flex dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Terminal className="h-3.5 w-3.5" />
                /dev
              </button>
            )}
            <button
              onClick={() => setDarkMode((d) => !d)}
              aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            <button
              onClick={() => setNotifDrawerOpen(true)}
              aria-label="Open notifications"
              className="relative flex h-10 items-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Bell className="h-4 w-4" />
              <span className="hidden sm:inline">Notifications</span>
              {unreadCount > 0 && (
                <span className="font-mono font-semibold text-blue-600 tabular-nums dark:text-blue-400">
                  ({unreadCount})
                </span>
              )}
            </button>

            <button
              onClick={handleSignOut}
              aria-label="Sign out"
              className="flex h-10 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden md:inline">Sign Out</span>
            </button>
          </div>
        </header>

        {/* Viewport Content */}
        <main className="mx-auto w-full max-w-[1360px] flex-1 p-4 sm:p-8">
          {loading && !workspace ? (
            <div className="space-y-6">
              <div className="h-8 w-64 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="h-28 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                  />
                ))}
              </div>
              <div className="h-72 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-white p-8 text-center dark:border-red-900/60 dark:bg-slate-900">
              <p className="text-sm font-semibold text-red-700 dark:text-red-400">{error}</p>
              <button
                onClick={() => loadWorkspace(tenantId)}
                className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700"
              >
                Retry Connection
              </button>
            </div>
          ) : workspace ? (
            <div key={workspace.tenant.id}>
              <Suspense
                fallback={
                  <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                    Loading workspace module...
                  </div>
                }
              >
                {activeModule === 'analytics' && effectiveModules.includes('analytics') && (
                  <AnalyticsDashboard
                    workspace={workspace}
                    currentRole={currentRole}
                    onNavigate={handleNavigate}
                  />
                )}
                {activeModule === 'admissions' && effectiveModules.includes('admissions') && (
                  <AdmissionsModule
                    workspace={workspace}
                    onRefresh={() => loadWorkspace(tenantId, true)}
                    onNotify={(msg, tone) => pushToast(msg, tone)}
                  />
                )}
                {activeModule === 'timetable' && effectiveModules.includes('timetable') && (
                  <TimetableModule
                    workspace={workspace}
                    currentRole={currentRole}
                    onRefresh={() => loadWorkspace(tenantId, true)}
                    onNotify={(msg, tone) => pushToast(msg, tone)}
                  />
                )}
                {activeModule === 'attendance' && effectiveModules.includes('attendance') && (
                  <AttendanceModule
                    workspace={workspace}
                    currentRole={currentRole}
                    onRefresh={() => loadWorkspace(tenantId, true)}
                    onNotify={(msg, tone) => pushToast(msg, tone)}
                  />
                )}
                {activeModule === 'exams' && effectiveModules.includes('exams') && (
                  <ExamsModule
                    workspace={workspace}
                    currentRole={currentRole}
                    onRefresh={() => loadWorkspace(tenantId, true)}
                    onNotify={(msg, tone) => pushToast(msg, tone)}
                  />
                )}
                {activeModule === 'fees' && effectiveModules.includes('fees') && (
                  <FinanceModule
                    workspace={workspace}
                    currentRole={currentRole}
                    onRefresh={() => loadWorkspace(tenantId, true)}
                    onNotify={(msg, tone) => pushToast(msg, tone)}
                  />
                )}
                {activeModule === 'communications' && effectiveModules.includes('communications') && (
                  <CommunicationsModule
                    workspace={workspace}
                    currentRole={currentRole}
                    wsConnected={wsConnected}
                    onRefresh={() => loadWorkspace(tenantId, true)}
                    onNotify={(msg, tone) => pushToast(msg, tone)}
                    onNavigate={handleNavigate}
                  />
                )}
                {activeModule === 'settings' && effectiveModules.includes('settings') && (
                  <SettingsModule
                    workspace={workspace}
                    currentRole={currentRole}
                    currentUserId={authSession.user.id}
                    onRefresh={() => loadWorkspace(tenantId, true)}
                    onSwitchTenant={(newId) => {
                      if (isPlatformSuperAdmin) {
                        setTenantId(newId);
                        setActiveModule('analytics');
                      }
                    }}
                    onNotify={(msg, tone) => pushToast(msg, tone)}
                  />
                )}
                {activeModule === 'super-admin' && canAccessSuperAdmin && (
                  <SuperAdminModule
                    workspace={workspace}
                    currentRole={currentRole}
                    onRefresh={() => loadWorkspace(tenantId, true)}
                    onPreviewBrandingChange={setPreviewBrandingOverride}
                    onSwitchTenant={(newId, targetModule) => {
                      if (isPlatformSuperAdmin || newId === workspace.tenant.id) {
                        setTenantId(newId);
                        if (targetModule) {
                          handleNavigate(targetModule);
                        } else {
                          setActiveModule('analytics');
                        }
                      }
                    }}
                    onNotify={(msg, tone) => pushToast(msg, tone)}
                  />
                )}
              </Suspense>
            </div>
          ) : null}
        </main>
      </div>

      {/* Real-Time Notifications Slide-Over Drawer */}
      {notifDrawerOpen && workspace && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 no-print">
          <div className="flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Tenant Notification Feed
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {wsConnected ? 'Live WebSocket stream active' : 'Connecting stream...'} ·{' '}
                  {workspace.tenant.name}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Mark all read
                  </button>
                )}
                <button
                  onClick={() => setNotifDrawerOpen(false)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 divide-y divide-slate-100 overflow-y-auto px-5 dark:divide-slate-800">
              {workspace.notifications.length === 0 ? (
                <p className="py-12 text-center text-xs text-slate-500">
                  No notifications recorded for this school tenant yet.
                </p>
              ) : (
                workspace.notifications.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => handleNavigate(n.targetModule)}
                    className="block w-full py-3.5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {!n.read && <span className="mr-1.5 text-blue-600">•</span>}
                        {n.title}
                      </span>
                      <span className="font-mono text-[11px] text-slate-400 tabular-nums shrink-0">
                        {formatTimeAgo(n.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                      {n.description}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast Stack */}
      {toasts.length > 0 && (
        <div className="fixed bottom-5 right-5 z-50 flex max-w-sm flex-col gap-2 no-print">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`rounded-lg border px-4 py-3 text-xs font-medium shadow-lg transition-all duration-150 ${
                t.tone === 'error'
                  ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100'
                  : 'border-slate-200 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'
              }`}
            >
              {t.title}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
