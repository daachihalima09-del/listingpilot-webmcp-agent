// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { challengeFetch, clearChallengeSession } from './challenge-fetch';
import { CHALLENGE_SESSION_HEADER, CHALLENGE_SESSION_STORAGE_KEY } from './challenge-session';

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('challenge session transport', () => {
  it('persists the opaque session across independent page requests', async () => {
    const token = `v1.${'a'.repeat(43)}.${'b'.repeat(43)}`;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { headers: { [CHALLENGE_SESSION_HEADER]: token } }))
      .mockResolvedValueOnce(new Response('{}'));
    await challengeFetch(fetcher as typeof fetch, '/api/activity');
    expect(window.localStorage.getItem(CHALLENGE_SESSION_STORAGE_KEY)).toBe(token);
    await challengeFetch(fetcher as typeof fetch, '/api/activity');
    const secondHeaders = fetcher.mock.calls[1][1].headers as Headers;
    expect(secondHeaders.get(CHALLENGE_SESSION_HEADER)).toBe(token);
  });

  it('clears the browser pointer without exposing server state', () => {
    window.localStorage.setItem(CHALLENGE_SESSION_STORAGE_KEY, `v1.${'a'.repeat(43)}.${'b'.repeat(43)}`);
    clearChallengeSession();
    expect(window.localStorage.getItem(CHALLENGE_SESSION_STORAGE_KEY)).toBeNull();
  });

  it('fails visibly when the embedded browser denies session storage', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError'); });
    await expect(challengeFetch(vi.fn() as unknown as typeof fetch, '/api/activity')).rejects.toThrow('Browser session storage is unavailable');
    expect(getItem).toHaveBeenCalledOnce();
  });
});
