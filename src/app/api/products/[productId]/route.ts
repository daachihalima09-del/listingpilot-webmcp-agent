import { NextResponse } from 'next/server';
import { DEMO_WORKSPACE_ID } from '@/domain/contracts';
import { inspectProduct } from '@/server/challenge-service';
import { challengeErrorResponse } from '@/server/http';
import { inspectProductInputSchema } from '@/server/schemas';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ productId: string }> }) {
  try {
    const input = inspectProductInputSchema.parse(await context.params);
    return NextResponse.json({ inspection: inspectProduct(DEMO_WORKSPACE_ID, input.productId) });
  } catch (error) {
    return challengeErrorResponse(error);
  }
}
