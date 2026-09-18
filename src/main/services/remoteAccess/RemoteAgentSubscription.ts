import { randomUUID } from 'node:crypto'

import { type DeviceContext, observeSession, sessionSnapshot } from './agentAccess'
import type { RemoteEvent } from './protocol'

export class RemoteAgentSubscription {
  readonly id = randomUUID()
  private readonly epoch = randomUUID()
  private sequence = 0
  private timer?: ReturnType<typeof setTimeout>
  private observer?: { dispose(): void }
  private disposed = false
  private lastSnapshot?: string

  constructor(
    readonly sessionId: string,
    private readonly context: DeviceContext,
    private readonly send: (event: RemoteEvent) => void,
    private readonly failed: () => void
  ) {
    this.observer = observeSession(context, sessionId, () => this.schedule())
  }

  private schedule(): void {
    if (this.disposed || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (this.disposed) return
      try {
        const data = sessionSnapshot(this.context, this.sessionId)
        const serialized = JSON.stringify(data)
        if (serialized === this.lastSnapshot) return
        this.send({
          type: 'event',
          event: 'session.snapshot',
          subscriptionId: this.id,
          subscriptionEpoch: this.epoch,
          eventSeq: ++this.sequence,
          sessionId: this.sessionId,
          data
        })
        this.lastSnapshot = serialized
      } catch {
        this.dispose()
        this.failed()
      }
    }, 50)
    this.timer.unref()
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.observer?.dispose()
    this.observer = undefined
  }
}
