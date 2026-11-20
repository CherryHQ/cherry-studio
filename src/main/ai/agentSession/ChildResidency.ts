import { runtimeId, type Subagent, type Thread } from '@cherrystudio/agent-runtime'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { loggerService } from '@logger'

import type { ChildThreadProjection } from './ChildThreadProjection'

const logger = loggerService.withContext('ChildResidency')

/** An observed child thread; once its work is idle it stays loaded only while a viewer, command or child pins it. */
export type ResidentChild<H> = {
  readonly key: string
  relation?: Subagent
  handle: H
  projection: ChildThreadProjection
  pins: number
}

/** A child whose native history is not loaded; its saved rows already hold that history. */
export type ReleasedChild = { thread: Thread; origin?: Subagent['origin']; contextId: string }

type Entry<H> =
  | { state: 'opening'; pending: Promise<ResidentChild<H> | undefined> }
  | { state: 'attached' | 'closing'; resource: ResidentChild<H> }
  | { state: 'releasing'; pending: Promise<void>; resource: ResidentChild<H> }

export function childKey(backendId: string, id: string): string {
  return JSON.stringify([backendId, id])
}

/**
 * Which observed child threads of one root connection hold their native history in memory, decided by the work
 * state their parents' relationships report. An idle, unpinned child is flushed, marked settled, and released; it
 * reopens when asked for or when it works again, and a cold reopen leaves settled children unloaded.
 */
export class ChildResidency<H extends { release(): Promise<void> }> {
  private readonly entries = new Map<string, Entry<H>>()
  private readonly released = new Map<string, ReleasedChild>()
  /** The latest work state a relationship reported for each child. */
  private readonly work = new Map<string, Subagent['work']>()
  /** Releases the pin a loaded child holds on its parent child, whose observation carries its relationships. */
  private readonly parentPins = new Map<string, () => void>()
  private readonly restoring = new Set<string>()
  private restores = Promise.resolve()
  /** Views held by callers follow a child across release and reopen without keeping it loaded. */
  private readonly views = new Map<string, WeakRef<{ projection: ChildThreadProjection }>>()

  /**
   * @param host.accepting whether a child may still open
   * @param host.closing whether the owner is closing, after which only `close` releases children
   */
  constructor(private readonly host: { accepting(): boolean; closing(): boolean }) {}

  /**
   * Records the settled descendants of `parentContextId` as released, so discovery leaves them unloaded. A child with
   * an unsettled descendant stays unreleased: its observation carries that descendant's relationship.
   * @returns whether every descendant is settled
   */
  restoreReleased(parentContextId: string): boolean {
    let settled = true
    for (const context of contexts.children(parentContextId)) {
      const subtree = this.restoreReleased(context.id)
      if (
        subtree &&
        context.bindingState === 'bound' &&
        context.nativeThreadId &&
        context.checkpointMapping?.child?.settled
      ) {
        const key = childKey(context.backendId, context.nativeThreadId)
        if (!this.entries.has(key))
          this.released.set(key, {
            thread: { backendId: runtimeId(context.backendId), id: runtimeId(context.nativeThreadId) },
            origin: context.spawnToolCallId ? { toolCallId: context.spawnToolCallId } : undefined,
            contextId: context.id
          })
      } else settled = false
    }
    return settled
  }

  /**
   * Applies a relationship a parent observed. A loaded child releases once its work is idle; an unloaded one opens
   * when it works, and an unseen idle one is restored one at a time so its saved rows catch up before it settles.
   */
  relate(relation: Subagent, open: () => Promise<unknown>): void {
    if (!relation.child) return
    const key = childKey(relation.child.backendId, relation.child.id)
    this.work.set(key, relation.work)
    const entry = this.entries.get(key)
    if (entry?.state === 'attached') {
      entry.resource.relation = { ...entry.resource.relation, ...relation }
      this.releaseIfIdle(key)
    } else if (relation.work !== 'idle') {
      this.unsettle(key)
      void open().catch((error) => logger.warn('Failed to reopen child thread', { key, error }))
    } else if (!entry && !this.released.has(key) && !this.restoring.has(key)) {
      this.restoring.add(key)
      this.restores = this.restores
        .then(async () => {
          if (this.entries.has(key) || this.released.has(key)) return
          await open()
          await this.settle()
        })
        .catch((error) => logger.warn('Failed to restore child thread', { key, error }))
        .finally(() => this.restoring.delete(key))
    }
  }

  origin(key: string): Subagent['origin'] {
    const entry = this.entries.get(key)
    return entry && 'resource' in entry ? entry.resource.relation?.origin : this.released.get(key)?.origin
  }

  /**
   * Returns the child under `key`, opening it when absent; an explicit open also reloads a released child.
   * `granted` is a handle the caller already holds; it is released when the child is already open. `build` calls
   * `hold` with the child's relationship once it knows it, so the parent child stays loaded through the rest of it.
   */
  async open(
    key: string,
    source: {
      granted?: H
      acquire(): Promise<H>
      build(
        handle: H,
        hold: (relation: Subagent | undefined) => void
      ): Promise<{ relation?: Subagent; projection: ChildThreadProjection }>
      /** Runs once the child is newly attached. */
      attached?(resource: ResidentChild<H>): void
    }
  ): Promise<ResidentChild<H> | undefined> {
    const existing = this.entries.get(key)
    if (existing) {
      // Reopen in the turn the release ends, so a lookup made after this open resolves to the reopen.
      if (existing.state === 'releasing') {
        await existing.pending
        return this.open(key, source)
      }
      if (source.granted) {
        await source.granted.release()
        // The entry can change while the redundant handle releases.
        return this.open(key, { ...source, granted: undefined })
      }
      if (existing.state === 'closing') {
        await this.retryClose(key, existing.resource)
        return this.open(key, source)
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
        const hold = (relation: Subagent | undefined) => this.pinParent(key, relation)
        const { relation, projection } = await source.build(handle, hold)
        resource = { key, relation, handle, projection, pins: 0 }
        if (relation && !this.work.has(key)) this.work.set(key, relation.work)
        const view = this.views.get(key)?.deref()
        if (view) view.projection = projection
        hold(relation)
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
        this.unpinParent(key)
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

  /**
   * Pins the child for a command whose input outdates earlier work evidence until a relationship reports again.
   * @returns the unpin; pass `admitted: false` when the input was refused, restoring the evidence if nothing newer came
   */
  command(resource: ResidentChild<H>): (admitted: boolean) => void {
    const prior = this.work.get(resource.key)
    this.work.delete(resource.key)
    const unpin = this.pin(resource)
    return (admitted) => {
      if (!admitted && !this.work.has(resource.key)) this.work.set(resource.key, prior)
      unpin()
    }
  }

  /** The child under `key`; a releasing one resolves to its reopen when work resumed, else to undefined. */
  async resource(key: string): Promise<ResidentChild<H> | undefined> {
    let entry = this.entries.get(key)
    while (entry?.state === 'releasing') {
      await entry.pending
      entry = this.entries.get(key)
    }
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

  /**
   * Pins the attached children `match` selects. Opens and releases in flight are joined first and the selection is
   * made in the same turn as the pins, so no selected child is mid-release.
   */
  async pinLoaded(
    match: (child: ResidentChild<H>) => boolean
  ): Promise<{ children: ResidentChild<H>[]; unpin(): void }> {
    for (let pending = this.inFlight(); pending.length; pending = this.inFlight()) await Promise.all(pending)
    const children = [...this.entries.values()].flatMap((entry) =>
      entry.state === 'attached' && match(entry.resource) ? [entry.resource] : []
    )
    const unpins = children.map((child) => this.pin(child))
    return { children, unpin: () => unpins.forEach((unpin) => unpin()) }
  }

  /** Joins pending child writes: queued restores, opens, releases and every loaded child's projection. */
  async drain(): Promise<void> {
    for (;;) {
      const restores = this.restores
      await restores
      await Promise.all(this.inFlight())
      // An open defers its release check to `setImmediate`; join the release it starts as well.
      await new Promise((resolve) => setImmediate(resolve))
      if (restores !== this.restores || this.inFlight().length) continue
      // A parent's projection drain can deliver relationships that restore, open or release more children.
      for (const child of await this.resources()) await child.projection.drain()
      if (restores === this.restores && !this.inFlight().length) return
    }
  }

  /** The child saved under `contextId`, pinned for the caller; a released one is reloaded through `reopen`. */
  async forContext(
    contextId: string,
    reopen: (child: ReleasedChild) => Promise<ResidentChild<H> | undefined>
  ): Promise<{ child: ResidentChild<H>; unpin(): void } | undefined> {
    const loaded = await this.pinLoaded((child) => child.projection.context.id === contextId)
    if (loaded.children[0]) return { child: loaded.children[0], unpin: loaded.unpin }
    const released = [...this.released.values()].find((child) => child.contextId === contextId)
    const child = released && (await reopen(released))
    return child && { child, unpin: this.pin(child) }
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

  /** Flushes and releases every child; idle ones are marked settled for the next cold reopen. */
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
      if (this.work.get(key) === 'idle') contexts.settleChild(resource.projection.context.id, true)
      await resource.handle.release()
      this.entries.delete(key)
    }
    this.parentPins.clear()
  }

  private inFlight(): Promise<unknown>[] {
    return [...this.entries.values()].flatMap((entry) =>
      entry.state === 'opening' || entry.state === 'releasing' ? [entry.pending] : []
    )
  }

  private releases(): Promise<unknown>[] {
    return [...this.entries.values()].flatMap((entry) => (entry.state === 'releasing' ? [entry.pending] : []))
  }

  /** Pins the parent child that carries `relation` once, so it stays loaded while the child under `key` is. */
  private pinParent(key: string, relation: Subagent | undefined): void {
    if (!relation || this.parentPins.has(key)) return
    const parent = this.entries.get(childKey(relation.parent.backendId, relation.parent.id))
    if (parent?.state === 'attached') this.parentPins.set(key, this.pin(parent.resource))
  }

  private unpinParent(key: string): void {
    this.parentPins.get(key)?.()
    this.parentPins.delete(key)
  }

  /** A released child that works again outgrows its saved rows; dropping its marker lets a failed reopen retry. */
  private unsettle(key: string): void {
    const released = this.released.get(key)
    if (!released) return
    this.released.delete(key)
    contexts.settleChild(released.contextId, false)
  }

  /**
   * Waits for the idle check `open` defers to `setImmediate`, then for every release it set off, including the
   * parent release a nested child's release unpins.
   */
  private async settle(): Promise<void> {
    await new Promise((resolve) => setImmediate(resolve))
    for (let releases = this.releases(); releases.length; releases = this.releases()) await Promise.all(releases)
  }

  /** Retries the flush and release of a child whose earlier flush failed; concurrent opens share one retry. */
  private retryClose(key: string, resource: ResidentChild<H>): Promise<void> {
    const pending = (async () => {
      try {
        await resource.projection.stop()
        await resource.handle.release()
        this.entries.delete(key)
        this.unpinParent(key)
      } catch (error) {
        this.entries.set(key, { state: 'closing', resource })
        throw error
      }
    })()
    this.entries.set(key, { state: 'releasing', pending: pending.catch(() => {}), resource })
    return pending
  }

  private releaseIfIdle(key: string): void {
    const entry = this.entries.get(key)
    if (this.host.closing() || entry?.state !== 'attached') return
    const { resource } = entry
    if (this.work.get(key) !== 'idle' || resource.pins > 0) return
    const { projection } = resource
    const pending = (async () => {
      try {
        await projection.stop()
        // Work reported during the flush is not in the saved rows; an unsettled child is restored again.
        const idle = this.work.get(key) === 'idle'
        if (idle) contexts.settleChild(projection.context.id, true)
        await resource.handle.release()
        if (idle)
          this.released.set(key, {
            thread: projection.thread,
            origin:
              resource.relation?.origin ??
              (projection.context.spawnToolCallId ? { toolCallId: projection.context.spawnToolCallId } : undefined),
            contextId: projection.context.id
          })
        this.entries.delete(key)
        this.unpinParent(key)
      } catch (error) {
        // Keep the unflushed child for the close and reopen retries.
        this.entries.set(key, { state: 'closing', resource })
        logger.error('Failed to release finished child', { key, error })
      }
    })()
    this.entries.set(key, { state: 'releasing', pending, resource })
  }
}
