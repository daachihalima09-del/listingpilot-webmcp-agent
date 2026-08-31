// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEMO_WORKSPACE_ID, type ListingProposal, type PublishResult } from '@/domain/contracts';
import { inspectProduct, prepareListingImprovement, searchProducts } from '@/server/challenge-service';
import { createChallengeState } from '@/server/store';
import { WEBMCP_RESULT_EVENT } from '@/webmcp/tool-results';
import { AgentWorkspace } from './AgentWorkspace';

vi.mock('@/webmcp/register-tools', () => ({
  registerListingPilotTools: () => ({ supported: false, ready: Promise.resolve({ intendedTools: [], registeredTools: [], verified: false }), unregister: vi.fn() }),
}));

afterEach(() => vi.unstubAllGlobals());

describe('agent workspace proposal lifecycle', () => {
  it('shows approved waiting state and then the persisted published state', async () => {
    const state = createChallengeState();
    const products = searchProducts(state, DEMO_WORKSPACE_ID);
    const inspection = inspectProduct(state, DEMO_WORKSPACE_ID, products[0].productId);
    const prepared = prepareListingImprovement(state, DEMO_WORKSPACE_ID, products[0].productId, 'full_listing');
    const approved: ListingProposal = { ...prepared, status: 'APPROVED', approvedAt: new Date().toISOString() };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ activity: [], latestProposal: approved, publishedProducts: [], diagnostic: { stateCookie: 'VALID', proposalCount: 1, proposalFound: true, proposalState: 'APPROVED' } }), { status: 200, headers: { 'content-type': 'application/json' } })));

    render(<AgentWorkspace initialProducts={products} initialInspection={inspection} />);
    await waitFor(() => expect(screen.getByText(/Waiting for the agent to call/)).toBeTruthy());

    const publishedAt = new Date().toISOString();
    const publishedProposal: ListingProposal = { ...approved, status: 'PUBLISHED', publishedAt };
    const result: PublishResult = {
      proposalId: approved.proposalId,
      productId: approved.productId,
      status: 'PUBLISHED',
      publishedFields: ['title', 'description'],
      humanApprovalConfirmed: true,
      demoOnly: true,
      alreadyPublished: false,
      publishedProduct: { productId: approved.productId, title: approved.proposed.title, description: approved.proposed.description, lastPublishedProposalId: approved.proposalId, publishedAt, revision: 1 },
      message: 'Published.',
    };
    act(() => window.dispatchEvent(new CustomEvent(WEBMCP_RESULT_EVENT, { detail: { kind: 'publish', proposal: publishedProposal, result } })));
    expect(screen.getByText(/Published to the synthetic demo catalog/)).toBeTruthy();
    expect(screen.getAllByText(approved.proposed.title).length).toBeGreaterThan(0);
  });
});
