// import { useAppDispatch, useAppSelector } from '@renderer/store'
// import { setUserTheme, UserTheme } from '@renderer/store/settings'

import { usePreference } from '@data/hooks/usePreference'
import Color from 'color'

export default function useUserTheme() {
  const [colorPrimary, setColorPrimary] = usePreference('ui.theme_user.color_primary')

  const initUserTheme = (theme: { colorPrimary: string } = { colorPrimary }) => {
    const colorPrimary = Color(theme.colorPrimary)

    document.body.style.setProperty('--color-primary', colorPrimary.toString())
    document.body.style.setProperty('--color-primary-soft', colorPrimary.alpha(0.6).toString())
    document.body.style.setProperty('--color-primary-mute', colorPrimary.alpha(0.3).toString())
  }

  return {
    colorPrimary: Color(colorPrimary),

    initUserTheme,

    userTheme: { colorPrimary },

    setUserTheme(userTheme: { colorPrimary: string }) {
      setColorPrimary(userTheme.colorPrimary)
      initUserTheme(userTheme)
    }
  }
}
