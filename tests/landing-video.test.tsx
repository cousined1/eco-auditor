// F-F-15: the 27 MB intro video is requested through /api/video. It used to cost
// every home view 262-405 KB: the showcase <video> said preload="metadata", and the
// desktop hero background autoplays, which downloads whatever `preload` says.
// A fresh home load must request no video bytes before the visitor does something.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsentProvider } from '../src/lib/consent-context';
import LandingPage from '../src/pages/LandingPage';

let container: HTMLDivElement;
let root: Root;

function stubViewport(desktop: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: desktop && query.includes('min-width: 768px'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

async function mountHome() {
  await act(async () =>
    root.render(
      <MemoryRouter>
        <ConsentProvider>
          <LandingPage />
        </ConsentProvider>
      </MemoryRouter>,
    ),
  );
}

const videos = () => [...container.querySelectorAll('video')];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('the intro video on the home page', () => {
  it('shows the click-to-play walkthrough as a poster and loads nothing until it is played', async () => {
    stubViewport(false);
    await mountHome();

    const showcase = videos();
    expect(showcase).toHaveLength(1);
    expect(showcase[0]?.getAttribute('preload')).toBe('none');
    expect(showcase[0]?.getAttribute('poster')).toBe('/og-image.png');
    expect(showcase[0]?.hasAttribute('controls')).toBe(true);
    expect(showcase[0]?.hasAttribute('autoplay')).toBe(false);
  });

  it('does not start the autoplaying desktop background before the visitor interacts', async () => {
    stubViewport(true);
    await mountHome();

    expect(videos().filter((v) => v.hasAttribute('autoplay'))).toHaveLength(0);
    expect(videos().every((v) => v.getAttribute('preload') === 'none')).toBe(true);
  });

  it.each(['pointerdown', 'keydown', 'scroll', 'touchstart'])('starts it after the first %s', async (type) => {
    stubViewport(true);
    await mountHome();
    expect(videos()).toHaveLength(1);

    await act(async () => {
      window.dispatchEvent(new Event(type));
    });
    const background = videos().filter((v) => v.hasAttribute('autoplay'));
    expect(background).toHaveLength(1);
    expect(background[0]?.getAttribute('aria-hidden')).toBe('true');
  });

  it('never starts the background on a phone, whatever the visitor does', async () => {
    stubViewport(false);
    await mountHome();
    await act(async () => {
      window.dispatchEvent(new Event('pointerdown'));
    });
    expect(videos().filter((v) => v.hasAttribute('autoplay'))).toHaveLength(0);
  });
});

/** Top-level MP4 boxes as [type, offset]; only the 8-byte headers are read. */
function topLevelBoxes(file: string): [string, number][] {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const boxes: [string, number][] = [];
    const header = Buffer.alloc(16);
    for (let offset = 0; offset < size; ) {
      readSync(fd, header, 0, 16, offset);
      let length = header.readUInt32BE(0);
      if (length === 1) length = Number(header.readBigUInt64BE(8));
      else if (length === 0) length = size - offset;
      boxes.push([header.toString('latin1', 4, 8), offset]);
      offset += length;
    }
    return boxes;
  } finally {
    closeSync(fd);
  }
}

describe('public/eco-auditor-intro.mp4', () => {
  it('has its index (moov) before its media data (mdat), so a player can start after the first few kB', () => {
    const boxes = topLevelBoxes(resolve('public/eco-auditor-intro.mp4'));
    const at = (type: string) => boxes.find(([name]) => name === type)?.[1] ?? -1;
    expect(at('moov')).toBeGreaterThan(-1);
    expect(at('mdat')).toBeGreaterThan(-1);
    expect(at('moov')).toBeLessThan(at('mdat'));
  });
});
