import { join } from 'node:path'

import { loggerService } from '@logger'
import { isDev, isMac } from '@main/core/platform'
import { RelocationIpcChannels, type RelocationProgress, type RelocationStage } from '@shared/types/relocation'
import { BrowserWindow, ipcMain } from 'electron'

const logger = loggerService.withContext('RelocationWindowService')
const CRITICAL_STAGES: ReadonlySet<RelocationStage> = new Set(['preparing', 'copying', 'committing'])
const READY_TIMEOUT_MS = 30_000

export interface UserDataRelocationWindow {
  waitForReady(): Promise<void>
  updateProgress(progress: RelocationProgress): void
  hasWindow(): boolean
  isUnavailable(): boolean
  close(): void
}

interface OpenRelocationWindowOptions {
  getProgress(): RelocationProgress | null
  onRestart(): void
}

/**
 * Opens the one-off BrowserWindow used before lifecycle WindowManager exists.
 * All retained state is scoped to the returned operation controller; the
 * module itself remains stateless.
 */
export function openUserDataRelocationWindow(options: OpenRelocationWindowOptions): UserDataRelocationWindow {
  let window: BrowserWindow | null = null
  let stage: RelocationStage = 'preparing'
  let programmaticClose = false
  let unavailable = false
  let restartRequested = false

  const hasWindow = () => window !== null && !window.isDestroyed()

  const unregisterIpc = () => {
    ipcMain.removeHandler(RelocationIpcChannels.GetProgress)
    ipcMain.removeHandler(RelocationIpcChannels.Restart)
  }

  const close = () => {
    unregisterIpc()
    if (!hasWindow()) return
    programmaticClose = true
    window!.close()
    window = null
  }

  const requestRestart = () => {
    if (restartRequested) return
    restartRequested = true
    close()
    options.onRestart()
  }

  ipcMain.removeHandler(RelocationIpcChannels.GetProgress)
  ipcMain.removeHandler(RelocationIpcChannels.Restart)
  ipcMain.handle(RelocationIpcChannels.GetProgress, () => options.getProgress())
  ipcMain.handle(RelocationIpcChannels.Restart, () => {
    requestRestart()
    return true
  })

  window = new BrowserWindow({
    width: 560,
    height: 380,
    resizable: false,
    maximizable: false,
    minimizable: true,
    show: false,
    autoHideMenuBar: true,
    title: 'Cherry Studio',
    webPreferences: {
      preload: join(__dirname, '../preload/simplest.js'),
      partition: 'relocation-window',
      sandbox: false,
      contextIsolation: true
    },
    ...(isMac ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 12, y: 14 } } : { frame: false })
  })

  window.on('close', (event) => {
    if (programmaticClose) return
    if (CRITICAL_STAGES.has(stage)) {
      event.preventDefault()
      return
    }
    event.preventDefault()
    requestRestart()
  })

  window.webContents.on('render-process-gone', (_event, details) => {
    unavailable = true
    logger.error('Relocation renderer process exited', { reason: details.reason, stage })
    if (!CRITICAL_STAGES.has(stage)) requestRestart()
  })
  window.webContents.on('unresponsive', () => {
    unavailable = true
    logger.error('Relocation renderer became unresponsive', { stage })
    if (!CRITICAL_STAGES.has(stage)) requestRestart()
  })

  const readyPromise = new Promise<void>((resolve) => {
    let settled = false
    const webContents = window!.webContents
    const timeout = setTimeout(() => finish(false, 'ready timeout'), READY_TIMEOUT_MS)
    timeout.unref?.()

    const cleanup = () => {
      clearTimeout(timeout)
      webContents.removeListener('did-finish-load', didFinishLoad)
      webContents.removeListener('did-fail-load', didFailLoad)
      webContents.removeListener('render-process-gone', didExit)
    }
    const finish = (ready: boolean, reason?: string) => {
      if (settled) return
      settled = true
      cleanup()
      if (!ready) {
        unavailable = true
        logger.error('Relocation window unavailable; continuing headlessly', { reason })
      }
      resolve()
    }
    const didFinishLoad = () => finish(true)
    const didFailLoad = (_event: unknown, code: number, description: string, _url: string, isMainFrame?: boolean) => {
      if (isMainFrame === false) return
      finish(false, description || String(code))
    }
    const didExit = (_event: unknown, details: { reason?: string }) =>
      finish(false, details.reason ?? 'renderer exited')

    webContents.once('did-finish-load', didFinishLoad)
    webContents.once('did-fail-load', didFailLoad)
    webContents.once('render-process-gone', didExit)
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/windows/relocation/index.html`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/windows/relocation/index.html'))
  }

  window.once('ready-to-show', () => window?.show())
  window.on('closed', () => {
    window = null
  })

  logger.info('Relocation window created')

  return {
    waitForReady: () => readyPromise,
    updateProgress: (progress) => {
      stage = progress.stage
      if (hasWindow() && !unavailable) {
        window!.webContents.send(RelocationIpcChannels.Progress, progress)
      }
    },
    hasWindow,
    isUnavailable: () => unavailable,
    close
  }
}
