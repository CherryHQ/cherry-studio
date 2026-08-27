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
  removeId: (id: ConversationInputId) => void
  retarget: (id: ConversationInputId) => Promise<void>
  reorder: (nextItems: FollowupQueueItem[]) => void
  paused: boolean
  setPaused: (paused: boolean) => void
}

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
  const generationRef = useRef(0)
  const conversationRef = useRef(conversation)
  conversationRef.current = conversation

  const install = useCallback((snapshot: ConversationInboxSnapshot, generation: number) => {
    if (generationRef.current !== generation) return
    setItems(toItems(snapshot))
    setPausedState(snapshot.paused)
  }, [])

  const refresh = useCallback(async () => {
    const generation = generationRef.current
    const snapshot = await ipcApi.request('ai.conversation.inbox.get', { conversation: conversationRef.current })
    install(snapshot, generation)
  }, [install])

  useEffect(() => {
    generationRef.current += 1
    setItems([])
    setPausedState(false)
    void refresh()
  }, [key, refresh, status?.inboxRevision])

  const enqueue = useCallback(
    async (draft: ComposerSerializedDraft, payload: ComposerQueuedMessagePayload) => {
      const accepted = await onEnqueue(draft, payload)
      if (accepted) await refresh()
      return accepted
    },
    [onEnqueue, refresh]
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
    (inputId: ConversationInputId) => {
      void mutate({ kind: ConversationInboxMutationKind.Remove, inputId })
    },
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
