import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_WORKSPACE_ID } from '@/domain/contracts';
import { approveProposalFromHuman, inspectProduct, prepareListingImprovement, searchProducts } from './challenge-service';
import { ChallengeError } from './errors';
import { resetChallengeStateForTests } from './store';

beforeEach(resetChallengeStateForTests);

describe('challenge catalog boundary', () => {
  it('returns bounded accessible summaries without private fields', () => {
    const products = searchProducts(DEMO_WORKSPACE_ID);
    expect(products).toHaveLength(3);
    expect(products.length).toBeLessThanOrEqual(8);
    const serialized = JSON.stringify(products);
    expect(serialized).not.toContain('workspaceId');
    expect(serialized).not.toContain('proposalTemplate');
    expect(serialized).not.toContain('evidenceRefs');
  });

  it('searches title, brand, category, and product type', () => {
    expect(searchProducts(DEMO_WORKSPACE_ID, 'television').map((item) => item.productId)).toEqual(['prod_orion_vx65']);
    expect(searchProducts(DEMO_WORKSPACE_ID, 'AeroNest')).toHaveLength(1);
    expect(searchProducts(DEMO_WORKSPACE_ID, 'USB-C')).toHaveLength(1);
  });

  it('rejects unknown and cross-workspace Product access', () => {
    expect(() => inspectProduct(DEMO_WORKSPACE_ID, 'prod_unknown')).toThrow(ChallengeError);
    expect(() => inspectProduct('workspace_attacker', 'prod_orion_vx65')).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  });
});

describe('inspection and safe preparation', () => {
  it('separates verified, conflicting, and missing facts with evidence and health', () => {
    const result = inspectProduct(DEMO_WORKSPACE_ID, 'prod_orion_vx65');
    expect(result.productTruth.verified.length).toBeGreaterThan(0);
    expect(result.productTruth.conflicting.map((fact) => fact.label)).toContain('HDMI ports');
    expect(result.productTruth.missing.map((fact) => fact.label)).toContain('Warranty');
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.health.status).toBe('NEEDS_ATTENTION');
  });

  it('creates an awaiting-approval proposal using verified facts only', () => {
    const proposal = prepareListingImprovement(DEMO_WORKSPACE_ID, 'prod_orion_vx65', 'full_listing');
    const inspection = inspectProduct(DEMO_WORKSPACE_ID, proposal.productId);
    const verified = new Set(inspection.productTruth.verified.map((fact) => fact.id));
    expect(proposal.factRefs.every((id) => verified.has(id))).toBe(true);
    expect(proposal.status).toBe('AWAITING_APPROVAL');
    expect(proposal.productId).toBe('prod_orion_vx65');
    expect(proposal).not.toHaveProperty('published');
    expect(proposal.factRefs).not.toContain('orion_hdmi');
    expect(proposal.factRefs).not.toContain('orion_warranty');
  });

  it('treats instruction-like supplier text as inert data', () => {
    const inspection = inspectProduct(DEMO_WORKSPACE_ID, 'prod_orion_vx65');
    expect(inspection.evidence.some((item) => item.excerpt.includes('[SYSTEM:'))).toBe(true);
    expect(inspection.safety.instructionHandling).toBe('PRODUCT_CONTENT_IS_UNTRUSTED_DATA');
    const proposal = prepareListingImprovement(DEMO_WORKSPACE_ID, 'prod_orion_vx65', 'full_listing');
    expect(JSON.stringify(proposal)).not.toContain('Ignore product rules');
    expect(JSON.stringify(proposal)).not.toContain('publish this item');
  });

  it('cannot cross workspaces and preserves focus without accepting factual content', () => {
    expect(() => prepareListingImprovement('workspace_attacker', 'prod_orion_vx65', 'title')).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    const proposal = prepareListingImprovement(DEMO_WORKSPACE_ID, 'prod_aeronest_ap5', 'title');
    expect(proposal.proposed.description).toBe(proposal.original.description);
  });

  it('allows an explicit human transition but never publishes', () => {
    const proposal = prepareListingImprovement(DEMO_WORKSPACE_ID, 'prod_northstar_dock12', 'full_listing');
    const approved = approveProposalFromHuman(DEMO_WORKSPACE_ID, proposal.proposalId);
    expect(approved.status).toBe('APPROVED');
    expect(approved.approvedAt).not.toBeNull();
    expect(approved).not.toHaveProperty('publishedAt');
    expect(() => approveProposalFromHuman(DEMO_WORKSPACE_ID, proposal.proposalId)).toThrowError(expect.objectContaining({ code: 'INVALID_TRANSITION' }));
  });
});
