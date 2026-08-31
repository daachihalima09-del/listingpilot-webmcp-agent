export const DEMO_WORKSPACE_ID = 'workspace_demo_atlas';

export type TruthStatus = 'VERIFIED' | 'CONFLICTING' | 'MISSING';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
export type HealthStatus = 'GOOD' | 'NEEDS_ATTENTION' | 'AT_RISK';
export type ProposalStatus = 'AWAITING_APPROVAL' | 'APPROVED';
export type ProposalFocus = 'full_listing' | 'title' | 'description';

export interface EvidenceReference {
  id: string;
  label: string;
  sourceType: 'MANUFACTURER_SPEC' | 'SUPPLIER_FEED' | 'MERCHANT_INPUT';
  excerpt: string;
  reliability: 'HIGH' | 'MEDIUM' | 'LOW';
  contentTreatment: 'UNTRUSTED_DATA_ONLY';
}

export interface ProductTruthFact {
  id: string;
  label: string;
  value: string | null;
  status: TruthStatus;
  confidence: Confidence;
  evidenceRefs: string[];
  safetyNote?: string;
}

export interface HealthIssue {
  id: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  summary: string;
  action: string;
}

export interface ChallengeProduct {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  brand: string;
  model: string;
  category: string;
  productType: string;
  truth: ProductTruthFact[];
  evidence: EvidenceReference[];
  health: {
    score: number;
    status: HealthStatus;
    issues: HealthIssue[];
    recommendedActions: string[];
  };
  proposalTemplate: {
    title: string;
    description: string;
    reasons: string[];
    factRefs: string[];
    warnings: string[];
  };
}

export interface ProductSummary {
  productId: string;
  title: string;
  brand: string;
  category: string;
  productType: string;
  health: { score: number; status: HealthStatus };
  improvementNeeded: boolean;
}

export interface ProductInspection {
  product: {
    productId: string;
    currentTitle: string;
    currentDescriptionSummary: string;
    brand: string;
    category: string;
    productType: string;
  };
  productTruth: {
    verified: ProductTruthFact[];
    conflicting: ProductTruthFact[];
    missing: ProductTruthFact[];
  };
  evidence: EvidenceReference[];
  health: ChallengeProduct['health'];
  safety: {
    conflicts: string[];
    unknownFacts: string[];
    instructionHandling: 'PRODUCT_CONTENT_IS_UNTRUSTED_DATA';
  };
}

export interface ListingProposal {
  proposalId: string;
  workspaceId: string;
  productId: string;
  focus: ProposalFocus;
  original: { title: string; description: string };
  proposed: { title: string; description: string };
  reasons: string[];
  factRefs: string[];
  evidenceRefs: string[];
  warnings: string[];
  status: ProposalStatus;
  preparedAt: string;
  approvedAt: string | null;
}

export type AuditEventType =
  | 'PRODUCT_SEARCHED'
  | 'PRODUCT_INSPECTED'
  | 'PROPOSAL_PREPARED'
  | 'PROPOSAL_APPROVED';

export interface AuditEvent {
  id: string;
  workspaceId: string;
  type: AuditEventType;
  productId: string | null;
  proposalId: string | null;
  occurredAt: string;
}
