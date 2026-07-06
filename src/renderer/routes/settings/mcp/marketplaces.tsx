import { SettingsContentColumn } from '@renderer/components/SettingsPrimitives'
import McpMarketList from '@renderer/pages/settings/McpSettings/McpMarketList'
import { createFileRoute } from '@tanstack/react-router'

const MarketplacesWrapper = () => (
  <SettingsContentColumn>
    <McpMarketList />
  </SettingsContentColumn>
)

export const Route = createFileRoute('/settings/mcp/marketplaces')({
  component: MarketplacesWrapper
})
