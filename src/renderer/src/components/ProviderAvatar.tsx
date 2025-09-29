import { Avatar, cn } from '@cherrystudio/ui'
import { PoeLogo } from '@renderer/components/Icons'
import { getProviderLogo } from '@renderer/config/providers'
import type { Provider } from '@renderer/types'
import { generateColorFromChar, getFirstCharacter, getForegroundColor } from '@renderer/utils'
import React from 'react'

interface ProviderAvatarPrimitiveProps {
  providerId: string
  providerName: string
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
  providerId,
  providerName,
  logoSrc,
  size,
  className,
  style
}) => {
  // Special handling for Poe provider
  if (providerId === 'poe') {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-full',
          'border-[0.5px] border-[var(--color-border)]',
          className
        )}
        style={{ width: size, height: size, ...style }}>
        <PoeLogo fontSize={size ? size * 0.8 : undefined} />
      </div>
    )
  }

  // If logo source is provided, render image avatar
  if (logoSrc) {
    return (
      <Avatar
        src={logoSrc}
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
      }}>
      {getFirstCharacter(providerName)}
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
  const systemLogoSrc = getProviderLogo(provider.id)
  if (systemLogoSrc) {
    return (
      <ProviderAvatarPrimitive
        size={size}
        providerId={provider.id}
        providerName={provider.name}
        logoSrc={systemLogoSrc}
        className={className}
        style={style}
      />
    )
  }

  const customLogo = customLogos[provider.id]
  if (customLogo) {
    if (customLogo === 'poe') {
      return (
        <ProviderAvatarPrimitive
          size={size}
          providerId="poe"
          providerName={provider.name}
          className={className}
          style={style}
        />
      )
    }

    return (
      <ProviderAvatarPrimitive
        providerId={provider.id}
        providerName={provider.name}
        logoSrc={customLogo}
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
