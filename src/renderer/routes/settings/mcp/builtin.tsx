import { SettingsContentColumn } from '@renderer/components/SettingsPrimitives'
import BuiltinMcpServerList from '@renderer/pages/settings/McpSettings/BuiltinMcpServerList'
import { createFileRoute } from '@tanstack/react-router'

const BuiltinWrapper = () => (
  <SettingsContentColumn className="pt-2">
    <BuiltinMcpServerList />
  </SettingsContentColumn>
)

export const Route = createFileRoute('/settings/mcp/builtin')({
  component: BuiltinWrapper
})
