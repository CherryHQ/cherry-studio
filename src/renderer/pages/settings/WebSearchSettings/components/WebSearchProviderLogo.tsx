import { useIcon } from '@cherrystudio/ui/icons'
import AppLogo from '@renderer/assets/images/logo.png'
import { cn } from '@renderer/utils/style'
import { getWebSearchProviderIconRef } from '@renderer/utils/webSearchProviderMeta'
import type { WebSearchProviderId } from '@shared/data/preference/preferenceTypes'
import type { FC } from 'react'

interface WebSearchProviderLogoProps {
  providerId: WebSearchProviderId
  providerName: string
  size?: number
  className?: string
}

const WebSearchProviderLogo: FC<WebSearchProviderLogoProps> = ({ providerId, providerName, size = 15, className }) => {
  const Icon = useIcon(providerId === 'fetch' ? undefined : getWebSearchProviderIconRef(providerId))

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

  if (Icon) {
    return <Icon.Avatar size={size} shape="rounded" className={className} />
  }

  const initial = providerName.trim().charAt(0).toUpperCase() || '?'

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-sm bg-sky-500 font-bold text-white text-xs leading-none',
        className
      )}
      style={{ width: size, height: size }}>
      {initial}
    </span>
  )
}

export default WebSearchProviderLogo
