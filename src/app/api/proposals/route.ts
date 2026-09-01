import { NextResponse } from 'next/server';
import { DEMO_WORKSPACE_ID } from '@/domain/contracts';
import { prepareListingImprovement } from '@/server/challenge-service';
import { challengeErrorResponse } from '@/server/http';
import { prepareProposalInputSchema } from '@/server/schemas';
import { attachChallengeSession, challengeSessionDiagnostic, commitChallengeSession, readChallengeSession } from '@/server/durable-session.server';

export async function POST(request: Request) {
  try {
    const session = await readChallengeSession(request, DEMO_WORKSPACE_ID);
    const state = session.state;
    const input = prepareProposalInputSchema.parse(await request.json());
    const proposal = prepareListingImprovement(state, DEMO_WORKSPACE_ID, input.productId, input.focus);
    await commitChallengeSession(session, DEMO_WORKSPACE_ID);
    return attachChallengeSession(NextResponse.json({ proposal, diagnostic: challengeSessionDiagnostic(session, proposal.proposalId) }, { status: 201 }), session);
  } catch (error) {
    return challengeErrorResponse(error);
  }
}
