/**
 * Pure projection: `CherryUIMessage` → renderer `Message`.
 *
 * Used by V2ChatContent to turn DB-backed `uiMessages` (and pre-refresh
 * streaming overlays) into the `Message[]` the legacy renderer consumes.
 * Kept free of hooks / refs so it's trivially testable and callers own
 * any stable-timestamp cache (passed through as `createdAtFallback`).
 */
import type { Model } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { AssistantMessageStatus, UserMessageStatus } from '@renderer/types/newMessage'
import { statsToMetrics, statsToUsage } from '@renderer/utils/messageStats'
import type { CherryUIMessage, ModelSnapshot } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'

export interface UiToMessageContext {
  assistantId: string
  topicId: string
  /**
   * Parent hint when the message itself has no `metadata.parentId` —
   * e.g., an optimistic append from a streaming bubble whose DB row
   * hasn't landed yet. Callers usually pass the id of the most recent
   * user message already in the base.
   */
  askIdFallback?: string
  /**
   * Model snapshot used when the message lacks `metadata.modelSnapshot`
   * / `metadata.modelId` — typically the assistant's default model.
   */
  modelFallback?: ModelSnapshot
  /**
   * Pre-resolved ISO `createdAt` string. Ignored when the message
   * carries its own `metadata.createdAt`. Caller caches by id so
   * synthesised timestamps don't drift across re-renders.
   */
  createdAtFallback?: string
}

/**
 * Map DB `MessageStatus` (lowercase union from Zod schema) to the
 * renderer enum. Values line up already — this wrapper enforces the
 * type boundary without a silent `as` cast.
 */
function projectStatus(
  role: 'user' | 'assistant' | 'system',
  dbStatus: string | undefined
): UserMessageStatus | AssistantMessageStatus {
  if (role === 'user') return UserMessageStatus.SUCCESS
  switch (dbStatus) {
    case 'success':
      return AssistantMessageStatus.SUCCESS
    case 'error':
      return AssistantMessageStatus.ERROR
    case 'paused':
      // Renderer has no `paused` enum for assistant messages; treat as
      // success so the bubble is interactable. Any persisted error/stop
      // is surfaced through the accompanying `data-error` part.
      return AssistantMessageStatus.SUCCESS
    case 'pending':
    default:
      return AssistantMessageStatus.PENDING
  }
}

export function uiToMessage(uiMsg: CherryUIMessage, ctx: UiToMessageContext): Message {
  const meta = uiMsg.metadata ?? {}

  const snapshot = meta.modelSnapshot ?? (uiMsg.role === 'assistant' ? ctx.modelFallback : undefined)
  const modelId =
    meta.modelId ??
    (uiMsg.role === 'assistant' && snapshot ? createUniqueModelId(snapshot.provider, snapshot.id) : undefined)

  const createdAt = meta.createdAt ?? ctx.createdAtFallback ?? ''
  const askId = uiMsg.role === 'assistant' ? (meta.parentId ?? ctx.askIdFallback) : undefined

  return {
    id: uiMsg.id,
    role: uiMsg.role,
    assistantId: ctx.assistantId,
    topicId: ctx.topicId,
    createdAt,
    askId,
    modelId,
    model: snapshot ? (snapshot as unknown as Model) : undefined,
    siblingsGroupId: meta.siblingsGroupId,
    status: projectStatus(uiMsg.role, meta.status),
    ...(meta.stats && { usage: statsToUsage(meta.stats), metrics: statsToMetrics(meta.stats) }),
    blocks: [],
    parts: uiMsg.parts ?? []
  }
}
