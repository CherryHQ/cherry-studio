import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setUserTheme, UserTheme } from '@renderer/store/settings'
import Color from 'color'

export default function useUserTheme() {
  const userTheme = useAppSelector((state) => state.settings.userTheme)
  const dispatch = useAppDispatch()

  const initUserTheme = (theme: UserTheme = userTheme) => {
    const colorPrimary = Color(theme.colorPrimary)

    try {
      document.body.style.setProperty('--color-primary', colorPrimary.toString())
      document.body.style.setProperty('--color-primary-soft', colorPrimary.alpha(0.6).toString())
      document.body.style.setProperty('--color-primary-mute', colorPrimary.alpha(0.3).toString())
      document.body.style.setProperty('--background-image', `url("${decodeURIComponent(theme.backgroundImage)}")`)
      document.body.style.setProperty('--background-image-display', theme.backgroundType === 'image' ? 'block' : 'none')
      document.body.style.setProperty('--background-blur', theme.backgroundBlur?.toString() + 'px')
      document.body.style.setProperty('--background-brightness', theme.backgroundBrightness?.toString() + '%')
    } catch (error) {
      console.error('failed to init user theme', error)
    }
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
