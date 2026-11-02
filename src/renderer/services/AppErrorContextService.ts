import type { SerializedError } from '@renderer/types/error'
import type { AppErrorContext } from '@shared/types/appError'
import type { DoctorSubjectRef } from '@shared/types/doctor'
import type { DoctorAgentIncident } from '@shared/types/doctorAgent'
import { createAppErrorContext, summarizeErrorParams, summarizeProviderResponse } from '@shared/utils/appErrorSnapshot'

import { presentedRouteService } from './PresentedRouteService'

/** Opaque payload a toast or confirm popup may carry. Hosts interpret it; the UI library does not. */
interface AppErrorDetailData {
  readonly suppressDetail?: boolean
  readonly errorContext?: AppErrorContext
  readonly source?: string
  readonly operation?: string
  readonly id?: string
  readonly providerId?: string
  readonly modelId?: string
  readonly recordId?: string
  readonly imageOnly?: boolean
  readonly params?: Readonly<Record<string, unknown>>
  /** Structured failure already serialized for the detail dialog. */
  readonly serializedError?: SerializedError
  /** Caller-authored explanation. Kept off `errorContext.message`, which stays technical. */
  readonly localizedErrorMessage?: string
}

function isSerializedError(error: Record<string, unknown>): error is SerializedError {
  return 'name' in error && 'message' in error && 'stack' in error
}

/** Required identity only. The zod schema stays off this startup path and still guards IPC. */
function isSnapshotContext(value: unknown): value is AppErrorContext {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    record.id.trim().length > 0 &&
    typeof record.occurredAt === 'string' &&
    record.occurredAt.trim().length > 0 &&
    typeof record.source === 'string' &&
    record.source.trim().length > 0 &&
    typeof record.operation === 'string' &&
    record.operation.trim().length > 0 &&
    typeof record.message === 'string'
  )
}

const HOST_CONTEXT_LIMIT = 200
const UNCAUGHT_WINDOW_MS = 2_000
const UNCAUGHT_LIMIT = 50

export function readErrorDetailData(data: unknown): AppErrorDetailData | undefined {
  if (!data || typeof data !== 'object') return undefined
  return data
}

export function isDetailSuppressed(data: unknown): boolean {
  return readErrorDetailData(data)?.suppressDetail === true
}

function hostText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * String title or description the caller already translated.
 * React nodes are not coerced; a host supplies its own localized fallback.
 */
export function localizedSummaryFromHost(input: {
  readonly data?: unknown
  readonly title?: unknown
  readonly description?: unknown
}): string | undefined {
  return (
    hostText(readErrorDetailData(input.data)?.localizedErrorMessage) ??
    hostText(input.title) ??
    hostText(input.description)
  )
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined
  return value as Record<string, unknown>
}

function textOf(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  const record = recordOf(value)
  const message = record && typeof record.message === 'string' ? record.message.trim() : ''
  if (message.length > 0) return message
  const details = record && typeof record.details === 'string' ? record.details.trim() : ''
  return details.length > 0 ? details : undefined
}

function suppliedName(error: unknown): string | undefined {
  const record = recordOf(error)
  if (!record || typeof record.name !== 'string') return undefined
  const name = record.name.trim()
  return name.length > 0 ? name : undefined
}

function suppliedStack(error: unknown): string | undefined {
  const record = recordOf(error)
  if (!record || typeof record.stack !== 'string' || record.stack.length === 0) return undefined
  return record.stack
}

function hasProviderDetail(error: SerializedError): boolean {
  return (
    typeof error.statusCode === 'number' || (typeof error.responseBody === 'string' && error.responseBody.length > 0)
  )
}

function copySerialized(error: SerializedError): SerializedError {
  return { ...error }
}

const AI_REQUEST_FAILED = 'AI_REQUEST_FAILED'

/** Provider payload on an AI request IPC failure, without loading the AI error module. */
function ipcRequestDetail(value: unknown): SerializedError | undefined {
  const record = recordOf(value)
  if (!record || record.code !== AI_REQUEST_FAILED) return undefined
  const data = recordOf(record.data)
  if (!data || !isSerializedError(data)) return undefined
  return copySerialized(data)
}

/** Provider status and body from an IPC or plain serialized failure. Content fields stay out. */
export function diagnosticErrorFromUnknown(error: unknown): SerializedError | undefined {
  const read = (value: unknown): SerializedError | undefined => {
    const detail = ipcRequestDetail(value)
    if (detail) return copySerialized(detail)
    const record = recordOf(value)
    if (!record) return undefined
    if (!(value instanceof Error) && isSerializedError(record)) return copySerialized(record)
    const name = suppliedName(value) ?? null
    const message = textOf(value) ?? null
    const stack = suppliedStack(value) ?? null
    const statusCode = typeof record.statusCode === 'number' ? record.statusCode : undefined
    const responseBody = typeof record.responseBody === 'string' ? record.responseBody : undefined
    if (name === null && message === null && stack === null && statusCode === undefined && responseBody === undefined) {
      return undefined
    }
    return {
      name,
      message,
      stack,
      ...(statusCode !== undefined ? { statusCode } : {}),
      ...(responseBody !== undefined ? { responseBody } : {})
    }
  }

  const direct = read(error)
  if (direct && hasProviderDetail(direct)) return direct
  const nested = read(recordOf(error)?.cause)
  if (nested && (hasProviderDetail(nested) || !direct)) return nested
  return direct
}

/** Prefer a cause that still carries provider status or body, then a stored projection. */
export function detailErrorFromHost(cause: unknown, data: unknown): SerializedError | undefined {
  const fromCause = diagnosticErrorFromUnknown(cause)
  const stored = readErrorDetailData(data)?.serializedError
  if (fromCause && hasProviderDetail(fromCause)) return fromCause
  if (stored && isSerializedError(stored)) return stored
  return fromCause
}

export function contextFromUnknown(
  error: unknown,
  fields: {
    readonly source: string
    readonly operation: string
    readonly message?: string
    readonly id?: string
    readonly occurredAt?: string
    readonly providerId?: string
    readonly modelId?: string
    readonly recordId?: string
    readonly imageOnly?: boolean
    readonly params?: AppErrorContext['params']
  }
): AppErrorContext {
  const diagnostic = diagnosticErrorFromUnknown(error)
  const technicalMessage = diagnostic?.message?.trim()
  const message =
    (technicalMessage && technicalMessage.length > 0 ? technicalMessage : undefined) ??
    textOf(error) ??
    fields.message ??
    ''
  const name = (diagnostic?.name?.trim() ? diagnostic.name : undefined) ?? suppliedName(error)
  const stack =
    (diagnostic?.stack && diagnostic.stack.length > 0 ? diagnostic.stack : undefined) ?? suppliedStack(error)
  const responseBody = summarizeProviderResponse(
    typeof diagnostic?.responseBody === 'string' ? diagnostic.responseBody : undefined
  )
  return createAppErrorContext({
    source: fields.source,
    operation: fields.operation,
    message,
    ...(fields.id ? { id: fields.id } : {}),
    ...(fields.occurredAt ? { occurredAt: fields.occurredAt } : {}),
    ...(name ? { name } : {}),
    ...(stack ? { stack } : {}),
    ...(typeof diagnostic?.statusCode === 'number' ? { statusCode: diagnostic.statusCode } : {}),
    ...(responseBody ? { responseBody } : {}),
    ...(fields.providerId ? { providerId: fields.providerId } : {}),
    ...(fields.modelId ? { modelId: fields.modelId } : {}),
    ...(fields.recordId ? { recordId: fields.recordId } : {}),
    ...(fields.params ? { params: fields.params } : {}),
    ...(fields.imageOnly ? { imageOnly: true } : {})
  })
}

export function operationSubject(context: AppErrorContext): Extract<DoctorSubjectRef, { kind: 'operation' }> {
  return {
    kind: 'operation',
    operationId: context.id,
    ...(context.providerId ? { providerId: context.providerId } : {}),
    ...(context.modelId ? { modelId: context.modelId } : {}),
    ...(context.imageOnly ? { imageOnly: true } : {})
  }
}

export function operationIncident(context: AppErrorContext): Extract<DoctorAgentIncident, { kind: 'operation' }> {
  return { kind: 'operation', context }
}

class AppErrorContextService {
  private readonly hostContexts = new Map<string, AppErrorContext>()
  private readonly recentUncaught = new Map<string, number>()
  private readonly causeTokens = new WeakMap<object, number>()
  private nextCauseToken = 1

  private presentedOrigin(explicit: string | undefined, fallback: string): string {
    const supplied = explicit?.trim()
    if (supplied) return supplied
    const route = presentedRouteService.readPresentedRoute()
    const windowSource = presentedRouteService.readPresentedWindowSource()
    if (windowSource && route) return `${windowSource}:${route}`
    return route || windowSource || fallback
  }

  private rememberHostContext(key: string, context: AppErrorContext): AppErrorContext {
    this.hostContexts.set(key, context)
    if (this.hostContexts.size > HOST_CONTEXT_LIMIT) {
      const oldest = this.hostContexts.keys().next().value
      if (oldest !== undefined) this.hostContexts.delete(oldest)
    }
    return context
  }

  /**
   * Snapshot for one toast or popup occurrence. The key is the record occurrence,
   * not the notification key a later failure may reuse. A cached snapshot is never rewritten.
   */
  contextForHostError(
    key: string,
    input: {
      readonly cause?: unknown
      readonly title?: unknown
      readonly description?: unknown
      readonly data?: unknown
    }
  ): AppErrorContext {
    const cached = this.hostContexts.get(key)
    if (cached) return cached

    const data = readErrorDetailData(input.data)
    if (data?.errorContext && isSnapshotContext(data.errorContext)) {
      return this.rememberHostContext(key, data.errorContext)
    }

    const described =
      input.cause ??
      (typeof input.description === 'string' ? input.description : undefined) ??
      (typeof input.title === 'string' ? input.title : undefined)
    return this.rememberHostContext(
      key,
      contextFromUnknown(described, {
        source: this.presentedOrigin(data?.source, 'toast'),
        operation: data?.operation && data.operation.trim().length > 0 ? data.operation : 'toast.error',
        ...(data?.providerId ? { providerId: data.providerId } : {}),
        ...(data?.modelId ? { modelId: data.modelId } : {}),
        ...(data?.recordId ? { recordId: data.recordId } : {}),
        ...(data?.imageOnly ? { imageOnly: true } : {}),
        ...(data?.params ? { params: summarizeErrorParams(data.params) } : {})
      })
    )
  }

  private uncaughtIdentity(error: unknown): string {
    if (error && typeof error === 'object') {
      let token = this.causeTokens.get(error)
      if (token === undefined) {
        token = this.nextCauseToken++
        this.causeTokens.set(error, token)
      }
      return `obj:${token}`
    }
    return `val:${typeof error}:${String(error)}`
  }

  /**
   * True when this failure should be shown. The same object or value is collapsed
   * only inside a short window, so a later occurrence can surface again.
   */
  rememberUncaught(error: unknown, now = Date.now()): boolean {
    for (const [identity, seenAt] of this.recentUncaught) {
      if (now - seenAt >= UNCAUGHT_WINDOW_MS) this.recentUncaught.delete(identity)
    }
    const identity = this.uncaughtIdentity(error)
    const seenAt = this.recentUncaught.get(identity)
    if (seenAt !== undefined && now - seenAt < UNCAUGHT_WINDOW_MS) return false
    this.recentUncaught.set(identity, now)
    while (this.recentUncaught.size > UNCAUGHT_LIMIT) {
      const oldest = this.recentUncaught.keys().next().value
      if (oldest === undefined) break
      this.recentUncaught.delete(oldest)
    }
    return true
  }
}

export const appErrorContextService = new AppErrorContextService()
