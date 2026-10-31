import { isEqual, omit } from 'es-toolkit'

import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'

export type ProjectionTarget =
  | { kind: 'topic'; topicId: string }
  | { kind: 'child'; sessionId: string; toolCallId: string }

export interface ChildProjectionState {
  kind: 'child'
  contextId: string
  sessionId: string
  active: boolean
  available: boolean
  canSubmit: boolean
  diagnostic?: string
}

export interface ProjectedExecution {
  executionId: UniqueModelId
  attemptId: number
  anchorMessageId?: string
  messageId?: string
  status: 'active' | 'done' | 'paused' | 'error' | 'unresolved'
}

export interface TopicProjectionState {
  kind: 'topic'
  topicId: string
  executions: readonly ProjectedExecution[]
}

export type ProjectionState = ChildProjectionState | TopicProjectionState
export type MessageProjectionView<S extends ProjectionState = ProjectionState> = S & {
  revision: number
  messages: readonly CherryUIMessage[]
}

export type MessageProjectionPatch =
  | { type: 'message'; message: CherryUIMessage }
  | { type: 'append'; messageId: string; part: number; text: string }

export type MessageProjectionUpdate<S extends ProjectionState = ProjectionState> = S & {
  revision: number
  patches: MessageProjectionPatch[]
  order: string[]
}

/** A missing revision or invalid patch requires a new baseline, never a partial application. */
export function applyMessageProjectionUpdate<S extends ProjectionState>(
  view: MessageProjectionView<S>,
  update: MessageProjectionUpdate<S>
): MessageProjectionView<S> | undefined {
  if (update.revision <= view.revision) return view
  if (update.kind !== view.kind || update.revision !== view.revision + 1) return undefined
  const messages = new Map(view.messages.map((message) => [message.id, message]))
  for (const patch of update.patches) {
    if (patch.type === 'message') {
      const before = messages.get(patch.message.id)
      const parts = patch.message.parts.map((part, index) =>
        isEqual(before?.parts[index], part) ? before!.parts[index] : part
      )
      messages.set(patch.message.id, { ...patch.message, parts })
    } else {
      const message = messages.get(patch.messageId)
      const part = message?.parts[patch.part]
      if (!message || !part || (part.type !== 'text' && part.type !== 'reasoning')) return undefined
      const parts = message.parts.slice()
      parts[patch.part] = { ...part, text: part.text + patch.text }
      messages.set(message.id, { ...message, parts })
    }
  }
  if (new Set(update.order).size !== update.order.length || update.order.some((id) => !messages.has(id)))
    return undefined
  const state = omit(update, ['patches', 'order'])
  return { ...state, messages: update.order.map((id) => messages.get(id)!) } as MessageProjectionView<S>
}
