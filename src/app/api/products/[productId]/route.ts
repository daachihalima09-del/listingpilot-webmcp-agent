import { NextResponse } from 'next/server';
import { DEMO_WORKSPACE_ID } from '@/domain/contracts';
import { inspectProduct } from '@/server/challenge-service';
import { challengeErrorResponse } from '@/server/http';
import { inspectProductInputSchema } from '@/server/schemas';
import { attachChallengeState, readChallengeState } from '@/server/state-cookie.server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ productId: string }> }) {
  try {
    const state = readChallengeState(request);
    const input = inspectProductInputSchema.parse(await context.params);
    return attachChallengeState(NextResponse.json({ inspection: inspectProduct(state, DEMO_WORKSPACE_ID, input.productId) }), state);
  } catch (error) {
    return challengeErrorResponse(error);
  }
}
