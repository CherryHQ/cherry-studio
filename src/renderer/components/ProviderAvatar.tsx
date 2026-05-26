import type { CompoundIcon } from '@cherrystudio/ui'
import { Avatar, AvatarFallback, AvatarImage } from '@cherrystudio/ui'
import { useTheme } from '@renderer/context/ThemeProvider'
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

  // If logo is a CompoundIcon, render one concrete theme variant to avoid duplicate light/dark SVGs.
  if (resolvedLogo && typeof resolvedLogo !== 'string') {
    const Icon = resolvedLogo
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
