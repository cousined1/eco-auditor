import { useState, useRef, useEffect } from 'react';
import { CHAT_MESSAGES, SUGGESTED_PROMPTS } from '../data/mockData';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export default function AIAssistant() {
  const [messages, setMessages] = useState<Message[]>(CHAT_MESSAGES);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    setSendError(null);
    const userMsg: Message = { role: 'user', content: trimmed, timestamp: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    try {
      // TODO: Replace with live insforge.ai.chat() call when backend is wired.
      await new Promise<void>((resolve) => setTimeout(resolve, 1500));

      const defaultResponse =
        `Based on GHG Protocol guidance and your current data profile at Northstar Foods:\n\n` +
        `**Key considerations:**\n` +
        `- Review your organizational and operational boundaries first\n` +
        `- Ensure consistency with your chosen methodology (location-based vs market-based)\n` +
        `- Document all assumptions in your assumption register\n\n` +
        `**Recommended next steps:**\n` +
        `1. Check the Methodology page for your current settings\n` +
        `2. Review the Ledger for any entries with confidence below 75%\n` +
        `3. Prioritize primary data collection for your highest-emission categories\n\n` +
        `Would you like me to walk through any of these in more detail?`;

      const assistantMsg: Message = {
        role: 'assistant',
        content: defaultResponse,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.';
      setSendError(message);
    } finally {
      setIsTyping(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-57px)] max-w-4xl mx-auto">
      <div className="px-6 py-4 border-b border-surface-200 dark:border-surface-800">
        <h1 className="text-xl font-semibold text-surface-900 dark:text-white">AI Carbon Assistant</h1>
        <p className="text-sm text-surface-500 mt-0.5">Powered by GHG Protocol methodology — ask about classification, factors, and compliance</p>
      </div>

      <div
        ref={scrollRef}
        role="log"
        aria-label="AI assistant conversation"
        aria-live="polite"
        className="flex-1 overflow-y-auto px-6 py-4 space-y-4 scrollbar-thin"
      >
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              role="article"
              aria-label={`${msg.role === 'user' ? 'Your message' : 'Assistant response'} at ${new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
              className={`max-w-[80%] rounded-xl px-4 py-3 ${
                msg.role === 'user'
                  ? 'bg-brand-600 text-white rounded-br-sm'
                  : 'bg-surface-100 dark:bg-surface-800 text-surface-800 dark:text-surface-200 rounded-bl-sm'
              }`}
            >
              <div className="text-sm whitespace-pre-wrap leading-relaxed prose prose-sm dark:prose-invert max-w-none [&>strong]:font-semibold [&>strong]:text-current">
                {msg.content.split('\n').map((line, j) => (
                  <span key={j}>
                    {line.startsWith('**') && line.endsWith('**')
                      ? <strong>{line.replace(/\*\*/g, '')}</strong>
                      : line.startsWith('- ')
                        ? <>• {line.slice(2)}</>
                        : line.startsWith('1. ') || line.startsWith('2. ') || line.startsWith('3. ')
                          ? <>{line}</>
                          : line}
                    {j < msg.content.split('\n').length - 1 && <br />}
                  </span>
                ))}
              </div>
              <div className={`text-2xs mt-2 ${msg.role === 'user' ? 'text-brand-200' : 'text-surface-400'}`}>
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}
        {isTyping && (
          <div className="flex justify-start" aria-label="Assistant is typing" aria-live="polite">
            <div className="bg-surface-100 dark:bg-surface-800 rounded-xl rounded-bl-sm px-4 py-3">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-surface-400 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-2 h-2 bg-surface-400 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-2 h-2 bg-surface-400 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="px-6 py-3 border-t border-surface-200 dark:border-surface-800">
        {sendError && (
          <div role="alert" className="mb-3 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
            {sendError}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5 mb-3" role="group" aria-label="Suggested prompts">
          {SUGGESTED_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => { setInput(prompt); inputRef.current?.focus(); }}
              aria-label={`Use suggested prompt: ${prompt}`}
              className="text-xs px-2.5 py-1 rounded-full border border-surface-200 dark:border-surface-700 text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
            >
              {prompt}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <label htmlFor="ai-chat-input" className="sr-only">
            Message the AI Carbon Assistant
          </label>
          <input
            id="ai-chat-input"
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
            placeholder="Ask about carbon accounting, GHG Protocol, or your emissions data..."
            aria-describedby="ai-chat-disclaimer"
            disabled={isTyping}
            className="input flex-1"
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!input.trim() || isTyping}
            aria-label="Send message"
            className="btn-primary px-3"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 16 16" aria-hidden="true"><path d="M14 2L7 9M14 2l-4 12-3-5-5-3 12-4z" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
        <p id="ai-chat-disclaimer" className="text-2xs text-surface-400 mt-2">AI responses reference GHG Protocol methodology. Always verify with your sustainability advisor for compliance decisions.</p>
      </div>
    </div>
  );
}