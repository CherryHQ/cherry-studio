import { useSettings } from '@renderer/hooks/useSettings'
import { LanguageVarious } from '@renderer/types'
import { ConfigProvider, theme } from 'antd'
import elGR from 'antd/locale/el_GR'
import enUS from 'antd/locale/en_US'
import esES from 'antd/locale/es_ES'
import frFR from 'antd/locale/fr_FR'
import jaJP from 'antd/locale/ja_JP'
import ptPT from 'antd/locale/pt_PT'
import ruRU from 'antd/locale/ru_RU'
import zhCN from 'antd/locale/zh_CN'
import zhTW from 'antd/locale/zh_TW'
import { FC, PropsWithChildren } from 'react'

import { useTheme } from './ThemeProvider'

const AntdProvider: FC<PropsWithChildren> = ({ children }) => {
  const {
    language,
    userTheme: { colorPrimary }
  } = useSettings()
  const { theme: _theme } = useTheme()

  return (
    <ConfigProvider
      locale={getAntdLocale(language)}
      theme={{
        cssVar: true,
        hashed: false,
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
            primaryShadow: 'none',
            controlHeight: 30,
            paddingInline: 10
          },
          Input: {
            controlHeight: 30,
            colorBorder: 'var(--color-border)'
          },
          InputNumber: {
            colorBorder: 'var(--color-border)'
          },
          Select: {
            controlHeight: 30,
            colorBorder: 'var(--color-border)'
          },
          Collapse: {
            headerBg: 'transparent'
          },
          Tooltip: {
            fontSize: 13
          },
          ColorPicker: {
            fontFamily: 'var(--code-font-family)'
          },
          Segmented: {
            itemActiveBg: 'var(--color-background-soft)',
            itemHoverBg: 'var(--color-background-soft)',
            trackBg: 'rgba(153,153,153,0.15)'
          },
          Switch: {
            colorTextQuaternary: 'rgba(153,153,153,0.15)'
          }
        },
        token: {
          colorPrimary: colorPrimary,
          fontFamily: 'var(--font-family)',
          colorBgMask: _theme === 'dark' ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.8)'
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
    case 'el-GR':
      return elGR
    case 'es-ES':
      return esES
    case 'fr-FR':
      return frFR
    case 'pt-PT':
      return ptPT
    default:
      return zhCN
  }
}

export default AntdProvider
