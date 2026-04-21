import { loggerService } from '@logger'
import {
  sideQuestionDb,
  type SideQuestionMessage as DbMessage,
  type SideQuestionThread
} from '@renderer/databases/sideQuestions'
import { fetchChatCompletion } from '@renderer/services/ApiService'
import { getDefaultAssistant, getDefaultModel } from '@renderer/services/AssistantService'
import type { Model } from '@renderer/types'
import { ChunkType } from '@renderer/types/chunk'
import type { Message } from '@renderer/types/newMessage'
import { uuid } from '@renderer/utils'
import { abortCompletion, readyToAbort } from '@renderer/utils/abortController'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import { cloneDeep } from 'lodash'
import { useCallback, useEffect, useRef, useState } from 'react'

const logger = loggerService.withContext('SideQuestion')

export interface SideQuestionMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  status: 'completed' | 'streaming' | 'error'
}

// In-memory cache: sourceMessageId -> messages[]
const cache = new Map<string, SideQuestionMessage[]>()
// Track which sourceMessageIds have threads and their user question counts
const threadCountCache = new Map<string, number>()
let threadCountCacheLoaded = false

function toUiMessage(dbMsg: DbMessage): SideQuestionMessage {
  return {
    id: dbMsg.id,
    role: dbMsg.role,
    content: dbMsg.content,
    status: dbMsg.status
  }
}

// Load thread existence and user question counts from DB (called once)
async function ensureThreadCountCache() {
  if (threadCountCacheLoaded) return
  try {
    const threads = await sideQuestionDb.threads.toArray()
    for (const t of threads) {
      const userMsgCount = await sideQuestionDb.messages
        .where('threadId')
        .equals(t.id)
        .filter((m) => m.role === 'user')
        .count()
      threadCountCache.set(t.sourceMessageId, userMsgCount)
    }
    threadCountCacheLoaded = true
  } catch (error) {
    logger.error('Failed to load thread cache', error instanceof Error ? error : new Error(String(error)))
  }
}

// Initialize cache on module load
void ensureThreadCountCache()

export function getThreadMessages(sourceMessageId: string): SideQuestionMessage[] {
  return cache.get(sourceMessageId) ?? []
}

export function hasThread(sourceMessageId: string): boolean {
  return threadCountCache.has(sourceMessageId)
}

export function getThreadQuestionCount(sourceMessageId: string): number {
  return threadCountCache.get(sourceMessageId) ?? 0
}

// Load messages from DB into cache
async function loadThreadFromDb(sourceMessageId: string): Promise<SideQuestionMessage[]> {
  try {
    const thread = await sideQuestionDb.threads.where('sourceMessageId').equals(sourceMessageId).first()
    if (!thread) return []

    const dbMessages = await sideQuestionDb.messages.where('threadId').equals(thread.id).sortBy('createdAt')
    const uiMessages = dbMessages.map(toUiMessage)
    cache.set(sourceMessageId, uiMessages)
    threadCountCache.set(sourceMessageId, uiMessages.filter((m) => m.role === 'user').length)
    return uiMessages
  } catch (error) {
    logger.error('Failed to load thread from DB', error instanceof Error ? error : new Error(String(error)))
    return cache.get(sourceMessageId) ?? []
  }
}

// Ensure a thread record exists in DB, return thread ID
async function ensureThread(sourceMessageId: string, topicId: string): Promise<string> {
  const existing = await sideQuestionDb.threads.where('sourceMessageId').equals(sourceMessageId).first()
  if (existing) {
    await sideQuestionDb.threads.update(existing.id, { updatedAt: Date.now() })
    return existing.id
  }
  const thread: SideQuestionThread = {
    id: uuid(),
    sourceMessageId,
    topicId,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  await sideQuestionDb.threads.add(thread)
  threadCountCache.set(sourceMessageId, 0)
  return thread.id
}

// Save a message to DB
async function saveMessageToDb(threadId: string, msg: SideQuestionMessage) {
  const dbMsg: DbMessage = {
    id: msg.id,
    threadId,
    role: msg.role,
    content: msg.content,
    status: msg.status,
    createdAt: Date.now()
  }
  await sideQuestionDb.messages.put(dbMsg)
}

export function useSideQuestion(sourceMessage: Message | null, model?: Model) {
  const [messages, setMessages] = useState<SideQuestionMessage[]>(() =>
    sourceMessage ? getThreadMessages(sourceMessage.id) : []
  )
  const [isLoading, setIsLoading] = useState(false)
  const abortKeyRef = useRef<string>('')
  const threadIdRef = useRef<string>('')

  // Load from DB when sourceMessage changes
  const syncMessages = useCallback(
    (msgId: string) => {
      const cached = cache.get(msgId)
      if (cached) {
        setMessages(cached)
        return
      }
      void loadThreadFromDb(msgId).then((msgs) => {
        setMessages(msgs)
      })
    },
    [setMessages]
  )

  // Preload thread ID
  useEffect(() => {
    if (!sourceMessage) return
    void (async () => {
      const thread = await sideQuestionDb.threads.where('sourceMessageId').equals(sourceMessage.id).first()
      if (thread) {
        threadIdRef.current = thread.id
      }
    })()
  }, [sourceMessage])

  const buildPrompt = useCallback(
    (userQuestion: string): string => {
      if (!sourceMessage) return userQuestion

      const contextText = getMainTextContent(sourceMessage)
      const history = getThreadMessages(sourceMessage.id)

      let prompt = `You are answering a side question about the following message:\n\n---\n${contextText}\n---\n\n`

      if (history.length > 0) {
        prompt += 'Previous conversation:\n'
        for (const msg of history) {
          const role = msg.role === 'user' ? 'User' : 'Assistant'
          prompt += `${role}: ${msg.content}\n`
        }
        prompt += '\n'
      }

      prompt += `User: ${userQuestion}`
      return prompt
    },
    [sourceMessage]
  )

  const sendQuestion = useCallback(
    async (userQuestion: string) => {
      if (!sourceMessage || !userQuestion.trim()) return

      const msgId = sourceMessage.id
      const topicId = sourceMessage.topicId

      // Ensure thread exists in DB
      const threadId = await ensureThread(msgId, topicId)
      threadIdRef.current = threadId

      // Add user message
      const userMsg: SideQuestionMessage = {
        id: uuid(),
        role: 'user',
        content: userQuestion.trim(),
        status: 'completed'
      }

      const currentMessages = getThreadMessages(msgId)
      const updatedWithUser = [...currentMessages, userMsg]
      cache.set(msgId, updatedWithUser)
      threadCountCache.set(msgId, updatedWithUser.filter((m) => m.role === 'user').length)
      setMessages([...updatedWithUser])

      // Save user message to DB
      void saveMessageToDb(threadId, userMsg)

      // Prepare assistant message
      const assistantMsg: SideQuestionMessage = {
        id: uuid(),
        role: 'assistant',
        content: '',
        status: 'streaming'
      }

      const updatedWithAssistant = [...updatedWithUser, assistantMsg]
      cache.set(msgId, updatedWithAssistant)
      setMessages([...updatedWithAssistant])

      setIsLoading(true)
      const abortKey = uuid()
      abortKeyRef.current = abortKey

      try {
        const resolvedModel = model ?? getDefaultModel()
        if (!resolvedModel) {
          throw new Error('No model configured')
        }

        const assistant = cloneDeep(getDefaultAssistant())
        assistant.model = resolvedModel
        if (!assistant.settings) {
          assistant.settings = {}
        }
        assistant.settings.streamOutput = true
        assistant.webSearchProviderId = undefined
        assistant.mcpServers = undefined
        assistant.knowledge_bases = undefined

        const prompt = buildPrompt(userQuestion)
        const signal = readyToAbort(abortKey)

        let accumulatedText = ''

        await fetchChatCompletion({
          prompt,
          assistant,
          requestOptions: { signal },
          onChunkReceived: (chunk) => {
            switch (chunk.type) {
              case ChunkType.TEXT_DELTA: {
                accumulatedText = chunk.text ?? accumulatedText
                const updated = getThreadMessages(msgId).map((m) =>
                  m.id === assistantMsg.id ? { ...m, content: accumulatedText } : m
                )
                cache.set(msgId, updated)
                setMessages([...updated])
                break
              }
              case ChunkType.TEXT_COMPLETE: {
                const updated = getThreadMessages(msgId).map((m) =>
                  m.id === assistantMsg.id ? { ...m, content: accumulatedText, status: 'completed' as const } : m
                )
                cache.set(msgId, updated)
                setMessages([...updated])
                // Save completed assistant message to DB
                void saveMessageToDb(threadId, {
                  ...assistantMsg,
                  content: accumulatedText,
                  status: 'completed'
                })
                break
              }
              case ChunkType.ERROR: {
                logger.error('Side question error', chunk.error)
                const updated = getThreadMessages(msgId).map((m) =>
                  m.id === assistantMsg.id
                    ? { ...m, content: accumulatedText || 'Error occurred', status: 'error' as const }
                    : m
                )
                cache.set(msgId, updated)
                setMessages([...updated])
                // Save error message to DB
                void saveMessageToDb(threadId, {
                  ...assistantMsg,
                  content: accumulatedText || 'Error occurred',
                  status: 'error'
                })
                break
              }
            }
          }
        })
      } catch (error) {
        logger.error('Side question request failed', error instanceof Error ? error : new Error(String(error)))
        const updated = getThreadMessages(msgId).map((m) =>
          m.id === assistantMsg.id ? { ...m, content: String(error), status: 'error' as const } : m
        )
        cache.set(msgId, updated)
        setMessages([...updated])
        void saveMessageToDb(threadId, {
          ...assistantMsg,
          content: String(error),
          status: 'error'
        })
      } finally {
        setIsLoading(false)
        abortKeyRef.current = ''
      }
    },
    [sourceMessage, buildPrompt, model]
  )

  const stopGeneration = useCallback(() => {
    if (abortKeyRef.current) {
      abortCompletion(abortKeyRef.current)
      setIsLoading(false)
    }
  }, [])

  return {
    messages,
    isLoading,
    sendQuestion,
    stopGeneration,
    syncMessages
  }
}
