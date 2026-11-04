import { setTimeout as delay } from 'node:timers/promises'

import type { Client } from '@modelcontextprotocol/client'

import type { McpResourceObservation, McpResourceObservationState } from './McpConnection'

type Listener = (state: McpResourceObservationState) => void
interface Observation {
  controller: AbortController
  listeners: Set<Listener>
  state: McpResourceObservationState
  done: Promise<void>
}

/** Connection-owned leases; protocol acknowledgements and cancellation remain SDK-owned. */
export class ResourceObservations {
  private readonly observations = new Map<string, Observation>()
  private closed = false

  constructor(private readonly client: Client) {}

  observe(uri: string, onState: Listener): McpResourceObservation {
    if (this.closed) throw new Error('MCP connection is closed')
    let observation = this.observations.get(uri)
    if (!observation || observation.controller.signal.aborted) {
      if (!observation && this.observations.size >= 128) throw new Error('MCP resource observation limit reached')
      const previous = observation?.done
      observation = {
        controller: new AbortController(),
        listeners: new Set(),
        state: 'reconnecting',
        done: Promise.resolve()
      }
      this.observations.set(uri, observation)
      const entry = observation
      entry.done = (async () => {
        await previous
        if (!entry.controller.signal.aborted) await this.listen(uri, entry)
      })()
    }
    if (observation.listeners.size >= 256) throw new Error('MCP resource observer limit reached')
    const entry = observation
    const listener: Listener = (state) => onState(state)
    entry.listeners.add(listener)
    listener(entry.state)
    return {
      close: async () => {
        entry.listeners.delete(listener)
        if (entry.listeners.size !== 0) return
        entry.controller.abort()
        await entry.done
        if (this.observations.get(uri) === entry) this.observations.delete(uri)
      }
    }
  }

  private publish(entry: Observation, state: McpResourceObservationState): void {
    entry.state = state
    for (const listener of entry.listeners) listener(state)
  }

  private async listen(uri: string, entry: Observation): Promise<void> {
    const signal = entry.controller.signal
    if (!this.client.getServerCapabilities()?.resources?.subscribe) {
      this.publish(entry, 'unsupported')
      return
    }
    for (let attempt = 0; attempt < 4 && !signal.aborted; attempt++) {
      try {
        if (attempt) await delay(Math.min(500 * 2 ** (attempt - 1), 2_000), undefined, { signal })
        if (this.client.getProtocolEra() === 'legacy') {
          await this.client.subscribeResource({ uri }, { signal })
          try {
            this.publish(entry, 'subscribed')
            if (!signal.aborted)
              await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
          } finally {
            await this.client.unsubscribeResource({ uri }, { timeout: 5_000 }).catch(() => undefined)
          }
          return
        }
        const subscription = await this.client.listen({ resourceSubscriptions: [uri] }, { signal, timeout: 10_000 })
        try {
          if (!subscription.honoredFilter.resourceSubscriptions?.includes(uri)) {
            this.publish(entry, 'unsupported')
            return
          }
          this.publish(entry, 'subscribed')
          const reason = await subscription.closed
          if (reason === 'local') return
        } finally {
          await subscription.close()
        }
      } catch {
        if (signal.aborted) return
      }
      if (!signal.aborted) this.publish(entry, 'reconnecting')
    }
    if (!signal.aborted) this.publish(entry, 'closed')
  }

  async close(): Promise<void> {
    this.closed = true
    const observations = [...this.observations.values()]
    this.observations.clear()
    for (const entry of observations) {
      this.publish(entry, 'closed')
      entry.controller.abort()
    }
    await Promise.all(observations.map((entry) => entry.done))
  }
}
