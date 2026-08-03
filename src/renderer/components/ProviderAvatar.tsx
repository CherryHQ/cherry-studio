import type { CompoundIcon } from '@cherrystudio/ui'
import { Avatar, AvatarFallback, AvatarImage } from '@cherrystudio/ui'
import { getIconWebpUrl, resolveProviderIconRef, useIcon } from '@cherrystudio/ui/icons'
import { useTheme } from '@renderer/hooks/useTheme'
import { getFirstCharacter } from '@renderer/utils/naming'
import { cn, generateColorFromChar, getForegroundColor } from '@renderer/utils/style'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import React from 'react'

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
}

export const ProviderAvatarPrimitive: React.FC<ProviderAvatarPrimitiveProps> = ({
  providerName,
  logo,
  logoSrc,
  size,
  className,
  style,
  iconStyle
}) => {
  const { theme } = useTheme()
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
  const builtinIconRef =
    typeof resolvedLogo === 'string' && resolvedLogo.startsWith('icon:')
      ? resolveProviderIconRef(resolvedLogo.slice('icon:'.length))
      : undefined
  const builtinWebpUrl = getIconWebpUrl(builtinIconRef, theme === ThemeMode.dark ? 'dark' : 'light')
  const builtinIcon = useIcon(builtinWebpUrl ? undefined : builtinIconRef)
  const effectiveLogo = builtinWebpUrl ?? builtinIcon ?? resolvedLogo

  // CompoundIcon handles light/dark variants internally; size the icon to the avatar container.
  if (effectiveLogo && typeof effectiveLogo !== 'string') {
    const Icon = effectiveLogo
    const resolvedSize = size ?? 32

    return (
      <Avatar className={className} style={{ width: resolvedSize, height: resolvedSize, ...style }}>
        <AvatarFallback className="bg-background text-foreground">
          <Icon style={{ width: '100%', height: '100%', ...iconStyle }} />
        </AvatarFallback>
      </Avatar>
    )
  }

  // If logo source is a string URL, render image avatar. An unresolved `icon:` reference
  // (unknown id) is not a URL — fall through to the initial-character fallback below.
  if (typeof effectiveLogo === 'string' && !effectiveLogo.startsWith('icon:')) {
    return (
      <Avatar
        className={cn(builtinWebpUrl && 'items-center justify-center', className)}
        style={{ width: size, height: size, ...style }}>
        <AvatarImage
          alt=""
          src={effectiveLogo}
          className={builtinWebpUrl ? 'max-w-none bg-background object-contain' : 'object-cover'}
          draggable={false}
          style={builtinWebpUrl ? iconStyle : undefined}
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
