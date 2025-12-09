import McpMarketList from '@renderer/pages/settings/MCPSettings/McpMarketList'
import { createFileRoute } from '@tanstack/react-router'

const MarketplacesWrapper = () => (
  <div className="h-full overflow-y-auto p-5">
    <McpMarketList />
  </div>
)

export const Route = createFileRoute('/settings/mcp/marketplaces')({
  component: MarketplacesWrapper
})
