import { preferenceService } from '@data/PreferenceService'
import type { BrowserWindow } from 'electron'

export function handleZoomFactor(wins: BrowserWindow[], delta: number, reset: boolean = false) {
  if (reset) {
    wins.forEach((win) => {
      win.webContents.setZoomFactor(1)
    })
    preferenceService.set('app.zoom_factor', 1)
    return
  }

  if (delta === 0) {
    return
  }

  const currentZoom = preferenceService.get('app.zoom_factor')
  const newZoom = Number((currentZoom + delta).toFixed(1))
  if (newZoom >= 0.5 && newZoom <= 2.0) {
    wins.forEach((win) => {
      win.webContents.setZoomFactor(newZoom)
    })
    preferenceService.set('app.zoom_factor', newZoom)
  }
}
