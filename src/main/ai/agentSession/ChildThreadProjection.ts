import { isDeepStrictEqual } from 'node:util'

import { v4 as uuid } from 'uuid'

import { application } from '@application'
import type { RuntimeMessage, Observation, Thread, ThreadHandle } from '@cherrystudio/agent-runtime'
import type { AgentSessionContextRow } from '@data/db/schemas/agentSessionContext'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { readAgentSessionPath } from '@data/services/agentSessionMessageTree'
import { loggerService } from '@logger'
import type { AgentChildPatch, AgentChildUpdate, AgentChildView } from '@shared/ai/agentChildProjection'
import type { CherryUIMessage, MessageStatus } from '@shared/data/types/message'

import { ThreadMessageProjection, type MessageDecorator } from './ThreadMessageProjection'

const logger = loggerService.withContext('ChildThreadProjection')
type CommittedHistory = {
  messages: readonly RuntimeMessage[]
  aliases: Readonly<Record<string, string>>
  removed?: readonly string[]
  legacy?: Readonly<Record<string, { messageId: string; parts: number[] }>>
}
type Composition = Record<string, { messageId: string; parts: number[] }[]>

export function savedChildView(context: AgentSessionContextRow): AgentChildView {
  return {
    contextId: context.id,
    sessionId: context.sessionId,
    revision: 0,
    active: false,
    available: false,
    diagnostic: typeof context.checkpointMapping?.gap === 'string' ? context.checkpointMapping.gap : undefined,
    messages: compose(
      readAgentSessionPath(application.get('DbService').getDb(), context.sessionId).map((row) => ({
        id: row.id,
        role: row.role as CherryUIMessage['role'],
        metadata: { status: row.status as MessageStatus },
        parts: row.data.parts ?? []
      })),
      (context.checkpointMapping?.composition as Composition | undefined) ?? {}
    )
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
  private readonly removed: Set<string>
  private readonly listeners = new Set<(update: AgentChildUpdate) => void>()
  private timer?: ReturnType<typeof setTimeout>
  private pending: Promise<void> = Promise.resolve()
  private stopped = false
  private needsHistory = true
  private reloadSaved = false
  private readonly archiveGap?: string
  private history?: CommittedHistory
  private readonly composition: Composition
  private readonly sourceRows = new Map<string, Composition[string]>()

  constructor(
    readonly context: AgentSessionContextRow,
    private readonly handle: ThreadHandle,
    private readonly readCommitted: () => CommittedHistory | Promise<CommittedHistory>,
    private readonly decorate?: MessageDecorator
  ) {
    this.projection = new ThreadMessageProjection(handle.thread, decorate)
    this.removed = new Set(context.checkpointMapping?.removed as string[] | undefined)
    this.nativeIds = { ...(context.checkpointMapping?.projection as Record<string, string> | undefined) }
    this.composition = { ...(context.checkpointMapping?.composition as Composition | undefined) }
    this.view = savedChildView(context)
    this.archiveGap = this.view.diagnostic
    for (const row of readAgentSessionPath(application.get('DbService').getDb(), context.sessionId))
      this.saved.set(row.id, {
        id: row.id,
        role: row.role as CherryUIMessage['role'],
        parts: row.data.parts ?? [],
        metadata: { status: row.status as MessageStatus }
      })
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
      if (event.type === 'message.remove') this.removed.add(event.ref.id)
      if (event.type === 'message.upsert') {
        for (const ref of event.replaces ?? []) {
          const id = this.nativeIds[ref.id] ?? this.productIds.get(ref.id)
          if (id) this.productIds.set(event.message.id, id)
          this.removed.add(ref.id)
        }
      }
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
        event.type === 'message.remove' ||
        event.type === 'input.changed' ||
        (event.type === 'message.upsert' && event.message.metadata?.completeness === 'complete') ||
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
      for (const row of readAgentSessionPath(application.get('DbService').getDb(), this.context.sessionId))
        this.saved.set(row.id, {
          id: row.id,
          role: row.role as CherryUIMessage['role'],
          parts: row.data.parts ?? [],
          metadata: { status: row.status as MessageStatus }
        })
      this.reloadSaved = false
    }
    const current = this.projection.snapshot()
    const history = this.needsHistory
    this.needsHistory = false
    const archive = history ? await this.readCommitted() : undefined
    if (archive) this.history = archive
    const beforeComposition = structuredClone(this.composition)
    for (const id of archive?.removed ?? []) this.removed.add(id)
    for (const [old, source] of Object.entries(this.history?.legacy ?? {}))
      if (this.removed.has(source.messageId)) this.removed.add(old)
    for (const [id, live] of Object.entries(this.history?.aliases ?? {}))
      if (this.removed.has(id)) this.removed.add(live)
    for (const item of archive?.messages ?? [])
      if (item.metadata?.inputId && messages.hasSubmission(this.context.sessionId, item.metadata.inputId))
        this.nativeIds[item.id] = item.metadata.inputId
    for (const [nativeId, liveId] of Object.entries(archive?.aliases ?? {})) {
      const id = this.nativeIds[nativeId] ?? this.productIds.get(liveId) ?? uuid()
      this.nativeIds[nativeId] = id
      this.productIds.set(liveId, id)
      this.committedLiveIds.add(liveId)
    }
    let next = new Map(this.saved)
    const committed = new Set<string>()
    if (archive) {
      const recovered = new ThreadMessageProjection(this.handle.thread, this.decorate)
      try {
        await recovered.accept({
          type: 'snapshot',
          coverage: 'current-view',
          messages: archive.messages.filter((item) => !this.removed.has(item.id)),
          inputs: [],
          activity: current.activity
        })
        for (const message of recovered.snapshot().messages) {
          const id = (this.nativeIds[message.id] ??= uuid())
          const rows = this.materialize(message, id)
          for (const row of rows) {
            committed.add(row.id)
            if (row.role === 'user' && next.has(row.id) && messages.hasSubmission(this.context.sessionId, row.id))
              continue
            const saved = next.get(row.id)
            next.set(row.id, {
              ...row,
              parts: row.parts.length
                ? row.parts.map((part, index) =>
                    Object.assign({}, saved?.parts[index]?.type === part.type ? saved.parts[index] : undefined, part)
                  )
                : (saved?.parts ?? [])
            })
          }
        }
      } finally {
        await recovered.close()
      }
    }
    for (const message of current.messages) {
      if (this.removed.has(message.id)) continue
      const id = this.nativeIds[message.id] ?? this.productIds.get(message.id) ?? uuid()
      this.productIds.set(message.id, id)
      if (
        ((committed.has(id) || this.committedLiveIds.has(message.id)) &&
          next.get(id)?.metadata?.status !== 'pending') ||
        (message.role === 'user' && next.has(id) && messages.hasSubmission(this.context.sessionId, id))
      )
        continue
      for (const row of this.materialize(message, id)) next.set(row.id, row)
    }
    const mappings = new Map([...Object.entries(this.nativeIds), ...this.productIds])
    const retained = new Set([...mappings].filter(([source]) => !this.removed.has(source)).map(([, id]) => id))
    for (const source of this.removed) {
      const id = mappings.get(source)
      if (id && !retained.has(id)) next.delete(id)
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
    this.composeSources(current.messages)
    const changed = [...next.values()].filter((message) => !isDeepStrictEqual(message, this.saved.get(message.id)))
    if (
      changed.length ||
      history ||
      next.size !== this.saved.size ||
      !isDeepStrictEqual(beforeComposition, this.composition)
    ) {
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
                status: message.metadata?.status ?? 'success'
              }
            ]
          })
        }
        if (!isDeepStrictEqual(order, [...this.saved.keys()]))
          messages.orderChildArchiveTx(
            tx,
            this.context.sessionId,
            order,
            [...this.saved.keys()].filter((id) => !next.has(id))
          )
        const durable = new Set(Object.values(this.nativeIds))
        const uncommitted = [...this.productIds.values()].some((id) => !durable.has(id))
        contexts.saveProjectionTx(
          tx,
          this.context.id,
          this.nativeIds,
          this.archiveGap ?? current.gap ?? (uncommitted ? 'mapping-reset' : undefined),
          [...this.removed],
          this.composition
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
      messages: compose([...next.values()], this.composition),
      active: current.activity.state === 'active',
      available: !this.stopped && !current.closed,
      diagnostic: current.diagnostic?.message ?? this.archiveGap ?? current.gap
    })
  }

  private canonical(id: string): string {
    return Object.entries(this.history?.aliases ?? {}).find(([, live]) => live === id)?.[0] ?? id
  }

  private materialize(message: CherryUIMessage, id: string): CherryUIMessage[] {
    const nativeId = this.canonical(message.id)
    const assignments = new Map<number, string>()
    for (const [old, source] of Object.entries(this.history?.legacy ?? {})) {
      const row = this.nativeIds[old]
      if (source.messageId !== nativeId || !row) continue
      for (const part of source.parts) assignments.set(part, row)
    }
    const rows = new Map<string, CherryUIMessage>()
    const fragments: Composition[string] = []
    message.parts.forEach((part, index) => {
      const rowId = assignments.get(index) ?? id
      const row = rows.get(rowId) ?? { ...message, id: rowId, parts: [] }
      fragments.push({ messageId: rowId, parts: [row.parts.length] })
      row.parts.push(part)
      rows.set(rowId, row)
    })
    if (!rows.size) rows.set(id, { ...message, id })
    this.sourceRows.set(nativeId, [{ messageId: id, parts: [] }, ...fragments])
    return [...rows.values()]
  }

  private composeSources(current: readonly CherryUIMessage[]): void {
    const sources = new Map<string, { id: string; role: CherryUIMessage['role'] }>()
    for (const message of [...(this.history?.messages ?? []), ...current]) {
      const id = this.canonical(message.id)
      sources.set(id, { id, role: message.role })
    }
    const groups: Composition = {}
    let placed = false
    let reply: string | undefined
    const covered = new Set<string>()
    for (const source of sources.values()) {
      if (this.removed.has(source.id)) continue
      const fragments = this.sourceRows.get(source.id)
      if (source.role === 'user') {
        placed = true
        reply = undefined
        continue
      }
      if (source.role !== 'assistant' || !fragments?.length) continue
      const owner = placed ? (reply ??= fragments[0].messageId) : fragments[0].messageId
      groups[owner] = [...(groups[owner] ?? []), ...fragments]
      for (const fragment of fragments) covered.add(fragment.messageId)
    }
    for (const [id, fragments] of Object.entries(this.composition))
      if (fragments.some((fragment) => covered.has(fragment.messageId))) delete this.composition[id]
    Object.assign(this.composition, groups)
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

function compose(messages: readonly CherryUIMessage[], composition: Composition): CherryUIMessage[] {
  const rows = new Map(messages.map((message) => [message.id, message]))
  const grouped = new Set(
    Object.values(composition).flatMap((fragments) => fragments.map((fragment) => fragment.messageId))
  )
  return messages.flatMap((message) => {
    const fragments = composition[message.id]
    if (!fragments) return grouped.has(message.id) ? [] : [message]
    const sources = fragments.flatMap((fragment) =>
      rows.has(fragment.messageId) ? [rows.get(fragment.messageId)!] : []
    )
    return [
      {
        ...message,
        metadata: {
          ...message.metadata,
          status: sources.some((source) => source.metadata?.status === 'pending')
            ? 'pending'
            : sources.some((source) => source.metadata?.status === 'error')
              ? 'error'
              : message.metadata?.status
        },
        parts: fragments.flatMap((fragment) =>
          fragment.parts.flatMap((index) =>
            rows.get(fragment.messageId)?.parts[index] ? [rows.get(fragment.messageId)!.parts[index]] : []
          )
        )
      }
    ]
  })
}
