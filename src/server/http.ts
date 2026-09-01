import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { ChallengeError } from './errors';
import type { ChallengeSessionDiagnostic } from '@/domain/contracts';

export function challengeErrorResponse(error: unknown, diagnostic?: ChallengeSessionDiagnostic): NextResponse {
  let response: NextResponse;
  if (error instanceof ZodError) response = NextResponse.json({ error: { code: 'INVALID_INPUT', message: 'The request input is invalid.' }, diagnostic }, { status: 400 });
  else if (error instanceof ChallengeError) response = NextResponse.json({ error: { code: error.code, message: error.message, reference: error.reference }, diagnostic }, { status: error.status });
  else {
    const reference = randomUUID();
    console.error('Challenge request failed.', { event: 'challenge.request_failed', reference, errorName: error instanceof Error ? error.name : typeof error });
    response = NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.', reference }, diagnostic }, { status: 500 });
  }
  return response;
}
