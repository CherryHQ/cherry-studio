import WebSocket from 'ws'

import { assertOwnedProcess, findListeningPid, MAIN_INSPECTOR_PORT } from '../../../../scripts/e2e/regression/process'
import type { RegressionApp } from '../RegressionApp'

export interface StartupState {
  openAtLogin: boolean
  visible: boolean
  dockVisible: boolean
  windows: { id: number; visible: boolean; minimized: boolean; route: string | null }[]
  trays: {
    destroyed: boolean
    bounds: { x: number; y: number; width: number; height: number }
    screenPoint: { x: number; y: number } | null
  }[]
}

export async function inspectStartup(app: RegressionApp, action?: 'show' | 'quit'): Promise<StartupState> {
  const record = app.record
  const inspectorPort = Number(process.env.V8_INSPECTOR_PORT ?? MAIN_INSPECTOR_PORT)
  assertOwnedProcess(record, record.electronPid, 'electron')
  if (findListeningPid(record.platform, inspectorPort) !== record.electronPid) {
    throw new Error('The test application does not own the main inspector')
  }
  const response = await fetch(`http://127.0.0.1:${inspectorPort}/json/list`)
  const targets = (await response.json()) as { type: string; webSocketDebuggerUrl: string }[]
  const target = targets.find(({ type }) => type === 'node')
  if (!target) throw new Error('Main inspector unavailable')
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  let id = 0
  const request = (method: string, params: Record<string, unknown>): Promise<any> =>
    new Promise((resolve, reject) => {
      const requestId = ++id
      const timer = setTimeout(() => {
        socket.off('message', onMessage)
        reject(new Error(`Inspector timed out: ${method}`))
      }, 10_000)
      const onMessage = (data: WebSocket.RawData) => {
        const message = JSON.parse(data.toString())
        if (message.id !== requestId) return
        clearTimeout(timer)
        socket.off('message', onMessage)
        if (message.error || message.result.exceptionDetails) {
          reject(new Error(JSON.stringify(message.error ?? message.result.exceptionDetails)))
        } else resolve(message.result)
      }
      socket.on('message', onMessage)
      socket.send(JSON.stringify({ id: requestId, method, params }))
    })
  try {
    const trays = await request('Runtime.evaluate', {
      expression: `(() => {
          const application = Object.values(process.mainModule.require('node:module')._cache)
            .map(module => module.exports?.application).find(candidate => candidate?.getPath)
          const tray = application.get('TrayService').tray
          if (!tray) return []
          const destroyed = tray.isDestroyed()
          const bounds = destroyed ? { x: 0, y: 0, width: 0, height: 0 } : tray.getBounds()
          const point = { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) }
          const screenPoint = destroyed ? null : process.platform === 'win32'
            ? process.mainModule.require('electron').screen.dipToScreenPoint(point) : point
          return [{ destroyed, bounds, screenPoint }]
      })()`,
      returnByValue: true
    })
    const state = await request('Runtime.evaluate', {
      expression: `(() => {
        const { app, BrowserWindow } = process.mainModule.require('electron')
        const main = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/windows/main/index.html'))
        if (${JSON.stringify(action)} === 'show') app.emit('activate')
        const windowsBase = main ? new URL('../', main.webContents.getURL()) : null
        const windows = BrowserWindow.getAllWindows().map(window => {
          const url = new URL(window.webContents.getURL() || 'about:blank')
          const relativePath = windowsBase && url.href.startsWith(windowsBase.href)
            ? url.pathname.slice(windowsBase.pathname.length) : ''
          const route = /^(?:[A-Za-z]+[/])+index[.]html$/.test(relativePath) ? '/windows/' + relativePath : null
          return { id: window.id, visible: window.isVisible(), minimized: window.isMinimized(), route }
        })
        const state = { openAtLogin: app.getLoginItemSettings().openAtLogin,
          visible: main?.isVisible() ?? false, dockVisible: app.dock?.isVisible() ?? false, windows }
        if (${JSON.stringify(action)} === 'quit') setTimeout(() => app.quit(), 100)
        return state
      })()`,
      returnByValue: true
    })
    return { ...state.result.value, trays: trays.result.value }
  } finally {
    socket.close()
  }
}
