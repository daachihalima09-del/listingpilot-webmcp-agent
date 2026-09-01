import { NextResponse } from 'next/server';
import { DEMO_WORKSPACE_ID } from '@/domain/contracts';
import { deleteChallengeSession, readChallengeSession } from '@/server/durable-session.server';
import { challengeErrorResponse } from '@/server/http';

export async function POST(request: Request) {
  try {
    const session = await readChallengeSession(request, DEMO_WORKSPACE_ID);
    await deleteChallengeSession(session);
    return NextResponse.json({ reset: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return challengeErrorResponse(error);
  }
}
