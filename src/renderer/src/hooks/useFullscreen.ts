import { IpcChannel } from '@shared/IpcChannel'
import { useEffect, useState } from 'react'

export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    // 首次挂载时请求一次状态
    window.api.isFullScreen().then((value) => {
      setIsFullscreen(value)
    })

    const cleanup = window.electron.ipcRenderer.on(IpcChannel.FullscreenStatusChanged, (_, fullscreen) => {
      setIsFullscreen(fullscreen)
    })

    return () => {
      cleanup()
    }
  }, [])

  return isFullscreen
}
