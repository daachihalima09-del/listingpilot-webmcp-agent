import type { ListingProposal, ProductInspection, ProductSummary, PublishResult } from '@/domain/contracts';

export type WebMcpResultEvent =
  | { kind: 'search'; products: ProductSummary[] }
  | { kind: 'inspection'; inspection: ProductInspection }
  | { kind: 'proposal'; proposal: ListingProposal }
  | { kind: 'publish'; proposal: ListingProposal; result: PublishResult };

export const WEBMCP_RESULT_EVENT = 'listingpilot:webmcp-result';

export function revealWebMcpResult(detail: WebMcpResultEvent): void {
  window.dispatchEvent(new CustomEvent<WebMcpResultEvent>(WEBMCP_RESULT_EVENT, { detail }));
}
