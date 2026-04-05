import { loggerService } from '@logger'
import { IpcChannel } from '@shared/IpcChannel'
import type { AgentPersistedMessage } from '@types'
import { ipcMain } from 'electron'

import { agentMessageRepository } from '../services/agents/database'
import { skillService } from '../services/agents/skills/SkillService'
import DxtService from '../services/DxtService'
import { fileStorage as fileManager } from '../services/FileStorage'

const logger = loggerService.withContext('IPC:Agents')
const dxtService = new DxtService()

export function registerAgentsIpc() {
  ipcMain.handle(IpcChannel.AgentMessage_PersistExchange, async (_event, payload) => {
    try {
      return await agentMessageRepository.persistExchange(payload)
    } catch (error) {
      logger.error('Failed to persist agent session messages', error as Error)
      throw error
    }
  })

  ipcMain.handle(
    IpcChannel.AgentMessage_GetHistory,
    async (_event, { sessionId }: { sessionId: string }): Promise<AgentPersistedMessage[]> => {
      try {
        return await agentMessageRepository.getSessionHistory(sessionId)
      } catch (error) {
        logger.error('Failed to get agent session history', error as Error)
        throw error
      }
    }
  )

  // Channel logs & status
  ipcMain.handle(IpcChannel.Channel_GetLogs, async (_event, channelId: string) => {
    const { channelManager } = await import('@main/services/agents/services/channels/ChannelManager')
    return channelManager.getChannelLogs(channelId)
  })

  ipcMain.handle(IpcChannel.Channel_GetStatuses, async () => {
    const { channelManager } = await import('@main/services/agents/services/channels/ChannelManager')
    return channelManager.getAllStatuses()
  })

  // DXT upload handler
  ipcMain.handle(IpcChannel.Mcp_UploadDxt, async (event, fileBuffer: ArrayBuffer, fileName: string) => {
    try {
      // Create a temporary file with the uploaded content
      const tempPath = await fileManager.createTempFile(event, fileName)
      await fileManager.writeFile(event, tempPath, Buffer.from(fileBuffer))

      // Process DXT file using the temporary path
      return await dxtService.uploadDxt(event, tempPath)
    } catch (error) {
      logger.error('DXT upload error:', error as Error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to upload DXT file'
      }
    }
  })

  // Global Skills
  ipcMain.handle(IpcChannel.Skill_List, async () => {
    try {
      const data = await skillService.list()
      return { success: true, data }
    } catch (error) {
      logger.error('Failed to list skills', { error })
      return { success: false, error }
    }
  })

  ipcMain.handle(IpcChannel.Skill_Install, async (_, options) => {
    try {
      const data = await skillService.install(options)
      return { success: true, data }
    } catch (error) {
      logger.error('Failed to install skill', { options, error })
      return { success: false, error }
    }
  })

  ipcMain.handle(IpcChannel.Skill_Uninstall, async (_, skillId: string) => {
    try {
      await skillService.uninstall(skillId)
      return { success: true, data: undefined }
    } catch (error) {
      logger.error('Failed to uninstall skill', { skillId, error })
      return { success: false, error }
    }
  })

  ipcMain.handle(IpcChannel.Skill_Toggle, async (_, options) => {
    try {
      const data = await skillService.toggle(options)
      return { success: true, data }
    } catch (error) {
      logger.error('Failed to toggle skill', { options, error })
      return { success: false, error }
    }
  })

  ipcMain.handle(IpcChannel.Skill_InstallFromZip, async (_, options) => {
    try {
      const data = await skillService.installFromZip(options)
      return { success: true, data }
    } catch (error) {
      logger.error('Failed to install skill from ZIP', { options, error })
      return { success: false, error }
    }
  })

  ipcMain.handle(IpcChannel.Skill_InstallFromDirectory, async (_, options) => {
    try {
      const data = await skillService.installFromDirectory(options)
      return { success: true, data }
    } catch (error) {
      logger.error('Failed to install skill from directory', { options, error })
      return { success: false, error }
    }
  })

  ipcMain.handle(IpcChannel.Skill_ReadFile, async (_, skillId: string, filename: string) => {
    try {
      const data = await skillService.readFile(skillId, filename)
      return { success: true, data }
    } catch (error) {
      logger.error('Failed to read skill file', { skillId, filename, error })
      return { success: false, error }
    }
  })

  ipcMain.handle(IpcChannel.Skill_ListFiles, async (_, skillId: string) => {
    try {
      const data = await skillService.listFiles(skillId)
      return { success: true, data }
    } catch (error) {
      logger.error('Failed to list skill files', { skillId, error })
      return { success: false, error }
    }
  })

  ipcMain.handle(IpcChannel.Skill_ListLocal, async (_, workdir: string) => {
    try {
      const data = await skillService.listLocal(workdir)
      return { success: true, data }
    } catch (error) {
      logger.error('Failed to list local plugins', { workdir, error })
      return { success: false, error }
    }
  })
}
