import { ProviderAvatar } from '@renderer/components/ProviderAvatar'
import { useAllProviders } from '@renderer/hooks/useProvider'
import ImageStorage from '@renderer/services/ImageStorage'
import type { Provider } from '@renderer/types'
import { getFancyProviderName } from '@renderer/utils'
import { getClaudeSupportedProviders } from '@renderer/utils/provider'
import type { PopoverProps } from 'antd'
import { Popover } from 'antd'
import { ArrowUpRight, HelpCircle } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface AnthropicProviderListPopoverProps {
  /** Callback when provider is clicked */
  onProviderClick?: () => void
  /** Use window.navigate instead of Link (for non-router context like TopView) */
  useWindowNavigate?: boolean
  /** Custom trigger element, defaults to HelpCircle icon */
  children?: ReactNode
  /** Popover placement */
  placement?: PopoverProps['placement']
  /** Custom filter function for providers, defaults to getClaudeSupportedProviders */
  filterProviders?: (providers: Provider[]) => Provider[]
}

const AnthropicProviderListPopover: FC<AnthropicProviderListPopoverProps> = ({
  onProviderClick,
  useWindowNavigate = false,
  children,
  placement = 'right',
  filterProviders = getClaudeSupportedProviders
}) => {
  const { t } = useTranslation()
  const allProviders = useAllProviders()
  const providers = filterProviders(allProviders)
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
          } catch {
            // Ignore errors loading logos
          }
        }
      }
      setProviderLogos(logos)
    }

    loadAllLogos()
  }, [providers])

  const handleClick = (providerId: string) => {
    onProviderClick?.()
    if (useWindowNavigate) {
      window.navigate(`/settings/provider?id=${providerId}`)
    }
  }

  const content = (
    <PopoverContent>
      <PopoverTitle>{t('code.supported_providers')}</PopoverTitle>
      <ProviderListContainer>
        {providers.map((provider) =>
          useWindowNavigate ? (
            <ProviderItem key={provider.id} onClick={() => handleClick(provider.id)}>
              <ProviderAvatar
                provider={provider}
                customLogos={providerLogos}
                size={20}
                style={{ width: 20, height: 20 }}
              />
              {getFancyProviderName(provider)}
              <ArrowUpRight size={14} />
            </ProviderItem>
          ) : (
            <ProviderLink
              key={provider.id}
              href={`/settings/provider?id=${provider.id}`}
              onClick={() => handleClick(provider.id)}>
              <ProviderAvatar
                provider={provider}
                customLogos={providerLogos}
                size={20}
                style={{ width: 20, height: 20 }}
              />
              {getFancyProviderName(provider)}
              <ArrowUpRight size={14} />
            </ProviderLink>
          )
        )}
      </ProviderListContainer>
    </PopoverContent>
  )

  return (
    <Popover content={content} trigger="hover" placement={placement}>
      {children || <HelpCircle size={14} style={{ color: 'var(--color-text-3)', cursor: 'pointer' }} />}
    </Popover>
  )
}

const PopoverContent = styled.div`
  width: 200px;
`

const PopoverTitle = styled.div`
  margin-bottom: 8px;
  font-weight: 500;
`

const ProviderListContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const ProviderItem = styled.div`
  color: var(--color-text);
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  &:hover {
    color: var(--color-link);
  }
`

const ProviderLink = styled.a`
  color: var(--color-text);
  display: flex;
  align-items: center;
  gap: 4px;
  text-decoration: none;
  &:hover {
    color: var(--color-link);
  }
`

export default AnthropicProviderListPopover
