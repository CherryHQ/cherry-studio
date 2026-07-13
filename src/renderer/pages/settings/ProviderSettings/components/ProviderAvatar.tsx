import { resolveProviderIconRef, useIcon } from '@cherrystudio/ui/icons'
import { ProviderAvatarPrimitive } from '@renderer/components/ProviderAvatar'
import type { Provider } from '@shared/data/types/provider'
import type { CSSProperties } from 'react'

interface ProviderAvatarProps {
  provider: Pick<Provider, 'id' | 'name' | 'logo' | 'logoSrc'>
  size?: number
  className?: string
  style?: CSSProperties
}

export function ProviderAvatar({ provider, size, className, style }: ProviderAvatarProps) {
  // Existence is decided synchronously from the ref (meta catalog); only the
  // component itself loads async, so the branch below never flip-flops.
  const systemIconRef = resolveProviderIconRef(provider.id)
  const systemIcon = useIcon(systemIconRef)
  // Preset providers render the bundled icon; custom providers carry either a
  // preset brand key (`icon:<id>` on `logo`) or a main-resolved uploaded-logo
  // URL (`logoSrc`). The primitive dispatches on both.
  const customLogo = systemIconRef ? undefined : (provider.logo ?? provider.logoSrc)
  if (systemIconRef) {
    return (
      <ProviderAvatarPrimitive
        providerId={provider.id}
        providerName={provider.name}
        logo={systemIcon}
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
