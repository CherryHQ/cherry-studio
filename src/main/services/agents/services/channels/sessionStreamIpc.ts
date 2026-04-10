import { IpcChannel } from '@shared/IpcChannel'
import { ipcMain } from 'electron'

import { windowService } from '../../../WindowService'
import { channelMessageHandler } from './ChannelMessageHandler'
import { sessionStreamBus, type SessionStreamChunk } from './SessionStreamBus'

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
}

export function broadcastSessionChanged(agentId: string, sessionId: string, headless?: boolean): void {
  const mainWindow = windowService.getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IpcChannel.AgentSession_Changed, { agentId, sessionId, headless: !!headless })
  }
}
