import { TRAFFIC_LIGHT_WIDTH } from '@shared/config/constant'
import { IpcChannel } from '@shared/IpcChannel'
import { useEffect, useState } from 'react'

export function useSafeArea(padding: number = 0) {
  const defaultWidth =
    8 + // padding left
    TRAFFIC_LIGHT_WIDTH +
    padding // padding right
  const [safeWidth, setWidth] = useState(defaultWidth)

  const callback = (_: any, zoom: number) => {
    const newWidth = defaultWidth / zoom
    setWidth(newWidth)
  }

  useEffect(() => {
    const cleanup = window.electron.ipcRenderer.on(IpcChannel.Windows_ZoomChange, callback)

    return () => {
      cleanup()
    }
  }, [])

  return { safeWidth }
}
