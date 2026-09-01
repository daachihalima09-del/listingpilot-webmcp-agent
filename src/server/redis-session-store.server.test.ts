import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_WORKSPACE_ID } from '@/domain/contracts';
import { CHALLENGE_SESSION_HEADER } from '@/session/challenge-session';
import { POST as prepare } from '@/app/api/proposals/route';
import { POST as approve } from '@/app/api/proposals/[proposalId]/approve/route';
import { POST as publish } from '@/app/api/proposals/[proposalId]/publish/route';
import { GET as activity } from '@/app/api/activity/route';
import { POST as reset } from '@/app/api/demo/reset/route';
import { commitChallengeSession, readChallengeSession, resetDurableSessionStoreForTests, setDurableSessionStoreForTests } from './durable-session.server';
import { createRedisSessionStore, type RedisSessionClient } from './redis-session-store.server';
import { prepareListingImprovement } from './challenge-service';

type Command = 'GET' | 'SET' | 'EVAL' | 'DEL';

class UpstashCompatibleFake implements RedisSessionClient {
  readonly records = new Map<string, string>();
  readonly commands: Command[] = [];
  fail: { command: Command; error: Error } | null = null;

  private failure(command: Command): void {
    this.commands.push(command);
    if (this.fail?.command === command) throw this.fail.error;
  }

  async get(key: string): Promise<string | null> {
    this.failure('GET');
    return this.records.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<'OK' | null> {
    this.failure('SET');
    if (this.records.has(key)) return null;
    this.records.set(key, value);
    return 'OK';
  }

  async eval(_script: string, keys: string[], args: Array<string | number>): Promise<number> {
    this.failure('EVAL');
    const [key] = keys;
    const [expected, value] = args;
    if (this.records.get(key) !== expected) return 0;
    this.records.set(key, String(value));
    return 1;
  }

  async del(key: string): Promise<number> {
    this.failure('DEL');
    return this.records.delete(key) ? 1 : 0;
  }
}

function postRequest(url: string, body: object, session?: string, human = false): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (session) headers.set(CHALLENGE_SESSION_HEADER, session);
  if (human) headers.set('x-listingpilot-human-action', 'review-ui');
  return new Request(url, { method: 'POST', headers, body: JSON.stringify(body) });
}

function readRequest(session?: string): Request {
  return new Request('http://localhost/api/activity', { headers: session ? { [CHALLENGE_SESSION_HEADER]: session } : undefined });
}

function sessionFrom(response: Response): string {
  const session = response.headers.get(CHALLENGE_SESSION_HEADER);
  if (!session) throw new Error('Missing challenge session header.');
  return session;
}

beforeEach(() => {
  vi.useRealTimers();
  resetDurableSessionStoreForTests();
  vi.restoreAllMocks();
});

describe('production-shaped Redis challenge persistence', () => {
  it('persists the complete human-gated lifecycle across independent Redis requests', async () => {
    const redis = new UpstashCompatibleFake();
    setDurableSessionStoreForTests(createRedisSessionStore(redis));

    const prepared = await prepare(postRequest('http://localhost/api/proposals', { productId: 'prod_orion_vx65' }));
    expect(prepared.status).toBe(201);
    const session = sessionFrom(prepared);
    const proposal = (await prepared.json()).proposal as { proposalId: string };
    const context = { params: Promise.resolve({ proposalId: proposal.proposalId }) };
    expect((await (await activity(readRequest(session))).json()).latestProposal.status).toBe('AWAITING_APPROVAL');

    const blocked = await publish(postRequest(`http://localhost/api/proposals/${proposal.proposalId}/publish`, {}, session), context);
    expect((await blocked.json()).error.code).toBe('HUMAN_APPROVAL_REQUIRED');

    const approved = await approve(postRequest(`http://localhost/api/proposals/${proposal.proposalId}/approve`, { humanConfirmation: true }, session, true), context);
    expect(approved.status).toBe(200);
    expect((await (await activity(readRequest(session))).json()).latestProposal.status).toBe('APPROVED');

    const published = await publish(postRequest(`http://localhost/api/proposals/${proposal.proposalId}/publish`, {}, session), context);
    expect((await published.json()).result).toMatchObject({ status: 'PUBLISHED', alreadyPublished: false });
    const reloaded = await activity(readRequest(session));
    const reloadedBody = await reloaded.json();
    expect(reloadedBody.latestProposal.status).toBe('PUBLISHED');
    expect(reloadedBody.publishedProducts[0].revision).toBe(1);

    const duplicate = await publish(postRequest(`http://localhost/api/proposals/${proposal.proposalId}/publish`, {}, session), context);
    expect((await duplicate.json()).result).toMatchObject({ status: 'PUBLISHED', alreadyPublished: true });
    expect((await (await activity(readRequest(session))).json()).publishedProducts[0].revision).toBe(1);
    expect(redis.commands).toEqual(expect.arrayContaining(['GET', 'SET', 'EVAL']));
  });

  it('rejects a stale Redis revision without regressing approved state', async () => {
    const redis = new UpstashCompatibleFake();
    setDurableSessionStoreForTests(createRedisSessionStore(redis));
    const initial = await readChallengeSession(readRequest(), DEMO_WORKSPACE_ID);
    const proposal = prepareListingImprovement(initial.state, DEMO_WORKSPACE_ID, 'prod_orion_vx65', 'full_listing');
    await commitChallengeSession(initial, DEMO_WORKSPACE_ID);
    const current = await readChallengeSession(readRequest(initial.token), DEMO_WORKSPACE_ID);
    const stale = await readChallengeSession(readRequest(initial.token), DEMO_WORKSPACE_ID);
    current.state.proposals[0].status = 'APPROVED';
    current.state.proposals[0].approvedAt = new Date().toISOString();
    await commitChallengeSession(current, DEMO_WORKSPACE_ID);
    prepareListingImprovement(stale.state, DEMO_WORKSPACE_ID, 'prod_aeronest_ap5', 'full_listing');
    await expect(commitChallengeSession(stale, DEMO_WORKSPACE_ID)).rejects.toMatchObject({ code: 'SESSION_STATE_STALE' });
    const restored = await readChallengeSession(readRequest(initial.token), DEMO_WORKSPACE_ID);
    expect(restored.state.proposals.find((item) => item.proposalId === proposal.proposalId)?.status).toBe('APPROVED');
  });

  it('maps a read-only token SET failure to a bounded permission diagnostic', async () => {
    const redis = new UpstashCompatibleFake();
    redis.fail = { command: 'SET', error: new Error("NOPERM this user has no permissions to run the 'set' command") };
    setDurableSessionStoreForTests(createRedisSessionStore(redis));
    const response = await activity(readRequest());
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.error).toMatchObject({ code: 'REDIS_PERMISSION_DENIED' });
    expect(body.error.reference).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(body)).not.toContain('NOPERM');
  });

  it('does not persist a proposal when the atomic Redis command fails', async () => {
    const redis = new UpstashCompatibleFake();
    setDurableSessionStoreForTests(createRedisSessionStore(redis));
    const initial = await activity(readRequest());
    const session = sessionFrom(initial);
    redis.fail = { command: 'EVAL', error: new Error('connection timed out') };
    const failed = await prepare(postRequest('http://localhost/api/proposals', { productId: 'prod_orion_vx65' }, session));
    expect((await failed.json()).error.code).toBe('REDIS_CONNECTION_FAILED');
    redis.fail = null;
    expect((await (await activity(readRequest(session))).json()).latestProposal).toBeNull();
  });

  it('fails safely for malformed durable state without exposing its payload', async () => {
    const redis = new UpstashCompatibleFake();
    setDurableSessionStoreForTests(createRedisSessionStore(redis));
    const initial = await activity(readRequest());
    const session = sessionFrom(initial);
    const key = [...redis.records.keys()][0];
    redis.records.set(key, 'not-a-valid-record');
    const response = await activity(readRequest(session));
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.error).toMatchObject({ code: 'SESSION_STATE_CORRUPT' });
    expect(JSON.stringify(body)).not.toContain('not-a-valid-record');
    const resetResponse = await reset(postRequest('http://localhost/api/demo/reset', {}, session));
    expect(resetResponse.status).toBe(200);
    expect(redis.records.size).toBe(0);
  });

  it.each([
    [new Error('Unauthorized: invalid token'), 'GET' as const, 'REDIS_AUTHENTICATION_FAILED'],
    [new Error('ERR unknown command EVAL'), 'EVAL' as const, 'REDIS_COMMAND_UNSUPPORTED'],
    [new Error('unexpected provider failure'), 'GET' as const, 'REDIS_COMMAND_FAILED'],
  ])('classifies provider failures without exposing raw errors', async (providerError, command, expectedCode) => {
    const redis = new UpstashCompatibleFake();
    redis.fail = { command, error: providerError };
    const store = createRedisSessionStore(redis);
    const operation = command === 'EVAL'
      ? store.compareAndSet('bounded-key', 'old', 'new')
      : store.get('bounded-key');
    await expect(operation).rejects.toMatchObject({ code: expectedCode, status: 503 });
  });

  it('rotates an expired durable session instead of restoring stale state', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));
    const redis = new UpstashCompatibleFake();
    setDurableSessionStoreForTests(createRedisSessionStore(redis));
    const initial = await readChallengeSession(readRequest(), DEMO_WORKSPACE_ID);
    vi.advanceTimersByTime(25 * 60 * 60 * 1000);
    const replacement = await readChallengeSession(readRequest(initial.token), DEMO_WORKSPACE_ID);
    expect(replacement.token).not.toBe(initial.token);
    expect(replacement.status).toBe('NEW');
    expect(redis.commands).toContain('DEL');
  });
});
