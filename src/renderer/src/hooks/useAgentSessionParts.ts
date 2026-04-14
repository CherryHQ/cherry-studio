/**
 * Agent session history data source — returns CherryUIMessage[] for useChatWithHistory.
 *
 * Reads from agents DB (session_messages table) via AgentMessage_GetHistory IPC.
 * After the blocks→parts data migration, message.data.parts contains CherryMessagePart[].
 */

import { loggerService } from '@logger'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { IpcChannel } from '@shared/IpcChannel'
import { useCallback, useEffect, useState } from 'react'

const logger = loggerService.withContext('useAgentSessionParts')

interface AgentPersistedMessage {
  message: {
    id: string
    role: string
    data?: { parts?: CherryMessagePart[] }
    createdAt?: string
    [key: string]: unknown
  }
  blocks: unknown[]
}

// TODO: migrate to dataApi when agent.db
export function useAgentSessionParts(sessionId: string) {
  const [messages, setMessages] = useState<CherryUIMessage[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const load = useCallback(async (): Promise<CherryUIMessage[]> => {
    try {
      const history: AgentPersistedMessage[] = await window.electron.ipcRenderer.invoke(
        IpcChannel.AgentMessage_GetHistory,
        { sessionId }
      )

      if (!Array.isArray(history)) {
        setMessages([])
        return []
      }

      const uiMessages: CherryUIMessage[] = []
      for (const item of history) {
        const msg = item.message
        if (!msg?.id) continue
        uiMessages.push({
          id: msg.id,
          role: msg.role as CherryUIMessage['role'],
          parts: (msg.data?.parts ?? []) as CherryUIMessage['parts']
        })
      }

      setMessages(uiMessages)
      return uiMessages
    } catch (err) {
      logger.error('Failed to load agent session messages', { sessionId, err })
      return []
    } finally {
      setIsLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    setIsLoading(true)
    void load()
  }, [load])

  const refresh = useCallback(async () => {
    return (await load()) ?? []
  }, [load])

  return { messages, isLoading, refresh }
}
