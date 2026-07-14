export const SESSION_COOKIE_NAME = 'agn_governance_session';
export const GOVERNANCE_COOKIE_PATH = '/api/governance';

export interface SessionCookieOptions {
  secure: boolean;
  maxAgeSeconds: number;
}

export function buildSessionCookie(sessionToken: string, opts: SessionCookieOptions): string {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${sessionToken}`,
    `Path=${GOVERNANCE_COOKIE_PATH}`,
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${opts.maxAgeSeconds}`,
  ];
  if (opts.secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function buildClearSessionCookie(opts: { secure: boolean }): string {
  const attributes = [
    `${SESSION_COOKIE_NAME}=`,
    `Path=${GOVERNANCE_COOKIE_PATH}`,
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0',
  ];
  if (opts.secure) attributes.push('Secure');
  return attributes.join('; ');
}

/** Extracts the governance session token from a raw Cookie request header. */
export function parseSessionCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex === -1) continue;
    const name = part.slice(0, separatorIndex).trim();
    if (name === SESSION_COOKIE_NAME) {
      return part.slice(separatorIndex + 1).trim();
    }
  }
  return undefined;
}
