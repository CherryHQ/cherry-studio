export enum IpcChannel {
  App_GetCacheSize = 'app:get-cache-size',
  App_ClearCache = 'app:clear-cache',
  App_SetLaunchOnBoot = 'app:set-launch-on-boot',
  App_SetLanguage = 'app:set-language',
  App_SetEnableSpellCheck = 'app:set-enable-spell-check',
  App_SetSpellCheckLanguages = 'app:set-spell-check-languages',
  App_ShowUpdateDialog = 'app:show-update-dialog',
  App_CheckForUpdate = 'app:check-for-update',
  App_Reload = 'app:reload',
  App_Info = 'app:info',
  App_Proxy = 'app:proxy',
  App_SetLaunchToTray = 'app:set-launch-to-tray',
  App_SetTray = 'app:set-tray',
  App_SetTrayOnClose = 'app:set-tray-on-close',
  App_SetTheme = 'app:set-theme',
  App_SetAutoUpdate = 'app:set-auto-update',
  App_SetTestPlan = 'app:set-test-plan',
  App_SetTestChannel = 'app:set-test-channel',
  App_HandleZoomFactor = 'app:handle-zoom-factor',
  App_Select = 'app:select',
  App_HasWritePermission = 'app:has-write-permission',
  App_ResolvePath = 'app:resolve-path',
  App_IsPathInside = 'app:is-path-inside',
  App_Copy = 'app:copy',
  App_SetStopQuitApp = 'app:set-stop-quit-app',
  App_SetAppDataPath = 'app:set-app-data-path',
  App_GetDataPathFromArgs = 'app:get-data-path-from-args',
  App_FlushAppData = 'app:flush-app-data',
  App_IsNotEmptyDir = 'app:is-not-empty-dir',
  App_RelaunchApp = 'app:relaunch-app',
  App_IsBinaryExist = 'app:is-binary-exist',
  App_GetBinaryPath = 'app:get-binary-path',
  App_InstallUvBinary = 'app:install-uv-binary',
  App_InstallBunBinary = 'app:install-bun-binary',
  App_LogToMain = 'app:log-to-main',
  App_SaveData = 'app:save-data',

  App_MacIsProcessTrusted = 'app:mac-is-process-trusted',
  App_MacRequestProcessTrust = 'app:mac-request-process-trust',

  App_QuoteToMain = 'app:quote-to-main',
  App_SetDisableHardwareAcceleration = 'app:set-disable-hardware-acceleration',

  Notification_Send = 'notification:send',
  Notification_OnClick = 'notification:on-click',

  Webview_SetOpenLinkExternal = 'webview:set-open-link-external',
  Webview_SetSpellCheckEnabled = 'webview:set-spell-check-enabled',

  // Open
  Open_Path = 'open:path',
  Open_Website = 'open:website',

  Minapp = 'minapp',

  Config_Set = 'config:set',
  Config_Get = 'config:get',

  MiniWindow_Show = 'miniwindow:show',
  MiniWindow_Hide = 'miniwindow:hide',
  MiniWindow_Close = 'miniwindow:close',
  MiniWindow_Toggle = 'miniwindow:toggle',
  MiniWindow_SetPin = 'miniwindow:set-pin',

  // Mcp
  Mcp_AddServer = 'mcp:add-server',
  Mcp_RemoveServer = 'mcp:remove-server',
  Mcp_RestartServer = 'mcp:restart-server',
  Mcp_StopServer = 'mcp:stop-server',
  Mcp_ListTools = 'mcp:list-tools',
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
  Mcp_AbortTool = 'mcp:abort-tool',
  Mcp_GetServerVersion = 'mcp:get-server-version',

  // Python
  Python_Execute = 'python:execute',

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

  Windows_ResetMinimumSize = 'window:reset-minimum-size',
  Windows_SetMinimumSize = 'window:set-minimum-size',

  KnowledgeBase_Create = 'knowledge-base:create',
  KnowledgeBase_Reset = 'knowledge-base:reset',
  KnowledgeBase_Delete = 'knowledge-base:delete',
  KnowledgeBase_Add = 'knowledge-base:add',
  KnowledgeBase_Remove = 'knowledge-base:remove',
  KnowledgeBase_Search = 'knowledge-base:search',
  KnowledgeBase_Rerank = 'knowledge-base:rerank',
  KnowledgeBase_Check_Quota = 'knowledge-base:check-quota',

  //file
  File_Open = 'file:open',
  File_OpenPath = 'file:openPath',
  File_Save = 'file:save',
  File_Select = 'file:select',
  File_Upload = 'file:upload',
  File_Clear = 'file:clear',
  File_Read = 'file:read',
  File_Delete = 'file:delete',
  File_DeleteDir = 'file:deleteDir',
  File_Get = 'file:get',
  File_SelectFolder = 'file:selectFolder',
  File_CreateTempFile = 'file:createTempFile',
  File_Write = 'file:write',
  File_WriteWithId = 'file:writeWithId',
  File_SaveImage = 'file:saveImage',
  File_Base64Image = 'file:base64Image',
  File_SaveBase64Image = 'file:saveBase64Image',
  File_Download = 'file:download',
  File_Copy = 'file:copy',
  File_BinaryImage = 'file:binaryImage',
  File_Base64File = 'file:base64File',
  File_GetPdfInfo = 'file:getPdfInfo',
  Fs_Read = 'fs:read',
  File_OpenWithRelativePath = 'file:openWithRelativePath',

  // file service
  FileService_Upload = 'file-service:upload',
  FileService_List = 'file-service:list',
  FileService_Delete = 'file-service:delete',
  FileService_Retrieve = 'file-service:retrieve',

  Export_Word = 'export:word',

  Shortcuts_Update = 'shortcuts:update',

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

  // zip
  Zip_Compress = 'zip:compress',
  Zip_Decompress = 'zip:decompress',

  // system
  System_GetDeviceType = 'system:getDeviceType',
  System_GetHostname = 'system:getHostname',

  // DevTools
  System_ToggleDevTools = 'system:toggleDevTools',

  // events
  BackupProgress = 'backup-progress',
  ThemeUpdated = 'theme:updated',
  UpdateDownloadedCancelled = 'update-downloaded-cancelled',
  RestoreProgress = 'restore-progress',
  UpdateError = 'update-error',
  UpdateAvailable = 'update-available',
  UpdateNotAvailable = 'update-not-available',
  DownloadProgress = 'download-progress',
  UpdateDownloaded = 'update-downloaded',
  DownloadUpdate = 'download-update',

  DirectoryProcessingPercent = 'directory-processing-percent',

  FullscreenStatusChanged = 'fullscreen-status-changed',

  HideMiniWindow = 'hide-mini-window',
  ShowMiniWindow = 'show-mini-window',

  ReduxStateChange = 'redux-state-change',
  ReduxStoreReady = 'redux-store-ready',

  // Search Window
  SearchWindow_Open = 'search-window:open',
  SearchWindow_Close = 'search-window:close',
  SearchWindow_OpenUrl = 'search-window:open-url',

  //Store Sync
  StoreSync_Subscribe = 'store-sync:subscribe',
  StoreSync_Unsubscribe = 'store-sync:unsubscribe',
  StoreSync_OnUpdate = 'store-sync:on-update',
  StoreSync_BroadcastSync = 'store-sync:broadcast-sync',

  // Provider
  Provider_AddKey = 'provider:add-key',

  //Selection Assistant
  Selection_TextSelected = 'selection:text-selected',
  Selection_ToolbarHide = 'selection:toolbar-hide',
  Selection_ToolbarVisibilityChange = 'selection:toolbar-visibility-change',
  Selection_ToolbarDetermineSize = 'selection:toolbar-determine-size',
  Selection_WriteToClipboard = 'selection:write-to-clipboard',
  Selection_SetEnabled = 'selection:set-enabled',
  Selection_SetTriggerMode = 'selection:set-trigger-mode',
  Selection_SetFilterMode = 'selection:set-filter-mode',
  Selection_SetFilterList = 'selection:set-filter-list',
  Selection_SetFollowToolbar = 'selection:set-follow-toolbar',
  Selection_SetRemeberWinSize = 'selection:set-remeber-win-size',
  Selection_ActionWindowClose = 'selection:action-window-close',
  Selection_ActionWindowMinimize = 'selection:action-window-minimize',
  Selection_ActionWindowPin = 'selection:action-window-pin',
  Selection_ProcessAction = 'selection:process-action',
  Selection_UpdateActionData = 'selection:update-action-data',

  // Memory
  Memory_Add = 'memory:add',
  Memory_Search = 'memory:search',
  Memory_List = 'memory:list',
  Memory_Delete = 'memory:delete',
  Memory_Update = 'memory:update',
  Memory_Get = 'memory:get',
  Memory_SetConfig = 'memory:set-config',
  Memory_DeleteUser = 'memory:delete-user',
  Memory_DeleteAllMemoriesForUser = 'memory:delete-all-memories-for-user',
  Memory_GetUsersList = 'memory:get-users-list',

  // TRACE
  TRACE_SAVE_DATA = 'trace:saveData',
  TRACE_GET_DATA = 'trace:getData',
  TRACE_SAVE_ENTITY = 'trace:saveEntity',
  TRACE_GET_ENTITY = 'trace:getEntity',
  TRACE_BIND_TOPIC = 'trace:bindTopic',
  TRACE_CLEAN_TOPIC = 'trace:cleanTopic',
  TRACE_TOKEN_USAGE = 'trace:tokenUsage',
  TRACE_CLEAN_HISTORY = 'trace:cleanHistory',
  TRACE_OPEN_WINDOW = 'trace:openWindow',
  TRACE_SET_TITLE = 'trace:setTitle',
  TRACE_ADD_END_MESSAGE = 'trace:addEndMessage',
  TRACE_CLEAN_LOCAL_DATA = 'trace:cleanLocalData',
  TRACE_ADD_STREAM_MESSAGE = 'trace:addStreamMessage',

  // CodeTools
  CodeTools_Run = 'code-tools:run'
}
