/**
 * Window manager for the preboot userData relocation flow.
 *
 * Mirrors the structure of `MigrationWindowManager` but far simpler: the
 * relocation window has no multi-stage confirmation, no backup, and is not
 * user-cancellable mid-copy (closing it during copy is intercepted — a
 * half-copied userData tree would leave the app in an inconsistent state).
 *
 * Like the migration window, this runs BEFORE `application.bootstrap()`, so
 * it cannot use the lifecycle WindowManager. It creates its own
 * `BrowserWindow` directly with the `simplest` preload and a non-persistent
 * session partition (to keep the window from writing into the OLD userData
 * being copied — those writes would race with the copy and, on Windows,
 * hit file locks).
 */

import { application } from '@application'
import { loggerService } from '@logger'
import { isMac } from '@main/core/platform'
import { RelocationIpcChannels, type RelocationProgress, type RelocationStage } from '@shared/data/relocation/types'
import { BrowserWindow } from 'electron'
import { join } from 'path'

const logger = loggerService.withContext('RelocationWindowManager')

// Stages during which closing the window must be blocked — interrupting a
// copy or a BootConfig commit mid-flight corrupts state.
const NON_CLOSABLE_STAGES: ReadonlySet<RelocationStage> = new Set(['preparing', 'copying', 'committing'])
const READY_TIMEOUT_MS = 30_000

type ReadyResult = { ok: true } | { ok: false; error: Error }

function isClosable(stage: RelocationStage): boolean {
  return !NON_CLOSABLE_STAGES.has(stage)
}

export class RelocationWindowManager {
  private window: BrowserWindow | null = null
  private readyPromise: Promise<ReadyResult> | null = null
  private stage: RelocationStage = 'preparing'
  private programmaticClose = false
  private criticalWindowUnavailable = false

  hasWindow(): boolean {
    return this.window !== null && !this.window.isDestroyed()
  }

  create(): BrowserWindow {
    if (this.hasWindow()) {
      this.window!.show()
      return this.window!
    }

    logger.info('Creating relocation window')
    this.stage = 'preparing'
    this.programmaticClose = false
    this.criticalWindowUnavailable = false
    this.readyPromise = null

    this.window = new BrowserWindow({
      width: 560,
      height: 360,
      resizable: false,
      maximizable: false,
      minimizable: true,
      show: false,
      autoHideMenuBar: true,
      // Non-persistent partition so the window's own Chromium state never
      // lands in the OLD userData (which is being copied) or the NEW one
      // (which only becomes canonical after relaunch). In-memory only.
      webPreferences: {
        preload: join(__dirname, '../preload/simplest.js'),
        partition: 'relocation-window',
        sandbox: false,
        contextIsolation: true
      },
      ...(isMac ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 12, y: 14 } } : { frame: false })
    })

    this.window.on('close', (event) => {
      if (this.programmaticClose) return
      if (!isClosable(this.stage)) {
        // Mid-relocation: never allow a close — a partial copy / commit
        // would corrupt userData. Keep the window open.
        event.preventDefault()
        return
      }
      // Failure stage: closing the window is equivalent to pressing the
      // action button — relaunch on the previous userData path and move on.
      logger.info('Relocation window closed by user after failure; relaunching')
      void this.restartApp()
    })

    this.window.webContents.on('render-process-gone', (_event, details) => {
      this.handleRendererUnavailable('gone', details.reason)
    })
    this.window.webContents.on('unresponsive', () => {
      this.handleRendererUnavailable('unresponsive')
    })

    const window = this.window
    this.readyPromise = this.createReadyPromise(window, () => {
      if (process.env['ELECTRON_RENDERER_URL']) {
        return window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/windows/relocation/index.html`)
      }
      return window.loadFile(join(__dirname, '../renderer/windows/relocation/index.html'))
    })

    this.window.once('ready-to-show', () => {
      this.window?.show()
      logger.info('Relocation window shown')
    })

    this.window.on('closed', () => {
      this.window = null
    })

    return this.window
  }

  async waitForReady(): Promise<void> {
    if (!this.window) return
    if (this.readyPromise) {
      const result = await this.readyPromise
      if (!result.ok) throw result.error
      return
    }
    if (!this.window.webContents.isLoading()) return
    this.readyPromise = this.createReadyPromise(this.window)
    const result = await this.readyPromise
    if (!result.ok) throw result.error
  }

  setStage(stage: RelocationStage): void {
    this.stage = stage
  }

  sendProgress(progress: RelocationProgress): void {
    this.stage = progress.stage
    if (this.hasWindow() && !this.criticalWindowUnavailable) {
      this.window!.webContents.send(RelocationIpcChannels.Progress, progress)
    }
  }

  shouldRestartAfterTerminalFailure(): boolean {
    return this.criticalWindowUnavailable
  }

  close(): void {
    if (this.hasWindow()) {
      this.programmaticClose = true
      this.window!.close()
      this.window = null
    }
  }

  /**
   * Relaunch the app via the Application singleton (handles dev-mode dialog,
   * AppImage / portable exec paths). Mirrors how the v2 migration gate
   * relaunches — preboot code can't assume the lifecycle container is up,
   * but the `application` singleton's relaunch/quit are thin wrappers safe
   * to call before bootstrap.
   */
  async restartApp(): Promise<void> {
    logger.info('Relaunching application after relocation')
    this.close()
    application.relaunch()
  }

  private handleRendererUnavailable(kind: 'gone' | 'unresponsive', reason?: string): void {
    if (!isClosable(this.stage)) {
      this.criticalWindowUnavailable = true
      logger.error('Relocation renderer unavailable during critical stage; continuing headlessly', {
        kind,
        reason,
        stage: this.stage
      })
      return
    }

    logger.error('Relocation renderer unavailable; forcing relaunch', { kind, reason, stage: this.stage })
    void this.restartApp()
  }

  private createReadyPromise(window: BrowserWindow, load?: () => Promise<void> | void): Promise<ReadyResult> {
    return new Promise<ReadyResult>((resolve) => {
      let settled = false
      const webContents = window.webContents
      const timeout = setTimeout(() => {
        rejectReady(`Relocation window did not become ready within ${READY_TIMEOUT_MS}ms`, { kind: 'timeout' })
      }, READY_TIMEOUT_MS)
      timeout.unref?.()

      const cleanup = () => {
        clearTimeout(timeout)
        webContents.removeListener('did-finish-load', onFinish)
        webContents.removeListener('did-fail-load', onFailLoad)
        webContents.removeListener('render-process-gone', onRendererGone)
        window.removeListener('closed', onClosed)
      }
      const resolveReady = () => {
        if (settled) return
        settled = true
        cleanup()
        resolve({ ok: true })
      }
      const rejectReady = (message: string, detail: Record<string, unknown>) => {
        if (settled) return
        settled = true
        this.criticalWindowUnavailable = true
        cleanup()
        logger.error('Relocation window failed before ready; continuing headlessly', {
          ...detail,
          stage: this.stage
        })
        resolve({ ok: false, error: new Error(message) })
      }
      const onFinish = () => resolveReady()
      const onFailLoad = (
        _event: unknown,
        errorCode: number,
        errorDescription: string,
        validatedURL: string,
        isMainFrame?: boolean
      ) => {
        if (isMainFrame === false) return
        rejectReady(`Relocation window failed to load: ${errorDescription || errorCode}`, {
          kind: 'did-fail-load',
          errorCode,
          errorDescription,
          validatedURL
        })
      }
      const onRendererGone = (_event: unknown, details: { reason?: string }) => {
        rejectReady(`Relocation renderer exited before ready: ${details.reason ?? 'unknown'}`, {
          kind: 'render-process-gone',
          reason: details.reason
        })
      }
      const onClosed = () => {
        rejectReady('Relocation window closed before ready', { kind: 'closed' })
      }

      webContents.once('did-finish-load', onFinish)
      webContents.once('did-fail-load', onFailLoad)
      webContents.once('render-process-gone', onRendererGone)
      window.once('closed', onClosed)

      try {
        Promise.resolve(load?.()).catch((error) => {
          rejectReady(`Relocation window failed to load: ${(error as Error).message}`, {
            kind: 'load-promise',
            error: (error as Error).message
          })
        })
      } catch (error) {
        rejectReady(`Relocation window failed to load: ${(error as Error).message}`, {
          kind: 'load-throw',
          error: (error as Error).message
        })
      }
    })
  }
}

export const relocationWindowManager = new RelocationWindowManager()
