import { application } from '@application'
import { WindowType } from '@main/core/window/types'
import { IpcChannel } from '@shared/IpcChannel'
import { ipcMain } from 'electron'

import { channelMessageHandler } from './ChannelMessageHandler'
import { sessionStreamBus, type SessionStreamChunk } from './SessionStreamBus'

const activeSubscriptions = new Map<string, () => void>()

export function registerSessionStreamIpc(): void {
  ipcMain.handle(IpcChannel.AgentSessionStream_Subscribe, (_event, { sessionId }: { sessionId: string }) => {
    if (activeSubscriptions.has(sessionId)) return { success: true }

    const unsubscribe = sessionStreamBus.subscribe(sessionId, (chunk: SessionStreamChunk) => {
      application.get('WindowManager').broadcastToType(WindowType.Main, IpcChannel.AgentSessionStream_Chunk, chunk)
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
  application
    .get('WindowManager')
    .broadcastToType(WindowType.Main, IpcChannel.AgentSession_Changed, { agentId, sessionId, headless: !!headless })
}
