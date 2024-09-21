import { useSettings } from '@renderer/hooks/useSettings'
import { ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { FC, PropsWithChildren } from 'react'

import { useTheme } from './ThemeProvider'

const AntdProvider: FC<PropsWithChildren> = ({ children }) => {
  const { language } = useSettings()
  const { theme: _theme } = useTheme()
  const isDarkTheme = _theme === 'dark'

  return (
    <ConfigProvider
      locale={getAntdLocale(language)}
      theme={{
        algorithm: [_theme === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm],
        components: {
          Segmented: {
            trackBg: 'transparent',
            itemSelectedBg: isDarkTheme ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)',
            boxShadowTertiary: undefined
          }
        },
        token: {
          colorPrimary: '#00b96b',
          borderRadius: 6
        }
      }}>
      {children}
    </ConfigProvider>
  )
}

function getAntdLocale(language: string) {
  switch (language) {
    case 'zh-CN':
      return zhCN
    case 'en-US':
      return undefined
    default:
      return zhCN
  }
}

export default AntdProvider
