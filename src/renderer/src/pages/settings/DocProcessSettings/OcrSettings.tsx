import { PictureOutlined } from '@ant-design/icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import { Tabs, TabsProps } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingTitle } from '..'
import OcrImageSettings from './OcrImageSettings'

const OcrSettings: FC = () => {
  const { t } = useTranslation()
  const { theme: themeMode } = useTheme()

  const tabs: TabsProps['items'] = [
    {
      key: 'image',
      label: t('settings.tool.ocr.image.title'),
      icon: <PictureOutlined />,
      children: <OcrImageSettings />
    }
  ]

  return (
    <>
      <SettingGroup theme={themeMode}>
        <SettingTitle>{t('settings.tool.ocr.title')}</SettingTitle>
        <SettingDivider />
        <Tabs defaultActiveKey="image" items={tabs} />
      </SettingGroup>
    </>
  )
}
export default OcrSettings
