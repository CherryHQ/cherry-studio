/**
 * Migration window manager for creating and managing the migration window
 */

import { loggerService } from '@logger'
import { isDev, isMac } from '@main/core/platform'
import { MigrationIpcChannels, type MigrationStage } from '@shared/data/migration/v2/types'
import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'path'

const logger = loggerService.withContext('MigrationWindowManager')

// Stages where a user-initiated close is intercepted to confirm before quitting. These are
// the in-flow stages: the user has committed to migrating but it isn't finished, so an
// accidental close (which quits the whole app) should ask first. The entry page
// (`introduction`) and terminal pages (`completed` / `error` / `version_incompatible`) are
// excluded — closing there is the expected action and quits immediately.
const CLOSE_CONFIRM_STAGES: ReadonlySet<MigrationStage> = new Set([
  'backup_required',
  'backup_progress',
  'backup_confirmed',
  'migration'
])

export class MigrationWindowManager {
  private window: BrowserWindow | null = null
  // Guards the user-initiated-close handler so our own programmatic close()
  // calls (cancel / skip / restart) don't trigger a second app quit.
  private programmaticClose = false
  // Live migration stage, pushed from the IPC handler's updateProgress(). Used by the
  // close handler to decide whether a user-initiated close needs confirmation.
  private currentStage: MigrationStage = 'introduction'

  /**
   * Check if migration window exists and is not destroyed
   */
  hasWindow(): boolean {
    return this.window !== null && !this.window.isDestroyed()
  }

  /**
   * Get the current migration window
   */
  getWindow(): BrowserWindow | null {
    return this.window
  }

  /**
   * Create and show the migration window
   */
  create(): BrowserWindow {
    if (this.hasWindow()) {
      this.window!.show()
      return this.window!
    }

    logger.info('Creating migration window')

    this.window = new BrowserWindow({
      width: 900,
      height: 620,
      resizable: false,
      maximizable: false,
      minimizable: true,
      show: false,
      autoHideMenuBar: true,
      // macOS shows real native traffic lights (red close / yellow minimize; green zoom
      // auto-disables for a non-resizable window). Windows/Linux stay frameless and draw
      // custom controls in the renderer (no native buttons-only overlay exists on Linux).
      ...(isMac ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 12, y: 15 } } : { frame: false }),
      webPreferences: {
        preload: join(__dirname, '../preload/simplest.js'),
        sandbox: false,
        webSecurity: false,
        contextIsolation: true
      }
    })

    // User-initiated window close uses cancel semantics: quit the app. During an in-flow
    // stage (see CLOSE_CONFIRM_STAGES) we intercept and let the renderer show its in-app
    // confirmation dialog instead (it reports back via ConfirmQuit). Programmatic close()
    // calls set the guard to opt out. This seam covers the native macOS traffic light,
    // Cmd+Q, and the custom Windows/Linux close button (which routes through requestClose()).
    this.window.on('close', (event) => {
      if (this.programmaticClose) return
      if (CLOSE_CONFIRM_STAGES.has(this.currentStage)) {
        event.preventDefault()
        this.send(MigrationIpcChannels.ConfirmClose)
        return
      }
      logger.info('Migration window closed by user; quitting app')
      app.quit()
    })

    // Load the migration window.
    if (isDev && process.env['ELECTRON_RENDERER_URL']) {
      void this.window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/windows/migrationV2/index.html`)
    } else {
      void this.window.loadFile(join(__dirname, '../renderer/windows/migrationV2/index.html'))
    }

    this.window.once('ready-to-show', () => {
      this.window?.show()
      logger.info('Migration window shown')
    })

    this.window.on('closed', () => {
      this.window = null
      logger.info('Migration window closed')
    })

    return this.window
  }

  /**
   * Wait for window to be ready
   */
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

  /**
   * Close the migration window
   */
  close(): void {
    if (this.hasWindow()) {
      this.programmaticClose = true
      this.window!.close()
      this.window = null
    }
  }

  /**
   * Minimize the migration window. Triggered by the renderer's custom minimize control on
   * Windows/Linux (macOS uses the native traffic light).
   */
  minimize(): void {
    if (this.hasWindow()) {
      this.window!.minimize()
    }
  }

  /**
   * Request a user-initiated close. Routes through the native `close` event (no programmatic
   * guard) so the in-flow confirmation applies. Triggered by the renderer's custom close
   * control on Windows/Linux.
   */
  requestClose(): void {
    if (this.hasWindow()) {
      this.window!.close()
    }
  }

  /**
   * Track the live migration stage so the close handler can decide whether to confirm.
   * Pushed from the IPC handler's updateProgress().
   */
  setStage(stage: MigrationStage): void {
    this.currentStage = stage
  }

  /**
   * The user confirmed quitting from the renderer's in-flow close dialog. Close the
   * window programmatically (bypassing the confirmation seam) and quit.
   */
  confirmQuit(): void {
    logger.info('User confirmed quit during an in-flow migration stage; quitting app')
    this.close()
    app.quit()
  }

  /**
   * Send message to the migration window
   */
  send(channel: string, ...args: unknown[]): void {
    if (this.hasWindow()) {
      this.window!.webContents.send(channel, ...args)
    }
  }

  /**
   * Restart the application
   */
  async restartApp(): Promise<void> {
    logger.info('Restarting application after migration')

    // In development mode, relaunch might not work properly
    if (isDev || !app.isPackaged) {
      logger.warn('Development mode detected - showing restart instruction instead of auto-restart')

      await dialog.showMessageBox({
        type: 'info',
        title: 'Migration Complete - Restart Required',
        message:
          'Data migration completed successfully!\n\nSince you are in development mode, please manually restart the application to continue.',
        buttons: ['Close App'],
        defaultId: 0
      })

      this.close()
      app.quit()
    } else {
      // Production mode - clean up first, then relaunch
      this.close()
      app.relaunch()
      app.exit(0)
    }
  }
}

// Export singleton instance
export const migrationWindowManager = new MigrationWindowManager()
