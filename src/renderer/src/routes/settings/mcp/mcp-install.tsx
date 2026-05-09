import { SettingContainer } from '@renderer/pages/settings'
import EnvironmentDependencies from '@renderer/pages/settings/MCPSettings/EnvironmentDependencies'
import { createFileRoute } from '@tanstack/react-router'

const McpInstallWrapper = () => (
  <SettingContainer style={{ backgroundColor: 'inherit' }}>
    <EnvironmentDependencies />
  </SettingContainer>
)

export const Route = createFileRoute('/settings/mcp/mcp-install')({
  component: McpInstallWrapper
})
