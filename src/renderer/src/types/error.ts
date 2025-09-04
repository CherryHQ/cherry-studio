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
  return isSerializedAiSdkError(error) && 'url' in error && 'requestBodyValues' in error && 'isRetryable' in error
}
