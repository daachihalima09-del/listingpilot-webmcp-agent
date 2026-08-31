import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { ChallengeError } from './errors';
import { attachChallengeState } from './state-cookie.server';
import type { ChallengeState } from './store';

export function challengeErrorResponse(error: unknown, state?: ChallengeState): NextResponse {
  let response: NextResponse;
  if (error instanceof ZodError) response = NextResponse.json({ error: { code: 'INVALID_INPUT', message: 'The request input is invalid.' } }, { status: 400 });
  else if (error instanceof ChallengeError) response = NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  else {
    console.error('Challenge request failed.', error);
    response = NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.' } }, { status: 500 });
  }
  return state ? attachChallengeState(response, state) : response;
}
