import {
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

import { Serializable } from './serialize'

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
  return isSerializedAiSdkError(error) && 'parameter' in error && 'value' in error
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

export const isSerializedAiSdkNoSuchToolError = (error: SerializedError): error is SerializedAiSdkNoSuchToolError => {
  return isSerializedAiSdkError(error) && 'toolName' in error && 'availableTools' in error
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
    isSerializedAiSdkRetryError(error) ||
    isSerializedAiSdkToolCallRepairError(error) ||
    isSerializedAiSdkTypeValidationError(error) ||
    isSerializedAiSdkUnsupportedFunctionalityError(error)
  )
}
