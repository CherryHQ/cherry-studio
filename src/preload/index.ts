import type { ExtractChunkData } from '@cherrystudio/embedjs-interfaces'
import { electronAPI } from '@electron-toolkit/preload'
import { FileType, KnowledgeBaseParams, KnowledgeItem, MCPServer, Shortcut, WebDavConfig } from '@types'
import { contextBridge, ipcRenderer, OpenDialogOptions, shell } from 'electron'
import { CreateDirectoryOptions } from 'webdav'
import { IpcChannel } from '@shared/IpcChannel'

// Custom APIs for renderer
const api = {
  getAppInfo: () => ipcRenderer.invoke(IpcChannel.App_Info),
  reload: () => ipcRenderer.invoke(IpcChannel.App_Reload),
  setProxy: (proxy: string) => ipcRenderer.invoke(IpcChannel.App_Proxy, proxy),
  checkForUpdate: () => ipcRenderer.invoke(IpcChannel.App_CheckForUpdate),
  showUpdateDialog: () => ipcRenderer.invoke(IpcChannel.App_ShowUpdateDialog),
  setLanguage: (lang: string) => ipcRenderer.invoke(IpcChannel.App_SetLanguage, lang),
  setLaunchOnBoot: (isActive: boolean) => ipcRenderer.invoke(IpcChannel.App_SetLaunchOnBoot, isActive),
  setLaunchToTray: (isActive: boolean) => ipcRenderer.invoke(IpcChannel.App_SetLaunchToTray, isActive),
  setTray: (isActive: boolean) => ipcRenderer.invoke(IpcChannel.App_SetTray, isActive),
  setTrayOnClose: (isActive: boolean) => ipcRenderer.invoke(IpcChannel.App_SetTrayOnClose, isActive),
  restartTray: () => ipcRenderer.invoke(IpcChannel.App_RestartTray),
  setTheme: (theme: 'light' | 'dark') => ipcRenderer.invoke(IpcChannel.App_SetTheme, theme),
  openWebsite: (url: string) => ipcRenderer.invoke(IpcChannel.Open_Website, url),
  minApp: (url: string) => ipcRenderer.invoke(IpcChannel.Minapp, url),
  clearCache: () => ipcRenderer.invoke(IpcChannel.App_ClearCache),
  system: {
    getDeviceType: () => ipcRenderer.invoke(IpcChannel.System_GetDeviceType)
  },
  zip: {
    compress: (text: string) => ipcRenderer.invoke(IpcChannel.Zip_Compress, text),
    decompress: (text: Buffer) => ipcRenderer.invoke(IpcChannel.Zip_Decompress, text)
  },
  backup: {
    backup: (fileName: string, data: string, destinationPath?: string) =>
      ipcRenderer.invoke(IpcChannel.Backup_Backup, fileName, data, destinationPath),
    restore: (backupPath: string) => ipcRenderer.invoke(IpcChannel.Backup_Restore, backupPath),
    backupToWebdav: (data: string, webdavConfig: WebDavConfig) =>
      ipcRenderer.invoke(IpcChannel.Backup_BackupToWebdav, data, webdavConfig),
    restoreFromWebdav: (webdavConfig: WebDavConfig) => ipcRenderer.invoke(IpcChannel.Backup_RestoreFromWebdav, webdavConfig),
    listWebdavFiles: (webdavConfig: WebDavConfig) => ipcRenderer.invoke(IpcChannel.Backup_ListWebdavFiles, webdavConfig),
    checkConnection: (webdavConfig: WebDavConfig) => ipcRenderer.invoke(IpcChannel.Backup_CheckConnection, webdavConfig),
    createDirectory: (webdavConfig: WebDavConfig, path: string, options?: CreateDirectoryOptions) =>
      ipcRenderer.invoke(IpcChannel.Backup_CreateDirectory, webdavConfig, path, options)
  },
  file: {
    select: (options?: OpenDialogOptions) => ipcRenderer.invoke(IpcChannel.File_Select, options),
    upload: (filePath: string) => ipcRenderer.invoke(IpcChannel.File_Upload, filePath),
    delete: (fileId: string) => ipcRenderer.invoke(IpcChannel.File_Delete, fileId),
    read: (fileId: string) => ipcRenderer.invoke(IpcChannel.File_Read, fileId),
    clear: () => ipcRenderer.invoke(IpcChannel.File_Clear),
    get: (filePath: string) => ipcRenderer.invoke(IpcChannel.File_Get, filePath),
    create: (fileName: string) => ipcRenderer.invoke(IpcChannel.File_Create, fileName),
    write: (filePath: string, data: Uint8Array | string) => ipcRenderer.invoke(IpcChannel.File_Write, filePath, data),
    open: (options?: { decompress: boolean }) => ipcRenderer.invoke(IpcChannel.File_Open, options),
    openPath: (path: string) => ipcRenderer.invoke(IpcChannel.File_OpenPath, path),
    save: (path: string, content: string, options?: { compress: boolean }) =>
      ipcRenderer.invoke(IpcChannel.File_Save, path, content, options),
    selectFolder: () => ipcRenderer.invoke(IpcChannel.File_SelectFolder),
    saveImage: (name: string, data: string) => ipcRenderer.invoke(IpcChannel.File_SaveImage, name, data),
    base64Image: (fileId: string) => ipcRenderer.invoke(IpcChannel.File_Base64Image, fileId),
    download: (url: string) => ipcRenderer.invoke(IpcChannel.File_Download, url),
    copy: (fileId: string, destPath: string) => ipcRenderer.invoke(IpcChannel.File_Copy, fileId, destPath),
    binaryFile: (fileId: string) => ipcRenderer.invoke(IpcChannel.File_BinaryFile, fileId)
  },
  fs: {
    read: (path: string) => ipcRenderer.invoke(IpcChannel.Fs_Read, path)
  },
  export: {
    toWord: (markdown: string, fileName: string) => ipcRenderer.invoke(IpcChannel.Export_Word, markdown, fileName)
  },
  openPath: (path: string) => ipcRenderer.invoke(IpcChannel.Open_Path, path),
  shortcuts: {
    update: (shortcuts: Shortcut[]) => ipcRenderer.invoke(IpcChannel.Shortcuts_Update, shortcuts)
  },
  knowledgeBase: {
    create: (base: KnowledgeBaseParams) => ipcRenderer.invoke(IpcChannel.KnowledgeBase_Create, base),
    reset: (base: KnowledgeBaseParams) => ipcRenderer.invoke(IpcChannel.KnowledgeBase_Reset, base),
    delete: (id: string) => ipcRenderer.invoke(IpcChannel.KnowledgeBase_Delete, id),
    add: ({
      base,
      item,
      forceReload = false
    }: {
      base: KnowledgeBaseParams
      item: KnowledgeItem
      forceReload?: boolean
    }) => ipcRenderer.invoke(IpcChannel.KnowledgeBase_Add, { base, item, forceReload }),
    remove: ({ uniqueId, uniqueIds, base }: { uniqueId: string; uniqueIds: string[]; base: KnowledgeBaseParams }) =>
      ipcRenderer.invoke(IpcChannel.KnowledgeBase_Remove, { uniqueId, uniqueIds, base }),
    search: ({ search, base }: { search: string; base: KnowledgeBaseParams }) =>
      ipcRenderer.invoke(IpcChannel.KnowledgeBase_Search, { search, base }),
    rerank: ({ search, base, results }: { search: string; base: KnowledgeBaseParams; results: ExtractChunkData[] }) =>
      ipcRenderer.invoke(IpcChannel.KnowledgeBase_Rerank, { search, base, results })
  },
  window: {
    setMinimumSize: (width: number, height: number) =>
      ipcRenderer.invoke(IpcChannel.Windows_SetMinimumSize, width, height),
    resetMinimumSize: () => ipcRenderer.invoke(IpcChannel.Windows_ResetMinimumSize)
  },
  gemini: {
    uploadFile: (file: FileType, apiKey: string) => ipcRenderer.invoke(IpcChannel.Gemini_UploadFile, file, apiKey),
    base64File: (file: FileType) => ipcRenderer.invoke(IpcChannel.Gemini_Base64File, file),
    retrieveFile: (file: FileType, apiKey: string) => ipcRenderer.invoke(IpcChannel.Gemini_RetrieveFile, file, apiKey),
    listFiles: (apiKey: string) => ipcRenderer.invoke(IpcChannel.Gemini_ListFiles, apiKey),
    deleteFile: (apiKey: string, fileId: string) => ipcRenderer.invoke(IpcChannel.Gemini_DeleteFile, apiKey, fileId)
  },
  selectionMenu: {
    action: (action: string) => ipcRenderer.invoke(IpcChannel.SelectionMenu_Action, action)
  },
  config: {
    set: (key: string, value: any) => ipcRenderer.invoke(IpcChannel.Config_Set, key, value),
    get: (key: string) => ipcRenderer.invoke(IpcChannel.Config_Get, key)
  },
  miniWindow: {
    show: () => ipcRenderer.invoke(IpcChannel.MiniWindow_Show),
    hide: () => ipcRenderer.invoke(IpcChannel.MiniWindow_Hide),
    close: () => ipcRenderer.invoke(IpcChannel.MiniWindow_Close),
    toggle: () => ipcRenderer.invoke(IpcChannel.MiniWindow_Toggle)
    setPin: (isPinned: boolean) => ipcRenderer.invoke(IpcChannel.MiniWindow_SetPin, isPinned)
  },
  aes: {
    encrypt: (text: string, secretKey: string, iv: string) =>
      ipcRenderer.invoke(IpcChannel.Aes_Encrypt, text, secretKey, iv),
    decrypt: (encryptedData: string, iv: string, secretKey: string) =>
      ipcRenderer.invoke(IpcChannel.Aes_Decrypt, encryptedData, iv, secretKey)
  },
  mcp: {
    removeServer: (server: MCPServer) => ipcRenderer.invoke(IpcChannel.Mcp_RemoveServer, server),
    restartServer: (server: MCPServer) => ipcRenderer.invoke(IpcChannel.Mcp_RestartServer, server),
    stopServer: (server: MCPServer) => ipcRenderer.invoke(IpcChannel.Mcp_StopServer, server),
    listTools: (server: MCPServer) => ipcRenderer.invoke(IpcChannel.Mcp_ListTools, server),
    callTool: ({ server, name, args }: { server: MCPServer; name: string; args: any }) =>
      ipcRenderer.invoke(IpcChannel.Mcp_CallTool, { server, name, args }),
    getInstallInfo: () => ipcRenderer.invoke(IpcChannel.Mcp_GetInstallInfo)
  },
  shell: {
    openExternal: shell.openExternal
  },
  copilot: {
    getAuthMessage: (headers?: Record<string, string>) =>
      ipcRenderer.invoke(IpcChannel.Copilot_GetAuthMessage, headers),
    getCopilotToken: (device_code: string, headers?: Record<string, string>) =>
      ipcRenderer.invoke(IpcChannel.Copilot_GetCopilotToken, device_code, headers),
    saveCopilotToken: (access_token: string) => ipcRenderer.invoke(IpcChannel.Copilot_SaveCopilotToken, access_token),
    getToken: (headers?: Record<string, string>) => ipcRenderer.invoke(IpcChannel.Copilot_GetToken, headers),
    logout: () => ipcRenderer.invoke(IpcChannel.Copilot_Logout),
    getUser: (token: string) => ipcRenderer.invoke(IpcChannel.Copilot_GetUser, token)
  },

  // Binary related APIs
  isBinaryExist: (name: string) => ipcRenderer.invoke(IpcChannel.App_IsBinaryExist, name),
  getBinaryPath: (name: string) => ipcRenderer.invoke(IpcChannel.App_GetBinaryPath, name),
  installUVBinary: () => ipcRenderer.invoke(IpcChannel.App_InstallUvBinary),
  installBunBinary: () => ipcRenderer.invoke(IpcChannel.App_InstallBunBinary)
  protocol: {
    onReceiveData: (callback: (data: { url: string; params: any }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { url: string; params: any }) => {
        callback(data)
      }
      ipcRenderer.on('protocol-data', listener)
      return () => {
        ipcRenderer.off('protocol-data', listener)
      }
    }
  },
  nutstore: {
    getSSOUrl: () => ipcRenderer.invoke(IpcChannel.Nutstore_GetSsoUrl),
    decryptToken: (token: string) => ipcRenderer.invoke(IpcChannel.Nutstore_DecryptToken, token),
    getDirectoryContents: (token: string, path: string) =>
      ipcRenderer.invoke(IpcChannel.Nutstore_GetDirectoryContents, token, path)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('obsidian', {
      getVaults: () => ipcRenderer.invoke(IpcChannel.Obsidian_GetVaults),
      getFolders: (vaultName: string) => ipcRenderer.invoke(IpcChannel.Obsidian_GetFiles, vaultName),
      getFiles: (vaultName: string) => ipcRenderer.invoke(IpcChannel.Obsidian_GetFiles, vaultName)
    })
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
