import { NextResponse } from 'next/server';
import { DEMO_WORKSPACE_ID } from '@/domain/contracts';
import { approveProposalFromHuman } from '@/server/challenge-service';
import { ChallengeError } from '@/server/errors';
import { challengeErrorResponse } from '@/server/http';
import { approveProposalInputSchema } from '@/server/schemas';
import { attachChallengeState, challengeSessionDiagnostic, readChallengeSession } from '@/server/state-cookie.server';

export async function POST(request: Request, context: { params: Promise<{ proposalId: string }> }) {
  let state;
  try {
    const session = readChallengeSession(request);
    state = session.state;
    if (request.headers.get('x-listingpilot-human-action') !== 'review-ui') {
      throw new ChallengeError('FORBIDDEN', 'Approval is available only from the visible human review interface.', 403);
    }
    const params = await context.params;
    const body = await request.json();
    const input = approveProposalInputSchema.parse({ ...body, proposalId: params.proposalId });
    const proposal = approveProposalFromHuman(state, DEMO_WORKSPACE_ID, input.proposalId);
    return attachChallengeState(NextResponse.json({ proposal, diagnostic: challengeSessionDiagnostic(session, input.proposalId) }), state);
  } catch (error) {
    return challengeErrorResponse(error, state);
  }
}
