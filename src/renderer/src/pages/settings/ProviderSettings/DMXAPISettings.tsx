import DmxapiLogo from '@renderer/assets/images/providers/dmxapi-logo.webp'
import DmxapiLogoDark from '@renderer/assets/images/providers/dmxapi-logo-dark.webp'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useProvider } from '@renderer/hooks/useProvider'
import { Radio, RadioChangeEvent, Space } from 'antd'
import { FC, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingSubtitle } from '..'

interface DMXAPISettingsProps {
  providerId: string
}

// DMXAPI平台选项
enum PlatformType {
  OFFICIAL = 'https://www.DMXAPI.cn',
  INTERNATIONAL = 'https://www.DMXAPI.com',
  OVERSEA = 'https://ssvip.DMXAPI.com'
}

const PlatformOptions = [
  {
    label: 'www.DMXAPI.cn 人民币站',
    value: PlatformType.OFFICIAL,
    apiKeyWebsite: 'https://www.dmxapi.cn/register?aff=bwwY'
  },
  {
    label: 'www.DMXAPI.com 国际站',
    value: PlatformType.INTERNATIONAL,
    apiKeyWebsite: 'https://www.dmxapi.com/register'
  },
  {
    label: 'ssvip.DMXAPI.com 生产级商用站',
    value: PlatformType.OVERSEA,
    apiKeyWebsite: 'https://ssvip.dmxapi.com/register'
  }
]

const DMXAPISettings: FC<DMXAPISettingsProps> = ({ providerId }) => {
  const { provider, updateProvider } = useProvider(providerId)
  const { theme } = useTheme()

  const { t } = useTranslation()

  // 获取当前选中的平台，如果没有设置则默认为官方平台
  const getCurrentPlatform = (): PlatformType => {
    if (!provider.apiHost) return PlatformType.OFFICIAL

    if (provider.apiHost.includes('DMXAPI.com')) {
      return provider.apiHost.includes('ssvip') ? PlatformType.OVERSEA : PlatformType.INTERNATIONAL
    }

    return PlatformType.OFFICIAL
  }

  // 状态管理
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformType>(getCurrentPlatform())

  // 处理平台选择变更
  const handlePlatformChange = useCallback(
    (e: RadioChangeEvent) => {
      const platform = e.target.value as PlatformType
      setSelectedPlatform(platform)
      updateProvider({ ...provider, apiHost: platform })
    },
    [provider, updateProvider]
  )

  return (
    <Container>
      <Space direction="vertical" style={{ width: '100%' }}>
        <LogoContainer>
          <Logo src={theme === 'dark' ? DmxapiLogoDark : DmxapiLogo}></Logo>
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
                  (获得 API密钥)
                </a>
              </span>
            )
          }))}></Radio.Group>
      </Space>
    </Container>
  )
}

// 样式组件
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

const Logo = styled.img`
  height: 70px;
  display: block;
  width: auto;
`

export default DMXAPISettings
