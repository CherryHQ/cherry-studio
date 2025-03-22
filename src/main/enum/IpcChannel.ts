export enum IpcChannel {
  // 'app:clear-cache'
  App_ClearCache = 'app:clear-cache',
  App_SetLaunchOnBoot = 'app:set-launch-on-boot',
  App_SetLanguage = 'app:set-language',
  App_ShowUpdateDialog = 'app:show-update-dialog',
  App_CheckForUpdate = 'app:check-for-update',
  App_Reload = 'app:reload',
  App_Info = 'app:info',
  App_Proxy = 'app:proxy',
  App_SetLaunchToTray = 'app:set-launch-to-tray',
  App_SetTray = 'app:set-tray',
  App_SetTrayOnClose = 'app:set-tray-on-close',
  App_RestartTray = 'app:restart-tray',
  App_SetTheme = 'app:set-theme',

  App_IsBinaryExist = 'app:is-binary-exist',
  App_GetBinaryPath = 'app:get-binary-path',
  App_InstallUvBinary = 'app:install-uv-binary',
  App_InstallBunBinary = 'app:install-bun-binary',

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

  // Mcp
  Mcp_ServersFromRenderer = 'mcp:servers-from-renderer',
  Mcp_ListServers = 'mcp:list-servers',
  Mcp_AddServer = 'mcp:add-server',
  Mcp_UpdateServer = 'mcp:update-server',
  Mcp_DeleteServer = 'mcp:delete-server',
  Mcp_SetServerActive = 'mcp:set-server-active',
  Mcp_Cleanup = 'mcp:cleanup',
  Mcp_ListTools = 'mcp:list-tools',
  Mcp_CallTool = 'mcp:call-tool',
  Mcp_ServersChanged = 'mcp:servers-changed',
  Mcp_ServersUpdated = 'mcp:servers-updated',

  //copilot
  Copilot_GetAuthMessage = 'copilot:get-auth-message',
  Copilot_GetCopilotToken = 'copilot:get-copilot-token',
  Copilot_SaveCopilotToken = 'copilot:save-copilot-token',
  Copilot_GetToken = 'copilot:get-token',
  Copilot_Logout = 'copilot:logout',
  Copilot_GetUser = 'copilot:get-user',

  //aes
  Aes_Encrypt = 'aes:encrypt',
  Aes_Decrypt = 'aes:decrypt',

  Gemini_UploadFile = 'gemini:upload-file',
  Gemini_Base64File = 'gemini:base64-file',
  Gemini_RetrieveFile = 'gemini:retrieve-file',
  Gemini_ListFiles = 'gemini:list-files',
  Gemini_DeleteFile = 'gemini:delete-file',

  Windows_ResetMinimumSize = 'window:reset-minimum-size',
  Windows_SetMinimumSize = 'window:set-minimum-size',

  SelectionMenu_Action = 'selection-menu:action',

  KnowledgeBase_Create = 'knowledge-base:create',
  KnowledgeBase_Reset = 'knowledge-base:reset',
  KnowledgeBase_Delete = 'knowledge-base:delete',
  KnowledgeBase_Add = 'knowledge-base:add',
  KnowledgeBase_Remove = 'knowledge-base:remove',
  KnowledgeBase_Search = 'knowledge-base:search',
  KnowledgeBase_Rerank = 'knowledge-base:rerank',

  //file
  File_Open = 'file:open',
  File_OpenPath = 'file:openPath',
  File_Save = 'file:save',
  File_Select = 'file:select',
  File_Upload = 'file:upload',
  File_Clear = 'file:clear',
  File_Read = 'file:read',
  File_Delete = 'file:delete',
  File_Get = 'file:get',
  File_SelectFolder = 'file:selectFolder',
  File_Create = 'file:create',
  File_Write = 'file:write',
  File_SaveImage = 'file:saveImage',
  File_Base64Image = 'file:base64Image',
  File_Download = 'file:download',
  File_Copy = 'file:copy',
  File_BinaryFile = 'file:binaryFile',

  Fs_Read = 'fs:read',

  Export_Word = 'export:word',

  Shortcuts_Update = 'shortcuts:update',

  // backup
  Backup_Backup = 'backup:backup',
  Backup_Restore = 'backup:restore',
  Backup_BackupToWebdav = 'backup:backupToWebdav',
  Backup_RestoreFromWebdav = 'backup:restoreFromWebdav',
  Backup_ListWebdavFiles = 'backup:listWebdavFiles',

  // zip
  Zip_Compress = 'zip:compress',
  Zip_Decompress = 'zip:decompress',

  // system
  System_GetDeviceType = 'system:getDeviceType'
}
