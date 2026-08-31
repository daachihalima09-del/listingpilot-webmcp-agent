import type { AuditEvent, ListingProposal } from '@/domain/contracts';

interface ChallengeState {
  proposals: Map<string, ListingProposal>;
  audit: AuditEvent[];
  sequence: number;
}

const globalChallenge = globalThis as typeof globalThis & { __listingPilotChallengeState?: ChallengeState };

function newState(): ChallengeState {
  return { proposals: new Map(), audit: [], sequence: 0 };
}

export function challengeState(): ChallengeState {
  globalChallenge.__listingPilotChallengeState ??= newState();
  return globalChallenge.__listingPilotChallengeState;
}

export function nextChallengeId(prefix: 'proposal' | 'audit'): string {
  const state = challengeState();
  state.sequence += 1;
  return `${prefix}_${state.sequence.toString().padStart(4, '0')}`;
}

export function resetChallengeStateForTests(): void {
  globalChallenge.__listingPilotChallengeState = newState();
}
