import { usePreference } from '@data/hooks/usePreference'
import { isMac } from '@renderer/config/constant'

function useMacTransparentWindow() {
  const [windowStyle] = usePreference('ui.window_style')

  return isMac && windowStyle === 'transparent'
}

export default useMacTransparentWindow
