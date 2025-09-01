import { loggerService } from '@logger'
import { PoeLogo } from '@renderer/components/Icons'
import { PROVIDER_LOGO_MAP } from '@renderer/config/providers'
import { getDefaultProvider } from '@renderer/services/AssistantService'
import ImageStorage from '@renderer/services/ImageStorage'
import { getProviderById } from '@renderer/services/ProviderService'
import { useAppSelector } from '@renderer/store'
import { isSystemProviderId, Provider } from '@renderer/types'
import { generateColorFromChar, getFirstCharacter, getForegroundColor } from '@renderer/utils'
import { Avatar } from 'antd'
import { isEmpty } from 'lodash'
import { useEffect, useState } from 'react'
import styled, { CSSProperties } from 'styled-components'

const logger = loggerService.withContext('useProviderLogo')

export const useProviderAvatar = () => {
  const providers = useAppSelector((state) => state.llm.providers)
  const [providerLogos, setProviderLogos] = useState<Record<string, string>>({})

  useEffect(() => {
    const loadAllLogos = async () => {
      const logos: Record<string, string> = {}
      for (const provider of providers) {
        if (provider.id) {
          try {
            const logoData = await ImageStorage.get(`provider-${provider.id}`)
            if (logoData) {
              logos[provider.id] = logoData
            }
          } catch (error) {
            logger.error(`Failed to load logo for provider ${provider.id}`, error as Error)
          }
        }
      }
      setProviderLogos(logos)
    }

    loadAllLogos()
  }, [providers])

  function ProviderAvatar({
    pid,
    name,
    size,
    style
  }: {
    pid?: string
    name?: string
    size: number
    style?: CSSProperties
  }) {
    let provider: Provider | undefined
    if (pid) {
      // 特殊处理一下svg格式
      const logoSrc = PROVIDER_LOGO_MAP[pid]
      if (isSystemProviderId(pid)) {
        switch (pid) {
          case 'poe':
            return <PoeLogo fontSize={size} style={style} />
        }
      }
      if (logoSrc) {
        return <ProviderLogo draggable="false" shape="circle" src={logoSrc} size={size} style={style} />
      }

      const customLogo = providerLogos[pid]
      if (customLogo) {
        return <ProviderLogo draggable="false" shape="square" src={customLogo} size={size} style={style} />
      }
      if (!name) {
        // generate a avatar for custom provider
        provider = getProviderById(pid)
        if (!provider) {
          provider = getDefaultProvider()
          provider.name = 'Unknown'
          logger.warn('Use default provider as fallback')
        }
      }
    }
    return <GeneratedAvatar name={name ?? provider?.name ?? 'P'} size={size} style={style} />
  }

  function GeneratedAvatar({ name, size, style }: { name: string; size: number; style?: CSSProperties }) {
    const backgroundColor = generateColorFromChar(name)
    const color = name ? getForegroundColor(backgroundColor) : 'white'
    return (
      <ProviderLogo size={size} shape="square" style={{ backgroundColor, color, minWidth: size, ...style }}>
        {getFirstCharacter(!isEmpty(name) ? name : 'P')}
      </ProviderLogo>
    )
  }
  return { ProviderAvatar, GeneratedAvatar, providerLogos, setProviderLogos }
}

const ProviderLogo = styled(Avatar)`
  border: 0.5px solid var(--color-border);
`
