// import { useAppDispatch, useAppSelector } from '@renderer/store'
// import { setUserTheme, UserTheme } from '@renderer/store/settings'

import { usePreference } from '@data/hooks/usePreference'
import { getForegroundColor } from '@renderer/utils'
import Color from 'color'

export default function useUserTheme() {
  const [colorPrimary, setColorPrimary] = usePreference('ui.theme_user.color_primary')
  const [userFontFamily, setUserFontFamily] = usePreference('ui.theme_user.font_family')
  const [userCodeFontFamily, setUserCodeFontFamily] = usePreference('ui.theme_user.code_font_family')

  const initUserTheme = (theme: { colorPrimary: string } = { colorPrimary }) => {
    const colorPrimary = Color(theme.colorPrimary)

    document.body.style.setProperty('--color-primary', colorPrimary.toString())
    // overwrite hero UI primary color.
    document.body.style.setProperty('--primary', colorPrimary.toString())
    document.body.style.setProperty('--primary-foreground', getForegroundColor(colorPrimary.hex()))
    document.body.style.setProperty('--heroui-primary', colorPrimary.toString())
    document.body.style.setProperty('--heroui-primary-900', colorPrimary.lighten(0.5).toString())
    document.body.style.setProperty('--heroui-primary-800', colorPrimary.lighten(0.4).toString())
    document.body.style.setProperty('--heroui-primary-700', colorPrimary.lighten(0.3).toString())
    document.body.style.setProperty('--heroui-primary-600', colorPrimary.lighten(0.2).toString())
    document.body.style.setProperty('--heroui-primary-500', colorPrimary.lighten(0.1).toString())
    document.body.style.setProperty('--heroui-primary-400', colorPrimary.toString())
    document.body.style.setProperty('--heroui-primary-300', colorPrimary.darken(0.1).toString())
    document.body.style.setProperty('--heroui-primary-200', colorPrimary.darken(0.2).toString())
    document.body.style.setProperty('--heroui-primary-100', colorPrimary.darken(0.3).toString())
    document.body.style.setProperty('--heroui-primary-50', colorPrimary.darken(0.4).toString())
    document.body.style.setProperty('--color-primary-soft', colorPrimary.alpha(0.6).toString())
    document.body.style.setProperty('--color-primary-mute', colorPrimary.alpha(0.3).toString())

    // Set font family CSS variables
    document.documentElement.style.setProperty('--user-font-family', `'${userFontFamily}'`)
    document.documentElement.style.setProperty('--user-code-font-family', `'${userCodeFontFamily}'`)
  }

  return {
    colorPrimary: Color(colorPrimary),

    initUserTheme,

    userTheme: { colorPrimary, userFontFamily, userCodeFontFamily },

    setUserTheme(userTheme: { colorPrimary: string; userFontFamily: string; userCodeFontFamily: string }) {
      setColorPrimary(userTheme.colorPrimary)
      setUserFontFamily(userTheme.userFontFamily)
      setUserCodeFontFamily(userTheme.userCodeFontFamily)
      initUserTheme(userTheme)
    }
  }
}
