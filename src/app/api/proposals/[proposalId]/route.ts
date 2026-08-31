import { NextResponse } from 'next/server';
import { z } from 'zod';
import { DEMO_WORKSPACE_ID } from '@/domain/contracts';
import { getProposal } from '@/server/challenge-service';
import { challengeErrorResponse } from '@/server/http';
import { readChallengeState } from '@/server/state-cookie.server';

const paramsSchema = z.object({ proposalId: z.string().regex(/^proposal_\d{4,}$/) }).strict();

export async function GET(request: Request, context: { params: Promise<{ proposalId: string }> }) {
  try {
    const state = readChallengeState(request);
    const { proposalId } = paramsSchema.parse(await context.params);
    return NextResponse.json({ proposal: getProposal(state, DEMO_WORKSPACE_ID, proposalId) });
  } catch (error) {
    return challengeErrorResponse(error);
  }
}
