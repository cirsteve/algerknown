import { useState } from 'react';
import { useTraces, useTraceDetail } from '../../hooks/useTraces';
import { PIPELINE_COLORS, SPAN_KIND_COLORS } from '../../lib/designTokens';
import { formatDuration, formatTimestamp, safeJsonPreview, safePrettyJson } from '../../lib/format';
import type { Span } from '../../lib/traceTypes';

/*
 * The span table keeps real columns rather than reflowing to cards - the
 * duration/kind alignment is the point of it - so below `min-w` it scrolls
 * inside its own bordered region and the page stays put. Nesting indent is
 * capped so a deep trace cannot widen that region without limit.
 */
const SPAN_TABLE_MIN_WIDTH = 'min-w-[34rem]';
const MAX_INDENT_DEPTH = 8;

const cell = 'px-3 py-2 sm:px-4';

function Badge({ label, className = '' }: { label: string; className?: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

function SpanRow({ span, depth }: { span: Span; depth: number }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = Boolean(span.input || span.output || span.error);
  const indent = Math.min(depth, MAX_INDENT_DEPTH) * 20;

  const toggle = () => hasDetail && setExpanded(!expanded);

  return (
    <>
      {/*
       * The row stays a row. `<tr>` admits only `role="row"`, so giving it the
       * button role would take the span out of the table for a screen reader;
       * the disclosure lives on a real <button> in the first cell instead, which
       * is what carries the keyboard contract and `aria-expanded`. The row keeps
       * its click handler purely as a larger mouse target.
       */}
      <tr
        className={`transition-colors hover:bg-surface-hover ${hasDetail ? 'cursor-pointer' : ''}`}
        onClick={toggle}
      >
        <td className={cell} style={{ paddingLeft: `${16 + indent}px` }}>
          {hasDetail ? (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={(event) => {
                event.stopPropagation(); // the row would otherwise toggle it back
                setExpanded(!expanded);
              }}
              className="flex items-center gap-2 rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span aria-hidden="true" className="text-xs text-content-subtle">
                {expanded ? '▼' : '▶'}
              </span>
              <span className="text-sm text-content">{span.name}</span>
            </button>
          ) : (
            <span className="text-sm text-content">{span.name}</span>
          )}
        </td>
        <td className={cell}>
          <Badge
            label={span.kind.replace(/_/g, ' ')}
            className={SPAN_KIND_COLORS[span.kind] || 'bg-control text-content-muted'}
          />
        </td>
        <td className={`${cell} text-right font-mono text-sm text-content-muted`}>
          {formatDuration(span.duration_ms)}
        </td>
        <td className={cell}>
          {span.error ? (
            <span className="block max-w-[10rem] truncate text-xs text-red-700 dark:text-red-400 sm:max-w-xs">
              {span.error.slice(0, 60)}
            </span>
          ) : (
            <span className="block max-w-[10rem] truncate text-xs text-content-subtle sm:max-w-xs">
              {safeJsonPreview(span.output, 80)}
            </span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={4} className={`bg-surface-sunken ${cell} py-3`}>
            <div className="space-y-2 text-xs" style={{ marginLeft: `${16 + indent}px` }}>
              {span.error && (
                <div className="break-words">
                  <span className="font-semibold text-red-700 dark:text-red-400">Error: </span>
                  <span className="text-content">{span.error}</span>
                </div>
              )}
              {span.input && (
                <div>
                  <span className="font-semibold text-content-muted">Input: </span>
                  <pre className="mt-1 max-h-40 overflow-auto rounded border border-edge bg-surface-raised p-2 font-mono text-content">
                    {safePrettyJson(span.input)}
                  </pre>
                </div>
              )}
              {span.output && (
                <div>
                  <span className="font-semibold text-content-muted">Output: </span>
                  <pre className="mt-1 max-h-40 overflow-auto rounded border border-edge bg-surface-raised p-2 font-mono text-content">
                    {safePrettyJson(span.output)}
                  </pre>
                </div>
              )}
              {span.usage && (
                <div className="text-content-muted">
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

  if (isLoading) return <div className="py-4 text-sm text-content-muted">Loading spans...</div>;
  if (spans.length === 0) return <div className="py-4 text-sm text-content-muted">No spans found</div>;

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
    <div className="overflow-x-auto rounded-lg border border-edge bg-surface-raised">
      <table className={`w-full ${SPAN_TABLE_MIN_WIDTH} text-sm`}>
        <thead className="border-b border-edge bg-surface-hover text-xs text-content-muted">
          <tr>
            <th className={`${cell} text-left`}>Step</th>
            <th className={`${cell} text-left`}>Kind</th>
            <th className={`${cell} text-right`}>Duration</th>
            <th className={`${cell} text-left`}>Result</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-edge">
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
    return <div className="text-sm text-content-muted">Loading traces...</div>;
  }

  return (
    <div className="min-w-0 space-y-3">
      {traces.length === 0 ? (
        <div className="rounded-lg border border-edge bg-surface-raised p-6 text-center text-content-muted sm:p-8">
          No traces yet. Pipeline traces will appear here after running queries or ingests.
        </div>
      ) : (
        <>
          {traces.map(t => {
            const isExpanded = expandedTrace === t.trace_id;
            return (
              <div key={t.trace_id} className="min-w-0">
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  className={`flex w-full flex-wrap items-center gap-2 rounded-lg border p-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface sm:gap-3 sm:p-4 ${
                    isExpanded
                      ? 'border-accent bg-surface-hover'
                      : 'border-edge bg-surface-raised hover:bg-surface-hover'
                  }`}
                  onClick={() => setExpandedTrace(isExpanded ? null : t.trace_id)}
                >
                  <span aria-hidden="true" className="text-xs text-content-subtle">
                    {isExpanded ? '▼' : '▶'}
                  </span>
                  <Badge
                    label={t.name}
                    className={PIPELINE_COLORS[t.name] || 'bg-control text-content-muted'}
                  />
                  <span className="font-mono text-sm text-content">
                    {formatDuration(t.duration_ms)}
                  </span>
                  <span className="text-xs text-content-subtle">
                    {t.step_count} step{t.step_count !== 1 ? 's' : ''}
                  </span>
                  {t.error_count > 0 && (
                    <Badge
                      label={`${t.error_count} error${t.error_count !== 1 ? 's' : ''}`}
                      className="bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300"
                    />
                  )}
                  {t.error && (
                    <span className="max-w-[10rem] truncate text-xs text-red-700 dark:text-red-400 sm:max-w-xs">
                      {t.error}
                    </span>
                  )}
                  <span className="text-xs text-content-subtle sm:ml-auto">
                    {formatTimestamp(t.started_at)}
                  </span>
                </button>
                {isExpanded && (
                  <div className="mt-2 min-w-0 sm:ml-6">
                    <TraceDetail traceId={t.trace_id} />
                  </div>
                )}
              </div>
            );
          })}
          {hasMore && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="w-full rounded-lg border border-edge bg-surface-raised py-3 text-sm text-content-muted transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50"
            >
              {loadingMore ? 'Loading...' : 'Load more'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
