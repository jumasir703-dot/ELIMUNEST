import { useEffect, useMemo, useState } from 'react';
import { BellRing, Megaphone, Search, Send, X } from 'lucide-react';
import { saasApi } from '../lib/api';
import { formatTimeAgo } from '../lib/format';
import type { SystemNavigationTarget } from '../lib/globalSearch';
import type { Announcement, TenantWorkspaceData, UserRole } from '../shared/types';

interface CommunicationsModuleProps {
  workspace: TenantWorkspaceData;
  currentRole: UserRole;
  readOnly?: boolean;
  wsConnected: boolean;
  navigationTarget?: SystemNavigationTarget | null;
  onRefresh: () => Promise<void>;
  onNotify: (title: string, tone?: 'success' | 'error') => void;
  onNavigate: (module: string) => void;
}

const CHANNELS = ['Staff & Faculty', 'Admissions & Registrar', 'Parent Liaison', 'Finance & Bursar'];

export function CommunicationsModule({
  workspace,
  currentRole,
  readOnly = false,
  wsConnected,
  navigationTarget,
  onRefresh,
  onNotify,
  onNavigate,
}: CommunicationsModuleProps) {
  const { tenant, announcements, messages, notifications } = workspace;
  const isReadOnlyViewer = Boolean(readOnly) || currentRole === 'Parent' || currentRole === 'Student';

  const [activeChannel, setActiveChannel] = useState(
    isReadOnlyViewer ? 'Parent Liaison' : CHANNELS[0]
  );
  const [searchFilter, setSearchFilter] = useState('');
  const [messageText, setMessageText] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);

  useEffect(() => {
    if (!navigationTarget || navigationTarget.module !== 'communications') return;
    if (navigationTarget.subSection && CHANNELS.includes(navigationTarget.subSection)) {
      setActiveChannel(navigationTarget.subSection);
    }
    if (navigationTarget.searchQuery !== undefined) {
      setSearchFilter(navigationTarget.searchQuery);
    }
  }, [navigationTarget]);

  const [annForm, setAnnForm] = useState({
    title: '',
    body: '',
    audience: 'All School' as Announcement['audience'],
    priority: 'Normal' as Announcement['priority'],
  });
  const [publishingAnn, setPublishingAnn] = useState(false);

  const filteredAnnouncements = useMemo(() => {
    const q = searchFilter.trim().toLowerCase();
    if (!q) return announcements;
    return announcements.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.body.toLowerCase().includes(q) ||
        a.authorName.toLowerCase().includes(q) ||
        a.audience.toLowerCase().includes(q)
    );
  }, [announcements, searchFilter]);

  const channelMessages = useMemo(() => {
    const base = messages.filter((m) => m.channel === activeChannel);
    const q = searchFilter.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (m) =>
        m.body.toLowerCase().includes(q) ||
        m.senderName.toLowerCase().includes(q)
    );
  }, [messages, activeChannel, searchFilter]);

  async function handlePublishAnnouncement(e: React.FormEvent) {
    e.preventDefault();
    if (!annForm.title.trim() || !annForm.body.trim()) return;
    setPublishingAnn(true);
    try {
      await saasApi.createAnnouncement(tenant.id, {
        ...annForm,
        authorName: `${currentRole} Office`,
        authorRole: currentRole,
      });
      await onRefresh();
      setAnnForm({ title: '', body: '', audience: 'All School', priority: 'Normal' });
      onNotify('Announcement broadcast live to tenant subscribers.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to publish announcement', 'error');
    } finally {
      setPublishingAnn(false);
    }
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!messageText.trim()) return;
    setSendingMsg(true);
    try {
      await saasApi.createMessage(tenant.id, {
        channel: activeChannel,
        senderName: `${currentRole} User`,
        senderRole: currentRole,
        body: messageText,
      });
      setMessageText('');
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to send message', 'error');
    } finally {
      setSendingMsg(false);
    }
  }

  async function handleMarkAllRead() {
    try {
      await saasApi.markNotificationsRead(tenant.id);
      await onRefresh();
    } catch {
      // silent
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Communications & Real-Time Notifications
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Broadcast school announcements, coordinate across staff channels, and monitor live WebSocket event alerts.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Filter announcements & messages..."
              className="w-60 rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-7 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
            {searchFilter && (
              <button
                type="button"
                onClick={() => setSearchFilter('')}
                aria-label="Clear filter"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                wsConnected ? 'bg-emerald-600' : 'bg-amber-500'
              }`}
            />
            <span>{wsConnected ? 'WebSocket Connected' : 'Reconnecting Socket'}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Announcements Composer & Feed */}
        <section className="space-y-6 lg:col-span-6">
          {!isReadOnlyViewer && (
            <form
              onSubmit={handlePublishAnnouncement}
              className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-center gap-2">
                <Megaphone className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Publish Tenant Announcement
                </h2>
              </div>

              <div className="mt-4 space-y-3">
                <input
                  required
                  type="text"
                  value={annForm.title}
                  onChange={(e) => setAnnForm({ ...annForm, title: e.target.value })}
                  placeholder="Announcement headline..."
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
                <textarea
                  required
                  rows={3}
                  value={annForm.body}
                  onChange={(e) => setAnnForm({ ...annForm, body: e.target.value })}
                  placeholder="Message details for students, faculty, or guardians..."
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="flex items-center gap-2">
                    <select
                      value={annForm.audience}
                      onChange={(e) =>
                        setAnnForm({
                          ...annForm,
                          audience: e.target.value as Announcement['audience'],
                        })
                      }
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    >
                      <option value="All School">All School</option>
                      <option value="Teachers Only">Teachers Only</option>
                      <option value="Parents & Guardians">Parents & Guardians</option>
                      <option value="Students">Students</option>
                    </select>
                    <select
                      value={annForm.priority}
                      onChange={(e) =>
                        setAnnForm({
                          ...annForm,
                          priority: e.target.value as Announcement['priority'],
                        })
                      }
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    >
                      <option value="Normal">Normal Priority</option>
                      <option value="Urgent">Urgent Priority</option>
                    </select>
                  </div>

                  <button
                    type="submit"
                    disabled={publishingAnn}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {publishingAnn ? 'Broadcasting...' : 'Broadcast Now'}
                  </button>
                </div>
              </div>
            </form>
          )}

          <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Recent Bulletins
            </h2>
            <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
              {filteredAnnouncements.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-500">
                  {searchFilter.trim()
                    ? 'No announcements matched your filter.'
                    : 'No announcements broadcast yet.'}
                </p>
              ) : (
                filteredAnnouncements.map((ann) => (
                  <article key={ann.id} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span>
                        {ann.audience} · {ann.authorName}
                        {ann.priority === 'Urgent' && (
                          <span className="ml-2 font-semibold text-red-700 dark:text-red-400">
                            · Urgent
                          </span>
                        )}
                      </span>
                      <span className="font-mono tabular-nums">{formatTimeAgo(ann.createdAt)}</span>
                    </div>
                    <h3 className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {ann.title}
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                      {ann.body}
                    </p>
                  </article>
                ))
              )}
            </div>
          </div>
        </section>

        {/* Direct Staff / Parent Channel + Live Notification Stream */}
        <section className="space-y-6 lg:col-span-6">
          <div className="flex flex-col rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 p-4 dark:border-slate-800">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Real-Time Department Channels
              </h2>
              <div className="mt-3 flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                {CHANNELS.map((ch) => (
                  <button
                    key={ch}
                    onClick={() => setActiveChannel(ch)}
                    className={`whitespace-nowrap shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      activeChannel === ch
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    {ch}
                  </button>
                ))}
              </div>
            </div>

            <div className="max-h-72 min-h-[220px] space-y-4 overflow-y-auto p-4">
              {channelMessages.length === 0 ? (
                <p className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
                  No messages in {activeChannel} yet. Start a thread below.
                </p>
              ) : (
                channelMessages.map((msg) => (
                  <div key={msg.id} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {msg.senderName}{' '}
                        <span className="font-normal text-slate-500">({msg.senderRole})</span>
                      </span>
                      <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                        {formatTimeAgo(msg.createdAt)}
                      </span>
                    </div>
                    <p className="text-sm text-slate-700 dark:text-slate-300">{msg.body}</p>
                  </div>
                ))
              )}
            </div>

            {!isReadOnlyViewer && (
              <form
                onSubmit={handleSendMessage}
                className="flex items-center gap-2 border-t border-slate-200 p-3 dark:border-slate-800"
              >
                <input
                  type="text"
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  placeholder={`Message ${activeChannel}...`}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
                <button
                  type="submit"
                  disabled={sendingMsg || !messageText.trim()}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
                >
                  <Send className="h-3.5 w-3.5" />
                  Send
                </button>
              </form>
            )}
          </div>

          {/* Live System Event Notification Log */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BellRing className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Real-Time Notification Stream
                </h2>
              </div>
              <button
                onClick={handleMarkAllRead}
                className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                Mark all read
              </button>
            </div>
            <div className="mt-4 max-h-72 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
              {notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => onNavigate(n.targetModule)}
                  className="cursor-pointer py-3 transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/30"
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
                  <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                    {n.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
