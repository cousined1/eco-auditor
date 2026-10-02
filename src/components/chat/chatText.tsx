import type { ReactNode } from 'react';

// Only these schemes may become a link. Everything else (javascript:, data:,
// vbscript:, file: ...) is shown as its label, never as an anchor.
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * Returns `raw` when it is safe to use as an href, otherwise null.
 * Accepts absolute http(s) and mailto URLs and root-relative paths ("/pricing").
 */
export function sanitizeChatHref(raw: string): string | null {
  const href = raw.trim();
  if (!href) return null;

  // Browsers drop tab/CR/LF and leading control characters while parsing a URL,
  // so "java\tscript:alert(1)" still runs. Refuse whitespace and control
  // characters outright instead of trying to normalise them.
  for (const char of href) {
    const code = char.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f) return null;
  }

  if (href.startsWith('/')) {
    // "//host" and "/\host" are protocol-relative URLs, not paths on this site.
    return href.startsWith('//') || href.startsWith('/\\') ? null : href;
  }

  try {
    return SAFE_PROTOCOLS.has(new URL(href).protocol) ? href : null;
  } catch {
    return null;
  }
}

// **bold** and [label](url). The URL group takes no whitespace and allows one
// level of balanced parentheses, so `javascript:alert(1)` is captured whole (and
// then refused) instead of leaving a stray ")" behind, and a legitimate
// `…/Carbon_(disambiguation)` stays in one piece.
const TOKEN = /\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g;

/**
 * Renders the small markdown subset the sales bot's replies use (bold and
 * links) as React elements. Everything else stays plain text, which React
 * escapes, so there is no HTML path and no dangerouslySetInnerHTML. Newlines are
 * kept by the caller's `white-space: pre-wrap`.
 */
export function renderChatMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(TOKEN)) {
    const start = match.index;
    if (start > cursor) nodes.push(text.slice(cursor, start));

    const [, bold, label, url] = match;
    if (bold !== undefined) {
      nodes.push(<strong key={start}>{renderChatMarkdown(bold)}</strong>);
    } else if (label !== undefined) {
      const href = sanitizeChatHref(url ?? '');
      nodes.push(
        href ? (
          <a
            key={start}
            href={href}
            // The chat lives on the landing page; opening links in a new tab keeps
            // the conversation (and the demo flow) where it is.
            target={href.startsWith('mailto:') ? undefined : '_blank'}
            rel="noopener noreferrer"
            className="font-medium text-brand-700 underline underline-offset-2 dark:text-brand-300"
          >
            {label}
          </a>
        ) : (
          label
        ),
      );
    }
    cursor = start + match[0].length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

/**
 * Human wording for an HTTP 429. `retryAfter` is the server's wait in seconds
 * (JSON body field or the Retry-After header); the raw "Too many requests" read
 * like the bot being rude and gave no hint when to try again.
 */
export function rateLimitMessage(retryAfter: unknown): string {
  const lead = "You've sent several messages in a short time.";
  const seconds = Math.ceil(Number(retryAfter));
  if (!Number.isFinite(seconds) || seconds <= 0) return `${lead} Please wait a moment and try again.`;

  const minutes = Math.ceil(seconds / 60);
  const wait =
    seconds < 60
      ? `${seconds} second${seconds === 1 ? '' : 's'}`
      : `${minutes} minute${minutes === 1 ? '' : 's'}`;
  return `${lead} Please try again in about ${wait}.`;
}

/**
 * The server labels its quick replies with a leading emoji ("💰 Pricing"). Emoji
 * are read out as their names by screen readers and clash with the rest of the
 * UI, so the buttons show, and send, the plain label. The bot accepts both forms.
 */
export function plainQuickReply(label: string): string {
  return label.replace(/\p{Extended_Pictographic}️?/gu, '').replace(/\s+/g, ' ').trim();
}
