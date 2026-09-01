import 'server-only';

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Redis } from '@upstash/redis';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { ChallengeSessionDiagnostic } from '@/domain/contracts';
import { CHALLENGE_SESSION_HEADER, CHALLENGE_SESSION_TTL_SECONDS, isChallengeSessionToken } from '@/session/challenge-session';
import { ChallengeError } from './errors';
import { createChallengeState, type ChallengeState } from './store';

const proposalSchema = z.object({
  proposalId: z.string().regex(/^proposal_\d{4,}$/), workspaceId: z.string().min(1).max(64), productId: z.string().regex(/^prod_[a-z0-9_]+$/),
  focus: z.enum(['full_listing', 'title', 'description']), original: z.object({ title: z.string().max(240), description: z.string().max(1200) }).strict(),
  proposed: z.object({ title: z.string().max(240), description: z.string().max(1200) }).strict(), reasons: z.array(z.string().max(240)).max(8),
  factRefs: z.array(z.string().max(80)).max(16), evidenceRefs: z.array(z.string().max(80)).max(16), warnings: z.array(z.string().max(240)).max(8),
  status: z.enum(['AWAITING_APPROVAL', 'APPROVED', 'PUBLISHED']), preparedAt: z.string().datetime(), approvedAt: z.string().datetime().nullable(),
  publishedAt: z.string().datetime().nullable(), contentFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

const challengeStateSchema = z.object({
  proposals: z.array(proposalSchema).max(4),
  publishedProducts: z.array(z.object({
    productId: z.string().regex(/^prod_[a-z0-9_]+$/), title: z.string().max(240), description: z.string().max(1200),
    lastPublishedProposalId: z.string().regex(/^proposal_\d{4,}$/), publishedAt: z.string().datetime(), revision: z.number().int().positive(),
  }).strict()).max(3),
  audit: z.array(z.object({
    id: z.string().regex(/^audit_\d{4,}$/), workspaceId: z.string().min(1).max(64),
    type: z.enum(['PRODUCT_SEARCHED', 'PRODUCT_INSPECTED', 'PROPOSAL_PREPARED', 'PROPOSAL_APPROVED', 'PUBLISH_ATTEMPTED', 'PUBLISH_BLOCKED', 'PUBLISH_SUCCEEDED', 'PUBLISH_DUPLICATE_IGNORED']),
    productId: z.string().regex(/^prod_[a-z0-9_]+$/).nullable(), proposalId: z.string().regex(/^proposal_\d{4,}$/).nullable(), occurredAt: z.string().datetime(),
  }).strict()).max(12),
  sequence: z.number().int().nonnegative(),
}).strict();

const recordSchema = z.object({
  sessionHash: z.string().regex(/^[a-f0-9]{64}$/), workspaceId: z.string().min(1).max(64), revision: z.number().int().nonnegative(),
  expiresAt: z.string().datetime(), state: challengeStateSchema,
}).strict();

type DurableRecord = z.infer<typeof recordSchema>;

export interface ChallengeSession {
  token: string;
  key: string;
  rawRecord: string;
  state: ChallengeState;
  status: ChallengeSessionDiagnostic['sessionState'];
  revision: number;
}

interface SessionStore {
  get(key: string): Promise<string | null>;
  create(key: string, value: string): Promise<boolean>;
  compareAndSet(key: string, expected: string, value: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

const memoryStore = new Map<string, string>();
let memoryStoreEnabled = process.env.NODE_ENV !== 'production';

function stateSecret(): string {
  const configured = process.env.CHALLENGE_STATE_SECRET;
  if (configured && configured.length >= 32) return configured;
  if (process.env.NODE_ENV !== 'production') return 'listingpilot-webmcp-local-development-state-key';
  throw new ChallengeError('SESSION_STORE_UNAVAILABLE', 'Challenge session persistence is not configured.', 503);
}

function redisStore(): SessionStore {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new ChallengeError('SESSION_STORE_UNAVAILABLE', 'Challenge session persistence is not configured.', 503);
  const redis = new Redis({ url, token });
  return {
    get: async (key) => await redis.get<string>(key),
    create: async (key, value) => (await redis.set(key, value, { nx: true, ex: CHALLENGE_SESSION_TTL_SECONDS })) === 'OK',
    compareAndSet: async (key, expected, value) => (await redis.eval<[string, string, number], number>(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3]); return 1 else return 0 end",
      [key], [expected, value, CHALLENGE_SESSION_TTL_SECONDS],
    )) === 1,
    delete: async (key) => { await redis.del(key); },
  };
}

function store(): SessionStore {
  if (!memoryStoreEnabled) return redisStore();
  return {
    get: async (key) => memoryStore.get(key) ?? null,
    create: async (key, value) => { if (memoryStore.has(key)) return false; memoryStore.set(key, value); return true; },
    compareAndSet: async (key, expected, value) => { if (memoryStore.get(key) !== expected) return false; memoryStore.set(key, value); return true; },
    delete: async (key) => { memoryStore.delete(key); },
  };
}

function signature(value: string): string {
  return createHmac('sha256', stateSecret()).update(value).digest('base64url');
}

function newSessionToken(): string {
  const id = randomBytes(32).toString('base64url');
  return `v1.${id}.${signature(`v1.${id}`)}`;
}

function verifySessionToken(value: string): boolean {
  if (!isChallengeSessionToken(value)) return false;
  const [version, id, received] = value.split('.');
  const expected = Buffer.from(signature(`${version}.${id}`));
  const actual = Buffer.from(received);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function sessionKey(token: string): string {
  return `listingpilot:webmcp:v1:${createHash('sha256').update(token).digest('hex')}`;
}

function encodeRecord(record: DurableRecord): string {
  return Buffer.from(JSON.stringify(recordSchema.parse(record))).toString('base64url');
}

function decodeRecord(value: string): DurableRecord {
  return recordSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
}

function freshRecord(token: string, workspaceId: string): DurableRecord {
  return {
    sessionHash: createHash('sha256').update(token).digest('hex'), workspaceId, revision: 0,
    expiresAt: new Date(Date.now() + CHALLENGE_SESSION_TTL_SECONDS * 1000).toISOString(), state: createChallengeState(),
  };
}

export async function readChallengeSession(request: Request, workspaceId: string): Promise<ChallengeSession> {
  const supplied = request.headers.get(CHALLENGE_SESSION_HEADER);
  if (supplied && !verifySessionToken(supplied)) throw new ChallengeError('SESSION_STATE_INVALID', 'Challenge session state is invalid. Reset the demo and try again.', 400);
  let token = supplied ?? newSessionToken();
  let key = sessionKey(token);
  let rawRecord = await store().get(key);
  let status: ChallengeSessionDiagnostic['sessionState'] = 'DURABLE';
  if (!rawRecord) {
    // A missing record means the durable session expired or was reset. Rotate
    // the bearer instead of resurrecting an old identifier with empty state.
    if (supplied) {
      token = newSessionToken();
      key = sessionKey(token);
    }
    const record = freshRecord(token, workspaceId);
    rawRecord = encodeRecord(record);
    if (!await store().create(key, rawRecord)) rawRecord = await store().get(key);
    if (!rawRecord) throw new ChallengeError('SESSION_STORE_UNAVAILABLE', 'Challenge session persistence is temporarily unavailable.', 503);
    status = 'NEW';
  }
  const record = decodeRecord(rawRecord);
  if (new Date(record.expiresAt).getTime() <= Date.now()) {
    await store().delete(key);
    token = newSessionToken();
    key = sessionKey(token);
    const replacement = encodeRecord(freshRecord(token, workspaceId));
    if (!await store().create(key, replacement)) throw new ChallengeError('SESSION_STORE_UNAVAILABLE', 'Challenge session persistence is temporarily unavailable.', 503);
    return { token, key, rawRecord: replacement, state: decodeRecord(replacement).state, status: 'NEW', revision: 0 };
  }
  if (record.workspaceId !== workspaceId || record.sessionHash !== createHash('sha256').update(token).digest('hex')) {
    throw new ChallengeError('SESSION_STATE_INVALID', 'Challenge session state is invalid. Reset the demo and try again.', 400);
  }
  return { token, key, rawRecord, state: record.state, status, revision: record.revision };
}

export async function commitChallengeSession(session: ChallengeSession, workspaceId: string): Promise<void> {
  const next = encodeRecord({
    sessionHash: createHash('sha256').update(session.token).digest('hex'), workspaceId, revision: session.revision + 1,
    expiresAt: new Date(Date.now() + CHALLENGE_SESSION_TTL_SECONDS * 1000).toISOString(), state: session.state,
  });
  if (!await store().compareAndSet(session.key, session.rawRecord, next)) {
    throw new ChallengeError('SESSION_STATE_STALE', 'The challenge session changed in another request. Refresh and try again.', 409);
  }
  session.rawRecord = next;
  session.revision += 1;
  session.status = 'DURABLE';
}

export async function deleteChallengeSession(session: ChallengeSession): Promise<void> {
  await store().delete(session.key);
}

export function attachChallengeSession(response: NextResponse, session: ChallengeSession): NextResponse {
  response.headers.set(CHALLENGE_SESSION_HEADER, session.token);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export function challengeSessionDiagnostic(session: ChallengeSession, proposalId?: string): ChallengeSessionDiagnostic {
  const proposal = proposalId ? session.state.proposals.find((item) => item.proposalId === proposalId) : undefined;
  return { sessionState: session.status, revision: session.revision, proposalCount: session.state.proposals.length, proposalFound: proposalId ? Boolean(proposal) : null, proposalState: proposal?.status ?? null };
}

export function resetDurableSessionStoreForTests(): void {
  memoryStore.clear();
  memoryStoreEnabled = true;
}
