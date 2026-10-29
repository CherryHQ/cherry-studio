import { randomUUID } from 'node:crypto'

import type { ConversationView, ConversationWatch, LiveState } from '@earendil-works/pi-durable'

import { ThreadFeed, type Thread } from '@cherrystudio/agent-runtime'

import { ContentProjection } from './content'

/** One normalized source shared by every access to a native conversation. */
export class DurableProjection {
  readonly feed: ThreadFeed
  private readonly epoch = randomUUID()
  private transientIds = new Set<string>()

  constructor(
    readonly ref: Thread,
    private readonly watch: ConversationWatch,
    report: (error: unknown) => void
  ) {
    this.feed = new ThreadFeed(
      {
        type: 'snapshot',
        coverage: 'current-view',
        messages: [],
        inputs: [],
        delegations: [],
        activity: { scope: 'foreground', state: 'unknown' }
      },
      report
    )
    this.update(watch.value)
    watch.start(async (value) => this.update(value))
    void watch.closed.then((end) => {
      if (end.reason === 'stopped' || end.reason === 'session_closed') return
      if ('error' in end) report(end.error)
      this.feed.publish({ type: 'gap', reason: 'disconnected' })
      this.feed.close('source-lost')
    })
  }

  async close(): Promise<void> {
    this.feed.close('shutdown')
    await this.watch.stop()
  }

  private update(view: ConversationView): void {
    const live = view.docs['pi.live'] as LiveState | undefined
    const content = new ContentProjection()
    const transientIds = new Set<string>()
    for (const entry of view.entries) content.entry(entry)
    const generation = live?.generation
    const nextLiveId =
      generation?.message && live?.run
        ? `live:${this.epoch}:${live.run.taskId}:${generation.attempt}:${view.entries.at(-1)?.id ?? 0}`
        : undefined
    if (generation?.message && nextLiveId) {
      transientIds.add(nextLiveId)
      content.message(generation.message, nextLiveId, 'partial')
    }
    for (const slot of live?.tools ?? []) {
      if (slot.output !== undefined && slot.taskId && !slot.entry) {
        const id = `tool-progress:${this.epoch}:${slot.taskId}`
        transientIds.add(id)
        content.progress(slot.callId, slot.output)
      }
    }
    if ([...this.transientIds].some((id) => !transientIds.has(id)))
      this.feed.publish({ type: 'gap', reason: 'mapping-reset' })
    this.transientIds = transientIds
    this.feed.publish({
      ...this.feed.snapshot,
      messages: content.messages,
      activity: { scope: 'foreground', state: live?.run ? 'active' : 'idle' }
    })
  }
}
