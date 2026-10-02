// One palette for "which scope is this" on every chart and badge. Scope 1 was
// green on the dashboard, red in the calculator (red also reads as "error") and
// red/blue/green on the sample report, so the same data changed colour from
// screen to screen.
//
// Light values are the audit lane's (>= 3:1 against white, WCAG 1.4.11); the
// dark set is the same three hues lifted to >= 3:1 against the dark card. Green
// and teal sit close together for colour-blind readers, so nothing that uses
// these may rely on colour alone: every chart also carries the scope's name
// (legend, slice label, tooltip or table).

export type ScopeName = 'Scope 1' | 'Scope 2' | 'Scope 3';

export const SCOPE_NAMES: readonly ScopeName[] = ['Scope 1', 'Scope 2', 'Scope 3'];

export type ScopePalette = Readonly<Record<ScopeName, string>>;

export const SCOPE_COLORS: ScopePalette = {
  'Scope 1': '#0d7a3a',
  'Scope 2': '#0f766e',
  'Scope 3': '#b45309',
};

export const SCOPE_COLORS_DARK: ScopePalette = {
  'Scope 1': '#4ade80',
  'Scope 2': '#2dd4bf',
  'Scope 3': '#fbbf24',
};

/** Neutral for an unrecognised scope label (should not happen; never a scope colour). */
export const UNKNOWN_SCOPE_COLOR = '#94a3b8';

export function scopeColors(theme: 'light' | 'dark'): ScopePalette {
  return theme === 'dark' ? SCOPE_COLORS_DARK : SCOPE_COLORS;
}

export function scopeColor(scope: string, theme: 'light' | 'dark' = 'light'): string {
  return (scopeColors(theme) as Record<string, string>)[scope] ?? UNKNOWN_SCOPE_COLOR;
}
