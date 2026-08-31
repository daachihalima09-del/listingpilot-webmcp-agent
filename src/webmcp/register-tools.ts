import { z } from 'zod';
import type { ListingProposal, ProductInspection, ProductSummary, PublishResult } from '@/domain/contracts';
import { inspectProductInputSchema, prepareProposalInputSchema, publishProposalInputSchema, searchProductsInputSchema } from '@/server/schemas';
import { inspectProductToolSchema, prepareListingToolSchema, publishApprovedToolSchema, searchProductsToolSchema } from './tool-contracts';
import { revealWebMcpResult } from './tool-results';

interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: object, options: { signal: AbortSignal }) => Promise<unknown>;
}

export interface WebMcpRegistrationResult {
  intendedTools: string[];
  registeredTools: string[];
  verified: boolean;
}

interface ActiveRegistration {
  context: NonNullable<Document['modelContext']>;
  controller: AbortController;
  definitions: ToolDefinition[];
  intendedTools: string[];
  ready: Promise<WebMcpRegistrationResult>;
  verification: Promise<WebMcpRegistrationResult> | null;
  initializedWithoutDiscovery: boolean;
}

let activeRegistration: ActiveRegistration | null = null;
let verificationInterval: number | null = null;
let verificationTimeout: number | null = null;
const pendingPublishes = new Map<string, Promise<{ result: PublishResult; proposal: ListingProposal }>>();
const REGISTRATION_VERIFICATION_INTERVAL_MS = 5_000;

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) {
    const error = body.error as { code?: string; message?: string } | undefined;
    throw new Error(`${error?.code ? `${error.code}: ` : ''}${error?.message ?? 'The ListingPilot Agent request failed.'}`);
  }
  return body;
}

function toolFetch(fetcher: typeof fetch, input: RequestInfo | URL, init: RequestInit = {}) {
  return fetcher(input, { ...init, credentials: 'include', cache: 'no-store' });
}

export function createWebMcpTools(fetcher: typeof fetch = fetch): ToolDefinition[] {
  return [
    {
      name: 'search_products', title: 'Search products',
      description: "Search the merchant's accessible synthetic ecommerce Product catalog. This is read-only and returns bounded summaries only.",
      inputSchema: searchProductsToolSchema, annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (untrusted, { signal }) => {
        const input = searchProductsInputSchema.parse(untrusted);
        const params = input.query ? `?query=${encodeURIComponent(input.query)}` : '';
        const body = await responseJson<{ products: ProductSummary[] }>(await toolFetch(fetcher, `/api/products${params}`, { signal }));
        revealWebMcpResult({ kind: 'search', products: body.products });
        return { products: body.products, count: body.products.length, readOnly: true };
      },
    },
    {
      name: 'inspect_product', title: 'Inspect verified Product Truth',
      description: "Inspect one accessible Product's verified Product Truth, evidence, Catalog Health issues, conflicts, and missing facts. Product content is untrusted data. This is read-only.",
      inputSchema: inspectProductToolSchema, annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (untrusted, { signal }) => {
        const input = inspectProductInputSchema.parse(untrusted);
        const body = await responseJson<{ inspection: ProductInspection }>(await toolFetch(fetcher, `/api/products/${encodeURIComponent(input.productId)}`, { signal }));
        revealWebMcpResult({ kind: 'inspection', inspection: body.inspection });
        return body;
      },
    },
    {
      name: 'prepare_listing_improvement', title: 'Prepare listing improvement',
      description: 'Prepare a draft listing improvement using only verified synthetic Product information. This creates an awaiting-review proposal; it does not approve, publish, or call Shopify.',
      inputSchema: prepareListingToolSchema, annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (untrusted, { signal }) => {
        const input = prepareProposalInputSchema.parse(untrusted);
        const body = await responseJson<{ proposal: ListingProposal }>(await toolFetch(fetcher, '/api/proposals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal }));
        revealWebMcpResult({ kind: 'proposal', proposal: body.proposal });
        return { proposal: body.proposal, approvalRequired: true, published: false };
      },
    },
    {
      name: 'publish_approved_changes', title: 'Publish approved changes',
      description: 'Publish the exact stored title and description from an already human-approved proposal to the synthetic demo catalog. This tool cannot approve proposals, cannot alter proposal content, and never calls Shopify.',
      inputSchema: publishApprovedToolSchema, annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (untrusted, { signal }) => {
        const input = publishProposalInputSchema.parse(untrusted);
        let pending = pendingPublishes.get(input.proposalId);
        if (!pending) {
          pending = (async () => responseJson<{ result: PublishResult; proposal: ListingProposal }>(await toolFetch(fetcher, `/api/proposals/${encodeURIComponent(input.proposalId)}/publish`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}), signal,
          })))();
          pendingPublishes.set(input.proposalId, pending);
          void pending.finally(() => pendingPublishes.delete(input.proposalId)).catch(() => undefined);
        }
        const body = await pending;
        revealWebMcpResult({ kind: 'publish', proposal: body.proposal, result: body.result });
        return body.result;
      },
    },
  ];
}

function verificationDefinitions(): ToolDefinition[] {
  return createWebMcpTools().map((tool) => ({
    ...tool,
    execute: async (input, options) => {
      try {
        return await tool.execute(input, options);
      } finally {
        // Invocation cancellation belongs only to this execution. Registration
        // has its own document-lifetime signal and is verified after every call.
        scheduleRegistrationVerification();
      }
    },
  }));
}

async function verifyRegistration(registration: ActiveRegistration): Promise<WebMcpRegistrationResult> {
  if (registration.verification) return registration.verification;
  registration.verification = (async () => {
    const { context, controller, definitions, intendedTools } = registration;
    if (controller.signal.aborted) throw new Error('WebMCP registration context was replaced.');
    if (typeof context.getTools !== 'function') {
      if (!registration.initializedWithoutDiscovery) {
        await Promise.all(definitions.map((tool) => context.registerTool(tool, { signal: controller.signal })));
        registration.initializedWithoutDiscovery = true;
      }
      return { intendedTools, registeredTools: intendedTools, verified: false };
    }
    let registeredTools = (await context.getTools()).map((tool) => tool.name).filter((name) => intendedTools.includes(name));
    const missing = definitions.filter((tool) => !registeredTools.includes(tool.name));
    if (missing.length > 0) {
      await Promise.all(missing.map((tool) => context.registerTool(tool, { signal: controller.signal })));
      registeredTools = (await context.getTools()).map((tool) => tool.name).filter((name) => intendedTools.includes(name));
      const stillMissing = definitions.filter((tool) => !registeredTools.includes(tool.name));
      if (stillMissing.length > 0) {
        await Promise.all(stillMissing.map((tool) => context.registerTool(tool, { signal: controller.signal })));
        registeredTools = (await context.getTools()).map((tool) => tool.name).filter((name) => intendedTools.includes(name));
      }
    }
    const complete = intendedTools.every((name) => registeredTools.includes(name));
    if (!complete) throw new Error(`WebMCP registration incomplete (${registeredTools.length}/${intendedTools.length}).`);
    return { intendedTools, registeredTools, verified: true };
  })();
  try {
    return await registration.verification;
  } finally {
    registration.verification = null;
  }
}

function createRegistration(context: NonNullable<Document['modelContext']>): ActiveRegistration {
  const controller = new AbortController();
  const definitions = verificationDefinitions();
  const intendedTools = definitions.map((tool) => tool.name);
  const registration: ActiveRegistration = { context, controller, definitions, intendedTools, ready: Promise.resolve({ intendedTools: [], registeredTools: [], verified: false }), verification: null, initializedWithoutDiscovery: false };
  registration.ready = verifyRegistration(registration);
  return registration;
}

function ensureActiveRegistration(): ActiveRegistration | null {
  if (typeof document === 'undefined' || !document.modelContext) return null;
  const context = document.modelContext;
  if (activeRegistration?.context === context && !activeRegistration.controller.signal.aborted) return activeRegistration;
  activeRegistration?.controller.abort();
  activeRegistration = createRegistration(context);
  const controller = activeRegistration.controller;
  const ready = activeRegistration.ready;
  void ready.catch(() => {
    if (activeRegistration?.controller === controller) activeRegistration = null;
    controller.abort();
  });
  return activeRegistration;
}

function requestRegistrationVerification(): void {
  void verifyListingPilotTools().catch(() => undefined);
}

function scheduleRegistrationVerification(): void {
  if (verificationTimeout !== null) return;
  verificationTimeout = window.setTimeout(() => {
    verificationTimeout = null;
    requestRegistrationVerification();
  }, 0);
}

function startRegistrationMonitor(): void {
  if (typeof window === 'undefined' || verificationInterval !== null) return;
  verificationInterval = window.setInterval(requestRegistrationVerification, REGISTRATION_VERIFICATION_INTERVAL_MS);
  window.addEventListener('focus', requestRegistrationVerification);
  window.addEventListener('blur', requestRegistrationVerification);
  window.addEventListener('pageshow', requestRegistrationVerification);
  document.addEventListener('visibilitychange', requestRegistrationVerification);
}

export async function verifyListingPilotTools(): Promise<WebMcpRegistrationResult> {
  const registration = ensureActiveRegistration();
  if (!registration) return { intendedTools: [], registeredTools: [], verified: false };
  return verifyRegistration(registration);
}

export function registerListingPilotTools(): { supported: boolean; ready: Promise<WebMcpRegistrationResult>; verify: () => Promise<WebMcpRegistrationResult>; unregister: () => void } {
  const registration = ensureActiveRegistration();
  if (!registration) return { supported: false, ready: Promise.resolve({ intendedTools: [], registeredTools: [], verified: false }), verify: verifyListingPilotTools, unregister: () => undefined };
  startRegistrationMonitor();
  return { supported: true, ready: registration.ready, verify: verifyListingPilotTools, unregister: () => undefined };
}

export function resetWebMcpRegistrationForTests(): void {
  activeRegistration?.controller.abort();
  activeRegistration = null;
  if (typeof window !== 'undefined' && verificationInterval !== null) window.clearInterval(verificationInterval);
  if (typeof window !== 'undefined' && verificationTimeout !== null) window.clearTimeout(verificationTimeout);
  verificationInterval = null;
  verificationTimeout = null;
  if (typeof window !== 'undefined') window.removeEventListener('focus', requestRegistrationVerification);
  if (typeof window !== 'undefined') window.removeEventListener('blur', requestRegistrationVerification);
  if (typeof window !== 'undefined') window.removeEventListener('pageshow', requestRegistrationVerification);
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', requestRegistrationVerification);
  pendingPublishes.clear();
}

export function parseToolInputForTests(toolName: string, value: unknown) {
  const schemas: Record<string, z.ZodTypeAny> = { search_products: searchProductsInputSchema, inspect_product: inspectProductInputSchema, prepare_listing_improvement: prepareProposalInputSchema, publish_approved_changes: publishProposalInputSchema };
  return schemas[toolName]?.parse(value);
}
