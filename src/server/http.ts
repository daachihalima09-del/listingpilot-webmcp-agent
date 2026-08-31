import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { ChallengeError } from './errors';

export function challengeErrorResponse(error: unknown): NextResponse {
  if (error instanceof ZodError) return NextResponse.json({ error: { code: 'INVALID_INPUT', message: 'The request input is invalid.' } }, { status: 400 });
  if (error instanceof ChallengeError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  console.error('Challenge request failed.', error);
  return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.' } }, { status: 500 });
}
