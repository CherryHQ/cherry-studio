import { useMcpServers } from '@renderer/hooks/useMcpServer'
import ProviderDetail from '@renderer/pages/settings/McpSettings/McpProviderSettings'
import { providers } from '@renderer/pages/settings/McpSettings/providers/config'
import { useParams } from '@tanstack/react-router'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

// 通配符路由：捕获 provider 页面 /settings/mcp/:providerKey
const ProviderPage = () => {
  const params = useParams({ strict: false })
  const providerKey = params._splat
  const { mcpServers } = useMcpServers()
  const { t } = useTranslation()

  const provider = providers.find((p) => p.key === providerKey)

  if (!provider) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">{t('provider_not_found')}</div>
    )
  }

  return <ProviderDetail provider={provider} existingServers={mcpServers} />
}

export const Route = createFileRoute('/settings/mcp/$')({
  component: ProviderPage
})
