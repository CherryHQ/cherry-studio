import { getWebSearchProviderLogo } from '@renderer/config/webSearchProviders'
import { cn } from '@renderer/utils'
import type { WebSearchProviderId } from '@shared/data/preference/preferenceTypes'
import type { FC } from 'react'

interface WebSearchProviderLogoProps {
  providerId: WebSearchProviderId
  providerName: string
  size?: number
  className?: string
}

const WebSearchProviderLogo: FC<WebSearchProviderLogoProps> = ({ providerId, providerName, size = 15, className }) => {
  const logo = getWebSearchProviderLogo(providerId)

  if (logo) {
    return <logo.Avatar size={size} shape="rounded" className={className} />
  }

  const initial = providerName.trim().charAt(0).toUpperCase() || '?'

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[4px] bg-sky-500 font-bold text-white text-xs leading-none',
        className
      )}
      style={{ width: size, height: size }}>
      {initial}
    </span>
  )
}

export default WebSearchProviderLogo
