import useMacTransparentWindow from './useMacTransparentWindow'

const MAC_TRANSPARENT_NAV_BACKGROUND = 'color-mix(in srgb, var(--color-background) 55%, transparent)'
const DEFAULT_NAV_BACKGROUND = 'var(--color-sidebar)'

function useNavBackgroundColor() {
  const macTransparentWindow = useMacTransparentWindow()

  if (macTransparentWindow) {
    return MAC_TRANSPARENT_NAV_BACKGROUND
  }

  return DEFAULT_NAV_BACKGROUND
}

export default useNavBackgroundColor
