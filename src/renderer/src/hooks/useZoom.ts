import { IpcChannel } from '@shared/IpcChannel'
import { useEffect, useState } from 'react'

export function useZoom() {
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

  return { zoom }
}
