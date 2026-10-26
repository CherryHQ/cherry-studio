import { loggerService } from '@logger'
import type { MessageProjectionView, ProjectedExecution, TopicProjectionState } from '@shared/ai/messageProjection'
import type { ActiveExecution } from '@shared/ai/transport'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'

import { messageProjectionService } from './MessageProjectionService'

const logger = loggerService.withContext('ExecutionStreamOverlayService')

export interface ExecutionFinishEvent {
  attemptId: number
  message: CherryUIMessage
  isAbort: boolean
  isError: boolean
}
interface ExecutionOverlayView {
  overlay: Record<string, CherryMessagePart[]>
  liveAssistants: CherryUIMessage[]
}
type UpdateListener = (executionId: string, event: Pick<ExecutionFinishEvent, 'attemptId' | 'message'>) => void
type FinishListener = (executionId: string, event: ExecutionFinishEvent) => void
interface Entry {
  topicId: string
  refCount: number
  stop?: () => void
  projection?: MessageProjectionView<TopicProjectionState>
  desired: Map<object, readonly ActiveExecution[]>
  hidden: Set<number>
  finished: Set<number>
  view: ExecutionOverlayView
  listeners: Set<() => void>
  updates: Set<UpdateListener>
  finishes: Set<FinishListener>
}
const EMPTY_VIEW: ExecutionOverlayView = { overlay: {}, liveAssistants: [] }

/** Root view facade; parsing, execution lifetime and terminal persistence belong to Main. */
export class ExecutionStreamOverlayService {
  private readonly entries = new Map<string, Entry>()

  acquire(topicId: string): void {
    const entry = this.entry(topicId)
    if (entry.refCount++ > 0 || !topicId) return
    const target = { kind: 'topic' as const, topicId }
    const receive = () => {
      const { view, error } = messageProjectionService.getSnapshot(target)
      if (error) logger.warn('Topic projection unavailable', { topicId, error })
      if (view?.kind !== 'topic') return
      const previous = entry.projection
      entry.projection = view
      this.render(entry)
      const messages = new Map(view.messages.map((message) => [message.id, message]))
      for (const execution of view.executions) {
        if (!this.visible(entry, execution)) continue
        const message = execution.messageId && messages.get(execution.messageId)
        if (!message) continue
        const event = { attemptId: execution.attemptId, message }
        if (previous?.messages.find((item) => item.id === message.id) !== message)
          for (const listener of entry.updates) this.deliver(() => listener(execution.executionId, event))
        if (
          execution.status === 'active' ||
          execution.status === 'unresolved' ||
          entry.finished.has(execution.attemptId)
        )
          continue
        entry.finished.add(execution.attemptId)
        for (const listener of entry.finishes)
          this.deliver(() =>
            listener(execution.executionId, {
              ...event,
              isAbort: execution.status === 'paused',
              isError: execution.status === 'error'
            })
          )
      }
      const attempts = new Set(view.executions.map((execution) => execution.attemptId))
      entry.hidden = new Set([...entry.hidden].filter((id) => attempts.has(id)))
      entry.finished = new Set([...entry.finished].filter((id) => attempts.has(id)))
    }
    entry.stop = messageProjectionService.subscribe(target, receive)
    receive()
  }

  release(topicId: string, consumer: object): void {
    const entry = this.entries.get(topicId)
    if (!entry) return
    entry.desired.delete(consumer)
    if (--entry.refCount <= 0) {
      entry.refCount = 0
      entry.stop?.()
      entry.stop = undefined
    }
    this.trim()
  }

  syncExecutions(topicId: string, consumer: object, executions: readonly ActiveExecution[]): void {
    const entry = this.entry(topicId)
    entry.desired.set(consumer, executions)
    this.render(entry)
  }

  subscribe(topicId: string, listener: () => void): () => void {
    const entry = this.entry(topicId)
    entry.listeners.add(listener)
    return () => {
      entry.listeners.delete(listener)
    }
  }
  getView(topicId: string): ExecutionOverlayView {
    return this.entries.get(topicId)?.view ?? EMPTY_VIEW
  }
  onUpdate(topicId: string, listener: UpdateListener): () => void {
    const entry = this.entry(topicId)
    entry.updates.add(listener)
    return () => {
      entry.updates.delete(listener)
    }
  }
  onFinish(topicId: string, listener: FinishListener): () => void {
    const entry = this.entry(topicId)
    entry.finishes.add(listener)
    return () => {
      entry.finishes.delete(listener)
    }
  }

  disposeOverlay(topicId: string, messageId: string): void {
    const entry = this.entries.get(topicId)
    if (!entry) return
    for (const execution of entry.projection?.executions ?? [])
      if (execution.messageId === messageId && execution.status !== 'active' && execution.status !== 'unresolved')
        entry.hidden.add(execution.attemptId)
    this.render(entry)
  }
  reset(topicId: string): void {
    const entry = this.entries.get(topicId)
    if (!entry) return
    for (const execution of entry.projection?.executions ?? [])
      if (execution.status !== 'active' && execution.status !== 'unresolved') entry.hidden.add(execution.attemptId)
    this.render(entry)
  }
  clear(topicId: string): void {
    const entry = this.entries.get(topicId)
    if (!entry) return
    for (const execution of entry.projection?.executions ?? []) entry.hidden.add(execution.attemptId)
    this.render(entry)
  }

  private visible(entry: Entry, execution: ProjectedExecution): boolean {
    if (entry.hidden.has(execution.attemptId)) return false
    return ![...entry.desired.values()].some((executions) =>
      executions.some(
        (expected) => expected.executionId === execution.executionId && expected.attemptId > execution.attemptId
      )
    )
  }

  private render(entry: Entry): void {
    const projection = entry.projection
    if (!projection) return
    const ids = new Set(
      projection.executions
        .filter((execution) => this.visible(entry, execution))
        .map((execution) => execution.messageId)
    )
    const liveAssistants = projection.messages.filter((message) => ids.has(message.id) && message.role === 'assistant')
    if (
      liveAssistants.length === entry.view.liveAssistants.length &&
      liveAssistants.every((message, index) => message === entry.view.liveAssistants[index])
    )
      return
    entry.view = {
      liveAssistants,
      overlay: Object.fromEntries(
        liveAssistants.filter((message) => message.parts.length).map((message) => [message.id, message.parts])
      )
    }
    for (const listener of entry.listeners) this.deliver(listener)
  }

  private entry(topicId: string): Entry {
    let entry = this.entries.get(topicId)
    if (!entry) {
      entry = {
        topicId,
        refCount: 0,
        desired: new Map(),
        hidden: new Set(),
        finished: new Set(),
        view: EMPTY_VIEW,
        listeners: new Set(),
        updates: new Set(),
        finishes: new Set()
      }
      this.entries.set(topicId, entry)
    }
    return entry
  }
  private deliver(listener: () => void): void {
    try {
      listener()
    } catch (error) {
      logger.warn('Overlay consumer failed', { error })
    }
  }
  private trim(): void {
    for (const [topicId, entry] of this.entries) {
      if (this.entries.size <= 32) break
      if (!entry.refCount) this.entries.delete(topicId)
    }
  }
}
export const executionStreamOverlayService = new ExecutionStreamOverlayService()
