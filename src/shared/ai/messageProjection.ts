import { isEqual, isPlainObject, omit } from 'es-toolkit'

import type { ExecutionId } from '@shared/ai/executionIdentity'
import type { DeferredToolResultRef } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { ErrorPartData } from '@shared/data/types/uiParts'

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
  olderCursor?: string
  diagnostic?: string
}

export type ProjectedExecution = {
  executionId: ExecutionId
  attemptId: number
  userMessageId?: string
  anchorMessageId?: string
  messageId?: string
} & (
  | { status: 'active'; savedMessageId?: never }
  | {
      status: 'unresolved'
      messageId: string
      persistenceError: ErrorPartData
      savedMessageId?: never
    }
  | { status: 'done' | 'paused' | 'error'; savedMessageId?: string }
)

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

export type MessageViewPatch =
  | { type: 'message'; message: CherryUIMessage }
  | { type: 'append'; messageId: string; part: number; text: string }
  | { type: 'tool-result'; ref: DeferredToolResultRef }

export type TimelinePlacement = { readonly messageId: string; readonly pos: number; afterPartId?: never }
export type ChildPartPlacement = { messageId: string; afterPartId?: string; pos?: never }
type PlacementByKind = { topic: TimelinePlacement; child: ChildPartPlacement }
export type PlacementFor<S extends ProjectionState> = PlacementByKind[S['kind']]
export type PartPlacement = PlacementFor<ProjectionState>
export type NonTextPartWrite<P extends PartPlacement = PartPlacement> = {
  messageId?: never
  pos?: never
  afterPartId?: never
} & ({ type: 'part-add'; placement: P } | { type: 'part-put'; placement?: never })

export interface ToolTerminalDelta {
  toolCallId: string
  terminalId: string
  drop: number
  append: string
  truncated: boolean
}

export type LivePartPatch<P extends PartPlacement = PartPlacement> = {
  partId: string
  entries?: never
  parts?: never
  message?: never
  partIds?: never
  value?: never
} & (
  | (P & {
      type: 'part-open'
      placement?: never
      kind: 'text' | 'reasoning'
      providerMetadata?: Extract<CherryUIMessage['parts'][number], { type: 'text' }>['providerMetadata']
      text?: never
      part?: never
    })
  | ({ messageId?: never; pos?: never; afterPartId?: never; placement?: never } & (
      | { type: 'part-append'; text: string; part?: never }
      | { type: 'part-tool-terminal'; delta: ToolTerminalDelta; part?: never; text?: never }
      | {
          type: 'part-finish'
          providerMetadata?: Extract<CherryUIMessage['parts'][number], { type: 'text' }>['providerMetadata']
          text?: never
          part?: never
        }
      | {
          type: 'part-correct'
          part: Extract<CherryUIMessage['parts'][number], { type: 'text' | 'reasoning' }>
          text?: never
        }
    ))
  | (NonTextPartWrite<P> & {
      text?: never
      part: Exclude<CherryUIMessage['parts'][number], { type: 'text' | 'reasoning' }>
    })
)

type Part = CherryUIMessage['parts'][number]

export function updatedPartValue(before: Part | undefined, patch: LivePartPatch): Part | undefined {
  if (patch.type === 'part-open')
    return before
      ? undefined
      : {
          type: patch.kind,
          state: 'streaming',
          text: '',
          ...(patch.providerMetadata && { providerMetadata: patch.providerMetadata })
        }
  if (patch.type === 'part-add') return before ? undefined : patch.part
  if (!before) return
  if (patch.type === 'part-tool-terminal') {
    const { toolCallId, terminalId, drop, append, truncated } = patch.delta
    if (before.type !== 'dynamic-tool' || before.toolCallId !== toolCallId) return
    const input = before.input
    if (!isPlainObject(input) || !isPlainObject(input.localAcpTool)) return
    const tool = input.localAcpTool
    if (!isPlainObject(tool.terminals) || !isPlainObject(tool.terminalDetails)) return
    const old: unknown = tool.terminals[terminalId]
    const details: unknown = tool.terminalDetails[terminalId]
    if (
      typeof old !== 'string' ||
      !isPlainObject(details) ||
      !Number.isSafeInteger(drop) ||
      drop < 0 ||
      drop > old.length
    )
      return
    return {
      ...before,
      input: {
        ...input,
        localAcpTool: {
          ...tool,
          terminals: { ...tool.terminals, [terminalId]: old.slice(drop) + append },
          terminalDetails: { ...tool.terminalDetails, [terminalId]: { ...details, truncated } }
        }
      }
    }
  }
  if (patch.type === 'part-correct' || patch.type === 'part-put') {
    if (
      before.type !== patch.part.type ||
      (before.type === 'dynamic-tool' &&
        patch.part.type === 'dynamic-tool' &&
        before.toolCallId !== patch.part.toolCallId)
    )
      return
    return patch.part
  }
  if ((before.type !== 'text' && before.type !== 'reasoning') || before.state !== 'streaming') return
  return patch.type === 'part-append'
    ? { ...before, text: before.text + patch.text }
    : {
        ...before,
        state: 'done',
        ...(patch.providerMetadata && { providerMetadata: { ...before.providerMetadata, ...patch.providerMetadata } })
      }
}

export type StructuralProjectionUpdate<S extends ProjectionState = ProjectionState> = S & {
  type?: never
  revision: number
  patches: readonly MessageViewPatch[]
  order?: readonly string[]
}

export type MessageProjectionUpdate<S extends ProjectionState = ProjectionState> =
  | ({
      [K in S['kind']]: {
        type: 'parts'
        kind: K
        messages?: never
        revision: number
        patches: readonly LivePartPatch<PlacementByKind[K]>[]
        order?: never
      }
    }[S['kind']] & { [K in Exclude<keyof TopicProjectionState | keyof ChildProjectionState, 'kind'>]?: never })
  | StructuralProjectionUpdate<S>

export type ProjectionNotification = MessageProjectionUpdate | { kind: 'source-changed' }

/** Both attach and an existing subscriber derive the failed-save marker from the same execution. */
export function projectPersistenceFailures<S extends ProjectionState>(
  view: MessageProjectionView<S>
): MessageProjectionView<S> {
  if (view.kind !== 'topic') return view
  let messages = view.messages
  for (const execution of view.executions) {
    if (execution.status !== 'unresolved') continue
    const index = messages.findIndex((row) => row.id === execution.messageId)
    const row: CherryUIMessage = messages[index] ?? { id: execution.messageId, role: 'assistant', parts: [] }
    const id = `persistence-error:${execution.attemptId}`
    if (row.parts.some((part) => part.type === 'data-error' && part.id === id)) continue
    const error: Part = { type: 'data-error', id, data: execution.persistenceError }
    const failed = {
      ...row,
      parts: [...row.parts, error],
      ...(row.partIds && { partIds: [...row.partIds, id] })
    }
    messages = index < 0 ? [...messages, failed] : messages.with(index, failed)
  }
  return messages === view.messages ? view : { ...view, messages }
}

/** A missing revision or invalid patch requires a new baseline, never a partial application. */
export function applyMessageProjectionUpdate<S extends ProjectionState>(
  view: MessageProjectionView<S>,
  update: StructuralProjectionUpdate<S>
): MessageProjectionView<S> | undefined {
  if (update.revision <= view.revision) return view
  if (update.kind !== view.kind || update.revision !== view.revision + 1) return undefined
  const messages = new Map(view.messages.map((message) => [message.id, message]))
  let changed = false
  for (const patch of update.patches) {
    if (patch.type === 'tool-result') continue
    changed = true
    if (patch.type === 'message') {
      const before = messages.get(patch.message.id)
      if (!before && !update.order) return undefined
      const parts = patch.message.parts.map((part, index) =>
        isEqual(before?.parts[index], part) ? before!.parts[index] : part
      )
      messages.set(patch.message.id, { ...patch.message, parts })
    } else if (patch.type === 'append') {
      const message = messages.get(patch.messageId)
      const part = message?.parts[patch.part]
      if (!message || !part || (part.type !== 'text' && part.type !== 'reasoning')) return undefined
      const parts = message.parts.slice()
      parts[patch.part] = { ...part, text: part.text + patch.text }
      messages.set(message.id, { ...message, parts })
    } else return patch satisfies never
  }
  if (
    update.order &&
    (new Set(update.order).size !== update.order.length || update.order.some((id) => !messages.has(id)))
  )
    return undefined
  const state = omit(update, ['patches', 'order'])
  return projectPersistenceFailures({
    ...state,
    messages: update.order
      ? update.order.map((id) => messages.get(id)!)
      : changed
        ? view.messages.map((message) => messages.get(message.id)!)
        : view.messages
  } as MessageProjectionView<S>)
}
