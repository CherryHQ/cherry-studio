import { SettingsContentColumn } from '@renderer/pages/settings'
import BuiltinMcpServerList from '@renderer/pages/settings/McpSettings/BuiltinMcpServerList'
import { createFileRoute } from '@tanstack/react-router'

const BuiltinWrapper = () => (
  <SettingsContentColumn>
    <BuiltinMcpServerList />
  </SettingsContentColumn>
)

export const Route = createFileRoute('/settings/mcp/builtin')({
  component: BuiltinWrapper
})
