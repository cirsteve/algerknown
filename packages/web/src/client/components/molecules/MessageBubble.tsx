import { ReactNode, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';

interface MessageBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
  timestamp?: Date;
  renderContent?: (content: string) => ReactNode;
  className?: string;
}

/**
 * MessageBubble molecule - Chat message display
 */
export function MessageBubble({ 
  role, 
  content, 
  sources,
  timestamp,
  renderContent,
  className = '' 
}: MessageBubbleProps) {
  const isUser = role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} ${className}`}>
      <div
        className={`
          max-w-[80%] rounded-lg px-4 py-3
          ${isUser 
            ? 'bg-sky-600 text-white' 
            : 'bg-slate-800 text-slate-100'
          }
        `}
      >
        <div className="whitespace-pre-wrap text-sm">
          {renderContent ? renderContent(content) : content}
        </div>
        
        {sources && sources.length > 0 && (
          <div className="mt-3 pt-2 border-t border-slate-600">
            <p className="text-xs text-slate-400 mb-1">Sources:</p>
            <div className="flex flex-wrap gap-1">
              {sources.map((source, i) => (
                <Link
                  key={i}
                  to={`/entries/${source}`}
                  className="text-xs text-sky-400 hover:text-sky-300 hover:underline"
                >
                  {source}
                </Link>
              ))}
            </div>
          </div>
        )}
        
        {timestamp && (
          <div className="text-xs opacity-50 mt-2">
            {timestamp.toLocaleTimeString()}
          </div>
        )}
      </div>
    </div>
  );
}

interface MessageListProps {
  children: ReactNode;
  className?: string;
}

/**
 * MessageList molecule - Container for MessageBubble components
 */
export function MessageList({ children, className = '' }: MessageListProps) {
  return (
    <div className={`space-y-4 ${className}`}>
      {children}
    </div>
  );
}

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  loading?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * ChatInput molecule - Input for sending messages
 */
export function ChatInput({ 
  value, 
  onChange, 
  onSubmit, 
  loading = false,
  placeholder = 'Type a message...',
  disabled = false,
  className = '' 
}: ChatInputProps) {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className={`flex gap-3 ${className}`}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled || loading}
        rows={1}
        className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-4 py-3 text-slate-100 resize-none focus:outline-none focus:border-sky-500 disabled:opacity-50"
      />
      <button
        onClick={onSubmit}
        disabled={disabled || loading || !value.trim()}
        className="bg-sky-500 hover:bg-sky-400 disabled:bg-slate-600 disabled:cursor-not-allowed px-6 py-3 rounded-lg font-medium transition-colors"
      >
        {loading ? '...' : 'Send'}
      </button>
    </div>
  );
}
