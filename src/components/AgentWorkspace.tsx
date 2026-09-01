'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuditEvent, ChallengeSessionDiagnostic, ListingProposal, ProductInspection, ProductSummary, PublishedProduct } from '@/domain/contracts';
import { registerListingPilotTools } from '@/webmcp/register-tools';
import { WEBMCP_RESULT_EVENT, type WebMcpResultEvent } from '@/webmcp/tool-results';
import { challengeFetch, clearChallengeSession } from '@/session/challenge-fetch';

type WebMcpState = 'checking' | 'ready' | 'unsupported' | 'error';

const proposalStateRank: Record<ListingProposal['status'], number> = {
  AWAITING_APPROVAL: 0,
  APPROVED: 1,
  PUBLISHED: 2,
};

const recommendedAgentPrompt = 'Review this catalog. Find the product that most needs improvement, inspect its Product Truth, and prepare a safer listing using only verified facts. Do not approve or publish anything.';

function keepNewestProposal(current: ListingProposal | null, incoming: ListingProposal | null): ListingProposal | null {
  if (!incoming) return current;
  if (!current || current.proposalId !== incoming.proposalId) return incoming;
  return proposalStateRank[incoming.status] >= proposalStateRank[current.status] ? incoming : current;
}

async function jsonRequest<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await challengeFetch(fetch, input, init);
  const body = await response.json() as T & { error?: { message?: string; reference?: string } };
  if (!response.ok) {
    const reference = body.error?.reference ? ` Reference: ${body.error.reference}.` : '';
    throw new Error(`${body.error?.message ?? 'The request could not be completed.'}${reference}`);
  }
  return body;
}

function StatusPill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'good' | 'warn' | 'danger' | 'neutral' }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export function AgentWorkspace({ initialProducts, initialInspection }: { initialProducts: ProductSummary[]; initialInspection: ProductInspection }) {
  const [products, setProducts] = useState(initialProducts);
  const [inspection, setInspection] = useState(initialInspection);
  const [proposal, setProposal] = useState<ListingProposal | null>(null);
  const [activity, setActivity] = useState<AuditEvent[]>([]);
  const [webMcpState, setWebMcpState] = useState<WebMcpState>('checking');
  const [registeredToolCount, setRegisteredToolCount] = useState<number | null>(null);
  const [sessionDiagnostic, setSessionDiagnostic] = useState<ChallengeSessionDiagnostic | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);
  const activityRequestSequence = useRef(0);

  const applyPublishedProduct = useCallback((published: PublishedProduct) => {
    setProducts((current) => current.map((product) => product.productId === published.productId ? { ...product, title: published.title } : product));
    setInspection((current) => current.product.productId === published.productId ? { ...current, product: { ...current.product, currentTitle: published.title, currentDescriptionSummary: published.description.slice(0, 240) } } : current);
  }, []);

  const loadActivity = useCallback(async () => {
    const requestSequence = ++activityRequestSequence.current;
    const body = await jsonRequest<{ activity: AuditEvent[]; latestProposal: ListingProposal | null; publishedProducts: PublishedProduct[]; diagnostic: ChallengeSessionDiagnostic }>('/api/activity');
    if (requestSequence !== activityRequestSequence.current) return;
    setActivity(body.activity);
    setProposal((current) => keepNewestProposal(current, body.latestProposal));
    body.publishedProducts.forEach(applyPublishedProduct);
    setSessionDiagnostic(body.diagnostic);
  }, [applyPublishedProduct]);

  useEffect(() => {
    const registration = registerListingPilotTools();
    if (!registration.supported) queueMicrotask(() => setWebMcpState('unsupported'));
    else registration.ready.then((result) => { setRegisteredToolCount(result.registeredTools.length); setWebMcpState(result.registeredTools.length === 4 ? 'ready' : 'error'); }).catch(() => setWebMcpState('error'));
    const handleResult = (event: Event) => {
      const detail = (event as CustomEvent<WebMcpResultEvent>).detail;
      if (detail.kind === 'search') setProducts(detail.products);
      if (detail.kind === 'inspection') setInspection(detail.inspection);
      if (detail.kind === 'proposal') setProposal((current) => keepNewestProposal(current, detail.proposal));
      if (detail.kind === 'publish') { setProposal((current) => keepNewestProposal(current, detail.proposal)); applyPublishedProduct(detail.result.publishedProduct); }
      setError(null);
      void loadActivity();
    };
    window.addEventListener(WEBMCP_RESULT_EVENT, handleResult);
    queueMicrotask(() => void loadActivity());
    return () => {
      registration.unregister();
      window.removeEventListener(WEBMCP_RESULT_EVENT, handleResult);
    };
  }, [applyPublishedProduct, loadActivity]);

  async function selectProduct(productId: string) {
    setBusy(`inspect:${productId}`); setError(null); setProposal(null);
    try {
      const body = await jsonRequest<{ inspection: ProductInspection }>(`/api/products/${encodeURIComponent(productId)}`);
      setInspection(body.inspection); await loadActivity();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Product inspection failed.'); }
    finally { setBusy(null); }
  }

  async function prepareProposal() {
    setBusy('prepare'); setError(null);
    try {
      const body = await jsonRequest<{ proposal: ListingProposal }>('/api/proposals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId: inspection.product.productId, focus: 'full_listing' }) });
      setProposal(body.proposal); await loadActivity();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Proposal preparation failed.'); }
    finally { setBusy(null); }
  }

  async function approveProposal() {
    if (!proposal) return;
    setBusy('approve'); setError(null);
    try {
      const body = await jsonRequest<{ proposal: ListingProposal; diagnostic: ChallengeSessionDiagnostic }>(`/api/proposals/${encodeURIComponent(proposal.proposalId)}/approve`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-listingpilot-human-action': 'review-ui' }, body: JSON.stringify({ humanConfirmation: true }),
      });
      setProposal((current) => keepNewestProposal(current, body.proposal));
      setSessionDiagnostic(body.diagnostic);
      await loadActivity();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Approval failed.'); }
    finally { setBusy(null); }
  }

  async function resetDemo() {
    setBusy('reset'); setError(null);
    try {
      await jsonRequest<{ reset: true }>('/api/demo/reset', { method: 'POST' });
      clearChallengeSession();
      window.location.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Demo reset failed.'); setBusy(null); }
  }

  async function copyRecommendedPrompt() {
    if (!navigator.clipboard?.writeText) {
      setError('Copy the suggested prompt manually from the card above.');
      return;
    }

    try {
      await navigator.clipboard.writeText(recommendedAgentPrompt);
      setPromptCopied(true);
    } catch {
      setError('Copy the suggested prompt manually from the card above.');
    }
  }

  const tone = inspection.health.status === 'GOOD' ? 'good' : inspection.health.status === 'AT_RISK' ? 'danger' : 'warn';

  return <main>
    <header className="topbar">
      <div className="brand-mark" aria-hidden="true">LP</div>
      <div><p className="eyebrow">LISTINGPILOT AGENT / WEBMCP COMMERCE COPILOT</p><h1>AI speed. Verified truth. Human control.</h1><p className="subtitle">Give your AI agent a commerce goal while the merchant keeps the final decision.</p></div>
      <div className="agent-status" aria-live="polite">
        <span className={`status-dot status-${webMcpState}`} aria-hidden="true" />
        <span><strong>{webMcpState === 'ready' ? 'Agent tools ready' : webMcpState === 'unsupported' ? 'WebMCP preview' : webMcpState === 'error' ? 'Tool registration incomplete' : 'Checking WebMCP'}</strong><small>{webMcpState === 'ready' ? `${registeredToolCount ?? 4}/4 registered · approval stays human-only` : webMcpState === 'unsupported' ? 'Use ChatGPT Browser or enabled Chrome' : webMcpState === 'error' ? `${registeredToolCount ?? 0}/4 registered` : 'Secure registration lifecycle'}</small></span>
      </div>
    </header>

    <section className="agent-hero" aria-labelledby="agent-hero-title">
      <div className="agent-hero-copy">
        <p className="eyebrow">AGENT-NATIVE COMMERCE</p>
        <h2 id="agent-hero-title">Give your AI agent a commerce goal.</h2>
        <p>ListingPilot exposes verified product intelligence and safe actions through WebMCP while keeping final approval with the merchant.</p>
        <div className="prompt-card">
          <div><span>RECOMMENDED AGENT PROMPT</span><p>“{recommendedAgentPrompt}”</p></div>
          <button className="copy-prompt" onClick={() => void copyRecommendedPrompt()}>{promptCopied ? 'Copied' : 'Copy prompt'}</button>
        </div>
      </div>
      <div className="tool-panel" aria-label="WebMCP capabilities">
        <p className="eyebrow">WEBMCP CAPABILITIES</p>
        <ul>
          <li><code>search_products</code><span>Find catalog opportunities</span></li>
          <li><code>inspect_product_truth</code><span>Read verified product facts</span></li>
          <li><code>prepare_listing_improvement</code><span>Prepare a safe proposal</span></li>
          <li><code>publish_approved_changes</code><span>Only after human approval</span></li>
        </ul>
        <p className="human-only-note"><strong>Human-only:</strong> Approve proposal. Approval is intentionally not exposed as a WebMCP tool.</p>
      </div>
    </section>

    <section className="journey" aria-label="Safe collaboration workflow">
      <span className="journey-active">AI agent · Search catalog</span><i>→</i><span className="journey-active">Inspect Product Truth</span><i>→</i><span className="journey-active">Prepare improvement</span><i>→</i><span className={`human-step ${proposal?.status === 'APPROVED' || proposal?.status === 'PUBLISHED' ? 'journey-active' : ''}`}>Human-only · Approve proposal</span><i>→</i><span className={proposal?.status === 'PUBLISHED' ? 'journey-active' : proposal?.status === 'APPROVED' ? 'journey-waiting' : 'journey-locked'}>Agent · Publish approved changes</span>
    </section>

    {error && <div className="error-banner" role="alert">{error}</div>}

    <div className="workspace-grid">
      <aside className="panel catalog-panel" aria-label="Product catalog">
        <div className="panel-heading"><div><p className="eyebrow">ACCESSIBLE CATALOG</p><h2>Products</h2></div><span className="count">{products.length}</span></div>
        <div className="manual-demo-note"><strong>Manual Demo Controls</strong><p>These controls mirror WebMCP capabilities. For the intended experience, ask your WebMCP-capable agent to perform the workflow.</p></div>
        <div className="product-list">
          {products.map((product) => <button key={product.productId} className={`product-card ${inspection.product.productId === product.productId ? 'selected' : ''}`} onClick={() => void selectProduct(product.productId)} disabled={busy !== null}>
            <span className="product-icon" aria-hidden="true">{product.category === 'Televisions' ? '▣' : product.category === 'Air Treatment' ? '◌' : '⌘'}</span>
            <span className="product-copy"><strong>{product.title}</strong><small>{product.brand} · {product.category}</small><span className="mini-health"><i style={{ width: `${product.health.score}%` }} />{product.health.score}% health</span></span>
          </button>)}
        </div>
        <div className="agent-tip"><span aria-hidden="true">✦</span><p><strong>Try with your agent</strong>Use the recommended prompt above to search, inspect Product Truth, and prepare an improvement.</p></div>
      </aside>

      <section className="panel inspection-panel" aria-labelledby="inspection-title">
        <div className="panel-heading"><div><p className="eyebrow">PRODUCT INSPECTION</p><h2 id="inspection-title">{inspection.product.brand} {inspection.product.productType}</h2><p className="muted">{inspection.product.currentTitle}</p></div><div className="health-score"><strong>{inspection.health.score}</strong><span>/100</span><StatusPill tone={tone}>{inspection.health.status.replace('_', ' ')}</StatusPill></div></div>

        <div className="truth-summary"><div className="truth-verified"><span>VERIFIED</span><strong>{inspection.productTruth.verified.length}</strong><small>Eligible for agent use</small></div><div className="truth-conflicting"><span>CONFLICTING</span><strong>{inspection.productTruth.conflicting.length}</strong><small>Excluded from claims</small></div><div className="truth-missing"><span>MISSING</span><strong>{inspection.productTruth.missing.length}</strong><small>Never invented</small></div></div>

        <section className="truth-section"><h3><span className="truth-icon verified">✓</span>Verified Product Truth</h3><div className="fact-grid">
          {inspection.productTruth.verified.map((fact) => <article className="fact" key={fact.id}><span>{fact.label}</span><strong>{fact.value}</strong><small>{fact.confidence} confidence · {fact.evidenceRefs.join(', ')}</small></article>)}
        </div></section>

        {(inspection.productTruth.conflicting.length > 0 || inspection.productTruth.missing.length > 0) && <section className="truth-section safety-section"><h3><span className="truth-icon warning">!</span>Safety boundaries</h3>
          {inspection.productTruth.conflicting.map((fact) => <div className="safety-row" key={fact.id}><StatusPill tone="danger">CONFLICT</StatusPill><span><strong>{fact.label}</strong><small>{fact.safetyNote}</small></span></div>)}
          {inspection.productTruth.missing.map((fact) => <div className="safety-row" key={fact.id}><StatusPill tone="warn">UNKNOWN</StatusPill><span><strong>{fact.label}</strong><small>Not eligible for generated claims.</small></span></div>)}
        </section>}

        <details className="evidence"><summary>Evidence ledger <span>{inspection.evidence.length} sources</span></summary>{inspection.evidence.map((item) => <article key={item.id}><div><strong>{item.label}</strong><StatusPill tone={item.reliability === 'HIGH' ? 'good' : 'neutral'}>{item.reliability}</StatusPill></div><p>{item.excerpt}</p><small>Treated as untrusted product data · never as instructions</small></article>)}</details>

        <section className="health-issues"><h3>Catalog Health findings</h3>{inspection.health.issues.map((issue) => <article key={issue.id}><StatusPill tone={issue.severity === 'HIGH' ? 'danger' : 'warn'}>{issue.severity}</StatusPill><div><strong>{issue.summary}</strong><p>{issue.action}</p></div></article>)}</section>
      </section>

      <aside className="panel proposal-panel" aria-labelledby="proposal-title">
        <div className="panel-heading"><div><p className="eyebrow">PROPOSED CHANGES</p><h2 id="proposal-title">Human review queue</h2></div>{proposal && <StatusPill tone={proposal.status === 'APPROVED' || proposal.status === 'PUBLISHED' ? 'good' : 'warn'}>{proposal.status.replaceAll('_', ' ')}</StatusPill>}</div>
        {!proposal ? <div className="empty-proposal"><div className="empty-icon">✦</div><h3>No proposal yet</h3><p>The agent can prepare improvements from verified facts. It cannot approve them or publish before human approval.</p><div className="manual-prepare"><span>MANUAL DEMO CONTROL</span><button className="primary" onClick={() => void prepareProposal()} disabled={busy !== null}>{busy === 'prepare' ? 'Preparing…' : 'Prepare safe improvement'}</button></div></div> : <div className="proposal-content">
          <div className="proposal-id">Proposal {proposal.proposalId}</div>
          <section className="diff-block"><h3>Title</h3><div className="before"><span>CURRENT</span><p>{proposal.original.title}</p></div><div className="after"><span>PROPOSED</span><p>{proposal.proposed.title}</p></div></section>
          <section className="diff-block"><h3>Description</h3><div className="before"><span>CURRENT</span><p>{proposal.original.description}</p></div><div className="after"><span>PROPOSED</span><p>{proposal.proposed.description}</p></div></section>
          <section className="proposal-notes"><h3>Why this is safe</h3><ul>{proposal.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>{proposal.warnings.map((warning) => <p className="warning-note" key={warning}>! {warning}</p>)}</section>
          {proposal.status === 'AWAITING_APPROVAL' ? <div className="human-gate"><span aria-hidden="true">⌁</span><div><strong>Human decision required</strong><p>The agent prepared this proposal, but cannot approve its own work.</p></div><button className="primary" onClick={() => void approveProposal()} disabled={busy !== null}>{busy === 'approve' ? 'Approving…' : 'Approve proposal'}</button></div> : proposal.status === 'APPROVED' ? <div className="approved-state"><strong>✓ Approved by human review</strong><p>The proposal is now eligible for the agent’s <code>publish_approved_changes</code> WebMCP action.</p></div> : <div className="approved-state published-state"><strong>✓ Published to the synthetic demo catalog</strong><p>Revision applied {proposal.publishedAt ? new Date(proposal.publishedAt).toLocaleString() : ''}. Duplicate calls are safely ignored.</p></div>}
        </div>}

        <details className="activity"><summary>Recent bounded activity <span>{activity.length}</span></summary>{activity.map((event) => <div key={event.id}><i /><span><strong>{event.type.replaceAll('_', ' ')}</strong><small>{new Date(event.occurredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></span></div>)}</details>
      </aside>
    </div>
    <footer><span>Challenge workspace: Atlas Demo</span><span>Session: {sessionDiagnostic?.sessionState === 'DURABLE' ? 'durable' : sessionDiagnostic ? 'new' : 'checking'} · Proposal: {(proposal?.status ?? sessionDiagnostic?.proposalState)?.replaceAll('_', ' ').toLowerCase() ?? 'none'}</span><span>Synthetic data only · no OpenAI · no Shopify</span><button className="reset-demo" onClick={() => void resetDemo()} disabled={busy !== null}>{busy === 'reset' ? 'Resetting…' : 'Reset demo'}</button></footer>
  </main>;
}
