import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ragApi, checkRagConnection } from '../lib/ragApi';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
  timestamp: Date;
}

export function AskPage() {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [ragConnected, setRagConnected] = useState<boolean | null>(null);
  const [documentsIndexed, setDocumentsIndexed] = useState<number>(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Check RAG backend connection on mount
  useEffect(() => {
    checkConnection();
  }, []);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const checkConnection = async () => {
    const result = await checkRagConnection();
    setRagConnected(result.connected);
    if (result.status) {
      setDocumentsIndexed(result.status.documents_indexed);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || loading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: query.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setQuery('');
    setLoading(true);

    try {
      const response = await ragApi.query(query.trim(), 5);
      
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.answer,
        sources: response.sources,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Failed to get response'}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
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
            className="text-sky-400 hover:text-sky-300 hover:underline"
          >
            [{entryId}]
          </Link>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Ask</h1>
          <p className="text-sm text-slate-400 mt-1">
            Query your knowledge base with natural language
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              ragConnected === null
                ? 'bg-yellow-500'
                : ragConnected
                ? 'bg-green-500'
                : 'bg-red-500'
            }`}
          />
          <span className="text-sm text-slate-400">
            {ragConnected === null
              ? 'Checking...'
              : ragConnected
              ? `RAG Online (${documentsIndexed} docs)`
              : 'RAG Offline'}
          </span>
          {!ragConnected && ragConnected !== null && (
            <button
              onClick={checkConnection}
              className="text-sm text-sky-400 hover:text-sky-300"
            >
              Retry
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2">
        {messages.length === 0 && (
          <div className="text-center text-slate-500 mt-8">
            <p className="text-lg mb-2">Ask a question about your knowledge base</p>
            <div className="text-sm space-y-1">
              <p>Try: "What do I know about nullifiers?"</p>
              <p>Try: "What are my open questions about ZKML?"</p>
              <p>Try: "How does ARC compare to ACT?"</p>
            </div>
          </div>
        )}

        {messages.map(message => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg p-4 ${
                message.role === 'user'
                  ? 'bg-sky-600 text-white'
                  : 'bg-slate-800 text-slate-100'
              }`}
            >
              <div className="whitespace-pre-wrap">
                {message.role === 'assistant'
                  ? renderContent(message.content)
                  : message.content}
              </div>
              
              {message.sources && message.sources.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-700">
                  <div className="text-xs text-slate-400 mb-1">Sources:</div>
                  <div className="flex flex-wrap gap-1">
                    {message.sources.map(source => (
                      <Link
                        key={source}
                        to={`/entries/${source}`}
                        className="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded"
                      >
                        {source}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-slate-800 rounded-lg p-4">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-sky-500 rounded-full animate-pulse" />
                <div className="w-2 h-2 bg-sky-500 rounded-full animate-pulse delay-75" />
                <div className="w-2 h-2 bg-sky-500 rounded-full animate-pulse delay-150" />
                <span className="text-slate-400 text-sm ml-2">Thinking...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask a question..."
          disabled={!ragConnected || loading}
          className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!ragConnected || loading || !query.trim()}
          className="bg-sky-500 hover:bg-sky-400 disabled:bg-slate-600 disabled:cursor-not-allowed px-6 py-3 rounded-lg font-medium transition-colors"
        >
          Ask
        </button>
      </form>
    </div>
  );
}
