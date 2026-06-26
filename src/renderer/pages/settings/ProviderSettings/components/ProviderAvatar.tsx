import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { useCache } from '@data/hooks/useCache'
import { ProviderAvatarPrimitive } from '@renderer/components/ProviderAvatar'
import { resolveStoredImageSrc } from '@renderer/utils/storedImage'
import type { Provider } from '@shared/data/types/provider'
import type { CSSProperties } from 'react'

interface ProviderAvatarProps {
  provider: Pick<Provider, 'id' | 'name' | 'logo'>
  size?: number
  className?: string
  style?: CSSProperties
}

export function ProviderAvatar({ provider, size, className, style }: ProviderAvatarProps) {
  const systemIcon = resolveProviderIcon(provider.id)
  const [filesPath] = useCache('app.path.files')
  // Preset providers render the bundled icon; only custom providers carry a `logo`.
  // A stored file-id resolves to a file:// URL; `icon:<id>` / remote URLs pass through.
  const customLogo = systemIcon ? undefined : resolveStoredImageSrc(provider.logo, filesPath)
  if (systemIcon) {
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
