import React, { useState, useRef, useEffect } from 'react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  quickReplies?: string[];
}

interface ChatWidgetProps {
  appId?: string;
  primaryColor?: string;
  position?: 'bottom-right' | 'bottom-left';
  welcomeMessage?: string;
}

const QUICK_REPLIES = ['💰 Pricing', '📅 Book a Demo', '🚀 How it works', '📞 Contact Sales'];

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

export default function ChatWidget({
  primaryColor = '#059669',
  position = 'bottom-right',
  welcomeMessage = "Hi! 👋 I'm your EcoAuditor sales assistant. I can help you with pricing, book a demo, or answer questions about carbon accounting and emissions reporting. What would you like to explore?",
}: ChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [chatState, setChatState] = useState<Record<string, unknown>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Seed welcome message on first open
  const handleOpen = () => {
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

      const data = await response.json();

      if (data.success && data.response) {
        const assistantMessage = createMessage(
          'assistant',
          'assistant',
          data.response,
          data.quickReplies || QUICK_REPLIES,
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
          QUICK_REPLIES,
        );
        setMessages(prev => [...prev, errorMsg]);
      }
    } catch {
      const errorMsg = createMessage(
        'error',
        'assistant',
        'Network error. Please check your connection and try again.',
        QUICK_REPLIES,
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

  return (
    <div style={{ position: 'fixed', ...positionStyle, zIndex: 9999, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Floating button */}
      {!isOpen && (
        <button
          onClick={handleOpen}
          aria-label="Open EcoAuditor chat"
          style={{
            width: '60px',
            height: '60px',
            borderRadius: '50%',
            backgroundColor: primaryColor,
            border: 'none',
            boxShadow: '0 4px 16px rgba(5, 150, 105, 0.4)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'transform 0.2s, box-shadow 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.1)';
            e.currentTarget.style.boxShadow = '0 6px 20px rgba(5, 150, 105, 0.5)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.boxShadow = '0 4px 16px rgba(5, 150, 105, 0.4)';
          }}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="white">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
          </svg>
        </button>
      )}

      {/* Chat window */}
      {isOpen && (
        <div style={{
          // Was a fixed 380px, which overflowed a 375px viewport and pushed the
          // close button off-screen — and covered the cookie banner's buttons.
          width: 'min(380px, calc(100vw - 32px))',
          height: 'min(540px, calc(100dvh - 96px))',
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.2)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: '1px solid #e5e7eb',
        }}>
          {/* Header */}
          <div style={{
            padding: '16px 20px',
            backgroundColor: primaryColor,
            color: 'white',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                backgroundColor: 'rgba(255,255,255,0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <svg width="20" height="20" viewBox="0 0 512 512" fill="white">
                  <path fill="none" stroke="white" strokeWidth="24" strokeLinecap="round" d="M380 310 A150 150 0 0 0 132 310" />
                  <polygon points="115,295 132,270 148,298" fill="white" />
                  <path fill="none" stroke="white" strokeWidth="24" strokeLinecap="round" d="M132 202 A150 150 0 0 0 380 202" />
                  <polygon points="397,217 380,242 364,214" fill="white" />
                  <path fill="#52b788" d="M256 120 C256 120 200 170 200 260 C200 310 225 350 256 380 C287 350 312 310 312 260 C312 170 256 120 256 120Z" />
                  <path fill="#1e3a5f" d="M256 160 C256 160 225 200 225 260 C225 300 240 330 256 350 C272 330 287 300 287 260 C287 200 256 160 256 160Z" />
                  <circle cx="256" cy="430" r="28" fill="#1e3a5f" />
                  <polyline points="242,430 252,440 270,420" fill="none" stroke="white" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>EcoAuditor Sales</h3>
                <p style={{ margin: 0, fontSize: '12px', opacity: 0.9 }}>Online now</p>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              aria-label="Close chat"
              style={{
                background: 'rgba(255,255,255,0.2)',
                border: 'none',
                color: 'white',
                cursor: 'pointer',
                fontSize: '18px',
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
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
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '16px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              backgroundColor: '#f9fafb',
            }}
          >
            {messages.map((msg) => (
              <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div
                  style={{
                    maxWidth: '85%',
                    alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    backgroundColor: msg.role === 'user' ? primaryColor : '#ffffff',
                    color: msg.role === 'user' ? '#ffffff' : '#1f2937',
                    padding: '10px 14px',
                    borderRadius: msg.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                    fontSize: '14px',
                    lineHeight: 1.5,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                    border: msg.role === 'assistant' ? '1px solid #e5e7eb' : 'none',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {msg.content}
                </div>
                {msg.quickReplies && msg.role === 'assistant' && (
                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '8px',
                    alignSelf: 'flex-start',
                    marginTop: '4px',
                  }}>
                    {msg.quickReplies.map((reply) => (
                      <button
                        key={reply}
                        onClick={() => handleQuickReply(reply)}
                        style={{
                          padding: '8px 14px',
                          borderRadius: '18px',
                          border: `1.5px solid ${primaryColor}`,
                          backgroundColor: 'white',
                          color: primaryColor,
                          fontSize: '13px',
                          fontWeight: 500,
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = primaryColor;
                          e.currentTarget.style.color = 'white';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'white';
                          e.currentTarget.style.color = primaryColor;
                        }}
                      >
                        {reply}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div style={{
                maxWidth: '85%',
                alignSelf: 'flex-start',
                backgroundColor: '#ffffff',
                padding: '12px 16px',
                borderRadius: '12px',
                border: '1px solid #e5e7eb',
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
              }}>
                <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                  <div style={{
                    width: '8px', height: '8px', borderRadius: '50%',
                    backgroundColor: primaryColor, opacity: 0.5,
                    animation: 'ecoBounce 1.2s infinite ease-in-out',
                  }}/>
                  <div style={{
                    width: '8px', height: '8px', borderRadius: '50%',
                    backgroundColor: primaryColor, opacity: 0.7,
                    animation: 'ecoBounce 1.2s infinite ease-in-out 0.15s',
                  }}/>
                  <div style={{
                    width: '8px', height: '8px', borderRadius: '50%',
                    backgroundColor: primaryColor, opacity: 0.9,
                    animation: 'ecoBounce 1.2s infinite ease-in-out 0.3s',
                  }}/>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form
            onSubmit={handleSubmit}
            style={{
              padding: '12px 16px',
              borderTop: '1px solid #e5e7eb',
              display: 'flex',
              gap: '10px',
              backgroundColor: '#ffffff',
              flexShrink: 0,
            }}
          >
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={chatState.flow ? 'Type your answer...' : 'Ask about carbon accounting...'}
              disabled={isLoading}
              style={{
                flex: 1,
                padding: '10px 16px',
                borderRadius: '24px',
                border: '1.5px solid #e5e7eb',
                fontSize: '14px',
                outline: 'none',
                transition: 'border-color 0.2s',
                color: '#1f2937',
              }}
              onFocus={(e) => e.target.style.borderColor = primaryColor}
              onBlur={(e) => e.target.style.borderColor = '#e5e7eb'}
            />
            <button
              type="submit"
              disabled={!inputValue.trim() || isLoading}
              aria-label="Send message"
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '50%',
                backgroundColor: !inputValue.trim() || isLoading ? '#9ca3af' : primaryColor,
                border: 'none',
                color: 'white',
                cursor: !inputValue.trim() || isLoading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background-color 0.2s',
                flexShrink: 0,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
              </svg>
            </button>
          </form>
        </div>
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
