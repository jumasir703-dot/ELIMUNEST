import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Bell,
  Building2,
  CalendarClock,
  CheckSquare,
  CreditCard,
  GraduationCap,
  Menu,
  MessageSquare,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  UserPlus,
  X,
} from 'lucide-react';
import { AnalyticsDashboard } from './components/AnalyticsDashboard';
import { AdmissionsModule } from './components/AdmissionsModule';
import { AttendanceModule } from './components/AttendanceModule';
import { CommunicationsModule } from './components/CommunicationsModule';
import { ExamsModule } from './components/ExamsModule';
import { FeesModule } from './components/FeesModule';
import { SettingsModule } from './components/SettingsModule';
import { SuperAdminModule } from './components/SuperAdminModule';
import { TimetableModule } from './components/TimetableModule';
import { saasApi, useTenantSocket } from './lib/api';
import { formatTimeAgo } from './lib/format';
import {
  getContrastForeground,
  getTenantBrandingCssVars,
  getTenantInitials,
  hexToRgba,
  isLightColor,
  normalizeHex,
} from './lib/theme';
import {
  DEFAULT_TENANT_BRANDING,
  type NotificationItem,
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
  { id: 'fees', label: 'Fees & Billing', icon: CreditCard },
  { id: 'communications', label: 'Communications', icon: MessageSquare },
  { id: 'settings', label: 'School Settings', icon: Settings },
  { id: 'super-admin', label: 'Super Admin', icon: ShieldCheck, adminOnly: true },
];

const ROLES: UserRole[] = ['Super Admin', 'Admin', 'Registrar', 'Teacher', 'Bursar', 'Parent'];

interface ToastItem {
  id: string;
  title: string;
  tone: 'success' | 'error' | 'info';
}

export default function App() {
  const [tenantId, setTenantId] = useState<string>('tenant-oakridge');
  const [activeModule, setActiveModule] = useState<ModuleId>('analytics');
  const [currentRole, setCurrentRole] = useState<UserRole>('Admin');
  const [workspace, setWorkspace] = useState<TenantWorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifDrawerOpen, setNotifDrawerOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [darkMode]);

  const pushToast = useCallback((title: string, tone: 'success' | 'error' | 'info' = 'success') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-3), { id, title, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const loadWorkspace = useCallback(async (targetTenantId: string, silent = false) => {
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
    loadWorkspace(tenantId);
  }, [tenantId, loadWorkspace]);

  const handleWsEvent = useCallback(
    (event: WsServerEvent) => {
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
    [tenantId, loadWorkspace, pushToast]
  );

  const { connected: wsConnected } = useTenantSocket(tenantId, handleWsEvent);

  const unreadCount = useMemo(
    () => workspace?.notifications.filter((n) => !n.read).length ?? 0,
    [workspace]
  );

  const canAccessSuperAdmin = currentRole === 'Super Admin' || currentRole === 'Admin';

  useEffect(() => {
    if (activeModule === 'super-admin' && !canAccessSuperAdmin) {
      setActiveModule('analytics');
    }
  }, [activeModule, canAccessSuperAdmin]);

  const visibleNavItems = useMemo(
    () => NAV_ITEMS.filter((item) => !item.adminOnly || canAccessSuperAdmin),
    [canAccessSuperAdmin]
  );

  const activeNavLabel =
    NAV_ITEMS.find((n) => n.id === activeModule)?.label || 'Analytics';

  const activeBranding = workspace?.tenant.branding;
  const brandVars = useMemo(
    () => getTenantBrandingCssVars(activeBranding, darkMode),
    [activeBranding, darkMode]
  );
  const customSidebarHex = activeBranding?.sidebarColor?.trim()
    ? normalizeHex(activeBranding.sidebarColor, '#0F172A')
    : '';
  const hasCustomSidebar = Boolean(customSidebarHex);
  const customSidebarIsLight = customSidebarHex ? isLightColor(customSidebarHex) : !darkMode;
  const activePrimaryHex = normalizeHex(
    activeBranding?.primaryColor,
    DEFAULT_TENANT_BRANDING.primaryColor
  );

  const handleNavigate = (mod: string) => {
    const valid = NAV_ITEMS.find((n) => n.id === mod);
    if (valid && (!valid.adminOnly || canAccessSuperAdmin)) {
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

  return (
    <div
      style={brandVars}
      className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100"
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
        style={
          hasCustomSidebar
            ? {
                backgroundColor: customSidebarHex,
                borderColor: customSidebarIsLight
                  ? 'rgba(15, 23, 42, 0.12)'
                  : 'rgba(255, 255, 255, 0.12)',
                color: customSidebarIsLight ? '#0F172A' : '#F8FAFC',
              }
            : undefined
        }
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r transition-transform duration-200 lg:translate-x-0 no-print ${
          hasCustomSidebar
            ? ''
            : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
        } ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {/* Brand Lockup (Active Tenant Logo + Wordmark) */}
        <div
          style={
            hasCustomSidebar
              ? {
                  borderColor: customSidebarIsLight
                    ? 'rgba(15, 23, 42, 0.1)'
                    : 'rgba(255, 255, 255, 0.12)',
                }
              : undefined
          }
          className={`flex h-16 items-center justify-between gap-2 border-b px-4 ${
            hasCustomSidebar ? '' : 'border-slate-200 dark:border-slate-800'
          }`}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            {activeBranding?.logoDataUrl ? (
              <img
                src={activeBranding.logoDataUrl}
                alt={`${workspace?.tenant.name || 'School'} logo`}
                referrerPolicy="no-referrer"
                className="h-9 w-9 shrink-0 rounded-lg border border-black/10 bg-white object-contain p-0.5"
              />
            ) : (
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold"
                style={{
                  backgroundColor: activePrimaryHex,
                  color: getContrastForeground(activePrimaryHex),
                }}
              >
                {getTenantInitials(workspace?.tenant.name || 'elimuNest')}
              </div>
            )}
            <div className="min-w-0">
              <span
                className={`block truncate font-display text-sm font-bold tracking-tight ${
                  hasCustomSidebar ? '' : 'text-slate-900 dark:text-slate-100'
                }`}
              >
                {workspace?.tenant.name || 'elimuNest'}
              </span>
              <span
                style={
                  hasCustomSidebar
                    ? {
                        color: customSidebarIsLight
                          ? '#475569'
                          : 'rgba(248, 250, 252, 0.72)',
                      }
                    : undefined
                }
                className={`block truncate text-[11px] ${
                  hasCustomSidebar ? '' : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {activeBranding?.tagline || 'elimuNest Platform'}
              </span>
            </div>
          </div>
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 lg:hidden dark:hover:bg-slate-800"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tenant Switcher & Role Context */}
        <div
          style={
            hasCustomSidebar
              ? {
                  borderColor: customSidebarIsLight
                    ? 'rgba(15, 23, 42, 0.1)'
                    : 'rgba(255, 255, 255, 0.12)',
                }
              : undefined
          }
          className={`space-y-3 border-b p-4 ${
            hasCustomSidebar ? '' : 'border-slate-200 dark:border-slate-800'
          }`}
        >
          <div>
            <label
              htmlFor="tenant-select"
              style={
                hasCustomSidebar
                  ? {
                      color: customSidebarIsLight
                        ? '#475569'
                        : 'rgba(248, 250, 252, 0.72)',
                    }
                  : undefined
              }
              className={`flex items-center gap-1.5 text-xs font-medium ${
                hasCustomSidebar ? '' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Building2 className="h-3.5 w-3.5" />
              Active School Tenant
            </label>
            <select
              id="tenant-select"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              style={
                hasCustomSidebar && !customSidebarIsLight
                  ? {
                      backgroundColor: 'rgba(255, 255, 255, 0.1)',
                      borderColor: 'rgba(255, 255, 255, 0.18)',
                      color: '#F8FAFC',
                    }
                  : undefined
              }
              className={`mt-1.5 w-full rounded-lg border px-2.5 py-2 text-xs font-semibold focus:outline-none ${
                hasCustomSidebar && !customSidebarIsLight
                  ? ''
                  : 'border-slate-200 bg-slate-50 text-slate-900 focus:border-blue-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'
              }`}
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
                style={
                  hasCustomSidebar
                    ? {
                        color: customSidebarIsLight
                          ? '#475569'
                          : 'rgba(248, 250, 252, 0.7)',
                      }
                    : undefined
                }
                className={`mt-1.5 truncate text-[11px] ${
                  hasCustomSidebar ? '' : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {workspace.tenant.location} · {workspace.tenant.plan}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="role-select"
              style={
                hasCustomSidebar
                  ? {
                      color: customSidebarIsLight
                        ? '#475569'
                        : 'rgba(248, 250, 252, 0.72)',
                    }
                  : undefined
              }
              className={`block text-xs font-medium ${
                hasCustomSidebar ? '' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              Operator Role
            </label>
            <select
              id="role-select"
              value={currentRole}
              onChange={(e) => {
                const nextRole = e.target.value as UserRole;
                setCurrentRole(nextRole);
                if (nextRole === 'Super Admin') {
                  setActiveModule('super-admin');
                }
              }}
              style={
                hasCustomSidebar && !customSidebarIsLight
                  ? {
                      backgroundColor: 'rgba(255, 255, 255, 0.1)',
                      borderColor: 'rgba(255, 255, 255, 0.18)',
                      color: '#F8FAFC',
                    }
                  : undefined
              }
              className={`mt-1 w-full rounded-lg border px-2.5 py-1.5 text-xs font-medium focus:outline-none ${
                hasCustomSidebar && !customSidebarIsLight
                  ? ''
                  : 'border-slate-200 bg-white text-slate-800 focus:border-blue-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
              }`}
            >
              {ROLES.map((role) => (
                <option key={role} value={role} className="text-slate-900">
                  {role}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Main modules">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = activeModule === item.id;
            const activeStyle =
              hasCustomSidebar && !customSidebarIsLight
                ? {
                    backgroundColor: hexToRgba('#FFFFFF', 0.16),
                    color: '#FFFFFF',
                  }
                : undefined;
            const inactiveStyle =
              hasCustomSidebar && !customSidebarIsLight
                ? { color: 'rgba(248, 250, 252, 0.78)' }
                : hasCustomSidebar && customSidebarIsLight
                ? { color: '#334155' }
                : undefined;
            return (
              <button
                key={item.id}
                onClick={() => handleNavigate(item.id)}
                style={active ? activeStyle : inactiveStyle}
                className={`flex w-full items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                  active
                    ? hasCustomSidebar && !customSidebarIsLight
                      ? ''
                      : 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                    : hasCustomSidebar && !customSidebarIsLight
                    ? 'hover:bg-white/10 hover:text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-slate-100'
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
          style={
            hasCustomSidebar
              ? {
                  borderColor: customSidebarIsLight
                    ? 'rgba(15, 23, 42, 0.1)'
                    : 'rgba(255, 255, 255, 0.12)',
                }
              : undefined
          }
          className={`border-t p-4 ${
            hasCustomSidebar ? '' : 'border-slate-200 dark:border-slate-800'
          }`}
        >
          <button
            onClick={() =>
              handleNavigate(canAccessSuperAdmin ? 'super-admin' : 'settings')
            }
            style={
              hasCustomSidebar && !customSidebarIsLight
                ? {
                    borderColor: 'rgba(255, 255, 255, 0.22)',
                    color: '#F8FAFC',
                  }
                : undefined
            }
            className={`w-full rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
              hasCustomSidebar && !customSidebarIsLight
                ? 'hover:bg-white/10'
                : 'border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            {canAccessSuperAdmin ? 'Open Super Admin Panel' : '+ Provision New School'}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-h-screen flex-col lg:pl-64">
        {/* Top Header Contract */}
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-8 dark:border-slate-800 dark:bg-slate-900/95 no-print">
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
                  className="h-6 w-6 shrink-0 rounded border border-slate-200 bg-white object-contain p-0.5 dark:border-slate-700"
                />
              )}
              <span className="hidden text-slate-400 sm:inline">elimuNest</span>
              <span className="hidden text-slate-300 sm:inline dark:text-slate-700">/</span>
              <span className="truncate font-medium text-slate-600 dark:text-slate-400">
                {workspace?.tenant.name || 'Loading...'}
              </span>
              <span className="text-slate-300 dark:text-slate-700">/</span>
              <span className="whitespace-nowrap font-semibold text-slate-900 dark:text-slate-100">
                {activeNavLabel}
              </span>
            </nav>
          </div>

          <div className="flex items-center gap-2 shrink-0">
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
              {activeModule === 'analytics' && (
                <AnalyticsDashboard workspace={workspace} onNavigate={handleNavigate} />
              )}
              {activeModule === 'admissions' && (
                <AdmissionsModule
                  workspace={workspace}
                  onRefresh={() => loadWorkspace(tenantId, true)}
                  onNotify={(msg, tone) => pushToast(msg, tone)}
                />
              )}
              {activeModule === 'timetable' && (
                <TimetableModule
                  workspace={workspace}
                  onRefresh={() => loadWorkspace(tenantId, true)}
                  onNotify={(msg, tone) => pushToast(msg, tone)}
                />
              )}
              {activeModule === 'attendance' && (
                <AttendanceModule
                  workspace={workspace}
                  currentRole={currentRole}
                  onRefresh={() => loadWorkspace(tenantId, true)}
                  onNotify={(msg, tone) => pushToast(msg, tone)}
                />
              )}
              {activeModule === 'exams' && (
                <ExamsModule
                  workspace={workspace}
                  currentRole={currentRole}
                  onRefresh={() => loadWorkspace(tenantId, true)}
                  onNotify={(msg, tone) => pushToast(msg, tone)}
                />
              )}
              {activeModule === 'fees' && (
                <FeesModule
                  workspace={workspace}
                  currentRole={currentRole}
                  onRefresh={() => loadWorkspace(tenantId, true)}
                  onNotify={(msg, tone) => pushToast(msg, tone)}
                />
              )}
              {activeModule === 'communications' && (
                <CommunicationsModule
                  workspace={workspace}
                  currentRole={currentRole}
                  wsConnected={wsConnected}
                  onRefresh={() => loadWorkspace(tenantId, true)}
                  onNotify={(msg, tone) => pushToast(msg, tone)}
                  onNavigate={handleNavigate}
                />
              )}
              {activeModule === 'settings' && (
                <SettingsModule
                  workspace={workspace}
                  onRefresh={() => loadWorkspace(tenantId, true)}
                  onSwitchTenant={(newId) => {
                    setTenantId(newId);
                    setActiveModule('analytics');
                  }}
                  onNotify={(msg, tone) => pushToast(msg, tone)}
                />
              )}
              {activeModule === 'super-admin' && canAccessSuperAdmin && (
                <SuperAdminModule
                  workspace={workspace}
                  onRefresh={() => loadWorkspace(tenantId, true)}
                  onSwitchTenant={(newId, targetModule) => {
                    setTenantId(newId);
                    if (targetModule) {
                      handleNavigate(targetModule);
                    } else {
                      setActiveModule('analytics');
                    }
                  }}
                  onNotify={(msg, tone) => pushToast(msg, tone)}
                />
              )}
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
