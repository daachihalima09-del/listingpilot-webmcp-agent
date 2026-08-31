import { NextResponse } from 'next/server';
import { DEMO_WORKSPACE_ID } from '@/domain/contracts';
import { recentActivity } from '@/server/challenge-service';
import { latestProposal } from '@/server/challenge-service';
import { challengeErrorResponse } from '@/server/http';
import { readChallengeState } from '@/server/state-cookie.server';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  try {
    const state = readChallengeState(request);
    return NextResponse.json({ activity: recentActivity(state, DEMO_WORKSPACE_ID), latestProposal: latestProposal(state, DEMO_WORKSPACE_ID), publishedProducts: state.publishedProducts });
  } catch (error) {
    return challengeErrorResponse(error);
  }
}
