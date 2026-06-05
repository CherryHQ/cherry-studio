import type {
  AISDKError,
  APICallError,
  DownloadError,
  FinishReason,
  InvalidArgumentError,
  InvalidDataContentError,
  InvalidMessageRoleError,
  InvalidPromptError,
  InvalidToolInputError,
  JSONParseError,
  MessageConversionError,
  NoObjectGeneratedError,
  NoSuchModelError,
  NoSuchProviderError,
  NoSuchToolError,
  RetryError,
  ToolCallRepairError,
  TypeValidationError,
  UnsupportedFunctionalityError
} from 'ai'

import type { ProviderSpecificError } from './ProviderSpecificError'
import type { Serializable } from './serializable'

/** i18n key used when a streaming response is paused/aborted by the user. */
export const ERROR_I18N_KEY_STREAM_PAUSED = 'stream_paused'

/** i18n key used when a request times out. */
export const ERROR_I18N_KEY_REQUEST_TIMEOUT = 'request_timeout'

/**
 * Serialized error for storage and rendering.
 *
 * Known dynamic properties (accessed via index signature):
 * - `i18nKey?: string` — When present, `ErrorBlock` uses `error.${i18nKey}` for
 *   translated display instead of `message`. Set by error handlers (e.g. abort →
 *   `ERROR_I18N_KEY_STREAM_PAUSED`, auth failure → `'chat.no_api_key'`).
 *   See: ErrorBlock.tsx, ErrorHandlerMiddleware.ts
 * - `providerId?: string` — Provider ID for i18n interpolation in error messages.
 */
export interface SerializedError {
  name: string | null
  message: string | null
  stack: string | null
  [key: string]: Serializable
}
export const isSerializedError = (error: Record<string, unknown>): error is SerializedError => {
  return 'name' in error && 'message' in error && 'stack' in error
}
export interface SerializedAiSdkError extends SerializedError {
  readonly cause: string | null
}

export const isSerializedAiSdkError = (error: SerializedError): error is SerializedAiSdkError => {
  return 'cause' in error
}

export interface SerializedAiSdkAPICallError extends SerializedAiSdkError {
  readonly url: string
  readonly requestBodyValues: Serializable
  readonly statusCode: number | null
  readonly responseHeaders: Record<string, string> | null
  readonly responseBody: string | null
  readonly isRetryable: boolean
  readonly data: Serializable | null
}

export const isSerializedAiSdkAPICallError = (error: SerializedError): error is SerializedAiSdkAPICallError => {
  return (
    isSerializedAiSdkError(error) &&
    'url' in error &&
    'requestBodyValues' in error &&
    'statusCode' in error &&
    'responseHeaders' in error &&
    'responseBody' in error &&
    'isRetryable' in error &&
    'data' in error
  )
}

export interface SerializedAiSdkDownloadError extends SerializedAiSdkError {
  readonly url: string
  readonly statusCode: number | null
  readonly statusText: string | null
}

export const isSerializedAiSdkDownloadError = (error: SerializedError): error is SerializedAiSdkDownloadError => {
  return isSerializedAiSdkError(error) && 'url' in error && 'statusCode' in error && 'statusText' in error
}

export interface SerializedAiSdkInvalidArgumentError extends SerializedAiSdkError {
  readonly parameter: string
  readonly value: Serializable
}

export const isSerializedAiSdkInvalidArgumentError = (
  error: SerializedError
): error is SerializedAiSdkInvalidArgumentError => {
  return isSerializedAiSdkError(error) && 'message' in error && error.name === 'AI_InvalidArgumentError'
}

export interface SerializedAiSdkInvalidDataContentError extends SerializedAiSdkError {
  readonly content: Serializable
}

export const isSerializedAiSdkInvalidDataContentError = (
  error: SerializedError
): error is SerializedAiSdkInvalidDataContentError => {
  return isSerializedAiSdkError(error) && 'content' in error
}

export interface SerializedAiSdkInvalidMessageRoleError extends SerializedAiSdkError {
  readonly role: string
}

export const isSerializedAiSdkInvalidMessageRoleError = (
  error: SerializedError
): error is SerializedAiSdkInvalidMessageRoleError => {
  return isSerializedAiSdkError(error) && 'role' in error
}

export interface SerializedAiSdkInvalidPromptError extends SerializedAiSdkError {
  readonly prompt: Serializable
}

export const isSerializedAiSdkInvalidPromptError = (
  error: SerializedError
): error is SerializedAiSdkInvalidPromptError => {
  return isSerializedAiSdkError(error) && 'prompt' in error
}

export interface SerializedAiSdkInvalidToolInputError extends SerializedAiSdkError {
  readonly toolName: string
  readonly toolInput: string
}

export const isSerializedAiSdkInvalidToolInputError = (
  error: SerializedError
): error is SerializedAiSdkInvalidToolInputError => {
  return isSerializedAiSdkError(error) && 'toolName' in error && 'toolInput' in error
}

export interface SerializedAiSdkJSONParseError extends SerializedAiSdkError {
  readonly text: string
}

export const isSerializedAiSdkJSONParseError = (error: SerializedError): error is SerializedAiSdkJSONParseError => {
  return isSerializedAiSdkError(error) && 'text' in error
}

export interface SerializedAiSdkMessageConversionError extends SerializedAiSdkError {
  readonly originalMessage: Serializable
}

export const isSerializedAiSdkMessageConversionError = (
  error: SerializedError
): error is SerializedAiSdkMessageConversionError => {
  return isSerializedAiSdkError(error) && 'originalMessage' in error
}

// This type is not exported by aisdk.
// See https://github.com/vercel/ai/issues/8466
export interface SerializedAiSdkNoSpeechGeneratedError extends SerializedAiSdkError {
  readonly responses: string[]
}

export const isSerializedAiSdkNoSpeechGeneratedError = (
  error: SerializedError
): error is SerializedAiSdkNoSpeechGeneratedError => {
  return isSerializedAiSdkError(error) && 'responses' in error
}

export interface SerializedAiSdkNoObjectGeneratedError extends SerializedAiSdkError {
  readonly text: string | null
  readonly response: Serializable
  readonly usage: Serializable
  readonly finishReason: FinishReason | null
}

export const isSerializedAiSdkNoObjectGeneratedError = (
  error: SerializedError
): error is SerializedAiSdkNoObjectGeneratedError => {
  return (
    isSerializedAiSdkError(error) &&
    'text' in error &&
    'response' in error &&
    'usage' in error &&
    'finishReason' in error
  )
}

export interface SerializedAiSdkNoSuchModelError extends SerializedAiSdkError {
  readonly modelId: string
  readonly modelType: NoSuchModelError['modelType']
}

export const isSerializedAiSdkNoSuchModelError = (error: SerializedError): error is SerializedAiSdkNoSuchModelError => {
  return isSerializedAiSdkError(error) && 'modelId' in error && 'modelType' in error
}

export interface SerializedAiSdkNoSuchProviderError extends SerializedAiSdkNoSuchModelError {
  readonly providerId: string
  readonly availableProviders: string[]
}

export const isSerializedAiSdkNoSuchProviderError = (
  error: SerializedError
): error is SerializedAiSdkNoSuchProviderError => {
  return isSerializedAiSdkNoSuchModelError(error) && 'providerId' in error && 'availableProviders' in error
}

export interface SerializedAiSdkNoSuchToolError extends SerializedAiSdkError {
  readonly toolName: string
  readonly availableTools: string[] | null
}

export interface SerializedAiSdkProviderSpecificError extends SerializedAiSdkError {
  readonly provider: string
}

export const isSerializedAiSdkNoSuchToolError = (error: SerializedError): error is SerializedAiSdkNoSuchToolError => {
  return isSerializedAiSdkError(error) && 'toolName' in error && 'availableTools' in error
}

export const isSerializedAiSdkProviderSpecificError = (
  error: SerializedError
): error is SerializedAiSdkProviderSpecificError => {
  return isSerializedAiSdkError(error) && 'provider' in error
}

export interface SerializedAiSdkRetryError extends SerializedAiSdkError {
  readonly reason: string
  readonly lastError: Serializable
  readonly errors: Serializable[]
}

export const isSerializedAiSdkRetryError = (error: SerializedError): error is SerializedAiSdkRetryError => {
  return isSerializedAiSdkError(error) && 'reason' in error && 'lastError' in error && 'errors' in error
}

// This type is not exported by aisdk.
// See: https://github.com/vercel/ai/pull/8464
export interface SerializedAiSdkTooManyEmbeddingValuesForCallError extends SerializedAiSdkError {
  readonly provider: string
  readonly modelId: string
  readonly maxEmbeddingsPerCall: number
  readonly values: Serializable[]
}

export const isSerializedAiSdkTooManyEmbeddingValuesForCallError = (
  error: SerializedError
): error is SerializedAiSdkTooManyEmbeddingValuesForCallError => {
  return (
    isSerializedAiSdkError(error) &&
    'provider' in error &&
    'modelId' in error &&
    'maxEmbeddingsPerCall' in error &&
    'values' in error
  )
}

export interface SerializedAiSdkToolCallRepairError extends SerializedAiSdkError {
  readonly originalError: SerializedAiSdkNoSuchToolError | SerializedAiSdkInvalidToolInputError
}

export const isSerializedAiSdkToolCallRepairError = (
  error: SerializedError
): error is SerializedAiSdkToolCallRepairError => {
  return isSerializedAiSdkError(error) && 'originalError' in error
}
export interface SerializedAiSdkTypeValidationError extends SerializedAiSdkError {
  readonly value: Serializable
}

export const isSerializedAiSdkTypeValidationError = (
  error: SerializedError
): error is SerializedAiSdkTypeValidationError => {
  return isSerializedAiSdkError(error) && 'value' in error && !('parameter' in error)
}

export interface SerializedAiSdkUnsupportedFunctionalityError extends SerializedAiSdkError {
  readonly functionality: string
}

export const isSerializedAiSdkUnsupportedFunctionalityError = (
  error: SerializedError
): error is SerializedAiSdkUnsupportedFunctionalityError => {
  return isSerializedAiSdkError(error) && 'functionality' in error
}

export type AiSdkErrorUnion =
  | AISDKError
  | APICallError
  | DownloadError
  | InvalidArgumentError
  | InvalidDataContentError
  | InvalidMessageRoleError
  | InvalidPromptError
  | InvalidToolInputError
  | JSONParseError
  | MessageConversionError
  | NoObjectGeneratedError
  | NoSuchModelError
  | NoSuchProviderError
  | NoSuchToolError
  | ProviderSpecificError
  | RetryError
  | ToolCallRepairError
  | TypeValidationError
  | UnsupportedFunctionalityError

export type SerializedAiSdkErrorUnion =
  | SerializedAiSdkAPICallError
  | SerializedAiSdkDownloadError
  | SerializedAiSdkInvalidArgumentError
  | SerializedAiSdkInvalidDataContentError
  | SerializedAiSdkInvalidMessageRoleError
  | SerializedAiSdkInvalidPromptError
  | SerializedAiSdkInvalidToolInputError
  | SerializedAiSdkJSONParseError
  | SerializedAiSdkMessageConversionError
  | SerializedAiSdkNoSpeechGeneratedError
  | SerializedAiSdkNoObjectGeneratedError
  | SerializedAiSdkNoSuchModelError
  | SerializedAiSdkNoSuchProviderError
  | SerializedAiSdkNoSuchToolError
  | SerializedAiSdkProviderSpecificError
  | SerializedAiSdkRetryError
  | SerializedAiSdkToolCallRepairError
  | SerializedAiSdkTypeValidationError
  | SerializedAiSdkUnsupportedFunctionalityError

export const isSerializedAiSdkErrorUnion = (error: SerializedError): error is SerializedAiSdkErrorUnion => {
  return (
    isSerializedAiSdkAPICallError(error) ||
    isSerializedAiSdkDownloadError(error) ||
    isSerializedAiSdkInvalidArgumentError(error) ||
    isSerializedAiSdkInvalidDataContentError(error) ||
    isSerializedAiSdkInvalidMessageRoleError(error) ||
    isSerializedAiSdkInvalidPromptError(error) ||
    isSerializedAiSdkInvalidToolInputError(error) ||
    isSerializedAiSdkJSONParseError(error) ||
    isSerializedAiSdkMessageConversionError(error) ||
    isSerializedAiSdkNoObjectGeneratedError(error) ||
    isSerializedAiSdkNoSuchModelError(error) ||
    isSerializedAiSdkNoSuchProviderError(error) ||
    isSerializedAiSdkNoSuchToolError(error) ||
    isSerializedAiSdkProviderSpecificError(error) ||
    isSerializedAiSdkRetryError(error) ||
    isSerializedAiSdkToolCallRepairError(error) ||
    isSerializedAiSdkTypeValidationError(error) ||
    isSerializedAiSdkUnsupportedFunctionalityError(error)
  )
}

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
