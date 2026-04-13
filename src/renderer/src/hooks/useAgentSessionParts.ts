/**
 * Agent session history data source — returns ChatHistory shape for useChatWithHistory.
 *
 * Reads from agents DB (session_messages table) via AgentMessage_GetHistory IPC.
 * After the blocks→parts data migration, message.data.parts contains CherryMessagePart[].
 */

import { loggerService } from '@logger'
import type { Message } from '@renderer/types/newMessage'
import { AssistantMessageStatus, UserMessageStatus } from '@renderer/types/newMessage'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { IpcChannel } from '@shared/IpcChannel'
import { useCallback, useEffect, useState } from 'react'

import type { ChatHistory } from './useChatWithHistory'

const logger = loggerService.withContext('useAgentSessionParts')

interface AgentPersistedMessage {
  message: {
    id: string
    role: string
    data?: { parts?: CherryMessagePart[] }
    createdAt?: string
    status?: string
    [key: string]: unknown
  }
  blocks: unknown[]
}

export function useAgentSessionParts(sessionId: string, agentId: string): ChatHistory {
  const [messages, setMessages] = useState<Message[]>([])
  const [partsMap, setPartsMap] = useState<Record<string, CherryMessagePart[]>>({})
  const [isLoading, setIsLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const history: AgentPersistedMessage[] = await window.electron.ipcRenderer.invoke(
        IpcChannel.AgentMessage_GetHistory,
        { sessionId }
      )

      if (!Array.isArray(history)) {
        setMessages([])
        setPartsMap({})
        return []
      }

      const adapted: Message[] = []
      const parts: Record<string, CherryMessagePart[]> = {}

      for (const item of history) {
        const msg = item.message
        if (!msg?.id) continue

        adapted.push({
          id: msg.id,
          role: msg.role as Message['role'],
          assistantId: agentId,
          topicId: `agent-session:${sessionId}`,
          createdAt: msg.createdAt ?? new Date().toISOString(),
          status: msg.role === 'user' ? UserMessageStatus.SUCCESS : AssistantMessageStatus.SUCCESS,
          blocks: []
        })

        // After blocks→parts migration, data.parts is populated
        if (msg.data?.parts && msg.data.parts.length > 0) {
          parts[msg.id] = msg.data.parts
        }
      }

      setMessages(adapted)
      setPartsMap(parts)
      return adapted.map((m) => ({ id: m.id, role: m.role, parts: parts[m.id] ?? [] }) as unknown as CherryUIMessage)
    } catch (err) {
      logger.error('Failed to load agent session messages', { sessionId, err })
      return []
    } finally {
      setIsLoading(false)
    }
  }, [sessionId, agentId])

  useEffect(() => {
    setIsLoading(true)
    void load()
  }, [load])

  const refresh = useCallback(async () => {
    return (await load()) ?? []
  }, [load])

  return {
    messages,
    partsMap,
    isLoading,
    refresh,
    activeNodeId: messages.length > 0 ? messages[messages.length - 1].id : null
  }
}
