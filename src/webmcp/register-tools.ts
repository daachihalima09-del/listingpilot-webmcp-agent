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

let activeController: AbortController | null = null;
const pendingPublishes = new Map<string, Promise<{ result: PublishResult; proposal: ListingProposal }>>();

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? 'The ListingPilot Agent request failed.');
  return body;
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
        const body = await responseJson<{ products: ProductSummary[] }>(await fetcher(`/api/products${params}`, { signal }));
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
        const body = await responseJson<{ inspection: ProductInspection }>(await fetcher(`/api/products/${encodeURIComponent(input.productId)}`, { signal }));
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
        const body = await responseJson<{ proposal: ListingProposal }>(await fetcher('/api/proposals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal }));
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
          pending = (async () => responseJson<{ result: PublishResult; proposal: ListingProposal }>(await fetcher(`/api/proposals/${encodeURIComponent(input.proposalId)}/publish`, {
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

export function registerListingPilotTools(): { supported: boolean; ready: Promise<void>; unregister: () => void } {
  if (typeof document === 'undefined' || !document.modelContext) return { supported: false, ready: Promise.resolve(), unregister: () => undefined };
  activeController?.abort();
  const controller = new AbortController();
  activeController = controller;
  const ready = Promise.all(createWebMcpTools().map((tool) => document.modelContext!.registerTool(tool, { signal: controller.signal }))).then(() => undefined);
  return {
    supported: true,
    ready,
    unregister: () => {
      controller.abort();
      if (activeController === controller) activeController = null;
    },
  };
}

export function parseToolInputForTests(toolName: string, value: unknown) {
  const schemas: Record<string, z.ZodTypeAny> = { search_products: searchProductsInputSchema, inspect_product: inspectProductInputSchema, prepare_listing_improvement: prepareProposalInputSchema, publish_approved_changes: publishProposalInputSchema };
  return schemas[toolName]?.parse(value);
}
