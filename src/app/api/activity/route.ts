import { NextResponse } from 'next/server';
import { DEMO_WORKSPACE_ID } from '@/domain/contracts';
import { recentActivity } from '@/server/challenge-service';
import { latestProposal } from '@/server/challenge-service';
import { challengeErrorResponse } from '@/server/http';
import { challengeSessionDiagnostic, readChallengeSession } from '@/server/state-cookie.server';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  try {
    const session = readChallengeSession(request);
    const state = session.state;
    const proposal = latestProposal(state, DEMO_WORKSPACE_ID);
    return NextResponse.json({ activity: recentActivity(state, DEMO_WORKSPACE_ID), latestProposal: proposal, publishedProducts: state.publishedProducts, diagnostic: challengeSessionDiagnostic(session, proposal?.proposalId) });
  } catch (error) {
    return challengeErrorResponse(error);
  }
}
