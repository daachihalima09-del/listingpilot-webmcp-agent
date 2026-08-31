import { describe, expect, it } from 'vitest';
import { POST as prepare } from './proposals/route';
import { POST as approve } from './proposals/[proposalId]/approve/route';
import { POST as publish } from './proposals/[proposalId]/publish/route';
import { GET as getProposal } from './proposals/[proposalId]/route';
import { GET as getActivity } from './activity/route';
import { GET as getProducts } from './products/route';
import { CHALLENGE_STATE_COOKIE } from '@/server/state-cookie.server';
import { NextRequest } from 'next/server';

function cookieFrom(response: Response): string {
  const raw = response.headers.get('set-cookie');
  const match = raw?.match(new RegExp(`${CHALLENGE_STATE_COOKIE}=([^;]+)`));
  if (!match) throw new Error('Challenge state cookie missing.');
  return `${CHALLENGE_STATE_COOKIE}=${match[1]}`;
}

function request(url: string, body: object, cookie?: string, human = false): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  if (human) headers['x-listingpilot-human-action'] = 'review-ui';
  return new Request(url, { method: 'POST', body: JSON.stringify(body), headers });
}

describe('proposal API boundary', () => {
  it('rejects an unknown Product and unknown input fields', async () => {
    expect((await prepare(request('http://localhost/api/proposals', { productId: 'prod_unknown' }))).status).toBe(404);
    expect((await prepare(request('http://localhost/api/proposals', { productId: 'prod_orion_vx65', approved: true }))).status).toBe(400);
  });

  it('persists preparation, requires visible human approval, then publishes', async () => {
    const prepared = await prepare(request('http://localhost/api/proposals', { productId: 'prod_orion_vx65' }));
    const preparedBody = await prepared.clone().json() as { proposal: { proposalId: string } };
    const context = { params: Promise.resolve({ proposalId: preparedBody.proposal.proposalId }) };
    const preparedCookie = cookieFrom(prepared);
    const retrieved = await getProposal(new Request(`http://localhost/api/proposals/${preparedBody.proposal.proposalId}`, { headers: { cookie: preparedCookie } }), context);
    expect(retrieved.status).toBe(200);
    expect((await retrieved.json()).diagnostic).toMatchObject({ stateCookie: 'VALID', proposalFound: true, proposalState: 'AWAITING_APPROVAL' });
    const humanView = await getActivity(new Request('http://localhost/api/activity', { headers: { cookie: preparedCookie } }));
    expect((await humanView.json()).latestProposal.proposalId).toBe(preparedBody.proposal.proposalId);
    const denied = await approve(request(`http://localhost/api/proposals/${preparedBody.proposal.proposalId}/approve`, { humanConfirmation: true }, preparedCookie), context);
    expect(denied.status).toBe(403);
    expect(denied.headers.get('set-cookie')).toBeNull();
    const accepted = await approve(request(`http://localhost/api/proposals/${preparedBody.proposal.proposalId}/approve`, { humanConfirmation: true }, preparedCookie, true), context);
    expect(accepted.status).toBe(200);
    expect((await accepted.clone().json()).proposal.status).toBe('APPROVED');
    const published = await publish(request(`http://localhost/api/proposals/${preparedBody.proposal.proposalId}/publish`, {}, cookieFrom(accepted)), context);
    expect(published.status).toBe(200);
    const body = await published.json();
    expect(body.result).toMatchObject({ status: 'PUBLISHED', demoOnly: true, humanApprovalConfirmed: true });
    expect(body.proposal.status).toBe('PUBLISHED');
  });

  it('cannot publish an awaiting-approval proposal', async () => {
    const prepared = await prepare(request('http://localhost/api/proposals', { productId: 'prod_aeronest_ap5' }));
    const body = await prepared.clone().json() as { proposal: { proposalId: string } };
    const context = { params: Promise.resolve({ proposalId: body.proposal.proposalId }) };
    const blocked = await publish(request(`http://localhost/api/proposals/${body.proposal.proposalId}/publish`, {}, cookieFrom(prepared)), context);
    expect(blocked.status).toBe(409);
    const blockedBody = await blocked.json();
    expect(blockedBody.error).toMatchObject({ code: 'HUMAN_APPROVAL_REQUIRED', message: expect.stringMatching(/Human approval is required/) });
    expect(blockedBody.diagnostic).toMatchObject({ stateCookie: 'VALID', proposalFound: true, proposalState: 'AWAITING_APPROVAL' });
    expect(blocked.headers.get('set-cookie')).toBeNull();
  });

  it('does not let a stale read response overwrite human approval', async () => {
    const prepared = await prepare(request('http://localhost/api/proposals', { productId: 'prod_orion_vx65' }));
    const preparedBody = await prepared.clone().json() as { proposal: { proposalId: string } };
    const proposalId = preparedBody.proposal.proposalId;
    const context = { params: Promise.resolve({ proposalId }) };
    const awaitingCookie = cookieFrom(prepared);

    // This request started with the old AWAITING_APPROVAL snapshot. A read-only
    // response must not carry a state cookie that can arrive after approval.
    const staleRead = await getProducts(new NextRequest('http://localhost/api/products', { headers: { cookie: awaitingCookie } }));
    expect(staleRead.status).toBe(200);
    expect(staleRead.headers.get('set-cookie')).toBeNull();

    const approved = await approve(request(`http://localhost/api/proposals/${proposalId}/approve`, { humanConfirmation: true }, awaitingCookie, true), context);
    expect(approved.status).toBe(200);
    const approvedCookie = cookieFrom(approved);
    const independentRead = await getProposal(new Request(`http://localhost/api/proposals/${proposalId}`, { headers: { cookie: approvedCookie } }), context);
    expect((await independentRead.json()).proposal.status).toBe('APPROVED');

    const published = await publish(request(`http://localhost/api/proposals/${proposalId}/publish`, {}, approvedCookie), context);
    expect(published.status).toBe(200);
    const publishedCookie = cookieFrom(published);
    const refreshed = await getActivity(new Request('http://localhost/api/activity', { headers: { cookie: publishedCookie } }));
    expect((await refreshed.json()).latestProposal.status).toBe('PUBLISHED');
  });
});
