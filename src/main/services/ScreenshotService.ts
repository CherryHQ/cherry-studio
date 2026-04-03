import { loggerService } from '@logger'
import { isDev, isMac, isWin } from '@main/constant'
import { fileStorage } from '@main/services/FileStorage'
import { IpcChannel } from '@shared/IpcChannel'
import type { FileMetadata } from '@types'
import { BrowserWindow, screen, systemPreferences } from 'electron'
import fs from 'fs'
import { join } from 'path'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

let ScreenshotsModule: any = null
try {
  ScreenshotsModule = require('node-screenshots')
} catch (error) {
  console.error('Failed to load node-screenshots:', error)
}

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

class ScreenshotService {
  private selectionWindow: BrowserWindow | null = null
  private screenshotBuffer: Buffer | null = null
  private screenshotData: string | null = null
  private screenshotTempPath: string | null = null
  private currentFileName: string | null = null
  private selectionPromise: {
    resolve: (value: SelectionCaptureResult) => void
    reject: (reason?: any) => void
  } | null = null

  public async capture(fileName: string): Promise<CaptureResult> {
    try {
      if (!ScreenshotsModule) {
        try {
          ScreenshotsModule = require('node-screenshots')
        } catch (loadError) {
          logger.error('Failed to load node-screenshots module', loadError as Error)
          return {
            success: false,
            status: 'denied',
            needsRestart: false,
            message: 'Screenshot module not available'
          }
        }
      }

      const monitor = ScreenshotsModule.Monitor.fromPoint(0, 0) ?? ScreenshotsModule.Monitor.all()[0]

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
      const tempFilePath = await fileStorage.createTempFile({} as any, fileName || `screenshot${ext}`)
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
        type: 'image',
        created_at: new Date().toISOString(),
        count: 1
      }

      return { success: true, file }
    } catch (error) {
      logger.error('Screenshot capture failed', error as Error)

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

    window.on('closed', async () => {
      await this.cleanupSelection()
    })

    if (isDev) {
      window.loadURL(`http://localhost:5173/screenshotSelection.html`)
    } else {
      window.loadFile(join(__dirname, '../renderer/screenshotSelection.html'))
    }

    return window
  }

  private async cleanupSelection() {
    if (this.selectionWindow && !this.selectionWindow.isDestroyed()) {
      this.selectionWindow.destroy()
    }
    this.selectionWindow = null
    this.screenshotBuffer = null
    this.screenshotData = null
    this.currentFileName = null
    this.selectionPromise = null

    if (this.screenshotTempPath) {
      try {
        await fs.promises.unlink(this.screenshotTempPath)
      } catch (error) {
        logger.warn('Failed to delete temporary screenshot file', error as Error)
      }
      this.screenshotTempPath = null
    }
  }

  public async confirmSelection(selection: Rectangle): Promise<void> {
    if (!this.selectionPromise) {
      logger.warn('No active selection to confirm')
      return
    }

    if (selection.width < 10 || selection.height < 10) {
      this.selectionPromise.resolve({
        success: false,
        status: 'error',
        message: 'Selection too small (minimum 10×10 pixels)'
      })
      await this.cleanupSelection()
      return
    }

    this.processSelection(selection)
  }

  public async cancelSelection(): Promise<void> {
    if (!this.selectionPromise) {
      logger.warn('No active selection to cancel')
      return
    }

    this.selectionPromise.resolve({
      success: false,
      status: 'cancelled',
      message: 'User cancelled selection'
    })
    await this.cleanupSelection()
  }

  private async processSelection(selection: Rectangle): Promise<void> {
    if (!this.screenshotBuffer || !this.selectionPromise) {
      logger.error('Missing screenshot buffer or selection promise')
      this.cleanupSelection()
      return
    }

    try {
      const cursorPoint = screen.getCursorScreenPoint()
      const display = screen.getDisplayNearestPoint(cursorPoint)
      const scaleFactor = display.scaleFactor

      const croppedBuffer = await this.cropScreenshot(this.screenshotBuffer, selection, scaleFactor)

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
        type: 'image',
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
      await this.cleanupSelection()
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
      if (!ScreenshotsModule) {
        try {
          ScreenshotsModule = require('node-screenshots')
        } catch (loadError) {
          logger.error('Failed to load node-screenshots module', loadError as Error)
          return {
            success: false,
            status: 'error',
            message: 'Screenshot module not available'
          }
        }
      }
      const monitor = ScreenshotsModule.Monitor.fromPoint(0, 0) ?? ScreenshotsModule.Monitor.all()[0]

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

      this.screenshotBuffer = buffer
      this.currentFileName = fileName

      const tempFilePath = await fileStorage.createTempFile({} as any, `screenshot-${uuidv4()}.png`)
      await fs.promises.writeFile(tempFilePath, buffer)
      this.screenshotTempPath = tempFilePath
      this.screenshotData = `file://${tempFilePath}`

      if (!this.selectionWindow || this.selectionWindow.isDestroyed()) {
        this.selectionWindow = this.createSelectionWindow()
      }

      return new Promise((resolve, reject) => {
        this.selectionPromise = { resolve, reject }

        this.selectionWindow!.once('ready-to-show', () => {
          this.selectionWindow!.show()
          this.selectionWindow!.focus()

          this.selectionWindow!.webContents.send(IpcChannel.Screenshot_SelectionWindowReady, {
            screenshotData: this.screenshotData
          })
        })
      })
    } catch (error) {
      logger.error('Screenshot capture with selection failed', error as Error)
      await this.cleanupSelection()

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

export const screenshotService = new ScreenshotService()
