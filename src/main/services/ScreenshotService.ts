import { loggerService } from '@logger'
import { isDev, isMac, isWin } from '@main/constant'
import { fileStorage } from '@main/services/FileStorage'
import { IpcChannel } from '@shared/IpcChannel'
import type { FileMetadata } from '@types'
import { FileTypes } from '@types'
import { BrowserWindow, screen, systemPreferences } from 'electron'
import fs from 'fs'
import { join } from 'path'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

const logger = loggerService.withContext('ScreenshotService')

type PermissionStatus = 'granted' | 'denied'

type CaptureResult =
  | { success: true; file: FileMetadata }
  | { success: false; status: PermissionStatus; needsRestart: boolean; message: string }

type SelectionCaptureResult =
  | { success: true; file: FileMetadata }
  | { success: false; status: 'cancelled' | 'denied' | 'error'; needsRestart?: boolean; message: string }

interface Rectangle {
  x: number
  y: number
  width: number
  height: number
}

export class ScreenshotService {
  private selectionWindow: BrowserWindow | null = null
  private screenshotBuffer: Buffer | null = null
  private screenshotData: string | null = null
  private currentFileName: string | null = null
  private selectionPromise: {
    resolve: (value: SelectionCaptureResult) => void
    reject: (reason?: any) => void
  } | null = null
  public async capture(fileName: string): Promise<CaptureResult> {
    try {
      const Screenshots = await import('node-screenshots')

      // Try to capture - this will trigger permission dialog if needed
      const monitor = Screenshots.Monitor.fromPoint(0, 0) ?? Screenshots.Monitor.all()[0]

      if (!monitor) {
        logger.error('No monitor found for screenshot')
        return {
          success: false,
          status: 'denied',
          needsRestart: false,
          message: 'No monitor found'
        }
      }

      const image = await monitor.captureImage()
      const buffer = await image.toPng()

      const ext = '.png'
      const tempFilePath = await fileStorage.createTempFile(undefined, fileName || `screenshot${ext}`)
      await fs.promises.writeFile(tempFilePath, buffer)

      const stats = await fs.promises.stat(tempFilePath)
      const id = uuidv4()
      const file: FileMetadata = {
        id,
        name: `${id}${ext}`,
        origin_name: path.basename(fileName || 'screenshot.png'),
        path: tempFilePath,
        size: stats.size,
        ext,
        type: FileTypes.IMAGE,
        created_at: new Date().toISOString(),
        count: 1
      }

      return { success: true, file }
    } catch (error) {
      logger.error('Screenshot capture failed', error as Error)

      // Check if it's a permission issue on macOS
      if (process.platform === 'darwin') {
        const status = systemPreferences.getMediaAccessStatus('screen')
        logger.info('Permission status after error:', { status })

        if (status !== 'granted') {
          return {
            success: false,
            status: 'denied',
            needsRestart: status === 'not-determined' ? false : true,
            message: 'Screen recording permission required'
          }
        }
      }

      return {
        success: false,
        status: 'denied',
        needsRestart: false,
        message: error instanceof Error ? error.message : 'Screenshot capture failed'
      }
    }
  }

  private createSelectionWindow(): BrowserWindow {
    const display = screen.getPrimaryDisplay()
    const { width, height } = display.bounds

    const window = new BrowserWindow({
      width,
      height,
      x: display.bounds.x,
      y: display.bounds.y,
      show: false,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      movable: false,
      hasShadow: false,
      enableLargerThanScreen: true,

      // Platform specific settings
      ...(isWin ? { type: 'toolbar', focusable: false } : { type: 'panel' }),
      ...(isMac && { hiddenInMissionControl: true, acceptFirstMouse: true, visibleOnAllWorkspaces: true }),

      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        devTools: isDev ? true : false
      }
    })

    // Clean up when closed
    window.on('closed', () => {
      this.cleanupSelection()
    })

    // Load the selection HTML
    if (isDev) {
      window.loadURL(`http://localhost:5173/screenshotSelection.html`)
    } else {
      window.loadFile(join(__dirname, '../renderer/screenshotSelection.html'))
    }

    return window
  }

  private cleanupSelection() {
    if (this.selectionWindow && !this.selectionWindow.isDestroyed()) {
      this.selectionWindow.destroy()
    }
    this.selectionWindow = null
    this.screenshotBuffer = null
    this.screenshotData = null
    this.currentFileName = null
    this.selectionPromise = null
  }

  public confirmSelection(selection: Rectangle): void {
    if (!this.selectionPromise) {
      logger.warn('No active selection to confirm')
      return
    }

    // Validate selection
    if (selection.width < 10 || selection.height < 10) {
      this.selectionPromise.resolve({
        success: false,
        status: 'error',
        message: 'Selection too small (minimum 10×10 pixels)'
      })
      this.cleanupSelection()
      return
    }

    // Process the selection
    this.processSelection(selection)
  }

  public cancelSelection(): void {
    if (!this.selectionPromise) {
      logger.warn('No active selection to cancel')
      return
    }

    this.selectionPromise.resolve({
      success: false,
      status: 'cancelled',
      message: 'User cancelled selection'
    })
    this.cleanupSelection()
  }

  private async processSelection(selection: Rectangle): Promise<void> {
    if (!this.screenshotBuffer || !this.selectionPromise) {
      logger.error('Missing screenshot buffer or selection promise')
      this.cleanupSelection()
      return
    }

    try {
      // Get display scale factor for HiDPI support
      const cursorPoint = screen.getCursorScreenPoint()
      const display = screen.getDisplayNearestPoint(cursorPoint)
      const scaleFactor = display.scaleFactor

      // Crop the screenshot
      const croppedBuffer = await this.cropScreenshot(this.screenshotBuffer, selection, scaleFactor)

      // Save the cropped image
      const ext = '.png'
      const fileName = this.currentFileName || `screenshot_${Date.now()}${ext}`
      const tempFilePath = await fileStorage.createTempFile({} as any, fileName)
      await fs.promises.writeFile(tempFilePath, croppedBuffer)

      const stats = await fs.promises.stat(tempFilePath)
      const id = uuidv4()
      const file: FileMetadata = {
        id,
        name: `${id}${ext}`,
        origin_name: fileName,
        path: tempFilePath,
        size: stats.size,
        ext,
        type: FileTypes.IMAGE,
        created_at: new Date().toISOString(),
        count: 1
      }

      this.selectionPromise.resolve({ success: true, file })
    } catch (error) {
      logger.error('Failed to process selection', error as Error)
      this.selectionPromise.resolve({
        success: false,
        status: 'error',
        message: error instanceof Error ? error.message : 'Failed to process selection'
      })
    } finally {
      this.cleanupSelection()
    }
  }

  private async cropScreenshot(buffer: Buffer, selection: Rectangle, scaleFactor: number): Promise<Buffer> {
    const sharp = (await import('sharp')).default

    return sharp(buffer)
      .extract({
        left: Math.round(selection.x * scaleFactor),
        top: Math.round(selection.y * scaleFactor),
        width: Math.round(selection.width * scaleFactor),
        height: Math.round(selection.height * scaleFactor)
      })
      .png()
      .toBuffer()
  }

  public async captureWithSelection(fileName: string): Promise<SelectionCaptureResult> {
    try {
      // Try to capture - this will trigger permission dialog if needed
      const Screenshots = await import('node-screenshots')
      const monitor = Screenshots.Monitor.fromPoint(0, 0) ?? Screenshots.Monitor.all()[0]

      if (!monitor) {
        logger.error('No monitor found for screenshot')
        return {
          success: false,
          status: 'error',
          message: 'No monitor found'
        }
      }

      const image = await monitor.captureImage()
      const buffer = await image.toPng()

      // Store the buffer and fileName for later cropping
      this.screenshotBuffer = buffer
      this.currentFileName = fileName

      // Write buffer to a temporary file and store the file URL for the renderer
      const os = await import('os');
      const tempDir = os.tmpdir();
      const tempFileName = `screenshot-${uuidv4()}.png`;
      const tempFilePath = path.join(tempDir, tempFileName);
      await fs.promises.writeFile(tempFilePath, buffer);
      this.screenshotData = `file://${tempFilePath}`;

      // Create or show selection window
      if (!this.selectionWindow || this.selectionWindow.isDestroyed()) {
        this.selectionWindow = this.createSelectionWindow()
      }

      // Return a promise that resolves when user confirms or cancels
      return new Promise((resolve, reject) => {
        this.selectionPromise = { resolve, reject }

        // Show the window and send screenshot data
        this.selectionWindow!.once('ready-to-show', () => {
          this.selectionWindow!.show()
          this.selectionWindow!.focus()

          // Send screenshot data to renderer
          this.selectionWindow!.webContents.send(IpcChannel.Screenshot_SelectionWindowReady, {
            screenshotData: this.screenshotData
          })
        })
      })
    } catch (error) {
      logger.error('Screenshot capture with selection failed', error as Error)
      this.cleanupSelection()

      // Check if it's a permission issue on macOS
      if (process.platform === 'darwin') {
        const status = systemPreferences.getMediaAccessStatus('screen')
        logger.info('Permission status after error:', { status })

        if (status !== 'granted') {
          return {
            success: false,
            status: 'denied',
            needsRestart: status === 'not-determined' ? false : true,
            message: 'Screen recording permission required'
          }
        }
      }

      return {
        success: false,
        status: 'error',
        message: error instanceof Error ? error.message : 'Screenshot capture failed'
      }
    }
  }
}
