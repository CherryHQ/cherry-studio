import { useAppDispatch, useAppSelector } from '@renderer/store'
import type { UserTheme } from '@renderer/store/settings'
import { setUserTheme } from '@renderer/store/settings'
import Color from 'color'

const setOptionalCssVariable = (name: string, value: string) => {
  if (value) {
    document.documentElement.style.setProperty(name, `'${value}'`)
  } else {
    document.documentElement.style.removeProperty(name)
  }
}

export default function useUserTheme() {
  const userTheme = useAppSelector((state) => state.settings.userTheme)

  const dispatch = useAppDispatch()

  const initUserTheme = (theme: UserTheme = userTheme) => {
    const colorPrimary = Color(theme.colorPrimary)

    document.body.style.setProperty('--color-primary', colorPrimary.toString())
    document.body.style.setProperty('--primary', colorPrimary.toString())
    document.body.style.setProperty('--color-primary-soft', colorPrimary.alpha(0.6).toString())
    document.body.style.setProperty('--color-primary-mute', colorPrimary.alpha(0.3).toString())

    // Set font family CSS variables
    setOptionalCssVariable('--user-font-family', theme.userFontFamily)
    setOptionalCssVariable('--user-code-font-family', theme.userCodeFontFamily)
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
