import { randomUUID } from 'node:crypto'

import { remoteLimits } from '@cherrystudio/remote-protocol'
import type { AgentCheckpointPage, AgentParams, AgentResult } from '@cherrystudio/remote-protocol/agent'
import { RemoteRpcError } from '@cherrystudio/remote-transport'
import { loggerService } from '@logger'

import type { Checkpoint, RemoteAgentHub, SessionJournal } from './agentJournal'

const logger = loggerService.withContext('RemoteAgentSubscriptions')
const BATCH_BYTES = 12_000

interface Subscription {
  id: string
  sessionId: string
  journal: SessionJournal
  epoch: string
  phase: 'prepared' | 'active' | 'reset'
  cursorSeq: number
  lastSent: number
  lastAck: number
  sent: Map<number, number>
  unackedBytes: number
  checkpoint?: Checkpoint
  expiresAt: number
  pump: Promise<void>
  unobserve: () => void
}

/** Connection-private subscription state over the shared journals; IDs never leave this connection. */
export class AgentSubscriptions {
  private readonly subscriptions = new Map<string, Subscription>()

  constructor(
    private readonly hub: RemoteAgentHub,
    private readonly send: (notification: unknown) => Promise<void>
  ) {}

  subscribe(input: AgentParams<'agent.sessions.subscribe'>): AgentResult<'agent.sessions.subscribe'> {
    for (const existing of this.subscriptions.values()) {
      if (existing.sessionId === input.sessionId && existing.phase !== 'reset')
        throw new RemoteRpcError('CONFLICT', 'Session already has a subscription on this connection')
    }
    if (this.subscriptions.size >= remoteLimits.subscriptions)
      throw new RemoteRpcError('RESOURCE_EXHAUSTED', 'Too many subscriptions')
    const journal = this.hub.journal(input.sessionId)
    const expiresAt = Date.now() + remoteLimits.checkpointMs
    const subscription: Subscription = {
      id: randomUUID(),
      sessionId: input.sessionId,
      journal,
      epoch: journal.epoch,
      phase: 'prepared',
      cursorSeq: 0,
      lastSent: 0,
      lastAck: 0,
      sent: new Map(),
      unackedBytes: 0,
      expiresAt,
      pump: Promise.resolve(),
      unobserve: () => {}
    }
    const cursor = input.cursor
    const current = journal.cursor
    const reason = !cursor
      ? 'no cursor'
      : cursor.sessionId !== input.sessionId || cursor.streamEpoch !== journal.epoch
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
      return {
        subscriptionId: subscription.id,
        mode: 'replay',
        fromCursor: cursor,
        highWatermark: current,
        leaseExpiresAt: new Date(expiresAt).toISOString()
      }
    }
    const checkpoint = journal.capture()
    subscription.cursorSeq = Number(checkpoint.descriptor.cursor.seq)
    subscription.checkpoint = checkpoint
    subscription.unobserve = journal.observe(() => this.schedule(subscription))
    this.subscriptions.set(subscription.id, subscription)
    return {
      subscriptionId: subscription.id,
      mode: 'checkpoint',
      reason: reason ?? 'no cursor',
      checkpoint: checkpoint.descriptor
    }
  }

  readCheckpoint(input: AgentParams<'agent.checkpoints.read'>): AgentCheckpointPage {
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
  activate(input: AgentParams<'agent.subscriptions.activate'>): {
    result: AgentResult<'agent.subscriptions.activate'>
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
      appliedCursor.sessionId !== subscription.sessionId ||
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
        subscription.lastSent = subscription.cursorSeq
        subscription.lastAck = subscription.cursorSeq
        this.schedule(subscription)
      }
    }
  }

  ack(input: AgentParams<'agent.subscriptions.ack'>): AgentResult<'agent.subscriptions.ack'> {
    const subscription = this.require(input.subscriptionId)
    const seq = Number(input.cursor.seq)
    if (
      subscription.phase !== 'active' ||
      input.cursor.sessionId !== subscription.sessionId ||
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
    return { acknowledged: { sessionId: subscription.sessionId, streamEpoch: subscription.epoch, seq: String(seq) } }
  }

  close(subscriptionId: string): void {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) return
    subscription.unobserve()
    subscription.phase = 'reset'
    this.subscriptions.delete(subscriptionId)
  }

  readContent(sessionId: string, contentId: string, revision: string): Uint8Array | undefined {
    for (const subscription of this.subscriptions.values()) {
      const bytes =
        subscription.sessionId === sessionId
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

  private require(subscriptionId: string): Subscription {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) throw new RemoteRpcError('NOT_FOUND', 'Unknown subscription')
    return subscription
  }

  private intact(subscription: Subscription): boolean {
    const from = subscription.phase === 'active' ? subscription.lastSent : subscription.cursorSeq
    return subscription.journal.epoch === subscription.epoch && subscription.journal.firstRetainedSeq <= from + 1
  }

  private reset(
    subscription: Subscription,
    reason: 'RESET_REQUIRED' | 'CHECKPOINT_EXPIRED' | 'RESOURCE_EXHAUSTED'
  ): void {
    this.close(subscription.id)
    this.send({
      jsonrpc: '2.0',
      method: 'agent.subscriptions.resetRequired',
      params: { subscriptionId: subscription.id, reason }
    }).catch((error: unknown) => logger.warn('Failed to deliver subscription reset', error as Error))
  }

  private schedule(subscription: Subscription): void {
    subscription.pump = subscription.pump
      .then(() => this.pump(subscription))
      .catch((error: unknown) => logger.warn('Subscription pump failed', error as Error))
  }

  private async pump(subscription: Subscription): Promise<void> {
    while (subscription.phase === 'active' && subscription.unackedBytes < remoteLimits.unackedBytes) {
      if (!this.intact(subscription)) {
        this.reset(subscription, 'RESET_REQUIRED')
        return
      }
      const events = subscription.journal.eventsAfter(subscription.lastSent, BATCH_BYTES)
      if (!events.length) return
      const params = {
        subscriptionId: subscription.id,
        sessionId: subscription.sessionId,
        streamEpoch: subscription.epoch,
        events
      }
      const bytes = Buffer.byteLength(JSON.stringify(params))
      const lastSeq = Number(events[events.length - 1].seq)
      subscription.lastSent = lastSeq
      subscription.sent.set(lastSeq, bytes)
      subscription.unackedBytes += bytes
      await this.send({ jsonrpc: '2.0', method: 'agent.events', params })
    }
  }
}
