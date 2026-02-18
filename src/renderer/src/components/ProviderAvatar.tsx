import type { CompoundIcon } from '@cherrystudio/ui'
import { Avatar } from '@cherrystudio/ui'
import { getProviderLogo } from '@renderer/config/providers'
import type { Provider } from '@renderer/types'
import { cn } from '@renderer/utils'
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
    return <Icon.Avatar size={size} className={className} />
  }

  // If logo source is a string URL, render image avatar
  if (typeof resolvedLogo === 'string') {
    return (
      <Avatar
        src={resolvedLogo}
        radius="full"
        className={cn('border-[0.5px] border-[var(--color-border)]', className)}
        style={{ width: size, height: size, ...style }}
        imgProps={{ draggable: false }}
      />
    )
  }

  // Default: generate avatar with first character and background color
  const backgroundColor = generateColorFromChar(providerName)
  const color = providerName ? getForegroundColor(backgroundColor) : 'white'

  return (
    <Avatar
      radius="full"
      className={cn('border-[0.5px] border-[var(--color-border)]', className)}
      style={{
        width: size,
        height: size,
        backgroundColor,
        color,
        ...style
      }}
      getInitials={getFirstCharacter}
      name={providerName}
    />
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
