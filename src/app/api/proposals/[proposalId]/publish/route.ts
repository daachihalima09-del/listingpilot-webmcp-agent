import { NextResponse } from 'next/server';
import { DEMO_WORKSPACE_ID, type ChallengeSessionDiagnostic } from '@/domain/contracts';
import { publishApprovedChanges } from '@/server/challenge-service';
import { challengeErrorResponse } from '@/server/http';
import { publishProposalInputSchema } from '@/server/schemas';
import { attachChallengeState, challengeSessionDiagnostic, readChallengeSession } from '@/server/state-cookie.server';

export async function POST(request: Request, context: { params: Promise<{ proposalId: string }> }) {
  let state;
  let diagnostic: ChallengeSessionDiagnostic | undefined;
  try {
    const session = readChallengeSession(request);
    state = session.state;
    const params = await context.params;
    const body = await request.json();
    const input = publishProposalInputSchema.parse({ ...body, proposalId: params.proposalId });
    diagnostic = challengeSessionDiagnostic(session, input.proposalId);
    const result = publishApprovedChanges(state, DEMO_WORKSPACE_ID, input.proposalId);
    const proposal = state.proposals.find((item) => item.proposalId === input.proposalId);
    return attachChallengeState(NextResponse.json({ result, proposal, diagnostic: challengeSessionDiagnostic(session, input.proposalId) }), state);
  } catch (error) {
    return challengeErrorResponse(error, state, diagnostic);
  }
}
