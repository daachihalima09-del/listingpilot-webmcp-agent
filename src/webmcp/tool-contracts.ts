export const webMcpToolNames = ['search_products', 'inspect_product', 'prepare_listing_improvement', 'publish_approved_changes'] as const;

export const searchProductsToolSchema = {
  type: 'object', additionalProperties: false,
  properties: { query: { type: 'string', maxLength: 80, description: 'Optional product title, brand, category, or type search.' } },
} as const;

export const inspectProductToolSchema = {
  type: 'object', additionalProperties: false,
  properties: { productId: { type: 'string', pattern: '^prod_[a-z0-9_]+$', maxLength: 64, description: 'An accessible Product ID returned by search_products.' } },
  required: ['productId'],
} as const;

export const prepareListingToolSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    productId: { type: 'string', pattern: '^prod_[a-z0-9_]+$', maxLength: 64, description: 'An accessible Product ID returned by search_products.' },
    focus: { type: 'string', enum: ['full_listing', 'title', 'description'], default: 'full_listing', description: 'The listing section to improve.' },
  },
  required: ['productId'],
} as const;

export const publishApprovedToolSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    proposalId: { type: 'string', pattern: '^proposal_[0-9]+$', maxLength: 32, description: 'An already human-approved proposal ID returned by prepare_listing_improvement.' },
  },
  required: ['proposalId'],
} as const;
