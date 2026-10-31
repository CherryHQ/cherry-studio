import { createFileRoute } from '@tanstack/react-router'

import MarketplacePage from '@renderer/pages/marketplace/MarketplacePage'

export const Route = createFileRoute('/app/marketplace')({
  validateSearch: (search): { view?: 'mine' } => ({ view: search.view === 'mine' ? 'mine' : undefined }),
  component: MarketplacePage
})
