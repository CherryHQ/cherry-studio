// import { loggerService } from '@logger'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { isBuiltinOcrProvider, OcrProvider } from '@renderer/types'
import { getOcrProviderLogo } from '@renderer/utils/ocr'
import { Avatar, Divider, Flex } from 'antd'
import styled from 'styled-components'

import { SettingTitle } from '..'
import { OcrTesseractSettings } from './OcrTesseractSettings'

// const logger = loggerService.withContext('OcrTesseractSettings')

type Props = {
  provider: OcrProvider
}

const OcrProviderSettings = ({ provider }: Props) => {
  // const { t } = useTranslation()
  const getProviderSettings = () => {
    if (isBuiltinOcrProvider(provider)) {
      switch (provider.id) {
        case 'tesseract':
          return <OcrTesseractSettings />
      }
    } else {
      throw new Error('Not supported OCR provider')
    }
  }

  return (
    <>
      <SettingTitle>
        <Flex align="center" gap={8}>
          <ProviderLogo shape="square" src={getOcrProviderLogo(provider.id)} size={16} />
          <ProviderName> {provider.name}</ProviderName>
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
const ProviderLogo = styled(Avatar)`
  border: 0.5px solid var(--color-border);
`

export default OcrProviderSettings
