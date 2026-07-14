import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export interface GovernanceReviewer {
  id: string;
  displayName: string;
}

/**
 * 'unavailable' means this deployment has no GOVERNANCE_REVIEWER_* configured
 * (the server doesn't mount the auth routes at all); the app behaves exactly
 * as it did before Phase 2, with no lock screen.
 */
export type GovernanceStatus = 'checking' | 'unavailable' | 'locked' | 'unlocking' | 'unlocked';

interface GovernanceAuthContextValue {
  status: GovernanceStatus;
  reviewer: GovernanceReviewer | null;
  expiresAt: string | null;
  error: string | null;
  unlock: (secret: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Fetch wrapper for future governance mutations: attaches the in-memory CSRF token and treats a 401 as session loss. */
  governanceFetch: (input: string, init?: RequestInit) => Promise<Response>;
}

const GovernanceAuthContext = createContext<GovernanceAuthContextValue | null>(null);

const AUTH_BASE = '/api/governance/auth';
const CSRF_HEADER = 'X-Algerknown-CSRF';

function isJsonResponse(res: Response): boolean {
  return (res.headers.get('content-type') ?? '').toLowerCase().includes('application/json');
}

export function GovernanceAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<GovernanceStatus>('checking');
  const [reviewer, setReviewer] = useState<GovernanceReviewer | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Kept only in memory, never persisted (localStorage/sessionStorage), and
  // never read from the HttpOnly session cookie.
  const [csrfToken, setCsrfToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function checkSession() {
      try {
        const res = await fetch(`${AUTH_BASE}/session`, { credentials: 'same-origin' });
        if (cancelled) return;
        if (!isJsonResponse(res)) {
          setStatus('unavailable');
          return;
        }
        if (res.ok) {
          const data = await res.json();
          setReviewer(data.reviewer);
          setExpiresAt(data.expiresAt);
          setCsrfToken(data.csrfToken);
          setStatus('unlocked');
        } else {
          setStatus('locked');
        }
      } catch {
        if (!cancelled) setStatus('unavailable');
      }
    }
    checkSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const unlock = useCallback(async (secret: string) => {
    setStatus('unlocking');
    setError(null);
    try {
      const res = await fetch(`${AUTH_BASE}/unlock`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret }),
      });
      if (!res.ok) {
        setStatus('locked');
        setError(res.status === 429 ? 'Too many attempts. Try again in a minute.' : 'Incorrect secret.');
        return;
      }
      const data = await res.json();
      setReviewer(data.reviewer);
      setExpiresAt(data.expiresAt);
      setCsrfToken(data.csrfToken);
      setStatus('unlocked');
    } catch {
      setStatus('locked');
      setError('Could not reach the server.');
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch(`${AUTH_BASE}/logout`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { [CSRF_HEADER]: csrfToken } : {}),
        },
        body: JSON.stringify({}),
      });
    } finally {
      setReviewer(null);
      setExpiresAt(null);
      setCsrfToken(null);
      setError(null);
      setStatus('locked');
    }
  }, [csrfToken]);

  const governanceFetch = useCallback(
    async (input: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set('Content-Type', 'application/json');
      if (csrfToken) headers.set(CSRF_HEADER, csrfToken);
      const res = await fetch(input, { ...init, credentials: 'same-origin', headers });
      if (res.status === 401) {
        setStatus('locked');
        setReviewer(null);
        setCsrfToken(null);
      }
      return res;
    },
    [csrfToken],
  );

  return (
    <GovernanceAuthContext.Provider
      value={{ status, reviewer, expiresAt, error, unlock, logout, governanceFetch }}
    >
      {children}
    </GovernanceAuthContext.Provider>
  );
}

export function useGovernanceAuth(): GovernanceAuthContextValue {
  const ctx = useContext(GovernanceAuthContext);
  if (!ctx) throw new Error('useGovernanceAuth must be used within GovernanceAuthProvider');
  return ctx;
}
