import { z } from 'zod';
import type { ListingProposal, ProductInspection, ProductSummary } from '@/domain/contracts';
import { inspectProductInputSchema, prepareProposalInputSchema, searchProductsInputSchema } from '@/server/schemas';
import { inspectProductToolSchema, prepareListingToolSchema, searchProductsToolSchema } from './tool-contracts';
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
  const schemas: Record<string, z.ZodTypeAny> = { search_products: searchProductsInputSchema, inspect_product: inspectProductInputSchema, prepare_listing_improvement: prepareProposalInputSchema };
  return schemas[toolName]?.parse(value);
}
