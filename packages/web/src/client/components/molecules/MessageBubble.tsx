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

  /*
   * The user bubble sits on the accent fill, so its divider and inline links
   * are derived from the accent foreground rather than the surface tokens.
   */
  const bubbleStyles = isUser
    ? 'bg-accent text-accent-fg'
    : 'bg-surface-raised text-content border border-edge';
  const dividerStyles = isUser ? 'border-accent-fg/30' : 'border-edge';
  const sourceLabelStyles = isUser ? 'text-accent-fg/80' : 'text-content-muted';
  const sourceLinkStyles = isUser
    ? 'text-accent-fg underline underline-offset-2 hover:opacity-80 focus-visible:ring-accent-fg'
    : 'text-link hover:text-link-hover hover:underline focus-visible:ring-accent';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} ${className}`}>
      <div className={`max-w-[80%] rounded-lg px-4 py-3 ${bubbleStyles}`}>
        <div className="whitespace-pre-wrap text-sm">
          {renderContent ? renderContent(content) : content}
        </div>
        
        {sources && sources.length > 0 && (
          <div className={`mt-3 pt-2 border-t ${dividerStyles}`}>
            <p className={`text-xs mb-1 ${sourceLabelStyles}`}>Sources:</p>
            <div className="flex flex-wrap gap-1">
              {sources.map((source, i) => (
                <Link
                  key={i}
                  to={`/entries/${source}`}
                  className={`rounded-sm text-xs transition-colors focus:outline-none focus-visible:ring-2 ${sourceLinkStyles}`}
                >
                  {source}
                </Link>
              ))}
            </div>
          </div>
        )}
        
        {timestamp && (
          <div className="text-xs opacity-70 mt-2">
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
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
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
        className="flex-1 rounded-lg border border-edge bg-surface-raised px-4 py-3 text-content placeholder:text-content-subtle resize-none transition-colors hover:border-edge-strong focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-surface-muted"
      />
      <button
        onClick={onSubmit}
        disabled={disabled || loading || !value.trim()}
        className="bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent-hover disabled:bg-control disabled:text-content-subtle disabled:cursor-not-allowed px-6 py-3 rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        {loading ? '...' : 'Send'}
      </button>
    </div>
  );
}
