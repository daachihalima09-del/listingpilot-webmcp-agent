import { NextResponse } from 'next/server';
import { DEMO_WORKSPACE_ID } from '@/domain/contracts';
import { recentActivity } from '@/server/challenge-service';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ activity: recentActivity(DEMO_WORKSPACE_ID) });
}
