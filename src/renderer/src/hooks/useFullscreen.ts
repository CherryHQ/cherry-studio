import { IpcChannel } from '@shared/IpcChannel'
import { useEffect, useState } from 'react'

export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const cleanup = window.electron.ipcRenderer.on(IpcChannel.FullscreenStatusChanged, (_, fullscreen) => {
      setIsFullscreen(fullscreen)
    })

    return () => {
      cleanup()
    }
  }, [])

  return isFullscreen
}
