import type { CSSProperties } from 'react';
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

export function getTenantBrandingCssVars(
  branding: TenantBranding | undefined,
  darkMode: boolean
): CSSProperties {
  const primary = normalizeHex(branding?.primaryColor, DEFAULT_TENANT_BRANDING.primaryColor);
  const accent = normalizeHex(branding?.accentColor, DEFAULT_TENANT_BRANDING.accentColor);
  const primaryHover = mixHex(primary, '#000000', 0.16);
  const primaryDarkText = mixHex(primary, '#FFFFFF', 0.48);
  const primarySoftLight = mixHex(primary, '#FFFFFF', 0.9);
  const primarySoftDark = mixHex(primary, '#020617', 0.78);
  const primaryFg = getContrastForeground(primary);

  return {
    ['--brand-primary' as string]: primary,
    ['--brand-primary-hover' as string]: primaryHover,
    ['--brand-primary-fg' as string]: primaryFg,
    ['--brand-primary-soft' as string]: darkMode ? primarySoftDark : primarySoftLight,
    ['--brand-accent' as string]: accent,
    ['--brand-accent-soft' as string]: hexToRgba(accent, darkMode ? 0.22 : 0.12),
    ['--color-blue-600' as string]: primary,
    ['--color-blue-700' as string]: primaryHover,
    ['--color-blue-500' as string]: mixHex(primary, '#FFFFFF', 0.12),
    ['--color-blue-400' as string]: primaryDarkText,
    ['--color-blue-300' as string]: mixHex(primary, '#FFFFFF', 0.62),
    ['--color-blue-50' as string]: primarySoftLight,
    ['--color-blue-950' as string]: primarySoftDark,
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
