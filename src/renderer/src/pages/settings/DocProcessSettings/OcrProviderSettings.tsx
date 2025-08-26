// import { loggerService } from '@logger'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useOcrProviders } from '@renderer/hooks/useOcrProvider'
import { BuiltinOcrProviderIds, isBuiltinOcrProvider, OcrProvider } from '@renderer/types'
import { Divider, Flex } from 'antd'
import styled from 'styled-components'

import { SettingGroup, SettingTitle } from '..'
import { OcrTesseractSettings } from './OcrTesseractSettings'

// const logger = loggerService.withContext('OcrTesseractSettings')

type Props = {
  provider: OcrProvider
}

const OcrProviderSettings = ({ provider }: Props) => {
  const { theme: themeMode } = useTheme()
  const { OcrProviderLogo, getOcrProviderName } = useOcrProviders()
  const getProviderSettings = () => {
    if (isBuiltinOcrProvider(provider)) {
      switch (provider.id) {
        case 'tesseract':
          return <OcrTesseractSettings />
        default:
          return null
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
          <OcrProviderLogo provider={provider} />
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
