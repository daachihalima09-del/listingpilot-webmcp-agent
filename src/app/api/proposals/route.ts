import { NextResponse } from 'next/server';
import { DEMO_WORKSPACE_ID } from '@/domain/contracts';
import { prepareListingImprovement } from '@/server/challenge-service';
import { challengeErrorResponse } from '@/server/http';
import { prepareProposalInputSchema } from '@/server/schemas';

export async function POST(request: Request) {
  try {
    const input = prepareProposalInputSchema.parse(await request.json());
    const proposal = prepareListingImprovement(DEMO_WORKSPACE_ID, input.productId, input.focus);
    return NextResponse.json({ proposal }, { status: 201 });
  } catch (error) {
    return challengeErrorResponse(error);
  }
}
