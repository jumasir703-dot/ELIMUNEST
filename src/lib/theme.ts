import { DEFAULT_TENANT_BRANDING, type TenantBranding } from '../shared/types';

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function normalizeHex(hex: string | undefined, fallback = '#2563EB'): string {
  if (!hex) return fallback;
  const trimmed = hex.trim();
  const shortMatch = /^#([0-9a-f]{3})$/i.exec(trimmed);
  if (shortMatch) {
    const [r, g, b] = shortMatch[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  const fullMatch = /^#([0-9a-f]{6})$/i.exec(trimmed);
  if (fullMatch) {
    return `#${fullMatch[1].toUpperCase()}`;
  }
  return fallback;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = normalizeHex(hex).slice(1);
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => clampChannel(n).toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function mixHex(hexA: string, hexB: string, weightB: number): string {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const w = Math.max(0, Math.min(1, weightB));
  return rgbToHex(
    a.r * (1 - w) + b.r * w,
    a.g * (1 - w) + b.g * w,
    a.b * (1 - w) + b.b * w
  );
}

export function hexToRgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function getRelativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function isLightColor(hex: string): boolean {
  return getRelativeLuminance(hex) > 0.42;
}

export function getContrastForeground(hex: string): string {
  return isLightColor(hex) ? '#0F172A' : '#FFFFFF';
}

export interface ResolvedSidebarTheme {
  backgroundColor: string;
  isLight: boolean;
  borderColor: string;
  textColor: string;
  mutedColor: string;
  inputBg: string;
  inputBorder: string;
  activeBg: string;
  activeFg: string;
  hoverBg: string;
}

export function resolveTenantSidebarTheme(
  branding: TenantBranding | undefined,
  darkMode: boolean
): ResolvedSidebarTheme {
  const primary = normalizeHex(branding?.primaryColor, DEFAULT_TENANT_BRANDING.primaryColor);
  const explicitSidebar = branding?.sidebarColor?.trim()
    ? normalizeHex(branding.sidebarColor, '#0F172A')
    : '';
  const backgroundColor =
    explicitSidebar ||
    (darkMode
      ? mixHex(primary, '#09101D', 0.74)
      : mixHex(primary, '#FFFFFF', 0.88));
  const isLight = isLightColor(backgroundColor);

  if (isLight) {
    return {
      backgroundColor,
      isLight: true,
      borderColor: hexToRgba(primary, 0.18),
      textColor: mixHex(primary, '#0F172A', 0.88),
      mutedColor: mixHex(primary, '#475569', 0.82),
      inputBg: mixHex(primary, '#FFFFFF', 0.96),
      inputBorder: hexToRgba(primary, 0.24),
      activeBg: hexToRgba(primary, 0.14),
      activeFg: mixHex(primary, '#000000', 0.24),
      hoverBg: hexToRgba(primary, 0.08),
    };
  }

  return {
    backgroundColor,
    isLight: false,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    textColor: '#F8FAFC',
    mutedColor: 'rgba(248, 250, 252, 0.74)',
    inputBg: 'rgba(255, 255, 255, 0.1)',
    inputBorder: 'rgba(255, 255, 255, 0.2)',
    activeBg: 'rgba(255, 255, 255, 0.18)',
    activeFg: '#FFFFFF',
    hoverBg: 'rgba(255, 255, 255, 0.1)',
  };
}

export function getTenantBrandingCssVars(
  branding: TenantBranding | undefined,
  darkMode: boolean
): Record<string, string> {
  const primary = normalizeHex(branding?.primaryColor, DEFAULT_TENANT_BRANDING.primaryColor);
  const accent = normalizeHex(branding?.accentColor, DEFAULT_TENANT_BRANDING.accentColor);
  const primaryHover = mixHex(primary, '#000000', 0.16);
  const primaryDarkText = mixHex(primary, '#FFFFFF', 0.48);
  const primarySoftLight = mixHex(primary, '#FFFFFF', 0.88);
  const primarySoftDark = mixHex(primary, '#020617', 0.74);
  const primaryFg = getContrastForeground(primary);
  const sidebarTheme = resolveTenantSidebarTheme(branding, darkMode);

  const baseVars: Record<string, string> = {
    '--brand-primary': primary,
    '--brand-primary-hover': primaryHover,
    '--brand-primary-fg': primaryFg,
    '--brand-primary-soft': darkMode ? primarySoftDark : primarySoftLight,
    '--brand-accent': accent,
    '--brand-accent-soft': hexToRgba(accent, darkMode ? 0.24 : 0.14),
    '--color-blue-700': primaryHover,
    '--color-blue-600': primary,
    '--color-blue-500': mixHex(primary, '#FFFFFF', 0.12),
    '--color-blue-400': primaryDarkText,
    '--color-blue-300': mixHex(primary, '#FFFFFF', 0.62),
    '--color-blue-200': mixHex(primary, '#FFFFFF', 0.76),
    '--color-blue-100': mixHex(primary, '#FFFFFF', 0.85),
    '--color-blue-50': primarySoftLight,
    '--color-blue-900': mixHex(primary, '#020617', 0.66),
    '--color-blue-950': primarySoftDark,
    '--tenant-sidebar-bg': sidebarTheme.backgroundColor,
    '--tenant-sidebar-fg': sidebarTheme.textColor,
    '--tenant-sidebar-muted': sidebarTheme.mutedColor,
    '--tenant-sidebar-border': sidebarTheme.borderColor,
  };

  if (darkMode) {
    const canvasTop = mixHex(primary, '#030712', 0.80);
    const canvasMid = mixHex(primary, '#050A14', 0.85);
    const canvasBot = mixHex(accent, '#030712', 0.81);
    const surfaceDark = mixHex(primary, '#0B1220', 0.76);
    const surfaceMutedDark = mixHex(primary, '#152033', 0.70);
    const borderDark = mixHex(primary, '#263449', 0.64);
    const headerDark = hexToRgba(mixHex(primary, '#09101D', 0.74), 0.92);

    return {
      ...baseVars,
      '--tenant-canvas-bg': `linear-gradient(155deg, ${canvasTop} 0%, ${canvasMid} 52%, ${canvasBot} 100%)`,
      '--tenant-canvas-solid': canvasMid,
      '--tenant-surface': surfaceDark,
      '--tenant-surface-muted': surfaceMutedDark,
      '--tenant-header-bg': headerDark,
      '--tenant-border': borderDark,
      // Keep slate 50-300 light in dark mode so dark:text-slate-* retains high contrast
      '--color-slate-50': '#F8FAFC',
      '--color-slate-100': '#F1F5F9',
      '--color-slate-200': '#E2E8F0',
      '--color-slate-300': '#CBD5E1',
      '--color-slate-700': mixHex(primary, '#334155', 0.64),
      '--color-slate-800': surfaceMutedDark,
      '--color-slate-900': surfaceDark,
      '--color-slate-950': canvasTop,
    };
  }

  const canvasTop = mixHex(primary, '#FFFFFF', 0.84);
  const canvasMid = mixHex(primary, '#FFFFFF', 0.90);
  const canvasBot = mixHex(accent, '#FFFFFF', 0.85);
  const surfaceLight = mixHex(primary, '#FFFFFF', 0.962);
  const surfaceMutedLight = mixHex(primary, '#FFFFFF', 0.89);
  const borderLight = mixHex(primary, '#CBD5E1', 0.56);
  const headerLight = hexToRgba(mixHex(primary, '#FFFFFF', 0.88), 0.92);

  return {
    ...baseVars,
    '--tenant-canvas-bg': `linear-gradient(155deg, ${canvasTop} 0%, ${canvasMid} 48%, ${canvasBot} 100%)`,
    '--tenant-canvas-solid': canvasMid,
    '--tenant-surface': surfaceLight,
    '--tenant-surface-muted': surfaceMutedLight,
    '--tenant-header-bg': headerLight,
    '--tenant-border': borderLight,
    '--color-slate-50': mixHex(primary, '#FFFFFF', 0.89),
    '--color-slate-100': mixHex(primary, '#FFFFFF', 0.83),
    '--color-slate-200': borderLight,
    '--color-slate-300': mixHex(primary, '#94A3B8', 0.64),
    '--color-slate-700': mixHex(primary, '#334155', 0.84),
    '--color-slate-800': mixHex(primary, '#1E293B', 0.86),
    '--color-slate-900': mixHex(primary, '#0F172A', 0.88),
    '--color-slate-950': mixHex(primary, '#020617', 0.90),
  };
}

export function getTenantInitials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => w && !/^(of|the|and|for)$/i.test(w));
  if (words.length === 0) return 'SC';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

export async function processLogoUploadFile(file: File): Promise<string> {
  const allowedTypes = [
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/svg+xml',
  ];
  const isAllowed =
    allowedTypes.includes(file.type) ||
    /\.(png|jpe?g|webp|svg)$/i.test(file.name);

  if (!isAllowed) {
    throw new Error('Upload a PNG, JPG, WEBP, or SVG school logo image.');
  }
  if (file.size > 4 * 1024 * 1024) {
    throw new Error('Logo image must be smaller than 4 MB.');
  }

  // Handle SVG directly (preserve vector sharpness, block inline scripts)
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
    const text = await file.text();
    if (/<script/i.test(text)) {
      throw new Error('SVG files with scripts are not allowed.');
    }
    const encoded = window.btoa(unescape(encodeURIComponent(text)));
    return `data:image/svg+xml;base64,${encoded}`;
  }

  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Could not read logo file.'));
    };
    reader.onerror = () => reject(new Error('Could not read logo file.'));
    reader.readAsDataURL(file);
  });

  // Resize raster image cleanly to max 320px preserving aspect ratio and alpha transparency
  return new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 320;
      let width = img.naturalWidth || maxDim;
      let height = img.naturalHeight || maxDim;
      if (width > maxDim || height > maxDim) {
        const scale = Math.min(maxDim / width, maxDim / height);
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(rawDataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(rawDataUrl);
    img.src = rawDataUrl;
  });
}
