import fs from 'node:fs'
import path from 'node:path'

import { isWin } from '@main/constant'
import { generateSignature } from '@main/integration/cherryai'
import { IpcChannel } from '@shared/IpcChannel'
import { ipcMain } from 'electron'

import { externalAppsService } from '../services/ExternalAppsService'
import * as NutstoreService from '../services/NutstoreService'
import ObsidianVaultService from '../services/ObsidianVaultService'
import { getDataPath } from '../utils'
import { getCpuName } from '../utils/system'

const obsidianVaultService = new ObsidianVaultService()

export function registerIntegrationsIpc() {
  // Obsidian service
  ipcMain.handle(IpcChannel.Obsidian_GetVaults, () => {
    return obsidianVaultService.getVaults()
  })

  ipcMain.handle(IpcChannel.Obsidian_GetFiles, (_event, vaultName) => {
    return obsidianVaultService.getFilesByVaultName(vaultName)
  })

  // nutstore
  ipcMain.handle(IpcChannel.Nutstore_GetSsoUrl, NutstoreService.getNutstoreSSOUrl.bind(NutstoreService))
  ipcMain.handle(IpcChannel.Nutstore_DecryptToken, (_, token: string) => NutstoreService.decryptToken(token))
  ipcMain.handle(IpcChannel.Nutstore_GetDirectoryContents, (_, token: string, path: string) =>
    NutstoreService.getDirectoryContents(token, path)
  )

  // ExternalApps
  ipcMain.handle(IpcChannel.ExternalApps_DetectInstalled, () => externalAppsService.detectInstalledApps())

  // OVMS — operation handlers registered by OvmsManager.onInit() (activated only on Win+Intel)
  // Condition logic must stay in sync with OvmsManager's @Conditional(onPlatform('win32'), onCpuVendor('intel'))
  ipcMain.handle(IpcChannel.Ovms_IsSupported, () => isWin && getCpuName().toLowerCase().includes('intel'))

  // CherryAI
  ipcMain.handle(IpcChannel.Cherryai_GetSignature, (_, params) => generateSignature(params))

  // WeChat
  ipcMain.handle(IpcChannel.WeChat_HasCredentials, async (_, channelId: string) => {
    const tokenPath = path.join(getDataPath('Channels'), `weixin_bot_${channelId}.json`)
    try {
      const raw = await fs.promises.readFile(tokenPath, 'utf8')
      const parsed = JSON.parse(raw)
      return { exists: true, userId: parsed.userId as string | undefined }
    } catch {
      return { exists: false }
    }
  })
}
