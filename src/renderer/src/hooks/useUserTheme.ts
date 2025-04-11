import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setColorPrimary } from '@renderer/store/settings'
import Color from 'color'

export default function useUserTheme() {
  const colorPrimary = Color(useAppSelector((state) => state.settings.colorPrimary) || '#00b96b')
  const dispatch = useAppDispatch()

  const initUserTheme = () => {
    document.body.style.setProperty('--color-primary', colorPrimary.toString())
    document.body.style.setProperty('--color-primary-soft', colorPrimary.alpha(0.6).toString())
    document.body.style.setProperty('--color-primary-mute', colorPrimary.alpha(0.3).toString())
  }

  return {
    colorPrimary,

    initUserTheme,

    setColorPrimary(color: string) {
      const colorPrimary = Color(color).toString()
      dispatch(setColorPrimary(colorPrimary))

      initUserTheme()
    }
  }
}
