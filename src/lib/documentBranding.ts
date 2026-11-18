import * as XLSX from 'xlsx';
import { getTenantInitials, normalizeHex } from './theme';
import { DEFAULT_CURRENCY, type Tenant } from '../shared/types';

export interface TenantDocumentMeta {
  schoolName: string;
  tagline: string;
  location: string;
  postalAddress: string;
  contactPhone: string;
  contactEmail: string;
  emailDomain: string;
  currency: string;
  paybillNumber?: string;
  paybillAccountName?: string;
  primaryColor: string;
  accentColor: string;
  logoUrl: string;
  hasCustomLogo: boolean;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildDefaultCrestSvgDataUrl(
  schoolName: string,
  primaryColor = '#2563EB',
  accentColor = '#0F766E'
): string {
  const initials = escapeXml(getTenantInitials(schoolName || 'School'));
  const primary = normalizeHex(primaryColor, '#2563EB');
  const accent = normalizeHex(accentColor, '#0F766E');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${primary}"/><stop offset="100%" stop-color="${accent}"/></linearGradient></defs><rect x="4" y="4" width="120" height="120" rx="22" fill="url(#g)"/><rect x="12" y="12" width="104" height="104" rx="16" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="2"/><text x="64" y="75" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="42" font-weight="800" fill="#ffffff" letter-spacing="2">${initials}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function resolveTenantDocumentMeta(
  tenant?: Partial<Tenant> | null
): TenantDocumentMeta {
  const schoolName = (tenant?.name || 'elimuNest School').trim();
  const emailDomain = (
    tenant?.emailDomain ||
    `${(tenant?.slug || 'school').replace(/[^a-z0-9.-]/gi, '')}.ac.ke`
  ).trim();
  const primaryColor = normalizeHex(tenant?.branding?.primaryColor, '#2563EB');
  const accentColor = normalizeHex(tenant?.branding?.accentColor, '#0F766E');
  const customLogo = (tenant?.branding?.logoDataUrl || '').trim();
  const logoUrl =
    customLogo || buildDefaultCrestSvgDataUrl(schoolName, primaryColor, accentColor);

  const location = (tenant?.location || 'Kenya').trim();
  const postalAddress = (
    tenant?.postalAddress || `P.O. Box 1000, ${location}`
  ).trim();
  const contactPhone = (
    tenant?.contactPhone ||
    tenant?.nonTeachingStaff?.[0]?.phone ||
    tenant?.teachers?.[0]?.phone ||
    '+254 700 000 000'
  ).trim();
  const contactEmail = (tenant?.contactEmail || `info@${emailDomain}`).trim();

  return {
    schoolName,
    tagline: (tenant?.branding?.tagline || tenant?.curriculum || '').trim(),
    location,
    postalAddress,
    contactPhone,
    contactEmail,
    emailDomain,
    currency: tenant?.currency || DEFAULT_CURRENCY,
    paybillNumber: tenant?.mpesaConfig?.enabled
      ? tenant.mpesaConfig.paybillNumber
      : undefined,
    paybillAccountName: tenant?.mpesaConfig?.enabled
      ? tenant.mpesaConfig.accountName
      : undefined,
    primaryColor,
    accentColor,
    logoUrl,
    hasCustomLogo: Boolean(customLogo),
  };
}

export function buildTenantHeaderRowsForExcel(
  tenant: Partial<Tenant> | null | undefined,
  documentTitle: string,
  extraMeta: string[] = []
): string[][] {
  const meta = resolveTenantDocumentMeta(tenant);
  const logoBadge = meta.hasCustomLogo ? '[Verified School Logo Attached]' : '[Official School Crest]';
  const rows: string[][] = [
    [meta.schoolName.toUpperCase(), '', '', logoBadge],
    [`${documentTitle}`, '', `Currency: ${meta.currency}`, `Generated: ${new Date().toISOString().slice(0, 10)}`],
    [`Address: ${meta.location} · ${meta.postalAddress}`, '', `Tel: ${meta.contactPhone}`, `Email: ${meta.contactEmail}`],
  ];
  if (meta.paybillNumber) {
    rows.push([
      `M-Pesa Paybill: ${meta.paybillNumber} (${meta.paybillAccountName || meta.schoolName})`,
      ...extraMeta,
    ]);
  } else if (extraMeta.length > 0) {
    rows.push(extraMeta);
  }
  rows.push([]);
  return rows;
}

export interface BrandedWorksheetOptions {
  subtitle?: string;
  colWidths?: Array<number | { wch: number }>;
  extraMeta?: string[];
}

function normalizeBrandedSheetArgs(
  optionsOrColWidths?: Array<number | { wch: number }> | BrandedWorksheetOptions,
  extraMeta: string[] = []
): {
  colWidths?: Array<{ wch: number }>;
  mergedExtraMeta: string[];
} {
  const isArray = Array.isArray(optionsOrColWidths);
  const rawWidths = isArray ? optionsOrColWidths : optionsOrColWidths?.colWidths;
  const colWidths = rawWidths?.map((w) => (typeof w === 'number' ? { wch: w } : w));
  const subtitle = !isArray && optionsOrColWidths?.subtitle ? [optionsOrColWidths.subtitle] : [];
  const optsExtra = !isArray && optionsOrColWidths?.extraMeta ? optionsOrColWidths.extraMeta : [];
  return {
    colWidths,
    mergedExtraMeta: [...subtitle, ...optsExtra, ...extraMeta],
  };
}

/**
 * Prepends institutional contact & letterhead rows cleanly above an AoA worksheet.
 */
export function createBrandedAoaWorksheet(
  tenant: Partial<Tenant> | null | undefined,
  documentTitle: string,
  bodyAoa: Array<Array<string | number>>,
  optionsOrColWidths?: Array<number | { wch: number }> | BrandedWorksheetOptions,
  extraMeta: string[] = []
): XLSX.WorkSheet {
  const { colWidths, mergedExtraMeta } = normalizeBrandedSheetArgs(
    optionsOrColWidths,
    extraMeta
  );
  const headerRows = buildTenantHeaderRowsForExcel(tenant, documentTitle, mergedExtraMeta);
  const combined: Array<Array<string | number>> = [...headerRows, ...bodyAoa];
  const ws = XLSX.utils.aoa_to_sheet(combined);
  if (colWidths && colWidths.length > 0) {
    ws['!cols'] = colWidths;
  }
  return ws;
}

/**
 * Converts an array of flat records into a branded XLSX worksheet with school
 * name, logo status, address, phone, and email letterhead rows at the top.
 */
export function createBrandedWorksheetFromObjects<
  T extends Record<string, unknown>
>(
  tenant: Partial<Tenant> | null | undefined,
  documentTitle: string,
  records: T[],
  optionsOrColWidths?: Array<number | { wch: number }> | BrandedWorksheetOptions,
  extraMeta: string[] = []
): XLSX.WorkSheet {
  const { colWidths, mergedExtraMeta } = normalizeBrandedSheetArgs(
    optionsOrColWidths,
    extraMeta
  );
  const headerRows = buildTenantHeaderRowsForExcel(tenant, documentTitle, mergedExtraMeta);
  if (records.length === 0) {
    return createBrandedAoaWorksheet(
      tenant,
      documentTitle,
      [['No records found']],
      colWidths,
      mergedExtraMeta
    );
  }
  const columns = Object.keys(records[0]);
  const dataRows = records.map((rec) =>
    columns.map((col) => {
      const val = rec[col];
      if (val === null || val === undefined) return '';
      if (typeof val === 'boolean') return val ? 'Yes' : 'No';
      if (typeof val === 'number' || typeof val === 'string') return val;
      return String(val);
    })
  );
  const ws = XLSX.utils.aoa_to_sheet([...headerRows, columns, ...dataRows]);
  if (colWidths && colWidths.length > 0) {
    ws['!cols'] = colWidths;
  } else {
    ws['!cols'] = columns.map((c) => ({ wch: Math.max(14, Math.min(34, c.length + 6)) }));
  }
  return ws;
}

/**
 * Smart parser that handles both plain sheets (row 0 = headers) and
 * letterhead-prefixed Excel templates downloaded from elimuNest.
 */
export function parseExcelSheetRowsSmart(
  ws: XLSX.WorkSheet,
  headerHints: string[] = ['student', 'invoice', 'reference', 'adm', 'channel', 'amount']
): Array<Record<string, unknown>> {
  const matrix = XLSX.utils.sheet_to_json<Array<string | number>>(ws, {
    header: 1,
    defval: '',
  });
  if (matrix.length === 0) return [];

  let headerRowIdx = 0;
  let bestScore = -1;
  const maxScan = Math.min(12, matrix.length);
  for (let i = 0; i < maxScan; i += 1) {
    const row = matrix[i];
    if (!Array.isArray(row)) continue;
    const cells = row.map((c) => String(c || '').trim().toLowerCase()).filter(Boolean);
    if (cells.length < 3) continue;
    let score = 0;
    for (const hint of headerHints) {
      if (cells.some((c) => c.includes(hint))) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      headerRowIdx = i;
    }
  }

  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    range: headerRowIdx,
    defval: '',
  });
}

/**
 * Converts a data URI logo (including SVG data URI) into a PNG data URI for jsPDF embedding.
 */
export async function loadLogoPngDataUrl(
  logoUrl: string,
  sizePx = 128
): Promise<string | null> {
  if (!logoUrl || typeof document === 'undefined') return null;
  if (logoUrl.startsWith('data:image/png')) return logoUrl;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = sizePx;
        canvas.height = sizePx;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, sizePx, sizePx);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = logoUrl;
  });
}
