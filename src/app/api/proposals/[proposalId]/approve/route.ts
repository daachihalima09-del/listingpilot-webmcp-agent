import { NextResponse } from 'next/server';
import { DEMO_WORKSPACE_ID } from '@/domain/contracts';
import { approveProposalFromHuman } from '@/server/challenge-service';
import { ChallengeError } from '@/server/errors';
import { challengeErrorResponse } from '@/server/http';
import { approveProposalInputSchema } from '@/server/schemas';
import { attachChallengeSession, challengeSessionDiagnostic, commitChallengeSession, readChallengeSession } from '@/server/durable-session.server';

export async function POST(request: Request, context: { params: Promise<{ proposalId: string }> }) {
  try {
    const session = await readChallengeSession(request, DEMO_WORKSPACE_ID);
    if (request.headers.get('x-listingpilot-human-action') !== 'review-ui') {
      throw new ChallengeError('FORBIDDEN', 'Approval is available only from the visible human review interface.', 403);
    }
    const params = await context.params;
    const body = await request.json();
    const input = approveProposalInputSchema.parse({ ...body, proposalId: params.proposalId });
    const proposal = approveProposalFromHuman(session.state, DEMO_WORKSPACE_ID, input.proposalId);
    await commitChallengeSession(session, DEMO_WORKSPACE_ID);
    return attachChallengeSession(NextResponse.json({ proposal, diagnostic: challengeSessionDiagnostic(session, input.proposalId) }), session);
  } catch (error) {
    return challengeErrorResponse(error);
  }
}
