import { NextResponse } from 'next/server';
import { DEMO_WORKSPACE_ID } from '@/domain/contracts';
import { publishApprovedChanges } from '@/server/challenge-service';
import { challengeErrorResponse } from '@/server/http';
import { publishProposalInputSchema } from '@/server/schemas';
import { attachChallengeState, readChallengeState } from '@/server/state-cookie.server';

export async function POST(request: Request, context: { params: Promise<{ proposalId: string }> }) {
  let state;
  try {
    state = readChallengeState(request);
    const params = await context.params;
    const body = await request.json();
    const input = publishProposalInputSchema.parse({ ...body, proposalId: params.proposalId });
    const result = publishApprovedChanges(state, DEMO_WORKSPACE_ID, input.proposalId);
    const proposal = state.proposals.find((item) => item.proposalId === input.proposalId);
    return attachChallengeState(NextResponse.json({ result, proposal }), state);
  } catch (error) {
    return challengeErrorResponse(error, state);
  }
}
