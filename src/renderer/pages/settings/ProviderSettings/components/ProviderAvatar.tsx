import type { CSSProperties } from 'react'

import { resolveProviderIconRef, useIcon } from '@cherrystudio/ui/icons'
import { type ProviderAvatarDisplayContext, ProviderAvatarPrimitive } from '@renderer/components/ProviderAvatar'
import type { Provider } from '@shared/data/types/provider'

interface ProviderAvatarProps {
  provider: Pick<Provider, 'id' | 'name' | 'logo' | 'logoSrc' | 'presetProviderId'>
  size?: number
  className?: string
  style?: CSSProperties
  displayContext?: ProviderAvatarDisplayContext
}

export type ProviderAvatarResolution =
  | { kind: 'custom'; logo: string }
  | { kind: 'bundled'; presetId: string }
  | { kind: 'fallback-custom'; sentinelId: string }
  | { kind: 'fallback-preset'; presetId: string }

/**
 * Pure avatar decision for preset-identity collisions. Mirrors
 * `getModelDrawerMode`: unlinked rows (`presetProviderId == null`) never
 * resolve the bundled icon via the raw id, so a pre-existing custom
 * `modelrush` row keeps its saved logo (or initials) instead of the new
 * preset brand. Seeded rows (`preset == id`) resolve to the bundled icon.
 */
export function resolveProviderAvatarResolution(
  provider: Pick<Provider, 'id' | 'logo' | 'logoSrc' | 'presetProviderId'>
): ProviderAvatarResolution {
  const customLogo = provider.logo ?? provider.logoSrc
  if (customLogo) {
    return { kind: 'custom', logo: customLogo }
  }
  const presetId = provider.presetProviderId
  if (presetId) {
    if (resolveProviderIconRef(presetId)) {
      return { kind: 'bundled', presetId }
    }
    return { kind: 'fallback-preset', presetId }
  }
  return { kind: 'fallback-custom', sentinelId: `custom:${provider.id}` }
}

export function ProviderAvatar({ provider, size, className, style, displayContext }: ProviderAvatarProps) {
  // Only rows with persisted preset identity render as system. Mirrors
  // `getModelDrawerMode`: a pre-existing custom row that collides with a later
  // preset id (e.g. `modelrush` created before the preset shipped) keeps custom
  // behavior and must preserve its saved logo.
  const presetId = provider.presetProviderId
  // Existence is decided synchronously from the ref (meta catalog); only the
  // component itself loads async, so the branch below never flip-flops.
  // Resolve via the persisted preset id (not the raw id) so derived instances
  // (`id != preset`) show the preset brand and colliding custom rows never do.
  const systemIconRef = presetId ? resolveProviderIconRef(presetId) : undefined
  const systemIcon = useIcon(systemIconRef)
  // Custom rows carry either a preset brand key (`icon:<id>` on `logo`) or a
  // main-resolved uploaded-logo URL (`logoSrc`). The primitive dispatches on
  // both. Preserve the saved logo first so unlinked colliding rows (and derived
  // instances with user customization) never lose it to a bundled icon.
  const customLogo = provider.logo ?? provider.logoSrc
  if (customLogo) {
    // `customLogo` is truthy, so the primitive skips its own id-based catalog
    // lookup and renders the saved logo (or explicit `icon:` brand pick).
    return (
      <ProviderAvatarPrimitive
        providerId={provider.id}
        providerName={provider.name}
        logo={customLogo}
        size={size}
        className={className}
        style={style}
        displayContext={displayContext}
      />
    )
  }

  if (systemIconRef) {
    return (
      <ProviderAvatarPrimitive
        providerId={presetId ?? provider.id}
        providerName={provider.name}
        logo={systemIcon}
        size={size}
        className={className}
        style={style}
        displayContext={displayContext}
      />
    )
  }

  // Unlinked custom row without a saved logo: never resolve the bundled icon
  // via the raw id. The primitive resolves via `providerId` when `logo` is
  // falsy, so pass a sentinel that cannot match the catalog and fall back to
  // initials instead of a colliding preset icon.
  if (presetId == null) {
    return (
      <ProviderAvatarPrimitive
        providerId={`custom:${provider.id}`}
        providerName={provider.name}
        size={size}
        className={className}
        style={style}
        displayContext={displayContext}
      />
    )
  }

  return (
    <ProviderAvatarPrimitive
      providerId={presetId}
      providerName={provider.name}
      size={size}
      className={className}
      style={style}
      displayContext={displayContext}
    />
  )
}
