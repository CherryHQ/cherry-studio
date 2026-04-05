import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge } from 'electron'

import { agentsApi } from './apis/agents'
import { appApi } from './apis/app'
import { authApi } from './apis/auth'
import { backupApi } from './apis/backup'
import { dataApi } from './apis/data'
import { fileApi } from './apis/file'
import { fileUtilsApi } from './apis/fileUtils'
import { integrationsApi } from './apis/integrations'
import { knowledgeApi } from './apis/knowledge'
import { notificationApi } from './apis/notification'
import { systemApi } from './apis/system'
import { utilityApi } from './apis/utility'
import { windowApi } from './apis/window'

export { tracedInvoke } from './apis/shared'

// Custom APIs for renderer
const api = {
  ...appApi,
  ...systemApi,
  ...fileApi,
  ...fileUtilsApi,
  ...backupApi,
  ...knowledgeApi,
  ...authApi,
  ...agentsApi,
  ...integrationsApi,
  ...notificationApi,
  ...utilityApi,
  ...windowApi,
  ...dataApi
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
