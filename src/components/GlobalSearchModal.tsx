import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  CalendarClock,
  CheckSquare,
  Clock,
  Compass,
  GraduationCap,
  Landmark,
  MessageSquare,
  Search,
  Users,
  X,
} from 'lucide-react';
import {
  buildSystemSearchCatalog,
  clearRecentSearches,
  loadRecentSearches,
  runSystemSearch,
  saveRecentSearch,
  SEARCH_CATEGORY_TABS,
  splitHighlightSegments,
  type SearchCategoryId,
  type SystemNavigationTarget,
  type SystemSearchItem,
} from '../lib/globalSearch';
import type {
  TenantModulePermission,
  TenantWorkspaceData,
  UserRole,
} from '../shared/types';

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspace: TenantWorkspaceData;
  currentRole: UserRole;
  effectiveModules: TenantModulePermission[];
  canAccessSuperAdmin: boolean;
  isPlatformSuperAdmin: boolean;
  darkMode: boolean;
  onSelectTarget: (target: Omit<SystemNavigationTarget, 'nonce'>) => void;
}

function getCategoryIcon(category: Exclude<SearchCategoryId, 'all'>) {
  switch (category) {
    case 'navigation':
      return Compass;
    case 'students':
      return Users;
    case 'staff':
      return CalendarClock;
    case 'academics':
      return BookOpen;
    case 'exams':
      return GraduationCap;
    case 'finance':
      return Landmark;
    case 'attendance':
      return CheckSquare;
    case 'comms':
      return MessageSquare;
    default:
      return BarChart3;
  }
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const segments = useMemo(() => splitHighlightSegments(text, query), [text, query]);
  return (
    <>
      {segments.map((seg, idx) =>
        seg.match ? (
          <mark
            key={idx}
            className="rounded-xs bg-amber-200/75 px-0.5 text-slate-950 dark:bg-amber-400/30 dark:text-amber-100"
          >
            {seg.text}
          </mark>
        ) : (
          <span key={idx}>{seg.text}</span>
        )
      )}
    </>
  );
}

export function GlobalSearchModal({
  isOpen,
  onClose,
  workspace,
  currentRole,
  effectiveModules,
  canAccessSuperAdmin,
  isPlatformSuperAdmin,
  darkMode,
  onSelectTarget,
}: GlobalSearchModalProps) {
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<SearchCategoryId>('all');
  const [activeIndex, setActiveIndex] = useState(0);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => loadRecentSearches());
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const catalog = useMemo(() => {
    if (!isOpen) return [];
    return buildSystemSearchCatalog({
      workspace,
      currentRole,
      effectiveModules,
      canAccessSuperAdmin,
      isPlatformSuperAdmin,
      darkMode,
    });
  }, [
    isOpen,
    workspace,
    currentRole,
    effectiveModules,
    canAccessSuperAdmin,
    isPlatformSuperAdmin,
    darkMode,
  ]);

  const { results, countsByCategory } = useMemo(
    () => runSystemSearch(catalog, query, activeCategory, 48),
    [catalog, query, activeCategory]
  );

  useEffect(() => {
    if (!isOpen) return;
    setActiveIndex(0);
    setRecentSearches(loadRecentSearches());
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 10);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, activeCategory]);

  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const activeEl = listRef.current.querySelector<HTMLElement>(
      `[data-search-index="${activeIndex}"]`
    );
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, isOpen, results.length]);

  const visibleTabs = useMemo(
    () =>
      SEARCH_CATEGORY_TABS.filter(
        (tab) => tab.id === 'all' || countsByCategory[tab.id] > 0
      ),
    [countsByCategory]
  );

  function executeSelect(
    item: SystemSearchItem,
    targetOverride?: Omit<SystemNavigationTarget, 'nonce'>
  ) {
    if (query.trim().length >= 2) {
      setRecentSearches(saveRecentSearch(query));
    }
    onSelectTarget(targetOverride || item.target);
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (results.length > 0) {
        setActiveIndex((prev) => (prev + 1) % results.length);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length > 0) {
        setActiveIndex((prev) => (prev - 1 + results.length) % results.length);
      }
      return;
    }
    if (e.key === 'Enter' && results[activeIndex]) {
      e.preventDefault();
      executeSelect(results[activeIndex]);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Universal system search"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/55 px-3 pt-10 pb-6 backdrop-blur-[2px] sm:px-6 sm:pt-16 no-print"
    >
      <div className="flex max-h-[82vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        {/* Search Input Header */}
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3.5 dark:border-slate-800">
          <Search className="h-5 w-5 shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search learners, staff, invoices, M-Pesa receipts, report cards, leave chits, schemes, or any screen..."
            aria-label="Search everything in the system"
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-slate-100 dark:placeholder:text-slate-500"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              aria-label="Clear search query"
              className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Category Segmented Controls */}
        <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50/70 px-4 py-2 dark:border-slate-800 dark:bg-slate-950/60">
          {visibleTabs.map((tab) => {
            const active = activeCategory === tab.id;
            const count = countsByCategory[tab.id];
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveCategory(tab.id)}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700'
                    : 'text-slate-600 hover:bg-white/60 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200'
                }`}
              >
                <span>{tab.label}</span>
                <span className="font-mono text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Recent Searches Strip (only when query is empty & history exists) */}
        {!query.trim() && recentSearches.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5 text-xs dark:border-slate-800/80">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 font-medium text-slate-500 dark:text-slate-400">
                <Clock className="h-3.5 w-3.5" />
                Recent:
              </span>
              {recentSearches.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    setQuery(item);
                    inputRef.current?.focus();
                  }}
                  className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  {item}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setRecentSearches(clearRecentSearches())}
              className="text-[11px] font-medium text-slate-400 hover:text-slate-600 hover:underline dark:hover:text-slate-300"
            >
              Clear history
            </button>
          </div>
        )}

        {/* Search Results Body */}
        <div
          ref={listRef}
          className="flex-1 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800/80"
        >
          {results.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                No matching records or modules found for "{query.trim()}"
              </p>
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                Try searching by student name or code, teacher name, invoice or receipt number,
                voucher, exam cycle, subject, grade, or feature name.
              </p>
            </div>
          ) : (
            results.map((item, idx) => {
              const Icon = getCategoryIcon(item.category);
              const isSelected = idx === activeIndex;
              return (
                <div
                  key={item.id}
                  data-search-index={idx}
                  onMouseEnter={() => setActiveIndex(idx)}
                  className={`flex flex-col gap-2 px-4 py-3 transition-colors sm:flex-row sm:items-center sm:justify-between ${
                    isSelected
                      ? 'bg-blue-50/80 dark:bg-blue-950/35'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => executeSelect(item)}
                    className="flex min-w-0 flex-1 items-start gap-3 text-left focus:outline-none"
                  >
                    <div
                      className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
                        isSelected
                          ? 'border-blue-200 bg-white text-blue-700 dark:border-blue-800 dark:bg-slate-900 dark:text-blue-400'
                          : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          <HighlightedText text={item.title} query={query} />
                        </span>
                        <span className="text-xs font-medium text-blue-700 dark:text-blue-400">
                          {item.typeLabel}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-600 dark:text-slate-300">
                        <HighlightedText text={item.subtitle} query={query} />
                      </p>
                      {item.meta.length > 0 && (
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          {item.meta.map((m, mIdx) => (
                            <span key={`${m}-${mIdx}`} className="inline-flex items-center gap-2">
                              {mIdx > 0 && <span aria-hidden="true">·</span>}
                              <span>
                                <HighlightedText text={m} query={query} />
                              </span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </button>

                  {/* Inline Quick-Jump Controls */}
                  <div className="flex shrink-0 items-center gap-2 pl-11 sm:pl-0">
                    {item.secondaryActions && item.secondaryActions.length > 0 && (
                      <div className="flex items-center gap-1 border-r border-slate-200 pr-2 dark:border-slate-700">
                        {item.secondaryActions.map((act) => (
                          <button
                            key={act.label}
                            type="button"
                            onClick={() => executeSelect(item, act.target)}
                            className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-white hover:text-blue-700 hover:underline dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-blue-400"
                          >
                            {act.label}
                          </button>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => executeSelect(item)}
                      aria-label={`Open ${item.title}`}
                      className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                        isSelected
                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'
                      }`}
                    >
                      <span>Open</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Keyboard Hints */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2.5 text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>
              <strong className="font-semibold text-slate-700 dark:text-slate-300">↑↓</strong>{' '}
              Navigate
            </span>
            <span>
              <strong className="font-semibold text-slate-700 dark:text-slate-300">Enter</strong>{' '}
              Open result
            </span>
            <span>
              <strong className="font-semibold text-slate-700 dark:text-slate-300">Esc</strong>{' '}
              Close
            </span>
          </div>
          <span className="font-mono tabular-nums">
            {query.trim()
              ? `${countsByCategory.all} match${countsByCategory.all === 1 ? '' : 'es'} across ${workspace.tenant.name}`
              : `${catalog.length} indexed items`}
          </span>
        </div>
      </div>
    </div>
  );
}
