import type { WebUiSseEventName, WebUiSseMessage } from '../types/api'

export type WebUiSseHandler<TData = unknown> = (message: WebUiSseMessage<TData>) => void

export type WebUiSseClientOptions = {
  readonly endpoint?: string
  readonly eventSourceFactory?: (url: string) => EventSource
}

export type WebUiSseClient = {
  connect(): void
  close(): void
  subscribe<TData = unknown>(event: WebUiSseEventName, handler: WebUiSseHandler<TData>): () => void
}

const eventNames: readonly WebUiSseEventName[] = ['ready', 'chunk', 'sync', 'error', 'done']

const parseEventData = (event: MessageEvent<string>): unknown => {
  if (!event.data) return undefined

  return JSON.parse(event.data) as unknown
}

export const createWebUiSseClient = ({
  endpoint = '/events',
  eventSourceFactory = (url) => new EventSource(url)
}: WebUiSseClientOptions = {}): WebUiSseClient => {
  const handlers = new Map<WebUiSseEventName, Set<WebUiSseHandler>>()
  let eventSource: EventSource | undefined

  const dispatch = (eventName: WebUiSseEventName, event: Event) => {
    const messageEvent = event as MessageEvent<string>
    const message: WebUiSseMessage = {
      event: eventName,
      data: parseEventData(messageEvent)
    }

    for (const handler of handlers.get(eventName) ?? []) {
      handler(message)
    }
  }

  return {
    connect() {
      if (eventSource) return

      eventSource = eventSourceFactory(endpoint)
      for (const eventName of eventNames) {
        eventSource.addEventListener(eventName, (event: Event) => dispatch(eventName, event))
      }
    },

    close() {
      eventSource?.close()
      eventSource = undefined
    },

    subscribe<TData = unknown>(event: WebUiSseEventName, handler: WebUiSseHandler<TData>) {
      const eventHandlers = handlers.get(event) ?? new Set<WebUiSseHandler>()
      eventHandlers.add(handler as WebUiSseHandler)
      handlers.set(event, eventHandlers)

      return () => {
        eventHandlers.delete(handler as WebUiSseHandler)
      }
    }
  }
}
