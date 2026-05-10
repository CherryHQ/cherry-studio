import { webSearchProviderRequiresApiKey } from '@renderer/config/webSearchProviders'
import type { ResolvedWebSearchProvider } from '@shared/data/types/webSearch'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import WebSearchProviderLogo from './WebSearchProviderLogo'

interface WebSearchProviderOptionProps {
  provider: ResolvedWebSearchProvider
}

export const WebSearchProviderOption: FC<WebSearchProviderOptionProps> = ({ provider }) => {
  const { t } = useTranslation()
  const needsApiKey = webSearchProviderRequiresApiKey(provider.id)

  return (
    <div className="flex items-center gap-2">
      <WebSearchProviderLogo providerId={provider.id} providerName={provider.name} size={16} />
      <span>
        {provider.name}
        {needsApiKey && ` (${t('settings.tool.websearch.apikey')})`}
      </span>
    </div>
  )
}
