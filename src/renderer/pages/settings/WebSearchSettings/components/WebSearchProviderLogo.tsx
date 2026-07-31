import type { FC } from 'react'

import AppLogo from '@renderer/assets/images/logo.png'
import { cn } from '@renderer/utils/style'
import { getWebSearchProviderLogo } from '@renderer/utils/webSearchProviderMeta'
import type { WebSearchProviderId } from '@shared/data/preference/preferenceTypes'

interface WebSearchProviderLogoProps {
  providerId: WebSearchProviderId
  providerName: string
  size?: number
  className?: string
}

const WebSearchProviderLogo: FC<WebSearchProviderLogoProps> = ({ providerId, providerName, size = 15, className }) => {
  if (providerId === 'fetch') {
    return (
      <img
        src={AppLogo}
        alt=""
        draggable={false}
        className={cn('inline-block shrink-0 rounded-[20%] object-cover', className)}
        style={{ width: size, height: size }}
      />
    )
  }

  const logo = getWebSearchProviderLogo(providerId)

  if (logo) {
    return <logo.Avatar size={size} shape="rounded" className={className} />
  }

  const initial = providerName.trim().charAt(0).toUpperCase() || '?'

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-sm bg-sky-500 text-xs leading-none font-bold text-white',
        className
      )}
      style={{ width: size, height: size }}>
      {initial}
    </span>
  )
}

export default WebSearchProviderLogo
