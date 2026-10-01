import React, { useState, useRef, useEffect } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useConsent } from '../lib/consent-context';
import BrandMark from './BrandMark';
import { plainQuickReply, rateLimitMessage, renderChatMarkdown } from './chat/chatText';

/**
 * Dialog shell for the chat panel.
 *
 * The panel was a bare <div>: opening it left focus on the launcher, Tab walked
 * straight out into the page behind, Escape did nothing, and closing dropped
 * focus onto <body> so the next Tab restarted from the top of the document.
 * useFocusTrap handles focus-in, Tab containment, Escape and focus-return; it
 * lives in a separate component because the hook must run unconditionally while
 * the panel itself renders conditionally.
 */
function ChatDialog({
  onClose,
  className,
  style,
  children,
}: {
  onClose: () => void;
  className: string;
  style: React.CSSProperties;
  children: React.ReactNode;
}) {
  const ref = useFocusTrap<HTMLDivElement>(onClose);
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Eco-Auditor chat" className={className} style={style}>
      {children}
    </div>
  );
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  quickReplies?: string[];
}

interface ChatWidgetProps {
  appId?: string;
  position?: 'bottom-right' | 'bottom-left';
  welcomeMessage?: string;
}

const QUICK_REPLIES = ['Pricing', 'Book a Demo', 'How it works', 'Contact Sales'];

// Quick replies belong to the open conversation only. During the demo/contact
// flow the server leaves them out because its next question wants a typed answer,
// and offering the defaults anyway meant a click on "Pricing" was consumed as the
// visitor's name. Trust the server's list when it sends one; otherwise offer the
// defaults only when no flow is running.
function quickRepliesFor(serverReplies: unknown, state: Record<string, unknown> | undefined): string[] | undefined {
  if (Array.isArray(serverReplies)) {
    const labels = serverReplies
      .filter((reply): reply is string => typeof reply === 'string')
      .map(plainQuickReply)
      .filter(Boolean);
    return labels.length > 0 ? labels : undefined;
  }
  return state?.flow ? undefined : QUICK_REPLIES;
}

// Browser-only: read/seed persisted chat session id lazily so SSR never
// touches localStorage. Keeps prerender output stable and avoids the
// "localStorage is not defined" failure under renderToStaticMarkup.
function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') return '';
  const stored = localStorage.getItem('ecochat_session_id');
  if (stored) return stored;
  const id = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  localStorage.setItem('ecochat_session_id', id);
  return id;
}

function createMessage(
  prefix: string,
  role: 'user' | 'assistant',
  content: string,
  quickReplies?: string[],
): Message {
  const base: Message = {
    id: `${prefix}_${Date.now()}`,
    role,
    content,
    timestamp: Date.now(),
  };
  return quickReplies ? { ...base, quickReplies } : base;
}

const BUBBLE = 'max-w-[85%] whitespace-pre-wrap break-words px-3.5 py-2.5 text-sm leading-normal shadow-sm';
const USER_BUBBLE = 'self-end rounded-[12px_12px_4px_12px] bg-brand-600 text-white';
const BOT_BUBBLE =
  'self-start rounded-[12px_12px_12px_4px] border border-surface-200 bg-white text-surface-800 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100';

export default function ChatWidget({
  position = 'bottom-right',
  welcomeMessage = "Hi! I'm the Eco-Auditor sales assistant, an automated chatbot. I can help with pricing, book a demo, or answer common questions about carbon accounting and emissions reporting. What would you like to explore?",
}: ChatWidgetProps) {
  const { consentState } = useConsent();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [chatState, setChatState] = useState<Record<string, unknown>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  // The launcher is unmounted while the panel is open, so useFocusTrap's saved
  // "previously focused" node is gone by the time it tries to restore focus and
  // the browser falls back to <body> — the next Tab then restarts from the top
  // of the document. This re-focuses the launcher once it remounts on close.
  const restoreFocusRef = useRef(false);

  useEffect(() => {
    if (isOpen || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    launcherRef.current?.focus();
  }, [isOpen]);

  // Seed welcome message on first open
  const handleOpen = () => {
    restoreFocusRef.current = true;
    setIsOpen(true);
    if (messages.length === 0) {
      setMessages([createMessage('welcome', 'assistant', welcomeMessage, QUICK_REPLIES)]);
    }
  };

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async (text: string, newState?: Record<string, unknown>) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    const userMessage = createMessage('user', 'user', trimmed);

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    // What an error bubble may offer: the defaults, but never mid-flow.
    const errorReplies = quickRepliesFor(undefined, chatState);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          message: trimmed,
          sessionId: getOrCreateSessionId(),
          state: newState || chatState,
        }),
      });

      // A proxy's 429/5xx page is not JSON; that must not read as "network error".
      const data = await response.json().catch(() => ({}));

      if (response.status === 429) {
        const wait = data.retryAfter ?? response.headers.get('Retry-After');
        setMessages(prev => [...prev, createMessage('error', 'assistant', rateLimitMessage(wait))]);
      } else if (data.success && data.response) {
        const assistantMessage = createMessage(
          'assistant',
          'assistant',
          data.response,
          quickRepliesFor(data.quickReplies, data.state ?? chatState),
        );
        setMessages(prev => [...prev, assistantMessage]);
        if (data.state) {
          setChatState(data.state);
        }
      } else {
        const errorMsg = createMessage(
          'error',
          'assistant',
          data.error || 'Sorry, something went wrong. Please try again.',
          errorReplies,
        );
        setMessages(prev => [...prev, errorMsg]);
      }
    } catch {
      const errorMsg = createMessage(
        'error',
        'assistant',
        'Network error. Please check your connection and try again.',
        errorReplies,
      );
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      clearTimeout(timeoutId);
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await sendMessage(inputValue);
  };

  const handleQuickReply = (reply: string) => {
    sendMessage(reply);
  };

  const positionStyle = position === 'bottom-right'
    ? { right: '20px', bottom: '20px' }
    : { left: '20px', bottom: '20px' };

  if (!consentState.hasConsented) return null;

  return (
    <div style={{ position: 'fixed', ...positionStyle, zIndex: 9999 }}>
      {/* Floating button */}
      {!isOpen && (
        <button
          ref={launcherRef}
          onClick={handleOpen}
          aria-label="Open Eco-Auditor chat"
          className="flex h-[60px] w-[60px] items-center justify-center rounded-full bg-brand-600 shadow-lg shadow-brand-600/40 transition duration-200 hover:scale-110 hover:bg-brand-700"
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="white" aria-hidden="true">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
          </svg>
        </button>
      )}

      {/* Chat window */}
      {isOpen && (
        <ChatDialog
          onClose={() => setIsOpen(false)}
          // Was a fixed 380px, which overflowed a 375px viewport and pushed the
          // close button off-screen — and covered the cookie banner's buttons.
          style={{
            width: 'min(380px, calc(100vw - 32px))',
            height: 'min(540px, calc(100dvh - 96px))',
          }}
          className="flex flex-col overflow-hidden rounded-2xl border border-surface-200 bg-white shadow-2xl dark:border-surface-700 dark:bg-surface-900"
        >
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between bg-brand-600 px-5 py-4 text-white">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white">
                <BrandMark className="h-7 w-7" />
              </div>
              <div>
                <h3 className="text-[15px] font-bold">Eco-Auditor Sales</h3>
                {/* It is a scripted bot, not a person: "Online now" implied staffing. */}
                <p className="text-xs">Automated assistant</p>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              aria-label="Close chat"
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/20 text-lg text-white hover:bg-black/30"
            >
              ×
            </button>
          </div>

          {/* Messages. role="log" + aria-live announces replies as they arrive;
              without it a screen-reader user never hears the bot answer. */}
          <div
            role="log"
            aria-live="polite"
            aria-atomic="false"
            aria-label="Conversation"
            className="flex flex-1 flex-col gap-3 overflow-y-auto bg-surface-50 px-5 py-4 dark:bg-surface-950"
          >
            {messages.map((msg) => (
              <div key={msg.id} className="flex flex-col gap-2">
                <div className={`${BUBBLE} ${msg.role === 'user' ? USER_BUBBLE : BOT_BUBBLE}`}>
                  {msg.role === 'assistant' ? renderChatMarkdown(msg.content) : msg.content}
                </div>
                {msg.quickReplies && msg.role === 'assistant' && (
                  <div className="mt-1 flex flex-wrap gap-2 self-start">
                    {msg.quickReplies.map((reply) => (
                      <button
                        key={reply}
                        onClick={() => handleQuickReply(reply)}
                        className="rounded-full border-[1.5px] border-brand-600 bg-white px-3.5 py-2 text-[13px] font-medium text-brand-700 transition-colors hover:bg-brand-600 hover:text-white dark:border-brand-400 dark:bg-transparent dark:text-brand-300 dark:hover:bg-brand-600 dark:hover:text-white"
                      >
                        {reply}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div
                aria-hidden="true"
                className="flex max-w-[85%] items-center gap-[5px] self-start rounded-xl border border-surface-200 bg-white px-4 py-3 shadow-sm dark:border-surface-700 dark:bg-surface-800"
              >
                {[0, 0.15, 0.3].map((delay, index) => (
                  <div
                    key={delay}
                    className="h-2 w-2 rounded-full bg-brand-600"
                    style={{
                      opacity: 0.5 + index * 0.2,
                      animation: `ecoBounce 1.2s infinite ease-in-out ${delay}s`,
                    }}
                  />
                ))}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form
            onSubmit={handleSubmit}
            className="flex shrink-0 gap-2.5 border-t border-surface-200 bg-white px-4 py-3 dark:border-surface-700 dark:bg-surface-900"
          >
            {/* readOnly, not disabled: a disabled input drops focus to <body> while
                a reply loads, and refocusing it in `finally` runs before React
                re-enables it, so every step of the typed demo/contact flow needed a
                click. A read-only input keeps focus and still ignores keystrokes. */}
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={chatState.flow ? 'Type your answer...' : 'Ask about carbon accounting...'}
              aria-label="Message the Eco-Auditor assistant"
              readOnly={isLoading}
              aria-busy={isLoading}
              className="input min-w-0 flex-1 !rounded-full !border-[1.5px] !px-4 !py-2.5"
            />
            <button
              type="submit"
              disabled={!inputValue.trim() || isLoading}
              aria-label="Send message"
              className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-brand-600 text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
              </svg>
            </button>
          </form>
        </ChatDialog>
      )}

      <style>{`
        @keyframes ecoBounce {
          0%, 100% { transform: scale(0.6); opacity: 0.4; }
          50% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
