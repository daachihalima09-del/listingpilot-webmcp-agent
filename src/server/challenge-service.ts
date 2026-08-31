import { createHash } from 'node:crypto';
import { challengeProducts } from '@/data/products';
import { DEMO_WORKSPACE_ID, type AuditEventType, type ChallengeProduct, type ListingProposal, type ProductInspection, type ProductSummary, type ProposalFocus, type PublishedProduct, type PublishResult } from '@/domain/contracts';
import { ChallengeError } from './errors';
import { findStoredProposal, MAX_AUDIT_EVENTS, nextChallengeId, storeProposal, type ChallengeState } from './store';

function record(state: ChallengeState, type: AuditEventType, productId: string | null, proposalId: string | null): void {
  state.audit.unshift({ id: nextChallengeId(state, 'audit'), workspaceId: DEMO_WORKSPACE_ID, type, productId, proposalId, occurredAt: new Date().toISOString() });
  state.audit.splice(MAX_AUDIT_EVENTS);
}

function accessibleProduct(workspaceId: string, productId: string): ChallengeProduct {
  const product = challengeProducts.find((candidate) => candidate.id === productId);
  if (!product) throw new ChallengeError('NOT_FOUND', 'The requested Product was not found.', 404);
  if (product.workspaceId !== workspaceId) throw new ChallengeError('FORBIDDEN', 'The requested Product is not accessible.', 403);
  return product;
}

function currentValues(state: ChallengeState, product: ChallengeProduct): { title: string; description: string } {
  const published = state.publishedProducts.find((item) => item.productId === product.id);
  return published ? { title: published.title, description: published.description } : { title: product.title, description: product.description };
}

function summary(state: ChallengeState, product: ChallengeProduct): ProductSummary {
  const current = currentValues(state, product);
  return { productId: product.id, title: current.title, brand: product.brand, category: product.category, productType: product.productType, health: { score: product.health.score, status: product.health.status }, improvementNeeded: product.health.status !== 'GOOD' || product.health.issues.length > 0 };
}

function proposedValues(product: ChallengeProduct, focus: ProposalFocus, original: ListingProposal['original']): ListingProposal['proposed'] {
  return {
    title: focus === 'description' ? original.title : product.proposalTemplate.title,
    description: focus === 'title' ? original.description : product.proposalTemplate.description,
  };
}

function fingerprintValue(input: Pick<ListingProposal, 'workspaceId' | 'productId' | 'focus' | 'original' | 'proposed' | 'factRefs' | 'evidenceRefs'>): string {
  const canonical = {
    workspaceId: input.workspaceId,
    productId: input.productId,
    focus: input.focus,
    original: input.original,
    proposed: input.proposed,
    factRefs: input.factRefs,
    evidenceRefs: input.evidenceRefs,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function assertProposalIntegrity(state: ChallengeState, proposal: ListingProposal, product: ChallengeProduct): void {
  if (proposal.contentFingerprint !== fingerprintValue(proposal)) throw new ChallengeError('INVALID_TRANSITION', 'The approved proposal content failed its integrity check.', 409);
  const expected = proposedValues(product, proposal.focus, proposal.original);
  if (expected.title !== proposal.proposed.title || expected.description !== proposal.proposed.description) throw new ChallengeError('INVALID_TRANSITION', 'The proposal no longer matches its verified challenge content.', 409);
  const current = currentValues(state, product);
  if (current.title !== proposal.original.title || current.description !== proposal.original.description) throw new ChallengeError('INVALID_TRANSITION', 'The demo Product changed after this proposal was prepared. Prepare a new proposal.', 409);
}

export function searchProducts(state: ChallengeState, workspaceId: string, query = ''): ProductSummary[] {
  const normalized = query.toLocaleLowerCase('en-US');
  const result = challengeProducts.filter((product) => product.workspaceId === workspaceId).filter((product) => !normalized || [currentValues(state, product).title, product.brand, product.category, product.productType].some((value) => value.toLocaleLowerCase('en-US').includes(normalized))).slice(0, 8).map((product) => summary(state, product));
  record(state, 'PRODUCT_SEARCHED', null, null);
  return result;
}

export function inspectProduct(state: ChallengeState, workspaceId: string, productId: string): ProductInspection {
  const product = accessibleProduct(workspaceId, productId);
  const current = currentValues(state, product);
  const byStatus = (status: 'VERIFIED' | 'CONFLICTING' | 'MISSING') => product.truth.filter((fact) => fact.status === status);
  record(state, 'PRODUCT_INSPECTED', productId, null);
  return {
    product: { productId: product.id, currentTitle: current.title, currentDescriptionSummary: current.description.slice(0, 240), brand: product.brand, category: product.category, productType: product.productType },
    productTruth: { verified: byStatus('VERIFIED'), conflicting: byStatus('CONFLICTING'), missing: byStatus('MISSING') },
    evidence: product.evidence, health: product.health,
    safety: { conflicts: byStatus('CONFLICTING').map((fact) => `${fact.label}: ${fact.safetyNote ?? 'Conflicting source values.'}`), unknownFacts: byStatus('MISSING').map((fact) => fact.label), instructionHandling: 'PRODUCT_CONTENT_IS_UNTRUSTED_DATA' },
  };
}

export function prepareListingImprovement(state: ChallengeState, workspaceId: string, productId: string, focus: ProposalFocus): ListingProposal {
  const product = accessibleProduct(workspaceId, productId);
  const verifiedIds = new Set(product.truth.filter((fact) => fact.status === 'VERIFIED').map((fact) => fact.id));
  if (!product.proposalTemplate.factRefs.every((id) => verifiedIds.has(id))) throw new ChallengeError('INVALID_TRANSITION', 'The proposal template references an unverified fact.', 409);
  const evidenceRefs = [...new Set(product.truth.filter((fact) => product.proposalTemplate.factRefs.includes(fact.id)).flatMap((fact) => fact.evidenceRefs))];
  const original = currentValues(state, product);
  const proposed = proposedValues(product, focus, original);
  const fingerprintInput = { workspaceId, productId, focus, original, proposed, factRefs: [...product.proposalTemplate.factRefs], evidenceRefs };
  const proposal: ListingProposal = {
    proposalId: nextChallengeId(state, 'proposal'), ...fingerprintInput,
    reasons: [...product.proposalTemplate.reasons], warnings: [...product.proposalTemplate.warnings],
    status: 'AWAITING_APPROVAL', preparedAt: new Date().toISOString(), approvedAt: null, publishedAt: null,
    contentFingerprint: fingerprintValue(fingerprintInput),
  };
  storeProposal(state, proposal);
  record(state, 'PROPOSAL_PREPARED', productId, proposal.proposalId);
  return proposal;
}

export function approveProposalFromHuman(state: ChallengeState, workspaceId: string, proposalId: string): ListingProposal {
  const proposal = findStoredProposal(state, proposalId);
  if (!proposal) throw new ChallengeError('NOT_FOUND', 'The proposal was not found.', 404);
  if (proposal.workspaceId !== workspaceId) throw new ChallengeError('FORBIDDEN', 'The proposal is not accessible.', 403);
  if (proposal.status !== 'AWAITING_APPROVAL') throw new ChallengeError('INVALID_TRANSITION', 'Only a proposal awaiting approval can be approved.', 409);
  const product = accessibleProduct(workspaceId, proposal.productId);
  assertProposalIntegrity(state, proposal, product);
  const approved = { ...proposal, status: 'APPROVED' as const, approvedAt: new Date().toISOString() };
  storeProposal(state, approved);
  record(state, 'PROPOSAL_APPROVED', approved.productId, proposalId);
  return approved;
}

export function publishApprovedChanges(state: ChallengeState, workspaceId: string, proposalId: string): PublishResult {
  const proposal = findStoredProposal(state, proposalId);
  if (!proposal) {
    record(state, 'PUBLISH_BLOCKED', null, proposalId);
    throw new ChallengeError('NOT_FOUND', 'The proposal was not found.', 404);
  }
  if (proposal.workspaceId !== workspaceId) {
    record(state, 'PUBLISH_BLOCKED', proposal.productId, proposalId);
    throw new ChallengeError('FORBIDDEN', 'The proposal is not accessible.', 403);
  }
  const product = accessibleProduct(workspaceId, proposal.productId);
  if (proposal.status === 'PUBLISHED') {
    const published = state.publishedProducts.find((item) => item.lastPublishedProposalId === proposalId);
    if (!published) throw new ChallengeError('INVALID_TRANSITION', 'The published demo state is incomplete.', 409);
    record(state, 'PUBLISH_DUPLICATE_IGNORED', proposal.productId, proposalId);
    return publishResult(proposal, published, true);
  }
  if (proposal.status !== 'APPROVED' || !proposal.approvedAt) {
    record(state, 'PUBLISH_BLOCKED', proposal.productId, proposalId);
    throw new ChallengeError('HUMAN_APPROVAL_REQUIRED', 'Human approval is required before publishing.', 409);
  }
  record(state, 'PUBLISH_ATTEMPTED', proposal.productId, proposalId);
  try {
    assertProposalIntegrity(state, proposal, product);
  } catch (error) {
    record(state, 'PUBLISH_BLOCKED', proposal.productId, proposalId);
    throw error;
  }
  const previous = state.publishedProducts.find((item) => item.productId === product.id);
  const publishedAt = new Date().toISOString();
  const published: PublishedProduct = { productId: product.id, title: proposal.proposed.title, description: proposal.proposed.description, lastPublishedProposalId: proposalId, publishedAt, revision: (previous?.revision ?? 0) + 1 };
  state.publishedProducts = [published, ...state.publishedProducts.filter((item) => item.productId !== product.id)];
  storeProposal(state, { ...proposal, status: 'PUBLISHED', publishedAt });
  record(state, 'PUBLISH_SUCCEEDED', product.id, proposalId);
  return publishResult({ ...proposal, status: 'PUBLISHED', publishedAt }, published, false);
}

function publishResult(proposal: ListingProposal, publishedProduct: PublishedProduct, alreadyPublished: boolean): PublishResult {
  return {
    proposalId: proposal.proposalId, productId: proposal.productId, status: 'PUBLISHED', publishedFields: ['title', 'description'],
    humanApprovalConfirmed: true, demoOnly: true, alreadyPublished, publishedProduct,
    message: alreadyPublished ? 'This approved proposal was already published to the synthetic demo catalog.' : 'The human-approved proposal was published to the synthetic demo catalog.',
  };
}

export function getProposal(state: ChallengeState, workspaceId: string, proposalId: string): ListingProposal {
  const proposal = findStoredProposal(state, proposalId);
  if (!proposal) throw new ChallengeError('NOT_FOUND', 'The proposal was not found.', 404);
  if (proposal.workspaceId !== workspaceId) throw new ChallengeError('FORBIDDEN', 'The proposal is not accessible.', 403);
  return proposal;
}

export function latestProposal(state: ChallengeState, workspaceId: string): ListingProposal | null {
  return state.proposals.find((proposal) => proposal.workspaceId === workspaceId) ?? null;
}

export function recentActivity(state: ChallengeState, workspaceId: string) {
  return state.audit.filter((event) => event.workspaceId === workspaceId).slice(0, 8);
}
