import { runtimeId, type Subagent, type Thread } from '@cherrystudio/agent-runtime'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { loggerService } from '@logger'

import type { ChildThreadProjection } from './ChildThreadProjection'

const logger = loggerService.withContext('ChildResidency')

/** An observed child thread; once finished it stays loaded only while a viewer or command pins it. */
export type ResidentChild<H> = {
  readonly key: string
  relation?: Subagent
  handle: H
  projection: ChildThreadProjection
  pins: number
  finished: boolean
}

/** A child whose native history is not loaded; its saved rows already hold that history. */
export type ReleasedChild = { thread: Thread; origin?: Subagent['origin']; contextId: string }

type Entry<H> =
  | { state: 'opening'; pending: Promise<ResidentChild<H> | undefined> }
  | { state: 'attached' | 'closing'; resource: ResidentChild<H> }
  | { state: 'releasing'; pending: Promise<void> }

export function childKey(backendId: string, id: string): string {
  return JSON.stringify([backendId, id])
}

/**
 * Which observed child threads of one root connection hold their native history in memory.
 * A finished, unpinned child is flushed, marked settled, and released; it reopens when asked for,
 * and a cold reopen leaves settled children unloaded.
 */
export class ChildResidency<H extends { release(): Promise<void> }> {
  private readonly entries = new Map<string, Entry<H>>()
  private readonly released = new Map<string, ReleasedChild>()
  private readonly residents = new WeakMap<ChildThreadProjection, ResidentChild<H>>()
  /** Views held by callers follow a child across release and reopen without keeping it loaded. */
  private readonly views = new Map<string, WeakRef<{ projection: ChildThreadProjection }>>()

  /**
   * @param host.accepting whether a child may still open
   * @param host.closing whether the owner is closing, after which only `close` releases children
   */
  constructor(private readonly host: { accepting(): boolean; closing(): boolean }) {}

  /** Records the settled descendants of `parentContextId` as released, so discovery leaves them unloaded. */
  restoreReleased(parentContextId: string): void {
    for (const context of contexts.children(parentContextId)) {
      if (context.bindingState === 'bound' && context.nativeThreadId && context.checkpointMapping?.child?.settled) {
        const key = childKey(context.backendId, context.nativeThreadId)
        if (!this.entries.has(key))
          this.released.set(key, {
            thread: { backendId: runtimeId(context.backendId), id: runtimeId(context.nativeThreadId) },
            origin: context.spawnToolCallId ? { toolCallId: context.spawnToolCallId } : undefined,
            contextId: context.id
          })
      }
      this.restoreReleased(context.id)
    }
  }

  isReleased(key: string): boolean {
    return this.released.has(key)
  }

  origin(key: string): Subagent['origin'] {
    const entry = this.entries.get(key)
    return entry && 'resource' in entry ? entry.resource.relation?.origin : this.released.get(key)?.origin
  }

  /**
   * Returns the child under `key`, opening it when absent; an explicit open also reloads a released child.
   * `granted` is a handle the caller already holds; it is released when the child is already open.
   */
  async open(
    key: string,
    source: {
      granted?: H
      acquire(): Promise<H>
      build(handle: H): Promise<{ relation?: Subagent; projection: ChildThreadProjection }>
      /** Runs once the child is newly attached. */
      attached?(resource: ResidentChild<H>): void
    }
  ): Promise<ResidentChild<H> | undefined> {
    const existing = this.entries.get(key)
    if (existing) {
      await source.granted?.release()
      if (existing.state === 'releasing') {
        await existing.pending
        return this.open(key, { ...source, granted: undefined })
      }
      if (existing.state === 'closing') {
        await existing.resource.projection.stop()
        await existing.resource.handle.release()
        this.entries.delete(key)
        return this.open(key, { ...source, granted: undefined })
      }
      return existing.state === 'opening' ? existing.pending : existing.resource
    }
    if (!this.host.accepting()) {
      await source.granted?.release()
      return undefined
    }
    let handle: H | undefined
    let resource: ResidentChild<H> | undefined
    const pending = Promise.resolve()
      .then(async () => {
        handle = source.granted ?? (await source.acquire())
        const { relation, projection } = await source.build(handle)
        resource = { key, relation, handle, projection, pins: 0, finished: false }
        this.residents.set(projection, resource)
        const view = this.views.get(key)?.deref()
        if (view) view.projection = projection
        // A reloaded child may run again; a cold reopen must restore it until it settles anew.
        if (projection.context.checkpointMapping?.child?.settled) contexts.settleChild(projection.context.id, false)
        await projection.attach()
        this.released.delete(key)
        this.entries.set(key, { state: 'attached', resource })
        source.attached?.(resource)
        // Callers pin in their continuation; check afterwards so a reopened finished child is not released under them.
        setImmediate(() => this.releaseIfIdle(key))
        return resource
      })
      .catch(async (error) => {
        logger.error('Failed to observe child thread', { key, error })
        if (resource) {
          try {
            await resource.projection.stop()
          } catch (flushError) {
            this.entries.set(key, { state: 'closing', resource })
            logger.error('Failed to flush child attachment', { key, error: flushError })
            return undefined
          }
        }
        await handle?.release()
        this.entries.delete(key)
        return undefined
      })
    this.entries.set(key, { state: 'opening', pending })
    return pending
  }

  /** Records whether the child's native work finished; a finished, unpinned child is released. */
  finish(projection: ChildThreadProjection, finished: boolean): void {
    const resource = this.residents.get(projection)
    if (!resource) return
    resource.finished = finished
    this.releaseIfIdle(resource.key)
  }

  /** Keeps the child loaded until the returned function runs. */
  pin(resource: ResidentChild<H>): () => void {
    resource.pins++
    let pinned = true
    return () => {
      if (!pinned) return
      pinned = false
      resource.pins--
      this.releaseIfIdle(resource.key)
    }
  }

  async resource(key: string): Promise<ResidentChild<H> | undefined> {
    const entry = this.entries.get(key)
    if (entry?.state === 'releasing') return undefined
    return entry?.state === 'opening' ? entry.pending : entry?.resource
  }

  async resources(): Promise<ResidentChild<H>[]> {
    const resources: ResidentChild<H>[] = []
    for (const entry of this.entries.values()) {
      if (entry.state === 'releasing') continue
      const resource = entry.state === 'opening' ? await entry.pending : entry.resource
      if (resource) resources.push(resource)
    }
    return resources
  }

  /** Joins pending child writes, including the flush of a child being released. */
  async drain(): Promise<void> {
    for (const entry of [...this.entries.values()]) if (entry.state === 'releasing') await entry.pending
    for (const child of await this.resources()) await child.projection.drain()
  }

  /** The child saved under `contextId`; a released one is reloaded through `reopen`. */
  async forContext(
    contextId: string,
    reopen: (child: ReleasedChild) => Promise<ResidentChild<H> | undefined>
  ): Promise<ResidentChild<H> | undefined> {
    for (const entry of [...this.entries.values()]) if (entry.state === 'releasing') await entry.pending
    const loaded = (await this.resources()).find((child) => child.projection.context.id === contextId)
    if (loaded) return loaded
    const released = [...this.released.values()].find((child) => child.contextId === contextId)
    return released && reopen(released)
  }

  /** A subscribed viewer pins the child; the last unsubscribe lets a finished child release. */
  async watch(resource: ResidentChild<H>) {
    const unpin = this.pin(resource)
    try {
      await resource.projection.attach()
    } finally {
      // Callers subscribe in their continuation; keep a finished child loaded until then.
      setImmediate(unpin)
    }
    let view = this.views.get(resource.key)?.deref()
    if (!view) this.views.set(resource.key, new WeakRef((view = { projection: resource.projection })))
    const current = view
    return {
      snapshot: () => current.projection.snapshot(),
      subscribe: (listener: Parameters<ChildThreadProjection['subscribe']>[0]) => {
        const unpin = this.pin(resource)
        const unsubscribe = resource.projection.subscribe(listener)
        return () => {
          unsubscribe()
          unpin()
        }
      }
    }
  }

  /** Flushes and releases every child; finished ones are marked settled for the next cold reopen. */
  async close(): Promise<void> {
    for (const [key, entry] of this.entries) {
      if (entry.state === 'releasing') await entry.pending
      // A release whose flush failed leaves the child closing for this loop to retry.
      const child = this.entries.get(key)
      if (!child || child.state === 'releasing') continue
      const resource = child.state === 'opening' ? await child.pending : child.resource
      if (!resource) continue
      this.entries.set(key, { state: 'closing', resource })
      await resource.projection.stop()
      if (resource.finished) contexts.settleChild(resource.projection.context.id, true)
      await resource.handle.release()
      this.entries.delete(key)
    }
  }

  private releaseIfIdle(key: string): void {
    const entry = this.entries.get(key)
    if (this.host.closing() || entry?.state !== 'attached') return
    const { resource } = entry
    if (!resource.finished || resource.pins > 0) return
    const { projection } = resource
    const pending = (async () => {
      try {
        await projection.stop()
        contexts.settleChild(projection.context.id, true)
        await resource.handle.release()
        this.released.set(key, {
          thread: projection.thread,
          origin:
            resource.relation?.origin ??
            (projection.context.spawnToolCallId ? { toolCallId: projection.context.spawnToolCallId } : undefined),
          contextId: projection.context.id
        })
        this.entries.delete(key)
      } catch (error) {
        // Keep the unflushed child for the close and reopen retries.
        this.entries.set(key, { state: 'closing', resource })
        logger.error('Failed to release finished child', { key, error })
      }
    })()
    this.entries.set(key, { state: 'releasing', pending })
  }
}
