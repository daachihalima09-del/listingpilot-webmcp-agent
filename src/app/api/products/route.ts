import { NextRequest, NextResponse } from 'next/server';
import { DEMO_WORKSPACE_ID } from '@/domain/contracts';
import { searchProducts } from '@/server/challenge-service';
import { challengeErrorResponse } from '@/server/http';
import { searchProductsInputSchema } from '@/server/schemas';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const input = searchProductsInputSchema.parse({ query: request.nextUrl.searchParams.get('query') ?? undefined });
    return NextResponse.json({ products: searchProducts(DEMO_WORKSPACE_ID, input.query) });
  } catch (error) {
    return challengeErrorResponse(error);
  }
}
