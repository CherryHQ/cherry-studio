import { getProviderLogo, getProviderWebsites } from '@renderer/config/webSearch'
import { useWebSearchProvider } from '@renderer/hooks/useWebSearch'
import { ExternalLink } from 'lucide-react'
import type { FC } from 'react'

import ApiProviderSettings from './ApiProviderSettings'
import LocalProviderSettings from './LocalProviderSettings'

interface Props {
  providerId: string
}

const WebSearchProviderSetting: FC<Props> = ({ providerId }) => {
  const { provider, updateProvider } = useWebSearchProvider(providerId)

  if (!provider) {
    return null
  }

  const websites = getProviderWebsites(provider.id)
  const officialWebsite = websites?.official
  const providerLogo = getProviderLogo(provider.id)
  const isLocalProvider = provider.id.startsWith('local')

  return (
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
  )
}

export default WebSearchProviderSetting
