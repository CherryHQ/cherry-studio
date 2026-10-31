import { createFileRoute } from '@tanstack/react-router'

import MarketplacePage from '@renderer/pages/marketplace/MarketplacePage'

export const Route = createFileRoute('/app/marketplace')({
  component: MarketplacePage
})
