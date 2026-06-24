/**
 * Migration window manager for creating and managing the migration window
 */

import { loggerService } from '@logger'
import { isDev, isMac } from '@main/core/platform'
import { MigrationIpcChannels, type MigrationStage } from '@shared/data/migration/v2/types'
import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'path'

const logger = loggerService.withContext('MigrationWindowManager')

// Exhaustive by stage so adding a MigrationStage requires an explicit close-confirm decision.
const CLOSE_CONFIRM_BY_STAGE: Record<MigrationStage, boolean> = {
  version_incompatible: false,
  introduction: false,
  backup_required: true,
  backup_progress: true,
  backup_confirmed: true,
  migration: true,
  completed: false,
  error: false
}

function isCloseConfirmStage(stage: MigrationStage): boolean {
  return CLOSE_CONFIRM_BY_STAGE[stage]
}

export class MigrationWindowManager {
  private window: BrowserWindow | null = null
  // Guards the user-initiated-close handler so our own programmatic close()
  // calls (cancel / skip / restart) don't trigger a second app quit.
  private programmaticClose = false
  // Live migration stage, pushed from the IPC handler's updateProgress(). Used by the
  // close handler to decide whether a user-initiated close needs confirmation.
  private currentStage: MigrationStage = 'introduction'
  // Set once we've asked the renderer to confirm an in-flow close. While set, any further close
  // escapes a wedged renderer (crash / frozen tree / lost IPC listener) by force-quitting.
  // Cleared when the renderer acks a dismissal (CancelClose) or the stage leaves the in-flow set.
  private closeConfirmPending = false
  // Routes a force-quit through the IPC handler's write-deferral (await any in-flight
  // backup/migration before quitting). Wired by registerMigrationIpcHandlers(); null only in
  // isolated tests, where nothing can be in flight so confirmQuit() is a safe fallback.
  private requestQuit: (() => boolean) | null = null

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

    // Reset per-window guards so a recreated window starts clean (a stale
    // programmaticClose would otherwise suppress the close-confirmation seam).
    this.programmaticClose = false
    this.currentStage = 'introduction'
    this.closeConfirmPending = false

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
    // stage we intercept and let the renderer show its in-app
    // confirmation dialog instead (it reports back via ConfirmQuit). Programmatic close()
    // calls set the guard to opt out. This seam covers the native macOS traffic light,
    // Cmd+Q, and the custom Windows/Linux close button (which routes through requestClose()).
    this.window.on('close', (event) => {
      if (this.programmaticClose) return
      if (isCloseConfirmStage(this.currentStage)) {
        event.preventDefault()
        // Escape hatch: if a confirmation is already pending and the user closes again, the
        // renderer's dialog never reached them (crash / frozen tree / lost listener) — force the
        // quit ourselves (routed through the write-deferral) instead of re-asking into the void.
        if (this.closeConfirmPending) {
          this.forceQuit('repeat-close')
          return
        }
        this.closeConfirmPending = true
        this.send(MigrationIpcChannels.ConfirmClose)
        return
      }
      logger.info('Migration window closed by user; quitting app')
      app.quit()
    })

    // Escape hatch for an unrecoverably wedged renderer: a crashed or hung renderer can never
    // show the close-confirmation dialog, which would otherwise leave this app-gating window
    // unclosable. Quit safely (via the write-deferral) on either signal.
    this.window.webContents.on('render-process-gone', (_event, details) => {
      logger.error('Migration renderer process gone; forcing safe quit', { reason: details.reason })
      this.forceQuit(`render-process-gone:${details.reason}`)
    })
    this.window.webContents.on('unresponsive', () => {
      logger.error('Migration renderer unresponsive; forcing safe quit')
      this.forceQuit('unresponsive')
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
    // Leaving the in-flow set (e.g. to completed/error) means a close now quits immediately, so a
    // stale pending flag must not carry over and force-quit a re-entered in-flow stage later.
    if (!isCloseConfirmStage(stage)) {
      this.closeConfirmPending = false
    }
  }

  /**
   * Wire the force-quit path to the IPC handler's write-deferral. Called by
   * registerMigrationIpcHandlers(); passing null on unregister.
   */
  setQuitRequester(fn: (() => boolean) | null): void {
    this.requestQuit = fn
  }

  /**
   * The renderer dismissed the in-flow close dialog without quitting (Continue / Esc / backdrop).
   * Drop the pending flag so the next close re-prompts instead of force-quitting.
   */
  clearCloseConfirm(): void {
    this.closeConfirmPending = false
  }

  /**
   * Force a quit when the renderer can't drive the normal ConfirmQuit path (crash, hang, or a
   * repeated close while a confirmation is pending). Routes through the IPC handler's deferral so
   * an in-flight backup/migration write still settles first; falls back to confirmQuit() only when
   * no requester is wired (isolated tests), where nothing can be in flight.
   */
  private forceQuit(reason: string): void {
    logger.warn('Forcing migration window quit', { reason })
    this.closeConfirmPending = false
    if (this.requestQuit) {
      this.requestQuit()
    } else {
      this.confirmQuit()
    }
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
