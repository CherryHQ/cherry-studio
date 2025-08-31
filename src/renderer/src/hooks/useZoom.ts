import { TRAFFIC_LIGHT_WIDTH } from '@shared/config/constant'
import { IpcChannel } from '@shared/IpcChannel'
import { useEffect, useState } from 'react'

export function useZoom() {
  const defaultWidth =
    8 + // padding left
    TRAFFIC_LIGHT_WIDTH
  const [zoom, setZoom] = useState(1)

  const callback = (_: any, zoomLevel: number) => {
    setZoom(zoomLevel)
  }

  useEffect(() => {
    const cleanup = window.electron.ipcRenderer.on(IpcChannel.Windows_ZoomChange, callback)
    window.api.handleZoomFactor(0).then((zoomLevel) => {
      setZoom(zoomLevel)
    })
    return () => {
      cleanup()
    }
  }, [])

  return { defaultWidth, zoom }
}
