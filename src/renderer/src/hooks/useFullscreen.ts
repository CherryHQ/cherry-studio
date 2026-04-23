import { useEffect, useState } from 'react'

export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    void window.api.windowManager.isFullScreen().then(setIsFullscreen)

    const unsubscribe = window.api.windowManager.onFullscreenChange(setIsFullscreen)

    return () => {
      unsubscribe()
    }
  }, [])

  return isFullscreen
}
