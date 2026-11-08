import { isDeepStrictEqual } from 'node:util'

import { omit } from 'es-toolkit'

import { loggerService } from '@logger'
import type {
  MessageProjectionPatch,
  MessageProjectionUpdate,
  MessageProjectionView,
  ProjectionState
} from '@shared/ai/messageProjection'
import type { DeferredToolResultRef } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'

const logger = loggerService.withContext('MessageProjection')

type ProjectionView<S extends ProjectionState> = S & { messages: readonly CherryUIMessage[] }
type ProjectionInput<S extends ProjectionState> = ProjectionView<S> | (() => ProjectionView<S>)

/** Publishes current views; native observation and persistence remain with the owner. */
export class MessageProjection<S extends ProjectionState> {
  private view: MessageProjectionView<S>
  private pending?: ProjectionInput<S>
  private readonly changedResults = new Map<string, DeferredToolResultRef>()
  private timer?: ReturnType<typeof setTimeout>
  private readonly listeners = new Set<(update: MessageProjectionUpdate<S>) => void>()

  constructor(initial: S & { messages: readonly CherryUIMessage[] }) {
    this.view = { ...structuredClone(initial), revision: 0 }
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

  /** Mutable inputs are snapshotted at acceptance; lazy inputs are snapshotted when resolved. */
  update(next: ProjectionInput<S>, immediate = false, changedResults: readonly DeferredToolResultRef[] = []): void {
    this.updateAccepted(
      typeof next === 'function' ? () => structuredClone(next()) : structuredClone(next),
      immediate,
      changedResults
    )
  }

  /** The owner must snapshot native values before accepting them and preserve untouched part identities. */
  updateAccepted(
    next: ProjectionInput<S>,
    immediate = false,
    changedResults: readonly DeferredToolResultRef[] = []
  ): void {
    this.pending = next
    this.invalidateToolResults(changedResults, immediate)
  }

  invalidateToolResults(refs: readonly DeferredToolResultRef[], immediate = false): void {
    for (const ref of refs)
      this.changedResults.set(JSON.stringify([ref.topicId, ref.messageId, ref.toolCallId]), { ...ref })
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
    if (!this.pending && !this.changedResults.size) return
    const pending = this.pending
    this.pending = undefined
    const next = pending ? (typeof pending === 'function' ? pending() : pending) : this.view
    const beforeState = omit(this.view, ['messages', 'revision'])
    const nextState = omit({ ...next, revision: this.view.revision }, ['messages', 'revision'])
    const orderChanged =
      next.messages.length !== this.view.messages.length ||
      next.messages.some((message, index) => message.id !== this.view.messages[index]?.id)
    const previous = new Map(this.view.messages.map((message) => [message.id, message]))
    const patches: MessageProjectionPatch[] = []
    for (const message of next.messages) {
      const before = previous.get(message.id)
      if (before === message) continue
      const appended: MessageProjectionPatch[] = []
      const appendOnly =
        before &&
        before.role === message.role &&
        before.parts.length === message.parts.length &&
        isDeepStrictEqual(before.metadata, message.metadata) &&
        message.parts.every((part, index) => {
          const old = before.parts[index]
          if (old === part) return true
          if (
            (part.type !== 'text' && part.type !== 'reasoning') ||
            old.type !== part.type ||
            !('text' in old) ||
            !part.text.startsWith(old.text) ||
            !isDeepStrictEqual({ ...old, text: '' }, { ...part, text: '' })
          )
            return false
          if (part.text.length !== old.text.length)
            appended.push({
              type: 'append',
              messageId: message.id,
              part: index,
              text: part.text.slice(old.text.length)
            })
          return true
        })
      patches.push(...(appendOnly ? appended : [{ type: 'message' as const, message }]))
    }
    for (const ref of this.changedResults.values()) patches.push({ type: 'tool-result', ref })
    this.changedResults.clear()
    if (!patches.length && !orderChanged && isDeepStrictEqual(beforeState, nextState)) return
    this.view = { ...next, revision: this.view.revision + 1 }
    const { messages, ...state } = this.view
    const update = {
      ...state,
      patches,
      ...(orderChanged ? { order: messages.map((message) => message.id) } : {})
    } as MessageProjectionUpdate<S>
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
    this.changedResults.clear()
    this.listeners.clear()
  }
}
