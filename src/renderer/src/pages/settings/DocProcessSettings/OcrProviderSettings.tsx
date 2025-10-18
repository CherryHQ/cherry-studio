// import { loggerService } from '@logger'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { isMac, isWin } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useOcrProviders } from '@renderer/hooks/useOcrProvider'
import { isBuiltinOcrProvider, isOcrSystemProvider, OcrProvider } from '@renderer/types'
import { Divider, Flex } from 'antd'
import styled from 'styled-components'

import { SettingGroup, SettingTitle } from '..'
import { OcrOVSettings } from './OcrOVSettings'
import { OcrPpocrSettings } from './OcrPpocrSettings'
import { OcrSystemSettings } from './OcrSystemSettings'
import { OcrTesseractSettings } from './OcrTesseractSettings'

// const logger = loggerService.withContext('OcrTesseractSettings')

type Props = {
  provider: OcrProvider
}

const OcrProviderSettings = ({ provider }: Props) => {
  const { theme: themeMode } = useTheme()
  const { OcrProviderLogo, getOcrProviderName } = useOcrProviders()

  if (!isWin && !isMac && isOcrSystemProvider(provider)) {
    return null
  }

  return (
    <SettingGroup theme={themeMode}>
      <SettingTitle>
        <Flex align="center" gap={8}>
          <OcrProviderLogo provider={provider} />
          <ProviderName> {getOcrProviderName(provider)}</ProviderName>
        </Flex>
      </SettingTitle>
      <Divider style={{ width: '100%', margin: '10px 0' }} />
      <ErrorBoundary>
        <ProviderSettings provider={provider} />
      </ErrorBoundary>
    </SettingGroup>
  )
}

const ProviderName = styled.span`
  font-size: 14px;
  font-weight: 500;
`

const ProviderSettings = ({ provider }: { provider: OcrProvider }) => {
  if (isBuiltinOcrProvider(provider)) {
    switch (provider.id) {
      case 'tesseract':
        return <OcrTesseractSettings />
      case 'system':
        return <OcrSystemSettings />
      case 'paddleocr':
        return <OcrPpocrSettings />
      case 'ovocr':
        return <OcrOVSettings />
      default:
        return null
    }
  } else {
    throw new Error('Not supported OCR provider')
  }
}

export default OcrProviderSettings
