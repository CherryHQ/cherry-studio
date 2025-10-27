import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setUserTheme, UserTheme } from '@renderer/store/settings'
import Color from 'color'

export default function useUserTheme() {
  const userTheme = useAppSelector((state) => state.settings.userTheme)

  const dispatch = useAppDispatch()

  const initUserTheme = (theme: UserTheme = userTheme) => {
    const colorPrimary = Color(theme.colorPrimary)

    document.body.style.setProperty('--color-primary', colorPrimary.toString())
    // overwrite hero UI primary color.
    document.body.style.setProperty('--primary', colorPrimary.toString())
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
    document.documentElement.style.setProperty('--user-font-family', `'${theme.userFontFamily}'`)
    document.documentElement.style.setProperty('--user-code-font-family', `'${theme.userCodeFontFamily}'`)
  }

  return {
    colorPrimary: Color(userTheme.colorPrimary),

    initUserTheme,

    setUserTheme(userTheme: UserTheme) {
      dispatch(setUserTheme(userTheme))

      initUserTheme(userTheme)
    }
  }
}
