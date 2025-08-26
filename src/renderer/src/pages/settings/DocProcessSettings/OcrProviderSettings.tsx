// import { loggerService } from '@logger'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useOcrProviders } from '@renderer/hooks/useOcrProvider'
import { BuiltinOcrProviderIds, isBuiltinOcrProvider, OcrProvider } from '@renderer/types'
import { Divider, Empty, Flex } from 'antd'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingGroup, SettingTitle } from '..'
import { OcrTesseractSettings } from './OcrTesseractSettings'

// const logger = loggerService.withContext('OcrTesseractSettings')

type Props = {
  provider: OcrProvider
}

const OcrProviderSettings = ({ provider }: Props) => {
  const { t } = useTranslation()
  const { theme: themeMode } = useTheme()
  const { getOcrProviderLogo, getOcrProviderName } = useOcrProviders()
  const getProviderSettings = () => {
    if (isBuiltinOcrProvider(provider)) {
      switch (provider.id) {
        case 'tesseract':
          return <OcrTesseractSettings />
        default:
          return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('settings.tool.ocr.not_configurable')} />
      }
    } else {
      throw new Error('Not supported OCR provider')
    }
  }
  if (provider.id === BuiltinOcrProviderIds.system) {
    return null
  }

  return (
    <SettingGroup theme={themeMode}>
      <SettingTitle>
        <Flex align="center" gap={8}>
          {getOcrProviderLogo(provider)}
          <ProviderName> {getOcrProviderName(provider)}</ProviderName>
        </Flex>
      </SettingTitle>
      <Divider style={{ width: '100%', margin: '10px 0' }} />
      <ErrorBoundary>{getProviderSettings()}</ErrorBoundary>
    </SettingGroup>
  )
}

const ProviderName = styled.span`
  font-size: 14px;
  font-weight: 500;
`

export default OcrProviderSettings
