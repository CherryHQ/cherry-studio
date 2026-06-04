/**
 * Client-only "pending" message overlay — the user's just-sent turn shown
 * instantly, BEFORE it is persisted, WITHOUT polluting the authoritative
 * SWR `uiMessages` cache.
 *
 * Replaces `seedOptimisticUser` / `seedOptimisticAssistant` (which wrote
 * synthetic `optimistic-*` rows into the SWR infinite cache that the real
 * revalidation then had to overwrite by id/position — timing-dependent,
 * leaked an `optimistic-` filter into several call sites).
 *
 * Lifecycle:
 *  - `addPending()` synthesizes a user bubble (+ an assistant placeholder
 *    for the single-model case) in local React state.
 *  - The single `streamOpen` dispatch is routed through
 *    `streamDispatchCoordinator`; its ack carries the authoritative
 *    `userMessageId` / `placeholderIds`, stored on the group as the join
 *    key. A dispatch error drops the group (the bubble disappears).
 *  - A group is "claimed" — and therefore filtered out of the rendered
 *    overlay — once `uiMessages` (DB truth) contains its `userMessageId`
 *    or any `placeholderId` (created atomically, so either implies both).
 *
 * Observer windows never call `addPending`, so their overlay stays empty
 * and they render pure DB truth (Phase 2 makes that hand-off flash-free).
 */
import { streamDispatchCoordinator } from '@renderer/transport/streamDispatchCoordinator'
import type { FileMetadata } from '@renderer/types'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

interface PendingGroup {
  localId: string
  messages: CherryUIMessage[]
  joinIds?: { userMessageId?: string; placeholderIds?: string[] }
}

export interface AddPendingInput {
  text: string
  parentId: string | null
  files?: FileMetadata[]
  /** Single-model send → also show an assistant "thinking" placeholder. */
  withAssistantPlaceholder: boolean
}

export interface UsePendingMessagesResult {
  /** Synthetic messages to append after DB `uiMessages` for rendering. */
  pendingMessages: CherryUIMessage[]
  addPending: (input: AddPendingInput) => void
}

function buildUserMessage(input: AddPendingInput): CherryUIMessage {
  const parts: CherryMessagePart[] = [{ type: 'text', text: input.text }]
  for (const file of input.files ?? []) {
    parts.push({
      type: 'file',
      url: file.path,
      mediaType: file.ext ?? 'application/octet-stream',
      filename: file.origin_name ?? file.name
    } as CherryMessagePart)
  }
  return {
    id: `pending-user-${crypto.randomUUID()}`,
    role: 'user',
    parts,
    metadata: { parentId: input.parentId, status: 'success', createdAt: new Date().toISOString() }
  } as CherryUIMessage
}

function buildAssistantPlaceholder(parentId: string): CherryUIMessage {
  return {
    id: `pending-asst-${crypto.randomUUID()}`,
    role: 'assistant',
    parts: [],
    metadata: { parentId, status: 'pending', createdAt: new Date().toISOString() }
  } as CherryUIMessage
}

export function usePendingMessages(topicId: string, uiMessages: CherryUIMessage[]): UsePendingMessagesResult {
  const [groups, setGroups] = useState<PendingGroup[]>([])

  // Reset on topic switch — pending is per-topic and never crosses.
  const prevTopicRef = useRef(topicId)
  if (prevTopicRef.current !== topicId) {
    prevTopicRef.current = topicId
    if (groups.length > 0) setGroups([])
  }

  useEffect(() => {
    const off = streamDispatchCoordinator.subscribe(topicId, (result) => {
      setGroups((prev) => {
        if (prev.length === 0) return prev
        if (!result.ok || result.ack.mode === 'blocked') {
          // Dispatch failed — drop the oldest unjoined group (its bubble
          // vanishes; handleSendV2's throw lets the Inputbar recover text).
          const idx = prev.findIndex((g) => !g.joinIds)
          if (idx === -1) return prev
          return prev.filter((_, i) => i !== idx)
        }
        const idx = prev.findIndex((g) => !g.joinIds)
        if (idx === -1) return prev
        const next = prev.slice()
        next[idx] = {
          ...next[idx],
          joinIds: {
            userMessageId: result.ack.userMessageId,
            placeholderIds: result.ack.placeholderIds
          }
        }
        return next
      })
    })
    return off
  }, [topicId])

  const addPending = useCallback((input: AddPendingInput) => {
    const user = buildUserMessage(input)
    const messages = input.withAssistantPlaceholder ? [user, buildAssistantPlaceholder(user.id)] : [user]
    setGroups((prev) => [...prev, { localId: user.id, messages }])
  }, [])

  const pendingMessages = useMemo<CherryUIMessage[]>(() => {
    if (groups.length === 0) return []
    const dbIds = new Set(uiMessages.map((m) => m.id))
    const out: CherryUIMessage[] = []
    for (const group of groups) {
      const join = group.joinIds
      const claimed =
        !!join &&
        ((join.userMessageId !== undefined && dbIds.has(join.userMessageId)) ||
          (join.placeholderIds?.some((id) => dbIds.has(id)) ?? false))
      if (!claimed) out.push(...group.messages)
    }
    return out
  }, [groups, uiMessages])

  // Prune claimed groups so the array can't grow unbounded across a session.
  useEffect(() => {
    setGroups((prev) => {
      if (prev.length === 0) return prev
      const dbIds = new Set(uiMessages.map((m) => m.id))
      const kept = prev.filter((g) => {
        const join = g.joinIds
        if (!join) return true
        const claimed =
          (join.userMessageId !== undefined && dbIds.has(join.userMessageId)) ||
          (join.placeholderIds?.some((id) => dbIds.has(id)) ?? false)
        return !claimed
      })
      return kept.length === prev.length ? prev : kept
    })
  }, [uiMessages])

  return { pendingMessages, addPending }
}
