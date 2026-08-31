import { NextResponse } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEMO_WORKSPACE_ID } from '@/domain/contracts';
import { approveProposalFromHuman, prepareListingImprovement, publishApprovedChanges } from './challenge-service';
import { CHALLENGE_STATE_COOKIE, attachChallengeState, encodeChallengeStateForTests, readChallengeSession, readChallengeState } from './state-cookie.server';
import { createChallengeState } from './store';

afterEach(() => vi.unstubAllEnvs());

describe('signed challenge session persistence', () => {
  it('distinguishes a missing cookie from a verified cookie without exposing either value', () => {
    const missing = readChallengeSession(new Request('http://localhost/api/activity'));
    expect(missing.cookieStatus).toBe('MISSING_NEW_SESSION');
    const encoded = encodeChallengeStateForTests(missing.state);
    const valid = readChallengeSession(new Request('http://localhost/api/activity', { headers: { cookie: `${CHALLENGE_STATE_COOKIE}=${encoded}` } }));
    expect(valid.cookieStatus).toBe('VALID');
  });

  it('uses an embedded-browser-compatible partitioned cookie in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CHALLENGE_STATE_SECRET', 'test-production-secret-at-least-32-characters');
    const response = attachChallengeState(NextResponse.json({ ok: true }), createChallengeState());
    const header = response.headers.get('set-cookie') ?? '';
    const normalized = header.toLowerCase();
    expect(normalized).toContain('httponly');
    expect(normalized).toContain('secure');
    expect(normalized).toContain('samesite=none');
    expect(normalized).toContain('partitioned');
  });

  it('round-trips approved and published state across stateless requests', () => {
    const state = createChallengeState();
    const proposal = prepareListingImprovement(state, DEMO_WORKSPACE_ID, 'prod_orion_vx65', 'full_listing');
    approveProposalFromHuman(state, DEMO_WORKSPACE_ID, proposal.proposalId);
    publishApprovedChanges(state, DEMO_WORKSPACE_ID, proposal.proposalId);
    const encoded = encodeChallengeStateForTests(state);
    const restored = readChallengeState(new Request('http://localhost/api/activity', { headers: { cookie: `${CHALLENGE_STATE_COOKIE}=${encoded}` } }));
    expect(restored).toEqual(state);
    expect(restored.proposals[0].status).toBe('PUBLISHED');
    expect(restored.publishedProducts[0].revision).toBe(1);
  });

  it('fails closed when the signed session is tampered with', () => {
    const encoded = encodeChallengeStateForTests(createChallengeState());
    const tampered = `${encoded.slice(0, -1)}${encoded.endsWith('a') ? 'b' : 'a'}`;
    expect(() => readChallengeState(new Request('http://localhost/api/activity', { headers: { cookie: `${CHALLENGE_STATE_COOKIE}=${tampered}` } }))).toThrowError(expect.objectContaining({ code: 'SESSION_STATE_INVALID' }));
  });

  it('keeps the bounded persisted challenge state within one browser cookie', () => {
    const state = createChallengeState();
    for (const productId of ['prod_orion_vx65', 'prod_aeronest_ap5', 'prod_northstar_dock12']) {
      const proposal = prepareListingImprovement(state, DEMO_WORKSPACE_ID, productId, 'full_listing');
      approveProposalFromHuman(state, DEMO_WORKSPACE_ID, proposal.proposalId);
      publishApprovedChanges(state, DEMO_WORKSPACE_ID, proposal.proposalId);
    }
    prepareListingImprovement(state, DEMO_WORKSPACE_ID, 'prod_orion_vx65', 'title');
    expect(encodeChallengeStateForTests(state).length).toBeLessThan(3800);
  });
});
