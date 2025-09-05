import { FinishReason, NoSuchModelError } from 'ai'

import { Serializable } from './serialize'

export interface SerializedError {
  name: string | null
  message: string | null
  stack: string | null
  [key: string]: Serializable
}
export const isSerializedError = (error: Record<string, unknown>): error is SerializedAiSdkError => {
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
  return isSerializedAiSdkError(error) && 'text' in error && 'message' in error
}

export interface SerializedAiSdkMessageConversionError extends SerializedAiSdkError {
  readonly originalMessage: Serializable
}

export const isSerializedAiSdkMessageConversionError = (
  error: SerializedError
): error is SerializedAiSdkMessageConversionError => {
  return isSerializedAiSdkError(error) && 'originalMessage' in error
}

export interface SerializedAiSdkNoAudioGeneratedError extends SerializedAiSdkError {
  readonly responses: string[]
}

export const isSerializedAiSdkNoAudioGeneratedError = (
  error: SerializedError
): error is SerializedAiSdkNoAudioGeneratedError => {
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
  return (
    isSerializedAiSdkError(error) &&
    'providerId' in error &&
    'availableProviders' in error &&
    'modelId' in error &&
    'modelType' in error
  )
}
