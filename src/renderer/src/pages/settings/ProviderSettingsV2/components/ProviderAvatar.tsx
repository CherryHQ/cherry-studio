import type { CompoundIcon } from '@cherrystudio/ui'
import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { ProviderAvatarPrimitive } from '@renderer/components/ProviderAvatar'
import type { Provider } from '@shared/data/types/provider'
import type { CSSProperties } from 'react'

import { useProviderLogo } from '../hooks/useProviderLogo'

interface ProviderAvatarProps {
  provider: Pick<Provider, 'id' | 'name'>
  size?: number
  className?: string
  style?: CSSProperties
}

export function ProviderAvatar({ provider, size, className, style }: ProviderAvatarProps) {
  const systemIcon = resolveProviderIcon(provider.id)
  const { logo: customLogo } = useProviderLogo(systemIcon ? undefined : provider.id)
  if (systemIcon) {
    return (
      <ProviderAvatarPrimitive
        providerId={provider.id}
        providerName={provider.name}
        logo={systemIcon as CompoundIcon}
        size={size}
        className={className}
        style={style}
      />
    )
  }

  if (customLogo) {
    return (
      <ProviderAvatarPrimitive
        providerId={provider.id}
        providerName={provider.name}
        logo={customLogo}
        size={size}
        className={className}
        style={style}
      />
    )
  }

  return (
    <ProviderAvatarPrimitive
      providerId={provider.id}
      providerName={provider.name}
      size={size}
      className={className}
      style={style}
    />
  )
}
