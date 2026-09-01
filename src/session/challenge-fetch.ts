import { CHALLENGE_SESSION_HEADER, CHALLENGE_SESSION_STORAGE_KEY, isChallengeSessionToken } from './challenge-session';

function storedSession(): string | null {
  if (typeof window === 'undefined') return null;
  let value: string | null;
  try {
    value = window.localStorage.getItem(CHALLENGE_SESSION_STORAGE_KEY);
  } catch {
    throw new Error('Browser session storage is unavailable. Allow site storage for this challenge and reload.');
  }
  return value && isChallengeSessionToken(value) ? value : null;
}

function persistSession(response: Response): void {
  if (typeof window === 'undefined') return;
  const value = response.headers.get(CHALLENGE_SESSION_HEADER);
  if (value && isChallengeSessionToken(value)) {
    try {
      window.localStorage.setItem(CHALLENGE_SESSION_STORAGE_KEY, value);
    } catch {
      throw new Error('Browser session storage is unavailable. Allow site storage for this challenge and reload.');
    }
  }
}

export async function challengeFetch(fetcher: typeof fetch, input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const session = storedSession();
  if (session) headers.set(CHALLENGE_SESSION_HEADER, session);
  const response = await fetcher(input, { ...init, headers, credentials: 'include', cache: 'no-store' });
  persistSession(response);
  return response;
}

export function clearChallengeSession(): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(CHALLENGE_SESSION_STORAGE_KEY);
    } catch {
      throw new Error('Browser session storage is unavailable. Allow site storage for this challenge and reload.');
    }
  }
}
