import { NextResponse } from 'next/server';
import { z } from 'zod';
import { DEMO_WORKSPACE_ID } from '@/domain/contracts';
import { getProposal } from '@/server/challenge-service';
import { challengeErrorResponse } from '@/server/http';
import { attachChallengeSession, challengeSessionDiagnostic, readChallengeSession } from '@/server/durable-session.server';

const paramsSchema = z.object({ proposalId: z.string().regex(/^proposal_\d{4,}$/) }).strict();

export async function GET(request: Request, context: { params: Promise<{ proposalId: string }> }) {
  try {
    const session = await readChallengeSession(request, DEMO_WORKSPACE_ID);
    const { proposalId } = paramsSchema.parse(await context.params);
    return attachChallengeSession(NextResponse.json({ proposal: getProposal(session.state, DEMO_WORKSPACE_ID, proposalId), diagnostic: challengeSessionDiagnostic(session, proposalId) }), session);
  } catch (error) {
    return challengeErrorResponse(error);
  }
}
