import 'server-only';

import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { ChallengeSessionDiagnostic } from '@/domain/contracts';
import { CHALLENGE_SESSION_HEADER, CHALLENGE_SESSION_TTL_SECONDS, isChallengeSessionToken } from '@/session/challenge-session';
import { ChallengeError } from './errors';
import { createProductionRedisSessionStore, type SessionStore } from './redis-session-store.server';
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

const memoryStore = new Map<string, string>();
let memoryStoreEnabled = process.env.NODE_ENV !== 'production';
let sessionStoreOverride: SessionStore | null = null;

function stateSecret(): string {
  const configured = process.env.CHALLENGE_STATE_SECRET;
  if (configured && configured.length >= 32) return configured;
  if (process.env.NODE_ENV !== 'production') return 'listingpilot-webmcp-local-development-state-key';
  throw new ChallengeError('SESSION_STORE_UNAVAILABLE', 'Challenge session persistence is not configured.', 503);
}

function store(): SessionStore {
  if (sessionStoreOverride) return sessionStoreOverride;
  if (!memoryStoreEnabled) return createProductionRedisSessionStore();
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
  try {
    return recordSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    const reference = randomUUID();
    console.error('Challenge session record is invalid.', { event: 'challenge.session.corrupt', reference });
    throw new ChallengeError('SESSION_STATE_CORRUPT', 'Stored challenge state is invalid. Reset the demo and try again.', 500, reference);
  }
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

export async function deleteChallengeSessionByRequest(request: Request): Promise<void> {
  const supplied = request.headers.get(CHALLENGE_SESSION_HEADER);
  if (!supplied) return;
  if (!verifySessionToken(supplied)) throw new ChallengeError('SESSION_STATE_INVALID', 'Challenge session state is invalid. Clear site data and try again.', 400);
  await store().delete(sessionKey(supplied));
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
  sessionStoreOverride = null;
}

export function setDurableSessionStoreForTests(testStore: SessionStore): void {
  memoryStore.clear();
  memoryStoreEnabled = true;
  sessionStoreOverride = testStore;
}
