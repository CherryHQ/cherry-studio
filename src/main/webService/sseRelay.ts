// WebUI desktop bridge SSE relay
import type { ServerResponse } from 'node:http'

export type WebUiSseEvent = {
  readonly event: 'ready' | 'chunk' | 'sync' | 'error' | 'done'
  readonly data: unknown
}

export type WebUiSseRelay = {
  readonly size: number
  addClient(response: ServerResponse): void
  broadcast(event: WebUiSseEvent): void
  close(): void
}

const writeSseEvent = (response: ServerResponse, event: WebUiSseEvent) => {
  response.write(`event: ${event.event}\n`)
  response.write(`data: ${JSON.stringify(event.data)}\n\n`)
}

export const createWebUiSseRelay = (): WebUiSseRelay => {
  const clients = new Set<ServerResponse>()
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      client.write(': webui-heartbeat\n\n')
    }
  }, 25_000)

  heartbeat.unref()

  return {
    get size() {
      return clients.size
    },

    addClient(response) {
      response.writeHead(200, {
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'Content-Type': 'text/event-stream',
        'X-Accel-Buffering': 'no'
      })
      response.flushHeaders?.()
      clients.add(response)
      writeSseEvent(response, {
        event: 'ready',
        data: { connected: true }
      })

      response.on('close', () => {
        clients.delete(response)
      })
    },

    broadcast(event) {
      for (const client of clients) {
        writeSseEvent(client, event)
      }
    },

    close() {
      clearInterval(heartbeat)
      for (const client of clients) {
        writeSseEvent(client, {
          event: 'done',
          data: { reason: 'webui-service-stopped' }
        })
        client.end()
      }
      clients.clear()
    }
  }
}
