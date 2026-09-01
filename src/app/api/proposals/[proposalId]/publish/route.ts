import { NextResponse } from 'next/server';
import { DEMO_WORKSPACE_ID, type ChallengeSessionDiagnostic } from '@/domain/contracts';
import { publishApprovedChanges } from '@/server/challenge-service';
import { challengeErrorResponse } from '@/server/http';
import { publishProposalInputSchema } from '@/server/schemas';
import { attachChallengeSession, challengeSessionDiagnostic, commitChallengeSession, readChallengeSession } from '@/server/durable-session.server';

export async function POST(request: Request, context: { params: Promise<{ proposalId: string }> }) {
  let diagnostic: ChallengeSessionDiagnostic | undefined;
  try {
    const session = await readChallengeSession(request, DEMO_WORKSPACE_ID);
    const params = await context.params;
    const body = await request.json();
    const input = publishProposalInputSchema.parse({ ...body, proposalId: params.proposalId });
    diagnostic = challengeSessionDiagnostic(session, input.proposalId);
    const result = publishApprovedChanges(session.state, DEMO_WORKSPACE_ID, input.proposalId);
    const proposal = session.state.proposals.find((item) => item.proposalId === input.proposalId);
    await commitChallengeSession(session, DEMO_WORKSPACE_ID);
    return attachChallengeSession(NextResponse.json({ result, proposal, diagnostic: challengeSessionDiagnostic(session, input.proposalId) }), session);
  } catch (error) {
    return challengeErrorResponse(error, diagnostic);
  }
}
