import useSWR from 'swr';

export interface JobProgressDetail {
  current_step: number;
  total_steps: number;
  step_name?: string;
}

export interface JobResponse<T = unknown> {
  job_id: string;
  type: string;
  status: 'pending' | 'running' | 'complete' | 'failed';
  progress: string;
  progress_detail: JobProgressDetail | null;
  created_at: number;
  updated_at: number;
  result: T | null;
  error: string | null;
}

const fetcher = (url: string) =>
  fetch(url).then(r => {
    if (!r.ok) throw new Error(`Job fetch failed: ${r.status}`);
    return r.json();
  });

export interface UseJobOptions {
  pollInterval?: number;
}

export function useJob<T = unknown>(
  jobId: string | null,
  options: UseJobOptions = {},
) {
  const { pollInterval = 1000 } = options;

  const { data, error, isLoading } = useSWR<JobResponse<T>>(
    jobId ? `/rag/jobs/${jobId}` : null,
    fetcher,
    {
      refreshInterval: (latestData: JobResponse<T> | undefined) => {
        if (!latestData) return pollInterval;
        if (latestData.status === 'complete' || latestData.status === 'failed') return 0;
        return pollInterval;
      },
      revalidateOnFocus: false,
      dedupingInterval: 500,
    },
  );

  return {
    job: data ?? null,
    error: error ?? null,
    isLoading,
    isPolling: data ? data.status === 'pending' || data.status === 'running' : false,
    isComplete: data?.status === 'complete' || false,
    isFailed: data?.status === 'failed' || false,
    result: (data?.result ?? null) as T | null,
    progress: data?.progress ?? null,
    progressDetail: data?.progress_detail ?? null,
  };
}
