import { NextRequest, NextResponse } from 'next/server';
import { DEMO_WORKSPACE_ID } from '@/domain/contracts';
import { searchProducts } from '@/server/challenge-service';
import { challengeErrorResponse } from '@/server/http';
import { searchProductsInputSchema } from '@/server/schemas';
import { attachChallengeState, readChallengeState } from '@/server/state-cookie.server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const state = readChallengeState(request);
    const input = searchProductsInputSchema.parse({ query: request.nextUrl.searchParams.get('query') ?? undefined });
    return attachChallengeState(NextResponse.json({ products: searchProducts(state, DEMO_WORKSPACE_ID, input.query) }), state);
  } catch (error) {
    return challengeErrorResponse(error);
  }
}
