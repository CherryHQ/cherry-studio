import { electronAPI } from '@electron-toolkit/preload'
import { WebDavConfig } from '@types'
import { contextBridge, ipcRenderer, OpenDialogOptions } from 'electron'

// Custom APIs for renderer
const api = {
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  reload: () => ipcRenderer.invoke('app:reload'),
  setProxy: (proxy: string) => ipcRenderer.invoke('app:proxy', proxy),
  checkForUpdate: () => ipcRenderer.invoke('app:check-for-update'),
  setLanguage: (lang: string) => ipcRenderer.invoke('app:set-language', lang),
  setTray: (isActive: boolean) => ipcRenderer.invoke('app:set-tray', isActive),
  setTheme: (theme: 'light' | 'dark') => ipcRenderer.invoke('app:set-theme', theme),
  openWebsite: (url: string) => ipcRenderer.invoke('open:website', url),
  minApp: (url: string) => ipcRenderer.invoke('minapp', url),
  zip: {
    compress: (text: string) => ipcRenderer.invoke('zip:compress', text),
    decompress: (text: Buffer) => ipcRenderer.invoke('zip:decompress', text)
  },
  backup: {
    backup: (fileName: string, data: string, destinationPath?: string) =>
      ipcRenderer.invoke('backup:backup', fileName, data, destinationPath),
    restore: (backupPath: string) => ipcRenderer.invoke('backup:restore', backupPath),
    backupToWebdav: (data: string, webdavConfig: WebDavConfig) =>
      ipcRenderer.invoke('backup:backupToWebdav', data, webdavConfig),
    restoreFromWebdav: (webdavConfig: WebDavConfig) => ipcRenderer.invoke('backup:restoreFromWebdav', webdavConfig)
  },
  file: {
    select: (options?: OpenDialogOptions) => ipcRenderer.invoke('file:select', options),
    upload: (filePath: string) => ipcRenderer.invoke('file:upload', filePath),
    delete: (fileId: string) => ipcRenderer.invoke('file:delete', fileId),
    read: (fileId: string) => ipcRenderer.invoke('file:read', fileId),
    clear: () => ipcRenderer.invoke('file:clear'),
    get: (filePath: string) => ipcRenderer.invoke('file:get', filePath),
    create: (fileName: string) => ipcRenderer.invoke('file:create', fileName),
    write: (filePath: string, data: Uint8Array | string) => ipcRenderer.invoke('file:write', filePath, data),
    open: (options?: { decompress: boolean }) => ipcRenderer.invoke('file:open', options),
    save: (path: string, content: string, options?: { compress: boolean }) =>
      ipcRenderer.invoke('file:save', path, content, options),
    selectFolder: () => ipcRenderer.invoke('file:selectFolder'),
    saveImage: (name: string, data: string) => ipcRenderer.invoke('file:saveImage', name, data),
    base64Image: (fileId: string) => ipcRenderer.invoke('file:base64Image', fileId),
    download: (url: string) => ipcRenderer.invoke('file:download', url),
    copy: (fileId: string, destPath: string) => ipcRenderer.invoke('file:copy', fileId, destPath)
  },
  export: {
    toWord: (markdown: string, fileName: string) => ipcRenderer.invoke('export:word', markdown, fileName)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
