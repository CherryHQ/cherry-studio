import { PictureOutlined } from '@ant-design/icons'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@cherrystudio/ui'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useOcrProviders } from '@renderer/hooks/useOcrProvider'
import type { OcrProvider } from '@renderer/types'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingTitle } from '..'
import OcrImageSettings from './OcrImageSettings'
import OcrProviderSettings from './OcrProviderSettings'

const OcrSettings: FC = () => {
  const { t } = useTranslation()
  const { theme: themeMode } = useTheme()
  const { imageProvider } = useOcrProviders()
  const [provider, setProvider] = useState<OcrProvider>(imageProvider) // since default to image provider

  return (
    <ErrorBoundary>
      <SettingGroup theme={themeMode}>
        <SettingTitle>{t('settings.tool.ocr.title')}</SettingTitle>
        <SettingDivider />
        <Tabs defaultValue="image">
          <TabsList>
            <TabsTrigger value="image">
              <PictureOutlined />
              {t('settings.tool.ocr.image.title')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="image">
            <OcrImageSettings setProvider={setProvider} />
          </TabsContent>
        </Tabs>
      </SettingGroup>
      <ErrorBoundary>
        <OcrProviderSettings provider={provider} />
      </ErrorBoundary>
    </ErrorBoundary>
  )
}
export default OcrSettings
