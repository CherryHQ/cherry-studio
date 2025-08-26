// import { loggerService } from '@logger'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { useOcrProviders } from '@renderer/hooks/useOcrProvider'
import { isBuiltinOcrProvider, OcrProvider } from '@renderer/types'
import { Divider, Empty, Flex } from 'antd'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingTitle } from '..'
import { OcrTesseractSettings } from './OcrTesseractSettings'

// const logger = loggerService.withContext('OcrTesseractSettings')

type Props = {
  provider: OcrProvider
}

const OcrProviderSettings = ({ provider }: Props) => {
  const { t } = useTranslation()
  const { getOcrProviderLogo, getOcrProviderName } = useOcrProviders()
  const getProviderSettings = () => {
    if (isBuiltinOcrProvider(provider)) {
      switch (provider.id) {
        case 'tesseract':
          return <OcrTesseractSettings />
        case 'system':
        default:
          return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('settings.tool.ocr.not_configurable')} />
      }
    } else {
      throw new Error('Not supported OCR provider')
    }
  }

  return (
    <>
      <SettingTitle>
        <Flex align="center" gap={8}>
          {getOcrProviderLogo(provider)}
          <ProviderName> {getOcrProviderName(provider)}</ProviderName>
        </Flex>
      </SettingTitle>
      <Divider style={{ width: '100%', margin: '10px 0' }} />
      <ErrorBoundary>{getProviderSettings()}</ErrorBoundary>
    </>
  )
}

const ProviderName = styled.span`
  font-size: 14px;
  font-weight: 500;
`

export default OcrProviderSettings
