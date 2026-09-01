import { NextResponse } from 'next/server';
import { DEMO_WORKSPACE_ID } from '@/domain/contracts';
import { inspectProduct } from '@/server/challenge-service';
import { challengeErrorResponse } from '@/server/http';
import { inspectProductInputSchema } from '@/server/schemas';
import { attachChallengeSession, readChallengeSession } from '@/server/durable-session.server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ productId: string }> }) {
  try {
    const session = await readChallengeSession(request, DEMO_WORKSPACE_ID);
    const input = inspectProductInputSchema.parse(await context.params);
    return attachChallengeSession(NextResponse.json({ inspection: inspectProduct(session.state, DEMO_WORKSPACE_ID, input.productId) }), session);
  } catch (error) {
    return challengeErrorResponse(error);
  }
}
