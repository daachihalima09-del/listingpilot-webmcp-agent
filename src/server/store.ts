import type { AuditEvent, ListingProposal, PublishedProduct } from '@/domain/contracts';

export interface ChallengeState {
  proposals: ListingProposal[];
  publishedProducts: PublishedProduct[];
  audit: AuditEvent[];
  sequence: number;
}

export const MAX_STORED_PROPOSALS = 4;
export const MAX_AUDIT_EVENTS = 12;

export function createChallengeState(): ChallengeState {
  return { proposals: [], publishedProducts: [], audit: [], sequence: 0 };
}

export function cloneChallengeState(state: ChallengeState): ChallengeState {
  return structuredClone(state);
}

export function nextChallengeId(state: ChallengeState, prefix: 'proposal' | 'audit'): string {
  state.sequence += 1;
  return `${prefix}_${state.sequence.toString().padStart(4, '0')}`;
}

export function storeProposal(state: ChallengeState, proposal: ListingProposal): void {
  state.proposals = [proposal, ...state.proposals.filter((item) => item.proposalId !== proposal.proposalId)].slice(0, MAX_STORED_PROPOSALS);
}

export function findStoredProposal(state: ChallengeState, proposalId: string): ListingProposal | undefined {
  return state.proposals.find((proposal) => proposal.proposalId === proposalId);
}
