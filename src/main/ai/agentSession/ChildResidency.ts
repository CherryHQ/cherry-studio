import { runtimeId, type Subagent, type Thread } from '@cherrystudio/agent-runtime'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { loggerService } from '@logger'
import { createLatestReconciler, type LatestReconciler } from '@main/core/concurrency/latestReconciler'

import type { ChildThreadProjection } from './ChildThreadProjection'

const logger = loggerService.withContext('ChildResidency')

/** An observed child thread; once its work is idle it stays loaded only while a viewer, command or child pins it. */
export type ResidentChild<H> = {
  readonly key: string
  relation?: Subagent
  handle: H
  projection: ChildThreadProjection
}

/** A child whose native history is not loaded; its saved rows hold that history up to `revision`. */
export type ReleasedChild = { thread: Thread; origin?: Subagent['origin']; contextId: string; revision?: number }

type Source<H> = {
  granted?: H
  acquire(): Promise<H>
  build(
    handle: H,
    hold: (relation: Subagent | undefined) => void
  ): Promise<{ relation?: Subagent; projection: ChildThreadProjection }>
  /** Runs once the child is newly attached. */
  attached?(resource: ResidentChild<H>): void
}

/**
 * One child's desired state (work evidence and pins) and actual state (loaded resource or saved rows). Only its
 * reconciler changes the actual state, one step at a time.
 */
type Child<H> = {
  readonly key: string
  relation?: Subagent
  /** The latest work evidence; `known` is false after a command until a relationship reports again. */
  work?: Subagent['work']
  known: boolean
  pins: number
  source?: Source<H>
  granted?: H
  phase: 'released' | 'opening' | 'attached' | 'releasing' | 'failed'
  resource?: ResidentChild<H>
  saved?: ReleasedChild
  /** Releases the pin this child holds on its parent child, whose observation carries its relationships. */
  unhold?: () => void
  readonly reconciler: LatestReconciler
}

export function childKey(backendId: string, id: string): string {
  return JSON.stringify([backendId, id])
}

/**
 * Which observed child threads of one root connection hold their native history in memory. A child stays loaded
 * while it works or is pinned; otherwise it is flushed, marked settled at the revision the flush read, and released.
 * It reloads when asked for, when it works again, or when a relationship reports a newer revision than its saved rows.
 */
export class ChildResidency<H extends { release(): Promise<void> }> {
  private readonly children = new Map<string, Child<H>>()
  private readonly restoring = new Set<string>()
  private restores = Promise.resolve()
  /** Counts reconcile steps, so a drain can tell whether a pass changed anything. */
  private steps = 0
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
      const saved = context.checkpointMapping?.child
      if (subtree && context.bindingState === 'bound' && context.nativeThreadId && saved?.settled) {
        const child = this.child(childKey(context.backendId, context.nativeThreadId))
        if (child.phase === 'released')
          child.saved = {
            thread: { backendId: runtimeId(context.backendId), id: runtimeId(context.nativeThreadId) },
            origin: context.spawnToolCallId ? { toolCallId: context.spawnToolCallId } : undefined,
            contextId: context.id,
            revision: saved.settledRevision
          }
      } else settled = false
    }
    return settled
  }

  /**
   * Applies a relationship a parent observed. An unloaded child opens when it works; one whose saved rows are missing
   * or older than the relationship's revision is restored one at a time, so its rows catch up before it settles.
   */
  relate(relation: Subagent, open: () => Promise<unknown>): void {
    if (!relation.child) return
    const key = childKey(relation.child.backendId, relation.child.id)
    const child = this.child(key)
    child.relation = relation
    child.work = relation.work
    child.known = true
    if (child.resource) child.resource.relation = { ...child.resource.relation, ...relation }
    if (child.phase !== 'released') child.reconciler.request()
    else if (relation.work !== 'idle')
      void open().catch((error) => logger.warn('Failed to reopen child thread', { key, error }))
    else if (!this.current(child)) this.restore(key, open)
  }

  origin(key: string): Subagent['origin'] {
    const child = this.children.get(key)
    return child?.resource?.relation?.origin ?? child?.saved?.origin
  }

  /**
   * Returns the child under `key`, opening it when absent; an explicit open also reloads a released child.
   * `granted` is a handle the caller already holds; it is released when the child is already open. `build` calls
   * `hold` with the child's relationship once it knows it, so the parent child stays loaded through the rest of it.
   */
  async open(key: string, source: Source<H>): Promise<ResidentChild<H> | undefined> {
    const child = this.child(key)
    if (!child.resource && !this.host.accepting()) {
      await source.granted?.release()
      return undefined
    }
    child.source = source
    const stored = !!source.granted && !child.granted
    if (stored) child.granted = source.granted
    // Held until callers pin in their continuation, so a reopened finished child is not released under them.
    const unpin = this.hold(child)
    try {
      await child.reconciler.flush()
      // A step that used the handle took it; an unused or redundant one is the caller's to release.
      if (source.granted && (!stored || child.granted === source.granted)) {
        if (stored) child.granted = undefined
        await source.granted.release()
      }
      return child.phase === 'attached' ? child.resource : undefined
    } finally {
      setImmediate(unpin)
    }
  }

  /** Keeps the child loaded until the returned function runs. */
  pin(resource: ResidentChild<H>): () => void {
    return this.hold(this.child(resource.key))
  }

  /**
   * Pins the child for a command whose input outdates earlier work evidence until a relationship reports again.
   * @returns the unpin; pass `admitted: false` when the input was refused, restoring the evidence if nothing newer came
   */
  command(resource: ResidentChild<H>): (admitted: boolean) => void {
    const child = this.child(resource.key)
    const prior = { work: child.work, known: child.known }
    child.work = undefined
    child.known = false
    const unpin = this.hold(child)
    return (admitted) => {
      if (!admitted && !child.known) Object.assign(child, prior)
      unpin()
    }
  }

  /** The loaded child under `key` once its pending steps finish, which include the reopen of a child working again. */
  async resource(key: string): Promise<ResidentChild<H> | undefined> {
    const child = this.children.get(key)
    await child?.reconciler.flush()
    return child?.phase === 'attached' ? child.resource : undefined
  }

  async resources(): Promise<ResidentChild<H>[]> {
    await this.quiesce()
    return this.attached()
  }

  /**
   * Pins the attached children `match` selects. Pending steps are joined first and the selection is made in the same
   * turn as the pins, so no selected child is mid-release.
   */
  async pinLoaded(
    match: (child: ResidentChild<H>) => boolean
  ): Promise<{ children: ResidentChild<H>[]; unpin(): void }> {
    await this.quiesce()
    const children = this.attached().filter(match)
    const unpins = children.map((child) => this.pin(child))
    return { children, unpin: () => unpins.forEach((unpin) => unpin()) }
  }

  /** Joins pending child writes: queued restores, every child's pending steps and every loaded child's projection. */
  async drain(): Promise<void> {
    for (;;) {
      const restores = this.restores
      await restores
      await this.quiesce()
      // An open releases its own pin on `setImmediate`; join the release that sets off as well.
      await new Promise((resolve) => setImmediate(resolve))
      await this.quiesce()
      if (restores !== this.restores) continue
      // A parent's projection drain can deliver relationships that restore, open or release more children.
      const steps = this.steps
      for (const child of this.attached()) await child.projection.drain()
      await this.quiesce()
      if (restores === this.restores && steps === this.steps) return
    }
  }

  /** The child saved under `contextId`, pinned for the caller; a released one is reloaded through `reopen`. */
  async forContext(
    contextId: string,
    reopen: (child: ReleasedChild) => Promise<ResidentChild<H> | undefined>
  ): Promise<{ child: ResidentChild<H>; unpin(): void } | undefined> {
    const loaded = await this.pinLoaded((child) => child.projection.context.id === contextId)
    if (loaded.children[0]) return { child: loaded.children[0], unpin: loaded.unpin }
    const released = [...this.children.values()].find(
      (child) => child.phase === 'released' && child.saved?.contextId === contextId
    )?.saved
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

  /** Flushes and releases every child once the host is closing; idle ones are marked settled for the next reopen. */
  async close(): Promise<void> {
    for (const child of this.children.values()) {
      await child.reconciler.flush()
      const { resource } = child
      if (!resource) continue
      child.phase = 'releasing'
      await resource.projection.stop()
      if (child.work === 'idle')
        contexts.settleChild(resource.projection.context.id, true, resource.projection.revision)
      await resource.handle.release()
      child.resource = undefined
      child.phase = 'released'
      child.unhold?.()
      child.unhold = undefined
    }
  }

  private child(key: string): Child<H> {
    let child = this.children.get(key)
    if (child) return child
    const created: Child<H> = {
      key,
      known: false,
      pins: 0,
      phase: 'released',
      reconciler: createLatestReconciler({
        name: 'ChildResidency',
        getSnapshot: () => undefined,
        isSettled: () => this.settled(created),
        apply: () => this.step(created),
        onError: (error) => logger.warn('Failed to reconcile child thread', { key, error })
      })
    }
    this.children.set(key, (child = created))
    return child
  }

  private attached(): ResidentChild<H>[] {
    return [...this.children.values()].flatMap((child) =>
      child.phase === 'attached' && child.resource ? [child.resource] : []
    )
  }

  /** Waits until no child has a pending step. */
  private async quiesce(): Promise<void> {
    for (let steps = -1; steps !== this.steps;) {
      steps = this.steps
      await Promise.all([...this.children.values()].map((child) => child.reconciler.flush()))
    }
  }

  private hold(child: Child<H>): () => void {
    child.pins++
    child.reconciler.request()
    let held = true
    return () => {
      if (!held) return
      held = false
      child.pins--
      child.reconciler.request()
    }
  }

  /** Whether a released child's saved rows are at least as new as its latest relationship reports. */
  private current(child: Child<H>): boolean {
    const revision = child.relation?.revision
    const saved = child.saved?.revision
    return !!child.saved && (revision === undefined || saved === undefined || revision <= saved)
  }

  private wanted(child: Child<H>): boolean {
    return child.pins > 0 || child.work !== 'idle'
  }

  private settled(child: Child<H>): boolean {
    if (this.host.closing()) return true
    if (child.phase === 'failed') return false
    if (child.resource) return this.wanted(child)
    return !(this.wanted(child) && child.source && this.host.accepting())
  }

  /** Moves the child one step toward its desired state; a failed step stops until the next request. */
  private async step(child: Child<H>): Promise<void> {
    this.steps++
    if (child.resource) await this.release(child)
    else await this.load(child, child.source!)
  }

  private async load(child: Child<H>, source: Source<H>): Promise<void> {
    const { key } = child
    child.phase = 'opening'
    // A reloaded child may run again; a cold reopen must restore it until it settles anew.
    if (child.saved) contexts.settleChild(child.saved.contextId, false)
    child.saved = undefined
    const granted = child.granted
    child.granted = undefined
    let handle: H | undefined
    let resource: ResidentChild<H> | undefined
    try {
      handle = granted ?? (await source.acquire())
      const hold = (relation: Subagent | undefined) => this.holdParent(child, relation)
      const { relation, projection } = await source.build(handle, hold)
      resource = { key, relation, handle, projection }
      if (relation && !child.known) {
        child.work = relation.work
        child.known = true
      }
      const view = this.views.get(key)?.deref()
      if (view) view.projection = projection
      hold(relation)
      if (projection.context.checkpointMapping?.child?.settled) contexts.settleChild(projection.context.id, false)
      await projection.attach()
      child.resource = resource
      child.phase = 'attached'
      source.attached?.(resource)
    } catch (error) {
      child.unhold?.()
      child.unhold = undefined
      if (resource) {
        try {
          await resource.projection.stop()
        } catch (flushError) {
          child.resource = resource
          child.phase = 'failed'
          logger.error('Failed to flush child attachment', { key, error: flushError })
          throw error
        }
      }
      await handle?.release()
      child.phase = 'released'
      throw error
    }
  }

  /** Flushes and releases a loaded child; an idle one is marked settled at the revision its final flush read. */
  private async release(child: Child<H>): Promise<void> {
    const resource = child.resource!
    const { projection } = resource
    child.phase = 'releasing'
    try {
      await projection.stop()
      // Work reported during the flush is not in the saved rows; the next step reloads the child instead.
      const idle = child.work === 'idle'
      if (idle) contexts.settleChild(projection.context.id, true, projection.revision)
      await resource.handle.release()
      child.resource = undefined
      child.phase = 'released'
      if (idle)
        child.saved = {
          thread: projection.thread,
          origin:
            resource.relation?.origin ??
            (projection.context.spawnToolCallId ? { toolCallId: projection.context.spawnToolCallId } : undefined),
          contextId: projection.context.id,
          revision: projection.revision
        }
      child.unhold?.()
      child.unhold = undefined
    } catch (error) {
      // Keep the unflushed child; the next request or the close retries the release.
      child.phase = 'failed'
      throw error
    }
  }

  /** Pins the parent child that carries `relation` once, so it stays loaded while `child` is. */
  private holdParent(child: Child<H>, relation: Subagent | undefined): void {
    if (!relation || child.unhold) return
    const parent = this.children.get(childKey(relation.parent.backendId, relation.parent.id))
    if (parent && parent.phase !== 'released') child.unhold = this.hold(parent)
  }

  private restore(key: string, open: () => Promise<unknown>): void {
    if (this.restoring.has(key)) return
    this.restoring.add(key)
    this.restores = this.restores
      .then(async () => {
        const child = this.child(key)
        if (child.phase !== 'released' || this.current(child)) return
        await open()
        await this.settleRestore(key)
      })
      .catch((error) => logger.warn('Failed to restore child thread', { key, error }))
      .finally(() => this.restoring.delete(key))
  }

  /**
   * Waits for a restored child's release, which follows the pin its open drops on `setImmediate`, and for the parent
   * releases it sets off by unpinning them.
   */
  private async settleRestore(key: string): Promise<void> {
    await new Promise((resolve) => setImmediate(resolve))
    for (let child = this.children.get(key); child;) {
      await child.reconciler.flush()
      const parent = child.relation?.parent
      child = parent && this.children.get(childKey(parent.backendId, parent.id))
    }
  }
}
