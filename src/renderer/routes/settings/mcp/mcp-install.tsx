import { createFileRoute } from '@tanstack/react-router'

import { SettingsContentColumn } from '@renderer/components/SettingsPrimitives'
import EnvironmentDependencies from '@renderer/pages/settings/DependenciesSettings/EnvironmentDependencies'

const McpInstallWrapper = () => (
  <SettingsContentColumn className="bg-inherit pt-2">
    <EnvironmentDependencies />
  </SettingsContentColumn>
)

export const Route = createFileRoute('/settings/mcp/mcp-install')({
  component: McpInstallWrapper
})
