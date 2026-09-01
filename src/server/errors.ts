export class ChallengeError extends Error {
  constructor(
    readonly code: 'INVALID_INPUT' | 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID_TRANSITION' | 'HUMAN_APPROVAL_REQUIRED' | 'SESSION_STATE_INVALID' | 'SESSION_STATE_STALE' | 'SESSION_STORE_UNAVAILABLE',
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ChallengeError';
  }
}
