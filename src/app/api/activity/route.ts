import { NextResponse } from 'next/server';
import { DEMO_WORKSPACE_ID } from '@/domain/contracts';
import { recentActivity } from '@/server/challenge-service';
import { latestProposal } from '@/server/challenge-service';
import { challengeErrorResponse } from '@/server/http';
import { attachChallengeSession, challengeSessionDiagnostic, readChallengeSession } from '@/server/durable-session.server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await readChallengeSession(request, DEMO_WORKSPACE_ID);
    const state = session.state;
    const proposal = latestProposal(state, DEMO_WORKSPACE_ID);
    return attachChallengeSession(NextResponse.json({ activity: recentActivity(state, DEMO_WORKSPACE_ID), latestProposal: proposal, publishedProducts: state.publishedProducts, diagnostic: challengeSessionDiagnostic(session, proposal?.proposalId) }), session);
  } catch (error) {
    return challengeErrorResponse(error);
  }
}
