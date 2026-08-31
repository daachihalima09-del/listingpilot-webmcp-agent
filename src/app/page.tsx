import { AgentWorkspace } from '@/components/AgentWorkspace';
import { DEMO_WORKSPACE_ID } from '@/domain/contracts';
import { inspectProduct, searchProducts } from '@/server/challenge-service';
import { createChallengeState } from '@/server/store';

export const dynamic = 'force-dynamic';

export default function Home() {
  const initialState = createChallengeState();
  const products = searchProducts(initialState, DEMO_WORKSPACE_ID);
  const inspection = inspectProduct(initialState, DEMO_WORKSPACE_ID, products[0].productId);
  return <AgentWorkspace initialProducts={products} initialInspection={inspection} />;
}
