export const CHALLENGE_SESSION_HEADER = 'x-listingpilot-challenge-session';
export const CHALLENGE_SESSION_STORAGE_KEY = 'listingpilot.challenge.session.v1';
export const CHALLENGE_SESSION_TTL_SECONDS = 60 * 60 * 24;

export function isChallengeSessionToken(value: string): boolean {
  return /^v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(value);
}
