export enum IpcChannel {
  App_GetCacheSize = 'app:get-cache-size',
  App_ClearCache = 'app:clear-cache',
  App_SetLaunchOnBoot = 'app:set-launch-on-boot',
  App_SetEnableSpellCheck = 'app:set-enable-spell-check',
  App_SetSpellCheckLanguages = 'app:set-spell-check-languages',
  App_CheckForUpdate = 'app:check-for-update',
  App_QuitAndInstall = 'app:quit-and-install',
  Application_Quit = 'application:quit',
  App_Info = 'app:info',
  App_SetAutoUpdate = 'app:set-auto-update',
  App_SetTestPlan = 'app:set-test-plan',
  App_SetTestChannel = 'app:set-test-channel',
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
  App_GetBinaryPath = 'app:get-binary-path',
  App_InstallUvBinary = 'app:install-uv-binary',
  App_InstallBunBinary = 'app:install-bun-binary',
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

  MiniApp = 'mini-app',

  Config_Set = 'config:set',
  Config_Get = 'config:get',

  // Quick Assistant
  QuickAssistant_Show = 'quick-assistant:show',
  QuickAssistant_Hide = 'quick-assistant:hide',
  QuickAssistant_Close = 'quick-assistant:close',
  QuickAssistant_Toggle = 'quick-assistant:toggle',
  QuickAssistant_SetPin = 'quick-assistant:set-pin',
  QuickAssistant_Shown = 'quick-assistant:shown',

  // Mcp
  Mcp_AddServer = 'mcp:add-server',
  Mcp_RemoveServer = 'mcp:remove-server',
  Mcp_RestartServer = 'mcp:restart-server',
  Mcp_StopServer = 'mcp:stop-server',
  Mcp_RefreshTools = 'mcp:refresh-tools',
  Mcp_CallTool = 'mcp:call-tool',
  Mcp_ListPrompts = 'mcp:list-prompts',
  Mcp_GetPrompt = 'mcp:get-prompt',
  Mcp_ListResources = 'mcp:list-resources',
  Mcp_GetResource = 'mcp:get-resource',
  Mcp_GetInstallInfo = 'mcp:get-install-info',
  Mcp_ServersChanged = 'mcp:servers-changed',
  Mcp_ServersUpdated = 'mcp:servers-updated',
  Mcp_CheckConnectivity = 'mcp:check-connectivity',
  Mcp_UploadDxt = 'mcp:upload-dxt',
  Mcp_UploadMcpb = 'mcp:upload-mcpb',
  Mcp_AbortTool = 'mcp:abort-tool',
  Mcp_GetServerVersion = 'mcp:get-server-version',
  Mcp_Progress = 'mcp:progress',
  Mcp_GetServerLogs = 'mcp:get-server-logs',
  Mcp_ServerLog = 'mcp:server-log',
  // Python
  Python_Execute = 'python:execute',
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

  // CherryIN OAuth
  CherryIN_SaveToken = 'cherryin:save-token',
  CherryIN_HasToken = 'cherryin:has-token',
  CherryIN_GetBalance = 'cherryin:get-balance',
  CherryIN_Logout = 'cherryin:logout',
  CherryIN_StartOAuthFlow = 'cherryin:start-oauth-flow',
  // Main → renderer push: OAuth callback result, addressed to the flow initiator
  // captured at startOAuthFlow time. Replaces the renderer-pulled exchange-token IPC.
  CherryIN_OAuthResult = 'cherryin:oauth-result',

  // obsidian
  Obsidian_GetVaults = 'obsidian:get-vaults',
  Obsidian_GetFiles = 'obsidian:get-files',

  // nutstore
  Nutstore_GetSsoUrl = 'nutstore:get-sso-url',
  Nutstore_DecryptToken = 'nutstore:decrypt-token',
  Nutstore_GetDirectoryContents = 'nutstore:get-directory-contents',

  //aes
  Aes_Encrypt = 'aes:encrypt',
  Aes_Decrypt = 'aes:decrypt',

  Gemini_UploadFile = 'gemini:upload-file',
  Gemini_Base64File = 'gemini:base64-file',
  Gemini_RetrieveFile = 'gemini:retrieve-file',
  Gemini_ListFiles = 'gemini:list-files',
  Gemini_DeleteFile = 'gemini:delete-file',

  // VertexAI
  VertexAI_GetAuthHeaders = 'vertexai:get-auth-headers',
  VertexAI_GetAccessToken = 'vertexai:get-access-token',
  VertexAI_ClearAuthCache = 'vertexai:clear-auth-cache',

  // MainWindow: handlers in MainWindowService, operate on main window only.
  MainWindow_Reload = 'main-window:reload',
  MainWindow_CrashRenderProcess = 'main-window:crash-render-process',
  MainWindow_ResetMinimumSize = 'main-window:reset-minimum-size',
  MainWindow_SetMinimumSize = 'main-window:set-minimum-size',

  Shortcut_RegistrationConflict = 'shortcut:registration-conflict',

  NativeCommandPopupMenu_Show = 'native-command-popup-menu:show',

  // Tab
  Tab_Attach = 'tab:attach',
  Tab_Detach = 'tab:detach',
  Tab_MoveWindow = 'tab:move-window',
  Tab_TryAttach = 'tab:try-attach',
  Tab_DragEnd = 'tab:drag-end',

  // Sub-window (detached tab window)
  SubWindow_SetAlwaysOnTop = 'sub-window:set-always-on-top',

  FileProcessing_StartJob = 'file-processing:start-job',
  FileProcessing_ListAvailableProcessors = 'file-processing:list-available-processors',

  //file
  File_Open = 'file:open',
  File_OpenPath = 'file:openPath',
  File_Save = 'file:save',
  File_Select = 'file:select',
  File_Upload = 'file:upload',
  File_Clear = 'file:clear',
  File_Read = 'file:read',
  File_ReadExternal = 'file:readExternal',
  File_Delete = 'file:delete',
  File_DeleteDir = 'file:deleteDir',
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
  File_WriteWithId = 'file:writeWithId',
  File_SaveImage = 'file:saveImage',
  File_Base64Image = 'file:base64Image',
  File_SaveBase64Image = 'file:saveBase64Image',
  File_SavePastedImage = 'file:savePastedImage',
  File_Download = 'file:download',
  File_Copy = 'file:copy',
  File_BinaryImage = 'file:binaryImage',
  File_Base64File = 'file:base64File',
  File_GetPdfInfo = 'file:getPdfInfo',
  Fs_Read = 'fs:read',
  Fs_ReadText = 'fs:readText',
  File_OpenWithRelativePath = 'file:openWithRelativePath',
  File_IsTextFile = 'file:isTextFile',
  File_IsDirectory = 'file:isDirectory',
  File_GetMetadata = 'file:getMetadata',
  File_ListDirectory = 'file:listDirectory',
  File_CheckFileName = 'file:checkFileName',
  File_ValidateNotesDirectory = 'file:validateNotesDirectory',
  File_BatchUploadMarkdown = 'file:batchUploadMarkdown',
  File_ShowInFolder = 'file:showInFolder',
  // FileManager v2 surface (Phase 1b.3)
  File_GetDanglingState = 'file:getDanglingState',
  File_BatchGetDanglingStates = 'file:batchGetDanglingStates',
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

  // PDF
  Pdf_ExtractText = 'pdf:extractText',

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

  // data migration
  DataMigrate_CheckNeeded = 'data-migrate:check-needed',
  DataMigrate_GetProgress = 'data-migrate:get-progress',
  DataMigrate_Cancel = 'data-migrate:cancel',
  DataMigrate_RequireBackup = 'data-migrate:require-backup',
  DataMigrate_BackupCompleted = 'data-migrate:backup-completed',
  DataMigrate_ShowBackupDialog = 'data-migrate:show-backup-dialog',
  DataMigrate_StartFlow = 'data-migrate:start-flow',
  DataMigrate_ProceedToBackup = 'data-migrate:proceed-to-backup',
  DataMigrate_StartMigration = 'data-migrate:start-migration',
  DataMigrate_RetryMigration = 'data-migrate:retry-migration',
  DataMigrate_RestartApp = 'data-migrate:restart-app',
  DataMigrate_CloseWindow = 'data-migrate:close-window',

  // zip
  Zip_Compress = 'zip:compress',
  Zip_Decompress = 'zip:decompress',

  // system
  System_GetDeviceType = 'system:getDeviceType',
  System_GetHostname = 'system:getHostname',
  System_GetCpuName = 'system:getCpuName',
  System_CheckGitBash = 'system:checkGitBash',
  System_GetGitBashPath = 'system:getGitBashPath',
  System_GetGitBashPathInfo = 'system:getGitBashPathInfo',
  System_SetGitBashPath = 'system:setGitBashPath',

  // DevTools
  System_ToggleDevTools = 'system:toggleDevTools',

  // events
  BackupProgress = 'backup-progress',
  DataMigrateProgress = 'data-migrate-progress',
  NativeThemeUpdated = 'native-theme:updated',
  RestoreProgress = 'restore-progress',
  UpdateError = 'update-error',
  UpdateAvailable = 'update-available',
  UpdateNotAvailable = 'update-not-available',
  DownloadProgress = 'download-progress',
  UpdateDownloaded = 'update-downloaded',
  DownloadUpdate = 'download-update',

  DirectoryProcessingPercent = 'directory-processing-percent',

  // Search Window
  SearchWindow_Open = 'search-window:open',
  SearchWindow_Close = 'search-window:close',
  SearchWindow_OpenUrl = 'search-window:open-url',

  // Provider
  Provider_AddKey = 'provider:add-key',

  // Web Search
  WebSearch_SearchKeywords = 'web-search:search-keywords',
  WebSearch_FetchUrls = 'web-search:fetch-urls',
  WebSearch_CheckProvider = 'web-search:check-provider',

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

  // OCR
  OCR_ocr = 'ocr:ocr',
  OCR_ListProviders = 'ocr:list-providers',

  // OVMS
  Ovms_IsSupported = 'ovms:is-supported',
  Ovms_AddModel = 'ovms:add-model',
  Ovms_StopAddModel = 'ovms:stop-addmodel',
  Ovms_GetModels = 'ovms:get-models',
  Ovms_IsRunning = 'ovms:is-running',
  Ovms_GetStatus = 'ovms:get-status',
  Ovms_RunOVMS = 'ovms:run-ovms',
  Ovms_StopOVMS = 'ovms:stop-ovms',

  // CherryAI
  Cherryai_GetSignature = 'cherryai:get-signature',

  // Global Skills
  Skill_List = 'skill:list',
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
  OpenClaw_CheckHealth = 'openclaw:check-health',
  OpenClaw_GetDashboardUrl = 'openclaw:get-dashboard-url',
  OpenClaw_SyncConfig = 'openclaw:sync-config',
  OpenClaw_GetChannels = 'openclaw:get-channels',
  OpenClaw_CheckUpdate = 'openclaw:check-update',
  OpenClaw_PerformUpdate = 'openclaw:perform-update',

  // Analytics
  Analytics_TrackTokenUsage = 'analytics:track-token-usage',

  // AI Stream (AiStreamManager)
  Ai_StreamChunk = 'ai:stream-chunk',
  Ai_StreamDone = 'ai:stream-done',
  Ai_StreamError = 'ai:stream-error',
  Ai_Translate_Open = 'ai:translate:open',
  /** Renderer → Main: send message (AiStreamManager routes to start or steer) */
  Ai_Stream_Open = 'ai:stream:open',
  /** Renderer → Main: subscribe to a topic's stream state */
  Ai_Stream_Attach = 'ai:stream:attach',
  /** Renderer → Main: unsubscribe from a topic (stream continues in Main) */
  Ai_Stream_Detach = 'ai:stream:detach',
  /** Renderer → Main: abort the active generation on a topic */
  Ai_Stream_Abort = 'ai:stream:abort',
  /** Renderer → Main: prewarm the next Claude Agent SDK query for an agent session */
  Ai_AgentSession_Prewarm = 'ai:agent-session:prewarm',
  /** Renderer → Main: close unused Claude Agent SDK warm query for an agent session */
  Ai_AgentSession_CloseWarm = 'ai:agent-session:close-warm',
  Ai_ToolApproval_Respond = 'ai:tool-approval:respond',

  // AI Non-streaming
  Ai_GenerateText = 'ai:generate-text',
  Ai_CheckModel = 'ai:check-model',
  Ai_EmbedMany = 'ai:embed-many',
  Ai_GenerateImage = 'ai:generate-image',
  Ai_AbortImage = 'ai:abort-image',
  Ai_ListModels = 'ai:list-models',
  Ai_Agent_RunTask = 'ai:agent:run-task',

  // Settings window — legacy "open a named window" channel (preload `settings.openSettings`).
  // The former WindowManager_* control + event channels were migrated to IpcApi (`window.*`).
  SettingsWindow_Open = 'settings-window:open'

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
