import { SettingContainer } from '@renderer/pages/settings'
import EnvironmentDependencies from '@renderer/pages/settings/MCPSettings/EnvironmentDependencies'
import { createFileRoute } from '@tanstack/react-router'

const PluginsWrapper = () => (
  <SettingContainer className="bg-transparent">
    <div className="mx-auto flex w-full max-w-5xl flex-col">
      <EnvironmentDependencies />
    </div>
  </SettingContainer>
)

export const Route = createFileRoute('/settings/plugins')({
  component: PluginsWrapper
})
