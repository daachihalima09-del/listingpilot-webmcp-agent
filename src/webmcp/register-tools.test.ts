// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebMcpTools, parseToolInputForTests, registerListingPilotTools } from './register-tools';
import { webMcpToolNames } from './tool-contracts';

afterEach(() => {
  Reflect.deleteProperty(document, 'modelContext');
  vi.restoreAllMocks();
});

describe('WebMCP contracts', () => {
  it('exposes exactly the four Day 2 tools and no approval tool', () => {
    const tools = createWebMcpTools(vi.fn() as unknown as typeof fetch);
    expect(tools.map((tool) => tool.name)).toEqual(webMcpToolNames);
    expect(tools.some((tool) => /^approve/.test(tool.name))).toBe(false);
    expect(tools.filter((tool) => /publish/.test(tool.name)).map((tool) => tool.name)).toEqual(['publish_approved_changes']);
    expect(tools.find((tool) => tool.name === 'prepare_listing_improvement')?.description).toMatch(/does not approve, publish/i);
    expect(tools.find((tool) => tool.name === 'publish_approved_changes')?.description).toMatch(/already human-approved/i);
  });

  it('uses strict bounded input schemas', () => {
    expect(() => parseToolInputForTests('search_products', { query: 'x'.repeat(81) })).toThrow();
    expect(() => parseToolInputForTests('inspect_product', { productId: '../secret' })).toThrow();
    expect(() => parseToolInputForTests('inspect_product', { productId: 'prod_orion_vx65', approved: true })).toThrow();
    expect(() => parseToolInputForTests('prepare_listing_improvement', { productId: 'prod_orion_vx65', status: 'APPROVED' })).toThrow();
    expect(() => parseToolInputForTests('publish_approved_changes', { proposalId: 'proposal_0001', approved: true })).toThrow();
    expect(() => parseToolInputForTests('publish_approved_changes', { proposalId: '../proposal_0001' })).toThrow();
  });

  it('marks data-bearing outputs untrusted and read tools read-only', () => {
    const tools = createWebMcpTools(vi.fn() as unknown as typeof fetch);
    expect(tools.every((tool) => tool.annotations.untrustedContentHint)).toBe(true);
    expect(tools.find((tool) => tool.name === 'search_products')?.annotations.readOnlyHint).toBe(true);
    expect(tools.find((tool) => tool.name === 'inspect_product')?.annotations.readOnlyHint).toBe(true);
    expect(tools.find((tool) => tool.name === 'prepare_listing_improvement')?.annotations.readOnlyHint).toBe(false);
    expect(tools.find((tool) => tool.name === 'publish_approved_changes')?.annotations.readOnlyHint).toBe(false);
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

  it('coalesces rapid duplicate publish calls into one API request', async () => {
    let release!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
    const tool = createWebMcpTools(fetcher as unknown as typeof fetch).find((item) => item.name === 'publish_approved_changes')!;
    const result = { proposalId: 'proposal_0001', productId: 'prod_orion_vx65', status: 'PUBLISHED', publishedFields: ['title', 'description'], humanApprovalConfirmed: true, demoOnly: true, alreadyPublished: false, publishedProduct: { productId: 'prod_orion_vx65', title: 'Safe', description: 'Safe description', lastPublishedProposalId: 'proposal_0001', publishedAt: new Date().toISOString(), revision: 1 }, message: 'Published.' };
    const proposal = { proposalId: 'proposal_0001', workspaceId: 'workspace_atlas_demo', productId: 'prod_orion_vx65', focus: 'full_listing', original: { title: 'Old', description: 'Old' }, proposed: { title: 'Safe', description: 'Safe description' }, reasons: [], factRefs: [], evidenceRefs: [], warnings: [], status: 'PUBLISHED', preparedAt: new Date().toISOString(), approvedAt: new Date().toISOString(), publishedAt: new Date().toISOString(), contentFingerprint: 'a'.repeat(64) };
    const first = tool.execute({ proposalId: 'proposal_0001' }, { signal: new AbortController().signal });
    const second = tool.execute({ proposalId: 'proposal_0001' }, { signal: new AbortController().signal });
    expect(fetcher).toHaveBeenCalledTimes(1);
    release(new Response(JSON.stringify({ result, proposal }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });
});
