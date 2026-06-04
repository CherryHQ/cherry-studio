import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import type { AgentSessionEntity, WorkspaceMode } from '@shared/data/api/schemas/sessions'
import type { Topic } from '@shared/data/types/topic'
import { useCallback, useEffect, useRef, useState } from 'react'

const logger = loggerService.withContext('useTemporaryConversation')

export type TemporaryConversationType = 'assistant' | 'agent'
export type TemporaryConversationPhase = 'idle' | 'leased' | 'persisting' | 'persisted'

export type TemporaryConversationDefaults = {
  assistantId?: string | null
  agentId?: string | null
  workspaceId?: string
  workspaceMode?: WorkspaceMode
  name?: string
}

export type TemporaryConversation =
  | {
      type: 'assistant'
      id: string
      topicId: string
      assistantId?: string | null
      topic: Topic
    }
  | {
      type: 'agent'
      id: string
      sessionId: string
      topicId: string
      agentId: string
      name: string
      session: AgentSessionEntity
    }

export type UseTemporaryConversationOptions = TemporaryConversationDefaults & {
  type: TemporaryConversationType
}

export function useTemporaryConversation(options: UseTemporaryConversationOptions) {
  const defaultsRef = useRef(options)
  const activeRef = useRef<TemporaryConversation | null>(null)
  const createRequestIdRef = useRef(0)
  const mountedRef = useRef(true)
  const [conversation, setConversation] = useState<TemporaryConversation | null>(null)
  const [persistedConversation, setPersistedConversation] = useState<TemporaryConversation | null>(null)
  const [phase, setPhase] = useState<TemporaryConversationPhase>('idle')
  const [isPersisting, setIsPersisting] = useState(false)

  defaultsRef.current = options

  const release = useCallback(async (current: TemporaryConversation | null) => {
    if (!current) return
    try {
      if (current.type === 'assistant') {
        await dataApiService.delete(`/temporary/topics/${current.id}`)
        return
      }

      await dataApiService.delete(`/temporary/sessions/${current.id}`)
    } catch (err) {
      logger.warn('Failed to release temporary conversation', err as Error)
    }
  }, [])

  const create = useCallback(
    async (merged: UseTemporaryConversationOptions) => {
      if (!mountedRef.current) return null

      const requestId = ++createRequestIdRef.current
      let next: TemporaryConversation

      if (merged.type === 'assistant') {
        const topic = await dataApiService.post('/temporary/topics', {
          body: merged.assistantId !== undefined ? { assistantId: merged.assistantId } : {}
        })
        next = {
          type: 'assistant',
          id: topic.id,
          topicId: topic.id,
          assistantId: merged.assistantId,
          topic
        }
      } else {
        if (!merged.agentId) {
          throw new Error('agentId is required to start a temporary agent conversation')
        }

        const session = await dataApiService.post('/temporary/sessions', {
          body: {
            agentId: merged.agentId,
            name: merged.name,
            workspaceId: merged.workspaceId,
            workspaceMode: merged.workspaceMode
          }
        })
        next = {
          type: 'agent',
          id: session.id,
          sessionId: session.id,
          topicId: buildAgentSessionTopicId(session.id),
          agentId: session.agentId ?? merged.agentId,
          name: session.name,
          session
        }
      }

      if (!mountedRef.current || requestId !== createRequestIdRef.current) {
        await release(next)
        return null
      }

      activeRef.current = next
      setConversation(next)
      setPersistedConversation(null)
      setPhase('leased')
      return next
    },
    [release]
  )

  const start = useCallback(
    async (defaults?: TemporaryConversationDefaults) => {
      const merged = { ...defaultsRef.current, ...defaults }
      const previous = activeRef.current
      activeRef.current = null
      setConversation(null)
      setPersistedConversation(null)
      setPhase('idle')
      await release(previous)

      if (!mountedRef.current) return null
      return create(merged)
    },
    [create, release]
  )

  const reset = useCallback((defaults?: TemporaryConversationDefaults) => start(defaults), [start])

  const replace = useCallback(
    async (defaults?: TemporaryConversationDefaults) => {
      const previous = activeRef.current
      setPersistedConversation(null)
      const next = await create({ ...defaultsRef.current, ...defaults })
      if (!next) return null
      await release(previous)
      return next
    },
    [create, release]
  )

  const updateAssistant = useCallback(async (assistantId: string | null) => {
    const current = activeRef.current
    if (!current || current.type !== 'assistant') return null

    const topic = await dataApiService.patch(`/temporary/topics/${current.id}`, { body: { assistantId } })
    const next: TemporaryConversation = {
      ...current,
      assistantId,
      topic
    }
    activeRef.current = next
    setConversation(next)
    return next
  }, [])

  const persist = useCallback(async (initialName?: string) => {
    const current = activeRef.current
    if (!current) return null

    createRequestIdRef.current += 1
    activeRef.current = null
    setIsPersisting(true)
    setPhase('persisting')
    try {
      if (current.type === 'assistant') {
        await dataApiService.post(`/temporary/topics/${current.id}/persist`, { body: {} })
        setConversation(null)
        setPersistedConversation(current)
        setPhase('persisted')

        const trimmed = initialName?.trim()
        if (trimmed) {
          try {
            await dataApiService.patch(`/topics/${current.id}`, { body: { name: trimmed.slice(0, 30) } })
          } catch (err) {
            logger.warn('Failed to seed placeholder topic name', err as Error)
          }
        }
        return current
      }

      let session = await dataApiService.post(`/temporary/sessions/${current.id}/persist`, { body: {} })
      const trimmed = initialName?.trim()
      if (trimmed) {
        try {
          session = await dataApiService.patch(`/sessions/${session.id}`, { body: { name: trimmed.slice(0, 30) } })
        } catch (err) {
          logger.warn('Failed to seed placeholder session name', err as Error)
        }
      }
      const persisted: TemporaryConversation = {
        ...current,
        agentId: session.agentId ?? current.agentId,
        name: session.name,
        session
      }
      setConversation(null)
      setPersistedConversation(persisted)
      setPhase('persisted')
      return persisted
    } catch (err) {
      activeRef.current = current
      setPhase('leased')
      throw err
    } finally {
      setIsPersisting(false)
    }
  }, [])

  const discard = useCallback(async () => {
    createRequestIdRef.current += 1
    const current = activeRef.current
    activeRef.current = null
    setConversation(null)
    setPersistedConversation(null)
    setPhase('idle')
    await release(current)
  }, [release])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      createRequestIdRef.current += 1
      const current = activeRef.current
      activeRef.current = null
      void release(current)
    }
  }, [release])

  return {
    conversation,
    persistedConversation,
    phase,
    start,
    replace,
    updateAssistant,
    reset,
    persist,
    discard,
    isTemporary: conversation !== null,
    isPersisting
  }
}
