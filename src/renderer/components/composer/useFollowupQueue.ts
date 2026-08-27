import { loggerService } from '@logger'
import { useSharedCacheValue } from '@renderer/data/hooks/useCache'
import { ipcApi } from '@renderer/ipc'
import {
  ConversationInboxMutationKind,
  type ConversationInputId,
  ConversationInputTarget,
  type ConversationRef,
  conversationRefKey
} from '@shared/ai/conversation'
import type {
  ComposerQueuedMessagePayload,
  ConversationInboxMutation,
  ConversationInboxSnapshot
} from '@shared/ai/transport'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ComposerSerializedDraft } from './tokens'

export interface FollowupQueueItem {
  id: ConversationInputId
  draft: ComposerSerializedDraft
  payload: ComposerQueuedMessagePayload
}

interface UseFollowupQueueParams {
  conversation: ConversationRef
  onEnqueue: (draft: ComposerSerializedDraft, payload: ComposerQueuedMessagePayload) => Promise<boolean>
}

export interface FollowupQueueController {
  items: FollowupQueueItem[]
  enqueue: (draft: ComposerSerializedDraft, payload: ComposerQueuedMessagePayload) => Promise<boolean>
  removeId: (id: ConversationInputId) => Promise<void>
  retarget: (id: ConversationInputId) => Promise<void>
  reorder: (nextItems: FollowupQueueItem[]) => void
  paused: boolean
  setPaused: (paused: boolean) => void
}

const logger = loggerService.withContext('useFollowupQueue')
const REFRESH_RETRY_DELAY_MS = 1_000

const toItems = (snapshot: ConversationInboxSnapshot): FollowupQueueItem[] =>
  snapshot.items.map(({ id, presentation }) => ({
    id,
    draft: presentation.draft,
    payload: presentation.payload
  }))

export function useFollowupQueue({ conversation, onEnqueue }: UseFollowupQueueParams): FollowupQueueController {
  const key = conversationRefKey(conversation)
  const status = useSharedCacheValue(`conversation.statuses.${key}` as const)
  const [items, setItems] = useState<FollowupQueueItem[]>([])
  const [paused, setPausedState] = useState(false)
  const [refreshRequest, setRefreshRequest] = useState(0)
  const generationRef = useRef(0)
  const conversationRef = useRef(conversation)
  conversationRef.current = conversation

  const install = useCallback((snapshot: ConversationInboxSnapshot, generation: number) => {
    if (generationRef.current !== generation) return
    setItems(toItems(snapshot))
    setPausedState(snapshot.paused)
  }, [])

  useEffect(() => {
    generationRef.current += 1
    const generation = generationRef.current
    const requestedConversation = conversationRef.current
    let disposed = false
    let retryTimer: number | undefined

    setItems([])
    setPausedState(false)

    const refresh = async () => {
      try {
        const snapshot = await ipcApi.request('ai.conversation.inbox.get', { conversation: requestedConversation })
        if (!disposed) install(snapshot, generation)
      } catch (error) {
        if (disposed) return
        logger.warn('Failed to refresh Conversation inbox projection', error as Error)
        retryTimer = window.setTimeout(() => void refresh(), REFRESH_RETRY_DELAY_MS)
      }
    }

    void refresh()
    return () => {
      disposed = true
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
    }
  }, [key, install, refreshRequest, status?.inboxRevision])

  const enqueue = useCallback(
    async (draft: ComposerSerializedDraft, payload: ComposerQueuedMessagePayload) => {
      const accepted = await onEnqueue(draft, payload)
      if (accepted) setRefreshRequest((current) => current + 1)
      return accepted
    },
    [onEnqueue]
  )

  const mutate = useCallback(
    async (mutation: ConversationInboxMutation) => {
      const generation = generationRef.current
      const snapshot = await ipcApi.request('ai.conversation.inbox.mutate', {
        conversation: conversationRef.current,
        mutation
      })
      install(snapshot, generation)
    },
    [install]
  )

  const removeId = useCallback(
    (inputId: ConversationInputId) => mutate({ kind: ConversationInboxMutationKind.Remove, inputId }),
    [mutate]
  )

  const retarget = useCallback(
    (inputId: ConversationInputId) =>
      mutate({
        kind: ConversationInboxMutationKind.Retarget,
        inputId,
        target: ConversationInputTarget.NextStep
      }),
    [mutate]
  )

  const reorder = useCallback(
    (nextItems: FollowupQueueItem[]) => {
      setItems(nextItems)
      void mutate({ kind: ConversationInboxMutationKind.Reorder, inputIds: nextItems.map(({ id }) => id) })
    },
    [mutate]
  )

  const setPaused = useCallback(
    (nextPaused: boolean) => {
      setPausedState(nextPaused)
      void mutate({ kind: ConversationInboxMutationKind.SetPaused, paused: nextPaused })
    },
    [mutate]
  )

  return { items, enqueue, removeId, retarget, reorder, paused, setPaused }
}
