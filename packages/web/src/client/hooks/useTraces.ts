import { useState, useCallback } from 'react';
import useSWR from 'swr';
import type { TracesResponse, TraceDetailResponse, TraceGroup } from '../lib/traceTypes';

const fetcher = (url: string) =>
  fetch(url).then(r => {
    if (!r.ok) throw new Error(`Fetch failed: ${r.status}`);
    return r.json();
  });

export function useTraces(pageSize = 50) {
  const [allTraces, setAllTraces] = useState<TraceGroup[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const { data, error, isLoading } = useSWR<TracesResponse>(
    `/rag/traces?limit=${pageSize}`,
    fetcher,
    {
      refreshInterval: 10000,
      revalidateOnFocus: false,
      onSuccess: (data) => {
        setAllTraces(data.traces);
        setCursor(data.next_cursor);
        setHasMore(data.traces.length >= pageSize);
      },
    },
  );

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ limit: pageSize.toString(), before: cursor });
      const resp = await fetch(`/rag/traces?${params}`);
      if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
      const more: TracesResponse = await resp.json();
      setAllTraces(prev => [...prev, ...more.traces]);
      setCursor(more.next_cursor);
      setHasMore(more.traces.length >= pageSize);
    } catch (err) {
      console.error('Failed to load more traces:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, pageSize]);

  return {
    traces: allTraces.length > 0 ? allTraces : (data?.traces ?? []),
    isLoading,
    error,
    loadMore,
    loadingMore,
    hasMore,
  };
}

export function useTraceDetail(traceId: string | null) {
  const { data, error, isLoading } = useSWR<TraceDetailResponse>(
    traceId ? `/rag/traces/${traceId}` : null,
    fetcher,
    { revalidateOnFocus: false },
  );

  return {
    spans: data?.spans ?? [],
    isLoading,
    error,
  };
}
