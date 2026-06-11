import { SettingsContentColumn } from '@renderer/pages/settings'
import EnvironmentDependencies from '@renderer/pages/settings/McpSettings/EnvironmentDependencies'
import { createFileRoute } from '@tanstack/react-router'

const PluginsWrapper = () => (
  <SettingsContentColumn className="bg-transparent">
    <EnvironmentDependencies />
  </SettingsContentColumn>
)

export const Route = createFileRoute('/settings/plugins')({
  component: PluginsWrapper
})
