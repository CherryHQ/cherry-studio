import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk'
import { loggerService } from '@logger'
import { IpcChannel } from '@shared/IpcChannel'
import { ipcMain } from 'electron'

import { windowService } from '../../../WindowService'
import { setActiveSessionPermissionMode } from '../claudecode/active-queries'
import { channelMessageHandler } from './ChannelMessageHandler'
import { sessionStreamBus, type SessionStreamChunk } from './SessionStreamBus'

const logger = loggerService.withContext('SessionStreamIpc')

const activeSubscriptions = new Map<string, () => void>()

export function registerSessionStreamIpc(): void {
  ipcMain.handle(IpcChannel.AgentSessionStream_Subscribe, (_event, { sessionId }: { sessionId: string }) => {
    if (activeSubscriptions.has(sessionId)) return { success: true }

    const unsubscribe = sessionStreamBus.subscribe(sessionId, (chunk: SessionStreamChunk) => {
      const mainWindow = windowService.getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IpcChannel.AgentSessionStream_Chunk, chunk)
      }
    })

    activeSubscriptions.set(sessionId, unsubscribe)
    return { success: true }
  })

  ipcMain.handle(IpcChannel.AgentSessionStream_Unsubscribe, (_event, { sessionId }: { sessionId: string }) => {
    const unsub = activeSubscriptions.get(sessionId)
    if (unsub) {
      unsub()
      activeSubscriptions.delete(sessionId)
    }
    return { success: true }
  })

  ipcMain.handle(IpcChannel.AgentSessionStream_Abort, (_event, { sessionId }: { sessionId: string }) => {
    const aborted = channelMessageHandler.abortSession(sessionId)
    return { success: aborted }
  })

  ipcMain.handle(
    IpcChannel.AgentSessionStream_SetPermissionMode,
    async (_event, { sessionId, mode }: { sessionId: string; mode: PermissionMode }) => {
      try {
        const switched = await setActiveSessionPermissionMode(sessionId, mode)
        return { success: switched }
      } catch (error) {
        logger.warn('Failed to set permission mode on active query', {
          sessionId,
          mode,
          error: error instanceof Error ? error.message : String(error)
        })
        return { success: false }
      }
    }
  )
}

export function broadcastSessionChanged(agentId: string, sessionId: string, headless?: boolean): void {
  const mainWindow = windowService.getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IpcChannel.AgentSession_Changed, { agentId, sessionId, headless: !!headless })
  }
}
