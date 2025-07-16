import { BrowserWindow } from 'electron'

import { configManager } from '../services/ConfigManager'

export function handleZoomFactor(wins: BrowserWindow[], delta: number, reset: boolean = false) {
  if (reset) {
    wins.forEach((win) => {
      win.webContents.setZoomFactor(1)
    })
    configManager.setZoomFactor(1)
    return
  }

  if (delta === 0) {
    return
  }

  const currentZoom = configManager.getZoomFactor()
  const newZoom = Number((currentZoom + delta).toFixed(1))
  if (newZoom >= 0.5 && newZoom <= 2.0) {
    wins.forEach((win) => {
      win.webContents.setZoomFactor(newZoom)
    })
    configManager.setZoomFactor(newZoom)
  }
}
