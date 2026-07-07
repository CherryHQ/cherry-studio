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

function isClosable(stage: RelocationStage): boolean {
  return !NON_CLOSABLE_STAGES.has(stage)
}

export class RelocationWindowManager {
  private window: BrowserWindow | null = null
  private stage: RelocationStage = 'preparing'
  private programmaticClose = false

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

    // Safety net: if the renderer dies we can't show the completion/
    // failure button, so force the relaunch ourselves.
    this.window.webContents.on('render-process-gone', (_event, details) => {
      logger.error('Relocation renderer process gone; forcing relaunch', { reason: details.reason })
      void this.restartApp()
    })
    this.window.webContents.on('unresponsive', () => {
      logger.error('Relocation renderer unresponsive; forcing relaunch')
      void this.restartApp()
    })

    if (process.env['ELECTRON_RENDERER_URL']) {
      void this.window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/windows/relocation/index.html`)
    } else {
      void this.window.loadFile(join(__dirname, '../renderer/windows/relocation/index.html'))
    }

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
    return new Promise<void>((resolve) => {
      if (this.window!.webContents.isLoading()) {
        this.window!.webContents.once('did-finish-load', () => resolve())
      } else {
        resolve()
      }
    })
  }

  setStage(stage: RelocationStage): void {
    this.stage = stage
  }

  sendProgress(progress: RelocationProgress): void {
    this.stage = progress.stage
    if (this.hasWindow()) {
      this.window!.webContents.send(RelocationIpcChannels.Progress, progress)
    }
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
}

export const relocationWindowManager = new RelocationWindowManager()
