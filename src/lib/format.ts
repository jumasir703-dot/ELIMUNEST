import { computeAssessmentGrade, KENYAN_BELL_SCHEDULE } from '../shared/types';

export function formatCurrency(amount: number, currency: 'USD' | 'GBP' | 'EUR' = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDateShort(isoOrDate: string): string {
  const date = new Date(isoOrDate);
  if (Number.isNaN(date.getTime())) return isoOrDate;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export function formatTimeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDateShort(iso);
}

export function computeClientGrade(
  score: number,
  grade = ''
): { letterGrade: string; gpaPoints: number; maxPoints: number; system: 'CBE' | '8-4-4'; label: string } {
  return computeAssessmentGrade(score, grade);
}

export const PERIOD_LABELS: Record<number, { label: string; time: string }> = Object.fromEntries(
  KENYAN_BELL_SCHEDULE.filter((row) => row.kind === 'lesson' && row.period !== undefined).map(
    (row) => [row.period as number, { label: row.label, time: row.time }]
  )
);
