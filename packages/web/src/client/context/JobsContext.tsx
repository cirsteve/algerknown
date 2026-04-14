import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { useJob } from '../hooks/useJob';

export interface TrackedJob {
  jobId: string;
  type: string;
  status: 'pending' | 'running' | 'complete' | 'failed';
  progress: string;
  result: unknown;
  error: string | null;
  trace_id: string | null;
  createdAt: number;
}

interface JobsContextValue {
  trackJob: (jobId: string, type: string) => void;
  dismissJob: (jobId: string) => void;
  jobs: TrackedJob[];
  activeCount: number;
  getJob: (jobId: string) => TrackedJob | undefined;
}

const JobsContext = createContext<JobsContextValue | null>(null);

const SESSION_KEY = 'algerknown-tracked-jobs';

interface TrackedJobEntry {
  jobId: string;
  type: string;
}

function loadTrackedIds(): TrackedJobEntry[] {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveTrackedIds(entries: TrackedJobEntry[]) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(entries));
}

/**
 * Internal component that polls a single job and reports back to context.
 */
function JobPoller({
  jobId,
  type,
  onUpdate,
}: {
  jobId: string;
  type: string;
  onUpdate: (jobId: string, data: TrackedJob) => void;
}) {
  const { job } = useJob(jobId);

  useEffect(() => {
    if (job) {
      onUpdate(jobId, {
        jobId,
        type,
        status: job.status,
        progress: job.progress,
        result: job.result,
        error: job.error,
        trace_id: job.trace_id,
        createdAt: job.created_at,
      });
    }
  }, [job, jobId, type, onUpdate]);

  return null;
}

const AUTO_DISMISS_MS = 120_000; // 2 minutes

export function JobsProvider({ children }: { children: ReactNode }) {
  const [trackedEntries, setTrackedEntries] = useState<TrackedJobEntry[]>(loadTrackedIds);
  const [jobData, setJobData] = useState<Map<string, TrackedJob>>(new Map());

  // Sync tracked IDs to sessionStorage
  useEffect(() => {
    saveTrackedIds(trackedEntries);
  }, [trackedEntries]);

  // Auto-dismiss completed/failed jobs after timeout
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setTrackedEntries(prev => {
        const filtered = prev.filter(entry => {
          const data = jobData.get(entry.jobId);
          if (!data) return true; // keep if no data yet
          if (data.status === 'pending' || data.status === 'running') return true;
          // Keep terminal jobs for AUTO_DISMISS_MS after they finished
          const elapsed = now - (data.createdAt * 1000 + AUTO_DISMISS_MS);
          return elapsed < 0;
        });
        return filtered.length !== prev.length ? filtered : prev;
      });
    }, 10_000);
    return () => clearInterval(interval);
  }, [jobData]);

  const trackJob = useCallback((jobId: string, type: string) => {
    setTrackedEntries(prev => {
      if (prev.some(e => e.jobId === jobId)) return prev;
      return [...prev, { jobId, type }];
    });
  }, []);

  const dismissJob = useCallback((jobId: string) => {
    setTrackedEntries(prev => prev.filter(e => e.jobId !== jobId));
    setJobData(prev => {
      const next = new Map(prev);
      next.delete(jobId);
      return next;
    });
  }, []);

  const handleJobUpdate = useCallback((jobId: string, data: TrackedJob) => {
    setJobData(prev => {
      const existing = prev.get(jobId);
      // Only create new Map if data actually changed
      if (existing && existing.status === data.status && existing.progress === data.progress) {
        return prev;
      }
      const next = new Map(prev);
      next.set(jobId, data);
      return next;
    });
  }, []);

  const jobs = trackedEntries.map(e => jobData.get(e.jobId)).filter(Boolean) as TrackedJob[];
  const activeCount = jobs.filter(j => j.status === 'pending' || j.status === 'running').length;

  const getJob = useCallback(
    (jobId: string) => jobData.get(jobId),
    [jobData],
  );

  return (
    <JobsContext.Provider value={{ trackJob, dismissJob, jobs, activeCount, getJob }}>
      {trackedEntries.map(entry => (
        <JobPoller
          key={entry.jobId}
          jobId={entry.jobId}
          type={entry.type}
          onUpdate={handleJobUpdate}
        />
      ))}
      {children}
    </JobsContext.Provider>
  );
}

export function useJobsContext(): JobsContextValue {
  const ctx = useContext(JobsContext);
  if (!ctx) throw new Error('useJobsContext must be used within JobsProvider');
  return ctx;
}
