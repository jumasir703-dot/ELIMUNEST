import type {
  CurrencyCode,
  FeeStructure,
  FeeVoteline,
  IndependentVotelineItem,
  PaymentMethod,
} from '../shared/types';

export const PAYMENT_METHODS: PaymentMethod[] = ['Mobile Money', 'Bank Transfer', 'Card', 'Cash'];

export const COMMON_VOTELINE_NAMES = [
  'Tuition Fee',
  'Boarding & Meals',
  'Examination & Assessment',
  'Laboratory & Practicals',
  'ICT & Technology',
  'Co-Curricular & Activities',
  'Transport & Bus Levy',
  'Development & PTA Levy',
];

export function getStructureVotelines(fs: FeeStructure): FeeVoteline[] {
  if (Array.isArray(fs.votelines) && fs.votelines.length > 0) {
    return fs.votelines;
  }
  return [
    { id: 'vl-tuition', name: 'Tuition Fee', amount: fs.tuitionFee || 0 },
    { id: 'vl-lab', name: 'Laboratory Fee', amount: fs.labFee || 0 },
    { id: 'vl-tech', name: 'Technology & ICT', amount: fs.technologyFee || 0 },
    { id: 'vl-act', name: 'Co-Curricular & Activities', amount: fs.activitiesFee || 0 },
  ];
}

export function termsMatchForFeeStructure(a: string, b: string): boolean {
  const normA = (a || '').trim().toLowerCase();
  const normB = (b || '').trim().toLowerCase();
  if (!normA || !normB) return true;
  if (normA === normB) return true;
  const matchA = normA.match(/\bterm\s*(\d+)\b/i);
  const matchB = normB.match(/\bterm\s*(\d+)\b/i);
  if (matchA && matchB) {
    return matchA[1] === matchB[1];
  }
  return normA.includes(normB) || normB.includes(normA);
}

export interface StructureIndependentLine {
  key: string;
  name: string;
  unitAmount: number;
  learnerCount: number;
  totalBilled: number;
  note: string;
}

export function summarizeIndependentVotelinesForStructure(
  fs: FeeStructure,
  items: IndependentVotelineItem[]
): {
  lines: StructureIndependentLine[];
  separateScheduleTotal: number;
  separateCohortTotal: number;
} {
  const matching = items.filter(
    (item) =>
      item.grade.trim().toLowerCase() === fs.grade.trim().toLowerCase() &&
      termsMatchForFeeStructure(item.term, fs.term)
  );

  const grouped = new Map<string, StructureIndependentLine>();
  for (const item of matching) {
    const cleanName = item.name.trim();
    const key = `${cleanName.toLowerCase()}::${item.amount}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.learnerCount += 1;
      existing.totalBilled += item.amount;
      if (!existing.note && item.note) {
        existing.note = item.note;
      }
    } else {
      grouped.set(key, {
        key,
        name: cleanName,
        unitAmount: item.amount,
        learnerCount: 1,
        totalBilled: item.amount,
        note: (item.note || '').trim(),
      });
    }
  }

  const lines = Array.from(grouped.values());
  const separateScheduleTotal = lines.reduce((sum, l) => sum + l.unitAmount, 0);
  const separateCohortTotal = lines.reduce((sum, l) => sum + l.totalBilled, 0);
  return { lines, separateScheduleTotal, separateCohortTotal };
}

/**
 * Largest-remainder proportional apportionment so allocated integer votelines
 * sum exactly to totalAmount with zero rounding drift.
 */
export function allocateProportionally(totalAmount: number, weights: number[]): number[] {
  const safeTotal = Math.max(0, Math.round(totalAmount));
  if (weights.length === 0) return [];
  const cleanWeights = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const weightSum = cleanWeights.reduce((sum, w) => sum + w, 0);

  if (weightSum <= 0) {
    const equalBase = Math.floor(safeTotal / cleanWeights.length);
    const rem = safeTotal - equalBase * cleanWeights.length;
    return cleanWeights.map((_, idx) => equalBase + (idx < rem ? 1 : 0));
  }

  const shares = cleanWeights.map((w, idx) => {
    const exact = (safeTotal * w) / weightSum;
    const base = Math.floor(exact);
    return { idx, base, frac: exact - base };
  });

  const allocatedSum = shares.reduce((sum, item) => sum + item.base, 0);
  const remainder = safeTotal - allocatedSum;

  const sortedByFrac = [...shares].sort((a, b) => b.frac - a.frac || a.idx - b.idx);
  const result = shares.map((s) => s.base);
  for (let i = 0; i < remainder && i < sortedByFrac.length; i += 1) {
    result[sortedByFrac[i].idx] += 1;
  }
  return result;
}

export function buildDefaultVotelineDrafts(
  currency: CurrencyCode
): Array<{ id: string; name: string; amount: string }> {
  if (currency === 'KES') {
    return [
      { id: 'vl-1', name: 'Tuition Fee', amount: '35000' },
      { id: 'vl-2', name: 'Boarding & Meals', amount: '6500' },
      { id: 'vl-3', name: 'Examination & Assessment', amount: '2000' },
      { id: 'vl-4', name: 'Laboratory & Practicals', amount: '2500' },
    ];
  }
  return [
    { id: 'vl-1', name: 'Tuition Fee', amount: '1100' },
    { id: 'vl-2', name: 'Laboratory & Practicals', amount: '120' },
    { id: 'vl-3', name: 'ICT & Technology', amount: '90' },
    { id: 'vl-4', name: 'Co-Curricular & Activities', amount: '80' },
  ];
}

export interface ParsedPaymentRow {
  rowNumber: number;
  invoiceId?: string;
  invoiceNumber: string;
  studentId?: string;
  studentCode: string;
  studentName: string;
  outstandingBalance: number;
  amount: number;
  method: PaymentMethod;
  reference: string;
  paidAt: string;
  include: boolean;
  status: 'valid' | 'skipped' | 'error';
  note: string;
}

export function normalizePaymentMethod(raw: string): PaymentMethod {
  const value = raw.trim().toLowerCase();
  if (!value) return 'Bank Transfer';
  if (
    value.includes('mobile') ||
    value.includes('mpesa') ||
    value.includes('m-pesa') ||
    value.includes('airtel') ||
    value.includes('tkash')
  ) {
    return 'Mobile Money';
  }
  if (value.includes('card') || value.includes('visa') || value.includes('master')) {
    return 'Card';
  }
  if (value.includes('cash')) {
    return 'Cash';
  }
  return 'Bank Transfer';
}

export function readRowCell(row: Record<string, unknown>, candidates: string[]): string {
  const keys = Object.keys(row);
  for (const candidate of candidates) {
    const target = candidate.toLowerCase();
    const matchedKey = keys.find((k) => k.trim().toLowerCase() === target);
    if (matchedKey !== undefined && row[matchedKey] !== undefined && row[matchedKey] !== null) {
      return String(row[matchedKey]).trim();
    }
  }
  for (const candidate of candidates) {
    const target = candidate.toLowerCase();
    const matchedKey = keys.find((k) => k.trim().toLowerCase().includes(target));
    if (matchedKey !== undefined && row[matchedKey] !== undefined && row[matchedKey] !== null) {
      return String(row[matchedKey]).trim();
    }
  }
  return '';
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}
