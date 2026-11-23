import { APICallError, JSONParseError, RetryError, TypeValidationError } from 'ai'

import { getSafeProviderErrorMessage, serializeNestedProviderError } from '@shared/ai/providerError'
import type { SerializedError } from '@shared/types/error'
import type { Serializable } from '@shared/types/serializable'
import { isErrorCategory } from '@shared/utils/errorCategory'
import { hasReportingOwner } from '@shared/utils/errorReporting'

/** Lenient JSON serialization with circular-reference safety.
 *  Returns null for absent values so callers can preserve the `string | null`
 *  contract instead of emitting the literal string "null". */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Error extension fields are untrusted until this serializer converts them to IPC-safe values.
function toSerializable(value: unknown): Serializable {
  if (value == null) return null
  const seen = new WeakSet<object>()

  try {
    // SAFETY: A successful stringify/parse yields JSON values; the replacer handles repeated references and BigInts.
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

/** Serialize failure identity and selected provider extensions for display.
 * SDK response failures are redacted. Other extensions remain opaque;
 * consumers must validate values before using them. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- AI operations may throw arbitrary values; this boundary normalizes them for IPC without trusting extension fields.
export function serializeError(error: unknown): SerializedError {
  const ownership: Record<string, Serializable> = hasReportingOwner(error) ? { reportingHandled: true } : {}

  if (APICallError.isInstance(error) || JSONParseError.isInstance(error) || TypeValidationError.isInstance(error)) {
    return { ...serializeNestedProviderError(error), ...ownership }
  }

  if (error instanceof Error) {
    const e = error
    const isRetryError = RetryError.isInstance(error)

    const serialized: SerializedError = {
      name: error.name ?? null,
      message: isRetryError ? getSafeProviderErrorMessage({ message: error.message }) : error.message,
      stack: isRetryError ? null : (error.stack ?? null),
      cause: e.cause != null ? String(e.cause) : null
    }

    if ('reportingHandled' in e && e.reportingHandled === true) serialized.reportingHandled = true

    if ('url' in e) serialized.url = String(e.url ?? '')

    if ('requestBodyValues' in e) serialized.requestBodyValues = toSerializable(e.requestBodyValues)

    if ('statusCode' in e) serialized.statusCode = e.statusCode ?? null

    if ('responseBody' in e) serialized.responseBody = e.responseBody != null ? String(e.responseBody) : null

    if ('isRetryable' in e) serialized.isRetryable = Boolean(e.isRetryable)

    if ('data' in e) serialized.data = toSerializable(e.data)

    if ('responseHeaders' in e) serialized.responseHeaders = e.responseHeaders ?? null

    if ('statusText' in e) serialized.statusText = e.statusText ?? null

    if ('parameter' in e) serialized.parameter = e.parameter

    if ('value' in e) serialized.value = toSerializable(e.value)

    if ('content' in e) serialized.content = toSerializable(e.content)

    if ('role' in e) serialized.role = e.role

    if ('prompt' in e) serialized.prompt = toSerializable(e.prompt)

    if ('toolName' in e) serialized.toolName = e.toolName ?? null

    if ('toolInput' in e) serialized.toolInput = e.toolInput

    if ('text' in e) serialized.text = e.text ?? null

    if ('originalMessage' in e) serialized.originalMessage = toSerializable(e.originalMessage)

    if ('response' in e) serialized.response = toSerializable(e.response)

    if ('usage' in e) serialized.usage = toSerializable(e.usage)

    if ('finishReason' in e) serialized.finishReason = e.finishReason ?? null

    if ('modelId' in e) serialized.modelId = e.modelId

    if ('modelType' in e) serialized.modelType = e.modelType

    if ('providerId' in e) serialized.providerId = e.providerId

    if ('availableProviders' in e) serialized.availableProviders = e.availableProviders

    if ('availableTools' in e) serialized.availableTools = e.availableTools ?? null

    if ('reason' in e) serialized.reason = e.reason

    if ('lastError' in e) serialized.lastError = serializeNestedProviderError(e.lastError)

    if ('errors' in e && Array.isArray(e.errors)) serialized.errors = e.errors.map(serializeNestedProviderError)

    if ('originalError' in e) serialized.originalError = serializeError(e.originalError)

    if ('functionality' in e) serialized.functionality = e.functionality

    if ('provider' in e) serialized.provider = e.provider

    if ('responses' in e) serialized.responses = e.responses

    if ('maxEmbeddingsPerCall' in e) serialized.maxEmbeddingsPerCall = e.maxEmbeddingsPerCall ?? null

    if ('values' in e && Array.isArray(e.values)) serialized.values = e.values.map((v) => toSerializable(v))

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
    ...ownership
  }
}
