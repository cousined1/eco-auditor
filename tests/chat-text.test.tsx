// F-B-20 / F-X1-04 / F-C-14: the chat widget showed the server's markdown as
// literal text (`**Starter**`, `[Pricing](/pricing)`), read a 429 out as "Too many
// requests", and labelled its quick replies with emoji. The helpers under test
// are pure, so these are behaviour tests on their output, with the security
// property (no script-capable href, no HTML injection) checked on rendered markup.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  plainQuickReply,
  rateLimitMessage,
  renderChatMarkdown,
  sanitizeChatHref,
} from '../src/components/chat/chatText';

const render = (text: string) => renderToStaticMarkup(<div>{renderChatMarkdown(text)}</div>);

// Every href in a rendered fragment, so assertions do not depend on attribute order.
const hrefsIn = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);

describe('sanitizeChatHref', () => {
  it.each([
    'https://example.com/a?b=c&d=e',
    'http://example.com',
    'HTTPS://EXAMPLE.COM/UPPER',
    'mailto:sales@example.com',
    'mailto:sales@example.com?subject=Demo',
    '/pricing',
    '/pricing?plan=starter#faq',
  ])('keeps %s', (href) => {
    expect(sanitizeChatHref(href)).toBe(href);
  });

  it.each([
    ['javascript:alert(1)'],
    ['JaVaScRiPt:alert(1)'],
    ['  javascript:alert(1)'],
    ['java\tscript:alert(1)'],
    ['java\nscript:alert(1)'],
    ['\u0000javascript:alert(1)'],
    ['data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
    ['vbscript:msgbox(1)'],
    ['file:///etc/passwd'],
    ['ftp://example.com/file'],
    ['//evil.example/phish'],
    ['/\\evil.example/phish'],
    ['pricing'],
    ['https://'],
    [''],
    ['   '],
  ])('refuses %j', (href) => {
    expect(sanitizeChatHref(href)).toBeNull();
  });
});

describe('renderChatMarkdown', () => {
  it('renders **bold** as <strong> and leaves no literal asterisks', () => {
    const html = render('• **Starter** — $149/mo\n• **Growth** — $399/mo');
    expect(html).toContain('<strong>Starter</strong>');
    expect(html).toContain('<strong>Growth</strong>');
    expect(html).not.toContain('**');
  });

  it('renders [label](url) as a link that opens safely', () => {
    const html = render('See [Pricing](/pricing) or [our deck](https://example.com/deck?product=eco).');
    expect(hrefsIn(html)).toEqual(['/pricing', 'https://example.com/deck?product=eco']);
    expect(html).toContain('>Pricing</a>');
    expect(html).toContain('>our deck</a>');
    expect(html).not.toContain('](');
    // Every anchor drops the opener and the referrer.
    const anchors = html.match(/<a\b[^>]*>/g) ?? [];
    expect(anchors).toHaveLength(2);
    for (const anchor of anchors) {
      expect(anchor).toContain('rel="noopener noreferrer"');
      expect(anchor).toContain('target="_blank"');
    }
  });

  it('does not force a new tab for mailto links', () => {
    const html = render('[Email us](mailto:sales@example.com)');
    expect(hrefsIn(html)).toEqual(['mailto:sales@example.com']);
    expect(html).not.toContain('target=');
  });

  it('keeps a URL that itself contains parentheses in one piece', () => {
    const html = render('[Wiki](https://en.wikipedia.org/wiki/Carbon_(disambiguation)) done');
    expect(hrefsIn(html)).toEqual(['https://en.wikipedia.org/wiki/Carbon_(disambiguation)']);
    expect(html).toContain('> done');
  });

  it.each([
    ['javascript:alert(1)'],
    ['JAVASCRIPT:alert(document.cookie)'],
    ['java\tscript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['vbscript:msgbox(1)'],
    ['//evil.example'],
  ])('neutralises the dangerous link target %j', (target) => {
    const html = render(`[click me](${target})`);
    expect(html).not.toContain('<a');
    expect(html).not.toContain('href=');
    expect(html.toLowerCase()).not.toContain('javascript:');
    // The visitor still sees the label.
    expect(html).toContain('click me');
  });

  it('escapes HTML instead of injecting it', () => {
    const html = render('<script>alert(1)</script> <img src=x onerror=alert(1)> **<b>x</b>** [<i>y</i>](/z)');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<i>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
  });

  it('never lets a URL break out of its href attribute', () => {
    const html = render('[x](https://example.com/?q="onmouseover=alert(1))');
    // The quote is escaped inside the value, so no second attribute can start:
    // the anchor carries exactly href, target, rel and class.
    expect(html).toContain('&quot;onmouseover=alert(1)');
    const anchor = html.match(/<a\b[^>]*>/)?.[0] ?? '';
    const attributeNames = [...anchor.matchAll(/\s([a-z-]+)="/g)].map((match) => match[1]);
    expect(attributeNames).toEqual(['href', 'target', 'rel', 'class']);
  });

  it('keeps newlines for the caller\'s pre-wrap and leaves unmatched markers alone', () => {
    const html = render('line one\nline two **unclosed');
    expect(html).toContain('line one\nline two **unclosed');
    expect(html).not.toContain('<strong>');
  });
});

describe('rateLimitMessage', () => {
  it.each([
    [600, 'about 10 minutes'],
    [61, 'about 2 minutes'],
    [60, 'about 1 minute.'],
    [45, 'about 45 seconds'],
    [1, 'about 1 second.'],
    ['30', 'about 30 seconds'],
  ])('turns retryAfter=%j into a wait the visitor can act on', (retryAfter, expected) => {
    expect(rateLimitMessage(retryAfter)).toContain(expected);
  });

  it.each([[undefined], [null], [0], [-5], [Number.NaN], ['soon']])(
    'falls back to a generic wait for %j, still without digits or the raw error',
    (retryAfter) => {
      const message = rateLimitMessage(retryAfter);
      expect(message).toMatch(/try again/i);
      expect(message).not.toMatch(/\d/);
    },
  );

  it('never surfaces the raw server string', () => {
    expect(rateLimitMessage(600)).not.toMatch(/too many requests/i);
  });
});

describe('plainQuickReply', () => {
  it.each([
    ['💰 Pricing', 'Pricing'],
    ['📅 Book a Demo', 'Book a Demo'],
    ['🚀 How it works', 'How it works'],
    ['📞 Contact Sales', 'Contact Sales'],
    ['Pricing', 'Pricing'],
    ['✅ Done', 'Done'],
  ])('%j -> %j', (label, expected) => {
    expect(plainQuickReply(label)).toBe(expected);
  });

  it('returns an empty label for an emoji-only reply so the caller can drop it', () => {
    expect(plainQuickReply('👍')).toBe('');
  });
});
