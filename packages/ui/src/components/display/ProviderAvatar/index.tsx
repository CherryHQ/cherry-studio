// Original path: src/renderer/src/components/ProviderAvatar.tsx
import { Avatar } from '@heroui/react'
import React from 'react'

import { generateColorFromChar, getFirstCharacter, getForegroundColor } from './utils'

interface ProviderAvatarProps {
  providerId: string
  providerName: string
  logoSrc?: string
  size?: 'sm' | 'md' | 'lg' | number
  className?: string
  style?: React.CSSProperties
  renderCustomLogo?: (providerId: string) => React.ReactNode
}

export const ProviderAvatar: React.FC<ProviderAvatarProps> = ({
  providerId,
  providerName,
  logoSrc,
  size = 'md',
  className = '',
  style,
  renderCustomLogo
}) => {
  // Convert numeric size to HeroUI size props
  const getAvatarSize = () => {
    if (typeof size === 'number') {
      // For custom numeric sizes, we'll use style override
      return 'md'
    }
    return size
  }

  const getCustomStyle = () => {
    const baseStyle: React.CSSProperties = {
      ...style
    }

    if (typeof size === 'number') {
      baseStyle.width = `${size}px`
      baseStyle.height = `${size}px`
    }

    return baseStyle
  }

  // Check if custom logo renderer is provided for special providers
  if (renderCustomLogo) {
    const customLogo = renderCustomLogo(providerId)
    if (customLogo) {
      return (
        <div
          className={`flex items-center justify-center rounded-full border border-gray-200 dark:border-gray-700 ${className}`}
          style={getCustomStyle()}>
          <div className="w-4/5 h-4/5 flex items-center justify-center">{customLogo}</div>
        </div>
      )
    }
  }

  // If logo source is provided, render image avatar
  if (logoSrc) {
    return (
      <Avatar
        src={logoSrc}
        size={getAvatarSize()}
        className={`border border-gray-200 dark:border-gray-700 ${className}`}
        style={getCustomStyle()}
        imgProps={{ draggable: false }}
      />
    )
  }

  // Default: generate avatar with first character and background color
  const backgroundColor = generateColorFromChar(providerName)
  const color = providerName ? getForegroundColor(backgroundColor) : 'white'

  return (
    <Avatar
      name={getFirstCharacter(providerName)}
      size={getAvatarSize()}
      className={`border border-gray-200 dark:border-gray-700 ${className}`}
      style={{
        backgroundColor,
        color,
        ...getCustomStyle()
      }}
    />
  )
}

export default ProviderAvatar
