import type { CompoundIcon } from '@cherrystudio/ui'
import { Avatar, AvatarFallback, AvatarImage } from '@cherrystudio/ui'
import { getProviderLogo } from '@renderer/config/providers'
import type { Provider } from '@renderer/types'
import { generateColorFromChar, getFirstCharacter, getForegroundColor } from '@renderer/utils'
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
  // Resolve the icon: prefer `logo` prop, fall back to `logoSrc` for backwards compat
  const resolvedLogo = logo ?? logoSrc

  // If logo is a CompoundIcon, render its Avatar sub-component
  if (resolvedLogo && typeof resolvedLogo !== 'string') {
    const Icon = resolvedLogo as CompoundIcon
    const resolvedSize = size ?? (style?.width as number | undefined)
    return <Icon.Avatar size={resolvedSize} className={className} />
  }

  // If logo source is a string URL, render image avatar
  if (typeof resolvedLogo === 'string') {
    return (
      <Avatar className={className} style={{ width: size, height: size, ...style }}>
        <AvatarImage src={resolvedLogo} draggable={false} />
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
  const systemIcon = getProviderLogo(provider.id)
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
