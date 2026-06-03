import type { CompoundIcon } from '@cherrystudio/ui'
import { Avatar, AvatarFallback, AvatarImage } from '@cherrystudio/ui'
import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import type { Provider } from '@renderer/types'
import { generateColorFromChar, getFirstCharacter, getForegroundColor } from '@renderer/utils'
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
}

interface ProviderAvatarProps {
  provider: Provider
  customLogos?: Record<string, string>
  size?: number
  className?: string
  style?: React.CSSProperties
}

export const ProviderAvatarPrimitive: React.FC<ProviderAvatarPrimitiveProps> = ({
  providerName,
  logo,
  logoSrc,
  size,
  className,
  style
}) => {
  const { theme } = useTheme()
  // Resolve the icon: prefer `logo` prop, fall back to `logoSrc` for backwards compat
  const resolvedLogo = logo ?? logoSrc

  // A logo stored as `icon:<providerId>` references a built-in brand icon from the
  // registry (chosen via the avatar picker). Resolve it back to the CompoundIcon so a
  // custom provider can wear a brand logo, instead of rendering the raw string as an
  // (invalid) image URL.
  const builtinIcon =
    typeof resolvedLogo === 'string' && resolvedLogo.startsWith('icon:')
      ? resolveProviderIcon(resolvedLogo.slice('icon:'.length))
      : undefined
  const effectiveLogo = builtinIcon ?? resolvedLogo

  // If logo is a CompoundIcon, render one concrete theme variant to avoid duplicate light/dark SVGs.
  if (effectiveLogo && typeof effectiveLogo !== 'string') {
    const Icon = effectiveLogo
    const styleSize = typeof style?.width === 'number' ? style.width : undefined
    const resolvedSize = size ?? styleSize ?? 32
    const iconSize = resolvedSize * 0.7

    return (
      <Avatar className={className} style={{ width: resolvedSize, height: resolvedSize, ...style }}>
        <AvatarFallback className="bg-background text-foreground">
          <Icon variant={theme === ThemeMode.dark ? 'dark' : 'light'} style={{ width: iconSize, height: iconSize }} />
        </AvatarFallback>
      </Avatar>
    )
  }

  // If logo source is a string URL, render image avatar. An unresolved `icon:` reference
  // (unknown id) is not a URL — fall through to the initial-character fallback below.
  if (typeof effectiveLogo === 'string' && !effectiveLogo.startsWith('icon:')) {
    return (
      <Avatar className={className} style={{ width: size, height: size, ...style }}>
        <AvatarImage src={effectiveLogo} draggable={false} />
      </Avatar>
    )
  }

  // Default: generate avatar with first character and background color
  const backgroundColor = generateColorFromChar(providerName)
  const color = providerName ? getForegroundColor(backgroundColor) : 'white'

  return (
    <Avatar
      className={className}
      style={{
        width: size,
        height: size,
        ...style
      }}>
      <AvatarFallback style={{ backgroundColor, color }}>{getFirstCharacter(providerName)}</AvatarFallback>
    </Avatar>
  )
}

export const ProviderAvatar: React.FC<ProviderAvatarProps> = ({
  provider,
  customLogos = {},
  className,
  style,
  size
}) => {
  const systemIcon = resolveProviderIcon(provider.id)
  if (systemIcon) {
    return (
      <ProviderAvatarPrimitive
        size={size}
        providerId={provider.id}
        providerName={provider.name}
        logo={systemIcon}
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
