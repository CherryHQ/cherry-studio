import { useEffect, useState } from 'react'

export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    void window.api.isFullScreen().then(setIsFullscreen)

    const unsubscribe = window.api.windowControls.onFullscreenChange(setIsFullscreen)

    return () => {
      unsubscribe()
    }
  }, [])

  return isFullscreen
}
