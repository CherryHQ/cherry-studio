/**
 * Migration window manager for creating and managing the migration window
 */

import { loggerService } from '@logger'
import { isDev } from '@main/constant'
import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'path'

const logger = loggerService.withContext('MigrationWindowManager')

export class MigrationWindowManager {
  private window: BrowserWindow | null = null

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
      width: 640,
      height: 480,
      resizable: false,
      maximizable: false,
      minimizable: false,
      show: false,
      frame: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/simplest.js'),
        sandbox: false,
        webSecurity: false,
        contextIsolation: true
      }
    })

    // Load the migration window
    if (isDev && process.env['ELECTRON_RENDERER_URL']) {
      this.window.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/migrationV2.html')
    } else {
      this.window.loadFile(join(__dirname, '../renderer/migrationV2.html'))
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
      this.window!.close()
      this.window = null
    }
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
