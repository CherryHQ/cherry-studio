import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import type { FC } from 'react'

import WebSearchProviderLogo from './WebSearchProviderLogo'

interface WebSearchProviderOptionProps {
  provider: WebSearchProvider
}

export const WebSearchProviderOption: FC<WebSearchProviderOptionProps> = ({ provider }) => {
  return (
    <div className="flex items-center gap-2">
      <WebSearchProviderLogo providerId={provider.id} providerName={provider.name} size={16} />
      <span>{provider.name}</span>
    </div>
  )
}
