// F-B-13 / F-C-17 / F-C-25: one formatter for CO2e quantities and counts, and one
// palette for "which scope is this", shared by every screen.
import { describe, expect, it } from 'vitest';
import { formatCO2e, formatCO2eParts, formatTonnesCO2e, pluralize } from '../src/lib/format';
import { SCOPE_COLORS, SCOPE_COLORS_DARK, SCOPE_NAMES, scopeColor, scopeColors } from '../src/lib/scopeColors';

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const [r = 0, g = 0, b = 0] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

describe('formatCO2e (F-B-13)', () => {
  it('renders the audited account the way the calculator does: one decimal, kg below one tonne', () => {
    // b-1 from the audit: 6.3672 + 4.89222 + 0.255 = 11.51442 tonnes. The dashboard
    // showed 6 / 5 / "0 tCO2e" against a total of 12.
    expect(formatTonnesCO2e(6.3672)).toBe('6.4 tCO2e');
    expect(formatTonnesCO2e(4.89222)).toBe('4.9 tCO2e');
    expect(formatTonnesCO2e(0.255)).toBe('255.0 kg CO2e');
    expect(formatTonnesCO2e(11.51442)).toBe('11.5 tCO2e');
  });

  it('formats kilograms and tonnes identically for the same quantity', () => {
    expect(formatCO2e(26_500)).toBe(formatTonnesCO2e(26.5));
    expect(formatCO2e(255)).toBe(formatTonnesCO2e(0.255));
  });

  it('picks the unit from the rounded value, never "1,000.0 kg"', () => {
    expect(formatCO2e(999.9)).toBe('999.9 kg CO2e');
    expect(formatCO2e(999.96)).toBe('1.0 tCO2e');
    expect(formatCO2e(1000)).toBe('1.0 tCO2e');
  });

  it('separates thousands and keeps exactly one decimal', () => {
    expect(formatCO2e(1_234_567)).toBe('1,234.6 tCO2e');
    expect(formatCO2e(0)).toBe('0.0 kg CO2e');
  });

  it('never renders NaN or Infinity', () => {
    expect(formatCO2e(Number.NaN)).toBe('—');
    expect(formatCO2e(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatCO2eParts(Number.NaN)).toEqual({ value: '—', unit: '' });
  });

  it('splits into a number and a unit for cards that style them separately', () => {
    expect(formatCO2eParts(6367.2)).toEqual({ value: '6.4', unit: 'tCO2e' });
    expect(formatCO2eParts(255)).toEqual({ value: '255.0', unit: 'kg CO2e' });
  });
});

describe('pluralize (F-C-25)', () => {
  it('uses the singular for exactly one', () => {
    expect(pluralize(1, 'entry', 'entries')).toBe('1 entry');
    expect(pluralize(1, 'facility', 'facilities')).toBe('1 facility');
    expect(pluralize(1, 'file')).toBe('1 file');
  });

  it('uses the plural for zero and many, with an irregular or default plural', () => {
    expect(pluralize(0, 'facility', 'facilities')).toBe('0 facilities');
    expect(pluralize(3, 'entry', 'entries')).toBe('3 entries');
    expect(pluralize(2, 'file')).toBe('2 files');
    expect(pluralize(2, 'warning')).toBe('2 warnings');
  });
});

describe('scope palette (F-C-17)', () => {
  it('names the same three scopes in both themes', () => {
    expect([...SCOPE_NAMES]).toEqual(['Scope 1', 'Scope 2', 'Scope 3']);
    expect(Object.keys(SCOPE_COLORS)).toEqual([...SCOPE_NAMES]);
    expect(Object.keys(SCOPE_COLORS_DARK)).toEqual([...SCOPE_NAMES]);
  });

  it('gives each scope a distinct colour, and none of them the "error" red the calculator used for Scope 1', () => {
    for (const palette of [SCOPE_COLORS, SCOPE_COLORS_DARK]) {
      expect(new Set(Object.values(palette)).size).toBe(3);
    }
    expect(Object.values(SCOPE_COLORS)).not.toContain('#ef4444');
  });

  // Surfaces as compiled today: bg-white cards on the bg-surface-50 page, and
  // dark:bg-surface-900 (rgb 20 31 24) cards.
  it('keeps every light-theme mark at 3:1 or better against the card and the page (WCAG 1.4.11)', () => {
    for (const scope of SCOPE_NAMES) {
      expect(contrast(SCOPE_COLORS[scope], '#ffffff')).toBeGreaterThanOrEqual(3);
      expect(contrast(SCOPE_COLORS[scope], '#f8faf9')).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps every dark-theme mark at 3:1 or better against the dark card', () => {
    for (const scope of SCOPE_NAMES) {
      expect(contrast(SCOPE_COLORS_DARK[scope], '#141f18')).toBeGreaterThanOrEqual(3);
    }
  });

  it('resolves by theme and falls back to a neutral for an unknown scope', () => {
    expect(scopeColors('light')).toBe(SCOPE_COLORS);
    expect(scopeColors('dark')).toBe(SCOPE_COLORS_DARK);
    expect(scopeColor('Scope 2')).toBe(SCOPE_COLORS['Scope 2']);
    expect(scopeColor('Scope 2', 'dark')).toBe(SCOPE_COLORS_DARK['Scope 2']);
    expect(scopeColor('Scope 9')).not.toBe(SCOPE_COLORS['Scope 1']);
  });
});
