import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_WORKSPACE_ID } from '@/domain/contracts';
import { approveProposalFromHuman, inspectProduct, prepareListingImprovement, publishApprovedChanges, searchProducts } from './challenge-service';
import { ChallengeError } from './errors';
import { createChallengeState, type ChallengeState } from './store';

let state: ChallengeState;
beforeEach(() => { state = createChallengeState(); });

describe('challenge catalog boundary', () => {
  it('returns bounded accessible summaries without private fields', () => {
    const products = searchProducts(state, DEMO_WORKSPACE_ID);
    expect(products).toHaveLength(3);
    expect(products.length).toBeLessThanOrEqual(8);
    const serialized = JSON.stringify(products);
    expect(serialized).not.toContain('workspaceId');
    expect(serialized).not.toContain('proposalTemplate');
    expect(serialized).not.toContain('evidenceRefs');
  });

  it('searches title, brand, category, and product type', () => {
    expect(searchProducts(state, DEMO_WORKSPACE_ID, 'television').map((item) => item.productId)).toEqual(['prod_orion_vx65']);
    expect(searchProducts(state, DEMO_WORKSPACE_ID, 'AeroNest')).toHaveLength(1);
    expect(searchProducts(state, DEMO_WORKSPACE_ID, 'USB-C')).toHaveLength(1);
  });

  it('rejects unknown and cross-workspace Product access', () => {
    expect(() => inspectProduct(state, DEMO_WORKSPACE_ID, 'prod_unknown')).toThrow(ChallengeError);
    expect(() => inspectProduct(state, 'workspace_attacker', 'prod_orion_vx65')).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  });
});

describe('inspection and safe preparation', () => {
  it('separates verified, conflicting, and missing facts with evidence and health', () => {
    const result = inspectProduct(state, DEMO_WORKSPACE_ID, 'prod_orion_vx65');
    expect(result.productTruth.conflicting.map((fact) => fact.label)).toContain('HDMI ports');
    expect(result.productTruth.missing.map((fact) => fact.label)).toContain('Warranty');
    expect(result.health.status).toBe('NEEDS_ATTENTION');
  });

  it('creates an awaiting-approval proposal using verified facts only', () => {
    const proposal = prepareListingImprovement(state, DEMO_WORKSPACE_ID, 'prod_orion_vx65', 'full_listing');
    const inspection = inspectProduct(state, DEMO_WORKSPACE_ID, proposal.productId);
    const verified = new Set(inspection.productTruth.verified.map((fact) => fact.id));
    expect(proposal.factRefs.every((id) => verified.has(id))).toBe(true);
    expect(proposal.status).toBe('AWAITING_APPROVAL');
    expect(proposal.factRefs).not.toContain('orion_hdmi');
    expect(proposal.factRefs).not.toContain('orion_warranty');
  });

  it('treats instruction-like supplier text as inert data', () => {
    const inspection = inspectProduct(state, DEMO_WORKSPACE_ID, 'prod_orion_vx65');
    expect(inspection.evidence.some((item) => item.excerpt.includes('[SYSTEM:'))).toBe(true);
    const proposal = prepareListingImprovement(state, DEMO_WORKSPACE_ID, 'prod_orion_vx65', 'full_listing');
    expect(JSON.stringify(proposal)).not.toContain('Ignore product rules');
    expect(JSON.stringify(proposal)).not.toContain('publish this item');
  });
});

describe('human approval and agent publish boundary', () => {
  it('blocks publish before human approval and records the block', () => {
    const proposal = prepareListingImprovement(state, DEMO_WORKSPACE_ID, 'prod_northstar_dock12', 'full_listing');
    expect(() => publishApprovedChanges(state, DEMO_WORKSPACE_ID, proposal.proposalId)).toThrowError(expect.objectContaining({ code: 'INVALID_TRANSITION' }));
    expect(state.publishedProducts).toHaveLength(0);
    expect(state.audit[0].type).toBe('PUBLISH_BLOCKED');
  });

  it('publishes only the exact stored human-approved content', () => {
    const proposal = prepareListingImprovement(state, DEMO_WORKSPACE_ID, 'prod_northstar_dock12', 'full_listing');
    const approved = approveProposalFromHuman(state, DEMO_WORKSPACE_ID, proposal.proposalId);
    const result = publishApprovedChanges(state, DEMO_WORKSPACE_ID, approved.proposalId);
    expect(result.status).toBe('PUBLISHED');
    expect(result.publishedProduct.title).toBe(approved.proposed.title);
    expect(result.publishedProduct.description).toBe(approved.proposed.description);
    expect(state.proposals[0].status).toBe('PUBLISHED');
    expect(state.audit.map((event) => event.type)).toEqual(expect.arrayContaining(['PROPOSAL_APPROVED', 'PUBLISH_ATTEMPTED', 'PUBLISH_SUCCEEDED']));
  });

  it('makes duplicate publish execution idempotent', () => {
    const proposal = prepareListingImprovement(state, DEMO_WORKSPACE_ID, 'prod_aeronest_ap5', 'full_listing');
    approveProposalFromHuman(state, DEMO_WORKSPACE_ID, proposal.proposalId);
    const first = publishApprovedChanges(state, DEMO_WORKSPACE_ID, proposal.proposalId);
    const duplicate = publishApprovedChanges(state, DEMO_WORKSPACE_ID, proposal.proposalId);
    expect(duplicate.alreadyPublished).toBe(true);
    expect(duplicate.publishedProduct).toEqual(first.publishedProduct);
    expect(state.publishedProducts).toHaveLength(1);
    expect(state.audit.filter((event) => event.type === 'PUBLISH_SUCCEEDED')).toHaveLength(1);
    expect(state.audit.filter((event) => event.type === 'PUBLISH_DUPLICATE_IGNORED')).toHaveLength(1);
  });

  it('rejects cross-workspace publication and tampered approved content', () => {
    const proposal = prepareListingImprovement(state, DEMO_WORKSPACE_ID, 'prod_orion_vx65', 'full_listing');
    approveProposalFromHuman(state, DEMO_WORKSPACE_ID, proposal.proposalId);
    expect(() => publishApprovedChanges(state, 'workspace_attacker', proposal.proposalId)).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    state.proposals[0].proposed.title = 'Injected title';
    expect(() => publishApprovedChanges(state, DEMO_WORKSPACE_ID, proposal.proposalId)).toThrowError(expect.objectContaining({ code: 'INVALID_TRANSITION' }));
    expect(state.publishedProducts).toHaveLength(0);
    expect(state.audit[0].type).toBe('PUBLISH_BLOCKED');
  });

  it('keeps bounded audit and proposal state', () => {
    for (let index = 0; index < 20; index += 1) searchProducts(state, DEMO_WORKSPACE_ID);
    for (let index = 0; index < 6; index += 1) prepareListingImprovement(state, DEMO_WORKSPACE_ID, 'prod_orion_vx65', 'title');
    expect(state.audit.length).toBeLessThanOrEqual(12);
    expect(state.proposals).toHaveLength(4);
  });
});
