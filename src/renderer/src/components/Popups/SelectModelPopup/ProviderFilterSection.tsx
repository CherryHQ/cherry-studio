import CustomTag from '@renderer/components/Tags/CustomTag'
import type { Provider } from '@renderer/types'
import { getFancyProviderName } from '@renderer/utils'
import { Flex } from 'antd'
import React, { startTransition, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface ProviderFilterSectionProps {
  providers: Provider[]
  hiddenProviderIds: Set<string>
  onToggleProvider: (providerId: string) => void
}

const ProviderFilterSection: React.FC<ProviderFilterSectionProps> = ({
  providers,
  hiddenProviderIds,
  onToggleProvider
}) => {
  const { t } = useTranslation()

  const handleProviderClick = useCallback(
    (providerId: string) => {
      startTransition(() => onToggleProvider(providerId))
    },
    [onToggleProvider]
  )

  return (
    <FilterContainer>
      <Flex wrap="wrap" gap={4}>
        <FilterText>{t('models.filter.by_provider')}</FilterText>
        {providers.map((provider) => {
          const providerName = getFancyProviderName(provider)
          return (
            <CustomTag
              key={`provider-${provider.id}`}
              color="#6372bd"
              inactive={hiddenProviderIds.has(provider.id)}
              onClick={() => handleProviderClick(provider.id)}
              size={11}
              tooltip={providerName}>
              {providerName}
            </CustomTag>
          )
        })}
      </Flex>
    </FilterContainer>
  )
}

const FilterContainer = styled.div`
  padding: 8px;
  padding-left: 18px;
`

const FilterText = styled.span`
  color: var(--color-text-3);
  font-size: 12px;
`

export default ProviderFilterSection
