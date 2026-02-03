import { SettingContainer } from '@renderer/pages/settings'
import InstallNpxUv from '@renderer/pages/settings/MCPSettings/InstallNpxUv'
import { createFileRoute } from '@tanstack/react-router'

const McpInstallWrapper = () => (
  <SettingContainer style={{ backgroundColor: 'inherit' }}>
    <InstallNpxUv />
  </SettingContainer>
)

export const Route = createFileRoute('/settings/mcp/mcp-install')({
  component: McpInstallWrapper
})
