import { electronAPI } from '@electron-toolkit/preload'
import type { CacheEntry, CacheSyncMessage } from '@shared/data/cache/cacheTypes'
import type {
  UnifiedPreferenceKeyType,
  UnifiedPreferenceMultipleResultType,
  UnifiedPreferenceType
} from '@shared/data/preference/preferenceTypes'
import type { FileEntry, FileHandle } from '@shared/data/types/file'
import type { FileMetadata } from '@shared/data/types/legacyFile'
import { IpcChannel } from '@shared/IpcChannel'
import type { S3Config, WebDavConfig } from '@shared/types/backup'
import type { MenuAnchor, NativePopupMenuModel, NativePopupMenuResult } from '@shared/types/command'
import type { ExternalAppInfo } from '@shared/types/externalApp'
import type {
  CreateInternalEntryIpcParams,
  EnsureExternalEntryIpcParams,
  FilePath,
  GetPhysicalPathIpcParams
} from '@shared/types/file'
import type {
  LanClientEvent,
  LanFileCompleteMessage,
  LanHandshakeAckMessage,
  LanTransferConnectPayload,
  LanTransferState
} from '@shared/types/lanTransfer'
import type { ShortcutPreferenceKey } from '@shared/types/shortcut'
import type { SkillFileNode, SkillResult } from '@shared/types/skill'
import type { StorageHealth } from '@shared/types/storageMonitor'
import type { CommandId } from '@shared/utils/command'
import type { CreateTreeIpcResult, DirectoryTreeOptions, TreeMutationPushPayload } from '@shared/utils/file'
import type { OpenDialogOptions } from 'electron'
import { contextBridge, ipcRenderer, shell, webUtils } from 'electron'
import type { CreateDirectoryOptions } from 'webdav'

import { ipcApi } from './ipc'

type DirectoryListOptions = {
  recursive?: boolean
  maxDepth?: number
  includeHidden?: boolean
  includeFiles?: boolean
  includeDirectories?: boolean
  maxEntries?: number
  searchPattern?: string
}

type DirectoryEntry = {
  path: string
  isDirectory: boolean
}

type ShortcutRegistrationConflictPayload = {
  key: ShortcutPreferenceKey
  accelerator?: string
  hasConflict: boolean
}

// Custom APIs for renderer
const api = {
  setSpellCheckLanguages: (languages: string[]) => ipcRenderer.invoke(IpcChannel.App_SetSpellCheckLanguages, languages),
  setLaunchOnBoot: (isActive: boolean) => ipcRenderer.invoke(IpcChannel.App_SetLaunchOnBoot, isActive),
  select: (options: Electron.OpenDialogOptions) => ipcRenderer.invoke(IpcChannel.App_Select, options),
  hasWritePermission: (path: string) => ipcRenderer.invoke(IpcChannel.App_HasWritePermission, path),
  resolvePath: (path: string) => ipcRenderer.invoke(IpcChannel.App_ResolvePath, path),
  isPathInside: (childPath: string, parentPath: string) =>
    ipcRenderer.invoke(IpcChannel.App_IsPathInside, childPath, parentPath),
  application: {
    preventQuit: (reason: string): Promise<string> => ipcRenderer.invoke(IpcChannel.Application_PreventQuit, reason),
    allowQuit: (holdId: string): Promise<void> => ipcRenderer.invoke(IpcChannel.Application_AllowQuit, holdId),
    relaunch: (options?: Electron.RelaunchOptions): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.Application_Relaunch, options)
  },
  resetData: () => ipcRenderer.invoke(IpcChannel.App_ResetData),
  getCacheSize: () => ipcRenderer.invoke(IpcChannel.App_GetCacheSize),
  clearCache: () => ipcRenderer.invoke(IpcChannel.App_ClearCache),
  system: {
    getHostname: () => ipcRenderer.invoke(IpcChannel.System_GetHostname)
    // Git Bash is resolved in the main process (settingsBuilder); no renderer API.
  },
  zip: {
    decompress: (text: Buffer) => ipcRenderer.invoke(IpcChannel.Zip_Decompress, text)
  },
  backup: {
    restore: (path: string) => ipcRenderer.invoke(IpcChannel.Backup_Restore, path),
    // Direct backup methods (copy IndexedDB/LocalStorage directories directly)
    backup: (fileName: string, destinationPath: string, skipBackupFile: boolean) =>
      ipcRenderer.invoke(IpcChannel.Backup_Backup, fileName, destinationPath, skipBackupFile),
    backupToWebdav: (webdavConfig: WebDavConfig) => ipcRenderer.invoke(IpcChannel.Backup_BackupToWebdav, webdavConfig),
    restoreFromWebdav: (webdavConfig: WebDavConfig) =>
      ipcRenderer.invoke(IpcChannel.Backup_RestoreFromWebdav, webdavConfig),
    listWebdavFiles: (webdavConfig: WebDavConfig) =>
      ipcRenderer.invoke(IpcChannel.Backup_ListWebdavFiles, webdavConfig),
    checkConnection: (webdavConfig: WebDavConfig) =>
      ipcRenderer.invoke(IpcChannel.Backup_CheckConnection, webdavConfig),
    createDirectory: (webdavConfig: WebDavConfig, path: string, options?: CreateDirectoryOptions) =>
      ipcRenderer.invoke(IpcChannel.Backup_CreateDirectory, webdavConfig, path, options),
    deleteWebdavFile: (fileName: string, webdavConfig: WebDavConfig) =>
      ipcRenderer.invoke(IpcChannel.Backup_DeleteWebdavFile, fileName, webdavConfig),
    backupToLocalDir: (fileName: string, localConfig: { localBackupDir?: string; skipBackupFile?: boolean }) =>
      ipcRenderer.invoke(IpcChannel.Backup_BackupToLocalDir, fileName, localConfig),
    restoreFromLocalBackup: (fileName: string, localBackupDir?: string) =>
      ipcRenderer.invoke(IpcChannel.Backup_RestoreFromLocalBackup, fileName, localBackupDir),
    listLocalBackupFiles: (localBackupDir?: string) =>
      ipcRenderer.invoke(IpcChannel.Backup_ListLocalBackupFiles, localBackupDir),
    deleteLocalBackupFile: (fileName: string, localBackupDir?: string) =>
      ipcRenderer.invoke(IpcChannel.Backup_DeleteLocalBackupFile, fileName, localBackupDir),
    checkWebdavConnection: (webdavConfig: WebDavConfig) =>
      ipcRenderer.invoke(IpcChannel.Backup_CheckConnection, webdavConfig),
    backupToS3: (s3Config: S3Config) => ipcRenderer.invoke(IpcChannel.Backup_BackupToS3, s3Config),
    restoreFromS3: (s3Config: S3Config) => ipcRenderer.invoke(IpcChannel.Backup_RestoreFromS3, s3Config),
    listS3Files: (s3Config: S3Config) => ipcRenderer.invoke(IpcChannel.Backup_ListS3Files, s3Config),
    deleteS3File: (fileName: string, s3Config: S3Config) =>
      ipcRenderer.invoke(IpcChannel.Backup_DeleteS3File, fileName, s3Config),
    createLanTransferBackup: (data: string, destinationPath?: string): Promise<string> =>
      ipcRenderer.invoke(IpcChannel.Backup_CreateLanTransferBackup, data, destinationPath),
    deleteLanTransferBackup: (filePath: string): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannel.Backup_DeleteLanTransferBackup, filePath)
  },
  file: {
    select: (options?: OpenDialogOptions): Promise<FileMetadata[] | null> =>
      ipcRenderer.invoke(IpcChannel.File_Select, options),
    createInternalEntry: (params: CreateInternalEntryIpcParams): Promise<FileEntry> =>
      ipcRenderer.invoke(IpcChannel.File_CreateInternalEntry, params),
    ensureExternalEntry: (params: EnsureExternalEntryIpcParams): Promise<FileEntry> =>
      ipcRenderer.invoke(IpcChannel.File_EnsureExternalEntry, params),
    getPhysicalPath: (params: GetPhysicalPathIpcParams): Promise<FilePath> =>
      ipcRenderer.invoke(IpcChannel.File_GetPhysicalPath, params),
    permanentDelete: (handle: FileHandle): Promise<void> => ipcRenderer.invoke(IpcChannel.File_PermanentDelete, handle),
    runSweep: () => ipcRenderer.invoke(IpcChannel.File_RunSweep),
    deleteExternalFile: (filePath: string) => ipcRenderer.invoke(IpcChannel.File_DeleteExternalFile, filePath),
    deleteExternalDir: (dirPath: string) => ipcRenderer.invoke(IpcChannel.File_DeleteExternalDir, dirPath),
    move: (path: string, newPath: string) => ipcRenderer.invoke(IpcChannel.File_Move, path, newPath),
    moveDir: (dirPath: string, newDirPath: string) => ipcRenderer.invoke(IpcChannel.File_MoveDir, dirPath, newDirPath),
    rename: (path: string, newName: string) => ipcRenderer.invoke(IpcChannel.File_Rename, path, newName),
    renameDir: (dirPath: string, newName: string) => ipcRenderer.invoke(IpcChannel.File_RenameDir, dirPath, newName),
    readExternal: (filePath: string, detectEncoding?: boolean) =>
      ipcRenderer.invoke(IpcChannel.File_ReadExternal, filePath, detectEncoding),
    get: (filePath: string): Promise<FileMetadata | null> => ipcRenderer.invoke(IpcChannel.File_Get, filePath),
    createTempFile: (fileName: string): Promise<string> => ipcRenderer.invoke(IpcChannel.File_CreateTempFile, fileName),
    mkdir: (dirPath: string) => ipcRenderer.invoke(IpcChannel.File_Mkdir, dirPath),
    write: (filePath: string, data: Uint8Array | string) => ipcRenderer.invoke(IpcChannel.File_Write, filePath, data),
    open: (options?: OpenDialogOptions) => ipcRenderer.invoke(IpcChannel.File_Open, options),
    openPath: (path: string) => ipcRenderer.invoke(IpcChannel.File_OpenPath, path),
    save: (path: string, content: string | NodeJS.ArrayBufferView, options?: any): Promise<string | null> =>
      ipcRenderer.invoke(IpcChannel.File_Save, path, content, options),
    selectFolder: (options?: OpenDialogOptions): Promise<string | null> =>
      ipcRenderer.invoke(IpcChannel.File_SelectFolder, options),
    saveImage: (name: string, data: string): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannel.File_SaveImage, name, data),
    binaryImage: (fileId: string) => ipcRenderer.invoke(IpcChannel.File_BinaryImage, fileId),
    savePastedImage: (imageData: Uint8Array, extension?: string) =>
      ipcRenderer.invoke(IpcChannel.File_SavePastedImage, imageData, extension),
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    listDirectory: (dirPath: string, options?: DirectoryListOptions) =>
      ipcRenderer.invoke(IpcChannel.File_ListDirectory, dirPath, options),
    listDirectoryEntries: (dirPath: string, options?: DirectoryListOptions): Promise<DirectoryEntry[]> =>
      ipcRenderer.invoke(IpcChannel.File_ListDirectoryEntries, dirPath, options),
    checkFileName: (dirPath: string, fileName: string, isFile: boolean) =>
      ipcRenderer.invoke(IpcChannel.File_CheckFileName, dirPath, fileName, isFile),
    validateNotesDirectory: (dirPath: string) => ipcRenderer.invoke(IpcChannel.File_ValidateNotesDirectory, dirPath),
    // Legacy file-watcher bindings (`startFileWatcher` / `stopFileWatcher`
    // / `pauseFileWatcher` / `resumeFileWatcher` / `onFileChange`) and
    // `getDirectoryStructure` were removed alongside the Notes migration
    // to `DirectoryTreeBuilder` (see docs/references/file/directory-tree.md).
    // mutations via `window.api.tree.onMutation` instead.
    batchUploadMarkdown: (filePaths: string[], targetPath: string) =>
      ipcRenderer.invoke(IpcChannel.File_BatchUploadMarkdown, filePaths, targetPath),
    showInFolder: (path: string): Promise<void> => ipcRenderer.invoke(IpcChannel.File_ShowInFolder, path)
  },
  fs: {
    read: (pathOrUrl: string, encoding?: BufferEncoding) => ipcRenderer.invoke(IpcChannel.Fs_Read, pathOrUrl, encoding),
    readText: (pathOrUrl: string): Promise<string> => ipcRenderer.invoke(IpcChannel.Fs_ReadText, pathOrUrl)
  },
  tree: {
    create: (rootPath: string, options?: DirectoryTreeOptions): Promise<CreateTreeIpcResult> =>
      ipcRenderer.invoke(IpcChannel.File_TreeCreate, { rootPath, options }),
    dispose: (treeId: string): Promise<void> => ipcRenderer.invoke(IpcChannel.File_TreeDispose, { treeId }),
    rename: (treeId: string, oldPath: string, newPath: string): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannel.File_TreeRename, { treeId, oldPath, newPath }),
    onMutation: (callback: (payload: TreeMutationPushPayload) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: TreeMutationPushPayload) => {
        if (payload && typeof payload === 'object') callback(payload)
      }
      ipcRenderer.on(IpcChannel.File_TreeMutation, listener)
      return () => ipcRenderer.off(IpcChannel.File_TreeMutation, listener)
    }
  },
  command: {
    showNativePopupMenu: (
      model: NativePopupMenuModel<CommandId>,
      anchor?: MenuAnchor
    ): Promise<NativePopupMenuResult<CommandId> | undefined> =>
      ipcRenderer.invoke(IpcChannel.NativeCommandPopupMenu_Show, model, anchor)
  },
  aes: {
    decrypt: (encryptedData: string, iv: string, secretKey: string) =>
      ipcRenderer.invoke(IpcChannel.Aes_Decrypt, encryptedData, iv, secretKey)
  },
  shell: {
    openExternal: (url: string, options?: Electron.OpenExternalOptions) => {
      // Defense-in-depth: validate URL scheme before forwarding to shell.openExternal
      const ALLOWED_PROTOCOLS = ['http:', 'https:', 'mailto:', 'obsidian:']
      try {
        const parsed = new URL(url)
        if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
          return Promise.reject(new Error(`Blocked openExternal for untrusted URL scheme: ${parsed.protocol}`))
        }
      } catch {
        return Promise.reject(new Error('Blocked openExternal for invalid URL'))
      }
      return shell.openExternal(url, options)
    }
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
  // CherryIN OAuth + Codex / Grok CLI OAuth migrated to IpcApi — see
  // `ipcApi.request('oauth.*' | 'cherryin.*')` and `ipcApi.on('oauth.deep_link_result')`.
  // BinaryManager tool manager was migrated to IpcApi — see `window.api.ipcApi` / `ipcApi.request('binary.*')`.
  externalApps: {
    detectInstalled: (): Promise<ExternalAppInfo[]> => ipcRenderer.invoke(IpcChannel.ExternalApps_DetectInstalled)
  },
  nutstore: {
    getSSOUrl: () => ipcRenderer.invoke(IpcChannel.Nutstore_GetSsoUrl),
    decryptToken: (token: string) => ipcRenderer.invoke(IpcChannel.Nutstore_DecryptToken, token),
    getDirectoryContents: (token: string, path: string) =>
      ipcRenderer.invoke(IpcChannel.Nutstore_GetDirectoryContents, token, path)
  },
  quoteToMainWindow: (text: string) => ipcRenderer.invoke(IpcChannel.App_QuoteToMain, text),
  // setDisableHardwareAcceleration: (isDisable: boolean) =>
  //   ipcRenderer.invoke(IpcChannel.App_SetDisableHardwareAcceleration, isDisable),
  // setUseSystemTitleBar: (isActive: boolean) => ipcRenderer.invoke(IpcChannel.App_SetUseSystemTitleBar, isActive),
  trace: {
    getData: (topicId: string, traceId: string) => ipcRenderer.invoke(IpcChannel.TRACE_GET_DATA, topicId, traceId),
    cleanLocalData: () => ipcRenderer.invoke(IpcChannel.TRACE_CLEAN_LOCAL_DATA)
  },
  shortcut: {
    onRegistrationConflict: (callback: (payload: ShortcutRegistrationConflictPayload) => void): (() => void) => {
      const channel = IpcChannel.Shortcut_RegistrationConflict
      const listener = (_: Electron.IpcRendererEvent, payload: ShortcutRegistrationConflictPayload) => callback(payload)
      ipcRenderer.on(channel, listener)
      return () => {
        ipcRenderer.removeListener(channel, listener)
      }
    }
  },
  // CacheService related APIs
  cache: {
    // Broadcast sync message to other windows
    broadcastSync: (message: CacheSyncMessage): void => ipcRenderer.send(IpcChannel.Cache_Sync, message),

    // Listen for sync messages from other windows
    onSync: (callback: (message: CacheSyncMessage) => void) => {
      const listener = (_: any, message: CacheSyncMessage) => callback(message)
      ipcRenderer.on(IpcChannel.Cache_Sync, listener)
      return () => ipcRenderer.off(IpcChannel.Cache_Sync, listener)
    },

    // Get all shared cache entries from Main for initialization sync
    getAllShared: (): Promise<Record<string, CacheEntry>> => ipcRenderer.invoke(IpcChannel.Cache_GetAllShared)
  },

  // StorageMonitorService related APIs (main-process disk-space watcher)
  storageMonitor: {
    // Pull the current disk-space health to seed initial state on mount
    getHealth: (): Promise<StorageHealth> => ipcRenderer.invoke(IpcChannel.StorageMonitor_GetHealth),

    // Subscribe to health transitions (ok <-> low) pushed from Main
    onHealthChange: (callback: (health: StorageHealth) => void) => {
      const listener = (_: any, health: StorageHealth) => callback(health)
      ipcRenderer.on(IpcChannel.StorageMonitor_HealthChanged, listener)
      return () => ipcRenderer.off(IpcChannel.StorageMonitor_HealthChanged, listener)
    }
  },

  // PreferenceService related APIs
  // DO NOT MODIFY THIS SECTION
  preference: {
    get: <K extends UnifiedPreferenceKeyType>(key: K): Promise<UnifiedPreferenceType[K]> =>
      ipcRenderer.invoke(IpcChannel.Preference_Get, key),
    set: <K extends UnifiedPreferenceKeyType>(key: K, value: UnifiedPreferenceType[K]): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.Preference_Set, key, value),
    getMultipleRaw: <K extends UnifiedPreferenceKeyType>(keys: K[]): Promise<UnifiedPreferenceMultipleResultType<K>> =>
      ipcRenderer.invoke(IpcChannel.Preference_GetMultipleRaw, keys),
    setMultiple: (updates: Partial<UnifiedPreferenceType>) =>
      ipcRenderer.invoke(IpcChannel.Preference_SetMultiple, updates),
    getAll: (): Promise<UnifiedPreferenceType> => ipcRenderer.invoke(IpcChannel.Preference_GetAll),
    subscribe: (keys: UnifiedPreferenceKeyType[]) => ipcRenderer.invoke(IpcChannel.Preference_Subscribe, keys),
    onChanged: (callback: (key: UnifiedPreferenceKeyType, value: any) => void) => {
      const listener = (_: any, key: UnifiedPreferenceKeyType, value: any) => callback(key, value)
      ipcRenderer.on(IpcChannel.Preference_Changed, listener)
      return () => ipcRenderer.off(IpcChannel.Preference_Changed, listener)
    }
  },
  // Data API related APIs
  dataApi: {
    request: (req: any) => ipcRenderer.invoke(IpcChannel.DataApi_Request, req),
    subscribe: (path: string, callback: (data: any, event: string) => void) => {
      const channel = `${IpcChannel.DataApi_Stream}:${path}`
      const listener = (_: any, data: any, event: string) => callback(data, event)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.off(channel, listener)
    }
  },
  // IpcApi RPC channel — generic forwarder; the typed facade lives in src/renderer/ipc
  ipcApi,
  // All `ai.*` / `translate.*` capability IPC moved to IpcApi (`ipcApi.request(...)` /
  // `ipcApi.on('ai.stream_*')`): model ops, streaming chat + translate, agent-session
  // warm-up, tool approval, agent run-task, and the topic/agent-session auto-rename events.
  skill: {
    readSkillFile: (skillId: string, filename: string): Promise<SkillResult<string | null>> =>
      ipcRenderer.invoke(IpcChannel.Skill_ReadFile, skillId, filename),
    listFiles: (skillId: string): Promise<SkillResult<SkillFileNode[]>> =>
      ipcRenderer.invoke(IpcChannel.Skill_ListFiles, skillId)
  },
  lanTransfer: {
    startScan: (): Promise<LanTransferState> => ipcRenderer.invoke(IpcChannel.LanTransfer_StartScan),
    stopScan: (): Promise<LanTransferState> => ipcRenderer.invoke(IpcChannel.LanTransfer_StopScan),
    connect: (payload: LanTransferConnectPayload): Promise<LanHandshakeAckMessage> =>
      ipcRenderer.invoke(IpcChannel.LanTransfer_Connect, payload),
    disconnect: (): Promise<void> => ipcRenderer.invoke(IpcChannel.LanTransfer_Disconnect),
    onServicesUpdated: (callback: (state: LanTransferState) => void): (() => void) => {
      const channel = IpcChannel.LanTransfer_ServicesUpdated
      const listener = (_: Electron.IpcRendererEvent, state: LanTransferState) => callback(state)
      ipcRenderer.on(channel, listener)
      return () => {
        ipcRenderer.removeListener(channel, listener)
      }
    },
    onClientEvent: (callback: (event: LanClientEvent) => void): (() => void) => {
      const channel = IpcChannel.LanTransfer_ClientEvent
      const listener = (_: Electron.IpcRendererEvent, event: LanClientEvent) => callback(event)
      ipcRenderer.on(channel, listener)
      return () => {
        ipcRenderer.removeListener(channel, listener)
      }
    },
    sendFile: (filePath: string): Promise<LanFileCompleteMessage> =>
      ipcRenderer.invoke(IpcChannel.LanTransfer_SendFile, { filePath }),
    cancelTransfer: (): Promise<void> => ipcRenderer.invoke(IpcChannel.LanTransfer_CancelTransfer)
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
    console.error('[Preload]Failed to expose APIs:', error as Error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}

export type WindowApiType = typeof api
