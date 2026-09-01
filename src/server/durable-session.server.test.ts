import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_WORKSPACE_ID } from '@/domain/contracts';
import { CHALLENGE_SESSION_HEADER, isChallengeSessionToken } from '@/session/challenge-session';
import { approveProposalFromHuman, prepareListingImprovement } from './challenge-service';
import { commitChallengeSession, deleteChallengeSession, readChallengeSession, resetDurableSessionStoreForTests } from './durable-session.server';

const request = (session?: string) => new Request('http://localhost/api/activity', { headers: session ? { [CHALLENGE_SESSION_HEADER]: session } : undefined });

beforeEach(() => resetDurableSessionStoreForTests());

describe('durable challenge session persistence', () => {
  it('issues an unguessable signed session and restores it independently', async () => {
    const created = await readChallengeSession(request(), DEMO_WORKSPACE_ID);
    expect(isChallengeSessionToken(created.token)).toBe(true);
    expect(created.status).toBe('NEW');
    const restored = await readChallengeSession(request(created.token), DEMO_WORKSPACE_ID);
    expect(restored.status).toBe('DURABLE');
    expect(restored.token).toBe(created.token);
  });

  it('persists awaiting and approved state across independent requests', async () => {
    const preparedSession = await readChallengeSession(request(), DEMO_WORKSPACE_ID);
    const proposal = prepareListingImprovement(preparedSession.state, DEMO_WORKSPACE_ID, 'prod_orion_vx65', 'full_listing');
    await commitChallengeSession(preparedSession, DEMO_WORKSPACE_ID);
    const awaitingReload = await readChallengeSession(request(preparedSession.token), DEMO_WORKSPACE_ID);
    expect(awaitingReload.state.proposals[0].status).toBe('AWAITING_APPROVAL');
    approveProposalFromHuman(awaitingReload.state, DEMO_WORKSPACE_ID, proposal.proposalId);
    await commitChallengeSession(awaitingReload, DEMO_WORKSPACE_ID);
    const approvedReload = await readChallengeSession(request(preparedSession.token), DEMO_WORKSPACE_ID);
    expect(approvedReload.state.proposals[0].status).toBe('APPROVED');
  });

  it('rejects a stale compare-and-set instead of regressing approval', async () => {
    const initial = await readChallengeSession(request(), DEMO_WORKSPACE_ID);
    const proposal = prepareListingImprovement(initial.state, DEMO_WORKSPACE_ID, 'prod_orion_vx65', 'full_listing');
    await commitChallengeSession(initial, DEMO_WORKSPACE_ID);
    const approving = await readChallengeSession(request(initial.token), DEMO_WORKSPACE_ID);
    const stale = await readChallengeSession(request(initial.token), DEMO_WORKSPACE_ID);
    approveProposalFromHuman(approving.state, DEMO_WORKSPACE_ID, proposal.proposalId);
    await commitChallengeSession(approving, DEMO_WORKSPACE_ID);
    prepareListingImprovement(stale.state, DEMO_WORKSPACE_ID, 'prod_aeronest_ap5', 'full_listing');
    await expect(commitChallengeSession(stale, DEMO_WORKSPACE_ID)).rejects.toMatchObject({ code: 'SESSION_STATE_STALE' });
    const current = await readChallengeSession(request(initial.token), DEMO_WORKSPACE_ID);
    expect(current.state.proposals.find((item) => item.proposalId === proposal.proposalId)?.status).toBe('APPROVED');
  });

  it('fails closed for a tampered token and workspace mismatch', async () => {
    const session = await readChallengeSession(request(), DEMO_WORKSPACE_ID);
    const tampered = `${session.token.slice(0, -1)}${session.token.endsWith('a') ? 'b' : 'a'}`;
    await expect(readChallengeSession(request(tampered), DEMO_WORKSPACE_ID)).rejects.toMatchObject({ code: 'SESSION_STATE_INVALID' });
    await expect(readChallengeSession(request(session.token), 'workspace_other')).rejects.toMatchObject({ code: 'SESSION_STATE_INVALID' });
  });

  it('rotates a valid bearer after its durable record is deleted', async () => {
    const session = await readChallengeSession(request(), DEMO_WORKSPACE_ID);
    await deleteChallengeSession(session);
    const replacement = await readChallengeSession(request(session.token), DEMO_WORKSPACE_ID);
    expect(replacement.token).not.toBe(session.token);
    expect(replacement.status).toBe('NEW');
    expect(replacement.state.proposals).toEqual([]);
  });
});
