import { ipcApi } from '@renderer/ipc'
import { useIpcOn } from '@renderer/ipc/useIpcOn'
import { useEffect, useState } from 'react'

export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    void ipcApi.request('window.is_full_screen').then(setIsFullscreen)
  }, [])

  useIpcOn('window.fullscreen_changed', setIsFullscreen)

  return isFullscreen
}
