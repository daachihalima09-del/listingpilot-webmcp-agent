export class ChallengeError extends Error {
  constructor(
    readonly code: 'INVALID_INPUT' | 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID_TRANSITION',
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ChallengeError';
  }
}
