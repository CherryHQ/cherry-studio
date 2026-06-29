import { isDev } from '@renderer/utils/platform'
import type { DataResponse, HttpMethod } from '@shared/data/api/apiTypes'

type DataApiDevtoolsRequestState = 'pending' | 'success' | 'error' | 'retry'

interface DataApiDevtoolsOptions {
  capturePayloads: boolean
}

interface DataApiDevtoolsEvent {
  id: string
  state: DataApiDevtoolsRequestState
  timestamp: number
  completedAt?: number
  requestId: string
  method: HttpMethod
  path: string
  query?: unknown
  body?: unknown
  response?: unknown
  status?: number
  retryAttempt?: number
  clientDuration?: number
  mainDuration?: number
  handlerDuration?: number
  error?: {
    name?: string
    code?: string
    message: string
    status?: number
    isRetryable?: boolean
  }
}

interface DataApiDevtoolsGlobal {
  snapshot: () => DataApiDevtoolsEvent[]
  clear: () => void
  setOptions: (options: Partial<DataApiDevtoolsOptions>) => DataApiDevtoolsOptions
}

type DataApiDevtoolsEventIdentity = Pick<DataApiDevtoolsEvent, 'requestId' | 'method' | 'path'>
type DataApiDevtoolsEventPatch = Partial<DataApiDevtoolsEvent> & Pick<DataApiDevtoolsEvent, 'state'>

declare global {
  interface Window {
    __CHERRY_DATA_API_DEVTOOLS__?: DataApiDevtoolsGlobal
  }
}

const DEFAULT_OPTIONS: DataApiDevtoolsOptions = {
  capturePayloads: true
}

const MAX_ENTRIES = 500
const MAX_STRING_LENGTH = 1000
const MAX_ARRAY_LENGTH = 50
const MAX_OBJECT_KEYS = 100
const MAX_DEPTH = 5

let options: DataApiDevtoolsOptions = { ...DEFAULT_OPTIONS }
const events: DataApiDevtoolsEvent[] = []
const eventIndex = new Map<string, DataApiDevtoolsEvent>()
const startTimes = new Map<string, number>()

function isEnabled(): boolean {
  return isDev && typeof window !== 'undefined'
}

function prepareRecording(): boolean {
  if (!isEnabled()) return false
  installGlobal()
  return true
}

function safeRecord(record: () => void): void {
  if (!prepareRecording()) return
  try {
    record()
  } catch {
    // DevTools instrumentation must never affect the request it observes.
  }
}

function snapshotEvents(): DataApiDevtoolsEvent[] {
  return [...events]
}

function clearEvents(): void {
  events.length = 0
  eventIndex.clear()
  startTimes.clear()
}

function setDevtoolsOptions(nextOptions: Partial<DataApiDevtoolsOptions>): DataApiDevtoolsOptions {
  options = {
    capturePayloads: nextOptions.capturePayloads ?? options.capturePayloads
  }
  return { ...options }
}

function appendEvent(
  event: Omit<DataApiDevtoolsEvent, 'id' | 'timestamp'>,
  pushOptions?: { trackStart?: boolean }
): void {
  const nextEvent = {
    ...event,
    id: event.requestId,
    timestamp: Date.now()
  }

  events.push(nextEvent)
  eventIndex.set(nextEvent.requestId, nextEvent)
  if (pushOptions?.trackStart) {
    startTimes.set(event.requestId, performance.now())
  }

  pruneEvents()
}

function updateEvent(requestId: string, patch: Partial<DataApiDevtoolsEvent>): boolean {
  const event = eventIndex.get(requestId)
  if (!event) return false

  Object.assign(event, patch)
  return true
}

function upsertEvent(input: DataApiDevtoolsEventIdentity, patch: DataApiDevtoolsEventPatch): void {
  if (updateEvent(input.requestId, patch)) return
  appendEvent({ ...input, ...patch })
}

function pruneEvents(): void {
  if (events.length <= MAX_ENTRIES) return
  for (const removed of events.splice(0, events.length - MAX_ENTRIES)) {
    eventIndex.delete(removed.requestId)
    startTimes.delete(removed.requestId)
  }
}

function consumeClientDuration(requestId: string): number | undefined {
  const startTime = startTimes.get(requestId)
  if (startTime === undefined) return undefined
  startTimes.delete(requestId)
  return performance.now() - startTime
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (!options.capturePayloads) return undefined
  if (value === null || value === undefined) return value

  if (typeof value === 'string') {
    if (value.length <= MAX_STRING_LENGTH) return value
    return `${value.slice(0, MAX_STRING_LENGTH)}...<truncated ${value.length - MAX_STRING_LENGTH} chars>`
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'function') return '<function>'
  if (typeof value !== 'object') return String(value)
  if (depth >= MAX_DEPTH) return '<max-depth>'

  if (Array.isArray(value)) {
    const result = value.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitizeValue(item, depth + 1))
    if (value.length > MAX_ARRAY_LENGTH) {
      result.push(`<truncated ${value.length - MAX_ARRAY_LENGTH} items>`)
    }
    return result
  }

  const result: Record<string, unknown> = {}
  const entries = Object.entries(value as Record<string, unknown>)
  for (const [key, item] of entries.slice(0, MAX_OBJECT_KEYS)) {
    result[key] = sanitizeValue(item, depth + 1)
  }
  if (entries.length > MAX_OBJECT_KEYS) {
    result.__truncatedKeys = entries.length - MAX_OBJECT_KEYS
  }
  return result
}

function serializeError(error: unknown): DataApiDevtoolsEvent['error'] {
  const serializeMessage = (message: unknown): string => {
    if (!options.capturePayloads) return '<payload capture disabled>'
    const sanitized = sanitizeValue(typeof message === 'string' ? message : String(message))
    return typeof sanitized === 'string' ? sanitized : String(sanitized)
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    return {
      name: typeof record.name === 'string' ? record.name : undefined,
      code: typeof record.code === 'string' ? record.code : undefined,
      message: serializeMessage(typeof record.message === 'string' ? record.message : error),
      status: typeof record.status === 'number' ? record.status : undefined,
      isRetryable: typeof record.isRetryable === 'boolean' ? record.isRetryable : undefined
    }
  }
  return { message: serializeMessage(error) }
}

function installGlobal(): void {
  if (!isEnabled() || window.__CHERRY_DATA_API_DEVTOOLS__) return

  window.__CHERRY_DATA_API_DEVTOOLS__ = {
    snapshot: snapshotEvents,
    clear: clearEvents,
    setOptions: setDevtoolsOptions
  }
}

function recordStart(input: {
  requestId: string
  method: HttpMethod
  path: string
  query?: unknown
  body?: unknown
  retryAttempt: number
}): void {
  safeRecord(() => {
    appendEvent(
      {
        state: 'pending',
        requestId: input.requestId,
        method: input.method,
        path: input.path,
        query: sanitizeValue(input.query),
        body: sanitizeValue(input.body),
        retryAttempt: input.retryAttempt
      },
      { trackStart: true }
    )
  })
}

function recordSuccess(input: { requestId: string; method: HttpMethod; path: string; response: DataResponse }): void {
  safeRecord(() => {
    upsertEvent(input, {
      state: 'success',
      completedAt: Date.now(),
      status: input.response.status,
      response: sanitizeValue(input.response.data),
      clientDuration: consumeClientDuration(input.requestId),
      mainDuration: input.response.metadata?.duration,
      handlerDuration: input.response.metadata?.handlerDuration
    })
  })
}

function recordError(input: {
  requestId: string
  method: HttpMethod
  path: string
  error: unknown
  status?: number
  metadata?: DataResponse['metadata']
}): void {
  safeRecord(() => {
    const timingFields: Partial<DataApiDevtoolsEvent> = {
      mainDuration: input.metadata?.duration,
      handlerDuration: input.metadata?.handlerDuration
    }
    upsertEvent(input, {
      state: 'error',
      completedAt: Date.now(),
      status: input.status,
      clientDuration: consumeClientDuration(input.requestId),
      ...timingFields,
      error: serializeError(input.error)
    })
  })
}

function recordRetry(input: {
  requestId: string
  method: HttpMethod
  path: string
  retryAttempt: number
  error: unknown
}): void {
  safeRecord(() => {
    upsertEvent(input, {
      state: 'retry',
      completedAt: Date.now(),
      retryAttempt: input.retryAttempt,
      error: serializeError(input.error)
    })
  })
}

export const DataApiDevtools = {
  recordStart,
  recordSuccess,
  recordError,
  recordRetry
}

export const dataApiDevtoolsTesting = {
  sanitizeValue,
  reset: () => {
    options = { ...DEFAULT_OPTIONS }
    clearEvents()
    if (typeof window !== 'undefined') {
      delete window.__CHERRY_DATA_API_DEVTOOLS__
    }
  }
}
