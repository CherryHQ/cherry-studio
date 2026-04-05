import type { BrowserWindow } from 'electron'

import { registerAgentsIpc } from './agents'
import { registerAppIpc } from './app'
import { registerAuthIpc } from './auth'
import { registerBackupIpc } from './backup'
import { registerFileIpc } from './file'
import { registerFileUtilsIpc } from './fileUtils'
import { registerIntegrationsIpc } from './integrations'
import { registerKnowledgeIpc } from './knowledge'
import { registerNotificationIpc } from './notification'
import { registerSystemIpc } from './system'
import { registerUtilityIpc } from './utility'

export async function registerIpc(mainWindow: BrowserWindow, app: Electron.App) {
  registerAppIpc(mainWindow, app)
  registerSystemIpc()
  registerFileIpc()
  registerFileUtilsIpc()
  registerBackupIpc()
  registerKnowledgeIpc()
  registerAuthIpc()
  registerAgentsIpc()
  registerIntegrationsIpc()
  registerNotificationIpc(mainWindow)
  registerUtilityIpc()
}
