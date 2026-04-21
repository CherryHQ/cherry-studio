import { Dmxapi } from '@cherrystudio/ui/icons'
import { useProvider } from '@renderer/hooks/useProviders'
import { replaceEndpointConfigDomain } from '@renderer/utils/provider.v2'
import type { RadioChangeEvent } from 'antd'
import { Radio, Space } from 'antd'
import type { FC } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingSubtitle } from '..'

interface DMXAPISettingsProps {
  providerId: string
}

// DMXAPI platform domain options
enum PlatformDomain {
  OFFICIAL = 'www.DMXAPI.cn',
  INTERNATIONAL = 'www.DMXAPI.com',
  OVERSEA = 'ssvip.DMXAPI.com'
}

const DMXAPISettings: FC<DMXAPISettingsProps> = ({ providerId }) => {
  const { provider, updateProvider } = useProvider(providerId)
  const { t } = useTranslation()

  const PlatformOptions = [
    {
      label: t('settings.provider.dmxapi.platform_official'),
      value: PlatformDomain.OFFICIAL,
      apiKeyWebsite: 'https://www.dmxapi.cn/register?aff=bwwY'
    },
    {
      label: t('settings.provider.dmxapi.platform_international'),
      value: PlatformDomain.INTERNATIONAL,
      apiKeyWebsite: 'https://www.dmxapi.com/register'
    },
    {
      label: t('settings.provider.dmxapi.platform_enterprise'),
      value: PlatformDomain.OVERSEA,
      apiKeyWebsite: 'https://ssvip.dmxapi.com/register'
    }
  ]

  const getCurrentPlatform = (): PlatformDomain => {
    if (!provider?.endpointConfigs) return PlatformDomain.OFFICIAL
    const firstConfig = Object.values(provider.endpointConfigs)[0]
    const firstUrl = firstConfig?.baseUrl
    if (!firstUrl) return PlatformDomain.OFFICIAL
    if (firstUrl.includes('DMXAPI.com') || firstUrl.includes('dmxapi.com')) {
      return firstUrl.includes('ssvip') ? PlatformDomain.OVERSEA : PlatformDomain.INTERNATIONAL
    }
    return PlatformDomain.OFFICIAL
  }

  const [selectedPlatform, setSelectedPlatform] = useState<PlatformDomain>(getCurrentPlatform())

  const handlePlatformChange = useCallback(
    async (e: RadioChangeEvent) => {
      const domain = e.target.value as PlatformDomain
      setSelectedPlatform(domain)
      const newEndpointConfigs = replaceEndpointConfigDomain(provider?.endpointConfigs, domain)
      await updateProvider({ endpointConfigs: newEndpointConfigs })
    },
    [provider?.endpointConfigs, updateProvider]
  )

  return (
    <Container>
      <Space direction="vertical" style={{ width: '100%' }}>
        <LogoContainer>
          <Dmxapi.Color height={70} width="auto" />
        </LogoContainer>

        <SettingSubtitle style={{ marginTop: 5 }}>{t('settings.provider.dmxapi.select_platform')}</SettingSubtitle>
        <Radio.Group
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8
          }}
          onChange={handlePlatformChange}
          value={selectedPlatform}
          options={PlatformOptions.map((option) => ({
            ...option,
            label: (
              <span>
                {option.label}{' '}
                <a href={option.apiKeyWebsite} target="_blank" rel="noopener noreferrer">
                  ({t('settings.provider.get_api_key')})
                </a>
              </span>
            )
          }))}></Radio.Group>
      </Space>
    </Container>
  )
}

const Container = styled.div`
  margin-top: 16px;
  margin-bottom: 30px;
`

const LogoContainer = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  margin-bottom: 30px;
`

export default DMXAPISettings
