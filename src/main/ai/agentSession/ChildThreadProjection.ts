import { isDeepStrictEqual } from 'node:util'

import { v4 as uuid } from 'uuid'

import { application } from '@application'
import type { ContentItem, Observation, Thread, ThreadHandle } from '@cherrystudio/agent-runtime'
import type { AgentSessionContextRow } from '@data/db/schemas/agentSessionContext'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { readAgentSessionPath } from '@data/services/agentSessionMessageTree'
import { loggerService } from '@logger'
import type { AgentChildPatch, AgentChildUpdate, AgentChildView } from '@shared/ai/agentChildProjection'
import type { CherryUIMessage } from '@shared/data/types/message'

import { ThreadMessageProjection } from './ThreadMessageProjection'

const logger = loggerService.withContext('ChildThreadProjection')

export function savedChildView(context: AgentSessionContextRow): AgentChildView {
  return {
    contextId: context.id,
    sessionId: context.sessionId,
    revision: 0,
    active: false,
    available: false,
    diagnostic: typeof context.checkpointMapping?.gap === 'string' ? context.checkpointMapping.gap : undefined,
    messages: readAgentSessionPath(application.get('DbService').getDb(), context.sessionId).map((row) => ({
      id: row.id,
      role: row.role as CherryUIMessage['role'],
      parts: row.data.parts ?? []
    }))
  }
}

/** One native child observer and archive writer, retained by the parent runtime owner. */
export class ChildThreadProjection {
  private readonly projection: ThreadMessageProjection
  private observation?: Observation
  private source?: object
  private attaching?: Promise<void>
  private view: AgentChildView
  private readonly productIds = new Map<string, string>()
  private readonly committedLiveIds = new Set<string>()
  private readonly nativeIds: Record<string, string>
  private readonly saved = new Map<string, CherryUIMessage>()
  private readonly listeners = new Set<(update: AgentChildUpdate) => void>()
  private timer?: ReturnType<typeof setTimeout>
  private pending: Promise<void> = Promise.resolve()
  private stopped = false
  private needsHistory = true
  private reloadSaved = false
  private readonly archiveGap?: string

  constructor(
    readonly context: AgentSessionContextRow,
    private readonly handle: ThreadHandle,
    private readonly readCommitted: () => {
      items: readonly ContentItem[]
      aliases: Readonly<Record<string, string>>
    }
  ) {
    this.projection = new ThreadMessageProjection(handle.thread)
    this.nativeIds = { ...(context.checkpointMapping?.projection as Record<string, string> | undefined) }
    this.view = savedChildView(context)
    this.archiveGap = this.view.diagnostic
    for (const message of this.view.messages) this.saved.set(message.id, message)
  }

  snapshot(): AgentChildView {
    return this.view
  }

  subscribe(listener: (update: AgentChildUpdate) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  attach(): Promise<void> {
    this.attaching ??= this.attachSource().finally(() => {
      this.attaching = undefined
    })
    return this.attaching
  }

  private async attachSource(): Promise<void> {
    if (this.stopped) throw new Error('Child projection is closed')
    if (this.source) return this.flush()
    await this.observation?.stop()
    await this.pending
    const source = {}
    this.source = source
    const result = await this.handle.observe(async (event) => {
      if (this.stopped || this.source !== source) return
      try {
        await this.projection.accept(event)
      } catch (error) {
        this.source = undefined
        this.schedule()
        throw error
      }
      if (
        event.type === 'snapshot' ||
        event.type === 'gap' ||
        event.type === 'input.changed' ||
        (event.type === 'item.upsert' &&
          (event.item.type === 'tool-result' || event.item.completeness === 'complete')) ||
        (event.type === 'activity.changed' && event.activity.state === 'idle')
      )
        this.needsHistory = true
      this.schedule()
    })
    if (this.stopped || this.source !== source) {
      if (result.status === 'confirmed') await result.value.stop()
      return
    }
    if (result.status !== 'confirmed') {
      this.source = undefined
      throw new Error(result.error.message)
    }
    this.observation = result.value
    await this.flush()
  }

  async refresh(): Promise<void> {
    this.reloadSaved = true
    this.needsHistory = true
    await this.flush()
  }

  private schedule(): void {
    this.timer ??= setTimeout(() => {
      this.timer = undefined
      void this.flush().catch((error) => {
        logger.error('Child archive flush failed', { contextId: this.context.id, error })
        this.publish({ ...this.view, diagnostic: String(error), available: false })
      })
    }, 80)
    this.timer.unref()
  }

  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    const work = this.pending
      .then(() => this.reduce())
      .catch((error) => {
        this.needsHistory = true
        throw error
      })
    this.pending = work.catch(() => {})
    return work
  }

  private async reduce(): Promise<void> {
    await this.projection.drain()
    if (this.reloadSaved) {
      for (const message of savedChildView(this.context).messages) this.saved.set(message.id, message)
      this.reloadSaved = false
    }
    const current = this.projection.snapshot()
    const history = this.needsHistory
    this.needsHistory = false
    const archive = history ? this.readCommitted() : undefined
    for (const item of archive?.items ?? [])
      if (item.type === 'message' && item.inputId && messages.hasSubmission(this.context.sessionId, item.inputId))
        this.nativeIds[item.ref.id] = item.inputId
    for (const [nativeId, liveId] of Object.entries(archive?.aliases ?? {})) {
      const id = this.nativeIds[nativeId] ?? this.productIds.get(liveId) ?? uuid()
      this.nativeIds[nativeId] = id
      this.productIds.set(liveId, id)
      this.committedLiveIds.add(liveId)
    }
    let next = new Map(this.saved)
    const committed = new Set<string>()
    if (archive) {
      const recovered = new ThreadMessageProjection(this.handle.thread)
      try {
        await recovered.accept({
          type: 'snapshot',
          coverage: 'current-view',
          items: archive.items,
          inputs: [],
          activity: current.activity
        })
        for (const message of recovered.snapshot().messages) {
          const id = (this.nativeIds[message.id] ??= uuid())
          next.set(id, { ...message, id })
          committed.add(id)
        }
      } finally {
        await recovered.close()
      }
    }
    for (const message of current.messages) {
      if (this.committedLiveIds.has(message.id)) continue
      const id = this.productIds.get(message.id) ?? uuid()
      this.productIds.set(message.id, id)
      if (committed.has(id)) continue
      next.set(id, { ...message, id })
    }
    const order = [...next.keys()]
    const nativeOrder = [...committed]
    for (const [index, id] of nativeOrder.entries()) {
      if (this.saved.has(id)) continue
      order.splice(order.indexOf(id), 1)
      const following = nativeOrder.slice(index + 1).find((key) => this.saved.has(key))
      const previous = nativeOrder[index - 1]
      const at = following ? order.indexOf(following) : previous ? order.indexOf(previous) + 1 : order.length
      order.splice(at, 0, id)
    }
    next = new Map(order.map((id) => [id, next.get(id)!]))
    const changed = [...next.values()].filter((message) => !isDeepStrictEqual(message, this.saved.get(message.id)))
    if (changed.length || history) {
      application.get('DbService').withWriteTx((tx) => {
        for (const message of changed) {
          const at = order.indexOf(message.id)
          messages.saveMessagesTx(tx, {
            sessionId: this.context.sessionId,
            parentId: at === 0 ? this.context.anchorMessageId! : order[at - 1],
            messages: [
              {
                id: message.id,
                role: message.role,
                data: { parts: message.parts },
                status: message.parts.some((part) => 'state' in part && part.state === 'streaming')
                  ? 'pending'
                  : 'success'
              }
            ]
          })
        }
        if (!isDeepStrictEqual(order, [...this.saved.keys()]))
          messages.orderChildArchiveTx(tx, this.context.sessionId, order)
        const durable = new Set(Object.values(this.nativeIds))
        const uncommitted = [...this.productIds.values()].some((id) => !durable.has(id))
        contexts.saveProjectionTx(
          tx,
          this.context.id,
          this.nativeIds,
          this.archiveGap ?? current.gap ?? (uncommitted ? 'mapping-reset' : undefined)
        )
        for (const input of current.inputs) {
          if (input.inputId && messages.hasSubmission(this.context.sessionId, input.inputId))
            messages.mergeSubmissionTx(
              tx,
              this.context.sessionId,
              input.inputId,
              input,
              input.response && this.productIds.get(input.response.id)
            )
        }
      })
      this.saved.clear()
      for (const [id, message] of next) this.saved.set(id, message)
    }
    this.publish({
      ...this.view,
      messages: [...next.values()],
      active: current.activity.state === 'active',
      available: !this.stopped && !current.closed,
      diagnostic: current.diagnostic?.message ?? this.archiveGap ?? current.gap
    })
  }

  private publish(next: AgentChildView): void {
    if (isDeepStrictEqual(next, this.view)) return
    const previous = new Map(this.view.messages.map((message) => [message.id, message]))
    const patches: AgentChildPatch[] = []
    for (const message of next.messages) {
      const before = previous.get(message.id)
      if (isDeepStrictEqual(before, message)) continue
      const appended: AgentChildPatch[] = []
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
    const update: AgentChildUpdate = {
      revision: this.view.revision,
      patches,
      order: next.messages.map((message) => message.id),
      active: next.active,
      available: next.available,
      diagnostic: next.diagnostic
    }
    for (const listener of this.listeners) {
      try {
        listener(update)
      } catch (error) {
        this.listeners.delete(listener)
        logger.warn('Child subscriber detached', { error })
      }
    }
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.source = undefined
    this.needsHistory = true
    await this.attaching
    await this.observation?.stop()
    await this.flush()
    await this.projection.close()
    this.publish({ ...this.view, available: false, active: false })
    this.listeners.clear()
  }

  get thread(): Thread {
    return this.handle.thread
  }
}
