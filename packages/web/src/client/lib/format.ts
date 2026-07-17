export function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return '\u2014';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function formatRelativeTime(epochSeconds: number): string {
  const now = Date.now() / 1000;
  const diff = now - epochSeconds;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(epochSeconds * 1000).toLocaleDateString();
}

export function safeJsonPreview(raw: string | null, maxLen = 120): string {
  if (!raw) return '\u2014';
  try {
    const parsed = JSON.parse(raw);
    const s = JSON.stringify(parsed);
    return s.length > maxLen ? s.slice(0, maxLen) + '...' : s;
  } catch {
    return raw.length > maxLen ? raw.slice(0, maxLen) + '...' : raw;
  }
}

export function safePrettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
