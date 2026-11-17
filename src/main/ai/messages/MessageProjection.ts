import { isDeepStrictEqual } from 'node:util'

import { loggerService } from '@logger'
import type {
  MessageProjectionPatch,
  MessageProjectionUpdate,
  MessageProjectionView,
  ProjectionState
} from '@shared/ai/messageProjection'
import type { CherryUIMessage } from '@shared/data/types/message'

const logger = loggerService.withContext('MessageProjection')

type ProjectionView<S extends ProjectionState> = S & { messages: readonly CherryUIMessage[] }
type ProjectionInput<S extends ProjectionState> = ProjectionView<S> | (() => ProjectionView<S>)

function captureMessage(message: CherryUIMessage, before?: CherryUIMessage): CherryUIMessage {
  if (before && isDeepStrictEqual(before, message)) return before
  const { parts, ...state } = message
  return {
    // oxlint-disable-next-line no-restricted-globals -- Capture changed message metadata only; parts are selected separately below.
    ...structuredClone(state),
    parts: parts.map((part, index) => {
      const previous = before?.parts[index]
      if (previous && isDeepStrictEqual(previous, part)) return previous
      if (part.type === 'text' || part.type === 'reasoning') {
        const { text, ...metadata } = part
        // oxlint-disable-next-line no-restricted-globals -- Capture changed text metadata without copying its growing immutable text string.
        return { ...structuredClone(metadata), text }
      }
      // oxlint-disable-next-line no-restricted-globals -- Capture only changed mutable parts; unchanged isolated parts retain their references.
      return structuredClone(part)
    })
  }
}

/** Publishes current views; native observation and persistence remain with the owner. */
export class MessageProjection<S extends ProjectionState> {
  private view: MessageProjectionView<S>
  private pending?: ProjectionInput<S>
  private timer?: ReturnType<typeof setTimeout>
  private readonly listeners = new Set<(update: MessageProjectionUpdate<S>) => void>()

  constructor(initial: S & { messages: readonly CherryUIMessage[] }) {
    const { messages, ...state } = initial
    this.view = {
      ...initial,
      // oxlint-disable-next-line no-restricted-globals -- Capture initial projection state without copying the message graph a second time.
      ...structuredClone(state),
      messages: messages.map((message) => captureMessage(message)),
      revision: 0
    }
  }

  snapshot(): MessageProjectionView<S> {
    this.flush()
    return this.view
  }

  subscribe(listener: (update: MessageProjectionUpdate<S>) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  get observed(): boolean {
    return this.listeners.size > 0
  }

  /** A function `next` is resolved only when the coalesced batch is flushed. */
  update(next: ProjectionInput<S>, immediate = false): void {
    this.pending = next
    if (immediate) this.flush()
    // Unobserved batches wait for snapshot(), which is how a new subscriber reads its baseline.
    else if (this.observed) {
      this.timer ??= setTimeout(() => this.flush(), 80)
      this.timer.unref()
    }
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    if (!this.pending) return
    const pending = this.pending
    this.pending = undefined
    const previous = new Map(this.view.messages.map((message) => [message.id, message]))
    const source = typeof pending === 'function' ? pending() : pending
    const { messages: incoming, ...state } = source
    const next = {
      ...source,
      // oxlint-disable-next-line no-restricted-globals -- Capture non-message state per flush; reuse isolated unchanged message payloads.
      ...structuredClone(state),
      messages: incoming.map((message) => captureMessage(message, previous.get(message.id)))
    }
    if (isDeepStrictEqual({ ...next, revision: this.view.revision }, this.view)) return
    const patches: MessageProjectionPatch[] = []
    for (const message of next.messages) {
      const before = previous.get(message.id)
      if (isDeepStrictEqual(before, message)) continue
      const appended: MessageProjectionPatch[] = []
      const appendOnly =
        before &&
        before.role === message.role &&
        before.parts.length === message.parts.length &&
        isDeepStrictEqual(before.metadata, message.metadata) &&
        message.parts.every((part, index) => {
          const old = before.parts[index]
          if (isDeepStrictEqual(old, part)) return true
          if (
            (part.type !== 'text' && part.type !== 'reasoning') ||
            old.type !== part.type ||
            !('text' in old) ||
            !part.text.startsWith(old.text) ||
            !isDeepStrictEqual({ ...old, text: '' }, { ...part, text: '' })
          )
            return false
          appended.push({ type: 'append', messageId: message.id, part: index, text: part.text.slice(old.text.length) })
          return true
        })
      patches.push(...(appendOnly ? appended : [{ type: 'message' as const, message }]))
    }
    this.view = { ...next, revision: this.view.revision + 1 }
    const { messages, ...published } = this.view
    const update = { ...published, patches, order: messages.map((message) => message.id) } as MessageProjectionUpdate<S>
    for (const listener of this.listeners) {
      try {
        listener(update)
      } catch (error) {
        this.listeners.delete(listener)
        logger.warn('Projection subscriber detached', { error })
      }
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.pending = undefined
    this.listeners.clear()
  }
}
