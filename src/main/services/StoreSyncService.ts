import { IpcChannel } from '@shared/IpcChannel'
import type { StoreSyncAction } from '@types'
import { BrowserWindow, ipcMain } from 'electron'

/**
 * StoreSyncService class manages Redux store synchronization between multiple windows in the main process
 * It uses singleton pattern to ensure only one sync service instance exists in the application
 *
 * Main features:
 * 1. Manages window subscriptions for store sync
 * 2. Handles IPC communication for store sync between windows
 * 3. Broadcasts Redux actions from one window to all other windows
 * 4. Adds metadata to synced actions to prevent infinite sync loops
 */
export class StoreSyncService {
  private static instance: StoreSyncService
  private windowIds: number[] = []
  private isIpcHandlerRegistered = false

  private constructor() {
    return
  }

  /**
   * Get the singleton instance of StoreSyncService
   */
  public static getInstance(): StoreSyncService {
    if (!StoreSyncService.instance) {
      StoreSyncService.instance = new StoreSyncService()
    }
    return StoreSyncService.instance
  }

  /**
   * Subscribe a window to store sync
   * @param windowId ID of the window to subscribe
   */
  public subscribe(windowId: number): void {
    if (!this.windowIds.includes(windowId)) {
      this.windowIds.push(windowId)
    }
  }

  /**
   * Unsubscribe a window from store sync
   * @param windowId ID of the window to unsubscribe
   */
  public unsubscribe(windowId: number): void {
    this.windowIds = this.windowIds.filter((id) => id !== windowId)
  }

  /**
   * Sync an action to all renderer windows
   * @param type Action type, like 'settings/setTray'
   * @param payload Action payload
   *
   * NOTICE: DO NOT use directly in ConfigManager, may cause infinite sync loop
   */
  public syncToRenderer(type: string, payload: any): void {
    const action: StoreSyncAction = {
      type,
      payload
    }

    //-1 means the action is from the main process, will be broadcast to all windows
    this.broadcastToOtherWindows(-1, action)
  }

  /**
   * Register IPC handlers for store sync communication
   * Handles window subscription, unsubscription and action broadcasting
   */
  public registerIpcHandler(): void {
    if (this.isIpcHandlerRegistered) return

    ipcMain.handle(IpcChannel.StoreSync_Subscribe, (event) => {
      const windowId = BrowserWindow.fromWebContents(event.sender)?.id
      if (windowId) {
        this.subscribe(windowId)
      }
    })

    ipcMain.handle(IpcChannel.StoreSync_Unsubscribe, (event) => {
      const windowId = BrowserWindow.fromWebContents(event.sender)?.id
      if (windowId) {
        this.unsubscribe(windowId)
      }
    })

    ipcMain.handle(IpcChannel.StoreSync_OnUpdate, (event, action: StoreSyncAction) => {
      const sourceWindowId = BrowserWindow.fromWebContents(event.sender)?.id

      if (!sourceWindowId) return

      // Broadcast the action to all other windows
      this.broadcastToOtherWindows(sourceWindowId, action)
    })

    this.isIpcHandlerRegistered = true
  }

  /**
   * Broadcast a Redux action to all other windows except the source
   * @param sourceWindowId ID of the window that originated the action
   * @param action Redux action to broadcast
   */
  private broadcastToOtherWindows(sourceWindowId: number, action: StoreSyncAction): void {
    // Add metadata to indicate this action came from sync
    const syncAction = {
      ...action,
      meta: {
        ...action.meta,
        fromSync: true,
        source: `windowId:${sourceWindowId}`
      }
    }

    // Send to all windows except the source
    this.windowIds.forEach((windowId) => {
      if (windowId !== sourceWindowId) {
        const targetWindow = BrowserWindow.fromId(windowId)
        if (targetWindow && !targetWindow.isDestroyed()) {
          targetWindow.webContents.send(IpcChannel.StoreSync_BroadcastSync, syncAction)
        } else {
          this.unsubscribe(windowId)
        }
      }
    })
  }
}

// Export singleton instance
export default StoreSyncService.getInstance()
