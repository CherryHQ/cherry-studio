import type { CompoundIcon } from '@cherrystudio/ui'
import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { ProviderAvatarPrimitive } from '@renderer/components/ProviderAvatar'
import type { Provider } from '@shared/data/types/provider'
import type { CSSProperties } from 'react'

interface ProviderAvatarProps {
  provider: Pick<Provider, 'id' | 'name'>
  customLogos?: Record<string, string>
  size?: number
  className?: string
  style?: CSSProperties
}

export function ProviderAvatar({ provider, customLogos = {}, size, className, style }: ProviderAvatarProps) {
  const systemIcon = resolveProviderIcon(provider.id)
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

  const customLogo = customLogos[provider.id]
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
