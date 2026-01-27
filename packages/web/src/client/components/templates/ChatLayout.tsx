import { ReactNode } from 'react';
import { RagStatusPanel } from '../organisms/RagStatusPanel';

interface ChatLayoutProps {
  title: string;
  subtitle?: string;
  header?: ReactNode;
  messages: ReactNode;
  input: ReactNode;
  className?: string;
}

/**
 * ChatLayout template - Layout for chat-based interfaces
 * 
 * Provides a flex layout with:
 * - Header area with status
 * - Scrollable message area
 * - Fixed input area at bottom
 */
export function ChatLayout({
  title,
  subtitle,
  header,
  messages,
  input,
  className = '',
}: ChatLayoutProps) {
  return (
    <div className={`flex flex-col h-[calc(100vh-8rem)] ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">{title}</h1>
          {subtitle && (
            <p className="text-sm text-slate-400 mt-1">{subtitle}</p>
          )}
        </div>
        {header || <RagStatusPanel />}
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto mb-4 pr-2">
        {messages}
      </div>

      {/* Input Area */}
      <div className="flex-shrink-0">
        {input}
      </div>
    </div>
  );
}

interface EmptyChatStateProps {
  title?: string;
  suggestions?: string[];
  className?: string;
}

/**
 * EmptyChatState template - Placeholder for empty chat
 */
export function EmptyChatState({ 
  title = 'Start a conversation',
  suggestions = [],
  className = '' 
}: EmptyChatStateProps) {
  return (
    <div className={`text-center text-slate-500 mt-8 ${className}`}>
      <p className="text-lg mb-2">{title}</p>
      {suggestions.length > 0 && (
        <div className="text-sm space-y-1">
          {suggestions.map((suggestion, i) => (
            <p key={i}>Try: "{suggestion}"</p>
          ))}
        </div>
      )}
    </div>
  );
}
