import { NextResponse } from 'next/server';
import { DEMO_WORKSPACE_ID } from '@/domain/contracts';
import { prepareListingImprovement } from '@/server/challenge-service';
import { challengeErrorResponse } from '@/server/http';
import { prepareProposalInputSchema } from '@/server/schemas';
import { attachChallengeState, challengeSessionDiagnostic, readChallengeSession } from '@/server/state-cookie.server';

export async function POST(request: Request) {
  try {
    const session = readChallengeSession(request);
    const state = session.state;
    const input = prepareProposalInputSchema.parse(await request.json());
    const proposal = prepareListingImprovement(state, DEMO_WORKSPACE_ID, input.productId, input.focus);
    return attachChallengeState(NextResponse.json({ proposal, diagnostic: challengeSessionDiagnostic(session, proposal.proposalId) }, { status: 201 }), state);
  } catch (error) {
    return challengeErrorResponse(error);
  }
}
