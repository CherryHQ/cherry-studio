import { PoeLogo } from '@renderer/components/Icons'
import { getProviderLogo } from '@renderer/config/providers'
import { Provider } from '@renderer/types'
import { generateColorFromChar, getFirstCharacter, getForegroundColor } from '@renderer/utils'
import { Avatar } from 'antd'
import React from 'react'
import styled from 'styled-components'

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

const ProviderSvgLogo = styled.div`
  width: 100%;
  height: 100%;

  display: flex;
  align-items: center;
  justify-content: center;
  border: 0.5px solid var(--color-border);
  border-radius: 100%;

  & > svg {
    width: 80%;
    height: 80%;
  }
`

const ProviderLogo = styled(Avatar)`
  width: 100%;
  height: 100%;
  border: 0.5px solid var(--color-border);
`

export const ProviderAvatarPrimitive: React.FC<ProviderAvatarPrimitiveProps> = ({
  providerId,
  providerName,
  logoSrc,
  size,
  className,
  style
}) => {
  if (providerId === 'poe') {
    return (
      <ProviderSvgLogo className={className} style={style}>
        <PoeLogo fontSize={size} />
      </ProviderSvgLogo>
    )
  }

  if (logoSrc) {
    return (
      <ProviderLogo draggable="false" shape="circle" src={logoSrc} className={className} style={style} size={size} />
    )
  }

  const backgroundColor = generateColorFromChar(providerName)
  const color = providerName ? getForegroundColor(backgroundColor) : 'white'

  return (
    <ProviderLogo
      size={size}
      shape="circle"
      className={className}
      style={{
        backgroundColor,
        color,
        ...style
      }}>
      {getFirstCharacter(providerName)}
    </ProviderLogo>
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
