import { isDev } from '@renderer/config/constant'
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
const SENSITIVE_KEY_PATTERN = /authorization|api[-_]?key|token|secret|password|credential/i

let options: DataApiDevtoolsOptions = { ...DEFAULT_OPTIONS }
const events: DataApiDevtoolsEvent[] = []
const startTimes = new Map<string, number>()

function isEnabled(): boolean {
  return isDev && typeof window !== 'undefined'
}

function findEvent(requestId: string): DataApiDevtoolsEvent | undefined {
  return events.find((event) => event.requestId === requestId)
}

function pushEvent(
  event: Omit<DataApiDevtoolsEvent, 'id' | 'timestamp'>,
  pushOptions?: { trackStart?: boolean }
): void {
  if (!isEnabled()) return

  events.push({
    ...event,
    id: event.requestId,
    timestamp: Date.now()
  })
  if (pushOptions?.trackStart) {
    startTimes.set(event.requestId, performance.now())
  }

  pruneEvents()
}

function pruneEvents(): void {
  if (events.length <= MAX_ENTRIES) return
  for (const removed of events.splice(0, events.length - MAX_ENTRIES)) {
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
    result[key] = SENSITIVE_KEY_PATTERN.test(key) ? '<redacted>' : sanitizeValue(item, depth + 1)
  }
  if (entries.length > MAX_OBJECT_KEYS) {
    result.__truncatedKeys = entries.length - MAX_OBJECT_KEYS
  }
  return result
}

function serializeError(error: unknown): DataApiDevtoolsEvent['error'] {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    return {
      name: typeof record.name === 'string' ? record.name : undefined,
      code: typeof record.code === 'string' ? record.code : undefined,
      message: typeof record.message === 'string' ? record.message : String(error),
      status: typeof record.status === 'number' ? record.status : undefined,
      isRetryable: typeof record.isRetryable === 'boolean' ? record.isRetryable : undefined
    }
  }
  return { message: String(error) }
}

function installGlobal(): void {
  if (!isEnabled() || window.__CHERRY_DATA_API_DEVTOOLS__) return

  window.__CHERRY_DATA_API_DEVTOOLS__ = {
    snapshot: () => [...events],
    clear: () => {
      events.length = 0
      startTimes.clear()
    },
    setOptions: (nextOptions) => {
      options = {
        capturePayloads: nextOptions.capturePayloads ?? options.capturePayloads
      }
      return { ...options }
    }
  }
}

export function recordDataApiStart(input: {
  requestId: string
  method: HttpMethod
  path: string
  query?: unknown
  body?: unknown
  retryAttempt: number
}): void {
  if (!isEnabled()) return
  installGlobal()
  pushEvent(
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
}

export function recordDataApiSuccess(input: {
  requestId: string
  method: HttpMethod
  path: string
  response: DataResponse
}): void {
  if (!isEnabled()) return
  installGlobal()
  const event = findEvent(input.requestId)
  if (!event) {
    pushEvent({
      state: 'success',
      requestId: input.requestId,
      method: input.method,
      path: input.path,
      status: input.response.status,
      response: sanitizeValue(input.response.data),
      mainDuration: input.response.metadata?.duration,
      handlerDuration: input.response.metadata?.handlerDuration,
      completedAt: Date.now()
    })
    return
  }

  Object.assign(event, {
    state: 'success',
    completedAt: Date.now(),
    status: input.response.status,
    response: sanitizeValue(input.response.data),
    clientDuration: consumeClientDuration(input.requestId),
    mainDuration: input.response.metadata?.duration,
    handlerDuration: input.response.metadata?.handlerDuration
  } satisfies Partial<DataApiDevtoolsEvent>)
}

export function recordDataApiError(input: {
  requestId: string
  method: HttpMethod
  path: string
  error: unknown
  status?: number
  metadata?: DataResponse['metadata']
}): void {
  if (!isEnabled()) return
  installGlobal()
  const timingFields: Partial<DataApiDevtoolsEvent> = {
    mainDuration: input.metadata?.duration,
    handlerDuration: input.metadata?.handlerDuration
  }
  const event = findEvent(input.requestId)
  if (!event) {
    pushEvent({
      state: 'error',
      requestId: input.requestId,
      method: input.method,
      path: input.path,
      status: input.status,
      ...timingFields,
      error: serializeError(input.error),
      completedAt: Date.now()
    })
    return
  }

  Object.assign(event, {
    state: 'error',
    completedAt: Date.now(),
    status: input.status,
    clientDuration: consumeClientDuration(input.requestId),
    ...timingFields,
    error: serializeError(input.error)
  } satisfies Partial<DataApiDevtoolsEvent>)
}

export function recordDataApiRetry(input: {
  requestId: string
  method: HttpMethod
  path: string
  retryAttempt: number
  error: unknown
}): void {
  if (!isEnabled()) return
  installGlobal()
  const event = findEvent(input.requestId)
  if (!event) {
    pushEvent({
      state: 'retry',
      requestId: input.requestId,
      method: input.method,
      path: input.path,
      retryAttempt: input.retryAttempt,
      error: serializeError(input.error),
      completedAt: Date.now()
    })
    return
  }

  Object.assign(event, {
    state: 'retry',
    completedAt: Date.now(),
    retryAttempt: input.retryAttempt,
    error: serializeError(input.error)
  } satisfies Partial<DataApiDevtoolsEvent>)
}

export const dataApiDevtoolsTesting = {
  sanitizeValue,
  reset: () => {
    options = { ...DEFAULT_OPTIONS }
    events.length = 0
    startTimes.clear()
    if (typeof window !== 'undefined') {
      delete window.__CHERRY_DATA_API_DEVTOOLS__
    }
  }
}

installGlobal()
