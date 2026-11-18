import { Mail, MapPin, Phone } from 'lucide-react';
import { resolveTenantDocumentMeta } from '../lib/documentBranding';
import type { Tenant } from '../shared/types';

interface TenantDocumentHeaderProps {
  tenant?: Partial<Tenant> | null;
  documentTitle: string;
  subtitle?: string;
  rightMeta?: Array<{ label: string; value: string }>;
  compact?: boolean;
}

export function TenantDocumentHeader({
  tenant,
  documentTitle,
  subtitle,
  rightMeta = [],
  compact = false,
}: TenantDocumentHeaderProps) {
  const meta = resolveTenantDocumentMeta(tenant);

  return (
    <div
      className={`border-b border-slate-200 ${compact ? 'pb-3' : 'pb-4'} dark:border-slate-800`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3.5">
          <img
            src={meta.logoUrl}
            alt={`${meta.schoolName} logo`}
            className={`${
              compact ? 'h-12 w-12' : 'h-14 w-14'
            } shrink-0 rounded-xl border border-slate-200 bg-white object-contain p-0.5 dark:border-slate-700`}
          />
          <div className="min-w-0">
            <h2
              className={`${
                compact ? 'text-base' : 'text-lg'
              } font-bold tracking-tight text-slate-900 dark:text-slate-100`}
            >
              {meta.schoolName}
            </h2>
            {meta.tagline && (
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                {meta.tagline}
              </p>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600 dark:text-slate-400">
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3 shrink-0 text-slate-400" />
                {meta.location} · {meta.postalAddress}
              </span>
              <span className="inline-flex items-center gap-1 font-mono">
                <Phone className="h-3 w-3 shrink-0 text-slate-400" />
                {meta.contactPhone}
              </span>
              <span className="inline-flex items-center gap-1 font-mono">
                <Mail className="h-3 w-3 shrink-0 text-slate-400" />
                {meta.contactEmail}
              </span>
            </div>
          </div>
        </div>

        <div className="shrink-0 sm:text-right">
          <p
            className="text-xs font-bold tracking-wide uppercase"
            style={{ color: meta.primaryColor }}
          >
            {documentTitle}
          </p>
          {subtitle && (
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              {subtitle}
            </p>
          )}
          {rightMeta.length > 0 && (
            <div className="mt-1 space-y-0.5 font-mono text-[11px] text-slate-600 tabular-nums dark:text-slate-400">
              {rightMeta.map((item) => (
                <p key={item.label}>
                  {item.label}:{' '}
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {item.value}
                  </span>
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
