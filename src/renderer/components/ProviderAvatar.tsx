import type { CompoundIcon } from '@cherrystudio/ui'
import { Avatar, AvatarFallback, AvatarImage } from '@cherrystudio/ui'
import { getProviderIconAssetMetrics, resolveProviderIconRef, useIcon } from '@cherrystudio/ui/icons'
import { cn } from '@cherrystudio/ui/lib/utils'
import { getIconDisplayConfig, type IconDisplayConfig } from '@renderer/components/icons/iconDisplayConfig'
import { getFirstCharacter } from '@renderer/utils/naming'
import { generateColorFromChar, getForegroundColor } from '@renderer/utils/style'
import React from 'react'

export type ProviderAvatarDisplayContext = 'provider-list' | 'sidebar' | 'toolbar'

interface ProviderAvatarPrimitiveProps {
  providerId: string
  providerName: string
  /** CompoundIcon from registry, or custom logo URL string */
  logo?: CompoundIcon | string
  /** @deprecated Use logo instead */
  logoSrc?: string
  size?: number
  className?: string
  style?: React.CSSProperties
  iconStyle?: React.CSSProperties
  displayContext?: ProviderAvatarDisplayContext
  /** Visible artwork size inside compact sidebar and toolbar boxes. */
  artworkSize?: number
}

export const ProviderAvatarPrimitive: React.FC<ProviderAvatarPrimitiveProps> = ({
  providerId,
  providerName,
  logo,
  logoSrc,
  size,
  className,
  style,
  iconStyle,
  displayContext,
  artworkSize
}) => {
  const backgroundColor = generateColorFromChar(providerName)
  const color = providerName ? getForegroundColor(backgroundColor) : 'white'
  const fallbackContent = getFirstCharacter(providerName)
  // Resolve the icon: prefer `logo` prop, fall back to `logoSrc` for backwards compat
  const resolvedLogo = logo ?? logoSrc

  // A logo stored as `icon:<providerId>` references a built-in brand icon from the
  // registry (chosen via the avatar picker). Resolve it back to the CompoundIcon so a
  // custom provider can wear a brand logo, instead of rendering the raw string as an
  // (invalid) image URL. The ref resolves synchronously; the component itself loads
  // async — the initials fallback below covers the brief loading window.
  const explicitBuiltinIconRef =
    typeof resolvedLogo === 'string' && resolvedLogo.startsWith('icon:')
      ? resolveProviderIconRef(resolvedLogo.slice('icon:'.length))
      : undefined
  const providerIconRef = resolvedLogo ? undefined : resolveProviderIconRef(providerId)
  const builtinIconRef = explicitBuiltinIconRef ?? providerIconRef
  const builtinIcon = useIcon(builtinIconRef)
  const effectiveLogo = builtinIcon ?? resolvedLogo
  const isCompactDisplay = displayContext === 'sidebar' || displayContext === 'toolbar'
  const resolvedSize = size ?? 32
  let displayConfig: IconDisplayConfig | undefined
  if (displayContext === 'provider-list') {
    displayConfig = getIconDisplayConfig('provider-list', builtinIconRef?.meta.id ?? providerId)
  } else if (isCompactDisplay && builtinIconRef) {
    const metrics = getProviderIconAssetMetrics({
      kind: builtinIconRef.kind,
      iconId: builtinIconRef.meta.id
    })
    displayConfig = {
      scale: metrics.canvasScale * ((artworkSize ?? resolvedSize) / resolvedSize),
      borderRadius: metrics.kind === 'tile' ? 3 : undefined
    }
  }
  const resolvedIconStyle: React.CSSProperties | undefined = displayConfig
    ? {
        width: `${displayConfig.scale * 100}%`,
        height: `${displayConfig.scale * 100}%`,
        flexShrink: 0,
        borderRadius: displayConfig.borderRadius === undefined ? undefined : `${displayConfig.borderRadius}px`,
        overflow: displayConfig.borderRadius === undefined ? undefined : 'hidden',
        ...iconStyle
      }
    : iconStyle

  // CompoundIcon handles light/dark variants internally; size the icon to the avatar container.
  if (effectiveLogo && typeof effectiveLogo !== 'string') {
    const Icon = effectiveLogo

    return (
      <Avatar className={className} style={{ width: resolvedSize, height: resolvedSize, ...style }}>
        <AvatarFallback className={cn(isCompactDisplay ? 'bg-transparent' : 'bg-background', 'text-foreground')}>
          <Icon style={{ width: '100%', height: '100%', ...resolvedIconStyle }} />
        </AvatarFallback>
      </Avatar>
    )
  }

  // If logo source is a string URL, render image avatar. An unresolved `icon:` reference
  // (unknown id) is not a URL — fall through to the initial-character fallback below.
  if (typeof effectiveLogo === 'string' && !effectiveLogo.startsWith('icon:')) {
    const compactArtworkSize = artworkSize ?? size

    return (
      <Avatar
        className={cn(isCompactDisplay && 'items-center justify-center rounded-[3px]', className)}
        style={{ width: size, height: size, ...style }}>
        <AvatarImage
          src={effectiveLogo}
          className={cn(
            isCompactDisplay
              ? '-outline-offset-1 rounded-[3px] object-contain outline outline-1 outline-black/10 dark:outline-white/10'
              : 'object-cover'
          )}
          style={
            isCompactDisplay ? { width: compactArtworkSize, height: compactArtworkSize, flexShrink: 0 } : undefined
          }
          draggable={false}
        />
        <AvatarFallback style={{ backgroundColor, color }}>{fallbackContent}</AvatarFallback>
      </Avatar>
    )
  }

  // Default: generate avatar with first character and background color
  return (
    <Avatar
      className={className}
      style={{
        width: size,
        height: size,
        ...style
      }}>
      <AvatarFallback style={{ backgroundColor, color }}>{fallbackContent}</AvatarFallback>
    </Avatar>
  )
}
