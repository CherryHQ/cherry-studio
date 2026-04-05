import type { WebviewKeyEvent } from '@shared/config/types'
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'
import { IpcChannel } from '@shared/IpcChannel'
import { ipcRenderer } from 'electron'

export const windowApi = {
  window: {
    setMinimumSize: (width: number, height: number) =>
      ipcRenderer.invoke(IpcChannel.Windows_SetMinimumSize, width, height),
    resetMinimumSize: () => ipcRenderer.invoke(IpcChannel.Windows_ResetMinimumSize),
    getSize: (): Promise<[number, number]> => ipcRenderer.invoke(IpcChannel.Windows_GetSize)
  },
  windowControls: {
    minimize: (): Promise<void> => ipcRenderer.invoke(IpcChannel.Windows_Minimize),
    maximize: (): Promise<void> => ipcRenderer.invoke(IpcChannel.Windows_Maximize),
    unmaximize: (): Promise<void> => ipcRenderer.invoke(IpcChannel.Windows_Unmaximize),
    close: (): Promise<void> => ipcRenderer.invoke(IpcChannel.Windows_Close),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke(IpcChannel.Windows_IsMaximized),
    onMaximizedChange: (callback: (isMaximized: boolean) => void): (() => void) => {
      const channel = IpcChannel.Windows_MaximizedChanged
      const listener = (_: Electron.IpcRendererEvent, isMaximized: boolean) => callback(isMaximized)
      ipcRenderer.on(channel, listener)
      return () => {
        ipcRenderer.removeListener(channel, listener)
      }
    }
  },
  miniWindow: {
    show: () => ipcRenderer.invoke(IpcChannel.MiniWindow_Show),
    hide: () => ipcRenderer.invoke(IpcChannel.MiniWindow_Hide),
    close: () => ipcRenderer.invoke(IpcChannel.MiniWindow_Close),
    toggle: () => ipcRenderer.invoke(IpcChannel.MiniWindow_Toggle),
    setPin: (isPinned: boolean) => ipcRenderer.invoke(IpcChannel.MiniWindow_SetPin, isPinned)
  },
  selectionMenu: {
    action: (action: string) => ipcRenderer.invoke('selection-menu:action', action)
  },
  selection: {
    hideToolbar: () => ipcRenderer.invoke(IpcChannel.Selection_ToolbarHide),
    writeToClipboard: (text: string) => ipcRenderer.invoke(IpcChannel.Selection_WriteToClipboard, text),
    determineToolbarSize: (width: number, height: number) =>
      ipcRenderer.invoke(IpcChannel.Selection_ToolbarDetermineSize, width, height),
    processAction: (actionItem: SelectionActionItem, isFullScreen: boolean = false) =>
      ipcRenderer.invoke(IpcChannel.Selection_ProcessAction, actionItem, isFullScreen),
    closeActionWindow: () => ipcRenderer.invoke(IpcChannel.Selection_ActionWindowClose),
    minimizeActionWindow: () => ipcRenderer.invoke(IpcChannel.Selection_ActionWindowMinimize),
    pinActionWindow: (isPinned: boolean) => ipcRenderer.invoke(IpcChannel.Selection_ActionWindowPin, isPinned),
    // [Windows only] Electron bug workaround - can be removed once https://github.com/electron/electron/issues/48554 is fixed
    resizeActionWindow: (deltaX: number, deltaY: number, direction: string) =>
      ipcRenderer.invoke(IpcChannel.Selection_ActionWindowResize, deltaX, deltaY, direction),
    getLinuxEnvInfo: () => ipcRenderer.invoke(IpcChannel.Selection_GetLinuxEnvInfo)
  },
  searchService: {
    openSearchWindow: (uid: string, show?: boolean) => ipcRenderer.invoke(IpcChannel.SearchWindow_Open, uid, show),
    closeSearchWindow: (uid: string) => ipcRenderer.invoke(IpcChannel.SearchWindow_Close, uid),
    openUrlInSearchWindow: (uid: string, url: string) => ipcRenderer.invoke(IpcChannel.SearchWindow_OpenUrl, uid, url)
  },
  webview: {
    setOpenLinkExternal: (webviewId: number, isExternal: boolean) =>
      ipcRenderer.invoke(IpcChannel.Webview_SetOpenLinkExternal, webviewId, isExternal),
    setSpellCheckEnabled: (webviewId: number, isEnable: boolean) =>
      ipcRenderer.invoke(IpcChannel.Webview_SetSpellCheckEnabled, webviewId, isEnable),
    printToPDF: (webviewId: number) => ipcRenderer.invoke(IpcChannel.Webview_PrintToPDF, webviewId),
    saveAsHTML: (webviewId: number) => ipcRenderer.invoke(IpcChannel.Webview_SaveAsHTML, webviewId),
    onFindShortcut: (callback: (payload: WebviewKeyEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: WebviewKeyEvent) => {
        callback(payload)
      }
      ipcRenderer.on(IpcChannel.Webview_SearchHotkey, listener)
      return () => {
        ipcRenderer.off(IpcChannel.Webview_SearchHotkey, listener)
      }
    }
  }
}
