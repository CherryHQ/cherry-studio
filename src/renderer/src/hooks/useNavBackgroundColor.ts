import { usePreference } from '@data/hooks/usePreference'
import { isMac } from '@renderer/config/constant'

function useNavBackgroundColor() {
  const [windowStyle] = usePreference('ui.window_style')

  const macTransparentWindow = isMac && windowStyle === 'transparent'

  if (macTransparentWindow) {
    return 'transparent'
  }

  return 'var(--navbar-background)'
}

export default useNavBackgroundColor
