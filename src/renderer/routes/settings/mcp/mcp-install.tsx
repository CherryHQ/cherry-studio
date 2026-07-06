import { SettingsContentColumn } from '@renderer/components/SettingsPrimitives'
import EnvironmentDependencies from '@renderer/pages/settings/McpSettings/EnvironmentDependencies'
import { createFileRoute } from '@tanstack/react-router'

const McpInstallWrapper = () => (
  <SettingsContentColumn className="bg-inherit">
    <EnvironmentDependencies />
  </SettingsContentColumn>
)

export const Route = createFileRoute('/settings/mcp/mcp-install')({
  component: McpInstallWrapper
})
