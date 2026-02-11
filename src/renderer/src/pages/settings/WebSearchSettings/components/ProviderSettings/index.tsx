import { getProviderLogo, getProviderWebsites } from '@renderer/config/webSearch'
import { useWebSearchProvider } from '@renderer/hooks/useWebSearch'
import { getProviderType } from '@renderer/utils/webSearch'
import { useParams } from '@tanstack/react-router'
import type { FC } from 'react'

import { ProviderSettingsLayout } from './ProviderSettingsLayout'

const WebSearchProviderSetting: FC = () => {
  const params = useParams({ strict: false }) as { providerId?: string }
  const providerId = params.providerId

  const { provider, updateProvider } = useWebSearchProvider(providerId ?? '')

  if (!providerId || !provider) {
    return null
  }

  const websites = getProviderWebsites(provider.id)
  const providerLogo = getProviderLogo(provider.id)
  const providerType = getProviderType(provider)

  return (
    <ProviderSettingsLayout>
      <ProviderSettingsLayout.Header logoSrc={providerLogo} name={provider.name} officialWebsite={websites?.official} />
      <ProviderSettingsLayout.Divider />
      <ProviderSettingsLayout.Body>
        {providerType === 'local' ? (
          <ProviderSettingsLayout.Local provider={provider} />
        ) : providerType === 'mcp' ? (
          <ProviderSettingsLayout.Mcp provider={provider} updateProvider={updateProvider} />
        ) : (
          <ProviderSettingsLayout.Api provider={provider} updateProvider={updateProvider} />
        )}
      </ProviderSettingsLayout.Body>
    </ProviderSettingsLayout>
  )
}

export default WebSearchProviderSetting
