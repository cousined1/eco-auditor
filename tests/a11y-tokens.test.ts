// @vitest-environment node
//
// F-C-12 / F-C-15 / placeholder contrast: these are properties of the compiled
// stylesheet, so the test compiles src/index.css through the repo's own Tailwind
// config and checks the colours the browser will actually get, against the
// backgrounds the app draws them on. If someone drops the overrides, or a token
// is lightened again, the resolved colour fails here instead of in an axe run.
import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import { beforeAll, describe, expect, it } from 'vitest';

type Rgb = [number, number, number];

let css: postcss.Root;
// Backgrounds the status colours are drawn on, read from the compiled utilities
// (assigned once the stylesheet has been compiled).
let PAGE_LIGHT: Rgb;
let CARD_DARK: Rgb;
let FIELD_DARK: Rgb;

beforeAll(async () => {
  const from = path.resolve('src/index.css');
  const result = await postcss([tailwind()]).process(fs.readFileSync(from, 'utf8'), { from });
  css = postcss.parse(result.css);
  PAGE_LIGHT = surface('bg-surface-50');
  CARD_DARK = surface('bg-surface-900', true);
  FIELD_DARK = surface('bg-surface-800', true);
}, 60_000);

// The value the cascade ends on: the last declaration of `prop` among rules
// whose selector is exactly `selector` (equal specificity, so source order wins).
function lastValue(selector: string, prop: string): string {
  let value: string | undefined;
  css.walkRules((rule) => {
    if (rule.selector !== selector) return;
    rule.walkDecls(prop, (decl) => {
      value = decl.value;
    });
  });
  if (value === undefined) throw new Error(`no "${prop}" declared for ${selector}`);
  return value;
}

function parseColor(value: string, theme: 'light' | 'dark'): Rgb {
  const variable = value.match(/^var\((--[\w-]+)(?:,\s*(.+))?\)$/);
  if (variable) {
    const declared = lastValue(theme === 'dark' ? '.dark' : ':root', variable[1]!);
    return parseColor(declared, theme);
  }
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  }
  const rgb = value.match(/^rgb\((\d+)\s+(\d+)\s+(\d+)/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  throw new Error(`cannot parse colour ${value}`);
}

const luminance = ([r, g, b]: Rgb) => {
  const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const over = (fg: Rgb, bg: Rgb, alpha: number): Rgb => fg.map((c, i) => Math.round(c * alpha + bg[i]! * (1 - alpha))) as Rgb;

const WHITE: Rgb = [255, 255, 255];
const surface = (utility: string, dark = false) =>
  parseColor(lastValue(dark ? `.dark\\:${utility}:is(.dark *)` : `.${utility}`, 'background-color'), dark ? 'dark' : 'light');
const textColor = (utility: string, theme: 'light' | 'dark') => parseColor(lastValue(`.${utility}`, 'color'), theme);

const STATUS_TEXT = ['text-risk-low', 'text-amber-600', 'text-emerald-600', 'text-risk-high'];

describe('status text colours (F-C-15)', () => {
  it.each(STATUS_TEXT)('.%s reaches 4.5:1 on white and on the page background in light mode', (utility) => {
    const colour = textColor(utility, 'light');
    expect(contrast(colour, WHITE), `${utility} on white`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colour, PAGE_LIGHT), `${utility} on surface-50`).toBeGreaterThanOrEqual(4.5);
  });

  it('draws error text legibly on its own tinted banner (bg-risk-high/10) in both themes', () => {
    // The banner is the palette's error colour at 10% opacity over the surface
    // beneath it; read both numbers from the compiled utility.
    const tint = lastValue('.bg-risk-high\\/10', 'background-color');
    const palette = parseColor(tint, 'light');
    const alpha = Number(tint.match(/\/\s*([\d.]+)\s*\)/)![1]);

    const red = textColor('text-risk-high', 'light');
    expect(contrast(red, over(palette, WHITE, alpha))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(red, over(palette, PAGE_LIGHT, alpha))).toBeGreaterThanOrEqual(4.5);

    const darkRed = textColor('text-risk-high', 'dark');
    expect(contrast(darkRed, over(palette, CARD_DARK, alpha))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkRed, over(palette, FIELD_DARK, alpha))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(STATUS_TEXT)('.%s reaches 4.5:1 on the dark surfaces when no dark: variant overrides it', (utility) => {
    const colour = textColor(utility, 'dark');
    expect(contrast(colour, CARD_DARK), `${utility} on surface-900`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colour, FIELD_DARK), `${utility} on surface-800`).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the dark: variants stronger than the remapped light colour', () => {
    // The remap is one class; the variant selector is a class plus :is(.dark *).
    // If that ever inverted, dark mode would silently lose its own colours.
    let found = false;
    css.walkRules((rule) => {
      if (rule.selector === '.dark\\:text-amber-400:is(.dark *)') found = true;
    });
    expect(found).toBe(true);
  });
});

// The chat widget is drawn from these utilities (it used inline hex values, which
// gave the six serious axe contrast failures and ignored dark mode). Pair each
// foreground with the surface it actually sits on in ChatbotWidget.tsx.
describe('chat widget palette (F-C-14)', () => {
  const fg = (utility: string, dark = false) =>
    parseColor(lastValue(dark ? `.dark\\:${utility}:is(.dark *)` : `.${utility}`, 'color'), dark ? 'dark' : 'light');
  const bg = (utility: string, dark = false) => surface(utility, dark);

  it('white text on the brand header, user bubbles and send button', () => {
    expect(contrast(WHITE, bg('bg-brand-600'))).toBeGreaterThanOrEqual(4.5);
  });

  it('the close "×" stays readable on its translucent button over the header', () => {
    const overlay = lastValue('.bg-black\\/20', 'background-color');
    const alpha = Number(overlay.match(/\/\s*([\d.]+)\s*\)/)![1]);
    const button = over(parseColor(overlay, 'light'), bg('bg-brand-600'), alpha);
    expect(contrast(WHITE, button)).toBeGreaterThanOrEqual(4.5);
  });

  it('quick replies and links in bubbles reach 4.5:1 in light mode', () => {
    expect(contrast(fg('text-brand-700'), WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(fg('text-brand-700'), PAGE_LIGHT)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(fg('text-surface-800'), WHITE)).toBeGreaterThanOrEqual(4.5);
  });

  it('quick replies, links and bubble text reach 4.5:1 in dark mode, and the reply outline 3:1', () => {
    const panel = bg('bg-surface-900', true);
    const log = bg('bg-surface-950', true);
    const bubble = bg('bg-surface-800', true);
    for (const surfaceColour of [panel, log, bubble]) {
      expect(contrast(fg('text-brand-300', true), surfaceColour)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(fg('text-surface-100', true), bubble)).toBeGreaterThanOrEqual(4.5);
    const outline = parseColor(lastValue('.dark\\:border-brand-400:is(.dark *)', 'border-color'), 'dark');
    expect(contrast(outline, log)).toBeGreaterThanOrEqual(3);
  });
});

describe('placeholder colour (F-C-13 token)', () => {
  it('.input placeholders reach 4.5:1 in both themes', () => {
    const value = lastValue('.input::placeholder', 'color');
    expect(contrast(parseColor(value, 'light'), WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(parseColor(value, 'dark'), FIELD_DARK)).toBeGreaterThanOrEqual(4.5);
  });
});

// The Login, Signup and Forgot-password fields share one class string (authInputClass) and do
// not use `.input`, so their placeholders were checked by nothing: surface-400 on white is
// 2.46:1. Read the string from source (the module also imports the InsForge client) and
// resolve the placeholder utilities it names, against the backgrounds it names.
describe('auth form placeholders (F-C-13)', () => {
  const source = fs.readFileSync(path.resolve('src/components/auth/authHelpers.ts'), 'utf8');
  const tokens = (/export const authInputClass =\s*'([^']+)'/.exec(source)?.[1] ?? '').split(/\s+/).filter(Boolean);
  const lightToken = tokens.find((token) => token.startsWith('placeholder-'));
  const darkToken = tokens.find((token) => token.startsWith('dark:placeholder-'))?.slice('dark:'.length);
  const placeholder = (token: string | undefined, dark: boolean): Rgb =>
    parseColor(lastValue(dark ? `.dark\\:${token}:is(.dark *)::placeholder` : `.${token}::placeholder`, 'color'), dark ? 'dark' : 'light');

  it('finds the placeholder utilities and the field backgrounds in the shared class string', () => {
    expect(lightToken, 'a light placeholder utility in authInputClass').toBeTruthy();
    expect(darkToken, 'a dark: placeholder utility in authInputClass').toBeTruthy();
    expect(tokens).toContain('bg-white');
    expect(tokens).toContain('dark:bg-surface-900');
  });

  it('reaches 4.5:1 on the white field in light mode', () => {
    expect(contrast(placeholder(lightToken, false), WHITE), lightToken).toBeGreaterThanOrEqual(4.5);
  });

  it('reaches 4.5:1 on the dark field in dark mode', () => {
    expect(contrast(placeholder(darkToken, true), CARD_DARK), `dark:${darkToken}`).toBeGreaterThanOrEqual(4.5);
  });
});

describe('badges', () => {
  it('.badge-gray text reaches 4.5:1 in dark mode', () => {
    const text = parseColor(lastValue('.badge-gray:is(.dark *)', 'color'), 'dark');
    const background = parseColor(lastValue('.badge-gray:is(.dark *)', 'background-color'), 'dark');
    expect(contrast(text, background)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('links inside running text (F-C-12)', () => {
  const rule = () => {
    let found: postcss.Rule | undefined;
    css.walkRules((candidate) => {
      if (candidate.selector.startsWith(':where(p, li, label, dd) a')) found = candidate;
    });
    return found;
  };

  it('underlines them at rest, so they do not rely on colour alone', () => {
    const declarations = Object.fromEntries((rule()?.nodes ?? []).flatMap((node) => (node.type === 'decl' ? [[node.prop, node.value]] : [])));
    expect(declarations['text-decoration-line']).toBe('underline');
  });

  it('adds no specificity, so a utility such as no-underline still opts out', () => {
    const selector = rule()!.selector;
    // Everything but the final element selector sits inside :where().
    const outsideWhere = selector.replace(/:where\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/g, '').trim();
    expect(outsideWhere).toBe('a');
  });

  it('leaves navigation lists and button-styled links alone', () => {
    const selector = rule()!.selector;
    expect(selector).toContain('nav a');
    expect(selector).toContain("[class*='btn-']");
  });
});
