// The chat widget as a visitor uses it: F-C-02 / F-R3-01 (typing and focus),
// F-C-14 (label, honest status line, plain quick replies), F-B-20 (markdown and
// mid-flow quick replies) and F-X1-04 (429 wording). Everything is asserted on
// the live DOM: which element has focus, what can be typed, what is rendered.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatWidget from '../src/components/ChatbotWidget';

// The widget stays hidden until cookie consent resolves; that gate has its own
// coverage in contact-page.test.tsx.
vi.mock('../src/lib/consent-context', () => ({
  useConsent: () => ({ consentState: { hasConsented: true } }),
}));

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

const EMOJI = /\p{Extended_Pictographic}/u;

function reply(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

// jsdom resolves a body read on a later turn than the fetch promise itself.
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // jsdom implements neither; the widget auto-scrolls on every message.
  Object.defineProperty(Element.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true, writable: true });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  vi.unstubAllGlobals();
});

const launcher = () => container.querySelector<HTMLButtonElement>('button[aria-label="Open Eco-Auditor chat"]');
const dialog = () => container.querySelector<HTMLElement>('[role="dialog"]');
const input = () => container.querySelector<HTMLInputElement>('[role="dialog"] input[type="text"]')!;
const log = () => container.querySelector<HTMLElement>('[role="log"]')!;
const buttons = (scope: ParentNode = container) =>
  [...scope.querySelectorAll<HTMLButtonElement>('button')].map((button) => button.textContent?.trim() ?? '');
const quickReplyButtons = () =>
  [...log().querySelectorAll<HTMLButtonElement>('button')];

async function openChat() {
  await act(async () => root.render(<ChatWidget />));
  await act(async () => launcher()!.click());
}

async function typeChar(char: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(input(), input().value + char);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function typeText(text: string) {
  for (const char of text) await typeChar(char);
}

// Enter in a text field submits its form; requestSubmit does the same without
// moving focus, which is what the keyboard path does.
async function submitWithEnter() {
  await act(async () => container.querySelector<HTMLFormElement>('[role="dialog"] form')!.requestSubmit());
}

function pending() {
  let resolve!: (response: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>((done) => (resolve = done)));
  return (response: Response) => resolve(response);
}

describe('chat widget: typing and focus (F-C-02, F-R3-01)', () => {
  it('keeps every typed character in the input and focus on it', async () => {
    await openChat();
    await act(async () => input().focus());

    for (const [index, char] of [...'hello there'].entries()) {
      await typeChar(char);
      expect(document.activeElement, `focus after character ${index + 1}`).toBe(input());
    }
    expect(input().value).toBe('hello there');
    // A Space typed into the field is text, not a click on "Close chat".
    expect(dialog()).not.toBeNull();
  });

  it('closes on Escape and puts focus back on the launcher', async () => {
    await openChat();
    await act(async () => input().focus());
    await typeText('hi');

    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(launcher());
  });

  it('keeps focus in the input while a reply loads, and after it arrives', async () => {
    const respond = pending();
    await openChat();
    await act(async () => input().focus());
    await typeText('hi');
    await submitWithEnter();

    // While loading the field refuses edits (readOnly) but is still the focused
    // element (a disabled field drops focus to <body>) and says it is busy.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(input().readOnly).toBe(true);
    expect(input().disabled).toBe(false);
    expect(input().getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(input());

    await act(async () => respond(reply({ success: true, response: 'Hello!', state: {} })));
    await settle();

    expect(log().textContent).toContain('Hello!');
    expect(input().readOnly).toBe(false);
    expect(input().getAttribute('aria-busy')).toBe('false');
    expect(document.activeElement).toBe(input());
    // The next answer can be typed without clicking the field first.
    await typeText('xy');
    expect(input().value).toBe('xy');
    expect(document.activeElement).toBe(input());
  });

  it('returns focus to the input after a quick reply is used', async () => {
    fetchMock.mockResolvedValueOnce(reply({ success: true, response: 'Plans...', state: {} }));
    await openChat();
    const pricing = quickReplyButtons().find((button) => button.textContent === 'Pricing')!;
    await act(async () => {
      pricing.focus();
      pricing.click();
    });
    await settle();

    expect(document.activeElement).toBe(input());
  });
});

describe('chat widget: accessible name, status line and labels (F-C-14)', () => {
  it('labels the input and the dialog', async () => {
    await openChat();
    expect(input().getAttribute('aria-label')).toBe('Message the Eco-Auditor assistant');
    expect(dialog()!.getAttribute('aria-label')).toBe('Eco-Auditor chat');
    expect(dialog()!.getAttribute('aria-modal')).toBe('true');
  });

  it('says it is an automated assistant, not that someone is online', async () => {
    await openChat();
    expect(dialog()!.textContent).toContain('Automated assistant');
    expect(dialog()!.textContent).not.toContain('Online now');
  });

  it('uses one spelling of the brand', async () => {
    await openChat();
    const everything = container.innerHTML;
    expect(everything).not.toContain('EcoAuditor');
    expect(dialog()!.textContent).toContain('Eco-Auditor Sales');
  });

  it('offers quick replies and a welcome message without emoji', async () => {
    await openChat();
    expect(buttons(log())).toEqual(['Pricing', 'Book a Demo', 'How it works', 'Contact Sales']);
    expect(log().textContent).not.toMatch(EMOJI);
  });

  it('shows the server\'s emoji-labelled quick replies as plain labels and sends the plain label', async () => {
    fetchMock
      .mockResolvedValueOnce(
        reply({
          success: true,
          response: 'Ask away.',
          state: {},
          quickReplies: ['💰 Pricing', '📅 Book a Demo', '🚀 How it works', '📞 Contact Sales'],
        }),
      )
      .mockResolvedValueOnce(reply({ success: true, response: 'Plans...', state: {} }));
    await openChat();
    await act(async () => input().focus());
    await typeText('hello');
    await submitWithEnter();
    await settle();

    const labels = quickReplyButtons().map((button) => button.textContent);
    expect(labels.slice(-4)).toEqual(['Pricing', 'Book a Demo', 'How it works', 'Contact Sales']);
    expect(log().textContent).not.toMatch(EMOJI);

    await act(async () => quickReplyButtons().at(-4)!.click());
    const sent = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string);
    expect(sent.message).toBe('Pricing');
  });
});

describe('chat widget: replies (F-B-20, F-X1-04)', () => {
  it('renders bold and links from the bot, and keeps a visitor\'s own text literal', async () => {
    fetchMock.mockResolvedValueOnce(
      reply({
        success: true,
        response: 'Plans:\n• **Starter** — see [Pricing](/pricing) or [our deck](https://example.com/deck).',
        state: {},
      }),
    );
    await openChat();
    await act(async () => input().focus());
    await typeText('**hi** [x](https://example.com)');
    await submitWithEnter();
    await settle();

    const links = [...log().querySelectorAll<HTMLAnchorElement>('a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/pricing', 'https://example.com/deck']);
    for (const link of links) {
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
      expect(link.getAttribute('target')).toBe('_blank');
    }
    expect(log().querySelector('strong')?.textContent).toBe('Starter');
    expect(log().textContent).not.toContain('**Starter**');
    // What the visitor typed is shown as typed: no formatting, no link.
    expect(log().textContent).toContain('**hi** [x](https://example.com)');
  });

  it('never renders a script-capable link from a bot reply', async () => {
    fetchMock.mockResolvedValueOnce(
      reply({
        success: true,
        response: '[Open](javascript:alert(document.cookie)) <img src=x onerror=alert(1)> [Mail](mailto:a@b.co)',
        state: {},
      }),
    );
    await openChat();
    await act(async () => input().focus());
    await typeText('hi');
    await submitWithEnter();
    await settle();

    const hrefs = [...log().querySelectorAll('a')].map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual(['mailto:a@b.co']);
    expect(log().querySelector('img')).toBeNull();
    expect(log().innerHTML.toLowerCase()).not.toContain('javascript:');
    expect(log().textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('answers HTTP 429 in plain words with the wait from the response body', async () => {
    fetchMock.mockResolvedValueOnce(reply({ error: 'Too many requests', retryAfter: 600 }, { status: 429 }));
    await openChat();
    await act(async () => input().focus());
    await typeText('hi');
    await submitWithEnter();
    await settle();

    const text = log().textContent ?? '';
    expect(text).toContain('about 10 minutes');
    expect(text).not.toMatch(/too many requests/i);
    // The bubble must not offer buttons that would just be rate limited again.
    expect(quickReplyButtons().map((button) => button.textContent)).toEqual([
      'Pricing',
      'Book a Demo',
      'How it works',
      'Contact Sales',
    ]);
  });

  it('falls back to the Retry-After header, and to a generic wait when a proxy 429 is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<html>slow down</html>', { status: 429, headers: { 'Retry-After': '90' } }),
    );
    await openChat();
    await act(async () => input().focus());
    await typeText('hi');
    await submitWithEnter();
    await settle();
    expect(log().textContent).toContain('about 2 minutes');
    expect(log().textContent).not.toContain('Network error');

    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 429 }));
    await typeText('again');
    await submitWithEnter();
    await settle();
    expect(log().textContent).toMatch(/try again/i);
    expect(log().textContent).not.toContain('Network error');
  });

  it('offers no quick replies while a guided flow is running, on replies or on errors', async () => {
    fetchMock
      .mockResolvedValueOnce(
        reply({ success: true, response: 'What is your name?', state: { flow: 'demo', step: 'name' } }),
      )
      .mockResolvedValueOnce(reply({ success: false, error: 'Chat is temporarily unavailable' }, { status: 500 }));
    await openChat();
    const welcomeReplies = quickReplyButtons().length;
    expect(welcomeReplies).toBe(4);

    await act(async () => input().focus());
    await typeText('book a demo');
    await submitWithEnter();
    await settle();
    // The flow reply carries no quickReplies, and the client must not add its own.
    expect(log().textContent).toContain('What is your name?');
    expect(quickReplyButtons()).toHaveLength(welcomeReplies);
    expect(input().placeholder).toBe('Type your answer...');

    await typeText('Ada');
    await submitWithEnter();
    await settle();
    expect(log().textContent).toContain('Chat is temporarily unavailable');
    expect(quickReplyButtons()).toHaveLength(welcomeReplies);
  });
});
