import { NextResponse } from 'next/server';
import { clearChallengeState } from '@/server/state-cookie.server';

export function POST() {
  return clearChallengeState(NextResponse.json({ reset: true }));
}
