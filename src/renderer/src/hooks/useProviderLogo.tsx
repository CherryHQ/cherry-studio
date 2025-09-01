import { loggerService } from '@logger'
import { PoeLogo } from '@renderer/components/Icons'
import { PROVIDER_LOGO_MAP } from '@renderer/config/providers'
import { getDefaultProvider } from '@renderer/services/AssistantService'
import ImageStorage from '@renderer/services/ImageStorage'
import { getProviderById } from '@renderer/services/ProviderService'
import { useAppSelector } from '@renderer/store'
import { isSystemProviderId } from '@renderer/types'
import { generateColorFromChar, getFirstCharacter, getForegroundColor } from '@renderer/utils'
import { Avatar } from 'antd'
import { useEffect, useState } from 'react'
import styled from 'styled-components'

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

  function getProviderAvatar(providerId: string, size: number = 16) {
    // 特殊处理一下svg格式
    const logoSrc = PROVIDER_LOGO_MAP[providerId]
    if (isSystemProviderId(providerId)) {
      switch (providerId) {
        case 'poe':
          return <PoeLogo fontSize={size} />
      }
    }
    if (logoSrc) {
      return <ProviderLogo draggable="false" shape="circle" src={logoSrc} size={size} />
    }

    const customLogo = providerLogos[providerId]
    if (customLogo) {
      return <ProviderLogo draggable="false" shape="square" src={customLogo} size={size} />
    }

    // generate a avatar for custom provider
    let provider = getProviderById(providerId)
    if (!provider) {
      provider = getDefaultProvider()
      provider.name = 'Unknown'
      logger.warn('Use default provider as fallback')
    }
    const backgroundColor = generateColorFromChar(provider.name)
    const color = provider.name ? getForegroundColor(backgroundColor) : 'white'

    return (
      <ProviderLogo size={size} shape="square" style={{ backgroundColor, color, minWidth: size }}>
        {getFirstCharacter(provider.name)}
      </ProviderLogo>
    )
  }
  return { getProviderAvatar, providerLogos, setProviderLogos }
}

const ProviderLogo = styled(Avatar)`
  border: 0.5px solid var(--color-border);
`
