import { createFileRoute } from '@tanstack/react-router'

import { SettingsContentColumn } from '@renderer/components/SettingsPrimitives'
import McpMarketList from '@renderer/pages/settings/McpSettings/McpMarketList'

const MarketplacesWrapper = () => (
  <SettingsContentColumn className="pt-2">
    <McpMarketList />
  </SettingsContentColumn>
)

export const Route = createFileRoute('/settings/mcp/marketplaces')({
  component: MarketplacesWrapper
})
