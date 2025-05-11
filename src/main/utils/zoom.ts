import { BrowserWindow } from 'electron'

import { configManager } from '../services/ConfigManager'

export function handleZoomFactor(delta: number, reset: boolean = false) {
  return (window: BrowserWindow) => {
    if (reset) {
      window.webContents.setZoomFactor(1)
      configManager.setZoomFactor(1)
      return
    }

    if (delta === 0) {
      return
    }

    const currentZoom = configManager.getZoomFactor()
    const newZoom = Number((currentZoom + delta).toFixed(1))
    if (newZoom >= 0.5 && newZoom <= 2.0) {
      window.webContents.setZoomFactor(newZoom)
      configManager.setZoomFactor(newZoom)
    }
  }
}
