// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebMcpTools, parseToolInputForTests, registerListingPilotTools } from './register-tools';
import { webMcpToolNames } from './tool-contracts';

afterEach(() => {
  Reflect.deleteProperty(document, 'modelContext');
  vi.restoreAllMocks();
});

describe('WebMCP contracts', () => {
  it('exposes exactly the three Day 1 tools and no approval or publish tool', () => {
    const tools = createWebMcpTools(vi.fn() as unknown as typeof fetch);
    expect(tools.map((tool) => tool.name)).toEqual(webMcpToolNames);
    expect(tools.some((tool) => /approve|publish/.test(tool.name))).toBe(false);
    expect(tools.find((tool) => tool.name === 'prepare_listing_improvement')?.description).toMatch(/does not approve, publish/i);
  });

  it('uses strict bounded input schemas', () => {
    expect(() => parseToolInputForTests('search_products', { query: 'x'.repeat(81) })).toThrow();
    expect(() => parseToolInputForTests('inspect_product', { productId: '../secret' })).toThrow();
    expect(() => parseToolInputForTests('inspect_product', { productId: 'prod_orion_vx65', approved: true })).toThrow();
    expect(() => parseToolInputForTests('prepare_listing_improvement', { productId: 'prod_orion_vx65', status: 'APPROVED' })).toThrow();
  });

  it('marks data-bearing outputs untrusted and read tools read-only', () => {
    const tools = createWebMcpTools(vi.fn() as unknown as typeof fetch);
    expect(tools.every((tool) => tool.annotations.untrustedContentHint)).toBe(true);
    expect(tools.find((tool) => tool.name === 'search_products')?.annotations.readOnlyHint).toBe(true);
    expect(tools.find((tool) => tool.name === 'inspect_product')?.annotations.readOnlyHint).toBe(true);
    expect(tools.find((tool) => tool.name === 'prepare_listing_improvement')?.annotations.readOnlyHint).toBe(false);
  });

  it('registers stable tools and aborts registrations across Strict Mode remounts', async () => {
    const registrations: Array<{ name: string; signal?: AbortSignal }> = [];
    Object.defineProperty(document, 'modelContext', { configurable: true, value: { registerTool: vi.fn(async (tool: { name: string }, options?: { signal?: AbortSignal }) => { registrations.push({ name: tool.name, signal: options?.signal }); }) } });
    const first = registerListingPilotTools();
    await first.ready;
    const firstSignal = registrations[0].signal;
    const second = registerListingPilotTools();
    await second.ready;
    expect(firstSignal?.aborted).toBe(true);
    expect(registrations.map((entry) => entry.name)).toEqual([...webMcpToolNames, ...webMcpToolNames]);
    second.unregister();
    expect(registrations.at(-1)?.signal?.aborted).toBe(true);
  });

  it('passes the execution AbortSignal to same-origin API requests', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ products: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const tool = createWebMcpTools(fetcher as unknown as typeof fetch)[0];
    const controller = new AbortController();
    await tool.execute({}, { signal: controller.signal });
    expect(fetcher).toHaveBeenCalledWith('/api/products', { signal: controller.signal });
  });
});
