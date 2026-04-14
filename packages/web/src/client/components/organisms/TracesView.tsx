import { useState } from 'react';
import { useTraces, useTraceDetail } from '../../hooks/useTraces';
import { PIPELINE_COLORS, SPAN_KIND_COLORS } from '../../lib/designTokens';
import { formatDuration, formatTimestamp, safeJsonPreview, safePrettyJson } from '../../lib/format';
import type { Span } from '../../lib/traceTypes';

function Badge({ label, className = '' }: { label: string; className?: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

function SpanRow({ span, depth }: { span: Span; depth: number }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = span.input || span.output || span.error;
  const indent = depth * 20;

  return (
    <>
      <tr
        className={`hover:bg-slate-800/50 ${hasDetail ? 'cursor-pointer' : ''}`}
        onClick={() => hasDetail && setExpanded(!expanded)}
      >
        <td className="px-4 py-2" style={{ paddingLeft: `${16 + indent}px` }}>
          <div className="flex items-center gap-2">
            {hasDetail && (
              <span className="text-xs text-slate-500">{expanded ? '\u25BC' : '\u25B6'}</span>
            )}
            <span className="text-sm text-slate-200">{span.name}</span>
          </div>
        </td>
        <td className="px-4 py-2">
          <Badge
            label={span.kind.replace(/_/g, ' ')}
            className={SPAN_KIND_COLORS[span.kind] || 'bg-slate-600/30 text-slate-400'}
          />
        </td>
        <td className="px-4 py-2 text-right font-mono text-sm text-slate-400">
          {formatDuration(span.duration_ms)}
        </td>
        <td className="px-4 py-2">
          {span.error ? (
            <span className="text-xs text-red-400 truncate block max-w-xs">
              {span.error.slice(0, 60)}
            </span>
          ) : (
            <span className="text-xs text-slate-500 truncate block max-w-xs">
              {safeJsonPreview(span.output, 80)}
            </span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={4} className="bg-slate-900/50 px-4 py-3">
            <div className="space-y-2 text-xs" style={{ marginLeft: `${16 + indent}px` }}>
              {span.error && (
                <div>
                  <span className="font-semibold text-red-400">Error: </span>
                  <span className="text-slate-300">{span.error}</span>
                </div>
              )}
              {span.input && (
                <div>
                  <span className="font-semibold text-slate-500">Input: </span>
                  <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-800 p-2 font-mono text-slate-300">
                    {safePrettyJson(span.input)}
                  </pre>
                </div>
              )}
              {span.output && (
                <div>
                  <span className="font-semibold text-slate-500">Output: </span>
                  <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-800 p-2 font-mono text-slate-300">
                    {safePrettyJson(span.output)}
                  </pre>
                </div>
              )}
              {span.usage && (
                <div className="text-slate-500">
                  Tokens: {span.usage.input_tokens} in / {span.usage.output_tokens} out
                  {span.usage.cost != null && ` ($${span.usage.cost.toFixed(4)})`}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function TraceDetail({ traceId }: { traceId: string }) {
  const { spans, isLoading } = useTraceDetail(traceId);

  if (isLoading) return <div className="py-4 text-sm text-slate-500">Loading spans...</div>;
  if (spans.length === 0) return <div className="py-4 text-sm text-slate-500">No spans found</div>;

  // Build depth map from parent_id chain.
  // Spans arrive sorted by started_at ASC from SQLiteTracer, so parents always precede children.
  const depthMap = new Map<string, number>();
  for (const span of spans) {
    if (!span.parent_id) {
      depthMap.set(span.id, 0);
    } else {
      depthMap.set(span.id, (depthMap.get(span.parent_id) ?? 0) + 1);
    }
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-700">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-700 bg-slate-800 text-xs text-slate-500">
          <tr>
            <th className="px-4 py-2 text-left">Step</th>
            <th className="px-4 py-2 text-left">Kind</th>
            <th className="px-4 py-2 text-right">Duration</th>
            <th className="px-4 py-2 text-left">Result</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700/50">
          {spans.map(span => (
            <SpanRow key={span.id} span={span} depth={depthMap.get(span.id) ?? 0} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TracesView({ highlightTraceId }: { highlightTraceId?: string | null }) {
  const { traces, isLoading, loadMore, loadingMore, hasMore } = useTraces();
  const [expandedTrace, setExpandedTrace] = useState<string | null>(highlightTraceId ?? null);

  if (isLoading) {
    return <div className="text-sm text-slate-500">Loading traces...</div>;
  }

  return (
    <div className="space-y-3">
      {traces.length === 0 ? (
        <div className="bg-slate-800 rounded-lg p-8 text-center text-slate-500">
          No traces yet. Pipeline traces will appear here after running queries or ingests.
        </div>
      ) : (
        <>
          {traces.map(t => (
            <div key={t.trace_id}>
              <div
                className={`flex cursor-pointer flex-wrap items-center gap-2 rounded-lg border p-3 transition-colors sm:gap-3 sm:p-4 ${
                  expandedTrace === t.trace_id
                    ? 'border-sky-500/50 bg-slate-800'
                    : 'border-slate-700 bg-slate-800/50 hover:bg-slate-800'
                }`}
                onClick={() =>
                  setExpandedTrace(expandedTrace === t.trace_id ? null : t.trace_id)
                }
              >
                <span className="text-xs text-slate-500">
                  {expandedTrace === t.trace_id ? '\u25BC' : '\u25B6'}
                </span>
                <Badge
                  label={t.name}
                  className={PIPELINE_COLORS[t.name] || 'bg-slate-600/30 text-slate-400'}
                />
                <span className="font-mono text-sm text-slate-300">
                  {formatDuration(t.duration_ms)}
                </span>
                <span className="text-xs text-slate-500">
                  {t.step_count} step{t.step_count !== 1 ? 's' : ''}
                </span>
                {t.error_count > 0 && (
                  <Badge
                    label={`${t.error_count} error${t.error_count !== 1 ? 's' : ''}`}
                    className="bg-red-500/20 text-red-400"
                  />
                )}
                {t.error && (
                  <span className="max-w-xs truncate text-xs text-red-400">{t.error}</span>
                )}
                <span className="ml-auto text-xs text-slate-500">
                  {formatTimestamp(t.started_at)}
                </span>
              </div>
              {expandedTrace === t.trace_id && (
                <div className="mt-2 sm:ml-6">
                  <TraceDetail traceId={t.trace_id} />
                </div>
              )}
            </div>
          ))}
          {hasMore && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="w-full rounded-lg border border-slate-700 bg-slate-800/50 py-3 text-sm text-slate-400 transition-colors hover:bg-slate-800 disabled:opacity-50"
            >
              {loadingMore ? 'Loading...' : 'Load more'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
