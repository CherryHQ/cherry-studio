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

export interface SerializedAiSdkError extends SerializedError {
  readonly cause: string | null
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

export interface SerializedAiSdkDownloadError extends SerializedAiSdkError {
  readonly url: string
  readonly statusCode: number | null
  readonly statusText: string | null
}

export interface SerializedAiSdkInvalidArgumentError extends SerializedAiSdkError {
  readonly parameter: string
  readonly value: Serializable
}

export interface SerializedAiSdkInvalidDataContentError extends SerializedAiSdkError {
  readonly content: Serializable
}

export interface SerializedAiSdkInvalidMessageRoleError extends SerializedAiSdkError {
  readonly role: string
}

export interface SerializedAiSdkInvalidPromptError extends SerializedAiSdkError {
  readonly prompt: Serializable
}

export interface SerializedAiSdkInvalidToolInputError extends SerializedAiSdkError {
  readonly toolName: string
  readonly toolInput: string
}

export interface SerializedAiSdkJSONParseError extends SerializedAiSdkError {
  readonly text: string
}

export interface SerializedAiSdkMessageConversionError extends SerializedAiSdkError {
  readonly originalMessage: Serializable
}

// This type is not exported by aisdk.
// See https://github.com/vercel/ai/issues/8466
export interface SerializedAiSdkNoSpeechGeneratedError extends SerializedAiSdkError {
  readonly responses: string[]
}

export interface SerializedAiSdkNoObjectGeneratedError extends SerializedAiSdkError {
  readonly text: string | null
  readonly response: Serializable
  readonly usage: Serializable
  readonly finishReason: FinishReason | null
}

export interface SerializedAiSdkNoSuchModelError extends SerializedAiSdkError {
  readonly modelId: string
  readonly modelType: NoSuchModelError['modelType']
}

export interface SerializedAiSdkNoSuchProviderError extends SerializedAiSdkNoSuchModelError {
  readonly providerId: string
  readonly availableProviders: string[]
}

export interface SerializedAiSdkNoSuchToolError extends SerializedAiSdkError {
  readonly toolName: string
  readonly availableTools: string[] | null
}

export interface SerializedAiSdkProviderSpecificError extends SerializedAiSdkError {
  readonly provider: string
}

export interface SerializedAiSdkRetryError extends SerializedAiSdkError {
  readonly reason: string
  readonly lastError: Serializable
  readonly errors: Serializable[]
}

// This type is not exported by aisdk.
// See: https://github.com/vercel/ai/pull/8464
export interface SerializedAiSdkTooManyEmbeddingValuesForCallError extends SerializedAiSdkError {
  readonly provider: string
  readonly modelId: string
  readonly maxEmbeddingsPerCall: number
  readonly values: Serializable[]
}

export interface SerializedAiSdkToolCallRepairError extends SerializedAiSdkError {
  readonly originalError: SerializedAiSdkNoSuchToolError | SerializedAiSdkInvalidToolInputError
}

export interface SerializedAiSdkTypeValidationError extends SerializedAiSdkError {
  readonly value: Serializable
}

export interface SerializedAiSdkUnsupportedFunctionalityError extends SerializedAiSdkError {
  readonly functionality: string
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
