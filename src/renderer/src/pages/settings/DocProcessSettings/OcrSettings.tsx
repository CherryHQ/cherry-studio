import { PictureOutlined } from '@ant-design/icons'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useOcrProviders } from '@renderer/hooks/useOcrProvider'
import type { OcrProvider } from '@renderer/types'
import type { TabsProps } from 'antd'
import { Tabs } from 'antd'
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

  const tabs: TabsProps['items'] = [
    {
      key: 'image',
      label: t('settings.tool.ocr.image.title'),
      icon: <PictureOutlined />,
      children: <OcrImageSettings setProvider={setProvider} />
    }
  ]

  return (
    <ErrorBoundary>
      <SettingGroup theme={themeMode}>
        <SettingTitle>{t('settings.tool.ocr.title')}</SettingTitle>
        <SettingDivider />
        <Tabs defaultActiveKey="image" items={tabs} />
      </SettingGroup>
      <ErrorBoundary>
        <OcrProviderSettings provider={provider} />
      </ErrorBoundary>
    </ErrorBoundary>
  )
}
export default OcrSettings
