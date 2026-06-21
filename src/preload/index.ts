import type { TokenUsageData } from '@cherrystudio/analytics-client'
import { electronAPI } from '@electron-toolkit/preload'
import type { SpanContext } from '@opentelemetry/api'
import type {
  AiAgentSessionWarmCloseRequest,
  AiAgentSessionWarmRequest,
  AiStreamAbortRequest,
  AiStreamAttachRequest,
  AiStreamAttachResponse,
  AiStreamDetachRequest,
  AiStreamOpenRequest,
  AiStreamOpenResponse,
  StreamChunkPayload,
  StreamDonePayload,
  StreamErrorPayload
} from '@shared/ai/transport'
import type { CacheEntry, CacheSyncMessage } from '@shared/data/cache/cacheTypes'
import type {
  UnifiedPreferenceKeyType,
  UnifiedPreferenceMultipleResultType,
  UnifiedPreferenceType,
  UpgradeChannel
} from '@shared/data/preference/preferenceTypes'
import type { FileEntry } from '@shared/data/types/file'
import type { FileMetadata } from '@shared/data/types/file/legacyFileMetadata'
import type { Model } from '@shared/data/types/model'
import type { SettingsPath } from '@shared/data/types/settingsPath'
import { IpcChannel } from '@shared/IpcChannel'
import type { ApiGatewayStatusResult } from '@shared/types/apiGateway'
import type { S3Config, WebDavConfig } from '@shared/types/backup'
import type { GitBashPathInfo, TerminalConfig } from '@shared/types/codeCli'
import type { CodeToolsRunResult, OperationResult } from '@shared/types/codeTools'
import type { MenuAnchor, NativePopupMenuModel, NativePopupMenuResult } from '@shared/types/command'
import type { ExternalAppInfo } from '@shared/types/externalApp'
import type { FilePath, PhysicalFileMetadata } from '@shared/types/file/common'
import type { FileHandle } from '@shared/types/file/handle'
import type {
  CreateInternalEntryIpcParams,
  EnsureExternalEntryIpcParams,
  GetPhysicalPathIpcParams
} from '@shared/types/file/ipc'
import type {
  LanClientEvent,
  LanFileCompleteMessage,
  LanHandshakeAckMessage,
  LanTransferConnectPayload,
  LanTransferState
} from '@shared/types/lanTransfer'
import type { LogLevel, LogSourceWithContext } from '@shared/types/logger'
import type { McpServerLogEntry } from '@shared/types/mcp'
import type { Notification } from '@shared/types/notification'
import type { OcrProvider, OcrResult, SupportedOcrFile } from '@shared/types/ocr'
import type { ShortcutPreferenceKey } from '@shared/types/shortcut'
import type {
  InstalledSkill,
  LocalSkill,
  SkillFileNode,
  SkillInstallFromDirectoryOptions,
  SkillInstallFromZipOptions,
  SkillInstallOptions,
  SkillResult,
  SkillToggleOptions
} from '@shared/types/skill'
import type { StorageHealth } from '@shared/types/storageMonitor'
import type { WebviewKeyEvent } from '@shared/types/webview'
import type { CommandId } from '@shared/utils/command'
import type { CreateTreeIpcResult, DirectoryTreeOptions, TreeMutationPushPayload } from '@shared/utils/file/tree'
import type { OpenDialogOptions } from 'electron'
import { contextBridge, ipcRenderer, shell, webUtils } from 'electron'
import type { CreateDirectoryOptions } from 'webdav'

import { ipcApi } from './ipc'

// OpenClaw types
type OpenClawGatewayStatus = 'stopped' | 'starting' | 'running' | 'error'

interface OpenClawHealthInfo {
  status: 'healthy' | 'unhealthy'
  gatewayPort: number
}

interface OpenClawChannelInfo {
  id: string
  name: string
  type: string
  status: 'connected' | 'disconnected' | 'error'
}

type DirectoryListOptions = {
  recursive?: boolean
  maxDepth?: number
  includeHidden?: boolean
  includeFiles?: boolean
  includeDirectories?: boolean
  maxEntries?: number
  searchPattern?: string
}

type ShortcutRegistrationConflictPayload = {
  key: ShortcutPreferenceKey
  accelerator?: string
  hasConflict: boolean
}

export function tracedInvoke(channel: string, spanContext: SpanContext | undefined, ...args: any[]) {
  if (spanContext) {
    const data = { type: 'trace', context: spanContext }
    return ipcRenderer.invoke(channel, ...args, data)
  }
  return ipcRenderer.invoke(channel, ...args)
}

// Custom APIs for renderer
const api = {
  getAppInfo: () => ipcRenderer.invoke(IpcChannel.App_Info),
  reload: () => ipcRenderer.invoke(IpcChannel.MainWindow_Reload),
  checkForUpdate: () => ipcRenderer.invoke(IpcChannel.App_CheckForUpdate),
  // setLanguage: (lang: string) => ipcRenderer.invoke(IpcChannel.App_SetLanguage, lang),
  setEnableSpellCheck: (isEnable: boolean) => ipcRenderer.invoke(IpcChannel.App_SetEnableSpellCheck, isEnable),
  setSpellCheckLanguages: (languages: string[]) => ipcRenderer.invoke(IpcChannel.App_SetSpellCheckLanguages, languages),
  setLaunchOnBoot: (isActive: boolean) => ipcRenderer.invoke(IpcChannel.App_SetLaunchOnBoot, isActive),
  setTestPlan: (isActive: boolean) => ipcRenderer.invoke(IpcChannel.App_SetTestPlan, isActive),
  setTestChannel: (channel: UpgradeChannel) => ipcRenderer.invoke(IpcChannel.App_SetTestChannel, channel),
  // setTheme: (theme: ThemeMode) => ipcRenderer.invoke(IpcChannel.App_SetTheme, theme),
  handleZoomFactor: (delta: number, reset: boolean = false) =>
    ipcRenderer.invoke(IpcChannel.App_HandleZoomFactor, delta, reset),
  setAutoUpdate: (isActive: boolean) => ipcRenderer.invoke(IpcChannel.App_SetAutoUpdate, isActive),
  select: (options: Electron.OpenDialogOptions) => ipcRenderer.invoke(IpcChannel.App_Select, options),
  hasWritePermission: (path: string) => ipcRenderer.invoke(IpcChannel.App_HasWritePermission, path),
  resolvePath: (path: string) => ipcRenderer.invoke(IpcChannel.App_ResolvePath, path),
  isPathInside: (childPath: string, parentPath: string) =>
    ipcRenderer.invoke(IpcChannel.App_IsPathInside, childPath, parentPath),
  setAppDataPath: (path: string) => ipcRenderer.invoke(IpcChannel.App_SetAppDataPath, path),
  getDataPathFromArgs: () => ipcRenderer.invoke(IpcChannel.App_GetDataPathFromArgs),
  copy: (oldPath: string, newPath: string, occupiedDirs: string[] = []) =>
    ipcRenderer.invoke(IpcChannel.App_Copy, oldPath, newPath, occupiedDirs),
  quitAndInstall: () => ipcRenderer.invoke(IpcChannel.App_QuitAndInstall),
  application: {
    quit: (): Promise<void> => ipcRenderer.invoke(IpcChannel.Application_Quit),
    preventQuit: (reason: string): Promise<string> => ipcRenderer.invoke(IpcChannel.Application_PreventQuit, reason),
    allowQuit: (holdId: string): Promise<void> => ipcRenderer.invoke(IpcChannel.Application_AllowQuit, holdId),
    relaunch: (options?: Electron.RelaunchOptions): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.Application_Relaunch, options)
  },
  flushAppData: () => ipcRenderer.invoke(IpcChannel.App_FlushAppData),
  isNotEmptyDir: (path: string) => ipcRenderer.invoke(IpcChannel.App_IsNotEmptyDir, path),
  resetData: () => ipcRenderer.invoke(IpcChannel.App_ResetData),
  openWebsite: (url: string) => ipcRenderer.invoke(IpcChannel.Open_Website, url),
  getCacheSize: () => ipcRenderer.invoke(IpcChannel.App_GetCacheSize),
  clearCache: () => ipcRenderer.invoke(IpcChannel.App_ClearCache),
  logToMain: (source: LogSourceWithContext, level: LogLevel, message: string, data: any[]) =>
    ipcRenderer.invoke(IpcChannel.App_LogToMain, source, level, message, data),
  getSystemFonts: (): Promise<string[]> => ipcRenderer.invoke(IpcChannel.App_GetSystemFonts),
  getIpCountry: (): Promise<string> => ipcRenderer.invoke(IpcChannel.App_GetIpCountry),
  mockCrashRenderProcess: () => ipcRenderer.invoke(IpcChannel.MainWindow_CrashRenderProcess),
  mac: {
    isProcessTrusted: (): Promise<boolean> => ipcRenderer.invoke(IpcChannel.App_MacIsProcessTrusted),
    requestProcessTrust: (): Promise<boolean> => ipcRenderer.invoke(IpcChannel.App_MacRequestProcessTrust)
  },
  notification: {
    send: (notification: Notification) => ipcRenderer.invoke(IpcChannel.Notification_Send, notification)
  },
  system: {
    getDeviceType: () => ipcRenderer.invoke(IpcChannel.System_GetDeviceType),
    getHostname: () => ipcRenderer.invoke(IpcChannel.System_GetHostname),
    getCpuName: () => ipcRenderer.invoke(IpcChannel.System_GetCpuName),
    checkGitBash: (): Promise<boolean> => ipcRenderer.invoke(IpcChannel.System_CheckGitBash),
    getGitBashPath: (): Promise<string | null> => ipcRenderer.invoke(IpcChannel.System_GetGitBashPath),
    getGitBashPathInfo: (): Promise<GitBashPathInfo> => ipcRenderer.invoke(IpcChannel.System_GetGitBashPathInfo),
    setGitBashPath: (newPath: string | null): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannel.System_SetGitBashPath, newPath)
  },
  devTools: {
    toggle: () => ipcRenderer.invoke(IpcChannel.System_ToggleDevTools)
  },
  zip: {
    compress: (text: string) => ipcRenderer.invoke(IpcChannel.Zip_Compress, text),
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
    checkS3Connection: (s3Config: S3Config) => ipcRenderer.invoke(IpcChannel.Backup_CheckS3Connection, s3Config),
    createLanTransferBackup: (data: string, destinationPath?: string): Promise<string> =>
      ipcRenderer.invoke(IpcChannel.Backup_CreateLanTransferBackup, data, destinationPath),
    deleteLanTransferBackup: (filePath: string): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannel.Backup_DeleteLanTransferBackup, filePath)
  },
  file: {
    select: (options?: OpenDialogOptions): Promise<FileMetadata[] | null> =>
      ipcRenderer.invoke(IpcChannel.File_Select, options),
    upload: (file: FileMetadata) => ipcRenderer.invoke(IpcChannel.File_Upload, file),
    createInternalEntry: (params: CreateInternalEntryIpcParams): Promise<FileEntry> =>
      ipcRenderer.invoke(IpcChannel.File_CreateInternalEntry, params),
    ensureExternalEntry: (params: EnsureExternalEntryIpcParams): Promise<FileEntry> =>
      ipcRenderer.invoke(IpcChannel.File_EnsureExternalEntry, params),
    getPhysicalPath: (params: GetPhysicalPathIpcParams): Promise<FilePath> =>
      ipcRenderer.invoke(IpcChannel.File_GetPhysicalPath, params),
    permanentDelete: (handle: FileHandle): Promise<void> => ipcRenderer.invoke(IpcChannel.File_PermanentDelete, handle),
    runSweep: () => ipcRenderer.invoke(IpcChannel.File_RunSweep),
    delete: (fileId: string) => ipcRenderer.invoke(IpcChannel.File_Delete, fileId),
    deleteDir: (dirPath: string) => ipcRenderer.invoke(IpcChannel.File_DeleteDir, dirPath),
    deleteExternalFile: (filePath: string) => ipcRenderer.invoke(IpcChannel.File_DeleteExternalFile, filePath),
    deleteExternalDir: (dirPath: string) => ipcRenderer.invoke(IpcChannel.File_DeleteExternalDir, dirPath),
    move: (path: string, newPath: string) => ipcRenderer.invoke(IpcChannel.File_Move, path, newPath),
    moveDir: (dirPath: string, newDirPath: string) => ipcRenderer.invoke(IpcChannel.File_MoveDir, dirPath, newDirPath),
    rename: (path: string, newName: string) => ipcRenderer.invoke(IpcChannel.File_Rename, path, newName),
    renameDir: (dirPath: string, newName: string) => ipcRenderer.invoke(IpcChannel.File_RenameDir, dirPath, newName),
    read: (fileId: string, detectEncoding?: boolean) =>
      ipcRenderer.invoke(IpcChannel.File_Read, fileId, detectEncoding),
    readExternal: (filePath: string, detectEncoding?: boolean) =>
      ipcRenderer.invoke(IpcChannel.File_ReadExternal, filePath, detectEncoding),
    clear: (spanContext?: SpanContext) => ipcRenderer.invoke(IpcChannel.File_Clear, spanContext),
    get: (filePath: string): Promise<FileMetadata | null> => ipcRenderer.invoke(IpcChannel.File_Get, filePath),
    createTempFile: (fileName: string): Promise<string> => ipcRenderer.invoke(IpcChannel.File_CreateTempFile, fileName),
    mkdir: (dirPath: string) => ipcRenderer.invoke(IpcChannel.File_Mkdir, dirPath),
    write: (filePath: string, data: Uint8Array | string) => ipcRenderer.invoke(IpcChannel.File_Write, filePath, data),
    writeWithId: (id: string, content: string) => ipcRenderer.invoke(IpcChannel.File_WriteWithId, id, content),
    open: (options?: OpenDialogOptions) => ipcRenderer.invoke(IpcChannel.File_Open, options),
    openPath: (path: string) => ipcRenderer.invoke(IpcChannel.File_OpenPath, path),
    save: (path: string, content: string | NodeJS.ArrayBufferView, options?: any): Promise<string | null> =>
      ipcRenderer.invoke(IpcChannel.File_Save, path, content, options),
    selectFolder: (options?: OpenDialogOptions): Promise<string | null> =>
      ipcRenderer.invoke(IpcChannel.File_SelectFolder, options),
    saveImage: (name: string, data: string): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannel.File_SaveImage, name, data),
    binaryImage: (fileId: string) => ipcRenderer.invoke(IpcChannel.File_BinaryImage, fileId),
    base64Image: (fileId: string): Promise<{ mime: string; base64: string; data: string }> =>
      ipcRenderer.invoke(IpcChannel.File_Base64Image, fileId),
    saveBase64Image: (data: string) => ipcRenderer.invoke(IpcChannel.File_SaveBase64Image, data),
    savePastedImage: (imageData: Uint8Array, extension?: string) =>
      ipcRenderer.invoke(IpcChannel.File_SavePastedImage, imageData, extension),
    download: (url: string, isUseContentType?: boolean) =>
      ipcRenderer.invoke(IpcChannel.File_Download, url, isUseContentType),
    copy: (fileId: string, destPath: string) => ipcRenderer.invoke(IpcChannel.File_Copy, fileId, destPath),
    base64File: (fileId: string) => ipcRenderer.invoke(IpcChannel.File_Base64File, fileId),
    pdfInfo: (fileId: string) => ipcRenderer.invoke(IpcChannel.File_GetPdfInfo, fileId),
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    openFileWithRelativePath: (file: FileMetadata) => ipcRenderer.invoke(IpcChannel.File_OpenWithRelativePath, file),
    isTextFile: (filePath: string): Promise<boolean> => ipcRenderer.invoke(IpcChannel.File_IsTextFile, filePath),
    isDirectory: (filePath: string): Promise<boolean> => ipcRenderer.invoke(IpcChannel.File_IsDirectory, filePath),
    getMetadata: (handle: FileHandle): Promise<PhysicalFileMetadata> =>
      ipcRenderer.invoke(IpcChannel.File_GetMetadata, handle),
    listDirectory: (dirPath: string, options?: DirectoryListOptions) =>
      ipcRenderer.invoke(IpcChannel.File_ListDirectory, dirPath, options),
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
  pdf: {
    extractText: (data: Uint8Array | ArrayBuffer | string): Promise<string> =>
      ipcRenderer.invoke(IpcChannel.Pdf_ExtractText, data)
  },
  export: {
    toWord: (markdown: string, fileName: string) => ipcRenderer.invoke(IpcChannel.Export_Word, markdown, fileName)
  },
  obsidian: {
    getVaults: () => ipcRenderer.invoke(IpcChannel.Obsidian_GetVaults),
    getFolders: (vaultName: string) => ipcRenderer.invoke(IpcChannel.Obsidian_GetFiles, vaultName),
    getFiles: (vaultName: string) => ipcRenderer.invoke(IpcChannel.Obsidian_GetFiles, vaultName)
  },
  openPath: (path: string) => ipcRenderer.invoke(IpcChannel.Open_Path, path),
  window: {
    setMinimumSize: (width: number, height: number) =>
      ipcRenderer.invoke(IpcChannel.MainWindow_SetMinimumSize, width, height),
    resetMinimumSize: () => ipcRenderer.invoke(IpcChannel.MainWindow_ResetMinimumSize),
    // Pin/unpin the current sub-window (always-on-top).
    setAlwaysOnTop: (pinned: boolean): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannel.SubWindow_SetAlwaysOnTop, pinned)
  },
  command: {
    showNativePopupMenu: (
      model: NativePopupMenuModel<CommandId>,
      anchor?: MenuAnchor
    ): Promise<NativePopupMenuResult<CommandId> | undefined> =>
      ipcRenderer.invoke(IpcChannel.NativeCommandPopupMenu_Show, model, anchor)
  },
  selectionMenu: {
    action: (action: string) => ipcRenderer.invoke('selection-menu:action', action)
  },

  vertexAI: {
    getAuthHeaders: (params: { projectId: string; serviceAccount?: { privateKey: string; clientEmail: string } }) =>
      ipcRenderer.invoke(IpcChannel.VertexAI_GetAuthHeaders, params),
    getAccessToken: (params: { projectId: string; serviceAccount?: { privateKey: string; clientEmail: string } }) =>
      ipcRenderer.invoke(IpcChannel.VertexAI_GetAccessToken, params),
    clearAuthCache: (projectId: string, clientEmail?: string) =>
      ipcRenderer.invoke(IpcChannel.VertexAI_ClearAuthCache, projectId, clientEmail)
  },
  ovms: {
    isSupported: (): Promise<boolean> => ipcRenderer.invoke(IpcChannel.Ovms_IsSupported),
    addModel: (modelName: string, modelId: string, modelSource: string, task: string) =>
      ipcRenderer.invoke(IpcChannel.Ovms_AddModel, modelName, modelId, modelSource, task),
    stopAddModel: () => ipcRenderer.invoke(IpcChannel.Ovms_StopAddModel),
    getModels: () => ipcRenderer.invoke(IpcChannel.Ovms_GetModels),
    isRunning: () => ipcRenderer.invoke(IpcChannel.Ovms_IsRunning),
    getStatus: () => ipcRenderer.invoke(IpcChannel.Ovms_GetStatus),
    runOvms: () => ipcRenderer.invoke(IpcChannel.Ovms_RunOVMS),
    stopOvms: () => ipcRenderer.invoke(IpcChannel.Ovms_StopOVMS)
  },
  config: {
    set: (key: string, value: any, isNotify: boolean = false) =>
      ipcRenderer.invoke(IpcChannel.Config_Set, key, value, isNotify),
    get: (key: string) => ipcRenderer.invoke(IpcChannel.Config_Get, key)
  },
  quickAssistant: {
    show: () => ipcRenderer.invoke(IpcChannel.QuickAssistant_Show),
    hide: () => ipcRenderer.invoke(IpcChannel.QuickAssistant_Hide),
    close: () => ipcRenderer.invoke(IpcChannel.QuickAssistant_Close),
    toggle: () => ipcRenderer.invoke(IpcChannel.QuickAssistant_Toggle),
    setPin: (isPinned: boolean) => ipcRenderer.invoke(IpcChannel.QuickAssistant_SetPin, isPinned)
  },
  aes: {
    encrypt: (text: string, secretKey: string, iv: string) =>
      ipcRenderer.invoke(IpcChannel.Aes_Encrypt, text, secretKey, iv),
    decrypt: (encryptedData: string, iv: string, secretKey: string) =>
      ipcRenderer.invoke(IpcChannel.Aes_Decrypt, encryptedData, iv, secretKey)
  },
  mcp: {
    removeServer: (serverId: string) => ipcRenderer.invoke(IpcChannel.Mcp_RemoveServer, serverId),
    restartServer: (serverId: string) => ipcRenderer.invoke(IpcChannel.Mcp_RestartServer, serverId),
    stopServer: (serverId: string) => ipcRenderer.invoke(IpcChannel.Mcp_StopServer, serverId),
    refreshTools: (serverId: string, context?: SpanContext) =>
      tracedInvoke(IpcChannel.Mcp_RefreshTools, context, serverId),
    callTool: (
      { serverId, name, args, callId }: { serverId: string; name: string; args: any; callId?: string },
      context?: SpanContext
    ) =>
      tracedInvoke(IpcChannel.Mcp_CallTool, context, {
        serverId,
        name,
        args,
        callId
      }),
    listPrompts: (serverId: string) => ipcRenderer.invoke(IpcChannel.Mcp_ListPrompts, serverId),
    getPrompt: ({ serverId, name, args }: { serverId: string; name: string; args?: Record<string, any> }) =>
      ipcRenderer.invoke(IpcChannel.Mcp_GetPrompt, { serverId, name, args }),
    listResources: (serverId: string) => ipcRenderer.invoke(IpcChannel.Mcp_ListResources, serverId),
    getResource: ({ serverId, uri }: { serverId: string; uri: string }) =>
      ipcRenderer.invoke(IpcChannel.Mcp_GetResource, { serverId, uri }),
    getInstallInfo: () => ipcRenderer.invoke(IpcChannel.Mcp_GetInstallInfo),
    checkMcpConnectivity: (serverId: string) => ipcRenderer.invoke(IpcChannel.Mcp_CheckConnectivity, serverId),
    uploadDxt: async (file: File) => {
      const buffer = await file.arrayBuffer()
      return ipcRenderer.invoke(IpcChannel.Mcp_UploadDxt, buffer, file.name)
    },
    uploadMcpb: async (file: File) => {
      const buffer = await file.arrayBuffer()
      return ipcRenderer.invoke(IpcChannel.Mcp_UploadMcpb, buffer, file.name)
    },
    abortTool: (callId: string) => ipcRenderer.invoke(IpcChannel.Mcp_AbortTool, callId),
    getServerVersion: (serverId: string): Promise<string | null> =>
      ipcRenderer.invoke(IpcChannel.Mcp_GetServerVersion, serverId),
    getServerLogs: (serverId: string): Promise<McpServerLogEntry[]> =>
      ipcRenderer.invoke(IpcChannel.Mcp_GetServerLogs, serverId),
    onServerLog: (callback: (log: McpServerLogEntry & { serverId?: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, log: McpServerLogEntry & { serverId?: string }) => {
        callback(log)
      }
      ipcRenderer.on(IpcChannel.Mcp_ServerLog, listener)
      return () => ipcRenderer.off(IpcChannel.Mcp_ServerLog, listener)
    }
  },
  python: {
    execute: (script: string, context?: Record<string, any>, timeout?: number) =>
      ipcRenderer.invoke(IpcChannel.Python_Execute, script, context, timeout)
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
  cherryin: {
    saveToken: (accessToken: string, refreshToken?: string) =>
      ipcRenderer.invoke(IpcChannel.CherryIN_SaveToken, accessToken, refreshToken),
    hasToken: (): Promise<boolean> => ipcRenderer.invoke(IpcChannel.CherryIN_HasToken),
    getBalance: (apiHost: string) => ipcRenderer.invoke(IpcChannel.CherryIN_GetBalance, apiHost),
    logout: (apiHost: string) => ipcRenderer.invoke(IpcChannel.CherryIN_Logout, apiHost),
    startOAuthFlow: (oauthServer: string, apiHost?: string) =>
      ipcRenderer.invoke(IpcChannel.CherryIN_StartOAuthFlow, oauthServer, apiHost),
    onOAuthResult: (
      callback: (result: { state: string; apiKeys: string } | { state: string; error: string }) => void
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        result: { state: string; apiKeys: string } | { state: string; error: string }
      ) => callback(result)
      ipcRenderer.on(IpcChannel.CherryIN_OAuthResult, listener)
      return () => {
        ipcRenderer.off(IpcChannel.CherryIN_OAuthResult, listener)
      }
    }
  },
  // Binary related APIs
  isBinaryExist: (name: string) => ipcRenderer.invoke(IpcChannel.App_IsBinaryExist, name),
  getBinaryPath: (name: string) => ipcRenderer.invoke(IpcChannel.App_GetBinaryPath, name),
  installUVBinary: () => ipcRenderer.invoke(IpcChannel.App_InstallUvBinary),
  installBunBinary: () => ipcRenderer.invoke(IpcChannel.App_InstallBunBinary),
  installOvmsBinary: () => ipcRenderer.invoke(IpcChannel.App_InstallOvmsBinary),
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
  externalApps: {
    detectInstalled: (): Promise<ExternalAppInfo[]> => ipcRenderer.invoke(IpcChannel.ExternalApps_DetectInstalled)
  },
  nutstore: {
    getSSOUrl: () => ipcRenderer.invoke(IpcChannel.Nutstore_GetSsoUrl),
    decryptToken: (token: string) => ipcRenderer.invoke(IpcChannel.Nutstore_DecryptToken, token),
    getDirectoryContents: (token: string, path: string) =>
      ipcRenderer.invoke(IpcChannel.Nutstore_GetDirectoryContents, token, path)
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
  },
  settings: {
    // NOTE: misplaced API, kept here as an interim home. `openSettings` opens the
    // Settings *window* — a navigation/feature concern, NOT a window-control primitive —
    // yet it was historically grouped under `windowManager`. It is parked under `settings`
    // so it stops leaking into the window domain, but the underlying `SettingsWindow_Open`
    // IPC is still legacy (not on IpcApi). FOLLOW-UP: migrate it onto a proper settings /
    // navigation IpcApi domain and remove this stopgap.
    openSettings: (path: SettingsPath = '/settings/provider'): Promise<string> =>
      ipcRenderer.invoke(IpcChannel.SettingsWindow_Open, path)
  },
  wechat: {
    onQrLogin: (
      callback: (data: { channelId: string; agentId: string; url: string; status: string; userId?: string }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          channelId: string
          agentId: string
          url: string
          status: string
          userId?: string
        }
      ) => {
        callback(data)
      }
      ipcRenderer.on(IpcChannel.WeChat_QrLogin, listener)
      return () => ipcRenderer.off(IpcChannel.WeChat_QrLogin, listener)
    },
    hasCredentials: (channelId: string): Promise<{ exists: boolean; userId?: string }> =>
      ipcRenderer.invoke(IpcChannel.WeChat_HasCredentials, channelId)
  },
  feishu: {
    onQrLogin: (
      callback: (data: {
        channelId: string
        agentId: string
        url: string
        status: string
        appId?: string
        appSecret?: string
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          channelId: string
          agentId: string
          url: string
          status: string
          appId?: string
          appSecret?: string
        }
      ) => {
        callback(data)
      }
      ipcRenderer.on(IpcChannel.Feishu_QrLogin, listener)
      return () => ipcRenderer.off(IpcChannel.Feishu_QrLogin, listener)
    }
  },
  channel: {
    onLog: (
      callback: (log: { timestamp: number; level: string; message: string; channelId: string }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        log: {
          timestamp: number
          level: string
          message: string
          channelId: string
        }
      ) => {
        callback(log)
      }
      ipcRenderer.on(IpcChannel.Channel_Log, listener)
      return () => ipcRenderer.off(IpcChannel.Channel_Log, listener)
    },
    onStatusChange: (
      callback: (status: { channelId: string; connected: boolean; error?: string }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        status: { channelId: string; connected: boolean; error?: string }
      ) => {
        callback(status)
      }
      ipcRenderer.on(IpcChannel.Channel_StatusChange, listener)
      return () => ipcRenderer.off(IpcChannel.Channel_StatusChange, listener)
    },
    getLogs: (
      channelId: string
    ): Promise<
      Array<{
        timestamp: number
        level: string
        message: string
        channelId: string
      }>
    > => ipcRenderer.invoke(IpcChannel.Channel_GetLogs, channelId),
    getStatuses: (): Promise<Array<{ channelId: string; connected: boolean; error?: string }>> =>
      ipcRenderer.invoke(IpcChannel.Channel_GetStatuses)
  },
  quoteToMainWindow: (text: string) => ipcRenderer.invoke(IpcChannel.App_QuoteToMain, text),
  // setDisableHardwareAcceleration: (isDisable: boolean) =>
  //   ipcRenderer.invoke(IpcChannel.App_SetDisableHardwareAcceleration, isDisable),
  // setUseSystemTitleBar: (isActive: boolean) => ipcRenderer.invoke(IpcChannel.App_SetUseSystemTitleBar, isActive),
  trace: {
    getData: (topicId: string, traceId: string) => ipcRenderer.invoke(IpcChannel.TRACE_GET_DATA, topicId, traceId),
    cleanLocalData: () => ipcRenderer.invoke(IpcChannel.TRACE_CLEAN_LOCAL_DATA)
  },
  codeCli: {
    run: (
      cliTool: string,
      model: string,
      directory: string,
      env: Record<string, string>,
      options?: { autoUpdateToLatest?: boolean; terminal?: string }
    ): Promise<CodeToolsRunResult> =>
      ipcRenderer.invoke(IpcChannel.CodeCli_Run, cliTool, model, directory, env, options),
    getAvailableTerminals: (): Promise<TerminalConfig[]> =>
      ipcRenderer.invoke(IpcChannel.CodeCli_GetAvailableTerminals),
    setCustomTerminalPath: (terminalId: string, path: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.CodeCli_SetCustomTerminalPath, terminalId, path),
    getCustomTerminalPath: (terminalId: string): Promise<string | undefined> =>
      ipcRenderer.invoke(IpcChannel.CodeCli_GetCustomTerminalPath, terminalId),
    removeCustomTerminalPath: (terminalId: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.CodeCli_RemoveCustomTerminalPath, terminalId)
  },
  ocr: {
    ocr: (file: SupportedOcrFile, provider: OcrProvider): Promise<OcrResult> =>
      ipcRenderer.invoke(IpcChannel.OCR_ocr, file, provider),
    listProviders: (): Promise<string[]> => ipcRenderer.invoke(IpcChannel.OCR_ListProviders)
  },
  cherryai: {
    generateSignature: (params: { method: string; path: string; query: string; body: Record<string, any> }) =>
      ipcRenderer.invoke(IpcChannel.Cherryai_GetSignature, params)
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
  topic: {
    onAutoRenamed: (callback: (payload: { topicId: string }) => void) => {
      const listener = (_: any, payload: { topicId: string }) => callback(payload)
      ipcRenderer.on(IpcChannel.Topic_AutoRenamed, listener)
      return () => ipcRenderer.off(IpcChannel.Topic_AutoRenamed, listener)
    }
  },
  agentSession: {
    onAutoRenamed: (callback: (payload: { sessionId: string }) => void) => {
      const listener = (_: any, payload: { sessionId: string }) => callback(payload)
      ipcRenderer.on(IpcChannel.AgentSession_AutoRenamed, listener)
      return () => ipcRenderer.off(IpcChannel.AgentSession_AutoRenamed, listener)
    }
  },
  ai: {
    // ── Stream push listeners ──
    onStreamChunk: (callback: (data: StreamChunkPayload) => void) => {
      const listener = (_: Electron.IpcRendererEvent, data: StreamChunkPayload) => callback(data)
      ipcRenderer.on(IpcChannel.Ai_StreamChunk, listener)
      return () => ipcRenderer.removeListener(IpcChannel.Ai_StreamChunk, listener)
    },
    onStreamDone: (callback: (data: StreamDonePayload) => void) => {
      const listener = (_: Electron.IpcRendererEvent, data: StreamDonePayload) => callback(data)
      ipcRenderer.on(IpcChannel.Ai_StreamDone, listener)
      return () => ipcRenderer.removeListener(IpcChannel.Ai_StreamDone, listener)
    },
    onStreamError: (callback: (data: StreamErrorPayload) => void) => {
      const listener = (_: Electron.IpcRendererEvent, data: StreamErrorPayload) => callback(data)
      ipcRenderer.on(IpcChannel.Ai_StreamError, listener)
      return () => ipcRenderer.removeListener(IpcChannel.Ai_StreamError, listener)
    },

    // ── Stream control ──
    streamOpen: (req: AiStreamOpenRequest): Promise<AiStreamOpenResponse> =>
      ipcRenderer.invoke(IpcChannel.Ai_Stream_Open, req),
    streamAttach: (req: AiStreamAttachRequest): Promise<AiStreamAttachResponse> =>
      ipcRenderer.invoke(IpcChannel.Ai_Stream_Attach, req),
    streamDetach: (req: AiStreamDetachRequest): Promise<void> => ipcRenderer.invoke(IpcChannel.Ai_Stream_Detach, req),
    streamAbort: (req: AiStreamAbortRequest): Promise<void> => ipcRenderer.invoke(IpcChannel.Ai_Stream_Abort, req),
    prewarmAgentSession: (req: AiAgentSessionWarmRequest): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.Ai_AgentSession_Prewarm, req),
    closeAgentSessionWarm: (req: AiAgentSessionWarmCloseRequest): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.Ai_AgentSession_CloseWarm, req),

    // ── Non-streaming operations ──
    // All use uniqueModelId ("providerId::modelId") instead of separate providerId/modelId.
    generateText: (request: {
      assistantId?: string
      uniqueModelId?: string
      system?: string
      prompt?: string
      messages?: unknown[]
      mcpToolIds?: string[]
    }): Promise<{ text: string; usage?: unknown }> => ipcRenderer.invoke(IpcChannel.Ai_GenerateText, request),
    checkModel: (request: { uniqueModelId?: string; timeout?: number }): Promise<{ latency: number }> =>
      ipcRenderer.invoke(IpcChannel.Ai_CheckModel, request),
    embedMany: (request: {
      uniqueModelId?: string
      values: string[]
    }): Promise<{ embeddings: number[][]; usage?: unknown }> => ipcRenderer.invoke(IpcChannel.Ai_EmbedMany, request),
    generateImage: async (
      payload: {
        uniqueModelId?: string
        prompt: string
        inputImages?: string[]
        mask?: string
        n?: number
        size?: string
        negativePrompt?: string
        seed?: number
        quality?: string
        numInferenceSteps?: number
        guidanceScale?: number
        promptEnhancement?: boolean
        personGeneration?: string
        aspectRatio?: string
        background?: string
        moderation?: string
        style?: string
        providerOptions?: Record<string, Record<string, unknown>>
      },
      requestId: string
    ): Promise<{ files: FileEntry[] }> => ipcRenderer.invoke(IpcChannel.Ai_GenerateImage, { requestId, payload }),
    abortImage: (requestId: string): void => {
      ipcRenderer.send(IpcChannel.Ai_AbortImage, { requestId })
    },
    listModels: (request: {
      providerId?: string
      assistantId?: string
      throwOnError?: boolean
    }): Promise<Partial<Model>[]> => ipcRenderer.invoke(IpcChannel.Ai_ListModels, request),

    // ── Tool approval (v6 ToolUIPart native flow) ──
    toolApproval: {
      respond: (payload: {
        approvalId: string
        approved: boolean
        reason?: string
        updatedInput?: Record<string, unknown>
        topicId?: string
        anchorId?: string
      }): Promise<{ ok: boolean }> => ipcRenderer.invoke(IpcChannel.Ai_ToolApproval_Respond, payload)
    },
    agent: {
      runTask: (taskId: string) => ipcRenderer.invoke(IpcChannel.Ai_Agent_RunTask, taskId)
    }
  },
  translate: {
    open: (req: {
      streamId: string
      text: string
      targetLangCode: string
      /** Optional — when present, main persists the translation onto this message's parts on stream success. */
      messageId?: string
      sourceLangCode?: string
    }): Promise<{ streamId: string }> => ipcRenderer.invoke(IpcChannel.Ai_Translate_Open, req)
  },
  apiGateway: {
    start: (): Promise<ApiGatewayStatusResult> => ipcRenderer.invoke(IpcChannel.ApiGateway_Start),
    restart: (): Promise<ApiGatewayStatusResult> => ipcRenderer.invoke(IpcChannel.ApiGateway_Restart),
    stop: (): Promise<ApiGatewayStatusResult> => ipcRenderer.invoke(IpcChannel.ApiGateway_Stop)
  },
  skill: {
    list: (agentId?: string): Promise<SkillResult<InstalledSkill[]>> =>
      ipcRenderer.invoke(IpcChannel.Skill_List, agentId),
    install: (options: SkillInstallOptions): Promise<SkillResult<InstalledSkill>> =>
      ipcRenderer.invoke(IpcChannel.Skill_Install, options),
    uninstall: (skillId: string): Promise<SkillResult<void>> => ipcRenderer.invoke(IpcChannel.Skill_Uninstall, skillId),
    toggle: (options: SkillToggleOptions): Promise<SkillResult<InstalledSkill | null>> =>
      ipcRenderer.invoke(IpcChannel.Skill_Toggle, options),
    installFromZip: (options: SkillInstallFromZipOptions): Promise<SkillResult<InstalledSkill>> =>
      ipcRenderer.invoke(IpcChannel.Skill_InstallFromZip, options),
    installFromDirectory: (options: SkillInstallFromDirectoryOptions): Promise<SkillResult<InstalledSkill>> =>
      ipcRenderer.invoke(IpcChannel.Skill_InstallFromDirectory, options),
    readSkillFile: (skillId: string, filename: string): Promise<SkillResult<string | null>> =>
      ipcRenderer.invoke(IpcChannel.Skill_ReadFile, skillId, filename),
    listFiles: (skillId: string): Promise<SkillResult<SkillFileNode[]>> =>
      ipcRenderer.invoke(IpcChannel.Skill_ListFiles, skillId),
    listLocal: (workdir: string): Promise<SkillResult<LocalSkill[]>> =>
      ipcRenderer.invoke(IpcChannel.Skill_ListLocal, workdir)
  },
  lanTransfer: {
    getState: (): Promise<LanTransferState> => ipcRenderer.invoke(IpcChannel.LanTransfer_ListServices),
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
  },
  openclaw: {
    checkInstalled: (): Promise<{
      installed: boolean
      path: string | null
      needsMigration: boolean
    }> => ipcRenderer.invoke(IpcChannel.OpenClaw_CheckInstalled),
    install: (): Promise<OperationResult> => ipcRenderer.invoke(IpcChannel.OpenClaw_Install),
    uninstall: (): Promise<OperationResult> => ipcRenderer.invoke(IpcChannel.OpenClaw_Uninstall),
    startGateway: (port?: number): Promise<OperationResult> =>
      ipcRenderer.invoke(IpcChannel.OpenClaw_StartGateway, port),
    stopGateway: (): Promise<OperationResult> => ipcRenderer.invoke(IpcChannel.OpenClaw_StopGateway),
    getStatus: (): Promise<{ status: OpenClawGatewayStatus; port: number }> =>
      ipcRenderer.invoke(IpcChannel.OpenClaw_GetStatus),
    checkHealth: (): Promise<OpenClawHealthInfo> => ipcRenderer.invoke(IpcChannel.OpenClaw_CheckHealth),
    getDashboardUrl: (): Promise<string> => ipcRenderer.invoke(IpcChannel.OpenClaw_GetDashboardUrl),
    syncConfig: (uniqueModelId: string): Promise<OperationResult> =>
      ipcRenderer.invoke(IpcChannel.OpenClaw_SyncConfig, uniqueModelId),
    getChannels: (): Promise<OpenClawChannelInfo[]> => ipcRenderer.invoke(IpcChannel.OpenClaw_GetChannels),
    checkUpdate: (): Promise<{
      hasUpdate: boolean
      currentVersion: string | null
      latestVersion: string | null
      message?: string
    }> => ipcRenderer.invoke(IpcChannel.OpenClaw_CheckUpdate),
    performUpdate: (): Promise<OperationResult> => ipcRenderer.invoke(IpcChannel.OpenClaw_PerformUpdate)
  },
  analytics: {
    trackTokenUsage: (data: TokenUsageData) => ipcRenderer.invoke(IpcChannel.Analytics_TrackTokenUsage, data)
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
