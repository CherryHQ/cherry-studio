import { resolveProviderIconRef, useIcon } from '@cherrystudio/ui/icons'
import { getIconDisplayConfig, type IconDisplayContext } from '@renderer/components/icons/iconDisplayConfig'
import { ProviderAvatarPrimitive } from '@renderer/components/ProviderAvatar'
import type { Provider } from '@shared/data/types/provider'
import type { CSSProperties } from 'react'

interface ProviderAvatarProps {
  provider: Pick<Provider, 'id' | 'name' | 'logo' | 'logoSrc'>
  size?: number
  className?: string
  style?: CSSProperties
  displayContext?: IconDisplayContext
}

export function ProviderAvatar({ provider, size, className, style, displayContext }: ProviderAvatarProps) {
  // Existence is decided synchronously from the ref (meta catalog); only the
  // component itself loads async, so the branch below never flip-flops.
  const systemIconRef = resolveProviderIconRef(provider.id)
  const systemIcon = useIcon(systemIconRef)
  // Preset providers render the bundled icon; custom providers carry either a
  // preset brand key (`icon:<id>` on `logo`) or a main-resolved uploaded-logo
  // URL (`logoSrc`). The primitive dispatches on both.
  const customLogo = systemIconRef ? undefined : (provider.logo ?? provider.logoSrc)
  const displayIconId =
    typeof customLogo === 'string' && customLogo.startsWith('icon:') ? customLogo.slice('icon:'.length) : provider.id
  const displayConfig = displayContext ? getIconDisplayConfig(displayContext, displayIconId) : undefined
  const iconStyle: CSSProperties | undefined = displayConfig
    ? {
        width: `${displayConfig.scale * 100}%`,
        height: `${displayConfig.scale * 100}%`,
        flexShrink: 0,
        borderRadius: displayConfig.borderRadius === undefined ? undefined : `${displayConfig.borderRadius}px`,
        overflow: displayConfig.borderRadius === undefined ? undefined : 'hidden'
      }
    : undefined
  if (systemIconRef) {
    return (
      <ProviderAvatarPrimitive
        providerId={provider.id}
        providerName={provider.name}
        logo={systemIcon}
        size={size}
        className={className}
        style={style}
        iconStyle={iconStyle}
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
        iconStyle={iconStyle}
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
      iconStyle={iconStyle}
    />
  )
}
