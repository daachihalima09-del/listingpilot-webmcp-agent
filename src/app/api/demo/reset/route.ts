import { NextResponse } from 'next/server';
import { deleteChallengeSessionByRequest } from '@/server/durable-session.server';
import { challengeErrorResponse } from '@/server/http';

export async function POST(request: Request) {
  try {
    await deleteChallengeSessionByRequest(request);
    return NextResponse.json({ reset: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return challengeErrorResponse(error);
  }
}
