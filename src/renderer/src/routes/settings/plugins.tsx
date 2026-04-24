import { SettingContainer } from '@renderer/pages/settings'
import InstallNpxUv from '@renderer/pages/settings/MCPSettings/InstallNpxUv'
import { createFileRoute } from '@tanstack/react-router'

const PluginsWrapper = () => (
  <SettingContainer className="bg-transparent">
    <div className="mx-auto flex w-full max-w-5xl flex-col">
      <InstallNpxUv />
    </div>
  </SettingContainer>
)

export const Route = createFileRoute('/settings/plugins')({
  component: PluginsWrapper
})
