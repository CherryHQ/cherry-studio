export enum IpcChannel {
  App_GetCacheSize = 'app:get-cache-size',
  App_ClearCache = 'app:clear-cache',
  App_SetLaunchOnBoot = 'app:set-launch-on-boot',
  App_SetEnableSpellCheck = 'app:set-enable-spell-check',
  App_SetSpellCheckLanguages = 'app:set-spell-check-languages',
  App_Info = 'app:info',
  App_HandleZoomFactor = 'app:handle-zoom-factor',
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
  App_IsBinaryExist = 'app:is-binary-exist',
  App_InstallOvmsBinary = 'app:install-ovms-binary',
  App_LogToMain = 'app:log-to-main',
  App_GetSystemFonts = 'app:get-system-fonts',
  App_GetIpCountry = 'app:get-ip-country',

  App_MacIsProcessTrusted = 'app:mac-is-process-trusted',
  App_MacRequestProcessTrust = 'app:mac-request-process-trust',

  App_QuoteToMain = 'app:quote-to-main',

  // StorageMonitor: main-process disk-space watcher for the user-data volume
  StorageMonitor_GetHealth = 'storage-monitor:get-health',
  StorageMonitor_HealthChanged = 'storage-monitor:health-changed',

  Notification_Send = 'notification:send',
  Notification_OnClick = 'notification:on-click',

  Webview_SetOpenLinkExternal = 'webview:set-open-link-external',
  Webview_SetSpellCheckEnabled = 'webview:set-spell-check-enabled',
  Webview_SearchHotkey = 'webview:search-hotkey',
  Webview_PrintToPDF = 'webview:print-to-pdf',
  Webview_SaveAsHTML = 'webview:save-as-html',

  // Open
  Open_Path = 'open:path',
  Open_Website = 'open:website',

  // Quick Assistant
  QuickAssistant_Hide = 'quick-assistant:hide',
  QuickAssistant_Close = 'quick-assistant:close',
  QuickAssistant_SetPin = 'quick-assistant:set-pin',
  QuickAssistant_Shown = 'quick-assistant:shown',

  // Mcp
  Mcp_AddServer = 'mcp:add-server',
  Mcp_RemoveServer = 'mcp:remove-server',
  Mcp_RestartServer = 'mcp:restart-server',
  Mcp_StopServer = 'mcp:stop-server',
  Mcp_RefreshTools = 'mcp:refresh-tools',
  Mcp_ListPrompts = 'mcp:list-prompts',
  Mcp_ListResources = 'mcp:list-resources',
  Mcp_CheckConnectivity = 'mcp:check-connectivity',
  Mcp_UploadDxt = 'mcp:upload-dxt',
  Mcp_UploadMcpb = 'mcp:upload-mcpb',
  Mcp_AbortTool = 'mcp:abort-tool',
  Mcp_GetServerVersion = 'mcp:get-server-version',
  Mcp_Progress = 'mcp:progress',
  Mcp_GetServerLogs = 'mcp:get-server-logs',
  Mcp_ServerLog = 'mcp:server-log',
  // Python
  Python_ExecutionRequest = 'python:execution-request',
  Python_ExecutionResponse = 'python:execution-response',

  // WeChat channel
  WeChat_QrLogin = 'wechat:qr-login',
  WeChat_HasCredentials = 'wechat:has-credentials',

  // Feishu channel
  Feishu_QrLogin = 'feishu:qr-login',

  // Channel status & logs
  Channel_StatusChange = 'channel:status-change',
  Channel_Log = 'channel:log',
  Channel_GetLogs = 'channel:get-logs',
  Channel_GetStatuses = 'channel:get-statuses',

  //copilot
  Copilot_GetAuthMessage = 'copilot:get-auth-message',
  Copilot_GetCopilotToken = 'copilot:get-copilot-token',
  Copilot_SaveCopilotToken = 'copilot:save-copilot-token',
  Copilot_GetToken = 'copilot:get-token',
  Copilot_Logout = 'copilot:logout',
  Copilot_GetUser = 'copilot:get-user',

  // obsidian
  Obsidian_GetVaults = 'obsidian:get-vaults',
  Obsidian_GetFiles = 'obsidian:get-files',

  // nutstore
  Nutstore_GetSsoUrl = 'nutstore:get-sso-url',
  Nutstore_DecryptToken = 'nutstore:decrypt-token',
  Nutstore_GetDirectoryContents = 'nutstore:get-directory-contents',

  //aes
  Aes_Decrypt = 'aes:decrypt',

  // MainWindow: handlers in MainWindowService, operate on main window only.
  MainWindow_Reload = 'main-window:reload',
  MainWindow_ResetMinimumSize = 'main-window:reset-minimum-size',
  MainWindow_SetMinimumSize = 'main-window:set-minimum-size',

  Shortcut_RegistrationConflict = 'shortcut:registration-conflict',

  NativeCommandPopupMenu_Show = 'native-command-popup-menu:show',

  // Tab
  Tab_Attach = 'tab:attach',
  Tab_Detach = 'tab:detach',
  Tab_MoveWindow = 'tab:move-window',
  Tab_DragEnd = 'tab:drag-end',

  // Sub-window (detached tab window)
  SubWindow_SetAlwaysOnTop = 'sub-window:set-always-on-top',

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
  File_IsTextFile = 'file:isTextFile',
  File_IsDirectory = 'file:isDirectory',
  File_GetMetadata = 'file:getMetadata',
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

  Export_Word = 'export:word',

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
  Backup_CheckS3Connection = 'backup:checkS3Connection',
  Backup_CreateLanTransferBackup = 'backup:createLanTransferBackup',
  Backup_DeleteLanTransferBackup = 'backup:deleteLanTransferBackup',

  // zip
  Zip_Decompress = 'zip:decompress',

  // system
  System_GetDeviceType = 'system:getDeviceType',
  System_GetHostname = 'system:getHostname',
  // Git Bash has no IPC channel; resolved in-process (settingsBuilder).

  // DevTools
  System_ToggleDevTools = 'system:toggleDevTools',

  // events
  BackupProgress = 'backup-progress',
  NativeThemeUpdated = 'native-theme:updated',
  RestoreProgress = 'restore-progress',
  UpdateError = 'update-error',
  UpdateAvailable = 'update-available',
  UpdateNotAvailable = 'update-not-available',
  DownloadProgress = 'download-progress',
  UpdateDownloaded = 'update-downloaded',

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

  // Topic auto-rename push (main → renderer; payload: { topicId })
  Topic_AutoRenamed = 'topic:auto-renamed',
  // Agent session auto-rename push (main → renderer; payload: { sessionId })
  AgentSession_AutoRenamed = 'agent-session:auto-renamed',

  // TRACE
  TRACE_GET_DATA = 'trace:getData',
  TRACE_CLEAN_LOCAL_DATA = 'trace:cleanLocalData',

  // API Gateway
  ApiGateway_Start = 'api-gateway:start',
  ApiGateway_Stop = 'api-gateway:stop',
  ApiGateway_Restart = 'api-gateway:restart',

  // ExternalApps
  ExternalApps_DetectInstalled = 'external-apps:detect-installed',

  // CodeCli
  CodeCli_Run = 'code-cli:run',
  CodeCli_GetAvailableTerminals = 'code-cli:get-available-terminals',
  CodeCli_SetCustomTerminalPath = 'code-cli:set-custom-terminal-path',
  CodeCli_GetCustomTerminalPath = 'code-cli:get-custom-terminal-path',
  CodeCli_RemoveCustomTerminalPath = 'code-cli:remove-custom-terminal-path',

  // OVMS
  Ovms_IsSupported = 'ovms:is-supported',
  Ovms_AddModel = 'ovms:add-model',
  Ovms_StopAddModel = 'ovms:stop-addmodel',
  Ovms_GetModels = 'ovms:get-models',
  Ovms_IsRunning = 'ovms:is-running',
  Ovms_GetStatus = 'ovms:get-status',
  Ovms_RunOVMS = 'ovms:run-ovms',
  Ovms_StopOVMS = 'ovms:stop-ovms',

  // Global Skills
  Skill_Install = 'skill:install',
  Skill_Uninstall = 'skill:uninstall',
  Skill_Toggle = 'skill:toggle',
  Skill_InstallFromZip = 'skill:install-from-zip',
  Skill_InstallFromDirectory = 'skill:install-from-directory',
  Skill_ReadFile = 'skill:read-file',
  Skill_ListFiles = 'skill:list-files',
  Skill_ListLocal = 'skill:list-local',

  // LAN Transfer
  LanTransfer_ListServices = 'lan-transfer:list',
  LanTransfer_StartScan = 'lan-transfer:start-scan',
  LanTransfer_StopScan = 'lan-transfer:stop-scan',
  LanTransfer_ServicesUpdated = 'lan-transfer:services-updated',
  LanTransfer_Connect = 'lan-transfer:connect',
  LanTransfer_Disconnect = 'lan-transfer:disconnect',
  LanTransfer_ClientEvent = 'lan-transfer:client-event',
  LanTransfer_SendFile = 'lan-transfer:send-file',
  LanTransfer_CancelTransfer = 'lan-transfer:cancel-transfer',

  // OpenClaw
  OpenClaw_CheckInstalled = 'openclaw:check-installed',
  OpenClaw_Install = 'openclaw:install',
  OpenClaw_Uninstall = 'openclaw:uninstall',
  OpenClaw_InstallProgress = 'openclaw:install-progress',
  OpenClaw_StartGateway = 'openclaw:start-gateway',
  OpenClaw_StopGateway = 'openclaw:stop-gateway',
  OpenClaw_GetStatus = 'openclaw:get-status',
  OpenClaw_GetDashboardUrl = 'openclaw:get-dashboard-url',
  OpenClaw_SyncConfig = 'openclaw:sync-config',
  OpenClaw_CheckUpdate = 'openclaw:check-update',
  OpenClaw_PerformUpdate = 'openclaw:perform-update',

  // AI capability IPC (model ops, streaming chat, agent-session warm-up, tool approval,
  // agent run-task) migrated to IpcApi (`ai.*`). Only `translate.open` remains on legacy IPC.
  Ai_Translate_Open = 'ai:translate:open',

  // Settings window — legacy "open a named window" channel (preload `settings.openSettings`).
  // The former WindowManager_* control + event channels were migrated to IpcApi (`window.*`).
  SettingsWindow_Open = 'settings-window:open'

  // BinaryManager (tool manager) was migrated to IpcApi (`binary.*`).

  // ──────────────────────────────────────────────────────────────
  // TODO(v2): the following IPC channels are still referenced via
  // bare string literals throughout the codebase and not declared
  // as enum members. They should be collected here in a future
  // cleanup pass so broadcastToType/invoke call sites get editor
  // auto-complete and cross-reference support:
  //
  //   - 'notification-click'        (NotificationService + ipc.ts Notification_OnClick handler)
  //   - 'protocol-data'             (ProtocolService + preload)
  //   - 'file-preprocess-finished'  (PreprocessingService + KnowledgeService)
  //   - 'file-preprocess-progress'  (BasePreprocessProvider)
  // ──────────────────────────────────────────────────────────────
}
