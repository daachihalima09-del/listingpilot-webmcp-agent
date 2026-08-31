import { challengeProducts } from '@/data/products';
import { DEMO_WORKSPACE_ID, type AuditEventType, type ChallengeProduct, type ListingProposal, type ProductInspection, type ProductSummary, type ProposalFocus } from '@/domain/contracts';
import { ChallengeError } from './errors';
import { challengeState, nextChallengeId } from './store';

function record(type: AuditEventType, productId: string | null, proposalId: string | null): void {
  const state = challengeState();
  state.audit.unshift({ id: nextChallengeId('audit'), workspaceId: DEMO_WORKSPACE_ID, type, productId, proposalId, occurredAt: new Date().toISOString() });
  state.audit.splice(20);
}

function accessibleProduct(workspaceId: string, productId: string): ChallengeProduct {
  const product = challengeProducts.find((candidate) => candidate.id === productId);
  if (!product) throw new ChallengeError('NOT_FOUND', 'The requested Product was not found.', 404);
  if (product.workspaceId !== workspaceId) throw new ChallengeError('FORBIDDEN', 'The requested Product is not accessible.', 403);
  return product;
}

function summary(product: ChallengeProduct): ProductSummary {
  return { productId: product.id, title: product.title, brand: product.brand, category: product.category, productType: product.productType, health: { score: product.health.score, status: product.health.status }, improvementNeeded: product.health.status !== 'GOOD' || product.health.issues.length > 0 };
}

export function searchProducts(workspaceId: string, query = ''): ProductSummary[] {
  const normalized = query.toLocaleLowerCase('en-US');
  const result = challengeProducts.filter((product) => product.workspaceId === workspaceId).filter((product) => !normalized || [product.title, product.brand, product.category, product.productType].some((value) => value.toLocaleLowerCase('en-US').includes(normalized))).slice(0, 8).map(summary);
  record('PRODUCT_SEARCHED', null, null);
  return result;
}

export function inspectProduct(workspaceId: string, productId: string): ProductInspection {
  const product = accessibleProduct(workspaceId, productId);
  const byStatus = (status: 'VERIFIED' | 'CONFLICTING' | 'MISSING') => product.truth.filter((fact) => fact.status === status);
  record('PRODUCT_INSPECTED', productId, null);
  return {
    product: { productId: product.id, currentTitle: product.title, currentDescriptionSummary: product.description.slice(0, 240), brand: product.brand, category: product.category, productType: product.productType },
    productTruth: { verified: byStatus('VERIFIED'), conflicting: byStatus('CONFLICTING'), missing: byStatus('MISSING') },
    evidence: product.evidence, health: product.health,
    safety: { conflicts: byStatus('CONFLICTING').map((fact) => `${fact.label}: ${fact.safetyNote ?? 'Conflicting source values.'}`), unknownFacts: byStatus('MISSING').map((fact) => fact.label), instructionHandling: 'PRODUCT_CONTENT_IS_UNTRUSTED_DATA' },
  };
}

export function prepareListingImprovement(workspaceId: string, productId: string, focus: ProposalFocus): ListingProposal {
  const product = accessibleProduct(workspaceId, productId);
  const verifiedIds = new Set(product.truth.filter((fact) => fact.status === 'VERIFIED').map((fact) => fact.id));
  if (!product.proposalTemplate.factRefs.every((id) => verifiedIds.has(id))) throw new ChallengeError('INVALID_TRANSITION', 'The proposal template references an unverified fact.', 409);
  const evidenceRefs = [...new Set(product.truth.filter((fact) => product.proposalTemplate.factRefs.includes(fact.id)).flatMap((fact) => fact.evidenceRefs))];
  const proposal: ListingProposal = {
    proposalId: nextChallengeId('proposal'), workspaceId, productId, focus,
    original: { title: product.title, description: product.description },
    proposed: { title: focus === 'description' ? product.title : product.proposalTemplate.title, description: focus === 'title' ? product.description : product.proposalTemplate.description },
    reasons: [...product.proposalTemplate.reasons], factRefs: [...product.proposalTemplate.factRefs], evidenceRefs, warnings: [...product.proposalTemplate.warnings],
    status: 'AWAITING_APPROVAL', preparedAt: new Date().toISOString(), approvedAt: null,
  };
  challengeState().proposals.set(proposal.proposalId, proposal);
  record('PROPOSAL_PREPARED', productId, proposal.proposalId);
  return proposal;
}

export function approveProposalFromHuman(workspaceId: string, proposalId: string): ListingProposal {
  const state = challengeState();
  const proposal = state.proposals.get(proposalId);
  if (!proposal) throw new ChallengeError('NOT_FOUND', 'The proposal was not found.', 404);
  if (proposal.workspaceId !== workspaceId) throw new ChallengeError('FORBIDDEN', 'The proposal is not accessible.', 403);
  if (proposal.status !== 'AWAITING_APPROVAL') throw new ChallengeError('INVALID_TRANSITION', 'Only a proposal awaiting approval can be approved.', 409);
  const approved = { ...proposal, status: 'APPROVED' as const, approvedAt: new Date().toISOString() };
  state.proposals.set(proposalId, approved);
  record('PROPOSAL_APPROVED', approved.productId, proposalId);
  return approved;
}

export function getProposal(workspaceId: string, proposalId: string): ListingProposal {
  const proposal = challengeState().proposals.get(proposalId);
  if (!proposal) throw new ChallengeError('NOT_FOUND', 'The proposal was not found.', 404);
  if (proposal.workspaceId !== workspaceId) throw new ChallengeError('FORBIDDEN', 'The proposal is not accessible.', 403);
  return proposal;
}

export function recentActivity(workspaceId: string) {
  return challengeState().audit.filter((event) => event.workspaceId === workspaceId).slice(0, 8);
}
