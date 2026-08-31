import { NextResponse } from 'next/server';
import { DEMO_WORKSPACE_ID } from '@/domain/contracts';
import { approveProposalFromHuman } from '@/server/challenge-service';
import { ChallengeError } from '@/server/errors';
import { challengeErrorResponse } from '@/server/http';
import { approveProposalInputSchema } from '@/server/schemas';

export async function POST(request: Request, context: { params: Promise<{ proposalId: string }> }) {
  try {
    if (request.headers.get('x-listingpilot-human-action') !== 'review-ui') {
      throw new ChallengeError('FORBIDDEN', 'Approval is available only from the visible human review interface.', 403);
    }
    const params = await context.params;
    const body = await request.json();
    const input = approveProposalInputSchema.parse({ ...body, proposalId: params.proposalId });
    return NextResponse.json({ proposal: approveProposalFromHuman(DEMO_WORKSPACE_ID, input.proposalId) });
  } catch (error) {
    return challengeErrorResponse(error);
  }
}
