import type { MessageProjectionUpdate, MessageProjectionView } from '@shared/ai/messageProjection'

export interface ProjectionSource {
  snapshot(): MessageProjectionView
  subscribe(listener: (update: MessageProjectionUpdate) => void): () => void
}

/** Window-scoped delivery leases do not control the lifetime of native work. */
export class ProjectionSubscriptions {
  private readonly windows = new Map<Electron.WebContents, Map<string, () => void>>()

  detach(sender: Electron.WebContents, id: string): void {
    this.windows.get(sender)?.get(id)?.()
    this.windows.get(sender)?.delete(id)
  }

  async attach(
    sender: Electron.WebContents,
    id: string,
    resolve: () => ProjectionSource | null | Promise<ProjectionSource | null>,
    send: (update: MessageProjectionUpdate) => void
  ): Promise<MessageProjectionView | null> {
    this.detach(sender, id)
    let subscriptions = this.windows.get(sender)
    if (!subscriptions) {
      const windowSubscriptions = new Map<string, () => void>()
      subscriptions = windowSubscriptions
      this.windows.set(sender, windowSubscriptions)
      sender.once('destroyed', () => {
        for (const stop of windowSubscriptions.values()) stop()
        this.windows.delete(sender)
      })
    }
    const marker = () => {}
    subscriptions.set(id, marker)
    try {
      const source = await resolve()
      if (sender.isDestroyed() || subscriptions.get(id) !== marker) return null
      if (!source) {
        subscriptions.delete(id)
        return null
      }
      subscriptions.set(id, source.subscribe(send))
      return source.snapshot()
    } catch (error) {
      if (subscriptions.get(id) === marker) subscriptions.delete(id)
      throw error
    }
  }

  dispose(): void {
    for (const subscriptions of this.windows.values()) for (const stop of subscriptions.values()) stop()
    this.windows.clear()
  }
}
