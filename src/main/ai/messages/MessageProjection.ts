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

/** Publishes current views; native observation and persistence remain with the owner. */
export class MessageProjection<S extends ProjectionState> {
  private view: MessageProjectionView<S>
  private pending?: S & { messages: readonly CherryUIMessage[] }
  private timer?: ReturnType<typeof setTimeout>
  private readonly listeners = new Set<(update: MessageProjectionUpdate<S>) => void>()

  constructor(initial: S & { messages: readonly CherryUIMessage[] }) {
    this.view = { ...initial, revision: 0 }
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

  update(next: S & { messages: readonly CherryUIMessage[] }, immediate = false): void {
    this.pending = next
    if (immediate) this.flush()
    else {
      this.timer ??= setTimeout(() => this.flush(), 80)
      this.timer.unref()
    }
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    if (!this.pending) return
    const next = structuredClone(this.pending)
    this.pending = undefined
    if (isDeepStrictEqual({ ...next, revision: this.view.revision }, this.view)) return
    const previous = new Map(this.view.messages.map((message) => [message.id, message]))
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
    const { messages, ...state } = this.view
    const update = { ...state, patches, order: messages.map((message) => message.id) } as MessageProjectionUpdate<S>
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
