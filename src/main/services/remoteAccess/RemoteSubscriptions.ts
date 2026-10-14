import { randomUUID } from 'node:crypto'

import { remoteLimits } from '@cherrystudio/remote-protocol'
import { RemoteRpcError } from '@cherrystudio/remote-transport'
import { loggerService } from '@logger'

export interface RemoteCursor {
  streamEpoch: string
  seq: string
}
export interface RemoteCheckpoint<C extends RemoteCursor, P> {
  descriptor: {
    checkpointId: string
    cursor: C
    expiresAt: string
    byteLength: string
    historyRevision: string
    pageCount: number
    sha256: string
  }
  pages: P[]
  content: Map<string, Uint8Array>
}
export interface RemoteJournal<C extends RemoteCursor, P, E extends { seq: string }> {
  epoch: string
  cursor: C
  firstRetainedSeq: number
  capture(): RemoteCheckpoint<C, P>
  observe(fn: () => void): () => void
  eventsAfter(seq: number, maxBytes: number): E[]
}

const logger = loggerService.withContext('RemoteSubscriptions')
const BATCH_BYTES = 12_000
export interface SnapshotBudget {
  bytes: number
}
export interface SubscriptionBudget {
  count: number
  snapshots: SnapshotBudget
}

interface Subscription<C extends RemoteCursor, P, E extends { seq: string }> {
  id: string
  resourceId: string
  journal: RemoteJournal<C, P, E>
  epoch: string
  phase: 'prepared' | 'active' | 'reset'
  cursorSeq: number
  lastSent: number
  lastAck: number
  sent: Map<number, number>
  unackedBytes: number
  checkpoint?: RemoteCheckpoint<C, P>
  checkpointBytes: number
  expiresAt: number
  pump: Promise<void>
  unobserve: () => void
}

/** Connection-private subscription state over the shared journals; IDs never leave this connection. */
export class RemoteSubscriptions<C extends RemoteCursor, P, E extends { seq: string }> {
  private readonly subscriptions = new Map<string, Subscription<C, P, E>>()

  constructor(
    private readonly hub: { journal(id: string): RemoteJournal<C, P, E> },
    private readonly send: (notification: unknown) => Promise<void>,
    private readonly profile: {
      namespace: 'agent' | 'assistant'
      resourceKey: 'sessionId' | 'topicId'
      resourceOf(cursor: C): string
      cursor(id: string, epoch: string, seq: string): C
    },
    private readonly budget: SubscriptionBudget = { count: 0, snapshots: { bytes: 0 } }
  ) {}

  subscribe(input: {
    resourceId: string
    cursor?: C
  }):
    | { subscriptionId: string; mode: 'replay'; fromCursor: C; highWatermark: C; leaseExpiresAt: string }
    | { subscriptionId: string; mode: 'checkpoint'; reason: string; checkpoint: RemoteCheckpoint<C, P>['descriptor'] } {
    for (const existing of this.subscriptions.values()) {
      if (existing.resourceId === input.resourceId && existing.phase !== 'reset')
        throw new RemoteRpcError('CONFLICT', 'Conversation already has a subscription on this connection')
    }
    if (this.budget.count >= remoteLimits.subscriptions)
      throw new RemoteRpcError('RESOURCE_EXHAUSTED', 'Too many subscriptions')
    const journal = this.hub.journal(input.resourceId)
    const expiresAt = Date.now() + remoteLimits.checkpointMs
    const subscription: Subscription<C, P, E> = {
      id: randomUUID(),
      resourceId: input.resourceId,
      journal,
      epoch: journal.epoch,
      phase: 'prepared',
      cursorSeq: 0,
      lastSent: 0,
      lastAck: 0,
      sent: new Map(),
      unackedBytes: 0,
      checkpointBytes: 0,
      expiresAt,
      pump: Promise.resolve(),
      unobserve: () => {}
    }
    const cursor = input.cursor
    const current = journal.cursor
    const reason = !cursor
      ? 'no cursor'
      : this.profile.resourceOf(cursor) !== input.resourceId || cursor.streamEpoch !== journal.epoch
        ? 'epoch changed'
        : Number(cursor.seq) > Number(current.seq)
          ? 'cursor ahead of watermark'
          : Number(cursor.seq) + 1 < journal.firstRetainedSeq
            ? 'replay window evicted'
            : undefined
    if (cursor && !reason) {
      subscription.cursorSeq = Number(cursor.seq)
      subscription.unobserve = journal.observe(() => this.schedule(subscription))
      this.subscriptions.set(subscription.id, subscription)
      this.budget.count += 1
      return {
        subscriptionId: subscription.id,
        mode: 'replay',
        fromCursor: cursor,
        highWatermark: current,
        leaseExpiresAt: new Date(expiresAt).toISOString()
      }
    }
    const checkpoint = journal.capture()
    const snapshotBytes =
      Number(checkpoint.descriptor.byteLength) +
      [...checkpoint.content.values()].reduce((total, bytes) => total + bytes.length, 0)
    if (snapshotBytes + this.budget.snapshots.bytes > remoteLimits.globalCheckpointBytes)
      throw new RemoteRpcError('RESOURCE_EXHAUSTED', 'Checkpoint content budget exceeded')
    subscription.checkpointBytes = snapshotBytes
    this.budget.snapshots.bytes += snapshotBytes
    subscription.cursorSeq = Number(checkpoint.descriptor.cursor.seq)
    subscription.checkpoint = checkpoint
    subscription.unobserve = journal.observe(() => this.schedule(subscription))
    this.subscriptions.set(subscription.id, subscription)
    this.budget.count += 1
    return {
      subscriptionId: subscription.id,
      mode: 'checkpoint',
      reason: reason ?? 'no cursor',
      checkpoint: checkpoint.descriptor
    }
  }

  readCheckpoint(input: { subscriptionId: string; checkpointId: string; pageCursor?: string }): P {
    const subscription = this.require(input.subscriptionId)
    const checkpoint = subscription.checkpoint
    if (subscription.phase !== 'prepared' || !checkpoint || checkpoint.descriptor.checkpointId !== input.checkpointId)
      throw new RemoteRpcError('NOT_FOUND', 'Checkpoint is not available')
    if (subscription.expiresAt <= Date.now()) throw new RemoteRpcError('CHECKPOINT_EXPIRED', 'Checkpoint lease expired')
    const index = input.pageCursor === undefined ? 0 : Number(input.pageCursor)
    const page = Number.isSafeInteger(index) ? checkpoint.pages[index] : undefined
    if (!page) throw new RemoteRpcError('NOT_FOUND', 'Checkpoint page not found')
    return page
  }

  /** Switches to live delivery; the caller must send the reply before `commit` releases the suffix. */
  activate(input: { subscriptionId: string; appliedCursor: C }): {
    result: { subscriptionId: string; status: 'active' }
    commit: () => void
  } {
    const subscription = this.require(input.subscriptionId)
    if (subscription.phase !== 'prepared')
      throw new RemoteRpcError('CONFLICT', 'Subscription is not awaiting activation')
    if (subscription.expiresAt <= Date.now()) {
      this.reset(subscription, 'CHECKPOINT_EXPIRED')
      throw new RemoteRpcError('CHECKPOINT_EXPIRED', 'Preparation lease expired')
    }
    const { appliedCursor } = input
    if (
      this.profile.resourceOf(appliedCursor) !== subscription.resourceId ||
      appliedCursor.streamEpoch !== subscription.epoch ||
      Number(appliedCursor.seq) !== subscription.cursorSeq
    )
      throw new RemoteRpcError('CONFLICT', 'Applied cursor does not match the prepared cursor')
    if (!this.intact(subscription)) {
      this.reset(subscription, 'RESET_REQUIRED')
      throw new RemoteRpcError('RESET_REQUIRED', 'Replay suffix is no longer retained')
    }
    return {
      result: { subscriptionId: subscription.id, status: 'active' },
      commit: () => {
        if (subscription.phase !== 'prepared') return
        subscription.phase = 'active'
        subscription.checkpoint = undefined
        this.budget.snapshots.bytes -= subscription.checkpointBytes
        subscription.checkpointBytes = 0
        subscription.lastSent = subscription.cursorSeq
        subscription.lastAck = subscription.cursorSeq
        this.schedule(subscription)
      }
    }
  }

  ack(input: { subscriptionId: string; cursor: C }): { acknowledged: C } {
    const subscription = this.require(input.subscriptionId)
    const seq = Number(input.cursor.seq)
    if (
      subscription.phase !== 'active' ||
      this.profile.resourceOf(input.cursor) !== subscription.resourceId ||
      input.cursor.streamEpoch !== subscription.epoch ||
      seq < subscription.lastAck ||
      seq > subscription.lastSent
    )
      throw new RemoteRpcError('CONFLICT', 'Cursor is outside the delivered window')
    for (const [sentSeq, bytes] of subscription.sent) {
      if (sentSeq <= seq) {
        subscription.unackedBytes -= bytes
        subscription.sent.delete(sentSeq)
      }
    }
    subscription.lastAck = seq
    this.schedule(subscription)
    return { acknowledged: this.profile.cursor(subscription.resourceId, subscription.epoch, String(seq)) }
  }

  close(subscriptionId: string): void {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) return
    subscription.unobserve()
    subscription.phase = 'reset'
    this.subscriptions.delete(subscriptionId)
    this.budget.count -= 1
    this.budget.snapshots.bytes -= subscription.checkpointBytes
  }

  readContent(resourceId: string, contentId: string, revision: string): Uint8Array | undefined {
    for (const subscription of this.subscriptions.values()) {
      const bytes =
        subscription.resourceId === resourceId
          ? subscription.checkpoint?.content.get(`${contentId}:${revision}`)
          : undefined
      if (bytes) return bytes
    }
    return undefined
  }

  sweep(): void {
    for (const subscription of this.subscriptions.values()) {
      if (subscription.phase === 'prepared' && subscription.expiresAt <= Date.now()) this.close(subscription.id)
      else if (subscription.phase === 'active' && !this.intact(subscription)) this.reset(subscription, 'RESET_REQUIRED')
    }
  }

  dispose(): void {
    for (const id of [...this.subscriptions.keys()]) this.close(id)
  }

  private require(subscriptionId: string): Subscription<C, P, E> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) throw new RemoteRpcError('NOT_FOUND', 'Unknown subscription')
    return subscription
  }

  private intact(subscription: Subscription<C, P, E>): boolean {
    const from = subscription.phase === 'active' ? subscription.lastSent : subscription.cursorSeq
    return subscription.journal.epoch === subscription.epoch && subscription.journal.firstRetainedSeq <= from + 1
  }

  private reset(
    subscription: Subscription<C, P, E>,
    reason: 'RESET_REQUIRED' | 'CHECKPOINT_EXPIRED' | 'RESOURCE_EXHAUSTED'
  ): void {
    this.close(subscription.id)
    this.send({
      jsonrpc: '2.0',
      method: `${this.profile.namespace}.subscriptions.resetRequired`,
      params: { subscriptionId: subscription.id, reason }
    }).catch((error: unknown) => logger.warn('Failed to deliver subscription reset', error as Error))
  }

  private schedule(subscription: Subscription<C, P, E>): void {
    subscription.pump = subscription.pump
      .then(() => this.pump(subscription))
      .catch((error: unknown) => logger.warn('Subscription pump failed', error as Error))
  }

  private async pump(subscription: Subscription<C, P, E>): Promise<void> {
    while (subscription.phase === 'active' && subscription.unackedBytes < remoteLimits.unackedBytes) {
      if (!this.intact(subscription)) {
        this.reset(subscription, 'RESET_REQUIRED')
        return
      }
      const events = subscription.journal.eventsAfter(subscription.lastSent, BATCH_BYTES)
      if (!events.length) return
      const params = {
        subscriptionId: subscription.id,
        [this.profile.resourceKey]: subscription.resourceId,
        streamEpoch: subscription.epoch,
        events
      }
      const bytes = Buffer.byteLength(JSON.stringify(params))
      const lastSeq = Number(events[events.length - 1].seq)
      subscription.lastSent = lastSeq
      subscription.sent.set(lastSeq, bytes)
      subscription.unackedBytes += bytes
      await this.send({ jsonrpc: '2.0', method: `${this.profile.namespace}.events`, params })
    }
  }
}
