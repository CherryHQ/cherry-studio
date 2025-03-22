import { useSettings } from '@renderer/hooks/useSettings'
import { LanguageVarious } from '@renderer/types'
import { ConfigProvider, theme } from 'antd'
import arEG from 'antd/locale/ar_EG'
import enUS from 'antd/locale/en_US'
import jaJP from 'antd/locale/ja_JP'
import ruRU from 'antd/locale/ru_RU'
import zhCN from 'antd/locale/zh_CN'
import zhTW from 'antd/locale/zh_TW'
import { FC, PropsWithChildren } from 'react'

import { useLayoutDirection } from './LayoutDirection'
import { useTheme } from './ThemeProvider'

const AntdProvider: FC<PropsWithChildren> = ({ children }) => {
  const { language } = useSettings()
  const { theme: _theme } = useTheme()
  const { isRTL } = useLayoutDirection()

  return (
    <ConfigProvider
      direction={isRTL ? 'rtl' : undefined}
      locale={getAntdLocale(language)}
      theme={{
        algorithm: [_theme === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm],
        components: {
          Menu: {
            activeBarBorderWidth: 0,
            darkItemBg: 'transparent'
          },
          Button: {
            boxShadow: 'none',
            boxShadowSecondary: 'none',
            defaultShadow: 'none',
            dangerShadow: 'none',
            primaryShadow: 'none'
          }
        },
        token: {
          colorPrimary: '#00b96b'
        }
      }}>
      {children}
    </ConfigProvider>
  )
}

function getAntdLocale(language: LanguageVarious) {
  switch (language) {
    case 'zh-CN':
      return zhCN
    case 'zh-TW':
      return zhTW
    case 'en-US':
      return enUS
    case 'ru-RU':
      return ruRU
    case 'ja-JP':
      return jaJP
    case 'ar-EG':
      return arEG

    default:
      return zhCN
  }
}

export default AntdProvider
