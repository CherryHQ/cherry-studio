import { APP_ERROR_CONTENT_PARAM_KEYS, type AppErrorContext } from '../types/appError'
import { isSensitiveKey, REDACTED, redactSecretText, redactSecretTokens } from './redaction'

const MESSAGE_LIMIT = 4_000
const PARAM_LIMIT = 200
const RESPONSE_LIMIT = 1_000

export function createAppErrorId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `err-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function createAppErrorContext(
  input: Omit<AppErrorContext, 'id' | 'occurredAt'> & { readonly id?: string; readonly occurredAt?: string }
): AppErrorContext {
  const params = copyParams(input.params)
  const statusCode = httpStatus(input.statusCode)
  const responseBody = summarizeProviderResponse(input.responseBody)
  return {
    id: input.id && input.id.trim().length > 0 ? input.id : createAppErrorId(),
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    source: input.source,
    operation: input.operation,
    message: input.message,
    ...(input.name ? { name: input.name } : {}),
    ...(input.stack ? { stack: input.stack } : {}),
    ...(statusCode !== undefined ? { statusCode } : {}),
    ...(responseBody ? { responseBody } : {}),
    ...(input.providerId ? { providerId: input.providerId } : {}),
    ...(input.modelId ? { modelId: input.modelId } : {}),
    ...(input.recordId ? { recordId: input.recordId } : {}),
    ...(params ? { params } : {}),
    ...(input.imageOnly ? { imageOnly: true } : {})
  }
}

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function isContentParamKey(key: string): boolean {
  const normalized = normalizedKey(key)
  if ((APP_ERROR_CONTENT_PARAM_KEYS as readonly string[]).includes(key.toLowerCase())) return true
  if (
    normalized.includes('prompt') ||
    normalized.includes('attachment') ||
    normalized.includes('base64') ||
    normalized.includes('b64')
  )
    return true
  return (
    normalized === 'image' ||
    normalized === 'images' ||
    normalized === 'input' ||
    normalized === 'messages' ||
    normalized === 'files' ||
    normalized === 'inputfiles' ||
    normalized === 'inputimage' ||
    normalized === 'inputimages'
  )
}

function redactText(value: string, limit: number): string {
  const redacted = redactSecretTokens(redactSecretText(value))
  return redacted.length > limit ? `${redacted.slice(0, limit)}…` : redacted
}

function copyParams(
  params: AppErrorContext['params'],
  allow?: readonly string[]
): AppErrorContext['params'] | undefined {
  if (!params) return undefined
  const allowed = allow ? new Set(allow.map((key) => normalizedKey(key))) : undefined
  const projected: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(params)) {
    if (isContentParamKey(key)) continue
    if (allowed && !allowed.has(normalizedKey(key))) continue
    if (isSensitiveKey(key)) {
      projected[key] = REDACTED
      continue
    }
    if (typeof value === 'string') projected[key] = value.slice(0, PARAM_LIMIT)
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) projected[key] = value
  }
  return Object.keys(projected).length > 0 ? projected : undefined
}

function projectParams(params: AppErrorContext['params']): AppErrorContext['params'] | undefined {
  const copied = copyParams(params)
  if (!copied) return undefined
  const projected: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(copied)) {
    projected[key] = typeof value === 'string' && value !== REDACTED ? redactText(value, PARAM_LIMIT) : value
  }
  return projected
}

/**
 * Safe projection for a diagnostic bundle. Export keeps a redacted stack when one was
 * supplied. Upload drops the stack because it can contain local paths. Raw logs elsewhere
 * in the bundle are unchanged by this projection.
 */
export function projectAppErrorContext(context: AppErrorContext, view: 'export' | 'upload'): AppErrorContext {
  const params = projectParams(context.params)
  const stack = view === 'export' && context.stack ? redactText(context.stack, MESSAGE_LIMIT) : undefined
  const responseBody = context.responseBody ? summarizeProviderResponse(context.responseBody) : undefined
  return {
    id: context.id,
    occurredAt: context.occurredAt,
    source: redactText(context.source, 200),
    operation: redactText(context.operation, 200),
    message: redactText(context.message, MESSAGE_LIMIT),
    ...(context.name ? { name: redactText(context.name, 200) } : {}),
    ...(stack ? { stack } : {}),
    ...(context.statusCode !== undefined ? { statusCode: context.statusCode } : {}),
    ...(responseBody ? { responseBody } : {}),
    ...(context.providerId ? { providerId: context.providerId } : {}),
    ...(context.modelId ? { modelId: context.modelId } : {}),
    ...(context.recordId ? { recordId: context.recordId } : {}),
    ...(params ? { params } : {}),
    ...(context.imageOnly ? { imageOnly: true } : {})
  }
}

/**
 * Scalar summary of a parameter bag. Drops prompts, attachments, and nested values.
 * `allow` keeps only those keys (painting uses `PAINTING_ERROR_PARAM_KEYS`).
 * Sensitive key names are replaced even when they carry no recognizable token.
 */
function httpStatus(status: number | undefined): number | undefined {
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 0 || status > 999) return undefined
  return status
}

function isImageDataValue(value: string): boolean {
  return value.trimStart().toLowerCase().startsWith('data:image/')
}

function stripResponseNode(value: unknown, depth: number): unknown {
  if (depth > 6) return undefined
  if (typeof value === 'string') return isImageDataValue(value) ? undefined : value
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map((item) => stripResponseNode(item, depth + 1))
      .filter((item) => item !== undefined)
  }
  if (!value || typeof value !== 'object') return undefined
  const projected: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    const normalized = normalizedKey(key)
    if (isContentParamKey(key) || isSensitiveKey(key)) continue
    if (
      normalized === 'requestbody' ||
      normalized === 'requestbodyvalues' ||
      normalized === 'headers' ||
      normalized === 'responseheaders'
    ) {
      continue
    }
    const next = stripResponseNode(item, depth + 1)
    if (next !== undefined) projected[key] = next
  }
  return projected
}

/**
 * Provider response text safe to keep on a fault snapshot.
 * Drops prompts, attachments, request bodies, and credentials, then bounds the remainder.
 */
export function summarizeProviderResponse(body: string | undefined): string | undefined {
  if (typeof body !== 'string') return undefined
  const trimmed = body.trim()
  if (!trimmed || isImageDataValue(trimmed)) return undefined
  let text = trimmed
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      text = JSON.stringify(stripResponseNode(JSON.parse(trimmed) as unknown, 0))
    } catch {
      text = trimmed
    }
  }
  const redacted = redactText(text, RESPONSE_LIMIT)
  return redacted.length > 0 ? redacted : undefined
}

export function summarizeErrorParams(
  params: Readonly<Record<string, unknown>> | undefined,
  allow?: readonly string[]
): AppErrorContext['params'] | undefined {
  if (!params) return undefined
  const allowed = allow ? new Set(allow.map((key) => normalizedKey(key))) : undefined
  const summary: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(params)) {
    if (isContentParamKey(key)) continue
    if (allowed && !allowed.has(normalizedKey(key))) continue
    if (isSensitiveKey(key)) {
      summary[key] = REDACTED
      continue
    }
    if (typeof value === 'string') summary[key] = value.slice(0, PARAM_LIMIT)
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) summary[key] = value
  }
  return Object.keys(summary).length > 0 ? summary : undefined
}
