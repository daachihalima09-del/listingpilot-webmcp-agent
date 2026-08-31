import { beforeEach, describe, expect, it } from 'vitest';
import { POST as prepare } from './proposals/route';
import { POST as approve } from './proposals/[proposalId]/approve/route';
import { resetChallengeStateForTests } from '@/server/store';

beforeEach(resetChallengeStateForTests);

describe('proposal API boundary', () => {
  it('rejects an unknown Product and unknown input fields', async () => {
    const unknown = await prepare(new Request('http://localhost/api/proposals', { method: 'POST', body: JSON.stringify({ productId: 'prod_unknown' }), headers: { 'content-type': 'application/json' } }));
    expect(unknown.status).toBe(404);
    const injected = await prepare(new Request('http://localhost/api/proposals', { method: 'POST', body: JSON.stringify({ productId: 'prod_orion_vx65', approved: true }), headers: { 'content-type': 'application/json' } }));
    expect(injected.status).toBe(400);
  });

  it('requires the visible human review boundary for approval', async () => {
    const prepared = await prepare(new Request('http://localhost/api/proposals', { method: 'POST', body: JSON.stringify({ productId: 'prod_orion_vx65' }), headers: { 'content-type': 'application/json' } }));
    const { proposal } = await prepared.json() as { proposal: { proposalId: string } };
    const context = { params: Promise.resolve({ proposalId: proposal.proposalId }) };
    const denied = await approve(new Request(`http://localhost/api/proposals/${proposal.proposalId}/approve`, { method: 'POST', body: JSON.stringify({ humanConfirmation: true }), headers: { 'content-type': 'application/json' } }), context);
    expect(denied.status).toBe(403);
    const accepted = await approve(new Request(`http://localhost/api/proposals/${proposal.proposalId}/approve`, { method: 'POST', body: JSON.stringify({ humanConfirmation: true }), headers: { 'content-type': 'application/json', 'x-listingpilot-human-action': 'review-ui' } }), context);
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).proposal.status).toBe('APPROVED');
  });
});
