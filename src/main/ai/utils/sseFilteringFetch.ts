/**
 * SSE-filtering fetch wrapper for OpenAI-compatible providers.
 *
 * Some API servers (e.g. Hermes Agent) emit custom SSE events alongside the
 * standard OpenAI chat-completion stream — for example, tool-progress events:
 *
 *   event: hermes.tool.progress
 *   data: {"tool":"web_search","status":"running",...}
 *
 * The Vercel AI SDK's SSE parser processes every `data:` line as a
 * `chat.completion.chunk`, so custom event payloads that lack `choices` or
 * `error` fields trigger Zod `invalid_union` validation errors.
 *
 * This wrapper intercepts `text/event-stream` responses and strips out SSE
 * frames that carry a non-standard `event:` field — but instead of silently
 * dropping them, it emits them through a side-channel EventEmitter so the
 * UI can display tool progress, status updates, and other extension events.
 *
 * References:
 *   - SSE spec: https://html.spec.whatwg.org/multipage/server-sent-events.html
 *   - CherryHQ/cherry-studio custom event validation errors
 *   - Hermes Agent api_server.py `hermes.tool.progress` events (#6972, #16588)
 */

import type { FetchFunction } from '@ai-sdk/provider-utils'
import { EventEmitter } from 'events'

// ── Types ──

/** A custom SSE event intercepted from the stream. */
export interface CustomSSEEvent {
  /** The `event:` type (e.g. "hermes.tool.progress"). */
  eventType: string
  /** Parsed JSON payload from the `data:` line(s). */
  data: Record<string, unknown>
  /** ISO timestamp of when the event was intercepted. */
  timestamp: string
}

// ── Global event bus ──

/**
 * Module-level EventEmitter for custom SSE events.
 *
 * Main-process modules subscribe via `customSSEEventBus.on('event', ...)`.
 * The SSE filter transform pushes intercepted events; consumers (IPC bridge,
 * stream manager, logging) pull from here.
 *
 * Error events are intentionally not emitted — a parsing failure in the
 * filter should never crash the host process.
 */
export const customSSEEventBus = new EventEmitter()
customSSEEventBus.setMaxListeners(50)

// ── Constants ──

const KNOWN_SSE_EVENT_TYPES = new Set(['message', ''])

// ── Helpers ──

function isChatCompletionsRequest(input: RequestInfo | URL): boolean {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  return url.includes('/chat/completions')
}

/**
 * Try to extract all `data:` payloads from an SSE frame and concatenate them
 * (per SSE spec, multiple `data:` lines are joined with newlines), then parse
 * as JSON.  Returns null if parsing fails.
 */
function parseFrameData(lines: string[]): Record<string, unknown> | null {
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart())
    }
  }
  if (dataLines.length === 0) return null
  try {
    return JSON.parse(dataLines.join('\n'))
  } catch {
    return null
  }
}

// ── Transform ──

function createSSEFilterTransform(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''

  function processFrame(frame: string, controller: TransformStreamDefaultController<Uint8Array>) {
    if (!frame.trim()) return

    const lines = frame.split(/\r?\n/)
    let eventType = ''
    const outputLines: string[] = []

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim()
      } else {
        outputLines.push(line)
      }
    }

    if (KNOWN_SSE_EVENT_TYPES.has(eventType)) {
      // Standard frame — pass through (strip the event: line)
      const filteredFrame = outputLines.join('\n') + '\n\n'
      controller.enqueue(encoder.encode(filteredFrame))
    } else {
      // Custom frame — emit to side channel instead of dropping
      const data = parseFrameData(lines)
      if (data) {
        const event: CustomSSEEvent = {
          eventType,
          data,
          timestamp: new Date().toISOString()
        }
        try {
          customSSEEventBus.emit('event', event)
          customSSEEventBus.emit(eventType, event)
        } catch {
          // Swallow — event bus errors must never break the stream
        }
      }
    }
  }

  return new TransformStream({
    transform(chunk: Uint8Array, controller) {
      buffer += decoder.decode(chunk, { stream: true })

      while (true) {
        const nnIdx = buffer.indexOf('\n\n')
        const rrIdx = buffer.indexOf('\r\n\r\n')

        let boundaryIdx: number
        let boundaryLen: number
        if (nnIdx === -1 && rrIdx === -1) break
        if (nnIdx === -1) {
          boundaryIdx = rrIdx
          boundaryLen = 4
        } else if (rrIdx === -1) {
          boundaryIdx = nnIdx
          boundaryLen = 2
        } else {
          if (rrIdx <= nnIdx) {
            boundaryIdx = rrIdx
            boundaryLen = 4
          } else {
            boundaryIdx = nnIdx
            boundaryLen = 2
          }
        }

        const frame = buffer.slice(0, boundaryIdx)
        buffer = buffer.slice(boundaryIdx + boundaryLen)
        processFrame(frame, controller)
      }
    },

    flush(controller) {
      if (buffer.trim()) {
        processFrame(buffer, controller)
      }
    }
  })
}

// ── Public API ──

/**
 * Create a fetch wrapper that filters custom SSE events from chat-completion
 * streams while emitting them through {@link customSSEEventBus}.
 *
 * @param innerFetch - The underlying fetch function to wrap
 * @returns A filtered fetch function
 */
export function createSSEFilteringFetch(innerFetch: FetchFunction): FetchFunction {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await innerFetch(input, init)

    if (!isChatCompletionsRequest(input)) return response

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/event-stream')) return response
    if (!response.body) return response

    const filteredBody = response.body.pipeThrough(createSSEFilterTransform())

    return new Response(filteredBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    })
  }
}
