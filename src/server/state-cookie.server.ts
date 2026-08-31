import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { ChallengeSessionDiagnostic } from '@/domain/contracts';
import { ChallengeError } from './errors';
import { createChallengeState, type ChallengeState } from './store';

export const CHALLENGE_STATE_COOKIE = 'listingpilot_challenge_state';
const COOKIE_VERSION = 'v1';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24;

const proposalSchema = z.object({
  proposalId: z.string().regex(/^proposal_\d{4,}$/),
  workspaceId: z.string().min(1).max(64),
  productId: z.string().regex(/^prod_[a-z0-9_]+$/),
  focus: z.enum(['full_listing', 'title', 'description']),
  original: z.object({ title: z.string().max(240), description: z.string().max(1200) }).strict(),
  proposed: z.object({ title: z.string().max(240), description: z.string().max(1200) }).strict(),
  reasons: z.array(z.string().max(240)).max(8),
  factRefs: z.array(z.string().max(80)).max(16),
  evidenceRefs: z.array(z.string().max(80)).max(16),
  warnings: z.array(z.string().max(240)).max(8),
  status: z.enum(['AWAITING_APPROVAL', 'APPROVED', 'PUBLISHED']),
  preparedAt: z.string().datetime(),
  approvedAt: z.string().datetime().nullable(),
  publishedAt: z.string().datetime().nullable(),
  contentFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

const stateSchema = z.object({
  proposals: z.array(proposalSchema).max(4),
  publishedProducts: z.array(z.object({
    productId: z.string().regex(/^prod_[a-z0-9_]+$/),
    title: z.string().max(240),
    description: z.string().max(1200),
    lastPublishedProposalId: z.string().regex(/^proposal_\d{4,}$/),
    publishedAt: z.string().datetime(),
    revision: z.number().int().positive(),
  }).strict()).max(3),
  audit: z.array(z.object({
    id: z.string().regex(/^audit_\d{4,}$/),
    workspaceId: z.string().min(1).max(64),
    type: z.enum(['PRODUCT_SEARCHED', 'PRODUCT_INSPECTED', 'PROPOSAL_PREPARED', 'PROPOSAL_APPROVED', 'PUBLISH_ATTEMPTED', 'PUBLISH_BLOCKED', 'PUBLISH_SUCCEEDED', 'PUBLISH_DUPLICATE_IGNORED']),
    productId: z.string().regex(/^prod_[a-z0-9_]+$/).nullable(),
    proposalId: z.string().regex(/^proposal_\d{4,}$/).nullable(),
    occurredAt: z.string().datetime(),
  }).strict()).max(12),
  sequence: z.number().int().nonnegative(),
}).strict();

function stateSecret(): string {
  const configured = process.env.CHALLENGE_STATE_SECRET;
  if (configured && configured.length >= 32) return configured;
  if (process.env.NODE_ENV !== 'production') return 'listingpilot-webmcp-local-development-state-key';
  throw new ChallengeError('INVALID_TRANSITION', 'Challenge state persistence is not configured.', 503);
}

function sign(payload: string): string {
  return createHmac('sha256', stateSecret()).update(`${COOKIE_VERSION}.${payload}`).digest('base64url');
}

function encodeState(state: ChallengeState): string {
  const parsed = stateSchema.parse(state);
  const payload = deflateRawSync(Buffer.from(JSON.stringify(parsed))).toString('base64url');
  return `${COOKIE_VERSION}.${payload}.${sign(payload)}`;
}

function decodeState(value: string): ChallengeState {
  const [version, payload, signature, ...extra] = value.split('.');
  if (version !== COOKIE_VERSION || !payload || !signature || extra.length > 0) throw new Error('Invalid state envelope.');
  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new Error('Invalid state signature.');
  const json = inflateRawSync(Buffer.from(payload, 'base64url')).toString('utf8');
  return stateSchema.parse(JSON.parse(json));
}

function cookieValue(request: Request): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    const name = pair.slice(0, separator).trim();
    if (name === CHALLENGE_STATE_COOKIE) return decodeURIComponent(pair.slice(separator + 1).trim());
  }
  return undefined;
}

export interface ChallengeSession {
  state: ChallengeState;
  cookieStatus: ChallengeSessionDiagnostic['stateCookie'];
}

export function readChallengeSession(request: Request): ChallengeSession {
  const value = cookieValue(request);
  if (!value) return { state: createChallengeState(), cookieStatus: 'MISSING_NEW_SESSION' };
  try {
    return { state: decodeState(value), cookieStatus: 'VALID' };
  } catch {
    throw new ChallengeError('SESSION_STATE_INVALID', 'Challenge session state is invalid. Reset the demo and try again.', 400);
  }
}

export function readChallengeState(request: Request): ChallengeState {
  return readChallengeSession(request).state;
}

export function challengeSessionDiagnostic(session: ChallengeSession, proposalId?: string): ChallengeSessionDiagnostic {
  const proposal = proposalId ? session.state.proposals.find((item) => item.proposalId === proposalId) : undefined;
  return {
    stateCookie: session.cookieStatus,
    proposalCount: session.state.proposals.length,
    proposalFound: proposalId ? Boolean(proposal) : null,
    proposalState: proposal?.status ?? null,
  };
}

export function attachChallengeState(response: NextResponse, state: ChallengeState): NextResponse {
  const production = process.env.NODE_ENV === 'production';
  response.cookies.set({
    name: CHALLENGE_STATE_COOKIE,
    value: encodeState(state),
    httpOnly: true,
    sameSite: production ? 'none' : 'lax',
    secure: production,
    partitioned: production,
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}

export function clearChallengeState(response: NextResponse): NextResponse {
  const production = process.env.NODE_ENV === 'production';
  response.cookies.set({ name: CHALLENGE_STATE_COOKIE, value: '', httpOnly: true, sameSite: production ? 'none' : 'lax', secure: production, partitioned: production, path: '/', maxAge: 0 });
  return response;
}

export function encodeChallengeStateForTests(state: ChallengeState): string {
  return encodeState(state);
}
