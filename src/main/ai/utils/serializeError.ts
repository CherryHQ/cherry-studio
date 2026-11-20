import { APICallError, JSONParseError, RetryError, TypeValidationError } from 'ai'

import { getSafeProviderErrorMessage, serializeNestedProviderError } from '@shared/ai/providerError'
import type { SerializedError } from '@shared/types/error'
import type { Serializable } from '@shared/types/serializable'
import { classifyErrorCategory, isErrorCategory } from '@shared/utils/errorCategory'
import { hasReportingOwner } from '@shared/utils/errorReporting'

/** Lenient JSON serialization with circular-reference safety.
 *  Returns null for absent values so callers can preserve the `string | null`
 *  contract instead of emitting the literal string "null". */
function toSerializable(value: unknown): Serializable {
  if (value == null) return null
  const seen = new WeakSet<object>()
  try {
    return JSON.parse(
      JSON.stringify(value, (_key, val) => {
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '[Circular]'
          seen.add(val)
        }
        if (typeof val === 'bigint') return val.toString()
        return val
      })
    ) as Serializable
  } catch {
    return String(value)
  }
}

/** Serialize any Error to a plain object safe for IPC / JSON.
 *  Detects AI SDK error types and extracts their specific fields
 *  (statusCode, responseBody, etc.) so Renderer can use type guards.
 *
 *  Mirrors the field-extraction cascade in `src/renderer/utils/error.ts`
 *  so every `SerializedAiSdkErrorUnion` shape carries its discriminant
 *  fields and the renderer's type guards match. */
export function serializeError(error: unknown): SerializedError {
  const ownership: Record<string, Serializable> = hasReportingOwner(error) ? { reportingHandled: true } : {}
  if (APICallError.isInstance(error) || JSONParseError.isInstance(error) || TypeValidationError.isInstance(error)) {
    return { ...(serializeNestedProviderError(error) as SerializedError), ...ownership }
  }
  if (error instanceof Error) {
    const e = error as unknown as Record<string, unknown>
    const isRetryError = RetryError.isInstance(error)

    const serialized: SerializedError = {
      name: error.name ?? null,
      message: isRetryError ? getSafeProviderErrorMessage({ message: error.message }) : error.message,
      stack: isRetryError ? null : (error.stack ?? null),
      cause: e.cause != null ? String(e.cause) : null
    }
    if (e.reportingHandled === true) serialized.reportingHandled = true

    if ('url' in e) serialized.url = String(e.url ?? '')
    if ('requestBodyValues' in e) serialized.requestBodyValues = toSerializable(e.requestBodyValues)
    if ('statusCode' in e) serialized.statusCode = (e.statusCode as number) ?? null
    if ('responseBody' in e) serialized.responseBody = e.responseBody != null ? String(e.responseBody) : null
    if ('isRetryable' in e) serialized.isRetryable = Boolean(e.isRetryable)
    if ('data' in e) serialized.data = toSerializable(e.data)
    if ('responseHeaders' in e) serialized.responseHeaders = (e.responseHeaders as Record<string, string>) ?? null
    if ('statusText' in e) serialized.statusText = (e.statusText as string) ?? null
    if ('parameter' in e) serialized.parameter = e.parameter as string
    if ('value' in e) serialized.value = toSerializable(e.value)
    if ('content' in e) serialized.content = toSerializable(e.content)
    if ('role' in e) serialized.role = e.role as string
    if ('prompt' in e) serialized.prompt = toSerializable(e.prompt)
    if ('toolName' in e) serialized.toolName = (e.toolName as string) ?? null
    if ('toolInput' in e) serialized.toolInput = e.toolInput as string
    if ('text' in e) serialized.text = (e.text as string) ?? null
    if ('originalMessage' in e) serialized.originalMessage = toSerializable(e.originalMessage)
    if ('response' in e) serialized.response = toSerializable(e.response)
    if ('usage' in e) serialized.usage = toSerializable(e.usage)
    if ('finishReason' in e) serialized.finishReason = (e.finishReason as string) ?? null
    if ('modelId' in e) serialized.modelId = e.modelId as string
    if ('modelType' in e) serialized.modelType = e.modelType as string
    if ('providerId' in e) serialized.providerId = e.providerId as string
    if ('availableProviders' in e) serialized.availableProviders = e.availableProviders as string[]
    if ('availableTools' in e) serialized.availableTools = (e.availableTools as string[]) ?? null
    if ('reason' in e) serialized.reason = e.reason as string
    if ('lastError' in e) serialized.lastError = serializeNestedProviderError(e.lastError)
    if ('errors' in e) serialized.errors = (e.errors as unknown[]).map(serializeNestedProviderError)
    if ('originalError' in e) serialized.originalError = serializeError(e.originalError)
    if ('functionality' in e) serialized.functionality = e.functionality as string
    if ('provider' in e) serialized.provider = e.provider as string
    if ('responses' in e) serialized.responses = e.responses as string[]
    if ('maxEmbeddingsPerCall' in e) serialized.maxEmbeddingsPerCall = (e.maxEmbeddingsPerCall as number) ?? null
    if ('values' in e) serialized.values = (e.values as unknown[]).map((v) => toSerializable(v))
    if ('i18nKey' in e && typeof e.i18nKey === 'string') serialized.i18nKey = e.i18nKey
    // App-owned OCR diagnostic detail (attachmentRouting): the localized "why"
    // and its interpolation values must survive the IPC boundary, or the
    // renderer cannot tell empty OCR output from a failing processor.
    if ('detailI18nKey' in e && typeof e.detailI18nKey === 'string') serialized.detailI18nKey = e.detailI18nKey
    if ('detailI18nValues' in e) serialized.detailI18nValues = toSerializable(e.detailI18nValues)
    if ('providerErrorCategory' in e && isErrorCategory(e.providerErrorCategory)) {
      serialized.providerErrorCategory = e.providerErrorCategory
    }
    if ('claudeCodeExitCategory' in e && isErrorCategory(e.claudeCodeExitCategory)) {
      serialized.claudeCodeExitCategory = e.claudeCodeExitCategory
    }
    if ('diagnosticReference' in e && typeof e.diagnosticReference === 'string') {
      serialized.diagnosticReference = e.diagnosticReference
    }
    if ('processExitCode' in e && typeof e.processExitCode === 'number') serialized.processExitCode = e.processExitCode
    if ('processExitSignal' in e && typeof e.processExitSignal === 'string') {
      serialized.processExitSignal = e.processExitSignal
    }

    return serialized
  }
  const safeMessage = getSafeProviderErrorMessage({ data: error })
  return {
    name: null,
    message: safeMessage || (typeof error === 'object' && error !== null ? null : String(error)),
    stack: null,
    ...plainErrorFacts(error),
    ...ownership
  }
}

const WRAPPER_STATUS_PATTERN =
  /^(?:API Error:\s*)?([45]\d{2})\s+(?:null|undefined|\[object object\])(?:\s*\(request id:[^)\n]*\))?$/i
const LABELLED_STATUS_PATTERN = /\b(?:http|status(?:\s*code)?)\s*[:=]?\s*([45]\d{2})\b/i

function wrapperTextStatus(text: string): number | undefined {
  const match = WRAPPER_STATUS_PATTERN.exec(text.trim())
  return match ? Number(match[1]) : undefined
}

function labelledTextStatus(text: string): number | undefined {
  const match = LABELLED_STATUS_PATTERN.exec(text)
  return match ? Number(match[1]) : undefined
}

/**
 * A plain error object carries its HTTP status only in text the display filter drops (e.g. `429 null`).
 * Keep the allowlisted status and category so the failure still classifies as a provider rate limit.
 */
function plainErrorFacts(error: unknown): Partial<Pick<SerializedError, 'statusCode' | 'providerErrorCategory'>> {
  if (typeof error !== 'object' || error === null || Array.isArray(error)) return {}
  const record = error as Record<string, unknown>
  const nested =
    typeof record.error === 'object' && record.error !== null ? (record.error as Record<string, unknown>) : undefined
  const allTexts = [record.message, nested?.message, record.code, nested?.code, record.type, nested?.type].filter(
    (value): value is string => typeof value === 'string'
  )
  // Status extraction stays on short texts, but classification sees the whole message: a recognized cause
  // (a context-limit message over 500 characters) must not be dropped before it is classified.
  const texts = allTexts.filter((value) => value.length <= 500)
  const numeric = [record.statusCode, record.status, nested?.statusCode, nested?.status].find(
    (value): value is number => typeof value === 'number' && value >= 400 && value <= 599
  )
  // An explicit wrapper (`429 null`) outranks a numeric status, which the SDK may have synthesized (500) when
  // the frame had no code. Otherwise recover a status only from explicit formats, never from a bare number.
  const wrapperStatus = texts.map(wrapperTextStatus).find((value) => value !== undefined)
  // The adapter assigns 500 to a `response.failed` frame whose code it does not map. When the text itself
  // names a safety or context-limit failure, that 500 is a fallback and must not override the classification.
  const textCategory = classifyErrorCategory({ text: allTexts.join('\n') })
  const fallbackStatus =
    numeric === 500 &&
    (textCategory === 'content' || textCategory === 'context_length' || textCategory === 'rate_limit')
  const status =
    wrapperStatus ??
    (fallbackStatus ? undefined : numeric) ??
    texts.map(labelledTextStatus).find((value) => value !== undefined)
  const category = classifyErrorCategory({ text: allTexts.join('\n'), status })
  return {
    ...(status === undefined ? {} : { statusCode: status }),
    ...(category === 'unknown' ? {} : { providerErrorCategory: category })
  }
}
