import type { ResolvedWebSearchProvider } from '@shared/data/types/webSearch'
import type { FC } from 'react'

import WebSearchProviderLogo from './WebSearchProviderLogo'

interface WebSearchProviderOptionProps {
  provider: ResolvedWebSearchProvider
}

export const WebSearchProviderOption: FC<WebSearchProviderOptionProps> = ({ provider }) => {
  return (
    <div className="flex items-center gap-2">
      <WebSearchProviderLogo providerId={provider.id} providerName={provider.name} size={16} />
      <span>{provider.name}</span>
    </div>
  )
}
