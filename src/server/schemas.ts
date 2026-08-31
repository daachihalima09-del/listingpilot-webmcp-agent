import { z } from 'zod';

const productId = z.string().trim().min(1).max(64).regex(/^prod_[a-z0-9_]+$/);

export const searchProductsInputSchema = z.object({
  query: z.string().trim().max(80).optional(),
}).strict();

export const inspectProductInputSchema = z.object({ productId }).strict();

export const prepareProposalInputSchema = z.object({
  productId,
  focus: z.enum(['full_listing', 'title', 'description']).default('full_listing'),
}).strict();

export const approveProposalInputSchema = z.object({
  proposalId: z.string().trim().regex(/^proposal_\d{4,}$/),
  humanConfirmation: z.literal(true),
}).strict();
