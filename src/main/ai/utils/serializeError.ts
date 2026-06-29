import type { SerializedError } from '@shared/types/error'
import type { Serializable } from '@shared/types/serializable'

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
  if (error instanceof Error) {
    const e = error as unknown as Record<string, unknown>

    const serialized: SerializedError = {
      name: error.name ?? null,
      message: error.message ?? null,
      stack: error.stack ?? null,
      cause: e.cause != null ? String(e.cause) : null
    }

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
    if ('lastError' in e) serialized.lastError = toSerializable(e.lastError)
    if ('errors' in e) serialized.errors = (e.errors as unknown[]).map((err) => toSerializable(err))
    if ('originalError' in e) serialized.originalError = serializeError(e.originalError) as Serializable
    if ('functionality' in e) serialized.functionality = e.functionality as string
    if ('provider' in e) serialized.provider = e.provider as string
    if ('responses' in e) serialized.responses = e.responses as string[]
    if ('maxEmbeddingsPerCall' in e) serialized.maxEmbeddingsPerCall = (e.maxEmbeddingsPerCall as number) ?? null
    if ('values' in e) serialized.values = (e.values as unknown[]).map((v) => toSerializable(v))

    return serialized
  }
  return {
    name: null,
    message: String(error),
    stack: null
  }
}
