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

/*
 * Chat is one of the few places that has to be exactly as tall as the space it
 * is given, so it measures the viewport and subtracts the shell around it: a
 * sticky header plus `p-4` below md, `p-8` alone from md up.
 *
 * `100vh` is wrong on mobile whenever the browser's own chrome is showing - it
 * reports the height as if that chrome were retracted, pushing the input off
 * screen - so `100dvh` takes over where it is supported. `min-h` is the floor
 * for the other direction: on a short landscape viewport the subtraction would
 * otherwise leave a message area too small to read, and scrolling the page a
 * little is the better failure.
 */
const chatHeight = [
  'h-[calc(100vh-5.5rem)] supports-[height:100dvh]:h-[calc(100dvh-5.5rem)]',
  'md:h-[calc(100vh-8rem)] md:supports-[height:100dvh]:h-[calc(100dvh-8rem)]',
  'min-h-[20rem]',
].join(' ');

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
    <div className={`flex min-w-0 flex-col ${chatHeight} ${className}`}>
      {/* Header - stacks under sm, where the title and the status readout
          cannot share a row without truncating one of them */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="break-words text-xl font-bold text-content-strong sm:text-2xl">{title}</h1>
          {subtitle && (
            <p className="mt-1 text-sm text-content-muted">{subtitle}</p>
          )}
        </div>
        <div className="min-w-0 sm:shrink-0">
          {header || <RagStatusPanel />}
        </div>
      </div>

      {/* Messages Area */}
      <div className="mb-4 min-w-0 flex-1 overflow-y-auto overscroll-contain sm:pr-2">
        {messages}
      </div>

      {/* Input Area */}
      <div className="min-w-0 flex-shrink-0">
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
    <div className={`mt-8 px-2 text-center text-content-subtle ${className}`}>
      <p className="mb-2 text-lg">{title}</p>
      {suggestions.length > 0 && (
        <div className="space-y-1 text-sm">
          {suggestions.map((suggestion, i) => (
            <p key={i} className="break-words">Try: "{suggestion}"</p>
          ))}
        </div>
      )}
    </div>
  );
}
