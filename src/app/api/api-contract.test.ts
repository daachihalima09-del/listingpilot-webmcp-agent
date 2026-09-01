import { beforeEach, describe, expect, it } from 'vitest';
import { POST as prepare } from './proposals/route';
import { POST as approve } from './proposals/[proposalId]/approve/route';
import { POST as publish } from './proposals/[proposalId]/publish/route';
import { GET as getProposal } from './proposals/[proposalId]/route';
import { GET as getActivity } from './activity/route';
import { CHALLENGE_SESSION_HEADER } from '@/session/challenge-session';
import { resetDurableSessionStoreForTests } from '@/server/durable-session.server';

function sessionFrom(response: Response): string {
  const value = response.headers.get(CHALLENGE_SESSION_HEADER);
  if (!value) throw new Error('Challenge session identifier missing.');
  return value;
}

function request(url: string, body: object, session?: string, human = false): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (session) headers.set(CHALLENGE_SESSION_HEADER, session);
  if (human) headers.set('x-listingpilot-human-action', 'review-ui');
  return new Request(url, { method: 'POST', body: JSON.stringify(body), headers });
}

function readRequest(url: string, session: string): Request {
  return new Request(url, { headers: { [CHALLENGE_SESSION_HEADER]: session } });
}

beforeEach(() => resetDurableSessionStoreForTests());

describe('durable proposal API boundary', () => {
  it('persists prepare, approval, and publish across independent reload requests', async () => {
    const prepared = await prepare(request('http://localhost/api/proposals', { productId: 'prod_orion_vx65' }));
    const preparedBody = await prepared.clone().json() as { proposal: { proposalId: string; proposed: { title: string; description: string } } };
    const proposalId = preparedBody.proposal.proposalId;
    const context = { params: Promise.resolve({ proposalId }) };
    const session = sessionFrom(prepared);
    const awaitingReload = await getProposal(readRequest(`http://localhost/api/proposals/${proposalId}`, session), context);
    expect((await awaitingReload.json()).proposal.status).toBe('AWAITING_APPROVAL');

    const denied = await approve(request(`http://localhost/api/proposals/${proposalId}/approve`, { humanConfirmation: true }, session), context);
    expect(denied.status).toBe(403);
    const accepted = await approve(request(`http://localhost/api/proposals/${proposalId}/approve`, { humanConfirmation: true }, session, true), context);
    expect(accepted.status).toBe(200);
    const approvedReload = await getProposal(readRequest(`http://localhost/api/proposals/${proposalId}`, session), context);
    expect((await approvedReload.json()).proposal.status).toBe('APPROVED');

    const published = await publish(request(`http://localhost/api/proposals/${proposalId}/publish`, {}, session), context);
    const publishedBody = await published.clone().json();
    expect(publishedBody.result).toMatchObject({ status: 'PUBLISHED', humanApprovalConfirmed: true, alreadyPublished: false });
    expect(publishedBody.proposal.proposed).toEqual(preparedBody.proposal.proposed);
    const publishedReload = await getActivity(readRequest('http://localhost/api/activity', session));
    expect((await publishedReload.json()).latestProposal.status).toBe('PUBLISHED');

    const duplicate = await publish(request(`http://localhost/api/proposals/${proposalId}/publish`, {}, session), context);
    expect((await duplicate.json()).result).toMatchObject({ status: 'PUBLISHED', alreadyPublished: true });
  });

  it('blocks unapproved publish without changing durable awaiting state', async () => {
    const prepared = await prepare(request('http://localhost/api/proposals', { productId: 'prod_aeronest_ap5' }));
    const body = await prepared.clone().json() as { proposal: { proposalId: string } };
    const session = sessionFrom(prepared);
    const context = { params: Promise.resolve({ proposalId: body.proposal.proposalId }) };
    const blocked = await publish(request(`http://localhost/api/proposals/${body.proposal.proposalId}/publish`, {}, session), context);
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error).toMatchObject({ code: 'HUMAN_APPROVAL_REQUIRED' });
    const reloaded = await getProposal(readRequest(`http://localhost/api/proposals/${body.proposal.proposalId}`, session), context);
    expect((await reloaded.json()).proposal.status).toBe('AWAITING_APPROVAL');
  });

  it('isolates independent sessions', async () => {
    const first = await prepare(request('http://localhost/api/proposals', { productId: 'prod_orion_vx65' }));
    const firstSession = sessionFrom(first);
    const independent = await getActivity(new Request('http://localhost/api/activity'));
    const independentSession = sessionFrom(independent);
    expect(independentSession).not.toBe(firstSession);
    expect((await independent.json()).latestProposal).toBeNull();
    const firstReload = await getActivity(readRequest('http://localhost/api/activity', firstSession));
    expect((await firstReload.json()).latestProposal).not.toBeNull();
  });

  it('rejects unknown Products and unknown input fields', async () => {
    expect((await prepare(request('http://localhost/api/proposals', { productId: 'prod_unknown' }))).status).toBe(404);
    expect((await prepare(request('http://localhost/api/proposals', { productId: 'prod_orion_vx65', approved: true }))).status).toBe(400);
  });
});
