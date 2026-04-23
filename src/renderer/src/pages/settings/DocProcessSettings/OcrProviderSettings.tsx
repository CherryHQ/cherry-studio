// import { loggerService } from '@logger'
import { Divider, Flex } from '@cherrystudio/ui'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { isMac, isWin } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useOcrProviders } from '@renderer/hooks/useOcrProvider'
import type { OcrProvider } from '@renderer/types'
import { isBuiltinOcrProvider, isOcrSystemProvider } from '@renderer/types'

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

  const ProviderSettings = () => {
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

  return (
    <SettingGroup theme={themeMode}>
      <SettingTitle>
        <Flex className="items-center gap-2">
          <OcrProviderLogo provider={provider} />
          <span className="font-medium text-sm">{getOcrProviderName(provider)}</span>
        </Flex>
      </SettingTitle>
      <Divider style={{ width: '100%', margin: '10px 0' }} />
      <ErrorBoundary>
        <ProviderSettings />
      </ErrorBoundary>
    </SettingGroup>
  )
}

export default OcrProviderSettings
