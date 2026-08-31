import { AgentWorkspace } from '@/components/AgentWorkspace';
import { DEMO_WORKSPACE_ID } from '@/domain/contracts';
import { inspectProduct, searchProducts } from '@/server/challenge-service';

export const dynamic = 'force-dynamic';

export default function Home() {
  const products = searchProducts(DEMO_WORKSPACE_ID);
  const inspection = inspectProduct(DEMO_WORKSPACE_ID, products[0].productId);
  return <AgentWorkspace initialProducts={products} initialInspection={inspection} />;
}
