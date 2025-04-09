import { ThemeMode } from '@renderer/types'
import * as cmThemes from '@uiw/codemirror-themes-all'
import { useMemo } from 'react'
import { bundledThemes } from 'shiki'

import { useSettings } from './useSettings'

export function useCodeThemes() {
  const { codeEditor, codeStyle, theme } = useSettings()

  const themeNames = useMemo(() => {
    // CodeMirror 主题
    // 更保险的做法可能是硬编码主题列表
    if (codeEditor.enabled) {
      return ['auto', 'light', 'dark']
        .concat(Object.keys(cmThemes))
        .filter((item) => typeof cmThemes[item as keyof typeof cmThemes] !== 'function')
        .filter((item) => !/^(defaultSettings)/.test(item as string) && !/(Style)$/.test(item as string))
    }

    // Shiki 主题
    return ['auto', ...Object.keys(bundledThemes)]
  }, [codeEditor.enabled])

  const currentTheme = useMemo(() => {
    if (!codeStyle || codeStyle === 'auto' || !themeNames.includes(codeStyle)) {
      if (codeEditor.enabled) {
        return theme === ThemeMode.light ? 'materialLight' : 'materialDark'
      } else {
        return theme === ThemeMode.light ? 'one-light' : 'material-theme-darker'
      }
    }
    return codeStyle
  }, [codeEditor.enabled, codeStyle, themeNames, theme])

  return { themeNames, currentTheme }
}
