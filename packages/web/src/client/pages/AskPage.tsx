import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ragApi, checkRagConnection, type QueryResult } from '../lib/ragApi';
import { useJob } from '../hooks/useJob';
import { useJobsContext } from '../context/JobsContext';
import { ChatLayout, EmptyChatState } from '../components/templates/ChatLayout';
import { MessageBubble, MessageList } from '../components/molecules/MessageBubble';
import { StatusIndicator } from '../components/atoms/StatusIndicator';
import { Button } from '../components/atoms/Button';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
  timestamp: Date;
}

const SUGGESTIONS = [
  'What do I know about nullifiers?',
  'What are my open questions about ZKML?',
  'How does ARC compare to ACT?',
];

export function AskPage() {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [ragConnected, setRagConnected] = useState<boolean | null>(null);
  const [documentsIndexed, setDocumentsIndexed] = useState<number>(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { trackJob } = useJobsContext();

  const { isComplete, isFailed, result, progress, job, error: jobError } = useJob<QueryResult>(currentJobId);

  // Check RAG backend connection on mount
  useEffect(() => {
    checkConnection();
  }, []);

  // Scroll to bottom when new messages arrive or job starts/finishes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentJobId]);

  // Handle job completion or polling errors
  useEffect(() => {
    if (isComplete && result) {
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: result.answer,
        sources: result.sources,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMessage]);
      setCurrentJobId(null);
    }
    if (isFailed && job) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Error: ${job.error || 'Query failed'}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
      setCurrentJobId(null);
    }
  }, [isComplete, isFailed]);

  // Handle polling/network errors (job expired, backend down)
  useEffect(() => {
    if (jobError && currentJobId) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Error: ${jobError.message || 'Lost connection to job'}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
      setCurrentJobId(null);
    }
  }, [jobError]);

  const checkConnection = async () => {
    const connResult = await checkRagConnection();
    setRagConnected(connResult.connected);
    if (connResult.status) {
      setDocumentsIndexed(connResult.status.documents_indexed);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || currentJobId) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: query.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    const queryText = query.trim();
    setQuery('');

    try {
      const response = await ragApi.query(queryText, 5);
      setCurrentJobId(response.job_id);
      trackJob(response.job_id, 'query');
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Failed to submit query'}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    }
  };

  const renderContent = (content: string) => {
    // Parse citations like [entry-id] and make them clickable
    const parts = content.split(/(\[[^\]]+\])/g);
    return parts.map((part, i) => {
      const match = part.match(/^\[([^\]]+)\]$/);
      if (match) {
        const entryId = match[1];
        return (
          <Link
            key={i}
            to={`/entries/${entryId}`}
            className="rounded-sm underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-current"
          >
            [{entryId}]
          </Link>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  const statusLabel =
    ragConnected === null
      ? 'Checking...'
      : ragConnected
        ? `RAG Online (${documentsIndexed} docs)`
        : 'RAG Offline';

  const header = (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <StatusIndicator
        status={ragConnected === null ? 'unknown' : ragConnected ? 'online' : 'offline'}
      />
      <span className="text-sm text-content-muted">{statusLabel}</span>
      {!ragConnected && ragConnected !== null && (
        <Button variant="ghost" size="sm" onClick={checkConnection}>
          Retry
        </Button>
      )}
    </div>
  );

  const messageArea = (
    <MessageList>
      {messages.length === 0 && !currentJobId && (
        <EmptyChatState
          title="Ask a question about your knowledge base"
          suggestions={SUGGESTIONS}
        />
      )}

      {messages.map(message => (
        <MessageBubble
          key={message.id}
          role={message.role}
          content={message.content}
          sources={message.sources}
          renderContent={message.role === 'assistant' ? renderContent : undefined}
        />
      ))}

      {currentJobId && (
        <div className="flex justify-start">
          <div className="rounded-lg border border-edge bg-surface-raised p-4">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 animate-pulse rounded-full bg-accent" />
              <div className="delay-75 h-2 w-2 animate-pulse rounded-full bg-accent" />
              <div className="delay-150 h-2 w-2 animate-pulse rounded-full bg-accent" />
              <span className="ml-2 break-words text-sm text-content-muted">
                {progress || 'Thinking...'}
              </span>
            </div>
          </div>
        </div>
      )}

      <div ref={messagesEndRef} />
    </MessageList>
  );

  /* The composer keeps its <form> so Enter submits natively; only the layout
     changes - the field and the button share a row from `sm` and stack below,
     where a 6rem button beside the field would leave nothing to type in. */
  const input = (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Ask a question..."
        aria-label="Ask a question"
        disabled={!ragConnected || !!currentJobId}
        className="w-full rounded-lg border border-edge bg-surface-raised px-4 py-3 text-content transition-colors placeholder:text-content-subtle hover:border-edge-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-60 sm:flex-1"
      />
      <button
        type="submit"
        disabled={!ragConnected || !query.trim() || !!currentJobId}
        className="rounded-lg bg-accent px-6 py-3 font-medium text-accent-fg transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:bg-control disabled:text-content-subtle sm:shrink-0"
      >
        Ask
      </button>
    </form>
  );

  return (
    <ChatLayout
      title="Ask"
      subtitle="Query your knowledge base with natural language"
      header={header}
      messages={messageArea}
      input={input}
    />
  );
}
