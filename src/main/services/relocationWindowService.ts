import { join } from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { isDev, isMac } from '@main/core/platform'
import { validateSender } from '@main/core/security/validateSender'
import { IpcRouter } from '@main/ipc/IpcRouter'
import { IpcError, IpcErrorCode, type IpcResult } from '@shared/ipc/errors/IpcError'
import { userDataRelocationWindowRequestSchemas } from '@shared/ipc/schemas/app'
import type { IpcHandlersFor } from '@shared/ipc/types'
import { IpcChannel } from '@shared/IpcChannel'
import type { RelocationProgress, RelocationStage } from '@shared/types/relocation'
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'

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
 * Opens the one-off BrowserWindow used before lifecycle WindowManager and
 * IpcApiService exist. It installs an operation-scoped IpcApi endpoint for this
 * preboot window; all retained state is scoped to the returned controller, so
 * the module itself remains stateless.
 */
export function openUserDataRelocationWindow(options: OpenRelocationWindowOptions): UserDataRelocationWindow {
  let window: BrowserWindow | null = null
  let stage: RelocationStage = 'preparing'
  let programmaticClose = false
  let unavailable = false
  let restartRequested = false

  const hasWindow = () => window !== null && !window.isDestroyed()

  const unregisterIpc = () => {
    ipcMain.removeHandler(IpcChannel.IpcApi_Request)
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
    options.onRestart()
    restartRequested = true
    close()
  }

  const relocationHandlers: IpcHandlersFor<typeof userDataRelocationWindowRequestSchemas> = {
    'app.user_data_relocation.get_progress': async () => options.getProgress(),
    'app.user_data_relocation.restart': async () => requestRestart()
  }
  const router = new IpcRouter(userDataRelocationWindowRequestSchemas, relocationHandlers)
  const handleRequest = async (
    event: IpcMainInvokeEvent,
    route: string,
    input: unknown
  ): Promise<IpcResult<unknown>> => {
    if (!validateSender(event, application.getPath('app.root'))) {
      logger.warn('Rejected relocation IpcApi request from untrusted sender', { route })
      const error = new IpcError(
        IpcErrorCode.FORBIDDEN_SENDER,
        `Rejected IpcApi request from relocation window: ${route}`
      )
      return { ok: false, error: error.toJSON() }
    }
    try {
      const data = await router.dispatch(route, input, { senderId: null })
      return { ok: true, data }
    } catch (error) {
      return { ok: false, error: IpcError.from(error).toJSON() }
    }
  }

  // The lifecycle IpcApiService has not started yet. This launch is exclusively
  // owned by the relocation gate, so its scoped endpoint can safely occupy the
  // shared request channel until the window closes and the app relaunches.
  ipcMain.handle(IpcChannel.IpcApi_Request, handleRequest)

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
        window!.webContents.send(IpcChannel.IpcApi_Event, 'app.user_data_relocation.progress', progress)
      }
    },
    hasWindow,
    isUnavailable: () => unavailable,
    close
  }
}
