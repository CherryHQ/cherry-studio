import { isMac } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'

import { useRuntime } from './useRuntime'
import { useSettings } from './useSettings'

function useNavBackgroundColor() {
  const { windowStyle } = useSettings()
  const { theme } = useTheme()
  const { minappShow } = useRuntime()

  const macTransparentWindow = isMac && windowStyle === 'transparent'

  if (minappShow) {
    return theme === 'dark' ? 'var(--navbar-background)' : 'var(--color-white)'
  }

  if (macTransparentWindow) {
    return 'transparent'
  }

  return 'var(--navbar-background)'
}

export default useNavBackgroundColor
