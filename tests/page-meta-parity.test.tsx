// F-A-12: the title, description and JSON-LD a page sets after JavaScript runs
// must be the ones the prerender step wrote into the HTML, or a crawler and a
// visitor read two different pages. Both are read from src/content/route-meta.json.
// SampleReport and Security still typed their own copies ("compliance dashboard",
// "Upload bills, connect integrations") and restored a stale homepage description
// on unmount.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import routeMeta from '../src/content/route-meta.json';
import { ConsentProvider } from '../src/lib/consent-context';
import SampleReport from '../src/pages/SampleReport';
import Security from '../src/pages/Security';

const HOME = routeMeta['/'];

let container: HTMLDivElement;
let root: Root;
let description: HTMLMetaElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.title = HOME.title;
  description = document.createElement('meta');
  description.name = 'description';
  description.content = HOME.description;
  document.head.append(description);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  description.remove();
  vi.unstubAllGlobals();
});

const jsonLd = () =>
  [...document.head.querySelectorAll('script[type="application/ld+json"]')].map(
    (script) => JSON.parse(script.textContent ?? '{}') as { '@type'?: string; name?: string; description?: string },
  );

async function mount(Page: ComponentType) {
  await act(async () =>
    root.render(
      <MemoryRouter>
        <ConsentProvider>
          <Page />
        </ConsentProvider>
      </MemoryRouter>,
    ),
  );
}

describe.each([
  ['/sample-report', SampleReport],
  ['/security', Security],
] as const)('%s', (route, Page) => {
  const meta = routeMeta[route];

  it('sets the title, description and JSON-LD from the prerendered entry', async () => {
    await mount(Page);

    expect(document.title).toBe(meta.title);
    expect(description.content).toBe(meta.description);
    const page = jsonLd().find((node) => node['@type'] === 'WebPage');
    expect(page?.name).toBe(meta.title);
    expect(page?.description).toBe(meta.description);
  });

  it('hands the homepage entry back on leaving, and removes its JSON-LD', async () => {
    await mount(Page);
    await act(async () => root.render(<div />));

    expect(document.title).toBe(HOME.title);
    expect(description.content).toBe(HOME.description);
    expect(jsonLd()).toEqual([]);
  });

  it('says nothing the audit found the product cannot back', async () => {
    await mount(Page);
    const said = [document.title, description.content, ...jsonLd().map((node) => `${node.name} ${node.description}`)].join('\n');

    expect(said).not.toMatch(/compliance dashboard|reviewable|integrations|upload bills|TLS 1\.3|never share or sell/i);
  });
});

describe('no page types its own head', () => {
  // The guard that keeps this from coming back: a page added tomorrow that assigns a
  // literal title or description fails here, whoever forgets that route-meta.json exists.
  const pages = readdirSync(resolve('src/pages')).filter((file) => file.endsWith('.tsx'));

  it('finds the pages it checks', () => {
    expect(pages).toContain('SampleReport.tsx');
    expect(pages.length).toBeGreaterThan(20);
  });

  it.each(pages)('%s reads title and description from route-meta.json or data, not a literal', (file) => {
    const source = readFileSync(resolve('src/pages', file), 'utf8');
    expect(source).not.toMatch(/document\.title\s*=\s*['"`]/);
    expect(source).not.toMatch(/\b(desc|meta)\.content\s*=\s*['"`]/);
  });
});
