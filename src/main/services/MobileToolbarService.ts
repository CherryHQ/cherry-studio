import { loggerService } from '@logger'
import { IpcChannel } from '@shared/IpcChannel'
import type { MobileToolbarAction, MobileToolbarSnapshot } from '@shared/types/mobileToolbar'
import { BrowserWindow, ipcMain } from 'electron'

const logger = loggerService.withContext('MobileToolbarService')

class MobileToolbarService {
  private latestSnapshot: MobileToolbarSnapshot | null = null
  private latestWindowId: number | null = null
  private isIpcHandlerRegistered = false

  public getSnapshot(): MobileToolbarSnapshot | null {
    return this.latestSnapshot
  }

  public registerIpcHandler(): void {
    if (this.isIpcHandlerRegistered) return

    ipcMain.handle(IpcChannel.MobileToolbar_Publish, (event, snapshot: MobileToolbarSnapshot | null) => {
      const windowId = BrowserWindow.fromWebContents(event.sender)?.id
      if (!windowId) return false

      if (!snapshot) {
        if (this.latestWindowId === windowId) {
          this.latestWindowId = null
          this.latestSnapshot = null
        }
        return true
      }

      this.latestWindowId = windowId
      this.latestSnapshot = snapshot
      return true
    })

    this.isIpcHandlerRegistered = true
  }

  public async requestAction(action: MobileToolbarAction): Promise<boolean> {
    if (!this.latestWindowId) return false

    const targetWindow = BrowserWindow.fromId(this.latestWindowId)
    if (!targetWindow || targetWindow.isDestroyed()) {
      this.latestWindowId = null
      this.latestSnapshot = null
      return false
    }

    try {
      targetWindow.webContents.send(IpcChannel.MobileToolbar_Action, action)
      return true
    } catch (error) {
      logger.warn('Failed to send mobile toolbar action to renderer', error as Error)
      return false
    }
  }
}

export const mobileToolbarService = new MobileToolbarService()
