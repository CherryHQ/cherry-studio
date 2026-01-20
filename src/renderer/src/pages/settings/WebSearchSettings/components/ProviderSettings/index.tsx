import { getProviderLogo, getProviderWebsites } from '@renderer/config/webSearch'
import { useWebSearchProvider } from '@renderer/hooks/useWebSearch'
import { getProviderType } from '@renderer/utils/websearch'
import { useParams } from '@tanstack/react-router'
import { ExternalLink } from 'lucide-react'
import type { FC } from 'react'

import ApiProviderSettings from './ApiProviderSettings'
import LocalProviderSettings from './LocalProviderSettings'

const WebSearchProviderSetting: FC = () => {
  const params = useParams({ strict: false }) as { providerId?: string }
  const providerId = params.providerId

  const { provider, updateProvider } = useWebSearchProvider(providerId ?? '')

  if (!providerId || !provider) {
    return null
  }

  const websites = getProviderWebsites(provider.id)
  const officialWebsite = websites?.official
  const providerLogo = getProviderLogo(provider.id)
  const isLocalProvider = getProviderType(provider) === 'local'

  return (
    <div className="w-full px-4 py-2">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          {providerLogo ? (
            <img src={providerLogo} alt={provider.name} className="h-5 w-5 object-contain" />
          ) : (
            <div className="h-5 w-5 rounded" />
          )}
          <span className="font-medium text-sm">{provider.name}</span>
          {officialWebsite && websites && (
            <a target="_blank" href={websites.official} rel="noopener noreferrer">
              <ExternalLink size={12} />
            </a>
          )}
        </div>
        <div className="border-border border-b" />
        {isLocalProvider ? (
          <LocalProviderSettings provider={provider} />
        ) : (
          <ApiProviderSettings provider={provider} updateProvider={updateProvider} />
        )}
      </div>
    </div>
  )
}

export default WebSearchProviderSetting
