import type { WebSearchProviderId } from '@shared/data/preference/preferenceTypes'
import type { FC, ReactNode } from 'react'

import WebSearchProviderLogo from './WebSearchProviderLogo'

interface WebSearchProviderHeaderProps {
  providerId: WebSearchProviderId
  providerName: string
  description: string
  action?: ReactNode
}

const WebSearchProviderHeader: FC<WebSearchProviderHeaderProps> = ({
  providerId,
  providerName,
  description,
  action
}) => {
  return (
    <div className="mb-5 flex items-center gap-3">
      <WebSearchProviderLogo
        providerId={providerId}
        providerName={providerName}
        size={36}
        className="size-9 rounded-xl"
      />
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-semibold text-foreground/90 text-sm">{providerName}</h3>
        <p className="mt-0.5 truncate text-foreground/35 text-xs leading-tight">{description}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

export default WebSearchProviderHeader
