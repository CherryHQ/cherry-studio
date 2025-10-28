// import { loggerService } from '@logger'
import { Avatar, Flex } from '@cherrystudio/ui'
import IntelLogo from '@renderer/assets/images/providers/intel.png'
import PaddleocrLogo from '@renderer/assets/images/providers/paddleocr.png'
import TesseractLogo from '@renderer/assets/images/providers/Tesseract.js.png'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { isMac, isWin } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useOcrProviders } from '@renderer/hooks/ocr/useOcrProviders'
import type { OcrProvider, OcrProviderConfig } from '@renderer/types'
import {
  isBuiltinOcrProvider,
  isOcrOVProvider,
  isOcrPpocrProvider,
  isOcrSystemProvider,
  isOcrTesseractProvider
} from '@renderer/types'
import { Divider } from 'antd'
import { FileQuestionMarkIcon, MonitorIcon } from 'lucide-react'
import { useMemo } from 'react'

import { SettingGroup, SettingTitle } from '..'
import { OcrOVSettings } from './OcrOVSettings'
import { OcrPpocrSettings } from './OcrPpocrSettings'
import { OcrSystemSettings } from './OcrSystemSettings'
import { OcrTesseractSettings } from './OcrTesseractSettings'

// const logger = loggerService.withContext('OcrTesseractSettings')

type Props = {
  provider: OcrProvider | undefined | null
  updateConfig: (config: Partial<OcrProviderConfig>) => Promise<void>
}

const OcrProviderSettings = ({ provider, updateConfig }: Props) => {
  const { theme: themeMode } = useTheme()
  const { getOcrProviderName } = useOcrProviders()

  const settings = useMemo(() => {
    if (!provider) return null
    if (isBuiltinOcrProvider(provider)) {
      if (isOcrTesseractProvider(provider)) {
        return <OcrTesseractSettings provider={provider} updateConfig={updateConfig} />
      }
      if (isOcrSystemProvider(provider)) {
        return <OcrSystemSettings provider={provider} updateConfig={updateConfig} />
      }
      if (isOcrPpocrProvider(provider)) {
        return <OcrPpocrSettings provider={provider} updateConfig={updateConfig} />
      }
      if (isOcrOVProvider(provider)) {
        return <OcrOVSettings />
      }
      return null
    } else {
      throw new Error('Not supported OCR provider')
    }
  }, [provider, updateConfig])

  if (!provider || (!isWin && !isMac && isOcrSystemProvider(provider))) {
    return null
  }

  return (
    <SettingGroup theme={themeMode}>
      <SettingTitle>
        <Flex className="items-center gap-2">
          <OcrProviderLogo provider={provider} />
          <span className="font-semibold text-sm"> {getOcrProviderName(provider)}</span>
        </Flex>
      </SettingTitle>
      <Divider style={{ width: '100%', margin: '10px 0' }} />
      <ErrorBoundary>{settings}</ErrorBoundary>
    </SettingGroup>
  )
}

const OcrProviderLogo = ({ provider: p, size = 14 }: { provider: OcrProvider; size?: number }) => {
  if (isBuiltinOcrProvider(p)) {
    switch (p.id) {
      case 'tesseract':
        return <Avatar src={TesseractLogo} style={{ width: size, height: size }} />
      case 'system':
        return <MonitorIcon size={size} />
      case 'paddleocr':
        return <Avatar src={PaddleocrLogo} style={{ width: size, height: size }} />
      case 'ovocr':
        return <Avatar src={IntelLogo} style={{ width: size, height: size }} />
    }
  }
  return <FileQuestionMarkIcon size={size} />
}

export default OcrProviderSettings
