// import { useAppDispatch, useAppSelector } from '@renderer/store'
// import { setUserTheme, UserTheme } from '@renderer/store/settings'

import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { DEFAULT_COLOR_PRIMARY } from '@renderer/config/constant'
import Color from 'color'

const logger = loggerService.withContext('useUserTheme')

function parseThemeColor(value?: string) {
  try {
    return Color(value?.trim() || DEFAULT_COLOR_PRIMARY)
  } catch (error) {
    logger.warn('Invalid stored theme color, falling back to default', { value, error: error as Error })
    return Color(DEFAULT_COLOR_PRIMARY)
  }
}

export default function useUserTheme() {
  const [colorPrimary, setColorPrimary] = usePreference('ui.theme_user.color_primary')
  const [userFontFamily, setUserFontFamily] = usePreference('ui.theme_user.font_family')
  const [userCodeFontFamily, setUserCodeFontFamily] = usePreference('ui.theme_user.code_font_family')

  const setOptionalCssVar = (name: string, value?: string) => {
    if (value?.trim()) {
      document.documentElement.style.setProperty(name, `'${value}'`)
      return
    }

    document.documentElement.style.removeProperty(name)
  }

  const initUserTheme = (theme: { colorPrimary: string } = { colorPrimary }) => {
    const colorPrimary = parseThemeColor(theme.colorPrimary)

    document.documentElement.style.setProperty('--cs-theme-primary', colorPrimary.toString())
    setOptionalCssVar('--cs-user-font-family', userFontFamily)
    setOptionalCssVar('--cs-user-code-font-family', userCodeFontFamily)
  }

  return {
    colorPrimary: parseThemeColor(colorPrimary),

    initUserTheme,

    userTheme: { colorPrimary, userFontFamily, userCodeFontFamily },

    setUserTheme(userTheme: { colorPrimary: string; userFontFamily: string; userCodeFontFamily: string }) {
      void setColorPrimary(userTheme.colorPrimary)
      void setUserFontFamily(userTheme.userFontFamily)
      void setUserCodeFontFamily(userTheme.userCodeFontFamily)
      initUserTheme(userTheme)
    }
  }
}
