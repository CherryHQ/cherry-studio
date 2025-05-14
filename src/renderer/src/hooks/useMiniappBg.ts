import { isMac } from '@renderer/config/constant'

import { useSettings } from './useSettings'

function useMiniappBackgroundColor() {
  const { windowStyle } = useSettings()

  if (windowStyle === 'transparent' && isMac) {
    return 'var(--color-background)'
  }

  return 'var(--navbar-background)'
}

export default useMiniappBackgroundColor
