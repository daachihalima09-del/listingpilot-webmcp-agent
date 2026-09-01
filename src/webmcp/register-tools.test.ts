// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebMcpTools, parseToolInputForTests, registerListingPilotTools, resetWebMcpRegistrationForTests } from './register-tools';
import { webMcpToolNames } from './tool-contracts';

afterEach(() => {
  resetWebMcpRegistrationForTests();
  Reflect.deleteProperty(document, 'modelContext');
  window.localStorage.clear();
  vi.unstubAllGlobals();
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

  it('registers exactly four verified tools and preserves them across Strict Mode remounts', async () => {
    const registrations: Array<{ name: string; signal?: AbortSignal }> = [];
    const registered = new Map<string, { name: string }>();
    const context = {
      registerTool: vi.fn(async (tool: { name: string }, options?: { signal?: AbortSignal }) => { registrations.push({ name: tool.name, signal: options?.signal }); registered.set(tool.name, tool); }),
      getTools: vi.fn(async () => [...registered.values()]),
    };
    Object.defineProperty(document, 'modelContext', { configurable: true, value: context });
    const first = registerListingPilotTools();
    const result = await first.ready;
    const firstSignal = registrations[0].signal;
    first.unregister();
    const second = registerListingPilotTools();
    const remountResult = await second.ready;
    expect(firstSignal?.aborted).toBe(false);
    expect(registrations.map((entry) => entry.name)).toEqual(webMcpToolNames);
    expect(result).toEqual({ intendedTools: [...webMcpToolNames], registeredTools: [...webMcpToolNames], verified: true });
    expect(remountResult).toEqual(result);
    second.unregister();
    expect(firstSignal?.aborted).toBe(false);
    expect([...registered.keys()].sort()).toEqual([...webMcpToolNames].sort());
  });

  it('detects and retries a missing production registration', async () => {
    const registered = new Map<string, { name: string }>();
    let publishAttempts = 0;
    const context = {
      registerTool: vi.fn(async (tool: { name: string }) => {
        if (tool.name === 'publish_approved_changes' && publishAttempts++ === 0) return;
        registered.set(tool.name, tool);
      }),
      getTools: vi.fn(async () => [...registered.values()]),
    };
    Object.defineProperty(document, 'modelContext', { configurable: true, value: context });
    const registration = registerListingPilotTools();
    const result = await registration.ready;
    expect(result.registeredTools).toEqual(webMcpToolNames);
    expect(publishAttempts).toBe(2);
    expect(context.registerTool).toHaveBeenCalledTimes(5);
  });

  it('recovers one disappeared tool without duplicating healthy registrations', async () => {
    const registered = new Map<string, { name: string }>();
    let toolChange: (() => void) | undefined;
    const context = {
      registerTool: vi.fn(async (tool: { name: string }) => { registered.set(tool.name, tool); }),
      getTools: vi.fn(async () => [...registered.values()]),
      addEventListener: vi.fn((_type: string, listener: () => void) => { toolChange = listener; }),
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(document, 'modelContext', { configurable: true, value: context });
    const registration = registerListingPilotTools();
    await registration.ready;
    expect(context.registerTool).toHaveBeenCalledTimes(4);

    registered.delete('publish_approved_changes');
    const recovered = await registration.verify();
    expect(recovered.registeredTools).toEqual(webMcpToolNames);
    expect(context.registerTool).toHaveBeenCalledTimes(5);

    await registration.verify();
    await registration.verify();
    expect(context.registerTool).toHaveBeenCalledTimes(5);

    registered.delete('inspect_product');
    toolChange?.();
    await vi.waitFor(() => expect(registered.has('inspect_product')).toBe(true));
    expect(context.registerTool).toHaveBeenCalledTimes(6);
    expect([...registered.keys()].sort()).toEqual([...webMcpToolNames].sort());
  });

  it('registers a fresh document after reload without depending on the old context', async () => {
    const firstRegistered = new Map<string, { name: string }>();
    const firstContext = {
      registerTool: vi.fn(async (tool: { name: string }) => { firstRegistered.set(tool.name, tool); }),
      getTools: vi.fn(async () => [...firstRegistered.values()]),
    };
    Object.defineProperty(document, 'modelContext', { configurable: true, value: firstContext });
    await registerListingPilotTools().ready;
    resetWebMcpRegistrationForTests();

    const secondRegistered = new Map<string, { name: string }>();
    const secondContext = {
      registerTool: vi.fn(async (tool: { name: string }) => { secondRegistered.set(tool.name, tool); }),
      getTools: vi.fn(async () => [...secondRegistered.values()]),
    };
    Object.defineProperty(document, 'modelContext', { configurable: true, value: secondContext });
    const reattached = await registerListingPilotTools().ready;
    expect(reattached.registeredTools).toEqual(webMcpToolNames);
    expect(secondContext.registerTool).toHaveBeenCalledTimes(4);
    expect([...secondRegistered.keys()]).toEqual(webMcpToolNames);
  });

  it('keeps publish registered through prepare, blocked publish, approval, and a later turn', async () => {
    const proposal = { proposalId: 'proposal_0002', workspaceId: 'workspace_atlas_demo', productId: 'prod_orion_vx65', focus: 'full_listing', original: { title: 'Old', description: 'Old' }, proposed: { title: 'Safe', description: 'Safe description' }, reasons: [], factRefs: [], evidenceRefs: [], warnings: [], status: 'AWAITING_APPROVAL', preparedAt: new Date().toISOString(), approvedAt: null, publishedAt: null, contentFingerprint: 'a'.repeat(64) };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/proposals') return Response.json({ proposal }, { status: 201 });
      return Response.json({ error: { code: 'HUMAN_APPROVAL_REQUIRED', message: 'Human approval is required before publishing.' } }, { status: 409 });
    });
    vi.stubGlobal('fetch', fetcher);
    const registered = new Map<string, { name: string; execute: (input: object, options: { signal: AbortSignal }) => Promise<unknown> }>();
    const context = {
      registerTool: vi.fn(async (tool: { name: string; execute: (input: object, options: { signal: AbortSignal }) => Promise<unknown> }) => { registered.set(tool.name, tool); }),
      getTools: vi.fn(async () => [...registered.values()]),
    };
    Object.defineProperty(document, 'modelContext', { configurable: true, value: context });
    const registration = registerListingPilotTools();
    await registration.ready;

    await registered.get('prepare_listing_improvement')!.execute({ productId: proposal.productId }, { signal: new AbortController().signal });
    await expect(registered.get('publish_approved_changes')!.execute({ proposalId: proposal.proposalId }, { signal: new AbortController().signal })).rejects.toThrow('HUMAN_APPROVAL_REQUIRED');
    await Promise.resolve();
    expect(registered.has('publish_approved_changes')).toBe(true);

    // Human approval is an HTTP/UI transition, not a WebMCP tool. A later
    // confirmation turn simply verifies the same document registration.
    await registration.verify();
    await registration.verify();
    expect([...registered.keys()]).toEqual(webMcpToolNames);
    expect(registered.has('publish_approved_changes')).toBe(true);
    expect([...registered.keys()].some((name) => /^approve/.test(name))).toBe(false);
  });

  it('does not confuse execution cancellation with registration lifetime', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      return Response.json({ products: [] });
    }));
    const registered = new Map<string, { name: string; execute: (input: object, options: { signal: AbortSignal }) => Promise<unknown> }>();
    const registrationSignals: AbortSignal[] = [];
    const context = {
      registerTool: vi.fn(async (tool: { name: string; execute: (input: object, options: { signal: AbortSignal }) => Promise<unknown> }, options?: { signal?: AbortSignal }) => {
        registered.set(tool.name, tool);
        if (options?.signal) registrationSignals.push(options.signal);
      }),
      getTools: vi.fn(async () => [...registered.values()]),
    };
    Object.defineProperty(document, 'modelContext', { configurable: true, value: context });
    const registration = registerListingPilotTools();
    await registration.ready;
    const execution = new AbortController();
    execution.abort();
    await expect(registered.get('search_products')!.execute({}, { signal: execution.signal })).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    expect(registrationSignals.every((signal) => !signal.aborted)).toBe(true);
    expect([...registered.keys()]).toEqual(webMcpToolNames);
  });

  it('passes the execution AbortSignal to same-origin API requests', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({ products: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const tool = createWebMcpTools(fetcher as typeof fetch)[0];
    const controller = new AbortController();
    await tool.execute({}, { signal: controller.signal });
    const [, init] = fetcher.mock.calls[0];
    expect(init).toMatchObject({ signal: controller.signal, credentials: 'include', cache: 'no-store' });
    expect(init?.headers).toBeInstanceOf(Headers);
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

  it('surfaces the server approval block with its stable error code', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'HUMAN_APPROVAL_REQUIRED', message: 'Human approval is required before publishing.' } }), { status: 409, headers: { 'content-type': 'application/json' } }));
    const tool = createWebMcpTools(fetcher as unknown as typeof fetch).find((item) => item.name === 'publish_approved_changes')!;
    await expect(tool.execute({ proposalId: 'proposal_0001' }, { signal: new AbortController().signal })).rejects.toThrow('HUMAN_APPROVAL_REQUIRED: Human approval is required');
  });
});
