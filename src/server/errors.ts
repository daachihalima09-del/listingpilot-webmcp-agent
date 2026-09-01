export type ChallengeErrorCode =
  | 'INVALID_INPUT' | 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID_TRANSITION' | 'HUMAN_APPROVAL_REQUIRED'
  | 'SESSION_STATE_INVALID' | 'SESSION_STATE_CORRUPT' | 'SESSION_STATE_STALE' | 'SESSION_STORE_UNAVAILABLE'
  | 'REDIS_CONFIGURATION_INVALID' | 'REDIS_PERMISSION_DENIED' | 'REDIS_AUTHENTICATION_FAILED'
  | 'REDIS_CONNECTION_FAILED' | 'REDIS_COMMAND_UNSUPPORTED' | 'REDIS_COMMAND_FAILED';

export class ChallengeError extends Error {
  constructor(
    readonly code: ChallengeErrorCode,
    message: string,
    readonly status: number,
    readonly reference?: string,
  ) {
    super(message);
    this.name = 'ChallengeError';
  }
}
