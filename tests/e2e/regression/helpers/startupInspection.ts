import WebSocket from 'ws'

import { assertOwnedProcess, findListeningPid, MAIN_INSPECTOR_PORT } from '../../../../scripts/e2e/regression/process'
import type { RegressionApp } from '../RegressionApp'

export interface StartupState {
  openAtLogin: boolean
  visible: boolean
  dockVisible: boolean
  trays: { destroyed: boolean; bounds: { width: number; height: number } }[]
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
    const prototype = await request('Runtime.evaluate', {
      expression: "process.mainModule.require('electron').Tray.prototype"
    })
    const objects = await request('Runtime.queryObjects', { prototypeObjectId: prototype.result.objectId })
    const trays = await request('Runtime.callFunctionOn', {
      objectId: objects.objects.objectId,
      // Heap queries include JavaScript prototypes without a native Tray receiver.
      functionDeclaration: `function () { return this.flatMap(tray => {
        try { return [{ destroyed: tray.isDestroyed(),
          bounds: tray.isDestroyed() ? { width: 0, height: 0 } : tray.getBounds() }] }
        catch { return [] }
      }) }`,
      returnByValue: true
    })
    const state = await request('Runtime.evaluate', {
      expression: `(() => {
        const { app, BrowserWindow } = process.mainModule.require('electron')
        const main = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/windows/main/index.html'))
        if (${JSON.stringify(action)} === 'show') app.emit('activate')
        const state = { openAtLogin: app.getLoginItemSettings().openAtLogin,
          visible: main?.isVisible() ?? false, dockVisible: app.dock?.isVisible() ?? false }
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
