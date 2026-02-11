import { useMCPServers } from '@renderer/hooks/useMCPServers'
import ProviderDetail from '@renderer/pages/settings/MCPSettings/McpProviderSettings'
import { providers } from '@renderer/pages/settings/MCPSettings/providers/config'
import { useParams } from '@tanstack/react-router'
import { createFileRoute } from '@tanstack/react-router'

// 通配符路由：捕获 provider 页面 /settings/mcp/:providerKey
const ProviderPage = () => {
  const params = useParams({ strict: false }) as { _splat?: string }
  const providerKey = params._splat
  const { mcpServers } = useMCPServers()

  const provider = providers.find((p) => p.key === providerKey)

  if (!provider) {
    return <div>Provider not found</div>
  }

  return <ProviderDetail provider={provider} existingServers={mcpServers} />
}

export const Route = createFileRoute('/settings/mcp/$')({
  component: ProviderPage
})
