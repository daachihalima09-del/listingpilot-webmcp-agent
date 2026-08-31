import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { ChallengeError } from './errors';
import type { ChallengeState } from './store';
import type { ChallengeSessionDiagnostic } from '@/domain/contracts';

export function challengeErrorResponse(error: unknown, state?: ChallengeState, diagnostic?: ChallengeSessionDiagnostic): NextResponse {
  let response: NextResponse;
  if (error instanceof ZodError) response = NextResponse.json({ error: { code: 'INVALID_INPUT', message: 'The request input is invalid.' }, diagnostic }, { status: 400 });
  else if (error instanceof ChallengeError) response = NextResponse.json({ error: { code: error.code, message: error.message }, diagnostic }, { status: error.status });
  else {
    console.error('Challenge request failed.', error);
    response = NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.' }, diagnostic }, { status: 500 });
  }
  // Error responses can be produced from a stale request snapshot. They must
  // never re-sign that snapshot and race a newer successful state transition.
  void state;
  return response;
}
