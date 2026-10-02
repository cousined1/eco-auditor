// F-C-09 (primary CTA demoted; legal/contact pages lost their navigation),
// F-C-23 (one theme toggle on every public page, and a glyph that is not an empty
// ring) and F-C-20 (one logo). Asserted on the mounted DOM: which classes the
// conversion button carries, which links exist, how many toggles there are, what
// a screen reader is given.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BrandMark from '../src/components/BrandMark';
import Header, { type HeaderProps } from '../src/components/Header';
import { ThemeProvider } from '../src/hooks/useTheme';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // ThemeProvider reads the system preference when nothing is stored.
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })),
  );
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderHeader(props: HeaderProps) {
  await act(async () =>
    root.render(
      <MemoryRouter>
        <ThemeProvider>
          <Header {...props} />
        </ThemeProvider>
      </MemoryRouter>,
    ),
  );
}

const link = (name: string) =>
  [...container.querySelectorAll<HTMLAnchorElement>('a')].find((anchor) => anchor.textContent?.trim() === name)!;
const toggles = () => container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Switch to"]');
const mainNav = () => container.querySelector<HTMLElement>('nav[aria-label="Main navigation"]');
const navLabels = () => [...(mainNav()?.querySelectorAll('a') ?? [])].map((anchor) => anchor.textContent);

describe('Header call to action (F-C-09)', () => {
  it('keeps "Start Free Trial" the primary button on marketing pages, to the right of the secondary one', async () => {
    await renderHeader({ variant: 'marketing' });

    const trial = link('Start Free Trial');
    const demo = link('Book a Demo');
    expect(trial.classList.contains('btn-primary')).toBe(true);
    expect(trial.classList.contains('btn-secondary')).toBe(false);
    expect(demo.classList.contains('btn-secondary')).toBe(true);
    expect(demo.classList.contains('btn-primary')).toBe(false);
    expect(demo.compareDocumentPosition(trial) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(trial.getAttribute('href')).toBe('/signup/');
    expect(demo.getAttribute('href')).toBe('/demo/');
  });

  it('keeps Log In secondary and Start Free Trial primary on the landing page', async () => {
    await renderHeader({ variant: 'landing' });
    expect(link('Log In').classList.contains('btn-secondary')).toBe(true);
    expect(link('Start Free Trial').classList.contains('btn-primary')).toBe(true);
  });

  it('styles by declared intent, not by position', async () => {
    await renderHeader({
      variant: 'marketing',
      cta: [
        { label: 'First', href: '/a', variant: 'primary' },
        { label: 'Second', href: '/b', variant: 'primary' },
        { label: 'Third', href: '/c', variant: 'secondary' },
      ],
    });
    expect(link('First').classList.contains('btn-primary')).toBe(true);
    expect(link('Second').classList.contains('btn-primary')).toBe(true);
    expect(link('Third').classList.contains('btn-secondary')).toBe(true);
  });

  it('gives the legal and contact pages the marketing navigation and calls to action', async () => {
    await renderHeader({ variant: 'legal' });

    expect(navLabels()).toEqual(['Features', 'Pricing', 'Methodology', 'Sample Report', 'Security']);
    expect(link('Pricing').getAttribute('href')).toBe('/pricing/');
    expect(link('Start Free Trial').classList.contains('btn-primary')).toBe(true);
    expect(link('Book a Demo').classList.contains('btn-secondary')).toBe(true);
    // Below md the nav lives behind the menu button, which must exist too.
    expect(container.querySelector('button[aria-label="Toggle navigation menu"]')).not.toBeNull();
  });

  it('marketing and legal pages offer the same routes', async () => {
    await renderHeader({ variant: 'marketing' });
    const marketing = navLabels();
    await renderHeader({ variant: 'legal' });
    expect(navLabels()).toEqual(marketing);
  });
});

describe('Header theme toggle (F-C-23)', () => {
  it.each(['landing', 'marketing', 'legal'] as const)('renders exactly one toggle on the %s variant', async (variant) => {
    await renderHeader({ variant });
    expect(toggles()).toHaveLength(1);
  });

  it('lets a page replace the built-in toggle, never doubling it', async () => {
    await renderHeader({ variant: 'marketing', extra: <button type="button">Custom</button> });
    expect(toggles()).toHaveLength(0);
    expect(link('Start Free Trial')).toBeDefined();
    expect(container.textContent).toContain('Custom');

    await renderHeader({ variant: 'marketing', extra: null });
    expect(toggles()).toHaveLength(0);
  });

  it('switches the theme, and its name always says what a press will do', async () => {
    await renderHeader({ variant: 'marketing' });
    const toggle = () => toggles()[0]!;
    expect(toggle().getAttribute('aria-label')).toBe('Switch to dark mode');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    await act(async () => toggle().click());
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(toggle().getAttribute('aria-label')).toBe('Switch to light mode');

    await act(async () => toggle().click());
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('is drawn in exactly one place: no page or shell builds its own switch', () => {
    // LandingPage, BlogList and BlogPost each pasted their own button and their
    // own moon glyph into Header's `extra` slot. That is how the empty-ring icon
    // outlived every fix, and how most pages ended up with no toggle at all.
    const files = (readdirSync(resolve('src'), { recursive: true }) as string[])
      .map((file) => file.replaceAll('\\', '/'))
      .filter((file) => /\.tsx?$/.test(file));
    const drawing = files.filter((file) => readFileSync(resolve('src', file), 'utf8').includes('Switch to'));
    expect(drawing).toEqual(['components/ThemeToggle.tsx']);
  });

  it('draws the moon as one closed shape, not two nested circles', async () => {
    await renderHeader({ variant: 'marketing' });
    const paths = toggles()[0]!.querySelectorAll('svg path');
    expect(paths).toHaveLength(1);
    const d = paths[0]!.getAttribute('d') ?? '';
    // The old glyph was `M… zm0 12.5…`: an outer and an inner circle, which fills
    // as an empty ring. A crescent is a single subpath.
    expect(d.match(/[Mm]/g)).toHaveLength(1);
    expect(d.match(/[Zz]/g)).toHaveLength(1);
    expect(toggles()[0]!.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('Header mobile menu button (F-C-25)', () => {
  const menuButton = () => container.querySelector<HTMLButtonElement>('button[aria-label="Toggle navigation menu"]')!;

  it.each(['landing', 'marketing', 'legal'] as const)(
    '%s: aria-controls names an element that exists, closed and open',
    async (variant) => {
      await renderHeader({ variant });
      const id = menuButton().getAttribute('aria-controls');
      expect(id, 'the button must say what it controls').toBeTruthy();

      // Closed: the target exists (aria-controls never dangles) but is hidden and empty.
      const panel = document.getElementById(id!);
      expect(panel).not.toBeNull();
      expect(panel!.hidden).toBe(true);
      expect(menuButton().getAttribute('aria-expanded')).toBe('false');
      expect(container.querySelector('nav[aria-label="Mobile navigation"]')).toBeNull();

      await act(async () => menuButton().click());
      expect(menuButton().getAttribute('aria-expanded')).toBe('true');
      expect(document.getElementById(id!)!.hidden).toBe(false);
      expect(document.getElementById(id!)!.querySelector('nav[aria-label="Mobile navigation"] a')).not.toBeNull();
    },
  );

  it('renders no menu button, and so no dangling reference, when there is nothing to open', async () => {
    await renderHeader({ variant: 'marketing', navItems: [], hideCta: true });
    expect(menuButton()).toBeNull();
    expect(container.querySelector('[aria-controls]')).toBeNull();
  });
});

describe('Header bypass link (F-C-16)', () => {
  it.each(['landing', 'marketing', 'legal'] as const)('%s: "Skip to main content" is the first tab stop', async (variant) => {
    await renderHeader({ variant });
    const first = container.querySelector<HTMLElement>('header a[href], header button')!;
    expect(first.textContent).toBe('Skip to main content');
    expect(first.getAttribute('href')).toBe('#main-content');
  });
});

describe('Header logo (F-C-20)', () => {
  it('names the home link by its text, with the decorative mark hidden from assistive tech', async () => {
    await renderHeader({ variant: 'marketing' });
    const home = container.querySelector<HTMLAnchorElement>('a[href="/"]')!;
    expect(home.textContent?.trim()).toBe('Eco-Auditor');
    const mark = home.querySelector('svg')!;
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(mark.getAttribute('aria-label')).toBeNull();
    expect(mark.getAttribute('role')).toBeNull();
  });
});

describe('one logo (F-C-20)', () => {
  // Two different marks had been pasted into five shells. The shells below must
  // render <BrandMark/> and never draw a logo of their own again.
  const SHELLS = [
    'src/App.tsx',
    'src/components/Header.tsx',
    'src/components/Footer.tsx',
    'src/components/ChatbotWidget.tsx',
    'src/components/auth/AuthShell.tsx',
  ];
  const source = (file: string) => readFileSync(resolve(file), 'utf8');

  it.each(SHELLS)('%s renders BrandMark instead of an inline logo', (file) => {
    const text = source(file);
    expect(text).toMatch(/import BrandMark from '\.{1,2}\/(?:components\/)?BrandMark'/);
    expect(text).toContain('<BrandMark');
    expect(text).not.toContain('M8 20V8l6 4 6-4v12'); // the green tile's glyph
    expect(text).not.toContain('M380 310 A150 150'); // the cycle-and-leaf drawing
  });

  it('keeps the tile glyph in exactly one place', () => {
    expect(source('src/components/BrandMark.tsx')).toContain('M8 20V8l6 4 6-4v12');
  });
});

describe('BrandMark', () => {
  it('is decorative by default and an image with a name when given a label', async () => {
    await act(async () =>
      root.render(
        <div>
          <BrandMark className="w-6 h-6" />
          <BrandMark label="Eco-Auditor" />
        </div>,
      ),
    );
    const [decorative, standalone] = [...container.querySelectorAll('svg')];
    expect(decorative!.getAttribute('aria-hidden')).toBe('true');
    expect(decorative!.getAttribute('role')).toBeNull();
    expect(decorative!.getAttribute('class')).toBe('w-6 h-6');
    expect(standalone!.getAttribute('role')).toBe('img');
    expect(standalone!.getAttribute('aria-label')).toBe('Eco-Auditor');
    expect(standalone!.getAttribute('aria-hidden')).toBeNull();
  });
});
