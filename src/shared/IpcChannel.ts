/**
 * Central registry of legacy Electron IPC channel names. Command IPC has largely moved to
 * IpcApi (`ipcApi.request`); what remains here is the data/IpcApi transport infrastructure
 * plus channels not yet migrated — v1-only backup / nutstore / copilot, the file module,
 * LAN transfer, and a handful of micro-domains.
 */
export enum IpcChannel {
  App_GetCacheSize = 'app:get-cache-size',
  App_ClearCache = 'app:clear-cache',
  App_SetLaunchOnBoot = 'app:set-launch-on-boot',
  App_SetSpellCheckLanguages = 'app:set-spell-check-languages',
  App_Select = 'app:select',
  App_HasWritePermission = 'app:has-write-permission',
  App_ResolvePath = 'app:resolve-path',
  App_IsPathInside = 'app:is-path-inside',
  App_Copy = 'app:copy',
  Application_PreventQuit = 'application:prevent-quit',
  Application_AllowQuit = 'application:allow-quit',
  App_SetAppDataPath = 'app:set-app-data-path',
  App_GetDataPathFromArgs = 'app:get-data-path-from-args',
  App_FlushAppData = 'app:flush-app-data',
  App_IsNotEmptyDir = 'app:is-not-empty-dir',
  Application_Relaunch = 'application:relaunch',
  App_ResetData = 'app:reset-data',
  App_LogToMain = 'app:log-to-main',
  App_QuoteToMain = 'app:quote-to-main',

  // StorageMonitor: main-process disk-space watcher for the user-data volume
  StorageMonitor_GetHealth = 'storage-monitor:get-health',
  StorageMonitor_HealthChanged = 'storage-monitor:health-changed',

  // Python: main→renderer(pyodide)→main reverse RPC
  Python_ExecutionRequest = 'python:execution-request',
  Python_ExecutionResponse = 'python:execution-response',

  //copilot
  Copilot_GetAuthMessage = 'copilot:get-auth-message',
  Copilot_GetCopilotToken = 'copilot:get-copilot-token',
  Copilot_SaveCopilotToken = 'copilot:save-copilot-token',
  Copilot_GetToken = 'copilot:get-token',
  Copilot_Logout = 'copilot:logout',
  Copilot_GetUser = 'copilot:get-user',

  // nutstore
  Nutstore_GetSsoUrl = 'nutstore:get-sso-url',
  Nutstore_DecryptToken = 'nutstore:decrypt-token',
  Nutstore_GetDirectoryContents = 'nutstore:get-directory-contents',

  //aes
  Aes_Decrypt = 'aes:decrypt',

  Shortcut_RegistrationConflict = 'shortcut:registration-conflict',

  NativeCommandPopupMenu_Show = 'native-command-popup-menu:show',

  // Tab
  Tab_MoveWindow = 'tab:move-window',

  //file
  File_Open = 'file:open',
  File_OpenPath = 'file:openPath',
  File_Save = 'file:save',
  File_Select = 'file:select',
  File_ReadExternal = 'file:readExternal',
  File_DeleteExternalFile = 'file:deleteExternalFile',
  File_DeleteExternalDir = 'file:deleteExternalDir',
  File_Move = 'file:move',
  File_MoveDir = 'file:moveDir',
  File_Rename = 'file:rename',
  File_RenameDir = 'file:renameDir',
  File_Get = 'file:get',
  File_SelectFolder = 'file:selectFolder',
  File_CreateTempFile = 'file:createTempFile',
  File_Mkdir = 'file:mkdir',
  File_Write = 'file:write',
  File_SaveImage = 'file:saveImage',
  File_SavePastedImage = 'file:savePastedImage',
  File_BinaryImage = 'file:binaryImage',
  Fs_Read = 'fs:read',
  Fs_ReadText = 'fs:readText',
  File_ListDirectory = 'file:listDirectory',
  File_ListDirectoryEntries = 'file:listDirectoryEntries',
  File_CheckFileName = 'file:checkFileName',
  File_ValidateNotesDirectory = 'file:validateNotesDirectory',
  File_BatchUploadMarkdown = 'file:batchUploadMarkdown',
  File_ShowInFolder = 'file:showInFolder',
  // FileManager v2 surface (Phase 2)
  File_CreateInternalEntry = 'file:createInternalEntry',
  File_EnsureExternalEntry = 'file:ensureExternalEntry',
  File_GetPhysicalPath = 'file:getPhysicalPath',
  File_PermanentDelete = 'file:permanentDelete',
  File_RunSweep = 'file:runSweep',
  // DirectoryTreeBuilder primitive — top-level file-module surface, parallel
  // to the FileEntry channels above. See docs/references/file/directory-tree.md.
  File_TreeCreate = 'file:tree:create',
  File_TreeDispose = 'file:tree:dispose',
  File_TreeRename = 'file:tree:rename',
  File_TreeMutation = 'file:tree:mutation',

  // backup
  Backup_Backup = 'backup:backup',
  Backup_Restore = 'backup:restore',
  Backup_BackupToWebdav = 'backup:backupToWebdav',
  Backup_RestoreFromWebdav = 'backup:restoreFromWebdav',
  Backup_ListWebdavFiles = 'backup:listWebdavFiles',
  Backup_CheckConnection = 'backup:checkConnection',
  Backup_CreateDirectory = 'backup:createDirectory',
  Backup_DeleteWebdavFile = 'backup:deleteWebdavFile',
  Backup_BackupToLocalDir = 'backup:backupToLocalDir',
  Backup_RestoreFromLocalBackup = 'backup:restoreFromLocalBackup',
  Backup_ListLocalBackupFiles = 'backup:listLocalBackupFiles',
  Backup_DeleteLocalBackupFile = 'backup:deleteLocalBackupFile',
  Backup_BackupToS3 = 'backup:backupToS3',
  Backup_RestoreFromS3 = 'backup:restoreFromS3',
  Backup_ListS3Files = 'backup:listS3Files',
  Backup_DeleteS3File = 'backup:deleteS3File',
  Backup_CreateLanTransferBackup = 'backup:createLanTransferBackup',
  Backup_DeleteLanTransferBackup = 'backup:deleteLanTransferBackup',

  // zip
  Zip_Decompress = 'zip:decompress',

  // system
  System_GetHostname = 'system:getHostname',

  // events
  BackupProgress = 'backup-progress',
  RestoreProgress = 'restore-progress',

  // Data: Preference
  Preference_Get = 'preference:get',
  Preference_Set = 'preference:set',
  Preference_GetMultipleRaw = 'preference:get-multiple-raw',
  Preference_SetMultiple = 'preference:set-multiple',
  Preference_GetAll = 'preference:get-all',
  Preference_Subscribe = 'preference:subscribe',
  Preference_Changed = 'preference:changed',

  // Data: Cache
  Cache_Sync = 'cache:sync',
  Cache_SyncBatch = 'cache:sync-batch',
  Cache_GetAllShared = 'cache:get-all-shared',

  // Data: API Channels
  DataApi_Request = 'data-api:request',
  DataApi_Subscribe = 'data-api:subscribe',
  DataApi_Unsubscribe = 'data-api:unsubscribe',
  DataApi_Stream = 'data-api:stream',

  // IpcApi: RPC-over-IPC command channel (renderer→main request, main→renderer event)
  IpcApi_Request = 'ipc-api:request',
  IpcApi_Event = 'ipc-api:event',

  // TRACE
  TRACE_GET_DATA = 'trace:getData',
  TRACE_CLEAN_LOCAL_DATA = 'trace:cleanLocalData',

  // ExternalApps
  ExternalApps_DetectInstalled = 'external-apps:detect-installed',

  // Global Skills
  Skill_ReadFile = 'skill:read-file',
  Skill_ListFiles = 'skill:list-files',

  // LAN Transfer
  LanTransfer_StartScan = 'lan-transfer:start-scan',
  LanTransfer_StopScan = 'lan-transfer:stop-scan',
  LanTransfer_ServicesUpdated = 'lan-transfer:services-updated',
  LanTransfer_Connect = 'lan-transfer:connect',
  LanTransfer_Disconnect = 'lan-transfer:disconnect',
  LanTransfer_ClientEvent = 'lan-transfer:client-event',
  LanTransfer_SendFile = 'lan-transfer:send-file',
  LanTransfer_CancelTransfer = 'lan-transfer:cancel-transfer'

  // ──────────────────────────────────────────────────────────────
  // TODO(v2): the following IPC channels are still referenced via
  // bare string literals throughout the codebase and not declared
  // as enum members. They should be collected here in a future
  // cleanup pass so broadcastToType/invoke call sites get editor
  // auto-complete and cross-reference support:
  //
  //   - 'protocol-data'             (ProtocolService + preload)
  //   - 'file-preprocess-finished'  (PreprocessingService + KnowledgeService)
  //   - 'file-preprocess-progress'  (BasePreprocessProvider)
  // ──────────────────────────────────────────────────────────────
}
